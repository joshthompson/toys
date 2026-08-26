/**
 * Talking to Josh OS.
 *
 * The desktop frames this toy in a window, flags it with `#embedded` on the URL, and
 * then talks postMessage: the toy hands over a menu bar to draw, hears back when
 * something is picked off it, and can put a file on the desktop.
 *
 * Opened on its own none of it applies — `embedded()` is false, every call below turns
 * into nothing, and the simulator runs exactly as it did before.
 *
 * The protocol itself is written down in the desktop's apps/home/src/osApi.ts. Each toy
 * keeps its own small client rather than importing that one, because most of them live
 * in repos of their own and none of them should need a build step to be framed.
 */

const PROTOCOL = 'josh-os';
const VERSION = 1;

/** One line in a menu. A separator is a rule between groups, not something to pick. */
export type MenuItem = { separator: true } | { id: string; label: string; disabled?: boolean };

/** One heading in the bar — File, Help — with everything that drops down from it. */
export type Menu = { label: string; items: MenuItem[] };

/** In a Josh OS window? The parent check is what stops a hand-typed hash counting. */
export const embedded = () => window.location.hash === '#embedded' && window.parent !== window;

const send = (message: object) => {
  if (!embedded()) return;
  // '*' because a toy has no business knowing which host framed it, and there is
  // nothing in any of these messages that isn't already on screen.
  window.parent.postMessage({ protocol: PROTOCOL, version: VERSION, ...message }, '*');
};

const listen = (handle: (data: Record<string, unknown>) => void) => {
  if (!embedded()) return;
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.protocol !== PROTOCOL || data.version !== VERSION) return;
    handle(data);
  });
};

/** Hand the OS a menu bar to draw. Sending again replaces whatever was there. */
export const setMenus = (menus: Menu[]) => send({ type: 'menus', menus });

/** Put a file on the desktop, as though it had been dropped there. */
export const saveToDesktop = (name: string, blob: Blob) => send({ type: 'save', name, blob });

/** Called with the id of whichever menu item was picked, for as long as the toy runs. */
export const onMenu = (handler: (id: string) => void) => {
  listen(data => {
    if (data.type === 'menu' && typeof data.id === 'string') handler(data.id);
  });
};

// Say hello on the way up, so the desktop knows there's something in here listening.
send({ type: 'ready' });
