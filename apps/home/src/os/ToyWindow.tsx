import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { TASKBAR_HEIGHT, type Panes, type WindowState } from './shell';
import { BinPane } from '../apps/BinPane';
import { SettingsPane } from '../apps/SettingsPane';
import { AboutPane } from '../apps/AboutPane';
import { MathsPane } from '../apps/MathsPane';
import { BankPane } from '../apps/BankPane';
import { RunPane } from '../apps/RunPane';
import { FolderPane } from '../apps/FolderPane';
import { PickerPane } from '../apps/PickerPane';
import { CameraPane } from '../apps/CameraPane';
import { PicturePane } from '../apps/PicturePane';
import { WritingPane } from '../apps/WritingPane';
import { AudioPane } from '../apps/AudioPane';
import { VideoPane } from '../apps/VideoPane';
import { NoticePane } from '../apps/NoticePane';
import { TextPane } from '../apps/TextPane';
import { MenuBar } from './MenuBar';
import { envelope, parseFromApp, type FromOs, type Menu, type MenuItem } from './osApi';
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
  /** For the picture viewer, whose window is named after whichever picture it's on. */
  onRetitle: (title: string) => void;
  /** A folder window that has been navigated somewhere else, so the OS knows where. */
  onShowFolder: (folderId: string) => void;
};

/** How long the shake runs for. Kept in step with the keyframes in styles.css. */
const NUDGE_MS = 350;

export const MIN_W = 240;
export const MIN_H = 160;

/**
 * The menu the OS puts on the end of the bar itself, for any app that draws one. An
 * app never sees these picked — they're the window's own business, not its.
 */
