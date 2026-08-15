import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { Power } from './shell';

type Props = {
  /** Never 'on' — App only mounts this once the desktop is going away. */
  mode: Power;
  /** Called when the boot bar finishes. */
  onBooted: () => void;
};

/** A beat of black before the splash, so a restart reads as the screen actually going out. */
const BLACKOUT_MS = 700;
/** How long the fake load takes. The bar's CSS animation is tied to this. */
export const LOAD_MS = 5000;

export function PowerScreen(props: Props) {
  const [splash, setSplash] = createSignal(false);

  createEffect(() => {
    if (props.mode !== 'restarting') return;

    const toSplash = setTimeout(() => setSplash(true), BLACKOUT_MS);
    const toBoot = setTimeout(() => props.onBooted(), BLACKOUT_MS + LOAD_MS);
    onCleanup(() => {
      clearTimeout(toSplash);
      clearTimeout(toBoot);
    });
  });

  return (
    <div class="power-screen">
      <Show when={splash()}>
        <div class="boot">
          <div class="boot-logo">
            Josh OS<span class="boot-logo-year">'95</span>
          </div>
          <div class="boot-bar">
            <div class="boot-bar-fill" style={{ 'animation-duration': `${LOAD_MS}ms` }} />
          </div>
          <p class="boot-hint">Starting Josh OS…</p>
        </div>
      </Show>
    </div>
  );
}
