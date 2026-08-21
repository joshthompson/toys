import { onCleanup, onMount } from 'solid-js';

/**
 * Pipes — a flat, chunky descendant of the old 3D Pipes screensaver.
 *
 * Everything is drawn on a deliberately tiny canvas that the browser blows back up
 * with nearest-neighbour scaling, so every pipe is built out of fat square pixels.
 * Five pipes crawl a grid, turning at random, until enough of the screen is covered
 * that it fades out and starts again in new colours.
 */

/** Screen pixels per canvas pixel. Bigger is blockier. */
const SCALE = 4;
/** Canvas pixels per grid cell — one straight length of pipe. */
const CELL = 8;
/** Pipe thickness in canvas pixels, dark outline included. Must be under CELL. */
const GAUGE = 6;
const PIPE_COUNT = 4;
/** One cell of growth per pipe, this often. */
const STEP_MS = 70;
/** Chance a pipe turns instead of carrying straight on. */
const TURN_CHANCE = 0.22;
/**
 * Cells of pipe laid, as a multiple of the grid, before the screen wipes. Over 1
 * because pipes cross their own work — the screen has to look full, not be full.
 */
const FILL_BEFORE_WIPE = 1.2;
/** Steps spent fading the old run out before the new one starts. */
const FADE_STEPS = 22;

const BACKDROP = '#070b14';
const COLOURS = ['#3ce0c8', '#ff5ea8', '#ffd23f', '#7ee34a', '#5aa9ff', '#ff8a3d'];

type Dir = { x: number; y: number };
type Cell = { x: number; y: number };
type Pipe = Cell & { dir: Dir; colour: string };

const DIRS: Dir[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/** Nudge a pipe's colour towards black or white for its outline and its lit edge. */
const shade = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)} ${mix((n >> 8) & 255)} ${mix(n & 255)})`;
};

export function Pipes() {
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cols = 0;
    let rows = 0;
    let pipes: Pipe[] = [];
    /** Cells of pipe laid this run — the wipe is timed off this, not off a clock. */
    let laid = 0;
    /** Counts down while the old run fades; 0 means the pipes are growing. */
    let fading = 0;

    const inside = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows;
    /** Centre of a cell, in canvas pixels. */
    const centre = (c: number) => c * CELL + Math.floor(CELL / 2);

    /**
     * Lay pipe from one cell's centre to the next: a coloured core with a dark line
     * down each long side and a lit one just inside it. Arms run half a gauge past
     * both centres, so consecutive ones overlap and a corner fills itself in — no
     * separate elbow to draw. The ends are left open on purpose, since a cap would
     * paint a seam across the pipe it joins.
     */
    const layArm = (from: Cell, to: Cell, colour: string) => {
      const half = Math.floor(GAUGE / 2);
      const x = Math.min(centre(from.x), centre(to.x)) - half;
      const y = Math.min(centre(from.y), centre(to.y)) - half;
      const w = Math.abs(centre(to.x) - centre(from.x)) + GAUGE;
      const h = Math.abs(centre(to.y) - centre(from.y)) + GAUGE;
      const flat = from.y === to.y;

      ctx.fillStyle = shade(colour, -0.7);
      if (flat) {
        ctx.fillRect(x, y, w, 1);
        ctx.fillRect(x, y + GAUGE - 1, w, 1);
      } else {
        ctx.fillRect(x, y, 1, h);
        ctx.fillRect(x + GAUGE - 1, y, 1, h);
      }

      ctx.fillStyle = colour;
      if (flat) ctx.fillRect(x, y + 1, w, GAUGE - 2);
      else ctx.fillRect(x + 1, y, GAUGE - 2, h);

      // One lit pixel line along the top or left of the core: the whole 3D illusion.
      ctx.fillStyle = shade(colour, 0.5);
      if (flat) ctx.fillRect(x, y + 1, w, 1);
      else ctx.fillRect(x + 1, y, 1, h);
    };

    const restart = () => {
      laid = 0;
      fading = 0;
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Deal colours off a shuffled palette, so no two pipes in a run look alike.
      const palette = [...COLOURS].sort(() => Math.random() - 0.5);
      pipes = Array.from({ length: PIPE_COUNT }, (_, i) => ({
        x: Math.floor(Math.random() * cols),
        y: Math.floor(Math.random() * rows),
        dir: pick(DIRS),
        colour: palette[i % palette.length],
      }));
    };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(CELL, Math.floor(box.width / SCALE));
      canvas.height = Math.max(CELL, Math.floor(box.height / SCALE));
      cols = Math.max(1, Math.floor(canvas.width / CELL));
      rows = Math.max(1, Math.floor(canvas.height / CELL));
      restart();
    };

    const grow = () => {
      for (const pipe of pipes) {
        // Anywhere in bounds except straight back the way it came.
        const open = DIRS.filter(
          (d) => inside({ x: pipe.x + d.x, y: pipe.y + d.y }) && !(d.x === -pipe.dir.x && d.y === -pipe.dir.y),
        );
        const ahead = open.includes(pipe.dir) ? pipe.dir : undefined;
        const turns = open.filter((d) => d !== pipe.dir);
        const dir = ahead && !(turns.length && Math.random() < TURN_CHANCE) ? ahead : pick(turns) ?? ahead;
        // Boxed into a corner of a one-cell grid: sit this step out.
        if (!dir) continue;

        const next = { x: pipe.x + dir.x, y: pipe.y + dir.y };
        layArm(pipe, next, pipe.colour);
        pipe.x = next.x;
        pipe.y = next.y;
        pipe.dir = dir;
        laid++;
      }

      if (laid > cols * rows * FILL_BEFORE_WIPE) fading = FADE_STEPS;
    };

    const fade = () => {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      if (--fading === 0) restart();
    };

    resize();

    let raf = 0;
    let previous = 0;
    /** Time owed to the pipes, so they crawl at STEP_MS whatever the frame rate. */
    let owed = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      owed += previous ? now - previous : 0;
      previous = now;
      // A backgrounded tab can bank minutes of time; cap the catch-up at a few steps.
      owed = Math.min(owed, STEP_MS * 4);
      while (owed >= STEP_MS) {
        owed -= STEP_MS;
        if (fading) fade();
        else grow();
      }
    };
    raf = requestAnimationFrame(frame);

    window.addEventListener('resize', resize);
    onCleanup(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    });
  });

  return <canvas class="screensaver-canvas" ref={canvas} />;
}
