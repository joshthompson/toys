import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { downloadFile, formatBytes } from '../os/files';
import type { Menu } from '../os/osApi';
import { IMAGE_APP, type Panes } from '../os/shell';

type Props = {
  /** The picture that was opened. Where the viewer goes from there is its own business. */
  fileId: string;
  panes: Panes;
  onTitle: (title: string) => void;
  /**
   * Hand the window a menu bar. The menus go as an accessor rather than a list, so the
   * bar reads the labels and the greyed-out items off the viewer's state as it moves.
   */
  onMenus: (menus: () => Menu[], select: (id: string) => void) => void;
};

/** How far up or down an arrow key moves a picture too big for its window. */
const SCROLL_STEP = 64;

/** The stops the zoom buttons walk. Whole steps, the way a 1995 viewer zoomed. */
const STOPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/** How long the bar says what just happened before going back to saying what this is. */
const NOTE_MS = 2400;

/**
 * Josh's Image Looking App — one dropped image, and a way through the rest.
 *
 * The desktop is the only folder this computer has, so the arrows walk the pictures
 * sitting on it, in icon order, wrapping round at both ends.
 *
 * A picture opens fitted to the window, and is never blown up past its own size to get
 * there. Zoom in beyond the fit and the picture is scrolled to rather than shrunk.
 *
 * Left and right always mean the picture before and the picture after, whatever the
 * zoom. Getting around a picture too big for the window is up and down, the wheel, or
 * dragging it about.
 */
