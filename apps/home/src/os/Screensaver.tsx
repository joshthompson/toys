import { onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { findScreensaver, type Screensaver as Saver } from './screensavers';

/** Any of these means someone's back at the keyboard. */
const WAKE_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const;
/**
 * Input is ignored for a beat after it takes over, so the click that previewed it
 * from settings — or the last twitch of the mouse before it kicked in — doesn't
 * dismiss it on the spot.
 */
const GRACE_MS = 500;

/** The blanked screen. Whichever saver is chosen draws inside it; any input ends it. */
export function Screensaver(props: { id: string; onDismiss: () => void }) {
  onMount(() => {
    const started = performance.now();
    const wake = () => {
      if (performance.now() - started > GRACE_MS) props.onDismiss();
    };

    // Capture, so a saver drawing its own interactive canvas can't swallow the wake.
    WAKE_EVENTS.forEach((e) => window.addEventListener(e, wake, { capture: true, passive: true }));
    onCleanup(() => WAKE_EVENTS.forEach((e) => window.removeEventListener(e, wake, { capture: true })));
  });

  const saver = () => findScreensaver(props.id);

  return (
    <div class="screensaver">
      <Show when={saver()}>{(s) => <Dynamic component={s().component} />}</Show>
    </div>
  );
}

/**
 * The same saver, but as the whole point of the page rather than something covering
 * the desktop — so no wake handlers and nothing to dismiss it back to.
 */
export function ScreensaverPage(props: { saver: Saver }) {
  onMount(() => {
    document.title = `${props.saver.name} — Josh OS '95`;
  });

  return (
    <div class="screensaver">
      <Dynamic component={props.saver.component} />
    </div>
  );
}
