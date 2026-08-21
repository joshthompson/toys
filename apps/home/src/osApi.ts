/**
 * The protocol between Josh OS and the apps it frames.
 *
 * A toy is an iframe from wherever it happens to be hosted, so the only way in or out
 * is postMessage. This is both ends of that conversation: the shape of the messages,
 * and the parsing that makes an app's word safe to act on.
 *
 * Everything an app sends arrives from another origin, which is to say from something
 * this repo doesn't control. Nothing here trusts a field's existence, its type, or its
 * size — a menu with ten thousand items is a bug at worst and mischief at best, and
 * either way it isn't drawing a menu bar taller than the desktop.
 */

/** Stamped on every message in both directions, so other traffic on the window is ignored. */
export const OS_PROTOCOL = 'josh-os';
export const OS_VERSION = 1;

/** One line in a menu. A separator is a rule between groups, not something to pick. */
export type MenuItem = { separator: true } | { id: string; label: string; disabled?: boolean };

/** One heading in the bar — File, Help — with everything that drops down from it. */
export type Menu = { label: string; items: MenuItem[] };

/** What an app can say to the OS. */
export type FromApp =
  /** "I'm here" — answered with `hello`, for an app that wants to know it's framed. */
  | { type: 'ready' }
  /** The menu bar to draw for this app. Sending it again replaces the lot. */
  | { type: 'menus'; menus: Menu[] }
  /** Open one of the OS's own text windows: the rules, an about box, credits. */
  | { type: 'text'; title: string; body: string }
  /** Rename the window this app is sitting in. */
  | { type: 'title'; title: string }
  /**
   * Put a file on the desktop, as though it had been dropped there. The blob travels
   * as itself — structured clone carries one across origins, so there's no need for an
   * app to base64 a picture into a string and no 33% to pay for doing it.
   */
  | { type: 'save'; name: string; blob: Blob };

/** What the OS says back. */
export type FromOs =
  /** `maxFileBytes` is there so an app can size what it saves before it sends it. */
  | { type: 'hello'; version: number; title: string; maxFileBytes: number }
  /** Somebody picked one of the app's own menu items. */
  | { type: 'menu'; id: string };

/** Nothing an app sends is drawn or stored beyond these. */
const MAX_MENUS = 8;
const MAX_ITEMS = 32;
const MAX_LABEL = 48;
const MAX_ID = 64;
const MAX_TITLE = 80;
const MAX_BODY = 20_000;
const MAX_NAME = 64;

/** The string, trimmed to length, or nothing if it wasn't a usable string at all. */
const text = (value: unknown, limit: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
};

/**
 * A name fit to sit under an icon. The file itself goes into IndexedDB under an id the
 * desktop generates, so this never reaches a filesystem — but a name is a label, not a
 * path, so anything that looks like one loses everything up to its last slash, and the
 * control characters that would break the label go with it.
 */
const fileName = (value: unknown) => {
  const raw = text(value, MAX_NAME * 4);
  if (!raw) return null;
  const cleaned = raw
    .split(/[/\\]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  // A run of dots names a directory rather than a file, whatever else it looks like.
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : null;
};

const parseItem = (value: unknown): MenuItem | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.separator === true) return { separator: true };

  const id = text(raw.id, MAX_ID);
  const label = text(raw.label, MAX_LABEL);
  // An item with nothing to say, or no way to say who picked it, isn't an item.
  if (!id || !label) return null;
  return { id, label, disabled: raw.disabled === true };
};

const parseMenu = (value: unknown): Menu | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const label = text(raw.label, MAX_LABEL);
  if (!label || !Array.isArray(raw.items)) return null;

  const items = raw.items.slice(0, MAX_ITEMS).map(parseItem).filter((i): i is MenuItem => !!i);
  // A heading that drops nothing down is a dead end on the bar.
  if (!items.length) return null;
  return { label, items };
};

/**
 * Read a message posted by a framed app, or null for anything that isn't one — other
 * libraries' traffic, an older protocol, a malformed payload.
 */
export function parseFromApp(data: unknown): FromApp | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw.protocol !== OS_PROTOCOL || raw.version !== OS_VERSION) return null;

  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };

    case 'menus': {
      if (!Array.isArray(raw.menus)) return null;
      const menus = raw.menus.slice(0, MAX_MENUS).map(parseMenu).filter((m): m is Menu => !!m);
      // An empty list is a legitimate message: it takes the menu bar away again.
      return { type: 'menus', menus };
    }

    case 'text': {
      const body = text(raw.body, MAX_BODY);
      if (!body) return null;
      return { type: 'text', title: text(raw.title, MAX_TITLE) ?? 'About', body };
    }

    case 'title': {
      const title = text(raw.title, MAX_TITLE);
      return title ? { type: 'title', title } : null;
    }

    case 'save': {
      // Not sized here: the desktop has one limit for everything that lands on it, and
      // one message telling you the file was too big.
      if (!(raw.blob instanceof Blob)) return null;
      const name = fileName(raw.name);
      return name ? { type: 'save', name, blob: raw.blob } : null;
    }

    default:
      return null;
  }
}

/** The envelope both ends check for. */
export const envelope = <T extends object>(message: T) => ({
  protocol: OS_PROTOCOL,
  version: OS_VERSION,
  ...message,
});
