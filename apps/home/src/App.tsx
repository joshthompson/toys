import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { toys, resolve, isExternal, artwork, type Toy } from './toys';
import {
  MAX_FILE_BYTES,
  clearFiles,
  formatBytes,
  hydrate,
  isFileId,
  kindOf,
  newFileId,
  readFiles,
  removeFile,
  writeFile,
  type DesktopFile,
} from './files';
import { DesktopIcon } from './DesktopIcon';
import { ToyWindow } from './ToyWindow';
import { Taskbar } from './Taskbar';
import { PowerScreen } from './PowerScreen';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { longPress } from './longPress';
import { Screensaver } from './Screensaver';
import { findScreensaver, NO_SCREENSAVER } from './screensavers';
import { clear as clearSaved, load, save } from './storage';
import {
  BIN_GLYPH,
  BIN_KEY,
  MATHS_APP,
  MATHS_GLYPH,
  MATHS_KEY,
  CAMERA_GLYPH,
  CAMERA_KEY,
  FIXED_ICONS,
  DEFAULT_DESKTOP,
  AUDIO_APP,
  CAMERA_APP,
  DEFAULT_ICON_SIZE,
  ICON_METRICS,
  IMAGE_APP,
  TASKBAR_HEIGHT,
  VIDEO_APP,
  WRITING_APP,
  binName,
  glyphFor,
  isFixedIcon,
  isIconSize,
  type BinLevel,
  type IconSize,
  type Panes,
  type Point,
  type Power,
  type WindowContent,
  type WindowState,
} from './shell';

/** Left edge of the first window — clear of the desktop icon column. */
const CASCADE_ORIGIN = 130;
/** Quiet time before the screensaver takes the screen. */
const IDLE_MS = 60_000;
/** What counts as someone still being there. */
const IDLE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

