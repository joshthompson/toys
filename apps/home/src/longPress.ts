/**
 * A long press, standing in for the right click a finger hasn't got.
 *
 * Josh OS puts everything worth doing to an icon behind a right-click menu, which
 * leaves a touch screen with no way in. Holding still for a beat opens the same menu,
 * with a tick of the vibration motor to say it has caught — the way a phone answers a
 * press anywhere else.
 *
 * A mouse never comes through here: it has a second button of its own, and Android
 * fires its own `contextmenu` on a long press besides, which lands in the same place.
 */

/** How long a finger stays put before the press counts as a hold rather than a tap. */
const HOLD_MS = 500;
/** Travel that makes it a drag or a scroll instead, and calls the hold off. */
const SLOP = 10;
/** One short tick — about as long as a platform long-press gives you. */
const BUZZ_MS = 12;
/** How long to wait for the click that a finger coming up may or may not produce. */
const CLICK_WINDOW_MS = 700;

/** A tick of the motor, on the devices that have one and browsers that will drive it. */
const buzz = () => {
  try {
    // Absent on iOS, which has no vibration API at all — the menu just opens quietly.
    navigator.vibrate?.(BUZZ_MS);
  } catch {
    // A browser that offers the method and then refuses the call isn't worth a throw.
  }
};

/**
 * The hold fires with the finger still down, so the lift that follows lands a click —
 * on whatever the menu has just put under it, or on the icon that was being held.
 * Neither was asked for, so the next click is eaten. The timer clears the trap for a
 * press that never produces one.
 */
const swallowNextClick = () => {
  let timer: ReturnType<typeof setTimeout>;

  const done = () => {
    clearTimeout(timer);
    window.removeEventListener('click', eat, true);
  };

  // Capture, so it runs before the click reaches whatever it was aimed at.
  const eat = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };

  window.addEventListener('click', eat, true);
  timer = setTimeout(done, CLICK_WINDOW_MS);
};

/**
 * Pointer handlers for one pressable thing. `fire` is handed the point the press
 * settled on, and is where the caller both abandons whatever gesture it had started
 * on the way down — a drag, a marquee — and opens its menu.
 */
export function longPress(fire: (x: number, y: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let from: { x: number; y: number } | null = null;

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    from = null;
  };

  return {
    down(e: PointerEvent) {
      if (e.pointerType === 'mouse') return;
      // A second finger is a pinch or a two-hand fumble, not a press being held.
      if (!e.isPrimary) return stop();

      from = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        const at = from!;
        stop();
        buzz();
        swallowNextClick();
        fire(at.x, at.y);
      }, HOLD_MS);
    },

    move(e: PointerEvent) {
      if (!from) return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP) stop();
    },

    /** The finger came up, or the gesture was taken away, before the hold was up. */
    cancel: stop,
  };
}
