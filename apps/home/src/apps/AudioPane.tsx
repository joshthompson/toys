import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { downloadFile, formatBytes } from '../os/files';
import { createTransport, MediaBar } from '../shared/media';
import type { Menu } from '../os/osApi';
import { AUDIO_APP, type Panes } from '../os/shell';

type Props = {
  fileId: string;
  panes: Panes;
  onTitle: (title: string) => void;
  /** Hand the window a menu bar. An accessor, so the greyed-out items keep up. */
  onMenus: (menus: () => Menu[], select: (id: string) => void) => void;
};

/** Frequency bins. Small enough that the bars stay chunky rather than hair-thin. */
const FFT_SIZE = 512;
/** Bins at the bottom of the spectrum that count as the beat. */
const BASS_BINS = 8;
/** How far above its own running average the bass has to jump to be a beat. */
const BEAT_RATIO = 1.32;
/** And how loud it has to be at all, so silence doesn't read as a beat every frame. */
const BEAT_FLOOR = 24;
/** No two beats closer together than this, whatever the music does. */
const BEAT_GAP_MS = 180;
/** Segments in the worm, head first. */
const WORM_SEGMENTS = 16;
/** Rays in the backdrop's starburst. */
const RAYS = 56;

const WORM_BODY = '#7ee34a';
const WORM_HEAD = '#a4f56d';
const WORM_DARK = '#2f7a1c';

/**
 * Josh's Listening To Stuff App.
 *
 * The sound is piped through an analyser on its way to the speakers, which gives the
 * canvas a spectrum to draw and a bass level to find the beat in. Behind, a starburst
 * and a waveform in the manner of the media player everyone had; in front, a worm,
 * dancing.
 */
