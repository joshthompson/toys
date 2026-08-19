import { carveDrainage } from './drainage';

/**
 * Landscape generation.
 *
 * Altitude is in arbitrary "height units" where 0 is sea level. Mountains top out around 70
 * and the sea floor drops to roughly -70.
 *
 * The shape of the land is built around one field: how far each point is from the sea. The
 * seed decides which edges of the map the sea comes in from — one side, two, three, or all
 * four for an island — and everything else follows from the distance to the nearest of them.
 * Ground rises the further inland it is, so rivers run towards the nearest coast whichever way
 * that happens to be, and the coastal plain wraps around the shoreline rather than sitting in
 * a band across the bottom.
 */

/** Altitude added by the noise field, i.e. how tall the hills get. */
const RELIEF = 50;
/** Extra height at the point furthest inland, which is what makes the water run to the sea. */
const TILT = 34;
/** How far the sea floor falls once past the shoreline. */
const SEA_FLOOR = 80;
/**
 * How far inland the coast sits, as a fraction of the way to the furthest inland point.
 *
 * Kept well clear of the edge so there is a decent band of open sea on screen, with the
 * readout along the bottom sitting over water rather than over the coastline.
 */
const SHORE = 0.25;
/** How far past the shoreline the sea bed keeps dropping. */
const SHELF = 0.2;
/**
 * How far the coast wanders in and out from where the geometry would put it.
 *
 * Distance to the nearest edge has square level sets, so on its own it produces a coastline of
 * straight lines meeting at corners — a landmass like a cushion. Displacing the distance itself
 * rather than only the waterline means the plain and the hills follow the coast's real shape,
 * and the whole landmass comes out an organic one. The slow term makes bays and headlands, the
 * quick one a ragged edge.
 */
const COAST_WANDER = 0.5;
const COAST_WANDER_FREQ = 1.4;
const COAST_RAGGED = 0.08;
const COAST_RAGGED_FREQ = 2.2;
/** How much the corners of the landmass are rounded off. */
const CORNER_ROUND = 0.45;
/**
 * How far inland the coastal plain reaches, and where it has become hills.
 *
 * The land is deliberately steep well inland and nearly flat near the sea. Rivers cut straight
 * down through a steep slope; it takes a flat alluvial plain for one to wander sideways, so
 * meanders and oxbow lakes need somewhere like this to form.
 */
const PLAIN_EDGE = 0.26;
const PLAIN_INLAND = 0.58;
/** Share of the hill relief that survives out on the plain. */
const PLAIN_RELIEF = 0.24;
/**
 * Shape of the rise from the coast to the far inland.
 *
 * Above 1 the land is steep inland and gentle near the sea, which is the profile wanted:
 * torrents in the hills, a slack river on the plain. It cannot go far above 1 though —
 * flatten the plain too much and the rivers stop being rivers, spreading into braided sheets
 * a couple of cells deep instead of holding to a channel.
 */
const FALL_SHAPE = 1.3;

/** The four edges the sea can come in from. */
const TOP = 1;
const RIGHT = 2;
const BOTTOM = 4;
const LEFT = 8;

/**
 * The coastlines worth generating, listed with repeats to weight them.
 *
 * A single coast along the bottom is the most familiar, so it comes up most; islands are worth
 * hitting reasonably often because they are the most fun; three-sided peninsulas are rare
 * because they leave the least room for a river to develop in.
 */
const COASTS = [
  BOTTOM, BOTTOM, BOTTOM, BOTTOM, BOTTOM,
  RIGHT, RIGHT, LEFT, LEFT, TOP,
  BOTTOM | RIGHT, BOTTOM | LEFT, TOP | RIGHT, TOP | LEFT,
  BOTTOM | TOP, LEFT | RIGHT,
  BOTTOM | LEFT | RIGHT, TOP | LEFT | RIGHT,
  TOP | RIGHT | BOTTOM | LEFT, TOP | RIGHT | BOTTOM | LEFT, TOP | RIGHT | BOTTOM | LEFT,
];

/** 32-bit integer hash — deterministic lattice noise without allocating a lattice. */
const hash = (x: number, y: number, seed: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1]: four lattice corners blended with a smoothstep. */
const noise = (x: number, y: number, seed: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);

  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);

  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
};

/**
 * How much of each octave's amplitude the next one keeps.
 *
 * The usual choice is 0.5, which produces smooth, rolling ground. That is the wrong
 * target here: every altitude point is drawn as a five pixel block, so anything without
 * detail down at the two-or-three cell scale is a soft blur at the size it is actually
 * looked at. Holding more amplitude in the fine octaves is what puts the crags and the
 * texture in.
 */
const ROUGHNESS = 0.58;

/**
 * Fractal noise in [0, 1]. Each octave is rotated by ~40° as well as scaled up,
 * which hides the axis-aligned grain that plain value noise otherwise shows.
 */
const fbm = (x: number, y: number, seed: number, octaves: number) => {
  const cos = 0.766;
  const sin = 0.643;
  let sum = 0;
  let weight = 0;
  let amp = 1;
  let px = x;
  let py = y;

  for (let o = 0; o < octaves; o++) {
    sum += noise(px, py, seed + o * 1013) * amp;
    weight += amp;
    amp *= ROUGHNESS;
    // Rotate, then double the frequency for the next octave.
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx * 2;
    py = ry * 2;
  }

  return sum / weight;
};

