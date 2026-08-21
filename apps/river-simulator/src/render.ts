/**
 * Painting. Every altitude point becomes one CELL x CELL block on screen.
 *
 * The grid is drawn into an ImageData one pixel per cell, then blown up onto the
 * visible canvas with smoothing off. That keeps the per-frame work at one pixel per
 * altitude point instead of one per screen pixel, and the browser does the upscale.
 *
 * The pixel buffer is kept between frames and only the cells that can have changed are
 * repainted: water is the only thing that moves, and erosion only happens under water, so
 * dry ground away from the rivers is already correct from the frame before. At a fine
 * resolution that is most of the map, and repainting it every frame was costing more than
 * the simulation itself.
 */
import { paint } from './palette';
import type { Sim } from './sim';

/** Depth at which a cell counts as wet enough to need repainting. */
const VISIBLE = 0.005;

/** A dam being dragged out but not yet built, in cell coordinates. */
export type Preview = { x0: number; y0: number; x1: number; y1: number } | null;

/** Paint one frame. See `draw` below for what the options leave out. */
export type Draw = (preview?: Preview, options?: { markers?: boolean }) => void;

export const createRenderer = (canvas: HTMLCanvasElement, sim: Sim) => {
  const { cols, rows, water } = sim;
  const size = cols * rows;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');

  // The one-pixel-per-cell buffer that gets scaled up to fill the screen.
  const grid = document.createElement('canvas');
  grid.width = cols;
  grid.height = rows;
  const gridCtx = grid.getContext('2d');
  if (!gridCtx) throw new Error('2d canvas context unavailable');
  const image = gridCtx.createImageData(cols, rows);
  const px = image.data;

  const colour = new Float32Array(3);
  /** The last hand-made change to the land that has been drawn. */
  let drawnRevision = sim.revision;
  /** Cells painted with water last frame, which have to be repainted even if now dry. */
  const wasWet = new Uint8Array(size);

  const cell = (i: number) => {
    paint(sim, i, colour);
    const p = i * 4;
    px[p] = colour[0]!;
    px[p + 1] = colour[1]!;
    px[p + 2] = colour[2]!;
    px[p + 3] = 255;
  };

  // Lay down the dry landscape once. From here on only the wet parts are revisited.
  for (let i = 0; i < size; i++) cell(i);

  /**
   * Paint a frame. `markers` off leaves out the spring rings and takes nothing else
   * with it — they are a pointer aid for finding a source you put in a dip, not part
   * of the landscape, so a picture of the landscape should not have them in it.
   */
  const draw: Draw = (preview = null, { markers = true } = {}) => {
    // A dam can go up on dry ground, which the wet-cell test below would never revisit.
    if (sim.revision !== drawnRevision) {
      drawnRevision = sim.revision;
      for (let i = 0; i < size; i++) cell(i);
    }

    for (let i = 0; i < size; i++) {
      // A cell's colour depends on its own depth and, through the display smoothing, on
      // its neighbours' — so repaint a one cell margin around the water as well.
      const wet =
        water[i] > VISIBLE ||
        (i > 0 && water[i - 1] > VISIBLE) ||
        (i < size - 1 && water[i + 1] > VISIBLE) ||
        (i >= cols && water[i - cols] > VISIBLE) ||
        (i < size - cols && water[i + cols] > VISIBLE);

      if (wet) {
        cell(i);
        wasWet[i] = 1;
      } else if (wasWet[i]) {
        // Just dried out, or just been left behind by the river: put the ground back.
        cell(i);
        wasWet[i] = 0;
      }
    }

    gridCtx.putImageData(image, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(grid, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);

    const unit = canvas.width / cols;

    // The dam being dragged out, so there is something to aim with.
    if (preview) {
      ctx.lineWidth = Math.max(3, unit * 5);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(235, 226, 205, 0.85)';
      ctx.beginPath();
      ctx.moveTo((preview.x0 + 0.5) * unit, (preview.y0 + 0.5) * unit);
      ctx.lineTo((preview.x1 + 0.5) * unit, (preview.y1 + 0.5) * unit);
      ctx.stroke();
    }

    // Spring markers, so a source you placed in a dip is still findable.
    if (!markers) return;
    ctx.lineWidth = Math.max(1, unit * 0.4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    for (const s of sim.sources) {
      ctx.beginPath();
      ctx.arc((s.x + 0.5) * unit, (s.y + 0.5) * unit, Math.max(3, unit * 1.6), 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  return { draw };
};