const OS_ITEM = { newTab: 'os:new-tab', minimise: 'os:minimise', maximise: 'os:maximise', close: 'os:close' };

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
  const [nudging, setNudging] = createSignal(false);
  let shake: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(shake));
  let gesture: Gesture | null = null;

  const toy = () => (props.win.content.type === 'toy' ? props.win.content.toy : null);
  const binDepth = () =>
    props.win.content.type === 'bin' ? { depth: props.win.content.depth } : null;
  /** The file a picture, writing or media window is looking at. */
  // Writing is not in here: it is the one file window whose file can be missing, so
  // naming it alongside these would make every file id in the union optional.
  const fileWindow = (type: 'picture' | 'audio' | 'video') =>
    props.win.content.type === type ? { id: props.win.content.fileId } : null;
  const notice = () => (props.win.content.type === 'notice' ? props.win.content.body : null);
  /** Wrapped because the flag is false for the ordinary calculator, which is not nothing. */
  const maths = () =>
    props.win.content.type === 'maths' ? { rival: props.win.content.rival === true } : null;
  const text = () => (props.win.content.type === 'text' ? props.win.content.body : null);
  const src = () => {
    const t = toy();
    return t ? embedUrl(t.iframe ?? t.href ?? '') : '';
  };

  /** Whatever menus the framed app has asked for. Empty until it asks, if it ever does. */
  const [appMenus, setAppMenus] = createSignal<Menu[]>([]);
  /**
   * The same thing for a pane the OS draws itself, which has no postMessage to send and
   * no need of one: it hands over an accessor, so its menus stay live as its state moves.
   */
  const [paneMenus, setPaneMenus] = createSignal<{
    menus: () => Menu[];
    select: (id: string) => void;
  }>();
  let frame: HTMLIFrameElement | undefined;
  let body: HTMLDivElement | undefined;

  /**
   * The window's own menu, which an app gets for free the moment it draws a bar. There's
   * no point offering it to an app that has no bar to hang it on, so a toy that never
   * sends menus keeps its window exactly as bare as it was.
   */
  const windowMenu = (): Menu => ({
    label: 'Window',
    items: [
      // Only a framed toy is hosted anywhere else to be opened.
      ...(toy()
        ? ([{ id: OS_ITEM.newTab, label: 'Open in New Tab' }, { separator: true }] as MenuItem[])
        : []),
      { id: OS_ITEM.minimise, label: 'Minimise' },
      { id: OS_ITEM.maximise, label: props.win.maximized ? 'Restore' : 'Maximise' },
      { separator: true },
      { id: OS_ITEM.close, label: 'Close' },
    ],
  });

  /** What the bar draws: whatever is inside this window, and then the window's own. */
  const menus = () => {
    const inside = paneMenus()?.menus() ?? appMenus();
    return inside.length ? [...inside, windowMenu()] : [];
  };

  /**
   * Where the framed app lives. Naming the origin rather than posting to '*' keeps the
   * message to the toy we framed, even if it has since navigated somewhere else.
   */
  const appOrigin = () => {
    try {
      return new URL(src(), location.href).origin;
    } catch {
      return null;
    }
  };

  const post = (message: FromOs) => {
    const to = appOrigin();
    if (to) frame?.contentWindow?.postMessage(envelope(message), to);
  };

  const onMenuPick = (id: string) => {
    if (id === OS_ITEM.newTab) window.open(resolve(toy()?.href ?? ''), '_blank', 'noopener');
    else if (id === OS_ITEM.minimise) props.onMinimize();
    else if (id === OS_ITEM.maximise) props.onToggleMaximize();
    else if (id === OS_ITEM.close) props.onClose();
    // Anything else belongs to whatever is inside the window, which named it and knows
    // what it meant. A framed app gets its focus back on the way out: picking New Game
    // off a menu and then finding the arrow keys aren't the game's any more would be
    // its own small insult.
    else if (paneMenus()) paneMenus()!.select(id);
    else {
      post({ type: 'menu', id });
      frame?.focus();
    }
  };

  /**
   * The old messenger nudge: the window comes to the front, takes the keyboard, and
   * shakes on the spot.
   *
   * An app inside a window has no way to raise its own window and no business knowing
   * how — it can only say that something has happened in here worth looking at, which
   * is what this is. Everything after that is the window's own doing.
   */
  const nudge = () => {
    props.onFocus();
    // A frame with the class off first, or an animation already running simply carries
    // on from where it was — which is no nudge at all when one arrives on top of another.
    setNudging(false);
    clearTimeout(shake);
    requestAnimationFrame(() => {
      setNudging(true);
      shake = setTimeout(() => setNudging(false), NUDGE_MS);
    });
  };

  /**
   * Where the keyboard goes when this window opens, or comes back to the front.
   *
   * A pane that wants the keys says so with `autofocus` on the very element listening
   * for them: a keypress lands on whatever is focused and travels up from there, so
   * focusing the window around a pane would leave the pane hearing nothing at all. A
   * framed toy gets the frame, and a window with nothing to focus gets its own body,
   * which is enough for the desktop's own shortcuts to go on working.
   */
  const takeKeys = () => {
    if (!body) return;
    // Something in here has it already — whatever the pointer landed on has the better
    // claim, and this window is not going to argue with the click that raised it.
    if (body.contains(document.activeElement)) return;
    (body.querySelector<HTMLElement>('[autofocus]') ?? frame ?? body).focus({
      preventScroll: true,
    });
  };

  /**
   * Coming to the front is the moment the keyboard changes hands, which covers opening,
   * being clicked on, and coming back off the taskbar alike.
   *
   * A frame later, so that the click doing the raising has had its say first: the
   * browser moves focus on the way out of a pointerdown, after this has already run,
   * and a window that grabbed the keyboard on the way in would only have it taken off
   * it again by the same click.
   */
  createEffect(() => {
    if (!props.active) return;
    const soon = requestAnimationFrame(takeKeys);
    onCleanup(() => cancelAnimationFrame(soon));
  });

  // The app's side of the conversation. Matching the source window is what makes this
  // safe: every window on the desktop hears every message, and only the one that framed
  // this app will recognise it as its own.
  onMount(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const message = parseFromApp(e.data);
      if (!message) return;

      switch (message.type) {
        case 'ready':
          post({ type: 'hello', version: 1, title: props.win.title });
          break;
        case 'menus':
          setAppMenus(message.menus);
          break;
        case 'text':
          props.panes.showText(message.title, message.body);
          break;
        case 'title':
          props.onRetitle(message.title);
          break;
        case 'save':
          props.panes.saveToDesktop(message.name, message.blob);
          break;
      }
    };

    window.addEventListener('message', onMessage);
    onCleanup(() => window.removeEventListener('message', onMessage));
  });

  const maxBottom = () => window.innerHeight - TASKBAR_HEIGHT;

  /**
   * Give whatever is inside the window the room it has asked for.
   *
   * The chrome is measured rather than assumed — a title bar, a menu bar that may or
   * may not be there, two borders and a margin — because the difference between the
   * window and the body inside it is exactly that, and it changes per window. The
   * result still has to fit on the desktop and stay on it, so it's clamped both ways.
   */
  const sizeBodyTo = (w: number, h: number) => {
    if (props.win.maximized || !body) return;
    const chromeW = props.win.w - body.clientWidth;
    const chromeH = props.win.h - body.clientHeight;

    const width = Math.max(MIN_W, Math.min(w + chromeW, window.innerWidth - 16));
    const height = Math.max(MIN_H, Math.min(h + chromeH, maxBottom() - 16));
    props.onResize(
      Math.max(0, Math.min(props.win.x, window.innerWidth - width)),
      Math.max(0, Math.min(props.win.y, maxBottom() - height)),
      width,
      height,
    );
  };

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
      classList={{
        'is-active': props.active,
        'is-maximized': props.win.maximized,
        // The red one, which the whole window wears rather than only its pane.
        'is-rival': maths()?.rival === true,
        'is-nudging': nudging(),
      }}
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

      <Show when={menus().length}>
        <MenuBar menus={menus()} onSelect={onMenuPick} />
      </Show>

      {/* -1 so the window can be handed the keys without joining the tab order. */}
      <div
        class="window-body"
        ref={body}
        tabindex={-1}
        classList={{ 'is-interacting': interacting() }}
      >
        <Switch>
          <Match when={props.win.content.type === 'toy'}>
            <iframe ref={frame} src={src()} title={props.win.title} />
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
          <Match when={props.win.content.type === 'camera'}>
            <CameraPane panes={props.panes} />
          </Match>
          {/* Wrapped, so the red one and the ordinary one are told apart. */}
          <Match when={maths()}>
            {(app) => <MathsPane panes={props.panes} rival={app().rival} nudge={nudge} />}
          </Match>
          <Match when={props.win.content.type === 'bank'}>
            <BankPane panes={props.panes} />
          </Match>
          <Match when={props.win.content.type === 'run'}>
            <RunPane panes={props.panes} onClose={props.onClose} />
          </Match>
          <Match when={props.win.content.type === 'folder' && props.win.content}>
            {(folder) => (
              <FolderPane
                folderId={folder().folderId}
                panes={props.panes}
                onTitle={props.onRetitle}
                onShow={props.onShowFolder}
              />
            )}
          </Match>
          <Match when={props.win.content.type === 'picker'}>
            <PickerPane panes={props.panes} />
          </Match>
          {/* Wrapped for the same reason as the bin: the payload has to be truthy. */}
          <Match when={fileWindow('picture')}>
            {(file) => (
              <PicturePane
                fileId={file().id}
                panes={props.panes}
                onTitle={props.onRetitle}
                onMenus={(menus, select) => setPaneMenus({ menus, select })}
              />
            )}
          </Match>
          {/* Not fileWindow: this is the one file window that can have no file. */}
          <Match when={props.win.content.type === 'writing' && props.win.content}>
            {(doc) => (
              <WritingPane
                fileId={doc().fileId}
                panes={props.panes}
                onTitle={props.onRetitle}
                onMenus={(menus, select) => setPaneMenus({ menus, select })}
              />
            )}
          </Match>
          <Match when={fileWindow('audio')}>
            {(file) => (
              <AudioPane
                fileId={file().id}
                panes={props.panes}
                onTitle={props.onRetitle}
                onMenus={(menus, select) => setPaneMenus({ menus, select })}
              />
            )}
          </Match>
          <Match when={fileWindow('video')}>
            {(file) => (
              <VideoPane
                fileId={file().id}
                panes={props.panes}
                onTitle={props.onRetitle}
                onMenus={(menus, select) => setPaneMenus({ menus, select })}
                onSizeToContent={sizeBodyTo}
              />
            )}
          </Match>
          <Match when={notice()}>{(body) => <NoticePane body={body()} />}</Match>
          <Match when={text()}>
            {(body) => <TextPane body={body()} onClose={props.onClose} />}
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
