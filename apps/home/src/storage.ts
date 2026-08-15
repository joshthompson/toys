/**
 * The bits of the desktop that outlive a reload: where the icons sit, what's been
 * binned or emptied, and the wallpaper colour. Everything else — open windows, the
 * current selection — is session state and comes back fresh on restart.
 */
import type { Point } from './shell';

const KEY = 'josh-os';

/** Icons move on every pointer frame; batch the writes rather than hitting storage per frame. */
const DEBOUNCE_MS = 250;

export type Saved = {
  positions: Record<string, Point>;
  bins: { toys: string[] }[];
  purged: string[];
  colour: string;
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
