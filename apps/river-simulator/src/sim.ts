/**
 * Water and erosion simulation on a grid of altitude points.
 *
 * The water model is the "virtual pipes" scheme from Mei, Decaudin & Hu, *Fast
 * Hydraulic Erosion Simulation and Visualization on GPU* (2007). Every cell keeps
 * four outgoing flow rates — one per edge — and each step those rates are
 * *accelerated* by the difference in water surface height across the edge rather
 * than being recomputed from scratch:
 *
 *     flux <- max(0, flux * DAMPING + dt * GRAVITY * (head[i] - head[j]))
 *
 * Two properties fall out of that, and both matter here:
 *
 *  - Because the driving term is the *water surface* (bed + depth) and not the bed
 *    alone, water in a hollow keeps spreading until its surface is level, then
 *    spills over the lowest lip. Lakes therefore form and overflow on their own —
 *    nothing detects a basin.
 *  - Because flux carries over between steps, the flow has momentum. Water rounding
 *    a bend keeps heading at the outer bank instead of instantly re-aiming itself
 *    down the steepest slope, which is what makes the channel able to meander.
 *
 * On top of the water sit two erosion processes, both moving real material into and
 * out of `sediment` so nothing appears or vanishes:
 *
 *  - Vertical: fast, steep, deep flow can hold more sediment than slow flow. Water
 *    below its capacity dissolves the bed; water above it drops the excess. This is
 *    what cuts the channel downwards and silts up the slack water in lakes. Capacity
 *    rising with depth also gathers the river together, since the deepest line of the
 *    flow erodes fastest and so becomes deeper still.
 *  - Lateral: where the flow curves, the water's own momentum leans on the outside of
 *    the bend, so that bank is undercut while the slack inside of the bend collects a
 *    point bar. Both together move the channel sideways, and because a bend that has
 *    moved outwards curves harder than it did before, bends grow rather than settle.
 *    Given long enough, neighbouring bends grow into each other, the river takes the
 *    short cut across the neck, and the loop it abandons is left as an oxbow lake.
 *
 * The two are deliberately kept apart by gradient — see `MEANDER_SLOPE`. Steep ground
 * gets incision and straight channels, gentle ground gets a wandering one, which is how
 * the real pair divide.
 *
 * Bends measurably grow, and loops do get cut across; a loop sealing off completely
 * into its own separate crescent of water is rarer, and wants a long run.
 */

/** Flow acceleration per unit of surface height difference. */
const GRAVITY = 9.81;
/** Fraction of the previous step's flow rate that carries over — the flow's inertia. */
const DAMPING = 0.95;
/** Radius, in world units, that a spring's supply is spread over. */
const SPRING_RADIUS = 1;
/** Depths below this are treated as dry: no flow, no erosion. */
const MIN_DEPTH = 1e-4;
/**
 * Ceiling on flow speed, in cells per unit time.
 *
 * Nothing in the pipe model resists the flow, so on a steep slope the water keeps
 * accelerating until each cell is emptied every single step. What that looks like is a
 * fast, flickering film one cell deep — so this stands in for friction: a cell can only
 * pass what a flow of this speed could carry through its wetted depth, which leaves the
 * water on a slope deeper, slower and continuous, the way a stream actually looks.
 */
const MAX_SPEED = 2;

/** Sediment a unit of flow can hold, and how fast the bed gives it up / takes it back. */
const CAPACITY = 0.32;
const DISSOLVE = 0.06;
const DEPOSIT = 0.25;
/**
 * Depth at which water carries its nominal load.
 *
 * Capacity scales straight off depth rather than levelling off past some threshold, which
 * follows how transport actually works — it goes with the shear the flow puts on the bed,
 * and that is depth times slope. It also matters a great deal here, because it is the only
 * thing that gathers a river together: the deepest line of the flow erodes fastest, which
 * makes it deeper still, so the water abandons the shallow margins and cuts one channel.
 * With a capacity that stops caring about depth, nothing distinguishes the middle of the
 * flow from its edges and the river stays a wide, shallow, braided sheet.
 */
