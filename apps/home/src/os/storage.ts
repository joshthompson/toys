/**
 * The bits of the desktop that outlive a reload: where the icons sit, what's been
 * binned or emptied, and the desktop settings. Everything else — open windows, the
 * current selection — is session state and comes back fresh on restart.
 *
 * Dropped files are the exception: they'd eat the whole localStorage quota, so their
 * contents live in IndexedDB (see ./files) and only their positions are kept here.
 */
import type { Folder, IconSize, Point, Transaction } from './shell';

const KEY = 'josh-os';

/** Icons move on every pointer frame; batch the writes rather than hitting storage per frame. */
const DEBOUNCE_MS = 250;

export type Saved = {
  positions: Record<string, Point>;
  /**
   * Binned toys by name and binned files by id. Old saves have no `files`, so it's
   * optional on the way in — everything here is treated as missing-until-proven.
   */
  bins: { toys: string[]; files?: string[] }[];
  purged: string[];
  colour: string;
  /** The id of the file tiled across the desktop, or null for the plain colour. */
  wallpaper: string | null;
  iconSize: IconSize;
  /** A screensaver id, or NO_SCREENSAVER. Validated against the registry on the way in. */
  screensaver: string;
  /**
   * Whether these positions were laid out with the apps and the files as two groups.
   * A desktop saved before that was a thing has icons in a single run, and no amount of
   * grouping in the layout will show through positions that were saved over it — so a
   * save without this gets one re-flow to bring it into line, and then says so here.
   */
  grouped: boolean;
  /**
   * The bank's ledger. Money is the one thing on this desktop that would be genuinely
   * annoying to lose on a reload, joke money or not.
   */
  bank: Transaction[];
  /**
   * Whether those amounts are in moneys. They were briefly kept in cents of a currency
   * this computer no longer recognises, and a save from then is worth a hundred times
   * what it says it is — so one without this flag is converted on the way in, and then
   * says so here. The same trick as `grouped` above, for the same reason.
   */
  moneys: boolean;
  /** The folders, and which folder each thing is in. Absent means out on the desktop. */
  folders: Folder[];
  inside: Record<string, string>;
  /**
   * Whether the account has been opened. Opening it is the one and only time money
   * goes in, so a save without this gets its hundred and then says so — otherwise
   * every reload would be payday, and the whole point of the account is that it isn't.
   */
  opened: boolean;
};

/** Whatever was saved last, or nothing at all — every field is treated as optional on the way in. */
export const load = (): Partial<Saved> => {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    // Storage disabled, quota gone, or a half-written blob: boot from defaults.
    return {};
  }
};

let pending: ReturnType<typeof setTimeout> | undefined;

export const save = (state: Saved) => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Nothing to do — the desktop just won't survive the reload.
    }
  }, DEBOUNCE_MS);
};

/** Factory reset. Cancels any debounced write, which would otherwise land after the wipe. */
export const clear = () => {
  clearTimeout(pending);
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Already gone as far as we're concerned.
  }
};
