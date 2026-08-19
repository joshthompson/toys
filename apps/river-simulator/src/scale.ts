/**
 * How the grid relates to the world it represents.
 *
 * The landscape is a fixed patch of world — the same hills, valleys and coastline however
 * finely it is sampled. What a change of resolution alters is how much of that world one
 * cell covers, and every constant elsewhere that means a distance, a speed or a volume is
 * expressed through that. Without it, halving the cell size would quietly double the size
 * of the world instead: each slope would be half as steep from a cell's point of view, and
 * every basin would need several times more water to fill, so the rivers would pond where
 * they used to run.
 *
 * At the reference height a cell spans exactly one world unit, which is the case every
 * tuned constant in this app was chosen against.
 */

/**
 * Screen size of one altitude point, in CSS pixels — the resolution knob.
 *
 * Smaller means a finer grid for the same window: more detail, thinner rivers, more work
 * per frame. The cost grows as the square, so going from 5 to 3 nearly triples the number
 * of cells. It does not change the landscape or how the water behaves, only how finely
 * both are resolved, which is what the rest of this file is for.
 */
export const CELL = 3;

/** Grid height at which one cell is one world unit. */
export const REFERENCE_ROWS = 152;

/** World units across one cell, for a grid this tall. */
export const cellSize = (rows: number) => REFERENCE_ROWS / rows;