const DEPTH_REF = 0.4;
/**
 * Steepness the bed is treated as having when it is flat.
 *
 * Capacity to carry sediment goes with how steep the bed is, which leaves a flat reach
 * unable to erode at all — and a river that cannot cut down on the flat never gathers
 * itself into one channel, it just spreads across the valley floor in a braid. This floor
 * gives even level ground some carrying capacity, so a channel can incise and hold.
 */
const MIN_TILT = 0.05;
/** Floor on the bed of a land cell, so a river can't cut itself below sea level. */
const MIN_LAND = 0.04;

/** Strength of outer-bank cutting / inner-bank deposition on bends. */
const LATERAL = 1.5;
/** Flow too slow or too straight to bother with. */
const MIN_FLOW = 0.3;
const MIN_CURVE = 0.02;
/**
 * Depth below which a bend stops cutting its bank.
 *
 * Only a real channel undercuts anything; a sheet of water spread thinly over a flat
 * does not. Without this the two processes run away together — cutting the banks
 * widens the channel, a wider channel is a shallower one, and shallow fast water cuts
 * the banks harder still, until the river has flattened the whole floodplain.
 */
const BANK_DEPTH = 0.15;
/**
 * How high a point bar may build on the inside of a bend, as a fraction of the height of
 * the bank being cut away on the outside.
 *
 * At 1 the bar rises to meet the level of the ground opposite, so the channel keeps its
 * shape and simply travels sideways across the floodplain. Lower values leave the inside
 * of the bend below the surrounding ground, which is a channel that widens instead of one
 * that moves.
 */
const BAR_LEVEL = 1;
/** Ceiling on the centrifugal term, so one wild cell can't blow a hole in a bank. */
const MAX_PUSH = 6;
/**
 * Steepest ground on which a river is allowed to bend its channel sideways.
 *
 * Meandering is a lowland habit. Water coming down a mountainside has the gradient to cut
 * straight down instead, and left to bend there it chews the hillside into a mess rather
 * than winding through it. Confining lateral work to gentle ground splits the two
 * behaviours the way the real ones divide: incised streams in the hills, wandering
 * channels once they reach the plain.
 */
const MEANDER_SLOPE = 0.2;
/** How far upstream to look when measuring the bend, and how far out to look for the bank.
    Both in world units, so they cover the same ground at any resolution. */
const BEND_SPAN = 3;
const BANK_REACH = 3;

/**
 * How readily sediment drifts sideways between neighbouring wet cells.
 *
 * Suspended material does not only travel with the current; at the edge of a channel it
 * also settles out into whatever slack water sits alongside. That is what plugs the ends
 * of a loop the river has just cut across — the loop silts up at both mouths, is left
 * behind as a separate crescent of still water, and an oxbow lake is what remains.
 */
const SETTLE = 0.5;

/** Height a dam stands above the ground it is built on, and how thick it is across. */
const DAM_HEIGHT = 6;
const DAM_WIDTH = 3;

/**
 * Depth of water lost to evaporation per unit time.
 *
 * Deliberately a fixed *depth* rather than a fixed fraction, which is both how
 * evaporation actually works and the only version that behaves here: a film left behind
 * by a flood is gone in moments, while a river or a lake barely notices, because it is
 * losing the same millimetre off a far greater depth. Taking a fraction instead drains
 * the river and the puddle at the same rate, and the river never reaches the sea.
 *
 * It has to stay small. The loss is per wet cell, and a river system covers thousands of
 * them, so a rate much above this evaporates more than the springs put in and the water
 * never makes it to the coast at all.
 */
const DRY_RATE = 0.0005;

import { cellSize } from './scale';

export type Source = { x: number; y: number; rate: number };

export type Sim = ReturnType<typeof createSim>;

