import { createEffect, createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { toys, resolve, isExternal, artwork, type Toy } from './toys';
import { DesktopIcon } from './DesktopIcon';
import { ToyWindow } from './ToyWindow';
import { Taskbar } from './Taskbar';
import { PowerScreen } from './PowerScreen';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { clear as clearSaved, load, save } from './storage';
import {
  BIN_GLYPH,
  BIN_KEY,
  DEFAULT_DESKTOP,
  TASKBAR_HEIGHT,
  binName,
  type BinLevel,
  type Panes,
  type Point,
  type Power,
  type WindowContent,
  type WindowState,
} from './shell';

/** Left edge of the first window — clear of the desktop icon column. */
const CASCADE_ORIGIN = 130;
/** One icon slot. Icons drag freely, but start life on this grid. */
const ICON_W = 88;
const ICON_H = 96;

type Box = { x: number; y: number; w: number; h: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Does the marquee touch this icon? Icon boxes are ICON_W × ICON_H from their
 * top-left position, and the desktop fills the viewport, so positions are already
 * in the same coordinate space as the pointer.
 */
const overlaps = (box: Box, p: Point | undefined) =>
  !!p && box.x < p.x + ICON_W && box.x + box.w > p.x && box.y < p.y + ICON_H && box.y + box.h > p.y;

/** Names of toys that no longer exist are dropped on the way out of storage. */
const known = (names: string[] | undefined) =>
  (names ?? []).filter((n) => toys.some((t) => t.name === n));

/** A position saved on a bigger screen mustn't strand an icon off the edge of this one. */
const onScreen = (p: Point): Point => ({
  x: clamp(p.x, 0, window.innerWidth - ICON_W),
  y: clamp(p.y, 0, window.innerHeight - TASKBAR_HEIGHT - ICON_H),
});

/** Toys down the left in columns, bin in the bottom-left corner. */
const layout = (visible: Toy[]): Record<string, Point> => {
  const positions: Record<string, Point> = {};
  const binY = Math.max(8, window.innerHeight - TASKBAR_HEIGHT - 8 - ICON_H);
  // Leave the bottom slot of the first column free so the bin doesn't land on a toy.
  const perColumn = Math.max(1, Math.floor((binY - 8) / ICON_H));

  visible.forEach((toy, i) => {
    positions[toy.name] = {
      x: 8 + Math.floor(i / perColumn) * ICON_W,
      y: 8 + (i % perColumn) * ICON_H,
    };
  });
  positions[BIN_KEY] = { x: 8, y: binY };
  return positions;
};

export function App() {
  const saved = load();

  // A store, not a signal: <For> keys by object reference, so replacing a window
  // object on every drag frame would tear down and rebuild its iframe. Fine-grained
  // store writes keep each window's DOM node — and its iframe — alive.
  const [windows, setWindows] = createStore<WindowState[]>([]);
  // Saved positions layer over a fresh layout, so toys added since the last visit
  // still get a slot instead of stacking up at the origin.
  const [positions, setPositions] = createStore<Record<string, Point>>({
    ...layout(toys),
    ...Object.fromEntries(Object.entries(saved.positions ?? {}).map(([k, p]) => [k, onScreen(p)])),
  });
  const [bins, setBins] = createStore<{ toys: string[] }[]>(
    // There is always at least one bin — the rest of the app indexes into it.
    saved.bins?.length ? saved.bins.map((b) => ({ toys: known(b.toys) })) : [{ toys: [] }],
  );
  /** Icon keys — toy names, plus BIN_KEY — currently selected. */
  const [selected, setSelected] = createSignal<string[]>([]);
  /** The rubber-band rectangle being dragged across the desktop, if any. */
  const [marquee, setMarquee] = createSignal<Box | null>(null);
  const [binHover, setBinHover] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [colour, setColour] = createSignal(saved.colour ?? DEFAULT_DESKTOP);
  /** Emptied out of a bin: gone for good, short of a factory reset. */
  const [purged, setPurged] = createSignal<string[]>(known(saved.purged));
  const [power, setPower] = createSignal<Power>('on');

  let nextId = 1;
  let nextZ = 1;
  let cascade = 0;
  /** Where the current marquee drag started, in viewport coords. */
  let marqueeOrigin: Point | null = null;

  /** The bin currently sitting on the desktop — always the outermost one. */
  const topDepth = () => bins.length - 1;
  const inBins = () => bins.flatMap((b) => b.toys);
  const byName = (name: string) => toys.find((t) => t.name === name);
  const liveToys = () => toys.filter((t) => !inBins().includes(t.name) && !purged().includes(t.name));
  const binLevels = (): BinLevel[] =>
    bins.map((level) => ({ toys: level.toys.map(byName).filter((t): t is Toy => !!t) }));

  const isSelected = (key: string) => selected().includes(key);
  /** Everything a marquee can catch: the live toys, plus the bin. */
  const iconKeys = () => [...liveToys().map((t) => t.name), BIN_KEY];
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
    });
  });

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
      .filter((k) => k !== BIN_KEY)
      .forEach(deleteToy);

  /** Deleting the bin doesn't destroy it — it nests it inside a brand new, bigger bin. */
  const deleteBin = () => setBins(bins.length, { toys: [] });

  const restore = (name: string) => {
    const level = bins.findIndex((b) => b.toys.includes(name));
    if (level >= 0) setBins(level, 'toys', (t) => t.filter((n) => n !== name));
  };

  const emptyLevel = (depth: number) => {
    setPurged((p) => [...p, ...bins[depth].toys]);
    setBins(depth, 'toys', []);
  };

  /**
   * Drag one icon of a multi-selection and the rest come along. The delta is clamped
   * against every icon in the group first, so they keep their relative spacing at the
   * edges rather than piling up against them one by one.
   */
  const moveIcons = (key: string, x: number, y: number) => {
    const keys = group(key).filter((k) => positions[k]);
    const maxX = window.innerWidth - ICON_W;
    const maxY = window.innerHeight - TASKBAR_HEIGHT - ICON_H;

    let dx = x - positions[key].x;
    let dy = y - positions[key].y;
    for (const k of keys) {
      dx = clamp(dx, -positions[k].x, maxX - positions[k].x);
      dy = clamp(dy, -positions[k].y, maxY - positions[k].y);
    }
    for (const k of keys) setPositions(k, { x: positions[k].x + dx, y: positions[k].y + dy });
  };

  const arrangeIcons = () => setPositions(layout(liveToys()));

  /** Rubber-band selection: press empty desktop, drag a rectangle over the icons. */
  const startMarquee = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    // Only the desktop itself starts one, and only with the primary button.
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    marqueeOrigin = { x: e.clientX, y: e.clientY };
    setSelected([]);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const dragMarquee = (e: PointerEvent) => {
    if (!marqueeOrigin) return;
    const box = {
      x: Math.min(marqueeOrigin.x, e.clientX),
      y: Math.min(marqueeOrigin.y, e.clientY),
      w: Math.abs(e.clientX - marqueeOrigin.x),
      h: Math.abs(e.clientY - marqueeOrigin.y),
    };
    setMarquee(box);
    setSelected(iconKeys().filter((k) => overlaps(box, positions[k])));
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

  const binMenu = (): MenuEntry[] => [
    { label: 'Open', onSelect: () => openBin(topDepth()) },
    { label: 'Open Externally', disabled: true, onSelect: () => {} },
    { separator: true },
    { label: 'Delete', onSelect: deleteBin },
  ];

  const desktopMenu = (): MenuEntry[] => [
    { label: 'Arrange Icons', onSelect: arrangeIcons },
    { separator: true },
    { label: 'Desktop Settings', onSelect: () => spawn('Desktop Settings', { type: 'settings' }, 400, 320) },
    { label: 'About Josh OS', onSelect: () => spawn('About Josh OS', { type: 'about' }, 380, 300) },
  ];

  const panes: Panes = {
    binLevels,
    openBin,
    restore,
    emptyLevel,
    colour,
    setColour,
    toyCount: () => liveToys().length,
  };

  return (
    <main
      class="desktop"
      style={{ background: colour() }}
      onPointerDown={startMarquee}
      onPointerMove={dragMarquee}
      onPointerUp={endMarquee}
      onPointerCancel={endMarquee}
      onContextMenu={(e) => {
        // Right-click belongs to Josh OS everywhere inside the app, but only the
        // desktop itself gets the desktop menu — window chrome just gets silence.
        e.preventDefault();
        const target = e.target as HTMLElement;
        if (target.classList.contains('desktop') || target.classList.contains('desktop-icons')) {
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
          />
        )}
      </For>

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
        onOpenBin={() => openBin(topDepth())}
        onTaskClick={onTaskClick}
        onShutDown={shutDown}
        onRestart={restart}
        onFactoryReset={factoryReset}
        taskbarHeight={TASKBAR_HEIGHT}
      />

      <Show when={power() !== 'on'}>
        {/* Covers the lot, taskbar included — the desktop is gone until the reload. */}
        <PowerScreen mode={power()} onBooted={() => location.reload()} />
      </Show>
    </main>
  );
}