type Box = { x: number; y: number; w: number; h: number };
/** One icon slot, which changes with the icon size setting. Icons start life on this grid. */
type Slot = { w: number; h: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Does the marquee touch this icon? Icon boxes are one slot from their top-left
 * position, and the desktop fills the viewport, so positions are already in the
 * same coordinate space as the pointer.
 */
const overlaps = (box: Box, p: Point | undefined, slot: Slot) =>
  !!p && box.x < p.x + slot.w && box.x + box.w > p.x && box.y < p.y + slot.h && box.y + box.h > p.y;

/** Names of toys that no longer exist are dropped on the way out of storage. */
const known = (names: string[] | undefined) =>
  (names ?? []).filter((n) => toys.some((t) => t.name === n));

/**
 * A position saved on a bigger screen — or from back when the icons were smaller —
 * mustn't strand an icon off the edge.
 */
const onScreen = (p: Point, slot: Slot): Point => ({
  x: clamp(p.x, 0, window.innerWidth - slot.w),
  y: clamp(p.y, 0, window.innerHeight - TASKBAR_HEIGHT - slot.h),
});

/** The foot of the first column, where the computer's own icons live. */
const corner = (slot: Slot) => Math.max(8, window.innerHeight - TASKBAR_HEIGHT - 8 - slot.h);

/** How many icons fit in a column, above the fixed ones stacked in the corner. */
const perColumn = (slot: Slot) =>
  Math.max(1, Math.floor((corner(slot) - (FIXED_ICONS.length - 1) * slot.h - 8) / slot.h));

/** The top-left of a slot on the grid. */
const at = (columnFrom: number, i: number, column: number, slot: Slot): Point => ({
  x: 8 + (columnFrom + Math.floor(i / column)) * slot.w,
  y: 8 + (i % column) * slot.h,
});

/**
 * How the desktop divides itself between the apps and the files.
 *
 * The two are different kinds of thing and reading them as one run of icons is harder
 * work than it needs to be, so the files start their own column and a blank one is left
 * between the groups to say so. Only where the blank column can be spared, though: on a
 * narrow desktop the groups close up rather than push the files off the edge of it.
 */
const grouping = (apps: number, files: number, slot: Slot) => {
  const column = perColumn(slot);
  const across = Math.max(1, Math.floor((window.innerWidth - 8) / slot.w));
  const appColumns = Math.ceil(apps / column);
  const fileColumns = Math.ceil(files / column);
  const gap = apps && files && appColumns + 1 + fileColumns <= across ? 1 : 0;
  return { column, fileColumn: appColumns + gap };
};

/** Icons down the left in columns, with the computer's own stacked up from the corner. */
const layout = (apps: string[], files: string[], slot: Slot): Record<string, Point> => {
  const positions: Record<string, Point> = {};
  const { column, fileColumn } = grouping(apps.length, files.length, slot);

  // perColumn has already left the bottom of the first column free for the fixed ones.
  apps.forEach((key, i) => (positions[key] = at(0, i, column, slot)));
  files.forEach((key, i) => (positions[key] = at(fileColumn, i, column, slot)));
  FIXED_ICONS.forEach((key, i) => {
    positions[key] = { x: 8, y: Math.max(8, corner(slot) - i * slot.h) };
  });
  return positions;
};

/**
 * The first slot on the grid nothing is sitting in — where a file goes when it turns
 * up without a position of its own, which is every file on the reload after its drop.
 * Starts at the column the files belong in, so one arriving on its own joins them
 * rather than filling a gap left among the apps.
 *
 * Icons can be dragged anywhere, so "sitting in" means within half a slot of it.
 */
const freeSlot = (taken: Point[], slot: Slot, columnFrom = 0): Point => {
  const column = perColumn(slot);
  for (let i = 0; i < column * 40; i++) {
    const spot = at(columnFrom, i, column, slot);
    const clash = taken.some(
      (p) => Math.abs(p.x - spot.x) < slot.w / 2 && Math.abs(p.y - spot.y) < slot.h / 2,
    );
    if (!clash) return spot;
  }
  // A desktop that full has bigger problems; drop it on the pile.
  return { x: 8, y: 8 };
};

export function App() {
  const saved = load();
  const [iconSize, setIconSize] = createSignal<IconSize>(
    isIconSize(saved.iconSize) ? saved.iconSize : DEFAULT_ICON_SIZE,
  );
  /** Geometry for the current icon size — the slot is what every layout sum works in. */
  const metrics = () => ICON_METRICS[iconSize()];
  const slot = () => metrics().slot;

  // A store, not a signal: <For> keys by object reference, so replacing a window
  // object on every drag frame would tear down and rebuild its iframe. Fine-grained
  // store writes keep each window's DOM node — and its iframe — alive.
  const [windows, setWindows] = createStore<WindowState[]>([]);
  // Saved positions layer over a fresh layout, so toys added since the last visit
  // still get a slot instead of stacking up at the origin — except on a desktop saved
  // before the apps and the files were laid out apart, which is let go of once so the
  // grouping has somewhere to show itself. Everything dragged after that stays put.
  const [positions, setPositions] = createStore<Record<string, Point>>({
    // Files arrive from IndexedDB a beat later and find their own slots then.
    ...layout(toys.map((t) => t.name), [], slot()),
    ...(saved.grouped
      ? Object.fromEntries(
          Object.entries(saved.positions ?? {}).map(([k, p]) => [k, onScreen(p, slot())]),
        )
      : {}),
  });
  const [bins, setBins] = createStore<{ toys: string[]; files: string[] }[]>(
    // There is always at least one bin — the rest of the app indexes into it.
    saved.bins?.length
      ? saved.bins.map((b) => ({ toys: known(b.toys), files: b.files ?? [] }))
      : [{ toys: [], files: [] }],
  );
  /**
   * Files dropped on the desktop, in the order they landed. They arrive a beat after
   * boot — their contents come from IndexedDB, which is async — so the desktop starts
   * without them and they appear into their saved positions.
   */
  const [files, setFiles] = createStore<DesktopFile[]>([]);
  /** True while a file is being dragged in from outside, so the desktop can say so. */
  const [dropping, setDropping] = createSignal(false);
  /** The id of the file whose name is currently being typed over, if any. */
  const [renaming, setRenaming] = createSignal<string | null>(null);
  /** Icon keys — toy names, plus BIN_KEY — currently selected. */
  const [selected, setSelected] = createSignal<string[]>([]);
  /** The rubber-band rectangle being dragged across the desktop, if any. */
  const [marquee, setMarquee] = createSignal<Box | null>(null);
  const [binHover, setBinHover] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [colour, setColour] = createSignal(saved.colour ?? DEFAULT_DESKTOP);
  /**
   * The id of the picture tiled across the desktop. Held as an id rather than the file
   * itself so it survives a reload, where the files themselves arrive later.
   */
  const [wallpaper, setWallpaper] = createSignal(saved.wallpaper ?? null);
  /** Emptied out of a bin: gone for good, short of a factory reset. */
  const [purged, setPurged] = createSignal<string[]>(known(saved.purged));
  const [power, setPower] = createSignal<Power>('on');
  /** A saver that has since been removed from the registry reads as no saver at all. */
  const [screensaver, setScreensaver] = createSignal(
    saved.screensaver && findScreensaver(saved.screensaver) ? saved.screensaver : NO_SCREENSAVER,
  );
  /** True while the screensaver holds the screen, whether it idled in or was previewed. */
  const [saving, setSaving] = createSignal(false);
  /** The camera's flash, which is the whole screen going white for a moment. */
  const [flashing, setFlashing] = createSignal(false);

  let nextId = 1;
  let nextZ = 1;
  let cascade = 0;
  /** Where the current marquee drag started, in viewport coords. */
  let marqueeOrigin: Point | null = null;

  /** The bin currently sitting on the desktop — always the outermost one. */
  const topDepth = () => bins.length - 1;
  const inBins = () => bins.flatMap((b) => b.toys);
  const filesInBins = () => bins.flatMap((b) => b.files);
  const byName = (name: string) => toys.find((t) => t.name === name);
  const byId = (id: string) => files.find((f) => f.id === id);
  const liveToys = () => toys.filter((t) => !inBins().includes(t.name) && !purged().includes(t.name));
  /** Files still out on the desktop. A purged one is gone from `files` altogether. */
  const liveFiles = () => files.filter((f) => !filesInBins().includes(f.id));
  const binLevels = (): BinLevel[] =>
    bins.map((level) => ({
      toys: level.toys.map(byName).filter((t): t is Toy => !!t),
      files: level.files.map(byId).filter((f): f is DesktopFile => !!f),
    }));

  /** The two groups the desktop lays out, in the order the grid takes them. */
  const appOrder = () => liveToys().map((t) => t.name);
  const fileOrder = () => liveFiles().map((f) => f.id);
  /** Every icon on the desktop bar the computer's own, apps first. */
  const iconOrder = () => [...appOrder(), ...fileOrder()];
  /** Which column a file arriving without a position of its own belongs in. */
  const fileColumn = () => grouping(liveToys().length, liveFiles().length, slot()).fileColumn;

  /**
   * The spots the visible icons hold. Positions linger for binned toys, so this reads
   * the live icons rather than the whole store — otherwise a file arriving would step
   * around gaps that only look occupied.
   */
  const occupied = () => iconKeys().map((k) => positions[k]).filter((p): p is Point => !!p);

  /**
   * The background picture, which has to still be on the desktop to count — bin it and
   * the desktop goes back to its colour until you put it back.
   */
  const wallpaperFile = () => {
    const id = wallpaper();
    return id ? liveFiles().find((f) => f.id === id) : undefined;
  };

  const isSelected = (key: string) => selected().includes(key);
  /** Everything a marquee can catch: the live toys and files, plus the computer's own. */
  const iconKeys = () => [...iconOrder(), ...FIXED_ICONS];
  /** The selected toys, in desktop order. The bin isn't a toy, so it drops out here. */
  const selectedToys = () => liveToys().filter((t) => isSelected(t.name));

  /** Pressing an icon selects just it — unless it's already part of a multi-selection. */
  const selectIcon = (key: string) => {
    if (!isSelected(key)) setSelected([key]);
  };

  /** The icons a gesture on `key` applies to: the whole selection if it's part of one. */
  const group = (key: string) => (isSelected(key) && selected().length > 1 ? selected() : [key]);

  // Write the desktop back to storage whenever it changes. Serialising the stores in
  // here is what subscribes the effect to them. It stops as soon as the machine starts
  // powering down, so a factory reset can't be undone by a trailing write.
  createEffect(() => {
    if (power() !== 'on') return;
    save({
      positions: JSON.parse(JSON.stringify(positions)),
      bins: JSON.parse(JSON.stringify(bins)),
      purged: purged(),
      colour: colour(),
      wallpaper: wallpaper(),
      iconSize: iconSize(),
      screensaver: screensaver(),
      grouped: true,
    });
  });

  // Closing the tab on a running machine is pulling its plug, so the browser is asked
  // to check first. Only the browser's own wording appears — a page isn't allowed to
  // write this dialog — and browsers skip it entirely until someone has clicked on the
  // page at least once, which is their rule and not ours.
  //
  // Shutting down or restarting from the Start menu isn't a close worth stopping: the
  // machine is already off by the time the tab goes. The power is read inside the
  // handler rather than gating an effect, because shutting down closes the tab in the
  // same tick and an effect's cleanup would not have run by then.
  onMount(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (power() !== 'on') return;
      e.preventDefault();
      // Browsers that predate preventDefault meaning anything here want the property.
      e.returnValue = true;
    };

    window.addEventListener('beforeunload', warn);
    onCleanup(() => window.removeEventListener('beforeunload', warn));
  });

  // The grid is measured in slots, so a new icon size is a new grid and the icons
  // re-flow onto it — as they did when you changed icon size in the era this apes.
  // Keeping the old spots instead would overlap the bigger icons and strand the
  // smaller ones. Each size has one metrics object, so identity is change enough.
  let sized = slot();
  createEffect(() => {
    const current = slot();
    if (current === sized) return;
    sized = current;
    setPositions(layout(appOrder(), fileOrder(), current));
  });

  // The screensaver waits for the desktop to go quiet; any input at all takes it back.
  createEffect(() => {
    if (screensaver() === NO_SCREENSAVER || power() !== 'on') return;

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Input inside a toy's iframe never reaches us. Someone playing one looks
        // idle from out here, so wait for them to click back out first.
        if (document.activeElement?.tagName === 'IFRAME') arm();
        else setSaving(true);
      }, IDLE_MS);
    };

    IDLE_EVENTS.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    onCleanup(() => {
      clearTimeout(timer);
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, arm));
    });
  });

  // Files come back from IndexedDB just after boot. Anything without a saved position —
  // a first sighting, or a file whose spot was lost with a factory reset — is parked on
  // the first free slot rather than stacked at the origin.
  onMount(async () => {
    const stored = await readFiles();
    if (!stored.length) return;
    const arrived = stored.map(hydrate);
    // Positions first: an icon reads its own position as it renders, so a file added
    // to the store before it has one would have nothing to render at.
    const taken = occupied();
    for (const file of arrived) {
      if (positions[file.id]) continue;
      const spot = freeSlot(taken, slot(), fileColumn());
      taken.push(spot);
      setPositions(file.id, spot);
    }
    setFiles(arrived);
  });

  const notice = (title: string, body: string) => spawn(title, { type: 'notice', body }, 400, 210);

  /**
   * Take files onto the desktop, whether they were dragged in or pasted.
   *
   * A drop knows where it happened, so the icons land under the pointer and cascade
   * off it; a paste doesn't, so they line up on the first free slots instead.
   *
   * Anything over the size limit is named and refused; everything else is on the
   * desktop the moment it lands, and written to IndexedDB behind it.
   */
  const placeFiles = (taking: File[], at?: Point) => {
    const taken = occupied();

    let i = 0;
    for (const file of taking) {
      const record = {
        id: newFileId(),
        // A file off the clipboard can arrive nameless; it still needs a label.
        name: file.name || 'Pasted file',
        type: file.type,
        size: file.size,
        added: Date.now() + i,
        blob: file,
      };
      // The icon doesn't wait on storage: a slow or missing IndexedDB costs the file
      // its place after the next reload, not its place on the desktop now.
      void writeFile(record);
      // This has to be set before the file joins the store, since the icon that
      // appears the moment it does reads its position as it renders.
      const spot = at
        ? onScreen({ x: at.x - slot().w / 2 + i * 24, y: at.y - slot().h / 2 + i * 24 }, slot())
        : freeSlot(taken, slot(), fileColumn());
      taken.push(spot);
      setPositions(record.id, spot);
      setFiles(files.length, hydrate(record));
      i++;
    }
  };

  /**
   * Files arriving from outside, which is where the size limit applies: it's there to
   * keep a careless drag of a video library off the desktop, not to police what the
   * computer's own apps make. Anything this desktop produced itself goes straight to
   * `placeFiles` and is as big as it turned out to be.
   */
  const acceptFiles = (dropped: File[], at?: Point) => {
    placeFiles(
      dropped.filter((f) => f.size <= MAX_FILE_BYTES),
      at,
    );

    const tooBig = dropped.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length) {
      const named = tooBig.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ');
      notice(
        'File too large',
        `${named} won't fit on the desktop. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.`,
      );
    }
  };

  /**
   * Ctrl/Cmd+V puts files on the desktop too, for anyone who copied one rather than
   * dragging it. A paste into a field belongs to that field, and a paste with no files
   * on the clipboard isn't ours at all.
   */
  onMount(() => {
    const onPaste = (e: ClipboardEvent) => {
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.matches('input, textarea, [contenteditable]')) return;
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (!pasted.length) return;
      e.preventDefault();
      acceptFiles(pasted);
    };

    window.addEventListener('paste', onPaste);
    onCleanup(() => window.removeEventListener('paste', onPaste));
  });

  /** Drops land on the desktop itself; one aimed into an open window is that window's. */
  const isDesktopDrop = (e: DragEvent) => !(e.target as HTMLElement)?.closest?.('.window');

  const onDragOver = (e: DragEvent) => {
    if (!isDesktopDrop(e) || !e.dataTransfer?.types.includes('Files')) return;
    // Without this the browser navigates to the file instead of handing it over.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };

  const onDrop = (e: DragEvent) => {
    if (!isDesktopDrop(e)) return;
    e.preventDefault();
    setDropping(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length) acceptFiles(dropped, { x: e.clientX, y: e.clientY });
  };

  const shutDown = () => {
    // Only a script-opened window may close itself, so black out first and let
    // close() take the tab away if the browser allows it.
    setPower('off');
    window.close();
  };

  const restart = () => setPower('restarting');

  const factoryReset = () => {
    // Power down before wiping, so the persistence effect is already parked.
    setPower('restarting');
    clearSaved();
    // Dropped files live in their own store, so they need wiping in their own right.
    void clearFiles();
  };

  const patch = (id: number, changes: Partial<WindowState>) => {
    const i = windows.findIndex((w) => w.id === id);
    if (i >= 0) setWindows(i, changes);
  };

  /** True when no other un-minimised window sits above this one. */
  const isTop = (win: WindowState) => windows.every((w) => w.minimized || w.z <= win.z);

  const focus = (id: number) => patch(id, { z: ++nextZ, minimized: false });

  const close = (id: number) => setWindows((ws) => ws.filter((w) => w.id !== id));

  const onTaskClick = (id: number) => {
    const win = windows.find((w) => w.id === id);
    if (!win) return;
    // Classic behaviour: the focused window's task button minimises it, otherwise raise.
    if (!win.minimized && isTop(win)) patch(id, { minimized: true });
    else focus(id);
  };

  const spawn = (title: string, content: WindowContent, width: number, height: number) => {
    const existing = windows.find((w) => w.title === title);
    if (existing) {
      focus(existing.id);
      return;
    }

    const w = Math.max(240, Math.min(width, window.innerWidth - CASCADE_ORIGIN - 16));
    const h = Math.max(160, Math.min(height, window.innerHeight - TASKBAR_HEIGHT - 96));
    const step = cascade++ * 28;

    setWindows(windows.length, {
      id: nextId++,
      title,
      content,
      x: Math.max(8, Math.min(CASCADE_ORIGIN + step, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(24 + step, window.innerHeight - TASKBAR_HEIGHT - h - 8)),
      w,
      h,
      z: ++nextZ,
      minimized: false,
      maximized: false,
    });
  };

  const openToy = (toy: Toy) => {
    if (!toy.href || inBins().includes(toy.name) || purged().includes(toy.name)) return;
    spawn(toy.name, { type: 'toy', toy }, 880, 560);
  };

  const openBin = (depth: number) => spawn(binName(depth), { type: 'bin', depth }, 460, 340);

  // Room for the 200x150 grid at 3x, plus the strip along the bottom.
  const openCamera = () => spawn(CAMERA_APP, { type: 'camera' }, 640, 540);

  const openMaths = () => spawn(MATHS_APP, { type: 'maths' }, 380, 520);

  /** Whichever app takes this kind of file, or a notice that nothing here does. */
  const openFile = (file: DesktopFile) => {
    if (filesInBins().includes(file.id)) return;
    const open = (app: string, content: WindowContent, w: number, h: number) =>
      spawn(`${file.name} — ${app}`, content, w, h);

    if (file.kind === 'image') open(IMAGE_APP, { type: 'picture', fileId: file.id }, 720, 560);
    else if (file.kind === 'audio') open(AUDIO_APP, { type: 'audio', fileId: file.id }, 620, 480);
    else if (file.kind === 'video') open(VIDEO_APP, { type: 'video', fileId: file.id }, 760, 580);
    else if (file.kind === 'text') open(WRITING_APP, { type: 'writing', fileId: file.id }, 560, 460);
    else
      notice(
        `Can't open ${file.name}`,
        `There's no app on Josh's Computer that opens ${file.type || 'this kind of file'}. It can sit on the desktop, though.`,
      );
  };

  /** Close every window looking at a file — it's not on the desktop to look at any more. */
  const FILE_WINDOWS = ['picture', 'writing', 'audio', 'video'];

  const closeFileWindows = (id: string) =>
    setWindows((ws) =>
      ws.filter((w) => !('fileId' in w.content && w.content.fileId === id && FILE_WINDOWS.includes(w.content.type))),
    );

  /** Binned, not destroyed: the file stays in IndexedDB until the bin is emptied. */
  const deleteFile = (id: string) => {
    setBins(topDepth(), 'files', (f) => [...f, id]);
    closeFileWindows(id);
    setSelected((s) => s.filter((k) => k !== id));
  };

  const restoreFile = (id: string) => {
    const level = bins.findIndex((b) => b.files.includes(id));
    if (level >= 0) setBins(level, 'files', (f) => f.filter((k) => k !== id));
  };

  /** Deleting anything on the desktop, whichever kind of thing it is. */
  const binIcon = (key: string) => (isFileId(key) ? deleteFile(key) : deleteToy(key));

  /**
   * Give a file a new name. The kind is worked out afresh from it, so naming something
   * `.txt` really does hand it to the writing app — though a file the browser already
   * told us was an image stays an image whatever it's called.
   */
  const renameFile = (id: string, name: string) => {
    const i = files.findIndex((f) => f.id === id);
    const clean = name.trim();
    if (i < 0 || !clean || clean === files[i].name) return;

    setFiles(i, { name: clean, kind: kindOf(clean, files[i].type) });
    void writeFile({
      id,
      name: clean,
      type: files[i].type,
      size: files[i].size,
      added: files[i].added,
      blob: files[i].blob,
    });

    // A writing window is named after its file, and `spawn` finds an open window by
    // title — leave a stale one and re-opening the file would open a second window on it.
    windows.forEach((win, at) => {
      if (win.content.type === 'writing' && win.content.fileId === id)
        setWindows(at, 'title', `${clean} — ${WRITING_APP}`);
    });
  };

  /** Renaming finished, whether it was typed out, clicked away from, or abandoned. */
  const endRename = (id: string, name: string | null) => {
    // The input can lose focus on the way out, after the edit is already over.
    if (renaming() !== id) return;
    setRenaming(null);
    if (name !== null) renameFile(id, name);
  };

  /** Writing the file back after an edit: same file, new contents, new size. */
  const saveText = (id: string, text: string) => {
    const i = files.findIndex((f) => f.id === id);
    if (i < 0) return;
    const blob = new Blob([text], { type: files[i].type || 'text/plain' });
    const record = { ...files[i], blob, size: blob.size };
    void writeFile({
      id: record.id,
      name: record.name,
      type: record.type,
      size: record.size,
      added: record.added,
      blob,
    });
    // The old blob: URL pointed at the text before this edit, so it's no use now.
    URL.revokeObjectURL(files[i].url);
    setFiles(i, { blob, size: blob.size, url: URL.createObjectURL(blob) });
  };
  const openExternally = (toy: Toy) =>
    toy.href && window.open(resolve(toy.href), '_blank', 'noopener');

  const deleteToy = (name: string) => {
    setBins(topDepth(), 'toys', (t) => [...t, name]);
    // A binned toy can't stay open behind the bin.
    setWindows((ws) => ws.filter((w) => w.title !== name));
    setSelected((s) => s.filter((k) => k !== name));
  };

  /**
   * Dropping one icon of a multi-selection on the bin takes the whole selection with it.
   * The bin can be selected too, but it can't be dropped into itself.
   */
  const deleteGroup = (name: string) =>
    group(name)
      .filter((k) => !isFixedIcon(k))
      .forEach(binIcon);

  /** Deleting the bin doesn't destroy it — it nests it inside a brand new, bigger bin. */
  const deleteBin = () => setBins(bins.length, { toys: [], files: [] });

  const restore = (name: string) => {
    const level = bins.findIndex((b) => b.toys.includes(name));
    if (level >= 0) setBins(level, 'toys', (t) => t.filter((n) => n !== name));
  };

  /**
   * Empty a bin. Binned toys are only ever hidden — the app owns them — but a file has
   * nowhere else to exist, so emptying really does destroy it: out of IndexedDB, out of
   * the store, and its blob: URL let go.
   */
  const emptyLevel = (depth: number) => {
    const doomed = bins[depth].files;
    setPurged((p) => [...p, ...bins[depth].toys]);
    setBins(depth, 'toys', []);
    setBins(depth, 'files', []);
    for (const id of doomed) {
      const file = byId(id);
      if (file) URL.revokeObjectURL(file.url);
      // The background is held by id, so a destroyed one would leave a dangling setting.
      if (wallpaper() === id) setWallpaper(null);
      void removeFile(id);
    }
    setFiles((f) => f.filter((file) => !doomed.includes(file.id)));
  };

  /**
   * Drag one icon of a multi-selection and the rest come along. The delta is clamped
   * against every icon in the group first, so they keep their relative spacing at the
   * edges rather than piling up against them one by one.
   */
  const moveIcons = (key: string, x: number, y: number) => {
    const keys = group(key).filter((k) => positions[k]);
    const maxX = window.innerWidth - slot().w;
    const maxY = window.innerHeight - TASKBAR_HEIGHT - slot().h;

    let dx = x - positions[key].x;
    let dy = y - positions[key].y;
    for (const k of keys) {
      dx = clamp(dx, -positions[k].x, maxX - positions[k].x);
      dy = clamp(dy, -positions[k].y, maxY - positions[k].y);
    }
    for (const k of keys) setPositions(k, { x: positions[k].x + dx, y: positions[k].y + dy });
  };

  const arrangeIcons = () => setPositions(layout(appOrder(), fileOrder(), slot()));

  /** Rubber-band selection: press empty desktop, drag a rectangle over the icons. */
  const startMarquee = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    // Only the desktop itself starts one, and only with the primary button.
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    marqueeOrigin = { x: e.clientX, y: e.clientY };
    setSelected([]);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /**
   * The desktop hears about presses on the windows sitting on it too, since they bubble.
   * Only the desktop itself, and the layer the icons are positioned in, are the desktop.
   */
  const onDesktopItself = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.classList.contains('desktop') || target.classList.contains('desktop-icons'));

  // Holding the desktop opens its menu, since a finger has no right button. The marquee
  // this press started is dropped: a hold that stayed put has drawn nothing anyway.
  const deskPress = longPress((x, y) => {
    endMarquee();
    setSelected([]);
    openMenu(x, y, desktopMenu());
  });

  const dragMarquee = (e: PointerEvent) => {
    if (!marqueeOrigin) return;
    const box = {
      x: Math.min(marqueeOrigin.x, e.clientX),
      y: Math.min(marqueeOrigin.y, e.clientY),
      w: Math.abs(e.clientX - marqueeOrigin.x),
      h: Math.abs(e.clientY - marqueeOrigin.y),
    };
    setMarquee(box);
    setSelected(iconKeys().filter((k) => overlaps(box, positions[k], slot())));
  };

  const endMarquee = () => {
    marqueeOrigin = null;
    setMarquee(null);
  };

  const openMenu = (x: number, y: number, entries: MenuEntry[]) => setMenu({ x, y, entries });

  const toyMenu = (toy: Toy): MenuEntry[] => {
    // Right-clicking one of several selected icons acts on all of them.
    const chosen = selectedToys();
    if (chosen.length > 1) {
      const openable = chosen.some((t) => t.href);
      return [
        { label: 'Open All', disabled: !openable, onSelect: () => chosen.forEach(openToy) },
        {
          label: 'Open All Externally',
          disabled: !openable,
          onSelect: () => chosen.forEach(openExternally),
        },
        { separator: true },
        { label: 'Delete All', onSelect: () => chosen.forEach((t) => deleteToy(t.name)) },
      ];
    }

    return [
      { label: 'Open', disabled: !toy.href, onSelect: () => openToy(toy) },
      { label: 'Open Externally', disabled: !toy.href, onSelect: () => openExternally(toy) },
      { separator: true },
      { label: 'Delete', onSelect: () => deleteToy(toy.name) },
    ];
  };

  const fileMenu = (file: DesktopFile): MenuEntry[] => {
    // Right-clicking one of several selected icons acts on all of them, toys included.
    const chosen = group(file.id).filter((k) => !isFixedIcon(k));
    if (chosen.length > 1) {
      const open = (key: string) => {
        const picked = isFileId(key) ? byId(key) : undefined;
        if (picked) openFile(picked);
        else {
          const toy = byName(key);
          if (toy) openToy(toy);
        }
      };
      return [
        { label: 'Open All', onSelect: () => chosen.forEach(open) },
        { separator: true },
        { label: 'Delete All', onSelect: () => chosen.forEach(binIcon) },
      ];
    }

    return [
      { label: 'Open', onSelect: () => openFile(file) },
      { label: 'Rename', onSelect: () => setRenaming(file.id) },
      ...(file.kind === 'image'
        ? [
            {
              label: 'Make Desktop Background',
              disabled: wallpaper() === file.id,
              onSelect: () => setWallpaper(file.id),
            },
          ]
        : []),
      { separator: true },
      { label: 'Delete', onSelect: () => deleteFile(file.id) },
    ];
  };

  const binMenu = (): MenuEntry[] => [
    { label: 'Open', onSelect: () => openBin(topDepth()) },
    { label: 'Open Externally', disabled: true, onSelect: () => {} },
    { separator: true },
    { label: 'Delete', onSelect: deleteBin },
  ];

  const desktopMenu = (): MenuEntry[] => [
    { label: 'Arrange Icons', onSelect: arrangeIcons },
    // Only worth offering once there's a background to take away.
    ...(wallpaperFile()
      ? [{ label: 'Remove Desktop Background', onSelect: () => setWallpaper(null) }]
      : []),
    { separator: true },
    { label: 'Desktop Settings', onSelect: () => spawn('Desktop Settings', { type: 'settings' }, 400, 430) },
    { label: 'About Josh OS', onSelect: () => spawn('About Josh OS', { type: 'about' }, 380, 300) },
  ];

  const panes: Panes = {
    binLevels,
    openBin,
    restore,
    restoreFile,
    emptyLevel,
    colour,
    setColour,
    wallpaper: wallpaperFile,
    setWallpaper,
    iconSize,
    setIconSize,
    screensaver,
    setScreensaver,
    previewScreensaver: () => setSaving(true),
    toyCount: () => liveToys().length,
    fileById: byId,
    filesOfKind: (kind) => liveFiles().filter((f) => f.kind === kind),
    saveText,
    showText: (title, body) => spawn(title, { type: 'text', body }, 420, 340),
    // A File carries the name a Blob hasn't got, and from there it's a drop like any
    // other: the size limit, the free slot, the write to IndexedDB, all of it.
    saveToDesktop: (name, blob) => placeFiles([new File([blob], name, { type: blob.type })]),
    flash: setFlashing,
  };

  return (
    <main
      class="desktop"
      classList={{ 'is-dropping': dropping() }}
      style={{
        // Not the `background` shorthand: it would wipe out the tiled picture below it.
        'background-color': colour(),
        'background-image': wallpaperFile() ? `url("${wallpaperFile()!.url}")` : undefined,
        '--icon-slot-w': `${slot().w}px`,
        '--icon-slot-h': `${slot().h}px`,
        '--icon-art': `${metrics().art}px`,
        '--icon-label': `${metrics().label}px`,
      }}
      onPointerDown={(e) => {
        if (onDesktopItself(e.target)) deskPress.down(e);
        startMarquee(e);
      }}
      onPointerMove={(e) => {
        deskPress.move(e);
        dragMarquee(e);
      }}
      onPointerUp={() => {
        deskPress.cancel();
        endMarquee();
      }}
      onPointerCancel={() => {
        deskPress.cancel();
        endMarquee();
      }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        // dragleave also fires crossing into a child, which is still inside the desktop.
        if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={onDrop}
      onContextMenu={(e) => {
        // Right-click belongs to Josh OS everywhere inside the app, but only the
        // desktop itself gets the desktop menu — window chrome just gets silence.
        e.preventDefault();
        if (onDesktopItself(e.target)) {
          setSelected([]);
          openMenu(e.clientX, e.clientY, desktopMenu());
        }
      }}
    >
      <div class="desktop-icons">
        <For each={liveToys()}>
          {(toy) => (
            <DesktopIcon
              label={toy.name}
              image={artwork(toy) && resolve(artwork(toy)!)}
              bare={!!toy.icon}
              colour={toys.indexOf(toy)}
              position={positions[toy.name]}
              selected={isSelected(toy.name)}
              disabled={!toy.href}
              external={!!toy.href && isExternal(toy.href)}
              onSelect={() => selectIcon(toy.name)}
              onOpen={() => openToy(toy)}
              onMove={(x, y) => moveIcons(toy.name, x, y)}
              onDragOverBin={setBinHover}
              onDropInBin={() => {
                setBinHover(false);
                deleteGroup(toy.name);
              }}
              onContextMenu={(x, y) => openMenu(x, y, toyMenu(toy))}
            />
          )}
        </For>

        <For each={liveFiles()}>
          {(file) => (
            <DesktopIcon
              label={file.name}
              // A picture is its own icon, framed like a thumbnail; everything else
              // gets a glyph sitting straight on the desktop.
              image={file.kind === 'image' ? file.url : undefined}
              glyph={glyphFor(file.kind)}
              bare={file.kind !== 'image'}
              position={positions[file.id]}
              selected={isSelected(file.id)}
              renaming={renaming() === file.id}
              onRenamed={(name) => endRename(file.id, name)}
              onSelect={() => selectIcon(file.id)}
              onOpen={() => openFile(file)}
              onMove={(x, y) => moveIcons(file.id, x, y)}
              onDragOverBin={setBinHover}
              onDropInBin={() => {
                setBinHover(false);
                deleteGroup(file.id);
              }}
              onContextMenu={(x, y) => openMenu(x, y, fileMenu(file))}
            />
          )}
        </For>

        {/* The computer's own apps, sitting above the bin rather than out with the toys. */}
        <DesktopIcon
          label={MATHS_APP}
          glyph={MATHS_GLYPH}
          bare
          position={positions[MATHS_KEY]}
          selected={isSelected(MATHS_KEY)}
          onSelect={() => selectIcon(MATHS_KEY)}
          onOpen={openMaths}
          onMove={(x, y) => moveIcons(MATHS_KEY, x, y)}
          onContextMenu={(x, y) => openMenu(x, y, [{ label: 'Open', onSelect: openMaths }])}
        />

        <DesktopIcon
          label={CAMERA_APP}
          glyph={CAMERA_GLYPH}
          bare
          position={positions[CAMERA_KEY]}
          selected={isSelected(CAMERA_KEY)}
          onSelect={() => selectIcon(CAMERA_KEY)}
          onOpen={openCamera}
          onMove={(x, y) => moveIcons(CAMERA_KEY, x, y)}
          onContextMenu={(x, y) => openMenu(x, y, [{ label: 'Open', onSelect: openCamera }])}
        />

        <DesktopIcon
          label={binName(topDepth())}
          glyph={BIN_GLYPH}
          isBin
          binCount={bins[topDepth()].toys.length + topDepth()}
          dropTarget={binHover()}
          position={positions[BIN_KEY]}
          selected={isSelected(BIN_KEY)}
          onSelect={() => selectIcon(BIN_KEY)}
          onOpen={() => openBin(topDepth())}
          onMove={(x, y) => moveIcons(BIN_KEY, x, y)}
          onContextMenu={(x, y) => openMenu(x, y, binMenu())}
        />
      </div>

      {/* Sits after the icons but before the windows, so it bands over the desktop only. */}
      <Show when={marquee()}>
        {(m) => (
          <div
            class="marquee"
            style={{
              left: `${m().x}px`,
              top: `${m().y}px`,
              width: `${m().w}px`,
              height: `${m().h}px`,
            }}
          />
        )}
      </Show>

      <For each={windows}>
        {(win) => (
          <ToyWindow
            win={win}
            active={isTop(win)}
            panes={panes}
            onFocus={() => focus(win.id)}
            onClose={() => close(win.id)}
            onMinimize={() => patch(win.id, { minimized: true })}
            onToggleMaximize={() => patch(win.id, { maximized: !win.maximized, z: ++nextZ })}
            onMove={(x, y) => patch(win.id, { x, y })}
            onResize={(x, y, w, h) => patch(win.id, { x, y, w, h })}
            onRetitle={(title) => patch(win.id, { title })}
          />
        )}
      </For>

      {/* Over the windows, since a drop anywhere lands on the desktop behind them. */}
      <Show when={dropping()}>
        <div class="drop-hint">
          <p>Drop to put it on the desktop</p>
          <small>Up to {formatBytes(MAX_FILE_BYTES)} a file</small>
        </div>
      </Show>

      <Show when={menu()}>
        {(m) => (
          <ContextMenu x={m().x} y={m().y} entries={m().entries} onClose={() => setMenu(null)} />
        )}
      </Show>

      <Taskbar
        windows={windows}
        toys={liveToys()}
        binName={binName(topDepth())}
        binCount={bins[topDepth()].toys.length + topDepth()}
        onLaunch={openToy}
        onOpenCamera={openCamera}
        onOpenMaths={openMaths}
        onOpenBin={() => openBin(topDepth())}
        onTaskClick={onTaskClick}
        onShutDown={shutDown}
        onRestart={restart}
        onFactoryReset={factoryReset}
        taskbarHeight={TASKBAR_HEIGHT}
      />

      {/* Above the taskbar but below the power screen — a restart wins over a saver. */}
      <Show when={saving()}>
        <Screensaver id={screensaver()} onDismiss={() => setSaving(false)} />
      </Show>

      <Show when={power() !== 'on'}>
        {/* Covers the lot, taskbar included — the desktop is gone until the reload. */}
        <PowerScreen mode={power()} onBooted={() => location.reload()} />
      </Show>

      {/*
        Always here, and almost always invisible. Left in the tree rather than shown and
        hidden so that going out is a fade rather than a cut — and a fade needs something
        to fade.
      */}
      <div class="screen-flash" classList={{ 'is-lit': flashing() }} />
    </main>
  );
}
