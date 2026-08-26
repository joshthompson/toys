import { createSignal, For, onCleanup, Show } from 'solid-js';

/**
 * Josh's Maths App — a calculator that would rather not commit.
 *
 * You build the sum on the keypad, press equals, and it goes away and has a think about
 * it. What comes back is a message: the right answer, rounded until it stops looking
 * like it knows exactly, and hedged the way somebody does when asked to do arithmetic
 * in their head.
 */

/** How long it pretends to think, so the dots have something to do. */
const THINKING_MIN_MS = 700;
const THINKING_MAX_MS = 1600;

/** The keypad, in rows. `null` is a gap; everything else is a key that types itself. */
const KEYS = [
  ['(', ')', '⌫', 'C'],
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', '.', '=', '+'],
] as const;

/** What each key puts into the sum. The ones missing here do something else entirely. */
const TYPES: Record<string, string> = {
  '÷': ' / ',
  '×': ' * ',
  '−': ' - ',
  '+': ' + ',
  '(': '(',
  ')': ')',
};

/** How the sum is shown, as against how it's stored. */
const pretty = (sum: string) => sum.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');

/** Ways of not quite answering the question. */
const HEDGES = [
  'The answer is around',
  "It's close to",
  "I reckon it's about",
  'Somewhere in the region of',
  "I'd say roughly",
  'Give or take,',
  'Not far off',
  'Something like',
  'Call it',
];

/** For a sum that doesn't parse — a bracket short, or an operator left hanging. */
const MUDDLED = [
  "I've looked at that one for a while and I'm none the wiser.",
  "There's a bracket missing somewhere in there, I think.",
  "That doesn't come to anything I can see.",
  "I got halfway through and lost my place.",
];

/** For dividing by nothing, which is a different sort of not knowing. */
const ENDLESS = [
  "You've asked me to divide by nothing. I'd rather not.",
  'That one goes on forever, and I have things to do.',
  'Nothing goes into that as many times as you like. Take your pick.',
];

const pick = (from: readonly string[], not?: string) => {
  const options = from.length > 1 && not ? from.filter((o) => o !== not) : from;
  return options[Math.floor(Math.random() * options.length)]!;
};

/**
 * How far out it is allowed to be, as a fraction of the answer either way, and how much
 * further it goes when a guess rounds its way back onto the truth.
 */
const DRIFT_MIN = 0.02;
const DRIFT_MAX = 0.09;
const DRIFT_GROWTH = 1.8;
/** For a sum that comes to nothing, where a fraction of the answer is also nothing. */
const DRIFT_FLOOR = 0.1;

/**
 * A number said out loud: two figures and no more, which is as much as anybody carries
 * in their head. Twelve thousand three hundred and forty five is twelve thousand.
 */
const rounded = (value: number) => {
  if (value === 0) return '0';
  const figures = Math.floor(Math.log10(Math.abs(value))) + 1;
  const unit = Math.pow(10, figures - 2);
  const at = Math.round(value / unit) * unit;
  // Told how many decimals to show, rather than left to print whatever float dust
  // dividing by a power of ten leaves behind.
  return at.toLocaleString('en-GB', { maximumFractionDigits: Math.max(0, 2 - figures) });
};

/**
 * The answer, but never the answer.
 *
 * It works the sum out exactly and then walks a few percent away from it, because an
 * app that hedges every reply and is then quietly correct every time is not doing the
 * joke — it's a calculator with an affectation. So the guess is checked against what
 * the truth would have looked like, and if the rounding has carried it back onto the
 * right answer it goes out further and tries again.
 */
const approximate = (exact: number) => {
  const truth = rounded(exact);
  const away = Math.random() < 0.5 ? -1 : 1;
  let drift = DRIFT_MIN + Math.random() * (DRIFT_MAX - DRIFT_MIN);

  for (let tries = 0; tries < 8; tries++) {
    const spread = Math.abs(exact) * drift || DRIFT_FLOOR;
    const guess = rounded(exact + away * spread);
    if (guess !== truth) return guess;
    drift *= DRIFT_GROWTH;
  }

  // Eight tries out and still right, which takes some doing. Own up rather than lie.
  return truth;
};

type Answer = { ok: true; value: number } | { ok: false; why: 'muddle' | 'endless' };

/**
 * Work out what the sum comes to.
 *
 * Hand-read rather than handed to the browser's own evaluator, which would run anything
 * at all. This knows four operators, brackets and numbers, which is everything the
 * keypad can produce and nothing else besides.
 */
