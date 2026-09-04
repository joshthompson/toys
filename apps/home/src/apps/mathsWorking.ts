/**
 * Showing its working.
 *
 * The rule here is that the working comes first and the answer falls out of it. It
 * would be easy to decide on a wrong answer and then dress some steps up to reach it,
 * but that isn't how anybody gets a sum wrong: they go wrong once, in one place, and
 * then carry on perfectly carefully from there. So one line of this is wrong and every
 * line after it follows honestly from the wrong one — which is why the answer at the
 * bottom is not the right answer, and why you can see exactly where it went.
 *
 * Every method here is one somebody is actually taught: adding a number up so many
 * times, counting on, tens and then units, counting up in sevens. The mistakes are the
 * ones those methods invite — a step counted twice, a carry dropped, a tally out by one.
 */

/** A number as it would be written down: grouped, and no more than two decimals. */
export const spell = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 2 });

/** Money-free arithmetic still drifts, and a working full of 41.999999 is a bug on show. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** How far out the one wrong step goes: one, or a whole ten where a carry was dropped. */
const slip = () => (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.35 ? 10 : 1);

/** The sum as typed, if it is one number, one operator and one number and nothing else. */
const pair = (source: string) => {
  const bits = /^\s*(-?\d+(?:\.\d+)?)\s*([-+*/])\s*(-?\d+(?:\.\d+)?)\s*$/.exec(source);
  if (!bits) return null;
  return { a: Number(bits[1]), by: bits[2]!, b: Number(bits[3]) };
};

export type Working = { rows: string[]; result: number };

/** 'twelve lots of six' reads better than '12 lots of 6' and stops at twelve for a reason. */
const LOTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/**
 * Multiplication as repeated addition, which is what it is, and which nobody who has
 * seen a times table ever does past about four. One of the additions is wrong.
 */
const times = (a: number, b: number): Working | null => {
  // Nobody adds a number up ninety times, and nobody would read it if they did.
  const [each, goes] = Number.isInteger(b) && b >= 2 && b <= 12 ? [a, b] : [b, a];
  if (!Number.isInteger(goes) || goes < 2 || goes > 12) return null;

  const wrongAt = 1 + Math.floor(Math.random() * (goes - 1));
  const out = slip();
  const steps: number[] = [];
  for (let i = 0; i < goes; i++) {
    const last = i === 0 ? 0 : steps[i - 1]!;
    steps.push(round2(last + each + (i === wrongAt ? out : 0)));
  }
  return {
    rows: [`${LOTS[goes]} lots of ${spell(each)}:`, steps.map(spell).join(', ')],
    result: steps[steps.length - 1]!,
  };
};

/** Counting on from the bigger number, one at a time, and losing count once. */
const countOn = (a: number, b: number): Working | null => {
  const [from, on] = a >= b ? [a, b] : [b, a];
  if (!Number.isInteger(on) || on < 1 || on > 12) return null;

  const wrongAt = 1 + Math.floor(Math.random() * on);
  const steps = [from];
  for (let i = 1; i <= on; i++) steps.push(round2(steps[i - 1]! + 1 + (i === wrongAt ? slip() : 0)));
  return {
    rows: [`${spell(from)}, and count on ${spell(on)}:`, steps.slice(1).map(spell).join(', ')],
    result: steps[steps.length - 1]!,
  };
};

/** Tens, then units, then the two put back together — badly. */
const plus = (a: number, b: number): Working | null => {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return null;
  if (a < 10 && b < 10) return countOn(a, b);

  const tens = [Math.floor(a / 10) * 10, Math.floor(b / 10) * 10];
  const units = [a % 10, b % 10];
  const big = tens[0]! + tens[1]!;
  const small = units[0]! + units[1]!;
  // The carry is where addition goes wrong, so that is where this goes wrong.
  const result = big + small + slip();
  return {
    rows: [
      `${spell(tens[0]!)} + ${spell(tens[1]!)} = ${spell(big)}`,
      `${spell(units[0]!)} + ${spell(units[1]!)} = ${spell(small)}`,
      `${spell(big)} + ${spell(small)} = ${spell(result)}`,
    ],
    result,
  };
};

/** Taking away the tens and then the units, and fumbling the second half. */
const minus = (a: number, b: number): Working | null => {
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < 0) return null;
  const tens = Math.floor(b / 10) * 10;
  const units = b % 10;
  if (tens === 0) {
    const result = a - units + slip();
    return { rows: [`${spell(a)} take ${spell(units)} is ${spell(result)}`], result };
  }
  const part = a - tens;
  const result = part - units + slip();
  return {
    rows: [
      `${spell(a)} take ${spell(tens)} is ${spell(part)}`,
      `${spell(part)} take ${spell(units)} is ${spell(result)}`,
    ],
    result,
  };
};

/**
 * Counting up in whatever it is dividing by. The list is honest — you can count it
 * yourself — and the tally at the end of it is not, which is the best kind of wrong:
 * the evidence against it is printed directly above the claim.
 */
const into = (a: number, b: number): Working | null => {
  if (!Number.isInteger(b) || b < 2 || a <= 0 || a / b > 12) return null;
  const steps: number[] = [];
  for (let i = 1; i <= 12 && b * i <= a; i++) steps.push(b * i);
  if (steps.length < 2) return null;
  const result = steps.length + (Math.random() < 0.5 ? -1 : 1);
  return {
    rows: [
      `how many ${spell(b)}s in ${spell(a)}?`,
      steps.map(spell).join(', '),
      `that's ${spell(result)} of them.`,
    ],
    result,
  };
};

/**
 * Anything longer, done strictly left to right — no brackets, and times gets no more
 * respect than plus. It is wrong twice over: once for the order, and once for the one
 * step in the middle that it fumbles anyway.
 */
const chain = (source: string): Working | null => {
  if (/[()]/.test(source)) return null;
  const bits = source.match(/-?\d+(?:\.\d+)?|[-+*/]/g);
  if (!bits || bits.length < 5 || bits.length % 2 === 0) return null;

  const rows: string[] = [];
  let running = Number(bits[0]);
  if (!Number.isFinite(running)) return null;

  const wrongAt = Math.floor(Math.random() * ((bits.length - 1) / 2));
  for (let i = 1, step = 0; i < bits.length; i += 2, step++) {
    const by = bits[i]!;
    const next = Number(bits[i + 1]);
    const was = running;
    if (by === '+') running += next;
    else if (by === '-') running -= next;
    else if (by === '*') running *= next;
    else if (next === 0) return null;
    else running /= next;
    if (step === wrongAt) running += slip();
    running = round2(running);
    // The signs the keypad uses, not the ones the parser does.
    const sign = { '*': '×', '/': '÷', '-': '−', '+': '+' }[by] ?? by;
    rows.push(`${spell(was)} ${sign} ${spell(next)} = ${spell(running)}`);
  }
  if (!Number.isFinite(running)) return null;
  return { rows: ['left to right:', ...rows], result: running };
};

/**
 * The working for a sum, and the answer it arrives at — or nothing, for a sum with no
 * method it can pretend to have used. Brackets defeat it, and so does anything long
 * enough that writing it out would be work.
 */
export const workingFor = (source: string): Working | null => {
  const two = pair(source);
  if (two) {
    const { a, by, b } = two;
    if (by === '*') return times(a, b);
    if (by === '+') return plus(a, b);
    if (by === '-') return minus(a, b);
    return into(a, b);
  }
  return chain(source);
};