export function PicturePane(props: Props) {
  const [id, setId] = createSignal(props.fileId);
  /** A scale, or 'fit' for however much of the window the picture happens to need. */
  const [zoom, setZoom] = createSignal<number | 'fit'>('fit');
  /** The picture's own pixel size, once the browser has decoded it. */
  const [natural, setNatural] = createSignal<{ w: number; h: number }>();
  /** The stage's content box, watched so 'fit' keeps up with the window being resized. */
  const [box, setBox] = createSignal({ w: 0, h: 0 });
  /** True while the picture is being dragged about, for the cursor's sake. */
  const [panning, setPanning] = createSignal(false);
  /** A word in the bar about something that has just been done with the picture. */
  const [note, setNote] = createSignal<string | null>(null);
  let frame!: HTMLDivElement;
  let stage!: HTMLDivElement;
  /** The picture as the window is showing it, which is also what gets copied out. */
  let shown: HTMLImageElement | null = null;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  const say = (what: string) => {
    setNote(what);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => setNote(null), NOTE_MS);
  };
  onCleanup(() => clearTimeout(noteTimer));

  const pictures = () => props.panes.filesOfKind('image');
  /**
   * -1 once the picture on screen has been binned from under us. The window stays put
   * showing what it last had, so the arrows still work off the end of the old spot.
   */
  const at = () => pictures().findIndex((p) => p.id === id());
  const current = () => props.panes.fileById(id());

  /** What 'fit' works out to. Never blows a small picture up past its own size. */
  const fitScale = () => {
    const nat = natural();
    const { w, h } = box();
    if (!nat || !w || !h) return 1;
    return Math.min(w / nat.w, h / nat.h, 1);
  };

  const scale = () => {
    const z = zoom();
    return z === 'fit' ? fitScale() : z;
  };

  /** The next stop past where we are now, in or out. Undefined at either end. */
  const nextStop = (dir: 1 | -1) => {
    const now = scale();
    return dir > 0
      ? STOPS.find((s) => s > now + 0.001)
      : STOPS.filter((s) => s < now - 0.001).pop();
  };

  const stepZoom = (dir: 1 | -1) => {
    const next = nextStop(dir);
    if (next) setZoom(next);
  };

  /** Is any of the picture out of sight? Worked out from the numbers, not the DOM,
      so it settles with the same render as the size the numbers describe. */
  const overflows = () => {
    const nat = natural();
    if (!nat) return false;
    const { w, h } = box();
    return nat.w * scale() > w + 1 || nat.h * scale() > h + 1;
  };

  /**
   * Drag the picture about. Left and right belong to the pictures either side, so this
   * and the wheel are how you get around one that outgrows its window.
   *
   * Pointer capture keeps the move and up on the stage, the way the window's own
   * gestures do, so a fast drag off the edge of the picture can't lose the grip.
   */
  let grab: { x: number; y: number; left: number; top: number } | null = null;

  const beginPan = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    // A finger already drags the picture about by scrolling it; taking the pointer
    // here as well would move it twice as far as the drag.
    if (e.pointerType === 'touch' || e.button !== 0 || !overflows()) return;
    grab = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  };

  const pan = (e: PointerEvent) => {
    if (!grab) return;
    stage.scrollLeft = grab.left - (e.clientX - grab.x);
    stage.scrollTop = grab.top - (e.clientY - grab.y);
  };

  const endPan = () => {
    grab = null;
    setPanning(false);
  };

  const show = (file: { id: string; name: string }) => {
    setId(file.id);
    // The old picture's size says nothing about the new one; its load event will.
    setNatural(undefined);
    stage.scrollTo(0, 0);
    props.onTitle(`${file.name} — ${IMAGE_APP}`);
  };

  /** Move `by` pictures along, wrapping. From a binned picture, start over at the top. */
  const step = (by: number) => {
    const all = pictures();
    if (!all.length) return;
    const here = at();
    const next = here < 0 ? 0 : (here + by + all.length) % all.length;
    show(all[next]);
  };

  /** Already tiled across the desktop, so there's nothing to do to it again. */
  const isWallpaper = () => props.panes.wallpaper()?.id === id();

  /** Whether this browser has the clipboard call that takes a picture rather than text. */
  const canCopy = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

  /**
   * The picture on screen, encoded as a PNG.
   *
   * Taken off the <img> the window is already showing rather than by decoding the file
   * a second time — which is quicker, and also means anything the browser can display
   * can be copied out, whatever the clipboard would have made of the original bytes.
   */
  const pngOfShown = async () => {
    const img = shown;
    if (!img?.naturalWidth) throw new Error('this picture has not decoded yet');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('this browser has no canvas to redraw it through');
    ctx.drawImage(img, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('the canvas would not give up a PNG');
    return png;
  };

  /**
   * Put the picture on the real computer's clipboard, for pasting into something that
   * has nothing to do with this one.
   *
   * PNG is the only format the clipboard is obliged to take, so anything else goes
   * through the canvas above and arrives as a PNG of the same picture — which is what
   * every other viewer does about this too. A PNG goes as it is: decoding and encoding
   * a lossless format to arrive back where it started would be work for nothing.
   */
  const copyPicture = async () => {
    const file = current();
    if (!file) return;
    try {
      // Handed over as a promise rather than awaited first, because Safari counts the
      // write against the click that asked for it and an await in between loses it.
      const png = file.type === 'image/png' ? Promise.resolve(file.blob) : pngOfShown();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      say('Copied to the clipboard');
    } catch {
      // Every one of these is the browser's refusal rather than the picture's fault:
      // a window that isn't focused, a clipboard the page isn't allowed, a format the
      // canvas wouldn't take. There is nothing to do about any of them but say so.
      say("The browser wouldn't put this on the clipboard");
    }
  };

  /** What right-clicking the picture offers, which is what anyone right-clicks one for. */
  const pictureMenu = (x: number, y: number) => {
    const file = current();
    if (!file) return;
    props.panes.menu(x, y, [
      { label: 'Copy Picture', disabled: !canCopy(), onSelect: () => void copyPicture() },
      { label: 'Save Picture to My Computer', onSelect: () => downloadFile(file) },
      { separator: true },
      {
        label: 'Make Desktop Background',
        disabled: isWallpaper(),
        onSelect: () => props.panes.setWallpaper(file.id),
      },
    ]);
  };

  /**
   * The menu bar, which offers what the bar along the bottom offers. Everything is in
   * both places on purpose: the buttons are quicker, and the menu is where you look
   * when you don't already know a picture viewer has them.
   */
  const menus = (): Menu[] => [
    {
      label: 'File',
      items: [
        { id: 'download', label: 'Download Picture', disabled: !current() },
        {
          id: 'wallpaper',
          label: 'Make Desktop Background',
          disabled: !current() || isWallpaper(),
        },
      ],
    },
    {
      // Where a picture viewer of the period kept its one and only edit.
      label: 'Edit',
      items: [
        { id: 'copy', label: 'Copy Picture', disabled: !current() || !canCopy() },
      ],
    },
    {
      label: 'View',
      items: [
        { id: 'prev', label: 'Previous Picture', disabled: pictures().length < 2 },
        { id: 'next', label: 'Next Picture', disabled: pictures().length < 2 },
        { separator: true },
        { id: 'zoom-in', label: 'Zoom In', disabled: !current() || !nextStop(1) },
        { id: 'zoom-out', label: 'Zoom Out', disabled: !current() || !nextStop(-1) },
        { separator: true },
        { id: 'fit', label: 'Fit to Window', disabled: !current() || zoom() === 'fit' },
        { id: 'actual', label: 'Actual Size', disabled: !current() || zoom() === 1 },
      ],
    },
  ];

  const onMenuSelect = (pick: string) => {
    if (pick === 'download') {
      const file = current();
      if (file) downloadFile(file);
    }
    else if (pick === 'copy') void copyPicture();
    else if (pick === 'wallpaper' && current()) props.panes.setWallpaper(id());
    else if (pick === 'prev') step(-1);
    else if (pick === 'next') step(1);
    else if (pick === 'zoom-in') stepZoom(1);
    else if (pick === 'zoom-out') stepZoom(-1);
    else if (pick === 'fit') setZoom('fit');
    else if (pick === 'actual') setZoom(1);

    // The menu bar lives in the window chrome, outside this pane, so picking something
    // off it leaves the keys with a menu button. Hand them back.
    frame.focus();
  };

  onMount(() => {
    props.onMenus(menus, onMenuSelect);

    // So the arrow keys work the moment the window opens.
    frame.focus();

    const watch = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    watch.observe(stage);
    onCleanup(() => watch.disconnect());
  });

  return (
    <div
      class="picture-pane"
      ref={frame}
      tabindex={0}
      autofocus
      onKeyDown={(e) => {
        // Left and right are the pictures either side; up and down move about the one
        // on screen. The stage is a child of the focused pane, so the browser would
        // never scroll it of its own accord — it gets moved by hand.
        if (e.key === 'ArrowRight') step(1);
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowDown') stage.scrollBy({ top: SCROLL_STEP });
        else if (e.key === 'ArrowUp') stage.scrollBy({ top: -SCROLL_STEP });
        else if (e.key === 'PageDown') stage.scrollBy({ top: stage.clientHeight * 0.9 });
        else if (e.key === 'PageUp') stage.scrollBy({ top: stage.clientHeight * -0.9 });
        else if (e.key === '+' || e.key === '=') stepZoom(1);
        else if (e.key === '-' || e.key === '_') stepZoom(-1);
        else if (e.key === '0') setZoom(zoom() === 'fit' ? 1 : 'fit');
        else return;
        // Otherwise the keys we just acted on would scroll the pane as well.
        e.preventDefault();
      }}
    >
      <div
        class="picture-stage"
        classList={{ 'can-pan': overflows(), 'is-panning': panning() }}
        ref={stage}
        onPointerDown={(e) => {
          // Clicking the picture hands the keys back to the pane, so left and right
          // keep walking the pictures after a click anywhere in here.
          frame.focus();
          beginPan(e);
        }}
        onPointerMove={pan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onContextMenu={(e) => {
          // The desktop behind this window would otherwise put up its own menu, and
          // right-clicking a picture is where anyone looks for copying and saving it.
          e.preventDefault();
          e.stopPropagation();
          pictureMenu(e.clientX, e.clientY);
        }}
        onWheel={(e) => {
          // Plain wheel scrolls the picture; held down, it zooms, as viewers do.
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          stepZoom(e.deltaY < 0 ? 1 : -1);
        }}
      >
        <Show
          when={current()}
          fallback={<p class="picture-gone">This picture isn't on the desktop any more.</p>}
        >
          {(file) => (
            <img
              ref={(el) => (shown = el)}
              src={file().url}
              alt={file().name}
              draggable={false}
              onLoad={(e) =>
                setNatural({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              // Until the size is known, letterbox it — one frame, and it can't overflow.
              style={
                natural()
                  ? {
                      // Floored, so a fitted picture can't round its way into a scrollbar.
                      width: `${Math.floor(natural()!.w * scale())}px`,
                      height: `${Math.floor(natural()!.h * scale())}px`,
                    }
                  : { 'max-width': '100%', 'max-height': '100%' }
              }
            />
          )}
        </Show>
      </div>

      <footer class="picture-bar">
        <button
          class="chrome-button"
          title="Previous picture"
          aria-disabled={pictures().length < 2}
          onClick={() => step(-1)}
        >
          <span aria-hidden="true">◀</span>
        </button>
        <button
          class="chrome-button"
          title="Next picture"
          aria-disabled={pictures().length < 2}
          onClick={() => step(1)}
        >
          <span aria-hidden="true">▶</span>
        </button>

        <span class="picture-zoom">
          <button
            class="chrome-button"
            title="Zoom out"
            aria-disabled={!current() || !nextStop(-1)}
            onClick={() => stepZoom(-1)}
          >
            <span aria-hidden="true">−</span>
          </button>
          <span class="picture-zoom-readout">{Math.round(scale() * 100)}%</span>
          <button
            class="chrome-button"
            title="Zoom in"
            aria-disabled={!current() || !nextStop(1)}
            onClick={() => stepZoom(1)}
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            class="chrome-button"
            title={
              zoom() === 'fit'
                ? 'Show every pixel, full size'
                : 'Shrink the whole picture into the window'
            }
            aria-disabled={!current()}
            onClick={() => setZoom(zoom() === 'fit' ? 1 : 'fit')}
          >
            {zoom() === 'fit' ? 'Actual Size' : 'Fit'}
          </button>
        </span>

        <span class="picture-status">
          {/* Whatever has just been done with the picture, in front of what it is. */}
          <Show when={note()}>{(what) => <>{what()} — </>}</Show>
          <Show when={current()} fallback="Gone">
            {(file) => (
              <>
                {/* Falls back to the size alone while the picture is off the desktop. */}
                <Show when={at() >= 0}>
                  Picture {at() + 1} of {pictures().length} —{' '}
                </Show>
                {/* The pixel size only turns up once the picture has decoded. */}
                <Show when={natural()}>
                  {(nat) => (
                    <>
                      {nat().w} × {nat().h} —{' '}
                    </>
                  )}
                </Show>
                {formatBytes(file().size)}
              </>
            )}
          </Show>
        </span>
      </footer>
    </div>
  );
}
