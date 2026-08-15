import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { TASKBAR_HEIGHT, type Panes, type WindowState } from './shell';
import { BinPane } from './BinPane';
import { SettingsPane } from './SettingsPane';
import { AboutPane } from './AboutPane';
import { embedUrl, resolve } from './toys';

type Props = {
  win: WindowState;
  active: boolean;
  panes: Panes;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (x: number, y: number, w: number, h: number) => void;
};

export const MIN_W = 240;
export const MIN_H = 160;

/** Resize grips: each letter is a compass edge the handle pulls. */
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Edge = (typeof EDGES)[number];

type Gesture = {
  edge: Edge | 'move';
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  py: number;
};

export function ToyWindow(props: Props) {
  // `interacting` covers both drag and resize: while either is live the iframe must
  // not swallow pointer events.
  const [interacting, setInteracting] = createSignal(false);
  let gesture: Gesture | null = null;

  const toy = () => (props.win.content.type === 'toy' ? props.win.content.toy : null);
  const binDepth = () =>
    props.win.content.type === 'bin' ? { depth: props.win.content.depth } : null;
  const src = () => {
    const t = toy();
    return t ? embedUrl(t.iframe ?? t.href ?? '') : '';
  };

  const maxBottom = () => window.innerHeight - TASKBAR_HEIGHT;

  // Pointer capture keeps move/up events on the grabbed element, so the iframe can
  // never steal them and there are no window-level listeners to clean up.
  const begin = (edge: Edge | 'move') => (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (props.win.maximized) return;
    if (edge === 'move' && (e.target as HTMLElement).closest('.title-actions')) return;
    e.stopPropagation();
    props.onFocus();
    gesture = {
      edge,
      x: props.win.x,
      y: props.win.y,
      w: props.win.w,
      h: props.win.h,
      px: e.clientX,
      py: e.clientY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setInteracting(true);
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture;
    if (!g) return;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;

    if (g.edge === 'move') {
      props.onMove(
        Math.max(0, Math.min(g.x + dx, Math.max(0, window.innerWidth - g.w))),
        Math.max(0, Math.min(g.y + dy, Math.max(0, maxBottom() - g.h))),
      );
      return;
    }

    let { x, y, w, h } = g;
    if (g.edge.includes('e')) w = g.w + dx;
    if (g.edge.includes('s')) h = g.h + dy;
    // Dragging a top/left edge moves the origin as well as the size.
    if (g.edge.includes('w')) {
      w = g.w - dx;
      x = g.x + dx;
    }
    if (g.edge.includes('n')) {
      h = g.h - dy;
      y = g.y + dy;
    }

    // Honour the minimum by pinning the edge that isn't being dragged.
    if (w < MIN_W) {
      if (g.edge.includes('w')) x = g.x + g.w - MIN_W;
      w = MIN_W;
    }
    if (h < MIN_H) {
      if (g.edge.includes('n')) y = g.y + g.h - MIN_H;
      h = MIN_H;
    }

    // Keep the window within the desktop.
    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }
    w = Math.max(MIN_W, Math.min(w, window.innerWidth - x));
    h = Math.max(MIN_H, Math.min(h, maxBottom() - y));

    props.onResize(x, y, w, h);
  };

  const end = () => {
    gesture = null;
    setInteracting(false);
  };

  const gestureHandlers = {
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
  };

  return (
    <section
      class="window"
      classList={{ 'is-active': props.active, 'is-maximized': props.win.maximized }}
      style={{
        'z-index': props.win.z,
        display: props.win.minimized ? 'none' : undefined,
        ...(props.win.maximized
          ? {}
          : {
              left: `${props.win.x}px`,
              top: `${props.win.y}px`,
              width: `${props.win.w}px`,
              height: `${props.win.h}px`,
            }),
      }}
      onPointerDown={props.onFocus}
    >
      <header
        class="title-bar"
        onPointerDown={begin('move')}
        {...gestureHandlers}
        onDblClick={props.onToggleMaximize}
      >
        <span class="title-text">{props.win.title}</span>
        <span class="title-actions">
          <Show when={toy()}>
            {(t) => (
              <button
                class="chrome-button"
                title="Open in a new tab"
                onClick={() => window.open(resolve(t().href ?? ''), '_blank', 'noopener')}
              >
                <span aria-hidden="true">↗</span>
              </button>
            )}
          </Show>
          <button class="chrome-button" title="Minimise" onClick={props.onMinimize}>
            <span aria-hidden="true">_</span>
          </button>
          <button
            class="chrome-button"
            title={props.win.maximized ? 'Restore' : 'Maximise'}
            onClick={props.onToggleMaximize}
          >
            <span aria-hidden="true">{props.win.maximized ? '❐' : '☐'}</span>
          </button>
          <button class="chrome-button" title="Close" onClick={props.onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </span>
      </header>

      <div class="window-body" classList={{ 'is-interacting': interacting() }}>
        <Switch>
          <Match when={props.win.content.type === 'toy'}>
            <iframe src={src()} title={props.win.title} />
          </Match>
          {/* Wrapped in an object because depth 0 is falsy and would never match. */}
          <Match when={binDepth()}>
            {(bin) => <BinPane depth={bin().depth} panes={props.panes} />}
          </Match>
          <Match when={props.win.content.type === 'settings'}>
            <SettingsPane panes={props.panes} />
          </Match>
          <Match when={props.win.content.type === 'about'}>
            <AboutPane panes={props.panes} />
          </Match>
        </Switch>
      </div>

      <For each={EDGES}>
        {(edge) => (
          <div
            class={`resize-handle ${edge}`}
            onPointerDown={begin(edge)}
            {...gestureHandlers}
          />
        )}
      </For>
    </section>
  );
}
