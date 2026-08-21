import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import type { DesktopFile } from './files';

/**
 * The bits Josh's Listening To Stuff App and Josh's Video Playback App have in common:
 * a transport for whatever <audio> or <video> element they're driving, and the bar of
 * buttons along the bottom.
 */

/** '3:07', or '1:02:44' once there's an hour of it. */
export const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const parts = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  if (!parts[0]) parts.shift();
  return parts.map((n, i) => (i ? String(n).padStart(2, '0') : String(n))).join(':');
};

export type Transport = ReturnType<typeof createTransport>;

/**
 * Follow a media element and drive it. The element is the source of truth — every
 * signal here is set from its own events, so the bar stays right even when something
 * else moves it (the file ending, a seek that lands somewhere unexpected).
 */
export const createTransport = () => {
  const [media, setMedia] = createSignal<HTMLMediaElement>();
  const [playing, setPlaying] = createSignal(false);
  const [time, setTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  /** Set when the browser turns out to have no decoder for the file. */
  const [broken, setBroken] = createSignal(false);

  /** Called from each pane's ref, and again with the same element on a file change. */
  const attach = (el: HTMLMediaElement) => {
    setMedia(el);
    const sync = () => {
      setPlaying(!el.paused && !el.ended);
      setTime(el.currentTime);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    };
    const events = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'seeked', 'emptied'];
    events.forEach((e) => el.addEventListener(e, sync));
    const fail = () => setBroken(true);
    el.addEventListener('error', fail);
    // A fresh file gets the benefit of the doubt, whatever the last one did.
    const clear = () => setBroken(false);
    el.addEventListener('loadstart', clear);

    onCleanup(() => {
      events.forEach((e) => el.removeEventListener(e, sync));
      el.removeEventListener('error', fail);
      el.removeEventListener('loadstart', clear);
    });
  };

  /** Play, swallowing the rejection a browser hands back when it won't allow it yet. */
  const play = () => media()?.play().catch(() => {});
  const pause = () => media()?.pause();
  const toggle = () => (playing() ? pause() : play());

  const seek = (to: number) => {
    const el = media();
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(to, el.duration || 0));
    setTime(el.currentTime);
  };

  return { media, attach, playing, time, duration, broken, play, pause, toggle, seek };
};

/**
 * The transport bar: skip, play, skip, a scrubber, and the clock. `extra` is whatever
 * the app wants alongside — the audio app has nothing, the video app has full screen.
 */
export function MediaBar(props: {
  transport: Transport;
  /** The desktop's other files of this kind, for the skip buttons. */
  siblings: DesktopFile[];
  onStep: (by: number) => void;
  extra?: JSX.Element;
}) {
  const alone = () => props.siblings.length < 2;

  return (
    <footer class="media-bar">
      <button
        class="chrome-button"
        title="Previous"
        aria-disabled={alone()}
        onClick={() => props.onStep(-1)}
      >
        <span aria-hidden="true">◀◀</span>
      </button>
      <button
        class="chrome-button"
        title={props.transport.playing() ? 'Pause' : 'Play'}
        onClick={() => props.transport.toggle()}
      >
        <span aria-hidden="true">{props.transport.playing() ? '❚❚' : '▶'}</span>
      </button>
      <button
        class="chrome-button"
        title="Next"
        aria-disabled={alone()}
        onClick={() => props.onStep(1)}
      >
        <span aria-hidden="true">▶▶</span>
      </button>

      <input
        class="media-scrub"
        type="range"
        min={0}
        max={props.transport.duration() || 0}
        step={0.01}
        value={props.transport.time()}
        aria-label="Position"
        disabled={!props.transport.duration()}
        onInput={(e) => props.transport.seek(e.currentTarget.valueAsNumber)}
      />

      <span class="media-clock">
        {clock(props.transport.time())} / {clock(props.transport.duration())}
      </span>

      <Show when={props.extra}>{props.extra}</Show>
    </footer>
  );
}
