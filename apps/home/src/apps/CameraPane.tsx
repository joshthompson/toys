import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { Panes } from '../os/shell';

/**
 * Josh's Camera App — the room in front of you, at a resolution this computer believes in.
 *
 * The feed is cropped to a 4:3 rectangle, boiled down to a couple of hundred pixels, cut
 * to 256 colours, and then blown back up with every one of those pixels drawn as a square.
 * Nothing here is a filter over a real picture: the picture really is this small, and the
 * screen is only showing it at a size you can see.
 *
 * How small is the one thing in the bar that isn't a choice about the picture so much as
 * a choice about the computer: the grid is the default and the point of it, but the same
 * room through the same filters at four times the grid, or at everything the camera has,
 * is a different picture rather than a bigger one.
 */

/**
 * The flash is the screen itself: white it out and it lights whatever is in front of
 * it. A webcam takes a moment to notice and settle its exposure, so the frame is kept
 * a beat after the light goes up rather than at the same instant, and the light stays
 * a moment longer so it never blinks out mid-shot.
 */
const EXPOSE_MS = 420;
const FLASH_OUT_MS = 160;

/** 'Photo 2026-08-25 20-15-32' — stamped, so no two land on the desktop under one name. */
const stamped = (label: string) => {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${label} ${date} ${time}`;
};

/** Frames a second the recording is taken at. The picture is hardly high fidelity. */
const FPS = 24;

/** How hard the recording is squeezed. Flat blocks of colour go a long way on this. */
const BITRATE = 1_200_000;

/**
 * A minute, and then it stops itself. Not for want of room — a film the computer made
 * is its own work and lands on the desktop whatever size it came out — but because a
 * camera left recording is a camera nobody meant to leave recording.
 */
const MAX_RECORD_SECONDS = 60;

/**
 * The first of these the browser will record, mp4 first.
 *
 * webm is the format browsers agree on and almost nothing else does: QuickTime won't
 * open one and the Finder won't preview one, which makes a film that lands on the
 * desktop and then can't be watched anywhere else. H.264 in an mp4 plays everywhere,
 * so it's worth asking for even though not every browser can record it — Safari and
 * Chrome will, and the ones that won't fall through to webm rather than to nothing.
 */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** Can this browser record a canvas at all? Everything current can; not everything old. */
const canRecord = () =>
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function';

/** The countdown, and the note that means it's over. A square wave, as a PC beeped. */
const COUNT_HZ = 660;
const GO_HZ = 990;
const BEEP_MS = 90;

/** '0:07' */
const clockFace = (seconds: number) => `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;

/** The grid the feed is boiled down to, one per orientation. */
const WIDE = { w: 200, h: 150 };
const TALL = { w: 150, h: 200 };

/**
 * How many grids across the picture is made.
 *
 * Everything downstream is worked out from the grid that comes back rather than assumed
 * to be 200 across — how finely the bulge gets to bend the picture, how far a saved
 * photograph is blown up on the way out — so that the multiples cost only what they
 * actually are. What they do cost is arithmetic: every filter here walks every pixel it
 * is handed, and Original hands it a megapixel sixty times a second.
 */
const PIXELS = [
  { id: 'grid', name: 'Standard', grids: 1 },
  { id: 'double', name: '2x', grids: 2 },
  { id: 'quad', name: '4x', grids: 4 },
  // No multiple of the grid at all: what the camera has, cropped to the grid's shape.
  { id: 'original', name: 'Original', grids: 0 },
] as const;

type Pixels = (typeof PIXELS)[number]['id'];

/**
 * How much bigger a saved photo is than the grid it was taken on. The blocks are drawn
 * hard, so this adds no detail — it only stops every picture viewer in the world from
 * smoothing a 200x150 thumbnail into a blur while trying to be helpful.
 */
const SAVE_SCALE = 4;

/**
 * That blow-up, for the grid actually in use: enough to carry a 200x150 picture past
 * the smoothing and no more, so that a photograph leaves this app about eight hundred
 * pixels across whichever resolution it was taken at. A picture that is already that
 * big is saved at its own size, there being nothing left to protect it from.
 */
const saveScale = (across: number) =>
  Math.max(1, Math.min(SAVE_SCALE, Math.round((WIDE.w * SAVE_SCALE) / across)));

/**
 * Bits per channel: eight reds, eight greens, four blues, which is 256 colours exactly.
 * It's the split the 8-bit displays of the era used, and for the same reason — the eye
 * picks out far less detail in blue than in the other two, so blue is where the levels
 * are taken from when there aren't enough to go round.
 */
const BITS = { r: 3, g: 3, b: 2 };

/**
 * Ordered dithering, 4x4. Four levels of blue across a sky is four visible bands, and
 * trading them for a fixed crosshatch is what every 256-colour picture of the period did.
 * Being a fixed pattern rather than noise, it sits still: a motionless shot doesn't crawl.
 *
 * Set DITHER false for flat bands instead.
 */
const DITHER = true;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Rounds a channel to `bits` worth of evenly spaced levels, 0 and 255 among them. */
const levels = (bits: number) => (1 << bits) - 1;

/**
 * How monochrome spreads what it can't represent.
 *
 * Ordered lays a fixed crosshatch over the picture and is the one that sits still: the
 * same shot dithers the same way twice. The error-diffusion pair carry the difference
 * between what a pixel was and what it became along to its neighbours, which follows
 * the shape of the picture rather than a grid — Floyd-Steinberg passes on all of it and
 * comes out finely stippled, Atkinson throws a quarter of it away, which loses some of
 * the shadow detail and gets that clean, high-contrast look an early Mac had.
 */
const DITHERS = [
  { id: 'ordered', name: 'Ordered' },
  { id: 'floyd', name: 'Floyd-Steinberg' },
  { id: 'atkinson', name: 'Atkinson' },
  { id: 'none', name: 'None' },
] as const;

type Dither = (typeof DITHERS)[number]['id'];

/** Where the error goes, as [across, down, share] from the pixel just decided. */
const FLOYD: [number, number, number][] = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
];

/** Six eighths passed on, two thrown away — which is where the contrast comes from. */
const ATKINSON: [number, number, number][] = [
  [1, 0, 1 / 8],
  [2, 0, 1 / 8],
  [-1, 1, 1 / 8],
  [0, 1, 1 / 8],
  [1, 1, 1 / 8],
  [0, 2, 1 / 8],
];

