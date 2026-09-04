import type { Point } from '../os/shell';

/** A rectangle, in whatever coordinates the thing drawing it is working in. */
export type Box = { x: number; y: number; w: number; h: number };

/** The rectangle between two points, whichever way round they were made. */
export const between = (from: Point, to: Point): Box => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  w: Math.abs(to.x - from.x),
  h: Math.abs(to.y - from.y),
});

/**
 * Does a rubber band touch an icon standing at `at`?
 *
 * An icon's box is one slot from its top-left, and both the band and the position are
 * in the same coordinates as each other — the desktop works in the viewport's, a folder
 * window in its own — so this doesn't care which, only that they agree.
 */
export const overlaps = (box: Box, at: Point | undefined, slot: { w: number; h: number }) =>
  !!at && box.x < at.x + slot.w && box.x + box.w > at.x && box.y < at.y + slot.h && box.y + box.h > at.y;
