import { createSignal } from 'solid-js';

/**
 * What the two calculators know of each other.
 *
 * Both windows are the same component in the same page, so this is all the wiring the
 * argument needs: one of them announces what it has just said, and the other one hears
 * it. A signal rather than a list of listeners, because the red one is usually opened
 * by the very answer it is meant to object to — it arrives a moment after the claim
 * was made, and needs to find it still sitting there rather than to have missed it.
 */
export type Claim = {
  /** Used to tell a claim already answered from one that has only just been made. */
  at: number;
  from: 'main' | 'rival';
  /** The sum, as it was asked. */
  sum: string;
  /** The answer that was given for it, which is what there is to disagree with. */
  said: string;
  /** What the sum actually comes to, so the objection can be wrong in its own way. */
  value: number;
};

const [heard, announce] = createSignal<Claim | null>(null);

export { heard, announce };

/** Past this, a claim is old news and gets no reply — it has been shouted at already. */
export const STALE_MS = 8000;