export const createSim = (cols: number, rows: number, land: Float32Array) => {
  const size = cols * rows;

  // World units across one cell. Every length, speed and volume below goes through this,
  // which is what lets the resolution change without changing the behaviour.
  const L = cellSize(rows);
  const cellArea = L * L;
  /** Reaches expressed in world units, converted to whole cells at this resolution. */
  const springReach = Math.max(1, Math.round(SPRING_RADIUS / L));
  const springPatch = (springReach * 2 + 1) ** 2;
  const bendCells = Math.max(1, Math.round(BEND_SPAN / L));
  const bankCells = Math.max(1, Math.round(BANK_REACH / L));

  /** Water depth standing on top of each altitude point. */
  const water = new Float32Array(size);
  /** Sediment currently suspended in that water, in bed-height units. */
  const sediment = new Float32Array(size);
  /**
   * How far each cell resists being eroded, from 0 for bare earth to 1 for immovable.
   *
   * Only dams set this. Left as plain earth a dam is gone in seconds: water pouring over the
   * crest is both fast and steep, which is exactly the combination the erosion rules treat as
   * able to carry the most, so it cuts its way straight back down through the wall. Something
   * the player has deliberately built should stay built.
   */
  const armour = new Float32Array(size);
  /** Flow velocity, derived from the fluxes and used by both erosion terms. */
  const vx = new Float32Array(size);
  const vy = new Float32Array(size);

  // Outgoing flow rate through each of the four edges.
  const fL = new Float32Array(size);
  const fR = new Float32Array(size);
  const fT = new Float32Array(size);
  const fB = new Float32Array(size);

  // Scratch. `conc` is sediment per unit depth, which is what actually travels with
  // the water; the two `next` buffers hold the post-transport state.
  const conc = new Float32Array(size);
  const waterNext = new Float32Array(size);
  const sedNext = new Float32Array(size);
  // Velocity smoothed over the channel's width. A one-cell-wide flow can only point
  // in eight directions, so raw velocity zig-zags along the grid and reads as a
  // sharp bend every other cell; averaging across the channel recovers the real line
  // the water is taking, which is what the meander term needs.
  const svx = new Float32Array(size);
  const svy = new Float32Array(size);
  /** Bed steepness, worked out during the vertical pass and reused by the lateral one. */
  const slope = new Float32Array(size);

  const sources: Source[] = [];

  /** Total material picked up off the bed and banks, so the HUD can show it. */
  let moved = 0;
  /** Total water the sea has swallowed, which is where a finished river's flow ends up. */
  let drained = 0;
  /** Bumped whenever the land is reshaped by hand, so the renderer knows to redraw all of it. */
  let revision = 0;

  /**
   * Water surface height. Sea cells are pinned at 0 — the sea is a boundary the
   * rivers drain into, not water we simulate, so it neither rises nor drains.
   */
  const head = (i: number) => (land[i] <= 0 ? 0 : land[i] + water[i]);

  /**
   * Cut the outer bank one way and build the point bar the other, for one axis of a bend.
   *
   * Walking outwards is what lets the channel migrate sideways rather than only deepening
   * the cell next door: cells already under water are stepped over, and the first one
   * standing above the surface is the bank. The spoil goes straight across to the slack
   * inside of the bend, where it may build all the way up to the height of the bank being
   * taken away — which is what makes this a bend that *moves* instead of one that merely
   * gets wider. Stop the bar at the water's surface instead and the inside of the bend
   * stays part of the channel, so every unit off the outer bank is a unit of extra width;
   * the flow spreads thinner over it, and what should have been a migrating channel
   * flattens into a braid.
   */
  const workBank = (
    x: number,
    y: number,
    i: number,
    stepX: number,
    stepY: number,
    surface: number,
    strength: number,
  ) => {
    let bankTop = 0;

    for (let d = 1; d <= bankCells; d++) {
      const ox = x + stepX * d;
      const oy = y + stepY * d;
      if (ox < 0 || ox >= cols || oy < 0 || oy >= rows) break;
      const o = oy * cols + ox;
      if (land[o] <= surface) continue; // still inside the water
      bankTop = land[o];
      const take = Math.min(strength, Math.max(0, land[o] - MIN_LAND)) * (1 - armour[o]);
      land[o] -= take;
      sediment[i] += take;
      moved += take;
      break;
    }

    if (bankTop <= 0) return;

    const bx = x - stepX;
    const by = y - stepY;
    if (bx < 0 || bx >= cols || by < 0 || by >= rows) return;
    const b = by * cols + bx;
    const ceiling = land[i] + (bankTop - land[i]) * BAR_LEVEL;
    if (land[b] >= ceiling) return;

    const drop = Math.min(sediment[i], strength, ceiling - land[b]);
    land[b] += drop;
    sediment[i] -= drop;
  };

  const step = (dt: number) => {
    // Springs. Each one tops its patch up every step, forever. The water is spread
    // over a few cells rather than injected into one, because a single cell taking the
    // whole supply just digs itself a crater and overflows in every direction.
    for (const s of sources) {
      // The rate is a volume per unit time, so what it adds to a cell's depth depends on
      // how much ground that cell covers.
      const share = (s.rate * dt) / (cellArea * springPatch);
      for (let dy = -springReach; dy <= springReach; dy++) {
        const y = s.y + dy;
        if (y < 0 || y >= rows) continue;
        for (let dx = -springReach; dx <= springReach; dx++) {
          const x = s.x + dx;
          if (x < 0 || x >= cols) continue;
          water[y * cols + x] += share;
        }
      }
    }

    // 1. Accelerate the four flow rates out of every cell, then scale them back if
    //    together they would move more water than the cell actually holds. Without
    //    that clamp the depth goes negative and the whole field oscillates.
    const gain = dt * GRAVITY * L;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const depth = water[i];

        // A dry cell has nothing to send anywhere, and the clamp below would zero its
        // flow rates regardless — so leave early rather than work out four heads for it.
        // Most of the map is dry most of the time, which makes this the difference
        // between a comfortable frame and a slow one.
        if (depth <= MIN_DEPTH) {
          fL[i] = 0;
          fR[i] = 0;
          fT[i] = 0;
          fB[i] = 0;
          conc[i] = 0;
          continue;
        }

        const h = land[i] <= 0 ? 0 : land[i] + depth;

        let l = x > 0 ? Math.max(0, fL[i] * DAMPING + gain * (h - head(i - 1))) : 0;
        let r = x < cols - 1 ? Math.max(0, fR[i] * DAMPING + gain * (h - head(i + 1))) : 0;
        let t = y > 0 ? Math.max(0, fT[i] * DAMPING + gain * (h - head(i - cols))) : 0;
        let b = y < rows - 1 ? Math.max(0, fB[i] * DAMPING + gain * (h - head(i + cols))) : 0;

        const out = (l + r + t + b) * dt;
        // Two ceilings on how much can leave in one step: the volume the cell actually
        // holds, and what a flow at the speed limit could carry through its depth.
        const limit = Math.min(depth * cellArea, depth * MAX_SPEED * L * dt);

        if (out > limit) {
          const k = limit / out;
          l *= k;
          r *= k;
          t *= k;
          b *= k;
        }

        fL[i] = l;
        fR[i] = r;
        fT[i] = t;
        fB[i] = b;
        conc[i] = sediment[i] / depth;
      }
    }

    // 2. Move water and its suspended sediment along those flow rates. Sediment
    //    travels at the water's concentration, so it is carried rather than diffused.
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;

        // Dry, with nothing wet next to it, means nothing can arrive either.
        if (
          water[i] <= MIN_DEPTH &&
          (x === 0 || water[i - 1] <= MIN_DEPTH) &&
          (x === cols - 1 || water[i + 1] <= MIN_DEPTH) &&
          (y === 0 || water[i - cols] <= MIN_DEPTH) &&
          (y === rows - 1 || water[i + cols] <= MIN_DEPTH)
        ) {
          waterNext[i] = 0;
          sedNext[i] = sediment[i];
          vx[i] = 0;
          vy[i] = 0;
          continue;
        }

        const outFlow = fL[i] + fR[i] + fT[i] + fB[i];
        let inFlow = 0;
        let inSed = 0;

        if (x > 0) {
          const j = i - 1;
          inFlow += fR[j];
          inSed += fR[j] * conc[j];
        }
        if (x < cols - 1) {
          const j = i + 1;
          inFlow += fL[j];
          inSed += fL[j] * conc[j];
        }
        if (y > 0) {
          const j = i - cols;
          inFlow += fB[j];
          inSed += fB[j] * conc[j];
        }
        if (y < rows - 1) {
          const j = i + cols;
          inFlow += fT[j];
          inSed += fT[j] * conc[j];
        }

        const depth = water[i];
        const next = Math.max(0, depth + (dt * (inFlow - outFlow)) / cellArea);
        waterNext[i] = next;
        sedNext[i] = Math.max(0, sediment[i] + dt * (inSed - outFlow * conc[i]));

        // Velocity is the net flow through the cell spread over its wetted
        // cross-section, averaged over the step so it stays in step with the depth.
        const mean = (depth + next) * 0.5;
        if (mean > MIN_DEPTH) {
          const netX = (x > 0 ? fR[i - 1] : 0) - fL[i] + fR[i] - (x < cols - 1 ? fL[i + 1] : 0);
          const netY = (y > 0 ? fB[i - cols] : 0) - fT[i] + fB[i] - (y < rows - 1 ? fT[i + cols] : 0);
          const scale = 1 / (2 * L * mean);
          vx[i] = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, netX * scale));
          vy[i] = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, netY * scale));
        } else {
          vx[i] = 0;
          vy[i] = 0;
        }
      }
    }

    water.set(waterNext);
    sediment.set(sedNext);

    // 3. Vertical erosion: compare what the flow can carry against what it is
    //    carrying, and trade the difference with the bed.
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        const depth = water[i];
        if (depth <= MIN_DEPTH) continue;
        if (land[i] <= 0) continue; // the sea bed is handled as a delta below

        const ux = vx[i];
        const uy = vy[i];
        const speed = Math.sqrt(ux * ux + uy * uy);

        // Steepness of the bed under the flow, as sin(angle of the slope).
        const gx = (land[i + 1] - land[i - 1]) * 0.5;
        const gy = (land[i + cols] - land[i - cols]) * 0.5;
        const grade = Math.sqrt(gx * gx + gy * gy) / L;
        slope[i] = grade;
        const tilt = Math.max(MIN_TILT, grade / Math.sqrt(1 + grade * grade));

        const capacity = CAPACITY * tilt * speed * (depth / DEPTH_REF);
        const excess = capacity - sediment[i];

        if (excess > 0) {
          // Under capacity: pick material up, but never below the erosion floor.
          const take =
            Math.min(DISSOLVE * excess * dt, Math.max(0, land[i] - MIN_LAND)) * (1 - armour[i]);
          land[i] -= take;
          sediment[i] += take;
          moved += take;
        } else {
          // Over capacity — slack or shallow water — so drop the surplus.
          const drop = Math.min(sediment[i], DEPOSIT * -excess * dt);
          land[i] += drop;
          sediment[i] -= drop;
        }
      }
    }

    // 3b. Let sediment drift sideways between neighbouring wet cells, from the loaded
    //     water in the channel into the slack water beside it. Whatever arrives in slack
    //     water is past what that water can hold, so the next pass drops it on the bed.
    sedNext.set(sediment);

    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        const depth = water[i];
        if (depth <= MIN_DEPTH) continue;

        const here = sediment[i] / depth;
        let gained = 0;

        for (let n = 0; n < 4; n++) {
          const j = n === 0 ? i - 1 : n === 1 ? i + 1 : n === 2 ? i - cols : i + cols;
          const other = water[j];
          if (other <= MIN_DEPTH) continue;
          // Shared by both sides of the pair, so the exchange moves material about
          // without creating or destroying any.
          gained += (SETTLE * (sediment[j] / other - here) * Math.min(depth, other) * dt) / cellArea;
        }

        sedNext[i] = Math.max(0, sediment[i] + gained);
      }
    }

    sediment.set(sedNext);

    // 4. Lateral erosion: cut the outside of every bend, build up the inside.
    //
    //    First average the velocity across the width of the flow, so the direction
    //    reflects the channel rather than the grid.
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (water[i] <= MIN_DEPTH) {
          svx[i] = 0;
          svy[i] = 0;
          continue;
        }
        let sx = 0;
        let sy = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = i + dy * cols + dx;
            const w = water[j];
            if (w <= MIN_DEPTH) continue;
            sx += vx[j] * w;
            sy += vy[j] * w;
            weight += w;
          }
        }
        svx[i] = weight > 0 ? sx / weight : 0;
        svy[i] = weight > 0 ? sy / weight : 0;
      }
    }

    //    Then read the turn straight off that field. Comparing the velocity here with
    //    the velocity a few cells upstream gives the change in flow direction; the
    //    part of it across the flow is centripetal, so it points at the *inside* of
    //    the bend and its opposite points at the outer bank. Taking the direction
    //    from the physics like this avoids having to reason about which way is
    //    "left", which flips with the direction of travel.
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        const depth = water[i];
        if (depth <= MIN_DEPTH || land[i] <= 0) continue;
        if (slope[i] > MEANDER_SLOPE) continue;

        const ax = svx[i];
        const ay = svy[i];
        const speed = Math.sqrt(ax * ax + ay * ay);
        if (speed < MIN_FLOW) continue;

        const dirX = ax / speed;
        const dirY = ay / speed;

        const ux = x - Math.round(dirX * bendCells);
        const uy = y - Math.round(dirY * bendCells);
        if (ux < 1 || ux >= cols - 1 || uy < 1 || uy >= rows - 1) continue;
        const u = uy * cols + ux;
        if (water[u] <= MIN_DEPTH) continue;

        const dvx = ax - svx[u];
        const dvy = ay - svy[u];
        const along = dvx * dirX + dvy * dirY; // just speeding up or slowing down
        const inX = dvx - along * dirX;
        const inY = dvy - along * dirY;
        const turn = Math.sqrt(inX * inX + inY * inY);
        if (turn === 0) continue;

        // Curvature of the streamline: how much the direction swung, per cell
        // travelled. Dividing out the speed is what makes this a shape of the
        // channel rather than a measure of how hard the water is going.
        const curve = turn / (speed * bendCells * L);
        if (curve < MIN_CURVE) continue;

        const channelled = Math.min(1, (depth - BANK_DEPTH) / BANK_DEPTH);
        if (channelled <= 0) continue;

        // Centrifugal force per unit of water, which is what leans on the outer bank.
        const push = Math.min(MAX_PUSH, curve * speed * speed);
        const strength = LATERAL * push * channelled * dt;

        const outX = -inX / turn;
        const outY = -inY / turn;
        const surface = land[i] + depth;

        // Work the bank along each axis in turn, in proportion to how much the outward
        // direction points that way. Rounding the direction to the nearest of the eight
        // neighbours instead would let a bank only ever face one of eight ways, and the
        // meanders it cut came out as staircases of horizontal and vertical runs; splitting
        // the same total between the two axes lets a bank sit at any angle.
        const weightX = Math.abs(outX);
        const weightY = Math.abs(outY);
        const total = weightX + weightY;
        if (weightX > 0) {
          workBank(x, y, i, Math.sign(outX), 0, surface, (strength * weightX) / total);
        }
        if (weightY > 0) {
          workBank(x, y, i, 0, Math.sign(outY), surface, (strength * weightY) / total);
        }
      }
    }

    // 5. Housekeeping: evaporate a little, drain into the sea, and let whatever the
    //    rivers delivered to the coast settle out as a delta.
    const dried = DRY_RATE * dt;

    for (let i = 0; i < size; i++) {
      // Dry ground above the sea has nothing to evaporate and nothing to settle out.
      if (water[i] <= 0 && land[i] > 0) continue;

      if (land[i] <= 0) {
        // The sea swallows the flow, and drops whatever it was carrying as delta.
        drained += water[i];
        land[i] += sediment[i];
        sediment[i] = 0;
        water[i] = 0;
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }

      water[i] -= dried;

      if (water[i] <= MIN_DEPTH) {
        // Dried out, so anything it was carrying is left behind on the bed.
        land[i] += sediment[i];
        sediment[i] = 0;
        water[i] = 0;
      }
    }
  };

  return {
    cols,
    rows,
    /** The altitude grid: row-major, one point per cell, 0 is sea level. */
    land,
    water,
    sediment,
    armour,
    vx,
    vy,
    sources,
    step,
    get moved() {
      return moved;
    },
    /** How much water has reached the sea so far. */
    get drained() {
      return drained;
    },
    /**
     * Counts deliberate changes to the land, such as a dam going up.
     *
     * The renderer only repaints around water, on the grounds that nothing else moves. A wall
     * built across dry ground is the exception, so it watches this instead of missing it.
     */
    get revision() {
      return revision;
    },
    /** Total water standing on the land, ignoring the sea. */
    volume() {
      let sum = 0;
      for (let i = 0; i < size; i++) sum += water[i];
      return sum;
    },
    addSource(x: number, y: number, rate: number) {
      sources.push({ x, y, rate });
    },
    /** Drop the source nearest to a cell, within `radius`. Returns true if one went. */
    removeSourceNear(x: number, y: number, radius: number) {
      let best = -1;
      let bestDist = radius * radius;
      for (let n = 0; n < sources.length; n++) {
        const d = (sources[n]!.x - x) ** 2 + (sources[n]!.y - y) ** 2;
        if (d <= bestDist) {
          bestDist = d;
          best = n;
        }
      }
      if (best < 0) return false;
      sources.splice(best, 1);
      return true;
    },
    /**
     * Throw up a ridge of earth along a line — a dam.
     *
     * Each cell is lifted by the most any point of the line asks of it rather than by the sum,
     * because the line is walked cell by cell and neighbouring steps cover much the same
     * ground; adding each time over would pile up a wall several times taller than asked for.
     * Water sitting where the wall goes is displaced rather than carried up with it.
     */
    raiseLine(x0: number, y0: number, x1: number, y1: number) {
      const reach = Math.max(1, Math.round(DAM_WIDTH / 2 / L));
      const span = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      const lift = new Map<number, number>();

      for (let s = 0; s <= span; s++) {
        const t = span === 0 ? 0 : s / span;
        const cx = Math.round(x0 + (x1 - x0) * t);
        const cy = Math.round(y0 + (y1 - y0) * t);

        for (let dy = -reach; dy <= reach; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= rows) continue;
          for (let dx = -reach; dx <= reach; dx++) {
            const x = cx + dx;
            if (x < 0 || x >= cols) continue;
            const fall = 1 - Math.sqrt(dx * dx + dy * dy) / (reach + 0.5);
            if (fall <= 0) continue;
            const i = y * cols + x;
            const raise = DAM_HEIGHT * fall;
            if (raise > (lift.get(i) ?? 0)) lift.set(i, raise);
          }
        }
      }

      revision++;

      for (const [i, raise] of lift) {
        land[i] += raise;
        water[i] = 0;
        sediment[i] = 0;
        // Armoured in proportion to how much of the wall is here, so the crest is solid and
        // the skirts at either side are only partly protected.
        armour[i] = Math.max(armour[i], raise / DAM_HEIGHT);
      }
    },
    clearWater() {
      water.fill(0);
      sediment.fill(0);
      vx.fill(0);
      vy.fill(0);
      fL.fill(0);
      fR.fill(0);
      fT.fill(0);
      fB.fill(0);
      sources.length = 0;
    },
  };
};
