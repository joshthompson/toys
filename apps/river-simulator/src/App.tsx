import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { generateTerrain } from './terrain';
import { createSim, type Sim } from './sim';
import { createRenderer, type Preview } from './render';
import { CELL } from './scale';

/** Simulation steps per animation frame at 1x, and the time each one advances. */
const SUBSTEPS = 3;
const DT = 0.05;

/** Speeds offered in the dropdown, as multiples of the normal rate. */
const SPEEDS = [1, 3, 5, 10, 25, 100];

/**
 * How long one frame may spend stepping the simulation, in milliseconds.
 *
 * The upper multipliers ask for more work than a frame can hold: a step over a full-screen
 * grid costs a millisecond or two, so 100x is a few hundred of them — long enough per frame
 * that the page would stop answering. So a frame runs what fits in its budget and leaves the
 * rest, and the readout reports the rate actually being managed instead of pretending.
 *
 * Asking for a big multiplier is a way of saying you would rather have progress than a
 * smooth picture, so the budget grows with it — up to a limit, past which the page stops
 * feeling like it is responding at all.
 */
const BUDGET_FLOOR = 30;
const BUDGET_LIMIT = 250;
/** Milliseconds allowed per requested multiple, roughly what a step costs on a full screen. */
const BUDGET_PER_X = 10;

/** Milliseconds of stepping allowed per frame at a given speed. */
const frameBudget = (speed: number) =>
  Math.min(BUDGET_LIMIT, Math.max(BUDGET_FLOOR, speed * BUDGET_PER_X));

/**
 * How much water a spring produces per unit time.
 *
 * Sized so one spring fills roughly the channel it carves. Turn it up much and the
 * valley cannot carry it away, so it backs up and floods rather than flowing.
 */
const SPRING = 2.5;
/** Click within this many cells of a spring to remove it. */
const PICK = 4;

const randomSeed = () => Math.floor(Math.random() * 0xffffff);