const evaluate = (source: string): Answer => {
  let at = 0;

  const skip = () => {
    while (source[at] === ' ') at++;
  };
  const peek = () => {
    skip();
    return source[at];
  };
  const take = (want: string) => {
    if (peek() !== want) return false;
    at++;
    return true;
  };

  const number = (): number | null => {
    skip();
    const from = at;
    while (at < source.length && /[0-9.]/.test(source[at]!)) at++;
    if (at === from) return null;
    const value = Number(source.slice(from, at));
    return Number.isNaN(value) ? null : value;
  };

  const factor = (): number | null => {
    if (take('(')) {
      const inner = sum();
      return inner !== null && take(')') ? inner : null;
    }
    // A minus with nothing in front of it is a sign, not a subtraction.
    if (take('-')) {
      const value = factor();
      return value === null ? null : -value;
    }
    return number();
  };

  const product = (): number | null => {
    let left = factor();
    if (left === null) return null;
    for (;;) {
      const by = take('*') ? '*' : take('/') ? '/' : null;
      if (!by) return left;
      const right = factor();
      if (right === null) return null;
      left = by === '*' ? left * right : left / right;
    }
  };

  const sum = (): number | null => {
    let left = product();
    if (left === null) return null;
    for (;;) {
      const by = take('+') ? '+' : take('-') ? '-' : null;
      if (!by) return left;
      const right = product();
      if (right === null) return null;
      left = by === '+' ? left + right : left - right;
    }
  };

  const value = sum();
  skip();
  // Anything left unread means it didn't understand the whole thing.
  if (value === null || at !== source.length) return { ok: false, why: 'muddle' };
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, why: 'endless' };
};

type Line = { id: number; from: 'you' | 'it'; text: string };

export function MathsPane() {
  const [sum, setSum] = createSignal('');
  const [lines, setLines] = createSignal<Line[]>([
    { id: 0, from: 'it', text: "Ask me a sum. I'll have a think about it." },
  ]);
  const [thinking, setThinking] = createSignal(false);

  let next = 1;
  let said = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let log!: HTMLDivElement;
  onCleanup(() => clearTimeout(timer));

  const say = (from: 'you' | 'it', text: string) => {
    setLines((all) => [...all, { id: next++, from, text }]);
    // After the paint that adds it, or there's nothing yet to scroll to.
    requestAnimationFrame(() => log.scrollTo({ top: log.scrollHeight }));
  };

  /** What it comes back with, once it has had its think. */
  const reply = (asked: string) => {
    const answer = evaluate(asked);
    if (answer.ok) {
      said = pick(HEDGES, said);
      return `${said} ${approximate(answer.value)}.`;
    }
    said = pick(answer.why === 'endless' ? ENDLESS : MUDDLED, said);
    return said;
  };

  const ask = () => {
    const asked = sum().trim();
    if (!asked || thinking()) return;

    say('you', pretty(asked));
    setSum('');
    setThinking(true);
    // A pause, of a length nobody could set a watch by.
    timer = setTimeout(
      () => {
        setThinking(false);
        say('it', reply(asked));
      },
      THINKING_MIN_MS + Math.random() * (THINKING_MAX_MS - THINKING_MIN_MS),
    );
  };

  const press = (key: string) => {
    if (key === '=') return ask();
    if (key === 'C') return setSum('');
    // An operator was typed in as three characters — a space either side — so it comes
    // back out as three. Everything else goes one at a time.
    if (key === '⌫') {
      return setSum((s) => (/ [-+*/] $/.test(s) ? s.slice(0, -3) : s.slice(0, -1)));
    }
    setSum((s) => s + (TYPES[key] ?? key));
  };

  return (
    <div
      class="maths-pane"
      tabindex={0}
      onKeyDown={(e) => {
        // A calculator that can't be typed at is a calculator with something missing.
        if (e.key === 'Enter' || e.key === '=') press('=');
        else if (e.key === 'Escape') press('C');
        else if (e.key === 'Backspace') press('⌫');
        else if (/^[0-9.()]$/.test(e.key)) press(e.key);
        else if (e.key === '+') press('+');
        else if (e.key === '-') press('−');
        else if (e.key === '*' || e.key === 'x') press('×');
        else if (e.key === '/') press('÷');
        else return;
        e.preventDefault();
      }}
    >
      <div class="maths-log" ref={log}>
        <For each={lines()}>
          {(line) => (
            <p class="maths-line" classList={{ 'is-you': line.from === 'you' }}>
              {line.text}
            </p>
          )}
        </For>

        <Show when={thinking()}>
          {/* Three dots, taking their time, the way a chat window says hold on. */}
          <p class="maths-line maths-dots" aria-label="Working it out">
            <span />
            <span />
            <span />
          </p>
        </Show>
      </div>

      <div class="maths-sum" aria-live="off">
        <Show when={sum()} fallback={<span class="maths-empty">Type a sum</span>}>
          {pretty(sum())}
        </Show>
      </div>

      <div class="maths-keys">
        <For each={KEYS}>
          {(row) => (
            <For each={row}>
              {(key) => (
                <button
                  class="chrome-button"
                  classList={{ 'is-equals': key === '=' }}
                  aria-disabled={key === '=' && (thinking() || !sum().trim())}
                  onClick={() => press(key)}
                >
                  {key}
                </button>
              )}
            </For>
          )}
        </For>
      </div>
    </div>
  );
}
