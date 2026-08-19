/**
 * Carving a drainage network into a freshly generated landscape.
 *
 * Fractal noise on its own gives plausible-looking hills, but hydrologically it is
 * nonsense: hundreds of closed hollows with no outlet, and no valleys. Water dropped
 * on it sheets outwards and ponds instead of running anywhere, and it reads as
 * lumpy rather than as land.
 *
 * Real landscapes have already been rained on. This does the same thing to ours
 * before the first frame, in three passes:
 *
 *  1. Priority flood (Barnes, Lehman & Mulla 2014). Working outwards from the sea in
 *     order of height, every cell is raised to the lowest level it could spill at.
 *     That both removes the closed hollows and, as a side effect, records for every
 *     cell which neighbour its water leaves by — a drainage tree rooted at the sea.
 *  2. Flow accumulation. Walking that tree from the ridges down to the sea totals up
 *     how many cells drain through each one, which is what separates a major valley
 *     from a hillside crease.
 *  3. Carve. Each cell is lowered according to how much land drains through it, and
 *     the carve depths are blurred so the result is a valley several cells wide with
 *     room for a river to move about in, rather than a one-cell slot.
 *
 * The hollows are only *mostly* filled in pass 1, so shallow basins survive as places
 * for lakes to form.
 */
import { cellSize } from './scale';

/** Share of each closed hollow that gets filled in. The remainder can hold a lake. */
const FILL = 0.82;
/** Depth of the broad valley under a fully grown river, in reference altitude units. */
const CARVE = 6;
/**
 * Extra depth of the narrow channel cut along the floor of that valley.
 *
 * A blurred valley on its own has no banks, only ramps, and water a fraction of a unit
 * deep spreads a long way up a ramp — so on the gentle ground near the coast the river
 * arrives and fans out into a shallow braid instead of holding a course. Cutting a narrow
 * channel along the valley floor gives the flow something to sit in. The pair together are
 * the shape a lowland river actually has: a wide floodplain to wander across, with an
 * incised channel doing the wandering.
 */
const CHANNEL = 2.2;
/** Width of that channel, in world units. */
const CHANNEL_WIDTH = 1.5;
/** Drainage area, in cells, at which a valley is considered fully grown. */
const ACC_FULL = 900;
/** Blur passes over the carve depths at the reference resolution — the valleys' width. */
const WIDEN = 3;
/**
 * How far a valley floor is smoothed towards its own local average.
 *
 * The noise is deliberately rough so that mountainsides have crags at the scale a single
 * altitude point is drawn at. Valley floors want the opposite: every little bump in them
 * splits the flow into another thread, so a river arrives as a braid of shallow streams
 * instead of as one channel. Real valley floors are smooth for the same reason they are
 * flat — they are floored with what the river dropped there — so this smooths the ground
 * in proportion to how much land drains through it, leaving the ridges alone.
 */
const ALLUVIUM = 0.9;

/** Binary min-heap over (height, cell), which is what makes the flood run in n log n. */
const createHeap = (capacity: number) => {
  const keys = new Float64Array(capacity + 1);
  const vals = new Int32Array(capacity + 1);
  let n = 0;

  return {
    get size() {
      return n;
    },
    push(key: number, val: number) {
      let i = ++n;
      keys[i] = key;
      vals[i] = val;
      while (i > 1) {
        const up = i >> 1;
        if (keys[up] <= keys[i]) break;
        const k = keys[up];
        const v = vals[up];
        keys[up] = keys[i];
        vals[up] = vals[i];
        keys[i] = k;
        vals[i] = v;
        i = up;
      }
    },
    pop() {
      const top = vals[1];
      keys[1] = keys[n];
      vals[1] = vals[n];
      n--;
      let i = 1;
      for (;;) {
        const l = i << 1;
        if (l > n) break;
        const r = l + 1;
        const child = r <= n && keys[r] < keys[l] ? r : l;
        if (keys[i] <= keys[child]) break;
        const k = keys[child];
        const v = vals[child];
        keys[child] = keys[i];
        vals[child] = vals[i];
        keys[i] = k;
        vals[i] = v;
        i = child;
      }
      return top;
    },
  };
};

/**
 * Cut valleys and drainage lines into `land`, in place.
 *
 * Afterwards every point above sea level has a downhill path to the sea, apart from
 * the shallow basins deliberately left behind, so water finds its way out instead of
 * spreading into a pond.
 */