export const App = () => {
  let canvas!: HTMLCanvasElement;

  const [springs, setSprings] = createSignal(0);
  const [moved, setMoved] = createSignal(0);
  const [drained, setDrained] = createSignal(0);
  const [volume, setVolume] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [speed, setSpeed] = createSignal(1);
  /** The rate actually being kept up with, which at the high settings is less than asked. */
  const [actual, setActual] = createSignal(1);
  /** What a drag on the map does: start a spring, or lay out a dam. */
  const [tool, setTool] = createSignal<'spring' | 'dam'>('spring');
  /** Asked when the window has changed size, since rebuilding throws the landscape away. */
  const [resized, setResized] = createSignal(false);

  /** The dam being dragged out, drawn as a line until the pointer comes up. */
  const [preview, setPreview] = createSignal<Preview>(null);

  let sim: Sim | null = null;
  let draw: (preview?: Preview) => void = () => {};

  /** The grid that would fill the window as it is now. */
  const windowCells = () => ({
    cols: Math.max(32, Math.ceil(window.innerWidth / CELL)),
    rows: Math.max(32, Math.ceil(window.innerHeight / CELL)),
  });

  /** (Re)build the world at the current window size. */
  const build = (seed: number) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { cols, rows } = windowCells();

    // One altitude point per CELL css pixels; the backing store is scaled by the
    // device pixel ratio so the blocks land on whole device pixels and stay sharp.
    canvas.style.width = `${cols * CELL}px`;
    canvas.style.height = `${rows * CELL}px`;
    canvas.width = Math.round(cols * CELL * dpr);
    canvas.height = Math.round(rows * CELL * dpr);

    sim = createSim(cols, rows, generateTerrain(cols, rows, seed));
    draw = createRenderer(canvas, sim).draw;
    setResized(false);
    showScrollbars();
    setSprings(0);
    setMoved(0);
    setVolume(0);
    setDrained(0);
    setActual(speed());
  };

  /**
   * Let the page scroll only when the map is larger than the window.
   *
   * Keeping a map after the window has shrunk leaves it hanging off the bottom and the right,
   * so the rest of it has to be reachable. The map is always a whole number of cells and so
   * overshoots the window by a couple of pixels at most, which is why this needs a tolerance
   * rather than a plain comparison — otherwise there would be scrollbars all the time.
   */
  const showScrollbars = () => {
    const over =
      canvas.clientWidth > window.innerWidth + CELL || canvas.clientHeight > window.innerHeight + CELL;
    document.documentElement.classList.toggle('scrolls', over);
  };

  /** How much of the asked-for speed the frames are actually managing. */
  const keepingUp = () => actual() / speed();

  /** Which altitude point a pointer event landed on. */
  const cellAt = (e: PointerEvent | MouseEvent) => {
    if (!sim) return null;
    const box = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * sim.cols);
    const y = Math.floor(((e.clientY - box.top) / box.height) * sim.rows);
    if (x < 0 || x >= sim.cols || y < 0 || y >= sim.rows) return null;
    return { x, y };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!sim) return;
    const cell = cellAt(e);
    if (!cell) return;

    // Shift-click or right-click takes a spring away again.
    if (e.shiftKey || e.button === 2) {
      if (sim.removeSourceNear(cell.x, cell.y, PICK)) setSprings(sim.sources.length);
      return;
    }
    if (e.button !== 0) return;

    if (tool() === 'dam') {
      // Start the line here; it follows the pointer until it comes back up.
      setPreview({ x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y });
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // A spring needs dry land to run down; below sea level there is nowhere to go.
    if (sim.land[cell.y * sim.cols + cell.x]! <= 0) return;

    sim.addSource(cell.x, cell.y, SPRING);
    setSprings(sim.sources.length);
  };

  const onPointerMove = (e: PointerEvent) => {
    const line = preview();
    if (!line) return;
    const cell = cellAt(e);
    if (cell) setPreview({ x0: line.x0, y0: line.y0, x1: cell.x, y1: cell.y });
  };

  const onPointerUp = () => {
    const line = preview();
    setPreview(null);
    if (line && sim) sim.raiseLine(line.x0, line.y0, line.x1, line.y1);
  };

  onMount(() => {
    build(randomSeed());

    let frame = 0;
    /** Steps a frame has been managing lately, smoothed so the readout doesn't flicker. */
    let stepsPerFrame = SUBSTEPS;

    let raf = requestAnimationFrame(function loop() {
      if (sim && !paused()) {
        const wanted = SUBSTEPS * speed();
        const deadline = performance.now() + frameBudget(speed());
        let done = 0;

        while (done < wanted) {
          sim.step(DT);
          done++;
          if (done < wanted && performance.now() >= deadline) break;
        }

        stepsPerFrame += (done - stepsPerFrame) * 0.1;
      }
      draw(preview());

      // The readouts only need to be readable, not frame-accurate.
      if (sim && ++frame % 15 === 0) {
        setMoved(sim.moved);
        setVolume(sim.volume());
        setDrained(sim.drained);
        setActual(stepsPerFrame / SUBSTEPS);
      }

      raf = requestAnimationFrame(loop);
    });
    onCleanup(() => cancelAnimationFrame(raf));

    // Rebuilding throws the landscape away, so ask first — and wait for the drag to settle
    // before asking, or the question arrives once per pixel of a slow drag.
    let resizing: number | undefined;
    const onResize = () => {
      clearTimeout(resizing);
      resizing = window.setTimeout(() => {
        if (!sim) return;
        const wanted = windowCells();
        if (wanted.cols === sim.cols && wanted.rows === sim.rows) return;
        setResized(true);
        // Make the rest of the map reachable straight away, while the question stands.
        showScrollbars();
      }, 250);
    };
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));

    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === 'c' && sim) {
        sim.clearWater();
        setSprings(0);
      }
      if (e.key === 'n') build(randomSeed());
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <>
      <canvas
        ref={canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setPreview(null)}
        onContextMenu={(e) => e.preventDefault()}
      />

      {resized() && (
        <div class="ask">
          <p>
            The window has changed size. Start again at the new size, or keep this landscape
            where it is?
          </p>
          <span class="ask-buttons">
            <button onClick={() => build(randomSeed())}>New map</button>
            <button
              onClick={() => {
                setResized(false);
                showScrollbars();
              }}
            >
              Keep this one
            </button>
          </span>
        </div>
      )}

      <div class="hud">
        <span class="hint">
          {tool() === 'dam' ? (
            <>
              <b>Drag</b> to build a dam
            </>
          ) : (
            <>
              <b>Click</b> to add a spring
            </>
          )}
        </span>
        <span class="hint wide">
          <b>Shift-click</b> to remove a spring
        </span>
        <span class="stat">
          springs <b>{springs()}</b>
        </span>
        <span class="stat wide">
          water <b>{volume().toFixed(0)}</b>
        </span>
        <span class="stat wide">
          eroded <b>{moved().toFixed(0)}</b>
        </span>
        <span class="stat wide">
          to sea <b>{drained().toFixed(0)}</b>
        </span>

        {/* Always present, empty while keeping up, so the row doesn't shift about. */}
        <span class="stat throttled" title="The frames can't keep up with the speed chosen">
          {keepingUp() < 0.9 ? `running ${actual() < 10 ? actual().toFixed(1) : actual().toFixed(0)}×` : ''}
        </span>

        <span class="buttons">
          <span class="tools">
            <button
              classList={{ active: tool() === 'spring' }}
              onClick={() => {
                setTool('spring');
                setPreview(null);
              }}
            >
              Spring
            </button>
            <button classList={{ active: tool() === 'dam' }} onClick={() => setTool('dam')}>
              Dam
            </button>
          </span>

          <select
            aria-label="Simulation speed"
            onChange={(e) => setSpeed(Number(e.currentTarget.value) || 1)}
          >
            <For each={SPEEDS}>
              {(n) => (
                <option value={n} selected={n === speed()}>
                  {n}×
                </option>
              )}
            </For>
          </select>
          <button onClick={() => setPaused((p) => !p)}>{paused() ? 'Play' : 'Pause'}</button>
          <button
            onClick={() => {
              sim?.clearWater();
              setSprings(0);
            }}
          >
            Dry off
          </button>
          <button onClick={() => build(randomSeed())}>New land</button>
        </span>
      </div>
    </>
  );
};