/** Ridged noise in [0, 1] — creases where the field crosses ½, which reads as ridge lines. */
const ridged = (x: number, y: number, seed: number, octaves: number) => {
  const r = 1 - Math.abs(fbm(x, y, seed, octaves) * 2 - 1);
  return r * r;
};

/**
 * How far inland every cell is, as a fraction of the way to the furthest inland point.
 *
 * 0 at the edges the sea comes in from and 1 at whatever point is furthest from any of them.
 * Normalising it this way is what lets one set of constants describe a single coast along the
 * bottom and an island alike: an island's centre is much closer to the sea than the top of a
 * bottom-coast map is, and without this it would come out as a flat sandbar.
 */
const inlandField = (cols: number, rows: number, coast: number) => {
  const inland = new Float32Array(cols * rows);
  let furthest = 0;

  for (let y = 0; y < rows; y++) {
    const down = rows > 1 ? y / (rows - 1) : 0;

    for (let x = 0; x < cols; x++) {
      const across = cols > 1 ? x / (cols - 1) : 0;
      let d = Infinity;
      if (coast & TOP) d = softMin(d, down);
      if (coast & BOTTOM) d = softMin(d, 1 - down);
      if (coast & LEFT) d = softMin(d, across);
      if (coast & RIGHT) d = softMin(d, 1 - across);
      inland[y * cols + x] = d;
      if (d > furthest) furthest = d;
    }
  }

  if (furthest > 0) for (let i = 0; i < inland.length; i++) inland[i] /= furthest;
  return inland;
};

/**
 * Smaller of two distances, but rounded where they are close instead of creasing.
 *
 * A plain minimum leaves a sharp diagonal fold wherever two coasts meet, which shows up as a
 * mitred corner on the landmass. Blending the two near the fold turns that into a curve.
 */
const softMin = (a: number, b: number) => {
  if (!Number.isFinite(a)) return b;
  const overlap = Math.max(0, CORNER_ROUND - Math.abs(a - b)) / CORNER_ROUND;
  return Math.min(a, b) - overlap * overlap * CORNER_ROUND * 0.25;
};

/**
 * Build the altitude grid: a flat row-major 2D array, `cols` wide and `rows` tall,
 * one altitude per cell.
 *
 * The shape is three things added together:
 *  - a fractal noise field for hills, basins and ridges,
 *  - a rise away from the sea, so water always has somewhere to go,
 *  - a drop below 0 near whichever edges the sea comes in from.
 */
export const generateTerrain = (cols: number, rows: number, seed: number) => {
  const land = new Float32Array(cols * rows);
  // Keep feature size in screen terms rather than cell terms, so the landscape
  // looks the same on a laptop and on a big display.
  const scale = 3.2 / Math.max(cols, rows);

  // Which way the sea lies is the seed's to decide, and everything else follows from it.
  const coast = COASTS[Math.floor(hash(7, 13, seed) * COASTS.length)]!;
  const inland = inlandField(cols, rows, coast);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = x * scale;
      const ny = y * scale;

      // Push the coast — and with it the plain and the hills behind it — in and out.
      const wander =
        (fbm(nx * COAST_WANDER_FREQ + 21.7, ny * COAST_WANDER_FREQ, seed + 4501, 3) - 0.5) *
          COAST_WANDER +
        (fbm(nx * COAST_RAGGED_FREQ, ny * COAST_RAGGED_FREQ + 4.3, seed + 8677, 2) - 0.5) *
          COAST_RAGGED;
      const d = Math.max(0, inland[y * cols + x]! + wander);

      // Domain warp: displace the sample point by another noise field. Straight
      // fbm gives blobby hills; warping bends them into valleys and spurs.
      const wx = nx + (fbm(nx * 0.6 + 11.3, ny * 0.6, seed + 7717, 3) - 0.5) * 1.1;
      const wy = ny + (fbm(nx * 0.6, ny * 0.6 + 5.7, seed + 3313, 3) - 0.5) * 1.1;

      const hills = fbm(wx, wy, seed, 8);
      const peaks = ridged(wx * 1.4, wy * 1.4, seed + 991, 5);
      // Mostly rolling ground, with ridged noise weighted towards the high parts
      // so mountains get sharp crests while the lowlands stay soft.
      const shape = hills * hills * (0.62 + 0.38 * peaks);

      // Flatten both the relief and the slope near the sea, leaving a plain for the river to
      // meander over before it gets there.
      const plain =
        1 - smooth(Math.min(1, Math.max(0, (d - PLAIN_EDGE) / (PLAIN_INLAND - PLAIN_EDGE))));
      const relief = RELIEF * (1 - (1 - PLAIN_RELIEF) * plain);
      // Rises steeply well inland and eases off towards the coast.
      const fall = Math.pow(d, FALL_SHAPE) * TILT;

      const drowned = smooth(Math.min(1, Math.max(0, (SHORE - d) / SHELF)));

      // Squaring the drop leaves a shallow shelf at the shore before it plunges.
      land[y * cols + x] = shape * relief + fall - drowned * drowned * SEA_FLOOR;
    }
  }

  // Noise alone has no valleys and hundreds of closed hollows. Rain on it first.
  carveDrainage(cols, rows, land);

  return land;
};