export const carveDrainage = (cols: number, rows: number, land: Float32Array) => {
  const size = cols * rows;
  // Widths are given in world units, so how many cells they come to depends on how much
  // world a cell covers. A valley should be the same valley at any resolution.
  const cell = cellSize(rows);
  const widen = Math.max(1, Math.round(WIDEN / cell));
  const narrow = Math.max(1, Math.round(CHANNEL_WIDTH / cell));
  const alluvialBlur = Math.max(1, Math.round(2 / cell));

  const filled = Float32Array.from(land);
  /** The neighbour each cell's water spills to — i.e. one step downstream. */
  const downhill = new Int32Array(size).fill(-1);
  /** Cells in the order the flood reached them: always downstream before upstream. */
  const order = new Int32Array(size);
  const seen = new Uint8Array(size);
  const heap = createHeap(size);
  let count = 0;

  // The flood starts from everywhere water can already leave: the sea, and the edges
  // of the map, which are treated as open ground running off the side.
  for (let i = 0; i < size; i++) {
    const x = i % cols;
    const y = (i - x) / cols;
    if (land[i] <= 0 || x === 0 || x === cols - 1 || y === 0 || y === rows - 1) {
      seen[i] = 1;
      heap.push(filled[i], i);
    }
  }

  while (heap.size > 0) {
    const i = heap.pop();
    order[count++] = i;

    const x = i % cols;
    const y = (i - x) / cols;

    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= rows) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= cols) continue;
        const j = ny * cols + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        // A cell lower than the level it drains over is sitting in a hollow; raising
        // it to that level is what fills the hollow in.
        if (filled[j] < filled[i]) filled[j] = filled[i];
        downhill[j] = i;
        heap.push(filled[j], j);
      }
    }
  }

  // Put back a fraction of every hollow that was just filled, so the landscape keeps
  // some basins for water to collect in.
  for (let i = 0; i < size; i++) land[i] += (filled[i] - land[i]) * FILL;

  // Total the land draining through each cell, ridges first.
  const acc = new Float32Array(size).fill(1);
  for (let k = count - 1; k >= 0; k--) {
    const i = order[k];
    const d = downhill[i];
    if (d >= 0) acc[d] += acc[i];
  }

  // How grown a river each cell carries, in [0, 1]. Logarithmic, because drainage area
  // grows far faster downstream than a valley visibly deepens.
  const scale = 1 / Math.log1p(ACC_FULL);
  const grown = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    if (land[i] <= 0) continue;
    const g = Math.min(1, Math.log1p(acc[i]) * scale);
    grown[i] = g * g;
  }

  // Two blurs of the same field: a broad one for the valley, a tight one for the channel
  // along its floor. Blurring at all is what stops either being a one-cell slot.
  const valley = blur(Float32Array.from(grown), cols, rows, widen);
  const channel = blur(Float32Array.from(grown), cols, rows, narrow);

  // Sink the valleys in, keeping the land above sea level so the coastline stays put.
  for (let i = 0; i < size; i++) {
    if (land[i] <= 0) continue;
    land[i] = Math.max(0.05, land[i] - valley[i] * CARVE);
  }

  // Floor those valleys with alluvium: the more that drains through a cell, the closer its
  // height goes to the local average, which takes the braid-inducing bumps out of the
  // valley floors without touching the ridges between them.
  const settled = blur(Float32Array.from(land), cols, rows, alluvialBlur);
  for (let i = 0; i < size; i++) {
    if (land[i] <= 0) continue;
    land[i] += (settled[i] - land[i]) * valley[i] * ALLUVIUM;
  }

  // Only now cut the channel along the floor. Doing it before the smoothing above would
  // just have smoothed the banks off it again, which are the whole point of it.
  for (let i = 0; i < size; i++) {
    if (land[i] <= 0) continue;
    land[i] = Math.max(0.05, land[i] - channel[i] * CHANNEL);
  }
};

/**
 * Box-blur a grid `passes` times, returning whichever of the two buffers ended up
 * holding the result. The buffer type is spelled out because the two are swapped between
 * passes, and TypeScript types a plain `Float32Array` loosely enough that it objects.
 */
const blur = (field: Float32Array<ArrayBuffer>, cols: number, rows: number, passes: number) => {
  let src = field;
  let dst = new Float32Array(field.length);

  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= cols) continue;
            sum += src[ny * cols + nx];
            n++;
          }
        }
        dst[y * cols + x] = sum / n;
      }
    }
    const held = src;
    src = dst;
    dst = held;
  }

  return src;
};
