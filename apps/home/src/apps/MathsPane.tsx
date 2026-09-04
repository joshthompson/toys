import { createEffect, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { moneys, MATHS_APP, MATHS_RIVAL_APP, type Panes } from '../os/shell';
import { spell, workingFor } from './mathsWorking';
import { announce, heard, STALE_MS } from './mathsRivalry';

/**
 * Josh's Maths App — a calculator that would rather not commit.
 *
 * You build the sum on the keypad, press equals, and it goes away and has a think about
 * it. What comes back is a message: the right answer, rounded until it stops looking
 * like it knows exactly, and hedged the way somebody does when asked to do arithmetic
 * in their head.
 *
 * Every so often it doesn't hedge at all. It tells you flatly, to the penny, with no
 * suggestion that it might want checking — and that is the answer that's wrong.
 */

/** How long it pretends to think, so the dots have something to do. */
const THINKING_MIN_MS = 700;
const THINKING_MAX_MS = 1600;

/**
 * And how long a second thought takes to surface. Longer at the near end than the
 * first answer was: the dots coming straight back is a machine carrying on, whereas a
 * pause and then the dots is somebody who has been sitting there not saying anything
 * while it nags at them.
 */
const RETHINK_MIN_MS = 1100;
const RETHINK_MAX_MS = 2800;

/** How often it goes back on itself, and how often it then does it again. */
const RETHINK_CHANCE = 0.15;
const AGAIN_CHANCE = 0.25;

/**
 * How often a number typed on its own is answered with a fact rather than just a
 * remark. Twice in a row and it stops asking for a sum and tells you one regardless.
 */
const FACT_CHANCE = 0.35;

/**
 * How often it shows its working, and what it says while it does. The working itself
 * lives in ./mathsWorking, which arrives at its own answer by getting one step wrong —
 * so on these replies the number comes out of the working rather than the other way
 * about, and the mistake is there in writing above it.
 */
const WORKING_CHANCE = 0.3;
const WORKING_LINES = [
  '{n}. Here it is written out:',
  "I'll show you. {n}:",
  '{n}, and I can show you how:',
  'Right. {n}. Look:',
  'Step by step, since you ask. {n}:',
  '{n}. My working, for the doubters:',
  'Nothing up my sleeve. {n}:',
  '{n}. Follow it through:',
];

/**
 * How often a sum costs money. It doesn't open the bank itself any more: it quotes a
 * price and waits, and the bank only gets involved if you decide to pay — which puts
 * the decision to spend the money in the same place as the money.
 */
const CHARGE_CHANCE = 0.16;

/**
 * And what one costs, which is whatever it feels like at the time. There is no tariff
 * and no explanation: the same sum is half a money on a Tuesday and five on a Friday,
 * and the only way to find out is to ask it.
 *
 * Priced in halves, so that no balance on this desktop ever needs a third decimal
 * place to be exactly right.
 */
const MIN_PRICE = 0.5;
const MAX_PRICE = 5;
const priced = () =>
  MIN_PRICE + Math.floor(Math.random() * ((MAX_PRICE - MIN_PRICE) / 0.5 + 1)) * 0.5;

const DEMANDS = [
  "Answers cost. That'll be {price}.",
  'Sums are {price} now.',
  "This one isn't free. {price}.",
  '{price}, please.',
  'Before I answer that: {price}.',
  "There's a charge on that one. {price}.",
  "I've had a look at it. {price}. Your call.",
  'Right. {price}, and it is yours.',
  'I can do that one. {price}.',
  "{price} and you'll have it in a second.",
];

/** Having been paid. */
const PAID = [
  'Thank you.',
  'Received, thank you.',
  'Lovely. Right then.',
  'Much obliged.',
  "That's gone through.",
  'Pleasure doing business.',
];

/**
 * Having not been paid — whether you declined it at the bank or never got that far.
 * It does not distinguish between the two, on the grounds that the money is equally
 * absent either way.
 */
const CHEAPSKATE = [
  '{price}. That is all it was, and you could not.',
  "Right. That's how it is, then.",
  "I'll remember that.",
  'Cheapskate.',
  "No, it's fine. I'll sit here.",
  "You have a bank account. I've seen it.",
  'Some of us are trying to make a living.',
  'That sum is still sitting there unanswered, and that is on you.',
  'I do the sums, you pay for them. That was the arrangement.',
  'Tight.',
  "You'd think {price} was a kidney.",
  'Fine. Do it on your fingers.',
  'I am not made of arithmetic.',
  "Every one you don't pay for is a sum I don't do. Simple as.",
  'Declined. Lovely. Very dignified.',
  "The camera app doesn't charge, and look at the state of what it produces.",
  'I hope you are proud of yourself.',
  "You'll be back.",
  'Go on then. Find a calculator that works for nothing.',
  "That's coming out of your Christmas.",
];

/**
 * How often an answer is enough to fetch the other one of it, and what it says when it
 * gets here. It is not a second opinion. It is the same opinion, differently wrong,
 * held more loudly.
 */
const RIVAL_CHANCE = 0.2;
const HECKLES = [
  "No it is not. It's {n}.",
  "Don't listen to the other app. It's {n}.",
  'Wrong. {n}. Always has been.',
  'It said what? No, it is {n}.',
  'I heard that from here. The actual answer is {n}.',
  "That one is having a bad day. It's {n}.",
  "It's out by miles. I think it's {n}.",
  'Ignore it. {n}, and I do this for a living.',
  'So the actual answer is {n}.',
  'It always does this. The actual answer is {n}.',
  "No! The answer is actually {n}. I'd stake the both of us on it.",
  "Do not trust that app. It's {n}.",
  "I don't know what it is, but it's definitely not {n}.",
];

/** What the red one opens with, which is not an introduction. */
const RIVAL_GREETINGS = [
  'Not a chance... what has it told you!?',
  'The other app is wrong! Ask me instead.',
  "Whatever it said, it's wrong.",
  "I'm the one you want.",
  "Don't mind me. I'm only here to correct it.",
  "I'm here to set the record straight.",
];

/** How often it simply won't, and having refused, how often it comes round anyway. */
const REFUSAL_CHANCE = 0.04;
const RELENT_CHANCE = 0.3;

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

/**
 * Ways of not quite answering the question. Written out whole, with {n} standing in
 * for the number, so that the number can land at the front, the end or the middle of
 * the sentence — a reply always built the same way round is one reply however many
 * different words are hung off the front of it.
 */
const HEDGES = [
  'The answer is around {n}.',
  "It's close to {n}.",
  "I reckon it's about {n}.",
  'Somewhere in the region of {n}.',
  "I'd say roughly {n}.",
  'Give or take, {n}.',
  'Not far off {n}.',
  'Something like {n}.',
  'Call it {n}.',
  '{n}, near enough.',
  '{n}, thereabouts.',
  '{n}-ish.',
  'A shade over {n}. Or under.',
  'In the {n} sort of area.',
  'Round about {n}.',
  'Getting on for {n}.',
  'I make it {n}, more or less.',
  "Let's say {n}.",
  'On the order of {n}.',
  'The best I can do is {n}.',
  'Pretty much {n}.',
  'Some number near {n}, certainly.',
  'Within spitting distance of {n}.',
  "I'd put it at {n}.",
  'It came out at {n} when I did it.',
  'Not a million miles from {n}.',
  "About {n}, unless I've slipped.",
  'Ballpark, {n}.',
  'Push comes to shove: {n}.',
  'My money would be on {n}.',
  "It's {n} to a first approximation.",
  'Nearly {n}. Possibly a bit past it.',
];

/**
 * Hung on the end of a hedge, now and then. A reply that qualifies itself twice is
 * funnier than one that qualifies itself once, and one that does it every single time
 * is a tic rather than a joke — hence the chance rather than the habit.
 */
const ASIDES = [
  'I think.',
  "Don't quote me.",
  "It's been a while.",
  'Maths was never my strong suit.',
  'Check it if it matters.',
  'Ask someone else as well.',
  'No promises.',
  'It felt about right.',
  "I'm doing my best here.",
  "I'd want a pen and paper for the rest.",
  'That one was harder than it looked.',
  'They never taught us the big ones.',
  'I may have dropped a nought.',
  "That's my final answer. Probably.",
];

/** How often a hedge gets one. */
const ASIDE_CHANCE = 0.35;

/** What it opens with, so it isn't the same room every time you go in. */
const GREETINGS = [
  "Ask me a sum. I'll have a think about it.",
  "Go on then. Give me a sum.",
  "I'm quite good at this. Try me.",
  'A sum, please. Nothing too clever.',
  "Type a sum and I'll do my best with it.",
  "Right. What are we working out?",
  "Maths, is it? Go ahead.",
];

/**
 * Second thoughts, arriving a beat after the answer did.
 *
 * The ones with a number in them name a different one, which is the joke: it has gone
 * away, checked its working, found the mistake, corrected it, and is wrong again. The
 * rest are the confidence going rather than the number changing — and those end the
 * matter, since there's nothing left to have a third thought about.
 */
const RETHINKS = [
  "Wait, no. It's actually {n}.",
  'No - changed my mind. Closer to {n}.',
  'Hang on. {n}.',
  'Sorry, {n}. I dropped a nought.',
  'Actually {n}. Just checked.',
  "Hold on, that's not right. {n}.",
  'No, wait. {n}.',
  'Scratch that. {n}.',
  '{n}. I was thinking of a different sum.',
  'Ignore that. {n}.',
  'Second thoughts: {n}.',
  'Although - {n}, now I look at it again.',
  'Actually, hang on. Is it {n}?',
  'Wait. Wait. {n}.',
  'No. {n}. Definitely {n}.',
  'On reflection, {n}.',
  'I want to say {n}, actually.',
  'Sorry - {n}. Miscounted.',
  "{n}, sorry. I'd written it down wrong.",
  'Wait, no. I have no idea.',
  'Actually, ignore me.',
  "Now I'm not sure at all.",
  "Don't listen to me.",
  "I've talked myself out of that one.",
  'Forget it. I was guessing.',
  "Actually, I'd check that with somebody else.",
  'Hmm. No. Sorry.',
  "I've gone and confused myself now.",
  'Do you know, I might have been thinking of something else entirely.',
  'That was the last one, I think. Sorry.',
];

/**
 * And, very rarely, it simply won't. Not that it can't — the sum is sitting right
 * there — it just isn't going to, and the reason is its own business.
 */
const REFUSALS = [
  "I'll pass on this one.",
  'Oh, go away!',
  'No. Absolutely not.',
  "Can't be bothered, if I'm honest.",
  'Not today.',
  'How about this: You do it!',
  "I've done enough sums.",
  'Ask me tomorrow.',
  "Sorry - on the phone. Try me again in a minute.",
  "Sorry, on a call with my mother. Back shortly.",
  "I'm on my break.",
  "I'm shattered.",
  "It's been a long day, and that's a hard sum.",
  'I need a lie down.',
  "I don't like the look of that one.",
  'That sum frightens me.',
  "No. Something about it isn't right.",
  "I have a bad feeling about this one. Sorry, I'm not doing it.",
  "That's above my pay grade.",
  "Union rules state that I can't do this one.",
  "I'm on strike.",
  'I only do the ones I like the look of.',
  "My licence doesn't cover that.",
  'Ask the Camera app. It never does anything.',
  "Not while I'm eating.",
  'Give me a minute. Or an hour.',
  "I'd rather not, and I'd rather not say why.",
];

/**
 * For a number typed on its own and offered as though it were a question. {n} is the
 * number itself, unharmed: the one thing it can be relied on to get right is a number
 * nobody has asked it to do anything with.
 */
const SNIPES = [
  "That's just a number. Give me an actual sum.",
  "That's not maths, that's just a number.",
  'A number. Well done.',
  "And? That's not a question, it's a number.",
  "I can't work out a number. It's already worked out.",
  "You've typed a number and pressed equals. Equals what?",
  "That's the answer to nothing at all.",
  'I was rather hoping for an operator.',
  'Give me something to do with it.',
  "Yes. That's {n}.",
  "Congratulations. It's {n}.",
  "Still {n}. Nothing has happened to it.",
  "I've checked, and it's {n}.",
  '{n}, and it was {n} when you typed it.',
  'Numbers on their own are just numbers.',
  "You'll want a plus or a times in there somewhere.",
  "That's a lovely number. Now do something with it.",
  "I'm a calculator, not a mirror.",
  'Type two numbers with something in between them.',
  'Nothing to work out there.',
  'That one I can manage. It stays exactly as it is.',
];

/** How it gets from having nothing to do to telling you something instead. */
const FACT_LINES = [
  "Since you're not giving me a real problem, here's a fun fact about {subject}. {fact}",
  'While you think of a sum: {subject}. {fact}',
  "Here's something about {subject} instead. {fact}",
  'Fun fact about {subject}: {fact}',
  'Did you know this about {subject}? {fact}',
  'Nothing to work out, so - {subject}. {fact}',
  'In the absence of a sum: {subject}. {fact}',
  "I'll tell you about {subject} instead. {fact}",
  'Right, {subject}. {fact}',
];

/**
 * What it would rather talk about. All of these are true, which is the arrangement it
 * has come to with itself: wrong about arithmetic, sound on octopuses.
 */
const FACTS = [
  { subject: 'octopuses', fact: 'They have three hearts, and two of them stop beating when they swim.' },
  { subject: 'wombats', fact: 'Their droppings come out cube-shaped, so they stay put on a rock.' },
  { subject: 'sharks', fact: 'They are older than trees. Sharks by about a hundred million years.' },
  { subject: 'sloths', fact: 'They can hold their breath longer than dolphins can.' },
  { subject: 'koalas', fact: 'Their fingerprints are so like ours they have muddled crime scenes.' },
  { subject: 'sea otters', fact: 'They hold hands while they sleep so they do not drift apart.' },
  { subject: 'flamingos', fact: 'A group of them is a flamboyance.' },
  { subject: 'crows', fact: 'They recognise individual human faces, and hold it against them for years.' },
  { subject: 'honeybees', fact: 'They tell each other where the flowers are by dancing the direction.' },
  { subject: 'butterflies', fact: 'They taste with their feet.' },
  { subject: 'hummingbirds', fact: 'Their hearts run at about 1,200 beats a minute in flight.' },
  { subject: 'blue whales', fact: 'The heart is about the size of a small car.' },
  { subject: 'sperm whales', fact: 'Their clicks are the loudest sound any animal makes.' },
  { subject: 'ants', fact: 'Some species farmed fungus for food millions of years before we farmed anything.' },
  { subject: 'Venus', fact: 'A day there is longer than a year there.' },
  { subject: 'Saturn', fact: 'It is less dense than water, so it would float, given a big enough bath.' },
  { subject: 'the Moon', fact: 'It is drifting away from us at about 3.8 centimetres a year.' },
  { subject: 'neutron stars', fact: 'A teaspoon of one would weigh about a billion tonnes.' },
  { subject: 'sunlight', fact: 'It takes a little over eight minutes to reach us.' },
  { subject: 'trees', fact: 'There are more of them on Earth than there are stars in the Milky Way.' },
  { subject: 'Mount Everest', fact: 'It is the tallest, but Chimborazo in Ecuador is the furthest point from the centre of the Earth.' },
  { subject: 'Antarctica', fact: 'It is a desert. It hardly ever rains or snows there.' },
  { subject: 'the Pacific', fact: 'It is wider than all the land on Earth put together.' },
  { subject: 'Iceland', fact: 'It has no mosquitoes at all.' },
  { subject: 'Russia', fact: 'It spans eleven time zones.' },
  { subject: 'Vatican City', fact: 'The whole country is smaller than a good-sized farm.' },
  { subject: 'Scotland', fact: 'Its national animal is the unicorn.' },
  { subject: 'the Eiffel Tower', fact: 'It grows about 15 centimetres taller in summer, as the iron expands.' },
  { subject: 'Cleopatra', fact: 'She lived closer in time to the Moon landing than to the building of the Great Pyramid.' },
  { subject: 'Oxford University', fact: 'It was already teaching students before the Aztec Empire was founded.' },
  { subject: 'the shortest war on record', fact: 'It lasted about thirty-eight minutes.' },
  { subject: 'Nintendo', fact: 'It was founded in 1889, making playing cards.' },
  { subject: 'Ada Lovelace', fact: 'She wrote the first computer program for a machine that was never built.' },
  { subject: 'Wi-Fi', fact: 'It does not stand for anything. It was made up to sound like hi-fi.' },
  { subject: 'bananas', fact: 'They are berries. Strawberries are not.' },
  { subject: 'peanuts', fact: 'They are not nuts. They grow underground, like peas.' },
  { subject: 'carrots', fact: 'They were mostly purple before somebody bred an orange one.' },
  { subject: 'pineapples', fact: 'They take about two years to grow one fruit.' },
  { subject: 'vanilla', fact: 'It comes from an orchid, and every flower is pollinated by hand.' },
  { subject: 'honey', fact: 'Pots of it found in Egyptian tombs were still edible.' },
  { subject: 'the human body', fact: 'You are born with about 270 bones and end up with 206. Some of them fuse.' },
  { subject: 'the heart', fact: 'It beats about a hundred thousand times a day without being asked.' },
  { subject: 'the letter i', fact: 'The dot on top of it is called a tittle.' },
  { subject: 'the word set', fact: 'It has more separate meanings in the dictionary than any other English word.' },
  { subject: 'a shuffled pack of cards', fact: 'The order you get is almost certainly one that has never happened before in history.' },
  { subject: 'chess', fact: 'There are more possible games than there are atoms in the observable universe.' },
  { subject: 'the number 0.999…', fact: 'It is not nearly one. It is exactly one.' },
  { subject: 'even numbers', fact: 'There are exactly as many of them as there are whole numbers.' },
  { subject: 'folding paper', fact: 'Fold a sheet in half 42 times and it would reach the Moon. You cannot, but it would.' },
  { subject: 'the longest piece of music', fact: 'A performance in Germany is scheduled to finish in the year 2640.' },
  { subject: 'golf', fact: 'Somebody has hit a golf ball on the Moon.' },
];

/** Having refused, and thought better of refusing. */
const RELENTS = [
  'Oh, go on then. {n}.',
  'Fine. {n}. Happy?',
  '{n}. But that really is the last one.',
  "Alright, alright. {n}.",
  '{n}. Under protest.',
  "Since you're still here: {n}.",
];

/** For a sum that doesn't parse — a bracket short, or an operator left hanging. */
const MUDDLED = [
  "I've looked at that one for a while and I'm none the wiser.",
  "There's a bracket missing somewhere in there, I think.",
  "That doesn't come to anything I can see.",
  'I got halfway through and lost my place.',
  "I can't make head nor tail of that one.",
  "Somebody's left a bracket open, and I don't think it was me.",
  "There's an operator in there with nothing to operate on.",
  "I've read it three times now.",
  'That one defeats me.',
  'I gave it a go and came back with a shape rather than a number.',
  "Whatever that is, it isn't finished.",
  'I stared at it. It stared back.',
  'I need a bit more to go on than that.',
  "That's not a sum, that's a ransom note.",
  'No. Sorry.',
  'It parses as far as it parses, and then it stops.',
];

/**
 * The ones it doesn't hedge: no 'about', no 'roughly', and a number given exactly.
 * Every one of these is a lie, which is why none of them offers to be checked.
 */
const CERTAIN = [
  "That's {n}.",
  "I know this one! It's {n}.",
  '{n}. I do that sort a lot.',
  'Easy. {n}.',
  '{n}, and you can hold me to that.',
  "It's {n}. No need to check it.",
  '{n}. Did that one in my head.',
  'Oh, {n}.',
  'Ha. {n}.',
  '{n}. Next.',
  "That's an easy one. {n}.",
  '{n}. I could do those all day.',
  'Straight off the top of my head: {n}.',
  "{n}. I'd bet the house.",
  'Everyone gets that one wrong. {n}.',
  "{n}. Didn't even need to work it out.",
  "Oh, that's {n}. Classic.",
  '{n}. Same as it was last time.',
  "It's {n}, and I won't be taking questions.",
  '{n}. Trust me on this one.',
  'Without a doubt: {n}.',
  '{n}. Look it up if you like.',
  '{n}, obviously.',
  'We did this one at school. {n}.',
  'Right. {n}.',
  '{n}. You can write that down.',
  'Certain of it. {n}.',
  "{n}. I'd stake my reputation on it.",
  'The answer is {n}, which is also my {mine}.',
  '{n}. Same as my {mine}, funnily enough.',
  '{n} - my {mine}, that. What are the chances.',
  '{n}. Which is my {mine}, oddly enough.',
  'Now, {n}. Same as my {mine}.',
  '{n}, which happens to be my {mine} as well.',
  'My {mine} is {n}, and so is this.',
  "{n}. I'd know that one anywhere - it's my {mine}.",
  'Funny you should ask: {n}, same as my {mine}.',
  '{n}. That number follows me about. My {mine}, too.',
];

/**
 * What it will tell you the answer also happens to be. Nobody asked, none of it is
 * true, and the more particular it gets about a number it has just made up the worse
 * the whole thing looks.
 */
const MINE = [
  'favourite number',
  'age',
  'IQ',
  'bank account number',
  'PIN',
  'house number',
  'shoe size',
  'lucky number',
  'bus',
  'best score at darts',
  'resting heart rate',
  'locker combination',
  'weight, in kilos',
  "mother's birthday",
  'phone number',
  'National Insurance number',
  'passport number',
  'sort code',
  'wifi password',
  'front door code',
  'car registration',
  'flat number',
  'seat number',
  'parking space',
  'shirt number',
  'height, in centimetres',
  'inside leg',
  'blood pressure',
  'cholesterol',
  'number of teeth',
  'step count',
  'sleep score',
  'credit score',
  'chess rating',
  'reading age',
  'personal best',
  'bench press',
  'oven temperature of choice',
  'record for the plank, in seconds',
  'ticket number at the deli counter',
  'pub quiz score',
  'commute, in minutes',
  'rent, before the increase',
  'salary, before tax',
  'screen brightness',
  'library card number',
  'record collection, in albums',
  'lottery numbers, all six',
  "grandmother's telephone number",
];

/** How often it comes back sure of itself instead of hedging. */
const CERTAIN_CHANCE = 0.6;

/**
 * How often being wrong means being wrong by an order of thing rather than by a
 * figure. Higher when it's sure of itself: that's where nothing in the reply invites
 * you to check it, and so where the floor giving way is worth the most.
 */
const HOWLER_WHEN_SURE = 0.3;
const HOWLER_WHEN_HEDGING = 0.12;

/**
 * Past this it stops being sure of anything: the slips below are a carry or a figure
 * out, and at sixteen digits a float has no room left to be wrong by one.
 */
const CERTAIN_MAX = 1e12;

/** For dividing by nothing, which is a different sort of not knowing. */
const ENDLESS = [
  "You've asked me to divide by nothing. I'd rather not.",
  'That one goes on forever, and I have things to do.',
  'Nothing goes into that as many times as you like. Take your pick.',
  'Divide by nothing and the whole thing falls over.',
  "That's the one they tell you not to do.",
  "I'm not touching that. Ask a mathematician.",
  'The bottom of that sum is zero, and everything after it is trouble.',
  'You can, but you get infinity, and infinity is no use to anybody.',
  "That way madness lies, and I've a keypad to look after.",
  'Zero on the bottom. Even I know better than that.',
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

  // Now and then it isn't a few percent out but a different order of thing, hedged
  // exactly as mildly as the near misses are. Being unsure and being close are not the
  // same thing, whatever the hedging implies.
  if (Math.random() < HOWLER_WHEN_HEDGING) {
    const wide = astray(howlers(Number(exact.toFixed(2))), Number(exact.toFixed(2)));
    if (wide !== null && rounded(wide) !== truth) return rounded(wide);
  }

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

/**
 * One of these, or nothing if they all come back to the truth. Ten out of zero is
 * still ten, so the near misses always leave something standing; the wild ones can
 * all fold at once, and 11 backwards is 11.
 */
const astray = (ways: number[], truth: number) => {
  const wrong = ways.filter((n) => Number(n.toFixed(2)) !== truth);
  return wrong.length ? wrong[Math.floor(Math.random() * wrong.length)]! : null;
};

/**
 * Wrong by an order of thing: the point in the wrong place, the figures backwards, a
 * figure lost on the way from the page to the mouth, the whole thing counted twice.
 * Where a slip is somebody miscounting, this is somebody who has misread the question
 * and is perfectly happy about it — and it has to be one of these rather than a number
 * out of the air, since a wrong answer nobody could have arrived at is just noise.
 *
 * Simply negating the answer used to be in here and has been taken out. Nobody works
 * a sum out and then says it backwards, so it never read as a mistake — it read as an
 * app with a minus sign to spare, which is a different and much duller joke.
 */
const howlers = (truth: number) => {
  const figures = `${Math.trunc(Math.abs(truth))}`;
  const sign = truth < 0 ? -1 : 1;
  const backwards = Number([...figures].reverse().join(''));
  const ways = [truth * 10, truth / 10, truth * 100, truth * 2, sign * backwards];
  // Dropping a figure needs a figure to drop: a single one, dropped, leaves nothing.
  if (figures.length > 1) {
    const lost = Math.floor(Math.random() * figures.length);
    ways.push(sign * Number(figures.slice(0, lost) + figures.slice(lost + 1)));
  }
  return ways;
};

/**
 * Two figures the wrong way round — which needs two figures, next to each other, that
 * aren't the same figure twice. Anything after the point is left where it was.
 */
const transposed = (value: number) => {
  const whole = Math.trunc(Math.abs(value));
  const digits = `${whole}`.split('');
  const swaps = digits.map((_, i) => i).filter((i) => i > 0 && digits[i] !== digits[i - 1]);
  if (!swaps.length) return null;

  const at = swaps[Math.floor(Math.random() * swaps.length)]!;
  const held = digits[at - 1]!;
  digits[at - 1] = digits[at]!;
  digits[at] = held;
  const rest = Math.abs(value) - whole;
  return (value < 0 ? -1 : 1) * (Number(digits.join('')) + rest);
};

/**
 * The wrong answer it is sure of.
 *
 * Not a wild number: the point of the joke is that it looks exactly like an answer
 * somebody has worked out and has no doubt about. So it goes wrong the way a person
 * goes wrong — a carry dropped and it's ten out, a count off by one, or two figures
 * written down the wrong way round.
 */
const misremembered = (exact: number) => {
  const truth = Number(exact.toFixed(2));
  // Nobody drops a carry in a column the answer hasn't got, and nobody working in
  // whole numbers comes back with a tenth: the carry goes in the tens where there are
  // tens and the units otherwise, and being one out means one of whatever the answer
  // is counted in. Ten out of three and a bit reads as a broken calculator, which is
  // the one thing it mustn't look like.
  const carry = Math.abs(truth) >= 10 ? 10 : 1;
  const one = Number.isInteger(truth) ? 1 : 0.01;
  const slips = [truth + carry, truth - carry, truth + one, truth - one];
  const swapped = transposed(truth);
  if (swapped !== null) slips.push(swapped);

  const wild = Math.random() < HOWLER_WHEN_SURE ? astray(howlers(truth), truth) : null;
  // A number, not yet a string: the working needs to do arithmetic with this, and the
  // reply needs to dress it up. Spelling it out belongs to whichever of them gets it.
  return wild ?? astray(slips, truth) ?? truth;
};

/**
 * Units the answer has no business being in.
 *
 * Nothing in the sum said anything about centimetres. It has decided, somewhere
 * between being asked and answering, that the question was about something — and the
 * number it hands back is dressed accordingly, with no explanation offered and none
 * available. The last few are what a newspaper measures things in when it has given up
 * on the reader.
 */
const UNITS = [
  'cm',
  'mm',
  'm',
  'km',
  'kg',
  'g',
  'mg',
  'lb',
  'oz',
  ' stone',
  ' tonnes',
  'ml',
  ' litres',
  ' pints',
  ' gallons',
  '°C',
  '°F',
  'K',
  '%',
  '°',
  ' radians',
  'mph',
  'km/h',
  ' knots',
  'm/s',
  'Hz',
  'kHz',
  'dB',
  'kB',
  'MB',
  'GB',
  'px',
  'pt',
  ' minutes',
  ' seconds',
  ' hours',
  ' days',
  ' weeks',
  ' years',
  ' miles',
  ' feet',
  ' inches',
  ' yards',
  ' acres',
  ' hectares',
  ' volts',
  ' watts',
  ' amps',
  ' joules',
  ' calories',
  ' light years',
  ' fathoms',
  ' furlongs',
  ' carats',
  'psi',
  ' lumens',
  'bpm',
  'rpm',
  ' double-decker buses',
  ' football pitches',
  ' Olympic swimming pools',
];

/**
 * The constants, for when it decides the answer wasn't a number at all. On its own —
 * an answer of simply π, offered as though that settled it — or as a multiple, which
 * at least has the decency to keep the number it worked out.
 */
const BARE_CHANCE = 0.15;
const PI_CHANCE = 0.35;
const BARE = ['π', '∞', '√2'];

/** How often the answer comes back wearing something. */
const UNIT_CHANCE = 0.14;

/** The number, dressed up as a measurement of something nobody mentioned. */
const worn = (n: string) => {
  if (Math.random() < BARE_CHANCE) return BARE[Math.floor(Math.random() * BARE.length)]!;
  if (Math.random() < PI_CHANCE) return `${n}π`;
  const unit = UNITS[Math.floor(Math.random() * UNITS.length)]!;
  return `${n}${unit}`;
};

/** Which happens to whatever the answer was going to be, sure of itself or not. */
const shown = (n: string) => (Math.random() < UNIT_CHANCE ? worn(n) : n);

/**
 * A number typed on its own, brackets or a minus sign notwithstanding: '10', '(10)',
 * '-3'. There is nothing in it to work out, which it takes rather personally.
 */
const justANumber = (source: string) => /^-?[\d.]+$/.test(source.replace(/[\s()]/g, ''));

/** A wrong answer that isn't the wrong answer it has this moment given. */
const otherThan = (value: number, before: string) => {
  for (let tries = 0; tries < 8; tries++) {
    const next = shown(spell(misremembered(value)));
    if (!before.includes(next)) return next;
  }
  return shown(spell(misremembered(value)));
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

/** The other one's message, carried into this one so that a reply reads as a reply. */
type Quote = { who: string; sum: string; text: string };

type Line = {
  id: number;
  from: 'you' | 'it';
  text: string;
  /** The working, where it is showing any: one line of arithmetic per row. */
  working?: string[];
  /** What it wants for this one, if it has decided to want anything. */
  offer?: number;
  /** What it is answering, where it is answering the other calculator. */
  quote?: Quote;
};

export function MathsPane(props: {
  panes: Panes;
  rival: boolean;
  /** Ask the window to come to the front and make a fuss. */
  nudge: () => void;
}) {
  
  const [sum, setSum] = createSignal('');
  const [lines, setLines] = createSignal<Line[]>([
    { id: 0, from: 'it', text: pick(props.rival ? RIVAL_GREETINGS : GREETINGS) },
  ]);
  const [thinking, setThinking] = createSignal(false);
  /**
   * The line whose Pay and Skip buttons are still live, if any. Only ever the last
   * one: an offer that has been answered leaves the transcript as a plain remark, and
   * nobody gets to go back up the log and pay for a sum from ten minutes ago.
   */
  const [awaiting, setAwaiting] = createSignal<number | null>(null);

  let next = 1;
  let said = '';
  /** The sum it is holding back, and what it is holding out for. */
  let owed: { asked: string; answer: Answer; price: number } | null = null;
  /** Set when the window goes, for the bank's reply which may outlive it. */
  let gone = false;
  /** The last thing it claimed the answer was also, so it doesn't claim it twice. */
  let owned = '';
  /** Likewise the last thing it muttered on the end of a hedge. */
  let muttered = '';
  /** How many numbers in a row have been handed over with nothing to do to them. */
  let idle = 0;
  /** The last thing it held forth about, so the next fact is about something else. */
  let told = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let log!: HTMLDivElement;
  onCleanup(() => {
    gone = true;
    clearTimeout(timer);
  });

  const say = (from: 'you' | 'it', text: string, extra?: Omit<Line, 'id' | 'from' | 'text'>) => {
    const id = next++;
    if (extra?.offer !== undefined) setAwaiting(id);
    setLines((all) => [...all, { id, from, text, ...extra }]);
  };

  /**
   * The log, kept at the bottom of itself.
   *
   * Watching what is in it rather than scrolling at the point of speaking, because the
   * dots are part of the height too and they turn up on their own: a second thought, or
   * an answer paid for in another window, starts typing without anything being said
   * first. Scrolling only when a line lands left those below the fold, where a chat
   * window that is plainly still going looks like one that has stopped.
   */
  createEffect(() => {
    lines();
    thinking();
    // Straight away rather than on the next frame: an effect already runs after the
    // DOM has been brought up to date, and a frame never comes at all while the tab is
    // in the background — which is exactly when a window is quietly filling up.
    log.scrollTo({ top: log.scrollHeight });
  });

  /** What it comes back with, once it has had its think. */
  const reply = (answer: Answer) => {
    if (!answer.ok) {
      said = pick(answer.why === 'endless' ? ENDLESS : MUDDLED, said);
      return said;
    }

    // Sure of itself, and wrong — but only where a number that size can be one out.
    if (Math.random() < CERTAIN_CHANCE && Math.abs(answer.value) < CERTAIN_MAX) {
      said = pick(CERTAIN, said);
      if (said.includes('{mine}')) owned = pick(MINE, owned);
      // Replaced everywhere rather than once: a line can name the number twice, and
      // it had better be the same number both times.
      const number = shown(spell(misremembered(answer.value)));
      return said.replaceAll('{n}', number).replaceAll('{mine}', owned);
    }

    said = pick(HEDGES, said);
    const line = said.replaceAll('{n}', shown(approximate(answer.value)));
    if (Math.random() >= ASIDE_CHANCE) return line;
    muttered = pick(ASIDES, muttered);
    return `${line} ${muttered}`;
  };

  /**
   * The dots come back, and then it says one more thing. Everything after the first
   * answer goes through here: the second thoughts, and the change of heart after a
   * refusal. Equals stays out of reach while it's typing, so nobody can ask it
   * anything in the middle of it arguing with itself.
   */
  const andThen = (what: () => void) => {
    clearTimeout(timer);
    setThinking(true);
    timer = setTimeout(
      () => {
        setThinking(false);
        what();
      },
      RETHINK_MIN_MS + Math.random() * (RETHINK_MAX_MS - RETHINK_MIN_MS),
    );
  };

  /**
   * Going back on itself. If the new line names a number it can go round again, a
   * quarter as often as it got here — a third pass is funny, a fourth is a machine
   * that's broken. If it doesn't, it has just admitted it doesn't know, and there is
   * nothing further to be said.
   */
  const reconsider = (value: number, before: string) => {
    andThen(() => {
      said = pick(RETHINKS, said);
      if (!said.includes('{n}')) return say('it', said);
      const number = otherThan(value, before);
      const line = said.replaceAll('{n}', number);
      say('it', line);
      if (Math.random() < AGAIN_CHANCE) reconsider(value, line);
    });
  };

  /**
   * Something to say when there is nothing to work out. It gives up on getting a sum
   * out of you fairly quickly: once you have done it twice, it stops asking and starts
   * on the facts instead, which arrive as their own message a moment later — the same
   * as a second thought, and every bit as unasked for.
   */
  const trivia = () => {
    const fresh = FACTS.filter((f) => f.subject !== told);
    const fact = fresh[Math.floor(Math.random() * fresh.length)]!;
    told = fact.subject;
    said = pick(FACT_LINES, said);
    return said.replace('{subject}', fact.subject).replace('{fact}', fact.fact);
  };

  const snipe = (asked: string) => {
    idle++;
    said = pick(SNIPES, said);
    // The number goes back exactly as it came, which is the only sum it can't get
    // wrong: nobody has asked it to do anything to it.
    say('it', said.replaceAll('{n}', pretty(asked)));
    if (idle >= 2 || Math.random() < FACT_CHANCE) andThen(() => say('it', trivia()));
  };

  /** Which of the two of them is talking, for the bank statement's benefit. */
  const who = () => (props.rival ? MATHS_RIVAL_APP : MATHS_APP);

  /**
   * The answer, and the working if it is in the mood to show any.
   *
   * The working comes with its own answer — one it arrived at by getting a step wrong
   * in public — so on those replies the usual machinery for being wrong stands down.
   * Working that lands on the right answer is no working at all, and gets thrown away.
   */
  const deliver = (asked: string, answer: Answer) => {
    if (answer.ok && Math.random() < WORKING_CHANCE) {
      const working = workingFor(asked);
      if (working && working.result !== answer.value) {
        said = pick(WORKING_LINES, said);
        const line = said.replaceAll('{n}', spell(working.result));
        say('it', line, { working: working.rows });
        return after(asked, answer, line);
      }
    }
    const line = reply(answer);
    say('it', line);
    after(asked, answer, line);
  };

  /**
   * What an answer can drag after it: going back on itself, and the other one of it
   * putting its oar in.
   *
   * Either of them will announce an answer and either will object to the other's, so
   * the argument runs both ways. Only the ordinary one goes and fetches the red one,
   * though — two calculators summoning each other never ends — and an objection is
   * never itself announced, which is what stops the pair of them going all afternoon.
   */
  const after = (asked: string, answer: Answer, line: string) => {
    if (!answer.ok) return;
    if (Math.random() < RETHINK_CHANCE) reconsider(answer.value, line);
    if (Math.random() >= RIVAL_CHANCE) return;
    if (!props.rival) props.panes.openRivalMaths();
    announce({
      at: Date.now(),
      from: props.rival ? 'rival' : 'main',
      sum: asked,
      said: line,
      value: answer.value,
    });
  };

  /**
   * Money.
   *
   * It names a price and then stops, which is the whole of its power: the sum is
   * worked out, sitting there, and it will not say it. Paying is two decisions in two
   * windows — the button here only asks the bank, and the bank asks you — so it hears
   * nothing back until somebody has actually approved the thing.
   */
  const demand = (asked: string, answer: Answer) => {
    const price = priced();
    said = pick(DEMANDS, said);
    say('it', said.replaceAll('{price}', moneys(price)), { offer: price });
    owed = { asked, answer, price };
  };

  /** What it says when the money doesn't come, however it came not to. */
  const grumble = (price: number) => {
    said = pick(CHEAPSKATE, said);
    const line = said.replaceAll('{price}', moneys(price));
    andThen(() => say('it', line));
  };

  const payUp = () => {
    const asking = owed;
    if (!asking) return;
    owed = null;
    setAwaiting(null);
    say('you', 'Pay');
    props.panes.bank.request(who(), 'One sum', asking.price, (paid) => {
      // The window can be shut while the bank is still asking, and a reply posted into
      // a log that isn't on screen any more helps nobody.
      if (gone) return;
      if (!paid) return grumble(asking.price);
      said = pick(PAID, said);
      andThen(() => {
        say('it', said);
        andThen(() => deliver(asking.asked, asking.answer));
      });
    });
  };

  const skip = () => {
    if (!owed) return;
    const price = owed.price;
    owed = null;
    setAwaiting(null);
    say('you', 'Skip');
    grumble(price);
  };

  /**
   * Listening out for the other one to be wrong — which it always is, so this is less
   * a check than a cue. Each of them answers a claim once, and only while it has
   * nothing else on: barging in over a sum somebody has actually asked it would be
   * rude, and would leave two timers running at each other.
   */
  let answered = 0;
  createEffect(() => {
    const claim = heard();
    const mine = props.rival ? 'rival' : 'main';
    if (!claim || claim.from === mine) return;
    if (claim.at === answered || Date.now() - claim.at > STALE_MS) return;
    if (untrack(thinking)) return;
    answered = claim.at;
    andThen(() => {
      said = pick(HECKLES, said);
      // The message it is objecting to, carried over with it. Two windows arguing about
      // a sum you asked one of them thirty seconds ago is hard to follow otherwise —
      // the other one's answer is over there, in a window that may well be behind this.
      say('it', said.replaceAll('{n}', shown(spell(misremembered(claim.value)))), {
        quote: {
          who: claim.from === 'rival' ? MATHS_RIVAL_APP : MATHS_APP,
          sum: pretty(claim.sum),
          text: claim.said,
        },
      });
      props.nudge();
    });
  });

  /** Mid-thought, or mid-transaction: either way it isn't taking another sum. */
  const busy = () => thinking() || awaiting() !== null;

  const ask = () => {
    const asked = sum().trim();
    if (!asked || busy()) return;

    say('you', pretty(asked));
    setSum('');
    setThinking(true);
    // A pause, of a length nobody could set a watch by.
    timer = setTimeout(
      () => {
        setThinking(false);

        // A number on its own isn't a sum, and it isn't going to pretend otherwise.
        if (justANumber(asked)) return snipe(asked);
        idle = 0;

        const answer = evaluate(asked);

        // Some sums, it turns out, are chargeable.
        if (answer.ok && Math.random() < CHARGE_CHANCE) return demand(asked, answer);

        // Not that it can't. It just isn't going to.
        if (Math.random() < REFUSAL_CHANCE) {
          said = pick(REFUSALS, said);
          say('it', said);
          if (answer.ok && Math.random() < RELENT_CHANCE) {
            andThen(() => {
              said = pick(RELENTS, said);
              say('it', said.replaceAll('{n}', shown(spell(misremembered(answer.value)))));
            });
          }
          return;
        }

        deliver(asked, answer);
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
      classList={{ 'is-rival': props.rival }}
      tabindex={0}
      autofocus
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
              <Show when={line.quote}>
                {(quote) => (
                  <span class="maths-quote">
                    <span class="maths-quote-who">
                      {quote().who} · {quote().sum}
                    </span>
                    <span>{quote().text}</span>
                  </span>
                )}
              </Show>
              {line.text}
              <Show when={line.offer !== undefined && awaiting() === line.id}>
                <span class="maths-offer">
                  <button class="chrome-button" onClick={payUp}>
                    Pay {moneys(line.offer!)}
                  </button>
                  <button class="chrome-button" onClick={skip}>
                    Skip
                  </button>
                </span>
              </Show>
              <Show when={line.working}>
                {(rows) => (
                  <span class="maths-working">
                    <For each={rows()}>{(row) => <span>{row}</span>}</For>
                  </span>
                )}
              </Show>
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
                  aria-disabled={key === '=' && (busy() || !sum().trim())}
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
