import type { Point } from '../os/shell';

/**
 * Walking the keyboard between icons.
 *
 * Icons don't sit on a grid — they sit wherever they were dropped — so there is no row
 * to step along and no next-one-over to step to. What there is is a direction and a
 * pile of positions, and the icon this picks is the one that is most nearly that way:
 * nearest along the way you pressed, with drift to either side counting against it.
 * That is enough for a tidy grid to behave like a grid, and for a scattered desktop to
 * behave sensibly rather than not at all.
 */

/** Which way each arrow key points, in screen coordinates. */
const WAYS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** How much harder drift sideways counts than distance the way you were going. */
const DRIFT = 3;

/** Anywhere icons live and can be walked between: the desktop, or a folder window. */
const AREAS = '.desktop-icons, .folder-items';

/** Only settled icons — one being renamed is a text field, and takes the arrows itself. */
const ICONS = 'button.icon';

export const arrows = (key: string) => key in WAYS;

const centre = (el: Element) => {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

/**
 * Hand the keyboard to the nearest icon `key` points at, within whichever area the one
 * you are on belongs to. Nothing that way means nothing happens: the edge of the desktop
 * is the edge of the desktop.
 */
export function step(from: HTMLElement, key: string) {
  const way = WAYS[key];
  const area = from.closest<HTMLElement>(AREAS);
  if (!way || !area) return false;

  const here = centre(from);
  let best: { icon: HTMLElement; score: number } | null = null;
  for (const icon of area.querySelectorAll<HTMLElement>(ICONS)) {
    if (icon === from) continue;
    const there = centre(icon);
    const dx = there.x - here.x;
    const dy = there.y - here.y;
    const along = dx * way.x + dy * way.y;
    const drift = Math.abs(dx * way.y + dy * way.x);
    if (along <= 0) continue;
    const score = along + drift * DRIFT;
    if (!best || score < best.score) best = { icon, score };
  }

  best?.icon.focus();
  return !!best;
}

/**
 * The first press, where nothing is focused for a key to land on — after a rubber band,
 * or on a desktop nobody has touched yet. The keyboard goes to whatever is picked out,
 * or failing that to the first icon there is.
 */
export function enter(area: HTMLElement | null | undefined) {
  const icon =
    area?.querySelector<HTMLElement>(`${ICONS}.is-selected`) ??
    area?.querySelector<HTMLElement>(ICONS);
  icon?.focus();
  return !!icon;
}