export function AudioPane(props: Props) {
  const [id, setId] = createSignal(props.fileId);
  const transport = createTransport();
  let canvas!: HTMLCanvasElement;
  let audio!: HTMLAudioElement;

  const tracks = () => props.panes.filesOfKind('audio');
  const at = () => tracks().findIndex((t) => t.id === id());
  const current = () => props.panes.fileById(id());

  /**
   * Move `by` tracks along, wrapping. Carries on playing if it already was — or if the
   * last track just ran out, which is the whole point of a next track.
   */
  const step = (by: number, thenPlay = transport.playing()) => {
    const all = tracks();
    if (all.length < 2) return;
    const here = at();
    const next = all[here < 0 ? 0 : (here + by + all.length) % all.length];
    setId(next.id);
    props.onTitle(`${next.name} — ${AUDIO_APP}`);
    // The new file has to have loaded before it can be told to play.
    if (thenPlay) audio.addEventListener('canplay', () => transport.play(), { once: true });
  };

  /** The same File menu the other media apps have. */
  const menus = (): Menu[] => [
    {
      label: 'File',
      items: [{ id: 'download', label: 'Download Sound', disabled: !current() }],
    },
  ];

  onMount(() => {
    props.onMenus(menus, (pick) => {
      const file = current();
      if (pick === 'download' && file) downloadFile(file);
    });

    transport.attach(audio);

    // Run out of track and the next one takes over, as a music player should.
    const advance = () => step(1, true);
    audio.addEventListener('ended', advance);
    onCleanup(() => audio.removeEventListener('ended', advance));

    /**
     * The analyser can only be wired up once per element, and only after a gesture —
     * browsers hand back a suspended context otherwise. So it's built on first play
     * and kept for the life of the window.
     */
    let analyser: AnalyserNode | undefined;
    let context: AudioContext | undefined;

    const listen = () => {
      if (!context) {
        context = new AudioContext();
        analyser = context.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0.75;
        // Through the analyser and on to the speakers: a source that isn't connected
        // to the destination plays silently.
        context.createMediaElementSource(audio).connect(analyser);
        analyser.connect(context.destination);
      }
      void context.resume();
    };
    audio.addEventListener('play', listen);
    onCleanup(() => {
      audio.removeEventListener('play', listen);
      void context?.close();
    });

    const spectrum = new Uint8Array(FFT_SIZE / 2);
    const wave = new Uint8Array(FFT_SIZE / 2);

    /** Running average of the bass, which is what a beat is measured against. */
    let baseline = 0;
    let lastBeat = 0;
    /** 1 on the beat, fading out — everything that punches does it off this. */
    let punch = 0;
    /** How far through its wiggle the worm is. Advances faster the louder it gets. */
    let phase = 0;
    let spin = 0;

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      return dpr;
    };

    let dpr = size();
    const observer = new ResizeObserver(() => (dpr = size()));
    observer.observe(canvas);

    const ctx = canvas.getContext('2d');
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!ctx) return;

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (analyser) {
        analyser.getByteFrequencyData(spectrum);
        analyser.getByteTimeDomainData(wave);
      } else {
        // Nothing playing yet: leave the arrays at zero so the worm idles.
        spectrum.fill(0);
        wave.fill(128);
      }

      let bass = 0;
      for (let i = 1; i <= BASS_BINS; i++) bass += spectrum[i];
      bass /= BASS_BINS;
      let loudness = 0;
      for (let i = 0; i < spectrum.length; i++) loudness += spectrum[i];
      loudness /= spectrum.length;

      baseline += (bass - baseline) * 0.06;
      if (bass > BEAT_FLOOR && bass > baseline * BEAT_RATIO && now - lastBeat > BEAT_GAP_MS) {
        lastBeat = now;
        punch = 1;
      }
      punch *= 0.9;

      // Trails rather than a clean wipe — the whole look of a 2001 visualiser.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(4, 6, 16, 0.34)';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      spin += 0.0016 + loudness * 0.00012;

      // Starburst: one ray per spoke, its length taken from a bin of the spectrum.
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 2;
      const reach = Math.min(w, h) * 0.62;
      for (let i = 0; i < RAYS; i++) {
        const bin = 2 + Math.floor((i / RAYS) * (spectrum.length * 0.55));
        const level = spectrum[bin] / 255;
        const angle = (i / RAYS) * Math.PI * 2 + spin;
        const inner = reach * 0.16;
        const outer = inner + reach * (0.1 + level * 0.9) * (1 + punch * 0.35);
        ctx.strokeStyle = `hsl(${(i * 5 + spin * 220) % 360} 90% ${28 + level * 42}%)`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.stroke();
      }

      // The waveform, straight across the middle.
      ctx.strokeStyle = `hsla(${(spin * 160) % 360} 100% 72% / 0.65)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < wave.length; i++) {
        const x = (i / (wave.length - 1)) * w;
        const y = cy + ((wave[i] - 128) / 128) * h * 0.3;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();

      // And the bars along the bottom.
      const bars = 40;
      for (let i = 0; i < bars; i++) {
        const level = spectrum[2 + Math.floor((i / bars) * spectrum.length * 0.7)] / 255;
        const bw = w / bars;
        const bh = level * h * 0.3;
        ctx.fillStyle = `hsl(${190 + level * 130} 90% ${30 + level * 30}%)`;
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }

      /* The worm ------------------------------------------------------------ */

      ctx.globalCompositeOperation = 'source-over';
      // Idles gently in silence, thrashes when it's loud, and pops on every beat.
      const energy = loudness / 255;
      phase += 0.06 + energy * 0.42;
      const swing = h * (0.05 + energy * 0.2);
      const fat = 1 + punch * 0.4;
      const span = w * 0.62;
      const headX = cx - span / 2;
      const bounce = -punch * h * 0.06;
      // He dances below the middle, so the starburst behind reads as a backdrop rather
      // than something he's caught up in.
      const line = h * 0.6;

      const spot = (i: number) => ({
        x: headX + (i / (WORM_SEGMENTS - 1)) * span,
        // Each segment lags the one in front, which is what makes it a worm and not a
        // wobbling stick.
        y: line + bounce + Math.sin(phase - i * 0.62) * swing * (0.45 + i / WORM_SEGMENTS),
        r: (h * 0.055 * (1 - i / (WORM_SEGMENTS + 5))) * fat,
      });

      // Tail first, so the head ends up on top of the pile.
      for (let i = WORM_SEGMENTS - 1; i >= 0; i--) {
        const s = spot(i);
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(1, s.r), 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? WORM_HEAD : WORM_BODY;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = WORM_DARK;
        ctx.stroke();
        // A lit edge along the top of each segment, for the same reason the pipes have one.
        ctx.beginPath();
        ctx.arc(s.x, s.y - s.r * 0.3, Math.max(1, s.r * 0.5), Math.PI * 1.15, Math.PI * 1.85);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.stroke();
      }

      // Eyes, on the head, looking the way it's going.
      const head = spot(0);
      const eye = head.r * 0.34;
      for (const side of [-1, 1]) {
        const ex = head.x - head.r * 0.28;
        const ey = head.y + side * head.r * 0.4;
        ctx.beginPath();
        ctx.arc(ex, ey, eye, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        // The pupils go wide on the beat, because of course they do.
        ctx.arc(ex - eye * 0.3, ey, eye * (0.42 + punch * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(frame);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    });
  });

  return (
    <div class="audio-pane">
      <div class="audio-stage">
        <canvas class="audio-canvas" ref={canvas} />
        <Show when={transport.broken()}>
          <p class="media-broken">Josh's Computer can't play this one.</p>
        </Show>
      </div>

      {/* Never `controls`: the bar below is the transport, and the canvas is the show. */}
      <audio ref={audio} src={current()?.url} />

      <div class="media-foot">
        <MediaBar transport={transport} siblings={tracks()} onStep={step} />
        <span class="media-status">
          <Show when={current()} fallback="Not on the desktop any more">
            {(file) => (
              <>
                <Show when={at() >= 0}>
                  Track {at() + 1} of {tracks().length} —{' '}
                </Show>
                {file().name} — {formatBytes(file().size)}
              </>
            )}
          </Show>
        </span>
      </div>
    </div>
  );
}
