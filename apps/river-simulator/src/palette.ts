/**
 * Colour for one altitude point. Shared by the on-screen renderer and by the
 * offline probes, so what a test dumps to a PNG is what the app draws.
 */

/** Altitude of the highest ground the palette covers. */
const PEAK = 54;
/** Depth at which the sea reaches its darkest colour. */
const ABYSS = 70;

/** Flow speed at which white water starts to show, how fast it builds, and its cap. */
const FOAM_FROM = 2.2;
const FOAM_GAIN = 0.1;
const FOAM_MAX = 0.45;

type Stop = [at: number, r: number, g: number, b: number];

/** Land colours by altitude: shoreline sand up through grass, rock and snow. */
const LAND: Stop[] = [
  [0, 214, 199, 156],
  [1.4, 199, 187, 141],
  [3.2, 133, 158, 96],
  [11, 86, 126, 71],
  [21, 74, 104, 66],
  [32, 108, 100, 80],
  [42, 138, 134, 128],
  [50, 196, 198, 200],
  [PEAK, 238, 243, 247],
];

/**
 * A dam, drawn as built stone rather than as the heap of earth the altitude ramp would make of
 * it. A wall the player put there by hand should be obvious at a glance, and reading it off the
 * erosion resistance means the colour marks exactly the part that is actually holding.
 */
const DAM_BASE: Stop = [0, 92, 88, 84];
const DAM_CREST: Stop = [1, 196, 192, 184];

/** Sea colours by depth. */
const SEA: Stop[] = [
  [0, 132, 190, 204],
  [2, 100, 166, 192],
  [8, 62, 128, 172],
  [22, 38, 90, 144],
  [42, 22, 58, 108],
  [ABYSS, 10, 28, 64],
];

const ramp = (stops: Stop[], at: number, out: Float32Array) => {
  let n = 1;
  while (n < stops.length - 1 && at > stops[n]![0]) n++;
  const a = stops[n - 1]!;
  const b = stops[n]!;
  const span = b[0] - a[0];
  const t = span > 0 ? Math.max(0, Math.min(1, (at - a[0]) / span)) : 0;
  out[0] = a[1] + (b[1] - a[1]) * t;
  out[1] = a[2] + (b[2] - a[2]) * t;
  out[2] = a[3] + (b[3] - a[3]) * t;
};

export type Field = {
  cols: number;
  rows: number;
  land: Float32Array;
  water: Float32Array;
  /** How protected each cell is from erosion — which in practice means: is it a dam. */
  armour: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
};

/**
 * Water depth for drawing, averaged with the four neighbours.
 *
 * The flow solver leaves the depth slightly uneven from cell to cell, which at one
 * pixel per cell reads as speckle rather than as a river. Smoothing the depth for
 * display only — the simulation still sees its own numbers — settles that down and
 * softens the river's edges into something closer to a bank.
 */
const smoothDepth = (f: Field, i: number) => {
  const x = i % f.cols;
  const y = (i - x) / f.cols;
  const w = f.water;
  let sum = w[i]! * 4;
  let weight = 4;
  if (x > 0) { sum += w[i - 1]!; weight++; }
  if (x < f.cols - 1) { sum += w[i + 1]!; weight++; }
  if (y > 0) { sum += w[i - f.cols]!; weight++; }
  if (y < f.rows - 1) { sum += w[i + f.cols]!; weight++; }
  return sum / weight;
};

/** Write the RGB for cell `i` into `out` as three 0-255 components. */
export const paint = (f: Field, i: number, out: Float32Array) => {
  const h = f.land[i]!;

  if (h <= 0) {
    // Sea: anything at or below sea level, shaded by how deep it is.
    ramp(SEA, -h, out);
    return;
  }

  ramp(LAND, h, out);

  // Hillshade from the north-west. Without it the height ramp alone reads flat,
  // and the valleys the water cuts are hard to make out.
  const west = i % f.cols > 0 ? f.land[i - 1]! : h;
  const north = i >= f.cols ? f.land[i - f.cols]! : h;
  const shade = Math.max(0.45, Math.min(1.45, 1 + (h - west + h - north) * 0.09));
  out[0] *= shade;
  out[1] *= shade;
  out[2] *= shade;

  const built = f.armour[i]!;
  if (built > 0.02) {
    const t = Math.min(1, built);
    const blend = Math.min(1, built * 1.7);
    out[0] += (DAM_BASE[1] + (DAM_CREST[1] - DAM_BASE[1]) * t - out[0]!) * blend;
    out[1] += (DAM_BASE[2] + (DAM_CREST[2] - DAM_BASE[2]) * t - out[1]!) * blend;
    out[2] += (DAM_BASE[3] + (DAM_CREST[3] - DAM_BASE[3]) * t - out[2]!) * blend;
  }

  const depth = smoothDepth(f, i);
  if (depth > 0.015) {
    // River and lake water over the bed: shallow water lets the bed show through, deep
    // water hides it. Both ends of the ramp stay properly blue, or a river reads as a
    // grey smear over the grass rather than as water.
    //
    // The opacity has to start from nothing rather than from some minimum. A river
    // spills a lot of very thin water across its floodplain, which is real enough, but
    // given any floor at all it paints as though the whole valley were a lake.
    const t = Math.min(1, depth / 1.4);
    const alpha = Math.min(0.94, depth * 2.4);
    out[0] += (74 + (22 - 74) * t - out[0]!) * alpha;
    out[1] += (150 + (66 - 150) * t - out[1]!) * alpha;
    out[2] += (196 + (128 - 196) * t - out[2]!) * alpha;

    // A wash of white on the fastest water only. This is what makes the speed
    // difference between the outside and the inside of a bend visible, so it has to
    // stay subtle — turn it up and every river just reads as white.
    const vx = f.vx[i]!;
    const vy = f.vy[i]!;
    const foam = Math.min(FOAM_MAX, Math.max(0, (Math.sqrt(vx * vx + vy * vy) - FOAM_FROM) * FOAM_GAIN));
    if (foam > 0) {
      out[0] += (238 - out[0]!) * foam;
      out[1] += (246 - out[1]!) * foam;
      out[2] += (252 - out[2]!) * foam;
    }
  }
};