/** What the dropdown offers, in the order it offers it. */
const FILTERS = [
  { id: 'none', name: 'None' },
  { id: 'mono', name: 'Monochrome' },
  { id: 'bulge', name: 'Bulge' },
  { id: 'ghost', name: 'Ghost' },
  { id: 'outline', name: 'Outlines' },
] as const;

type Filter = (typeof FILTERS)[number]['id'];

/**
 * What the outline filter draws its lines with.
 *
 * All three find the same edges; they differ only in what the line is drawn with.
 *
 * Glowing takes the colour the edge already was and turns it all the way up, the way a
 * neon sign comes out of a long exposure — which in a room of beige walls is mostly a
 * white glow. Rainbow draws out of a spectrum instead, so the colour comes from
 * nothing in the room at all. Ink is a flat line and no colour, which is a drawing of
 * the room rather than a photograph of it.
 */
const PENS = [
  { id: 'glow', name: 'Glowing' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'ink', name: 'Ink' },
] as const;

type Pen = (typeof PENS)[number]['id'];

/**
 * What the ghost leaves behind, which is a separate question from how long it leaves
 * it for. All four hold on to the same trail; they differ only in what is painted with
 * it once the live frame has been taken out of it.
 *
 * Standard paints the trail in the colour the room was, which is a stack of fading
 * photographs of yourself. Rainbow paints it out of the wheel by how old each part of
 * it is, so a moving hand drags coloured bands behind it that owe nothing to the room.
 * White throws the colour away and keeps the brightness, which is the one that looks
 * like a ghost. Melting lets the trail slide down the picture as it fades, so the room
 * runs off the bottom of the screen.
 */
const TRACES = [
  { id: 'standard', name: 'Standard' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'white', name: 'White' },
  { id: 'melt', name: 'Melting' },
] as const;

type Trace = (typeof TRACES)[number]['id'];

/**
 * What the lines are drawn on, which is the other half of the question and worth
 * asking separately: the same rainbow is a neon sign over the room or a drawing of it
 * in coloured pencil depending only on this.
 *
 * On the video the glowing pens add their light to the picture and the ink darkens it,
 * so the room stays where it is either way. On paper the room goes entirely and only
 * the lines are left — and ink, being whatever colour the paper isn't, comes out white
 * on the black and black on the white.
 */
const GROUNDS = [
  { id: 'video', name: 'The video' },
  { id: 'black', name: 'Black' },
  { id: 'white', name: 'White' },
] as const;

type Ground = (typeof GROUNDS)[number]['id'];

/**
 * The strongest change in brightness a Sobel pass can report: four neighbours at full
 * weight, all the way from black to white. Edges are measured as a fraction of it, so
 * the dial that decides which ones survive can be a plain 0 to 1.
 */
const EDGE_MAX = 4 * 255;

/**
 * Where the dial's quiet end puts the bar an edge has to clear. Right on the slider is
 * every change in the picture, grain included; left is nothing short of the corner of
 * a wall. Past this the picture goes empty, so the slider stops here rather than
 * spending its last third on nothing.
 */
const FLOOR_MAX = 0.8;

/**
 * How hard each pen is driven.
 *
 * A webcam looking at a room almost never contains a true black-to-white step across
 * three pixels, so an edge measured honestly against one comes out at a fraction of
 * the range — which is a picture of grey lines. Both pens are therefore run well over
 * unity and clipped: an edge some way up the range lights or inks as though it were at
 * the top, and everything above that point is simply full.
 *
 * The gamma bends what is left below the clip so the faint end comes up too, rather
 * than leaving a hard line and then nothing.
 *
 * Clipping the glow rather than letting it run on is what keeps the colour in it: full
 * means the edge's own colour at full brightness, and anything past that would only
 * push all three channels into white together.
 */
const GLOW_GAMMA = 0.5;
const GLOW_GAIN = 3.5;
const INK_GAIN = 4;

/**
 * The rainbow, as how many times the spectrum is laid across the picture corner to
 * corner and how long the whole wheel takes to come round again. Laid diagonally so
 * that a face, which is mostly upright edges, is crossed by several colours at once
 * rather than being one colour that changes while you watch.
 */
const RAINBOW_BANDS = 1.5;
const RAINBOW_MS = 9000;

/**
 * A hue, as a fraction of the way round the wheel, at full colour. Three triangles a
 * third of a turn apart, which is what a hue wheel is once the arithmetic settles.
 */
const spectrum = (turn: number) => {
  const t = (turn - Math.floor(turn)) * 6;
  const ramp = (v: number) => Math.min(1, Math.max(0, v));
  return [ramp(Math.abs(t - 3) - 1), ramp(2 - Math.abs(t - 2)), ramp(2 - Math.abs(t - 4))];
};

/**
 * How far the bulge goes at the ends of its slider. The dial is a power applied to the
 * radius, so this is the exponent at one end and its reciprocal at the other, which is
 * symmetrical in the only sense that matters to the eye. Two doubles the middle of the
 * picture at full tilt; much past that and the far end of the slider is all mush.
 */
const BULGE_MAX = 2;

/**
 * How much finer than the grid a filter that moves pixels about gets to work.
 *
 * Warping the picture after it has been reduced means dragging two hundred pixels
 * around and hoping, and where the warp squeezes the picture it drops pixels entirely
 * and shimmers. So the bulge happens first, on a picture three times the width of the
 * grid, and the reduction that follows averages the result down — which is the whole
 * reason the reduction is worth doing in that order.
 *
 * Three rather than the camera's own resolution because a megapixel read back off the
 * GPU sixty times a second costs a great deal more than it shows at 200 by 150.
 */
const SUPER = 3;

/**
 * And how much finer it gets to work at the grid in use. Three times a grid four times
 * the size would be a two-megapixel frame bent and averaged every frame for a bulge
 * that already has the pixels to be smooth in — so the fine picture is held at about
 * six hundred across, which is what three times the grid was.
 */
const superFine = (across: number) =>
  Math.max(1, Math.min(SUPER, Math.round((WIDE.w * SUPER) / across)));

