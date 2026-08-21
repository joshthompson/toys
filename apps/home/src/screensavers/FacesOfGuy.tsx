import { createStore } from 'solid-js/store';
import { For, onCleanup, onMount } from 'solid-js';
import { resolve } from '../toys';

/**
 * Face Of Guys — the whole gallery of guys, at once, forever.
 *
 * The screen is carved up by splitting it in two over and over, always across
 * whichever side is too long, always off-centre. The tiles that fall out are all
 * different sizes and share no gridlines, but because every cut runs the full width
 * of the rectangle it cuts, they still interlock edge to edge with nothing left over.
 * Each tile then breathes on its own clock, swapping to another guy while it's dark.
 */

/** How many guy-NN.png files sit in public/images/guys. Bump it when you add one. */
const GUY_COUNT = 62;
/** Roughly how many faces to aim for on screen. The carve overshoots or undershoots. */
const TARGET_TILES = 44;
/** No tile comes out narrower or shorter than this, whatever the split asks for. */
const MIN_SIDE = 84;
/**
 * Tiles are cut towards this width-over-height, because the guys are all portraits —
 * a tile near their shape crops the least off the sides of a face.
 */
const TILE_ASPECT = 0.78;
/** A full fade in, hold, and fade out takes somewhere in this range. */
const BREATH_MS = [7000, 16000];

const guyUrl = (n: number) => resolve(`/images/guys/guy-${String(n).padStart(2, '0')}.png`);

type Rect = { x: number; y: number; w: number; h: number };
/** A tile's own fade clock, plus whichever guy it's showing this time round. */
type Tile = Rect & { guy: number; breath: number; offset: number };

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Split `rect` down to tile size, collecting the leftovers. The size it stops at is
 * drawn from a wide band around `target`, so two tiles side by side rarely match —
 * a fixed threshold would quietly rebuild the grid this is trying to avoid.
 */
const carve = (rect: Rect, target: number, out: Rect[]) => {
  const enough = rect.w * rect.h <= target * between(0.5, 1.7);
  const splittable = Math.max(rect.w, rect.h) >= MIN_SIDE * 2;
  if (enough || !splittable) {
    out.push(rect);
    return;
  }

  // Cut across the side that's furthest from the shape a face wants.
  const across = rect.w / rect.h > TILE_ASPECT;
  const side = across ? rect.w : rect.h;
  // Never near the middle: an off-centre cut is what staggers the tiles below it.
  const at = Math.round(clamp(side * between(0.34, 0.66), MIN_SIDE, side - MIN_SIDE));

  // The two halves share the cut exactly, so they meet with no seam and no overlap.
  carve(across ? { ...rect, w: at } : { ...rect, h: at }, target, out);
  carve(
    across
      ? { x: rect.x + at, y: rect.y, w: rect.w - at, h: rect.h }
      : { x: rect.x, y: rect.y + at, w: rect.w, h: rect.h - at },
    target,
    out,
  );
};

export function FacesOfGuy() {
  let box!: HTMLDivElement;
  const [tiles, setTiles] = createStore<Tile[]>([]);

  /** Guys still known to load — one whose file has gone drops out of here for good. */
  let known = Array.from({ length: GUY_COUNT }, (_, i) => i + 1);
  /** What's left of the current shuffle. Dealing it out spreads the guys around. */
  let deck: number[] = [];

  const nextGuy = () => {
    if (!deck.length) deck = [...known].sort(() => Math.random() - 0.5);
    return deck.pop() ?? 0;
  };

  /** A guy whose image 404s — GUY_COUNT gone stale — is never dealt again. */
  const forget = (guy: number) => {
    known = known.filter((g) => g !== guy);
    deck = deck.filter((g) => g !== guy);
  };

  onMount(() => {
    const layout = () => {
      const { width, height } = box.getBoundingClientRect();
      if (!width || !height) return;
      const out: Rect[] = [];
      carve({ x: 0, y: 0, w: Math.round(width), h: Math.round(height) }, (width * height) / TARGET_TILES, out);
      deck = [];
      setTiles(
        out.map((rect) => ({
          ...rect,
          guy: nextGuy(),
          breath: between(BREATH_MS[0], BREATH_MS[1]),
          // Start each tile part-way through its own fade, so they never breathe together.
          offset: Math.random(),
        })),
      );
    };

    layout();
    window.addEventListener('resize', layout);
    onCleanup(() => window.removeEventListener('resize', layout));
  });

  return (
    <div class="guy-mosaic" ref={box}>
      <For each={tiles}>
        {(tile, i) => (
          <img
            class="guy-tile"
            src={guyUrl(tile.guy)}
            alt=""
            draggable={false}
            style={{
              left: `${tile.x}px`,
              top: `${tile.y}px`,
              width: `${tile.w}px`,
              height: `${tile.h}px`,
              'animation-duration': `${Math.round(tile.breath)}ms`,
              'animation-delay': `-${Math.round(tile.breath * tile.offset)}ms`,
            }}
            // The keyframes end dark, so a swap here is a swap nobody sees.
            onAnimationIteration={() => setTiles(i(), 'guy', nextGuy())}
            onError={() => {
              forget(tile.guy);
              setTiles(i(), 'guy', nextGuy());
            }}
          />
        )}
      </For>
    </div>
  );
}
