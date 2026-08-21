import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { formatBytes } from './files';
import type { Menu } from './osApi';
import { IMAGE_APP, type Panes } from './shell';

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
  let frame!: HTMLDivElement;
  let stage!: HTMLDivElement;


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

  /**
   * Save the picture onto the computer this desktop is pretending to be. The blob URL
   * is already sitting on the file, so this is a link and a click — built here and
   * thrown away, since nothing on screen needs to be a link. Firefox only follows the
   * click of an anchor that's in the document, hence the visit.
   */
  const download = () => {
    const file = current();
    if (!file) return;
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
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
    if (pick === 'download') download();
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