/**
 * The longest trail the ghost will hold, counted in frames rather than in decay,
 * because what the eye reads as trail length is roughly 1/(1 - decay) — and it is that
 * number, not the decay, that doubles when the trail looks twice as long. 250 frames
 * is a smear that takes a good four seconds to let go of the room.
 */
const MAX_TRAIL_FRAMES = 250;

/**
 * How the dial bends on its way up there. Left straight, nearly the whole of it would
 * sit in the seconds-long trails where one setting looks much like the next, and a
 * short phosphor tail would be a hair's width off zero. So it is a curve instead:
 * everything the dial used to reach is inside its first twentieth, and the remaining
 * nineteen twentieths are the long trails, which are what is new. The exponent is
 * whatever puts 5% exactly where 70% used to be.
 */
const TRAIL_CURVE = 1.58;

/** The dial's own 0–100, as the share of each frame that is left behind in the next. */
const trailDecay = (dial: number) =>
  1 - 1 / (1 + (MAX_TRAIL_FRAMES - 1) * Math.pow(dial / 100, TRAIL_CURVE));

/**
 * How many frames the rainbow trail takes to come round the wheel once. Counted in
 * frames rather than in time, unlike the rainbow the outlines are drawn with, because
 * the trail it is colouring is itself a number of frames — banding it by the clock on
 * a machine dropping frames would put the colours somewhere other than on the trail.
 */
const GHOST_WHEEL = 40;

/**
 * How much of a melting pixel's trail is taken from the pixel above it each frame. It
 * is a share rather than a step so that the trail slides down smoothly at a fraction
 * of a pixel a frame, and softens as it goes, which is what selling melting requires.
 */
const MELT_DRIFT = 0.3;

/** Rec. 601 weights: how much of the brightness the eye takes from each channel. */
const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** What a camera that won't start has to say for itself. */
const trouble = (err: unknown) => {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError')
    return "Josh's Computer isn't allowed to use the camera. Your browser will have put the permission behind the icon in its address bar.";
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return "There's no camera on this computer for Josh OS to look through.";
  if (name === 'NotReadableError')
    return 'The camera is already busy somewhere else. Close whatever has it and open this window again.';
  return err instanceof Error && err.message ? err.message : "The camera wouldn't start.";
};

export function CameraPane(props: { panes: Panes }) {
  const [error, setError] = createSignal<string | null>(null);
  const [live, setLive] = createSignal(false);
  /** Which way up the feed turned out to be. Landscape until the camera says otherwise. */
  const [size, setSize] = createSignal(WIDE);
  /** 3, 2, 1 — or nothing, which is most of the time. */
  const [countdown, setCountdown] = createSignal<number | null>(null);
  const [flash, setFlash] = createSignal(false);
  /** What the last photo was filed as, so the bar can say so while the desktop is hidden. */
  const [saved, setSaved] = createSignal<string | null>(null);
  /** The room the window has for the picture, watched so the fit keeps up with a resize. */
  const [box, setBox] = createSignal({ w: 0, h: 0 });
  const [recording, setRecording] = createSignal(false);
  /** Whether the screen lights up for a photograph. Off is a picture of the room as-is. */
  const [flashOn, setFlashOn] = createSignal(true);
  const [filter, setFilter] = createSignal<Filter>('none');
  /** How many grids across the picture is made — the whole app's, not any one filter's. */
  const [pixels, setPixels] = createSignal<Pixels>('grid');
  /** Monochrome: everything below this is black, and how many tones there are above it. */
  const [cutoff, setCutoff] = createSignal(128);
  const [tones, setTones] = createSignal(2);
  const [dither, setDither] = createSignal<Dither>('ordered');
  /** Bulge: -1 is a fish eye, 0 is the lens as it is, +1 is the same thing inside out. */
  const [bulge, setBulge] = createSignal(0);
  /** Ghost: how long the trail hangs on, as the dial's own 0–100, and what it's made of. */
  const [trail, setTrail] = createSignal(50);
  const [trace, setTrace] = createSignal<Trace>('standard');
  /** Outlines: which pen draws them, and how much of the picture it finds a line in. */
  const [pen, setPen] = createSignal<Pen>('glow');
  const [ground, setGround] = createSignal<Ground>('video');
  const [lines, setLines] = createSignal(0.8);
  /** Seconds on the clock, for the bar to count up while it records. */
  const [elapsed, setElapsed] = createSignal(0);

  /**
   * The picture, as large as it will go with all of it still on screen. Worked out here
   * rather than left to `object-fit`, because a picture that is fully visible is the
   * whole requirement and this way it does not depend on a percentage height resolving
   * through three nested flex boxes to get there. Whichever way the window is the wrong
   * shape, the difference is left as black either side.
   */
  const display = () => {
    const grid = size();
    const { w, h } = box();
    if (!w || !h) return grid;
    const scale = Math.min(w / grid.w, h / grid.h);
    return { w: Math.round(grid.w * scale), h: Math.round(grid.h * scale) };
  };

  let video!: HTMLVideoElement;
  let canvas!: HTMLCanvasElement;
  let stage!: HTMLDivElement;
  /**
   * The canvas being recorded: the picture blown up with the same hard edges the saved
   * photographs get, for the same reason. It only exists while the tape is rolling.
   */
  /** A frame being read while the same frame is written. Kept, rather than made a
      hundred and twenty kilobytes at a time, sixty times a second. */
  let scratch: Uint8ClampedArray | null = null;
  /** Where each pixel of a bulged picture comes from. Rebuilt only when the dial moves. */
  let warp: Int32Array | null = null;
  let warpKey = '';
  /**
   * What the ghost filter remembers of everything that has been in front of it.
   *
   * Floating point, and not the eight-bit picture it came from, because a trail is
   * decayed by multiplying it: rounding the result back to a whole number leaves
   * anything under half a level short of its neighbour unable to fall any further, and
   * a trail that stops falling is a hand print burnt into the room for good.
   */
  let echo: Float32Array | null = null;
  /** For the rainbow trail: how many frames it is since each pixel was last live. */
  let ages: Float32Array | null = null;
  /** Brightness per pixel, in which the error the dither passes along can be fractional. */
  let lumens: Float32Array | null = null;
  /** Where the picture is warped, before it is reduced to the grid. */
  let work: HTMLCanvasElement | null = null;
  let workCtx: CanvasRenderingContext2D | null = null;
  let tape: HTMLCanvasElement | null = null;
  let tapeCtx: CanvasRenderingContext2D | null = null;
  let recorder: MediaRecorder | null = null;
  let clock: ReturnType<typeof setInterval> | undefined;
  /** The microphone, held only for as long as it's being recorded. */
  let mic: MediaStream | null = null;
  /** Made on the first beep, since nothing may make a sound before you've clicked. */
  let sound: AudioContext | null = null;
  /** Set once the window has gone, for the awaits that outlive it. */
  let gone = false;
  /** Runs the countdown, and then the flash. Never both — one follows the other. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * One beep. Square, short and a little rude, which is what a computer of this vintage
   * had to offer. A machine with no sound at all is still a perfectly good camera, so
   * nothing here is allowed to matter enough to throw.
   */
  const beep = (hz: number) => {
    try {
      sound ??= new AudioContext();
      void sound.resume();
      const at = sound.currentTime;
      const osc = sound.createOscillator();
      const level = sound.createGain();
      osc.type = 'square';
      osc.frequency.value = hz;
      // Ramped rather than switched, or the speaker clicks either side of the note.
      level.gain.setValueAtTime(0.0001, at);
      level.gain.exponentialRampToValueAtTime(0.18, at + 0.008);
      level.gain.exponentialRampToValueAtTime(0.0001, at + BEEP_MS / 1000);
      osc.connect(level).connect(sound.destination);
      osc.start(at);
      osc.stop(at + BEEP_MS / 1000 + 0.02);
    } catch {
      // No sound. The countdown is on screen anyway.
    }
  };

  onCleanup(() => {
    gone = true;
    clearTimeout(timer);
    // Closing the window mid-flash would otherwise leave the screen white for good.
    props.panes.flash(false);
    // Stopping is also filing: closing the window keeps what was recorded rather than
    // throwing away the minute you just spent on it. It hands back the microphone too,
    // which is the only thing still held after a countdown that never finished.
    stopRecording();
    void sound?.close();
  });

  /**
   * Where every pixel of a bulged picture is read from.
   *
   * The dial is a power applied to the distance from the middle: above one, the middle
   * of the picture is drawn from a smaller circle and so comes out magnified, which is
   * a fish eye; below one it is the same thing inside out. Worked out once per setting
   * rather than per pixel per frame — it is thirty thousand square roots either way.
   */
  const bulgeMap = (w: number, h: number, amount: number) => {
    const key = `${w}x${h}:${amount.toFixed(3)}`;
    if (warpKey === key && warp) return warp;

    const map = new Int32Array(w * h);
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const radius = Math.hypot(cx, cy);
    // Right for a fish eye, left for the same lie inside out.
    const power = Math.pow(BULGE_MAX, amount);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / radius;
        const dy = (y - cy) / radius;
        const d = Math.hypot(dx, dy);
        // The exact middle has no direction to be pushed in, and needs none.
        const pull = d === 0 ? 0 : Math.pow(d, power) / d;
        // Clamped rather than left blank: the edges smear, which beats a black hole.
        const sx = Math.min(w - 1, Math.max(0, Math.round(cx + dx * pull * radius)));
        const sy = Math.min(h - 1, Math.max(0, Math.round(cy + dy * pull * radius)));
        map[y * w + x] = (sy * w + sx) * 4;
      }
    }

    warp = map;
    warpKey = key;
    return map;
  };

  const applyBulge = (px: Uint8ClampedArray, w: number, h: number, amount: number) => {
    if (!scratch || scratch.length !== px.length) scratch = new Uint8ClampedArray(px.length);
    scratch.set(px);
    const map = bulgeMap(w, h, amount);
    for (let i = 0, at = 0; i < map.length; i++, at += 4) {
      const from = map[i]!;
      px[at] = scratch[from]!;
      px[at + 1] = scratch[from + 1]!;
      px[at + 2] = scratch[from + 2]!;
    }
  };

  /**
   * Phosphor, more or less. Every frame is laid over what the last one left behind,
   * faded — so anything bright that moves drags a tail after it and takes a moment to
   * let go. Brightest-wins rather than an average, which keeps the trails glowing
   * instead of turning the whole picture into fog.
   *
   * What the trail is painted with is the trace's business, and to give it anything to
   * paint the live frame has to come back out of the composite: the trail proper is
   * only the part of it the room isn't already brighter than, which is nothing at all
   * across everything that has been sitting still. Taken as the strongest channel of
   * that difference rather than its brightness, so that a red sleeve leaves as strong
   * a trail as a white one — measured honestly, a saturated colour would be recoloured
   * into a much darker trail than the one it replaces.
   */
  const applyGhost = (
    px: Uint8ClampedArray,
    w: number,
    h: number,
    decay: number,
    how: Trace,
  ) => {
    if (!echo || echo.length !== px.length) echo = new Float32Array(px.length);
    const held = echo;
    if (how === 'rainbow' && (!ages || ages.length !== w * h)) ages = new Float32Array(w * h);
    const age = ages;

    // Bottom upwards, so that a melting pixel reads the row above while it is still
    // the row of the frame before — the whole point being that it is behind this one.
    for (let y = h - 1; y >= 0; y--) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const at = i * 4;
        // The top row has nothing above it to melt in, so it drifts into itself.
        const from = how === 'melt' && y > 0 ? at - w * 4 : at;

        let gain = 0;
        for (let c = 0; c < 3; c++) {
          // Melting drags the trail downwards by taking a share of it from above.
          const was =
            how === 'melt'
              ? held[at + c]! * (1 - MELT_DRIFT) + held[from + c]! * MELT_DRIFT
              : held[at + c]!;
          const lit = Math.max(px[at + c]!, was * decay);
          held[at + c] = lit;
          const trail = lit - px[at + c]!;
          if (trail > gain) gain = trail;
        }

        if (how === 'white') {
          // The brightness of the trail and none of its colour: smoke, rather than a
          // stack of photographs of you.
          px[at] = px[at]! + gain;
          px[at + 1] = px[at + 1]! + gain;
          px[at + 2] = px[at + 2]! + gain;
        } else if (how === 'rainbow' && age) {
          // A pixel the room is brighter than has no trail on it and is therefore new
          // again — which is what puts the start of the wheel at the moving edge and
          // walks the older bands backwards along the path the hand took.
          age[i] = gain < 1 ? 0 : age[i]! + 1;
          const hue = spectrum(age[i]! / GHOST_WHEEL);
          px[at] = px[at]! + gain * hue[0]!;
          px[at + 1] = px[at + 1]! + gain * hue[1]!;
          px[at + 2] = px[at + 2]! + gain * hue[2]!;
        } else {
          px[at] = held[at]!;
          px[at + 1] = held[at + 1]!;
          px[at + 2] = held[at + 2]!;
        }
      }
    }
  };

  /**
   * Edges, by Sobel: at every pixel, how sharply the brightness changes across and
   * down. Both come out near zero in the middle of a wall and large where an arm stops
   * and the room behind it starts, so what survives is the outline of everything in
   * front of the camera and nothing of what it is filled in with.
   *
   * Brightness is taken for the whole picture first. Each pixel needs the eight around
   * it, so working straight off the colours would compute the same luminance nine
   * times over — and the pixel being written is never one of the pixels being read.
   */
  const applyEdges = (
    px: Uint8ClampedArray,
    w: number,
    h: number,
    floor: number,
    how: Pen,
    on: Ground,
    /** Where the rainbow has got to, in turns of the wheel. Nothing to the other pens. */
    spin: number,
  ) => {
    if (!lumens || lumens.length !== w * h) lumens = new Float32Array(w * h);
    const lit = lumens;
    for (let i = 0, at = 0; i < lit.length; i++, at += 4) {
      lit[i] = luminance(px[at]!, px[at + 1]!, px[at + 2]!);
    }

    /** The picture has no pixel outside it, so its edge repeats rather than falls off. */
    const bright = (x: number, y: number) =>
      lit[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
    // Everything below the dial is nothing; everything above it is spread over the
    // whole range again, so the brightest line is a full one wherever the dial sits.
    const span = Math.max(0.01, 1 - floor);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tl = bright(x - 1, y - 1);
        const tm = bright(x, y - 1);
        const tr = bright(x + 1, y - 1);
        const ml = bright(x - 1, y);
        const mr = bright(x + 1, y);
        const bl = bright(x - 1, y + 1);
        const bm = bright(x, y + 1);
        const br = bright(x + 1, y + 1);
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bm + br - (tl + 2 * tm + tr);
        const edge = Math.min(1, Math.hypot(gx, gy) / EDGE_MAX);
        const line = Math.min(1, Math.max(0, (edge - floor) / span));

        const i = (y * w + x) * 4;
        // How much of the pixel the line covers: ink goes solid a quarter of the way
        // up the range and the glowing pens a little under a third, both of them well
        // over what the edge honestly measured, for the reason given at the gains.
        const cover =
          how === 'ink'
            ? Math.min(1, line * INK_GAIN)
            : Math.min(1, Math.pow(line, GLOW_GAMMA) * GLOW_GAIN);

        // What the line is drawn in. Taken before anything is written, since glowing
        // reads the colour of the very pixel it is about to cover.
        let r: number;
        let g: number;
        let b: number;
        if (how === 'rainbow') {
          // A diagonal band walking round the wheel: the colour owes nothing to the
          // room, so a white wall in white light still comes out in colour.
          const hue = spectrum(((x + y) / (w + h)) * RAINBOW_BANDS + spin);
          r = hue[0]! * 255;
          g = hue[1]! * 255;
          b = hue[2]! * 255;
        } else if (how === 'glow') {
          // The colour the edge already was, turned all the way up, so a red collar
          // glows red rather than pink. A pixel too near black to have a colour left
          // in it glows white, there being nothing else for it to be.
          const top = Math.max(px[i]!, px[i + 1]!, px[i + 2]!);
          const gain = top < 8 ? 0 : 255 / top;
          r = top < 8 ? 255 : px[i]! * gain;
          g = top < 8 ? 255 : px[i + 1]! * gain;
          b = top < 8 ? 255 : px[i + 2]! * gain;
        } else {
          r = g = b = on === 'black' ? 255 : 0;
        }

        if (on === 'video') {
          if (how === 'ink') {
            // Drawn on, not drawn over: the room comes through everywhere the pen
            // hasn't been, and goes to black where it has.
            px[i] = px[i]! * (1 - cover);
            px[i + 1] = px[i + 1]! * (1 - cover);
            px[i + 2] = px[i + 2]! * (1 - cover);
          } else {
            // Light added to what is already there, so nothing is added where there
            // was no edge. Over 255 is clamped on the way into the array, which is
            // what burning out looks like.
            px[i] = px[i]! + r * cover;
            px[i + 1] = px[i + 1]! + g * cover;
            px[i + 2] = px[i + 2]! + b * cover;
          }
          continue;
        }

        // Paper: the room is gone and there is only the line and what it is on.
        const paper = on === 'black' ? 0 : 255;
        px[i] = paper + (r - paper) * cover;
        px[i + 1] = paper + (g - paper) * cover;
        px[i + 2] = paper + (b - paper) * cover;
      }
    }
  };

  /**
   * Down to greys, or to black and white, which is what two tones comes to.
   *
   * Black takes everything up to the cutoff and the tones share out what is left, so at
   * two the cutoff is a plain threshold and at more it is where the shadows stop. The
   * dither works between neighbouring tones, which is how a newspaper managed pictures
   * with one ink — and at two tones it is most of what you are looking at.
   */
  const applyMono = (
    px: Uint8ClampedArray,
    w: number,
    h: number,
    dark: number,
    steps: number,
    how: Dither,
  ) => {
    const top = steps - 1;
    const span = Math.max(1, 255 - dark);
    /** The nearest tone this brightness is allowed to be. */
    const nearest = (lit: number) => {
      const level = lit <= dark ? 0 : Math.min(top, 1 + Math.floor(((lit - dark) / span) * top));
      return Math.round((level / top) * 255);
    };

    if (how === 'ordered' || how === 'none') {
      // A fixed pattern, or nothing at all — either way one pass and no bookkeeping.
      const step = span / top;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const nudge = how === 'ordered' ? (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * step : 0;
          const grey = nearest(luminance(px[i]!, px[i + 1]!, px[i + 2]!) + nudge);
          px[i] = grey;
          px[i + 1] = grey;
          px[i + 2] = grey;
        }
      }
      return;
    }

    // Error diffusion, which needs somewhere to carry a fraction of a tone about.
    if (!lumens || lumens.length !== w * h) lumens = new Float32Array(w * h);
    for (let i = 0, at = 0; i < lumens.length; i++, at += 4) {
      lumens[i] = luminance(px[at]!, px[at + 1]!, px[at + 2]!);
    }

    const spread = how === 'floyd' ? FLOYD : ATKINSON;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const was = lumens[i]!;
        const grey = nearest(was);
        const owed = was - grey;

        for (const [across, down, share] of spread) {
          const nx = x + across;
          const ny = y + down;
          // Off the edge is off the books: nobody is left to pass it on to.
          if (nx < 0 || nx >= w || ny >= h) continue;
          const at = ny * w + nx;
          lumens[at] = lumens[at]! + owed * share;
        }

        const at = i * 4;
        px[at] = grey;
        px[at + 1] = grey;
        px[at + 2] = grey;
      }
    }
  };

  // Whatever the ghost was holding on to belongs to the filter, not to the camera.
  // The traces all hold the same trail, though, so switching between them keeps it.
  createEffect(() => {
    filter();
    echo = null;
    ages = null;
  });

  /** The flash is the whole screen, so the OS works it. This pane only says when. */
  const setLit = (lit: boolean) => {
    setFlash(lit);
    props.panes.flash(lit);
  };

  /** Call the whole thing off — the button turns into this while it's counting. */
  const cancel = () => {
    clearTimeout(timer);
    setCountdown(null);
    // A microphone taken for a film that never happened is one to hand straight back.
    mic?.getTracks().forEach((track) => track.stop());
    mic = null;
  };

  // Escape gets you out of it too, wherever the keys happen to be pointing.
  createEffect(() => {
    if (countdown() === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  /**
   * Take the picture. What lands on the desktop is what the window is showing, blown up
   * with the same hard edges: saved at its own 200x150 it would be a thumbnail, and
   * every viewer in the world would smooth the blocks away trying to be helpful.
   *
   * Not mirrored, though the preview is. A self-view is a mirror because that is what
   * you expect of your own face while you arrange it; a photograph is a photograph, and
   * anything written in it should read the right way round.
   */
  const take = () => {
    const grid = size();

    const shot = document.createElement('canvas');
    const blowUp = saveScale(grid.w);
    shot.width = grid.w * blowUp;
    shot.height = grid.h * blowUp;
    const ctx = shot.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, shot.width, shot.height);

    const name = `${stamped('Photo')}.png`;
    shot.toBlob((blob) => {
      if (!blob) return;
      props.panes.saveToDesktop(name, blob);
      setSaved(name);
    }, 'image/png');
  };

  /**
   * Light the room with the screen, give the camera a beat to catch up, then shoot —
   * or, with the flash switched off, simply shoot.
   */
  const illuminate = () => {
    setCountdown(null);
    if (!flashOn()) return take();
    setLit(true);
    timer = setTimeout(() => {
      take();
      timer = setTimeout(() => setLit(false), FLASH_OUT_MS);
    }, EXPOSE_MS);
  };

  const stopRecording = () => {
    clearInterval(clock);
    // The stop is what saves it: the recorder hands over its last chunk on the way out.
    if (recorder?.state !== 'inactive') recorder?.stop();
    // Let the microphone go the moment it stops being needed, rather than leaving the
    // browser's little red light on over a camera app that isn't recording anything.
    mic?.getTracks().forEach((track) => track.stop());
    mic = null;
    setRecording(false);
  };

  /**
   * Roll. What gets recorded is the same blown-up picture a photograph gets, at a rate
   * this resolution deserves and a bitrate that keeps the whole thing inside what the
   * desktop will take — and if it creeps up on that anyway, it stops itself rather than
   * handing over a file that gets turned away at the door.
   */
  const startRecording = () => {
    const grid = size();
    tape = document.createElement('canvas');
    const blowUp = saveScale(grid.w);
    tape.width = grid.w * blowUp;
    tape.height = grid.h * blowUp;
    tapeCtx = tape.getContext('2d');
    if (!tapeCtx) return;
    tapeCtx.imageSmoothingEnabled = false;

    const rolling = tape.captureStream(FPS);
    mic?.getAudioTracks().forEach((track) => rolling.addTrack(track));

    const type = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(rolling, {
      ...(type ? { mimeType: type } : {}),
      videoBitsPerSecond: BITRATE,
    });

    const reels: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size) reels.push(e.data);
    };

    recorder.onstop = () => {
      tape = null;
      tapeCtx = null;
      if (!reels.length) return;
      const film = new Blob(reels, { type: reels[0]!.type || type });
      // Named for what came out, not for what was asked for.
      const name = `${stamped('Video')}.${film.type.includes('mp4') ? 'mp4' : 'webm'}`;
      props.panes.saveToDesktop(name, film);
      setSaved(name);
    };

    // A chunk a second, which is also how often the running total can be checked.
    recorder.start(1000);
    setElapsed(0);
    setRecording(true);
    clock = setInterval(() => {
      const seconds = elapsed() + 1;
      setElapsed(seconds);
      if (seconds >= MAX_RECORD_SECONDS) stopRecording();
    }, 1000);
  };

  /**
   * Three, two, one — a beep on each, and a higher one the moment it's over, so you can
   * keep your eyes on the camera rather than on the number.
   */
  const countFrom = (then: () => void) => {
    const tick = (n: number) => {
      setCountdown(n);
      beep(COUNT_HZ);
      timer = setTimeout(() => {
        if (n > 1) return tick(n - 1);
        setCountdown(null);
        beep(GO_HZ);
        then();
      }, 1000);
    };
    tick(3);
  };

  /** Whether anything is already under way. Both buttons wait their turn. */
  const busy = () => !live() || countdown() !== null || flash() || recording();

  /** Three seconds to arrange your face. */
  const capture = () => {
    if (busy()) return;
    countFrom(illuminate);
  };

  /**
   * The same three seconds, and then the tape rolls.
   *
   * The microphone is asked for first, before any counting: a permission prompt landing
   * on '2' would be a film of somebody reading a dialog box. Refuse it, or have no
   * microphone at all, and the film is simply a silent one.
   */
  const film = async () => {
    if (busy()) return;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      mic = null;
    }
    if (gone) {
      mic?.getTracks().forEach((track) => track.stop());
      return;
    }
    countFrom(startRecording);
  };

  onMount(() => {
    // Registered before anything is awaited: after an await this is no longer inside the
    // component's scope, and a cleanup registered there never runs. The camera light
    // staying on after the window closes is not a mistake worth risking.
    let stream: MediaStream | null = null;
    let frame = 0;
    let closed = false;

    onCleanup(() => {
      closed = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    });

    // Fetched once. Asking every frame returns the same context and quietly ignores the
    // attribute, and this one matters: the frame is read straight back out again.
    let ctx: CanvasRenderingContext2D | null = null;

    const watch = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height });
    });
    watch.observe(stage);
    onCleanup(() => watch.disconnect());

    const paint = () => {
      frame = requestAnimationFrame(paint);

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // HAVE_CURRENT_DATA: there is a frame to draw.
      if (!vw || !vh || video.readyState < 2) return;

      // Portrait cameras get the portrait grid, and turning the phone re-sizes the canvas.
      const base = vw >= vh ? WIDE : TALL;

      // The largest rectangle of that shape that the feed contains, taken from the
      // middle: a wide camera loses its sides, a tall one its top and bottom. Worked
      // out from the orientation rather than from the grid below, which is the same
      // shape at every resolution and at Original is decided by this.
      const wanted = base.w / base.h;
      const sw = vw / vh > wanted ? vh * wanted : vw;
      const sh = vw / vh > wanted ? vh : vw / wanted;
      const sx = (vw - sw) / 2;
      const sy = (vh - sh) / 2;

      const grids = PIXELS.find((p) => p.id === pixels())!.grids;
      const grid = grids
        ? { w: base.w * grids, h: base.h * grids }
        : { w: Math.round(sw), h: Math.round(sh) };

      // By value, not by identity: past the grid itself these are worked out afresh
      // every frame, and a new object every frame would be a new size every frame.
      const had = size();
      if (had.w !== grid.w || had.h !== grid.h) {
        setSize(grid);
        // Nothing any of these holds lines up with the new shape.
        echo = null;
        ages = null;
        work = null;
      }
      if (canvas.width !== grid.w) canvas.width = grid.w;
      if (canvas.height !== grid.h) canvas.height = grid.h;

      ctx ??= canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      if (filter() === 'bulge' && bulge() !== 0) {
        // Bent finer than the grid, then averaged down onto it.
        const fine = superFine(grid.w);
        const w = grid.w * fine;
        const h = grid.h * fine;
        if (!work || work.width !== w || work.height !== h) {
          work = document.createElement('canvas');
          work.width = w;
          work.height = h;
          workCtx = work.getContext('2d', { willReadFrequently: true });
        }
        if (!workCtx) return;

        workCtx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
        const wide = workCtx.getImageData(0, 0, w, h);
        applyBulge(wide.data, w, h, bulge());
        workCtx.putImageData(wide, 0, 0);
        ctx.drawImage(work, 0, 0, w, h, 0, 0, grid.w, grid.h);
      } else {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, grid.w, grid.h);
      }

      const picture = ctx.getImageData(0, 0, grid.w, grid.h);
      const px = picture.data;
      const chosen = filter();

      // The bulge has already happened, above, at a resolution worth bending. These two
      // belong here instead: the ghost reads the same either side of the reduction and
      // would cost a megabyte a frame to keep at full size, and monochrome is a colour
      // stage — reducing to greys and then averaging them back together would undo it.
      if (chosen === 'ghost')
        applyGhost(px, grid.w, grid.h, trailDecay(trail()), trace());
      if (chosen === 'outline') {
        // The wheel is walked by the clock rather than by the frame, so it comes round
        // at the same speed on a computer struggling to keep up as on one that isn't.
        const spin = performance.now() / RAINBOW_MS;
        applyEdges(px, grid.w, grid.h, (1 - lines()) * FLOOR_MAX, pen(), ground(), spin);
      }

      if (chosen === 'mono') {
        // Its own handful of greys, so it skips the 256: putting an even grey through
        // three reds, three greens and two blues would come out faintly tinted.
        applyMono(px, grid.w, grid.h, cutoff(), tones(), dither());
      } else if (chosen !== 'outline' || pen() !== 'ink' || ground() === 'video') {
        // Ink on paper is skipped for the reason monochrome above it is: it comes out
        // black and white already, and a tinted line drawing is a smudged one. Ink on
        // the video is a colour picture with lines drawn on it, and goes through the
        // palette like everything else does.
        for (let y = 0; y < grid.h; y++) {
          for (let x = 0; x < grid.w; x++) {
            const i = (y * grid.w + x) * 4;
            // Half a level either way, by a pattern that repeats every four pixels.
            const nudge = DITHER ? BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.5 : 0;
            px[i] = quantise(px[i]!, BITS.r, nudge);
            px[i + 1] = quantise(px[i + 1]!, BITS.g, nudge);
            px[i + 2] = quantise(px[i + 2]!, BITS.b, nudge);
          }
        }
      }
      ctx.putImageData(picture, 0, 0);

      // Blown up onto the tape with the blocks kept square, the same as a photograph.
      if (tape && tapeCtx) tapeCtx.drawImage(canvas, 0, 0, tape.width, tape.height);
    };

    const start = async () => {
      // No camera at all over plain http, which is the browser's rule and not ours.
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('The camera only works over https, or on localhost.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
      } catch (err) {
        if (!closed) setError(trouble(err));
        return;
      }

      // The window can be closed while the permission prompt is still up, in which case
      // the cleanup has already run and this stream is one nobody is going to switch off.
      if (closed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (err) {
        if (!closed) setError(trouble(err));
        return;
      }

      if (closed) return;
      setLive(true);
      paint();
    };

    void start();
  });

  return (
    <div class="camera-pane">
      <div class="camera-stage" ref={stage}>
        <Show when={!error()} fallback={<p class="camera-message">{error()}</p>}>
          {/* Sized to fit, never to crop; the black either side of it is the bars. */}
          <canvas
            ref={canvas}
            style={{
              width: `${display().w}px`,
              height: `${display().h}px`,
              /* Square blocks are the point of the app while the picture is being
                 magnified, which at the grid it always is. At the larger resolutions in
                 a small window it is being shrunk instead, and nearest-neighbour
                 shrinking throws away whole pixels and shimmers as anything moves — so
                 that case is smoothed, the same as any other photograph would be. */
              'image-rendering': display().w < size().w ? 'auto' : 'pixelated',
            }}
          />
          <Show when={!live()}>
            <p class="camera-message is-over">Starting the camera…</p>
          </Show>

          <Show when={countdown()}>
            {(n) => (
              <div class="camera-count" aria-live="assertive">
                {n()}
              </div>
            )}
          </Show>


        </Show>

        {/* Kept in the layout, and out of sight, so the browser goes on decoding frames. */}
        <video ref={video} class="camera-source" />
      </div>


      {/* Only the filter in use gets to put dials on the desktop. */}
      <Show when={filter() !== 'none'}>
        <div class="camera-dials">
          <Switch>
            <Match when={filter() === 'mono'}>
              <label>
                Black below
                <input
                  type="range"
                  min="0"
                  max="255"
                  value={cutoff()}
                  onInput={(e) => setCutoff(e.currentTarget.valueAsNumber)}
                />
                <output>{cutoff()}</output>
              </label>
              <label>
                Tones
                <input
                  type="range"
                  min="2"
                  max="8"
                  value={tones()}
                  onInput={(e) => setTones(e.currentTarget.valueAsNumber)}
                />
                <output>{tones()}</output>
              </label>
              <label>
                Dither
                <select
                  value={dither()}
                  onChange={(e) => setDither(e.currentTarget.value as Dither)}
                >
                  <For each={DITHERS}>{(d) => <option value={d.id}>{d.name}</option>}</For>
                </select>
              </label>
            </Match>

            <Match when={filter() === 'bulge'}>
              <label class="is-wide">
                Inside out
                {/* Middle is the lens as it is; either end is a different lie about it. */}
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={Math.round(bulge() * 100)}
                  onInput={(e) => setBulge(e.currentTarget.valueAsNumber / 100)}
                />
                Fish eye
              </label>
            </Match>

            <Match when={filter() === 'ghost'}>
              <label>
                Style
                <select
                  value={trace()}
                  onChange={(e) => setTrace(e.currentTarget.value as Trace)}
                >
                  <For each={TRACES}>{(t) => <option value={t.id}>{t.name}</option>}</For>
                </select>
              </label>
              <label class="is-wide">
                Trail
                {/* The dial is kept as its own 0–100; TRAIL_CURVE says what that means. */}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={trail()}
                  onInput={(e) => setTrail(e.currentTarget.valueAsNumber)}
                />
                <output>{trail()}%</output>
              </label>
            </Match>

            <Match when={filter() === 'outline'}>
              <label>
                Pen
                <select value={pen()} onChange={(e) => setPen(e.currentTarget.value as Pen)}>
                  <For each={PENS}>{(p) => <option value={p.id}>{p.name}</option>}</For>
                </select>
              </label>
              <label>
                On
                <select
                  value={ground()}
                  onChange={(e) => setGround(e.currentTarget.value as Ground)}
                >
                  <For each={GROUNDS}>{(g) => <option value={g.id}>{g.name}</option>}</For>
                </select>
              </label>
              <label>
                Lines
                {/* Left draws only the edges the room is actually made of; right finds
                    a line in every change in the picture, the sensor's grain included. */}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(lines() * 100)}
                  onInput={(e) => setLines(e.currentTarget.valueAsNumber / 100)}
                />
                <output>{Math.round(lines() * 100)}</output>
              </label>
            </Match>
          </Switch>
        </div>
      </Show>

      <footer class="camera-bar">
        <button
          class="chrome-button"
          title={
            countdown() === null
              ? 'Three seconds, then the picture goes on the desktop'
              : 'Call it off (Esc)'
          }
          // Only the moment between the light going up and the picture being taken is
          // beyond calling off, and it is shorter than it takes to reach for the mouse.
          aria-disabled={!live() || flash() || recording()}
          onClick={() => (countdown() === null ? capture() : cancel())}
        >
          <Show when={countdown() === null} fallback="Cancel">
            <span aria-hidden="true">📷</span> Take Photo
          </Show>
        </button>

        <Show when={canRecord()}>
          <button
            class="chrome-button"
            title={recording() ? 'Stop, and put the film on the desktop' : 'Record a film'}
            aria-disabled={!live() || countdown() !== null || flash()}
            onClick={() => (recording() ? stopRecording() : void film())}
          >
            <Show
              when={recording()}
              fallback={
                <>
                  <span aria-hidden="true">⏺</span> Record
                </>
              }
            >
              <span aria-hidden="true">⏹</span> Stop {clockFace(elapsed())}
            </Show>
          </button>
        </Show>

        <label class="camera-check">
          <input
            type="checkbox"
            checked={flashOn()}
            onChange={(e) => setFlashOn(e.currentTarget.checked)}
          />
          Flash
        </label>

        <label class="camera-pick">
          Filter
          <select
            value={filter()}
            onChange={(e) => setFilter(e.currentTarget.value as Filter)}
          >
            <For each={FILTERS}>{(f) => <option value={f.id}>{f.name}</option>}</For>
          </select>
        </label>

        <label class="camera-pick">
          Pixels
          <select
            value={pixels()}
            onChange={(e) => setPixels(e.currentTarget.value as Pixels)}
          >
            <For each={PIXELS}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </select>
        </label>

        <span class="camera-status">
          <Show when={!recording()}>
            <Show when={saved()}>{(name) => <>Saved to the desktop as {name()}</>}</Show>
          </Show>
          <Show when={recording()}>
            <span class="camera-rolling">
              ● Recording {clockFace(elapsed())} of {clockFace(MAX_RECORD_SECONDS)}
            </span>
          </Show>
        </span>
      </footer>
    </div>
  );
}

/** One channel, rounded to its nearest allowed level after the dither's nudge. */
function quantise(value: number, bits: number, nudge: number) {
  const steps = levels(bits);
  const shifted = value + (nudge * 255) / steps;
  const level = Math.round((Math.min(255, Math.max(0, shifted)) * steps) / 255);
  return Math.round((level * 255) / steps);
}
