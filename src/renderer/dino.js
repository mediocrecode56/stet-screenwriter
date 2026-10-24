// A tiny pixel-art dinosaur that lives on the edge of the desk, above TODAY.
//
// Three parts:
//  * dino-art.js — the pixel art (frames, props, glyphs).
//  * dino-acts.js — the repertoire: activities, click reactions, and its part
//    in what happens around it.
//  * this file — Critter, the behaviour engine (pure logic, no DOM, so its
//    whole life can be simulated in tests), and Dino, which draws it on one
//    canvas laid over the bottom of the desk (taking no room in the layout and
//    no clicks except on the dinosaur itself) and feeds it time, clicks and
//    the writer's words. It redraws only when the picture changes, ~11 times a
//    second at most while something moves, and not at all while hidden.
//
// The playground is the whole width of the editor area, along the top edge of
// the status bar: its feet stand on that line, never on it. Its home is the
// stretch around TODAY (up to 560 px), where it spends nearly all its time;
// now and then curiosity takes it further out, and very rarely all the way to
// the bottom-left corner of the window, to have a bite at the border. Visitors
// come in from out of sight at the ends. It never walks out of sight.
//
// While the window is in the background, tufts of grass slowly come up (on the clock, not on
// frames) and after a long while it sleeps deeply, with hardly any ticks; back at the window it
// wakes gently, and eats the grass only once the writer is writing again (see TIMING).
//
// Behaviour is a sequence of activities. Each is a generator yielding short
// steps (≤ 1.5 s), so a reaction — to a click, or to something happening
// around it — is slotted in at the next step boundary: the current motion
// always finishes, the dinosaur gets up first if it has to, reacts, and then
// carries on with what it was doing. A click is acknowledged on the spot (a
// blink and a little start drawn over the current frame), and a pose that is
// merely being held is held a little shorter so the reaction can begin at
// once; moves, jumps and lifts always run their full length. Which reaction it
// is depends on what it was doing at the click (walking, chewing a bone,
// typing, sleeping, under a palm tree, in the rain…), its mood, and what it
// did recently. The pointer merely passing over it does nothing at all.
//
// It walks whenever it moves: the body only ever moves as far as its legs
// step, one stride per frame, so its feet never slide.
//
// The environment has a life of its own: now and then a rain cloud drifts
// over, a breeze gets up, a bird drops by, a tumbleweed rolls through, a star
// falls at night, a cactus or a tuft of grass comes up (it notices, in its own
// time, and may go over to see) — and the dinosaur may grow a palm tree, find a flower, a
// mushroom or a snail, or meet a balloon, a paper plane, a frog, a ladybird,
// a dandelion or a worm; or come across an acorn, a cricket, a feather or, rarely, a gem. When the theme turns dark or light on its schedule,
// it sees the sun go down or come up. Each has a beginning, its part for the dinosaur, and a
// natural end; only one event runs at a time, and one starts only when the
// dinosaur can take part.
//
// It has no shame, either: now and then it flops on its back to scratch an itch (all the more after
// the rain), swaggers up and down showing off (all the more once today's goal is met), burps after a
// meal, and poses in front of anything worth a look, a palm or a rainbow or its own sandcastle.
//
// How lively it is follows the words you actually write, smoothed over minutes
// so it warms up and calms down gradually. Time passing alone never makes it
// busier, and it never nags: an idle writer just gets a dinosaur having a nap.
// A writing streak makes it grow a pixel at each milestone (1, 2, 4, 8, 16 and
// 32 days in a row) and unlocks a special routine at every second one.

import { W, H, FRAMES, PROPS, GLYPHS, ALPHA, MOUTH, HEAD_TOP, GET_UP, postureOf, spriteEdges } from './dino-art.js';
import { ACTIVITIES, REACTIONS, CATEGORY, MOODS, ENV_ACTIVITIES, ABSORBED, SPECIALS, QUIET, CRITTERS, BASELINE_0_8 } from './dino-acts.js';

const MIN = 60000;
// Poses that are merely held: one of these can be cut short (never a move, a jump or a lift).
const HOLD = new Set(['stand', 'blink', 'up', 'sit', 'sitBlink', 'sitBreath', 'sitUp', 'armsUp', 'yawn', 'oneLeg', 'wag', 'hunch', 'lie', 'lieBreath', 'lieUp', 'lieUpBlink']);
const isHold = (s) => HOLD.has(s.f) && !s.dx && !s.jump && !s.lift && !s.flip;
const BLINK_MS = 140; // one of its own blinks
const LAND_MS = 110;  // the crouch as it lands from a jump
const WALKING = new Set(['walk', 'patrol', 'zoomies', 'ponder', 'explore', 'cornerBite']);
// Frames whose legs carry it along the ground (any other move on the ground would slide).
const STEPPING = /^(walk|run|creep)/;
const DANCING = new Set(['dance', 'sing', 'celebrate', 'rainDance', 'boogie']);
const CALM = new Set(['rest', 'look', 'sleep', 'stargaze', 'watchWriter', 'readScript', 'coffeeBreak', 'writeAlong', 'treeShade', 'doze', 'scratch', 'wag', 'yoga', 'daydream']);
// Things that grow and wither: frames from sprout to full, and how long each stage takes.
const GROW = { palm: [3, 1100], flower: [3, 900], mushroom: [2, 260], dandelion: [2, 800], cactus: [2, 1400], grass: [2, 900], fern: [3, 900], bloom: [3, 900], reed: [3, 900] };
const LUSH = { fern: 1, bloom: 1, reed: 1 }; // the plants of a very long sleep
// The large plants: they last a good while, and their time stands still while the window is in the background.
const LARGE = new Set(['cactus', 'palm']);
// What it will pose in front of (photobomb): grown plants, a rainbow, its own handiwork.
const SIGHTS = new Set(['palm', 'flower', 'cactus', 'mushroom', 'rainbow', 'mound', 'doodle', 'rock']);
// While the window is in the background (another application has the focus) small tufts of grass creep
// up, slowly and only so many, and after a long while it falls into a deep sleep; back at work, it wakes
// and in its own time eats the grass. All in ms; Critter's `timing` option overrides any of them.
// (Everything that comes up while you are away does so at GROWTH times the pace it had until 0.37.)
const GROWTH = 1.25;
export const TIMING = {
  deepSleep: 12 * MIN,          // in the background this long: a deep sleep
  tuftFirst: [1 * MIN / GROWTH, 2.5 * MIN / GROWTH], // the first tuft after the window loses the focus…
  tuftEvery: [1.5 * MIN / GROWTH, 4 * MIN / GROWTH], // …and then one every so often
  tuftsMax: 12,                    // a little meadow by the time you're back
  tuftGrow: 45000 / GROWTH,     // per stage of a tuft's growth
  grazeAfter: [8000, 45000],    // back and writing again: a while before it starts on the grass
  dormantTick: 60000,           // dormant (see Critter.dormant): at most this long between ticks
  lushAfter: 40 * MIN / GROWTH, // away this long (deep asleep most of it): rarer plants come up too…
  lushEvery: [3 * MIN / GROWTH, 7 * MIN / GROWTH], // …one every so often…
  lushMax: 3,                   // …only a few
  lushGrow: 3 * MIN / GROWTH,   // per stage of their growth
};
// Things that float or fly about: only a few at a time, so the scene never gets busy.
const FLOATING = new Set(['butterfly', 'bubble', 'seed', 'firefly', 'balloon', 'bird', 'plane', 'ladybug', 'feather', 'dragonfly', 'bee', 'kite']);
// What lies about after it has played (it may tidy it away), and what it can hide behind.
const LITTER = new Set(['pebble', 'stick', 'wad', 'shell', 'ball', 'bone', 'acorn', 'coconut']);

// ---- what it does next ----------------------------------------------------------------------------
//
// Every activity it chooses for itself has an entry: its tempo, and how much it feels like it in the
// world as it is now (`s`, Critter.world(): its energy, the time of day, the weather, what lies about,
// grows or flies there, what it ate and when). The tempo, with what it did just before, colours every
// choice (TEMPO_AFTER): a romp leaves it ready for a sit, a long rest for a stretch and a stroll. Some
// follow on from particular ones (FOLLOWS). Since 0.43 the lively ones weigh a quarter less, and the
// rare ones a little more. A weight of 0 means it can't, here and now: every one can, somewhere
// (test/unit/dino-reach.test.js finds the world for each). The theme's sunset and sunrise, today's goal
// and the streak's growth come by other ways (Critter.pending).
const LIVE = 0.75; // the lively ones, against what they were
const CHOICES = {
  sleep: ['calm', (s) => (s.e < 0.15 ? (s.idle > 240 ? 6 : 0.8) : 0) * (s.night ? 1.3 : 1)],
  rest: ['calm', (s) => (4 * (1 - s.e) + 0.6) * (s.raining ? 1.2 : 1)],
  look: ['easy', (s) => 2.2 + (s.floating ? 0.4 : 0) + (s.idle > 120 ? 0.3 : 0)], // a look round, the more with something about, or nothing to do
  walk: ['easy', (s) => (0.6 + 3.2 * s.e) * (s.raining ? 0.5 : 1)],
  stretch: ['easy', (s) => 0.5 + 0.8 * (1 - s.e) + (s.morning ? 0.3 : 0)],
  wag: ['easy', (s) => 0.3 + 0.5 * s.e + (s.goalMet ? 0.2 : 0)],
  scratch: ['easy', (s) => 0.45 + (s.wet ? 0.2 : 0)],
  doze: ['calm', (s) => 0.05 + 0.9 * (1 - s.e) * (1 - s.e) + (s.late ? 0.3 : 0)], // nods off more the calmer things are
  ponder: ['easy', (s) => 0.3 + (s.writing ? 0 : 0.15)],
  sunbathe: ['calm', (s) => (!s.night && s.e < 0.6 && !s.cloud ? 0.12 + (s.wet ? 0.3 : 0) : 0)], // drying off in the sun
  watchWriter: ['calm', (s) => (s.writing ? 0.8 : 0.12)],
  readScript: ['calm', (s) => (s.idle > 20 && s.idle < 600 ? 0.6 : 0.15)], // reads over your page when you stop for a bit
  coffeeBreak: ['calm', (s) => 0.2 + (s.morning ? 0.4 : 0)],
  howl: ['easy', (s) => (s.late ? 0.3 + (s.moon ? 0.3 : 0) : 0)],
  sing: ['lively', (s) => (0.12 + 0.3 * s.e) * LIVE * (s.raining ? 0.6 : 1)],
  yoga: ['calm', (s) => 0.05 + 0.2 * (1 - s.e) + (s.morning ? 0.08 : 0)],
  workout: ['lively', (s) => (0.08 + 0.3 * s.e) * LIVE * (s.goalMet ? 1.3 : 1)],
  shakeOff: ['easy', (s) => 0.1 + (s.wet ? 3 : 0)],
  hop: ['lively', (s) => 2.5 * s.e * s.e * LIVE * (s.raining ? 0.5 : 1)],
  zoomies: ['lively', (s) => (s.e > 0.5 ? 0.5 * s.e : 0) * LIVE * (s.free ? 1 : 0.6)],
  pounce: ['lively', (s) => (0.15 + 0.4 * s.e) * LIVE * (s.floating ? 1.4 : 1)],
  roll: ['lively', (s) => (0.08 + 0.12 * s.e) * LIVE * (s.wet ? 0.5 : 1)],
  somersault: ['lively', (s) => (0.06 + 0.3 * s.e) * LIVE * (s.free ? 1 : 0.6)],
  headstand: ['lively', (s) => (0.03 + 0.1 * s.e) * LIVE * (s.free ? 1 : 0.6)],
  dance: ['lively', (s) => (s.e > 0.45 ? 2 * s.e * s.e : 0) * LIVE * (s.goalMet ? 1.4 : 1)],
  roar: ['lively', (s) => (0.1 + 0.25 * s.e) * LIVE * (s.night ? 0.6 : 1)],
  trip: ['lively', (s) => (0.05 + 0.15 * s.e) * LIVE * (s.litter ? 1.4 : 1)], // gags stay occasional; something to trip over helps
  moonwalk: ['lively', (s) => (s.e > 0.35 ? 0.35 * s.e : 0) * LIVE * (s.moon ? 1.5 : 1)],
  chaseTail: ['lively', (s) => (0.08 + 0.35 * s.e) * LIVE * (s.free ? 1 : 0.7)],
  sneeze: ['easy', (s) => 0.15 + (s.bloom ? 0.25 : 0)], // flowers about
  fetch: ['lively', (s) => (s.free ? 0.1 + 1.2 * s.e : 0) * LIVE],
  dig: ['easy', (s) => (s.free ? 0.25 + 0.25 * s.e : 0) * (s.wet ? 1.4 : 1)], // digging takes some energy, and soft ground
  leaf: ['easy', (s) => (s.free ? 0.15 + 0.4 * (1 - s.e) : 0) * (s.windAgo < 5 * MIN ? 1.8 : 1)],
  butterfly: ['lively', (s) => (s.free && s.calmSky ? 0.3 * (s.bloom ? 1.8 : 1) : 0) * (s.night ? 0.3 : 1)],
  inspect: ['easy', (s) => (s.resting ? 1.4 : 0)],
  writeAlong: ['calm', (s) => (s.writing ? 0.5 + 1.5 * s.e : 0)],
  juggle: ['lively', (s) => (s.free ? 0.08 + 0.5 * s.e * s.e : 0) * LIVE],
  pebbleToss: ['easy', (s) => (s.free ? 0.18 : 0)],
  sandcastle: ['easy', (s) => (s.free ? 0.18 * (s.wet ? 1.8 : 1) : 0)], // wet sand holds
  bubbles: ['easy', (s) => (s.free && s.calmSky ? 0.12 + 0.2 * s.e : 0) * (s.windy ? 0.3 : 1)],
  hiccups: ['easy', (s) => 0.08 + (s.fedAgo < 3 * MIN ? 0.15 : 0)],
  flamingo: ['easy', (s) => 0.1 * (s.puddle ? 1.6 : 1)],
  peekaboo: ['lively', (s) => (0.12 + 0.2 * s.e) * LIVE * (s.hideout ? 0.6 : 1)],
  shadowbox: ['lively', (s) => (0.08 + 0.35 * s.e) * LIVE * (s.night ? 0.7 : 1)],
  groom: ['calm', (s) => 0.4 + 0.3 * (1 - s.e) + (s.fedAgo < 3 * MIN ? 0.3 : 0)], // everyday habits
  sniffTrail: ['easy', (s) => 0.25 + 0.25 * s.e + (s.wet ? 0.15 : 0)], // scents carry after the rain
  doodle: ['easy', (s) => (s.free ? 0.5 + 0.3 * s.e : 0) * (s.raining ? 0.3 : 1)], // draws in the sand
  patrol: ['lively', (s) => (0.2 + 0.3 * s.e) * LIVE * (s.night ? 1.3 : 1)],
  explore: ['lively', (s) => (s.roomOut ? 0.1 + 0.1 * s.e : 0) * (s.raining ? 0.3 : 1)],
  cornerBite: ['lively', (s) => (s.corner && s.cornerAgo > 40 * MIN ? 0.005 * Math.min(4, s.cornerAgo / (60 * MIN)) : 0)], // very rare
  stargaze: ['calm', (s) => (s.late ? 0.8 * (s.cloud ? 0.3 : 1) : 0)],
  daydream: ['calm', (s) => (s.night ? 0.3 : 0.45) + 0.5 * (1 - s.e)],
  settleIn: ['calm', (s) => 0.2 + 0.55 * (1 - s.e) + (s.late ? 0.2 : 0)], // makes its bed before a rest
  gatherPebbles: ['easy', (s) => (s.free ? 0.35 + 0.25 * s.e : 0)], // lines up pebbles
  crumple: ['easy', (s) => (s.free ? 0.16 + (s.idle > 60 && s.idle < 900 ? 0.1 : 0) : 0)], // a page of its own, tossed over its shoulder
  drink: ['calm', (s) => (s.puddle ? 0.9 : 0)], // at the puddle (the more after a run about: FOLLOWS)
  stick: ['calm', (s) => (s.free && s.ok('stick', 8 * MIN) ? 0.05 : 0)], // seldom: a stick to chew
  tightrope: ['lively', (s, c) => (c.since('tightrope') > 35 * MIN ? 0.06 + 0.06 * s.e : 0) * (s.windy ? 0.4 : 1)], // less common: a balancing act on the line
  plantSeed: ['easy', (s, c) => (s.focused && s.free && !s.flower && c.since('plantSeed') > 35 * MIN ? 0.075 * (s.wet ? 1.5 : 1) : 0)], // less common: it plants a flower
  graze: ['calm', (s) => (s.tuft ? 1.4 + 0.25 * s.tufts : 0)],
  // Shameless: a roll on its back (the more after the rain), a swagger (the more once today's goal is
  // met), a burp after a meal, and posing in front of whatever is worth a look.
  backScratch: ['easy', (s) => 0.05 + 0.08 * (1 - s.e) + (s.wet ? 0.5 : 0)],
  strut: ['lively', (s) => (0.08 + 0.3 * s.e) * LIVE + (s.goalMet ? 0.45 : 0)],
  burp: ['easy', (s) => (s.fedAgo < 2 * MIN ? 2.4 : 0)],
  photobomb: ['easy', (s, c) => (c.since('photobomb') > 5 * MIN && s.sight ? 0.5 : 0)],
  // The environment: new things now and then, and what it does with them while they last.
  palmTree: ['easy', (s) => (!s.palm && s.ok('palm', 6 * MIN) ? 0.12 * (s.wet ? 1.5 : 1) : 0)],
  treeShade: ['calm', (s) => (s.tree ? 1.1 * (s.night ? 0.6 : 1) : 0)],
  shakeTree: ['easy', (s) => (s.tree ? 0.5 : 0)],
  flower: ['easy', (s) => (!s.flower && s.ok('flower') ? 0.13 * (s.wet ? 1.5 : 1) : 0)],
  mushroom: ['easy', (s) => (!s.mushroom && s.ok('mushroom') ? 0.1 * (s.wet ? 2 : 1) : 0)], // after the rain
  snail: ['easy', (s) => (s.ok('snail', 6 * MIN) ? 0.09 * (s.wet ? 2 : 1) : 0)],
  fireflies: ['easy', (s) => (s.night && s.calmSky && s.ok('fireflies') ? 0.35 : 0)],
  puddleJump: ['lively', (s) => (s.puddle ? 2 * LIVE : 0)],
  visitPlant: ['easy', (s, c) => (s.plant ? (c.gapTo(s.plant) > 300 ? 1 : 2.6) : 0)], // not every plant, and not at once
  // Visitors now and then.
  balloon: ['lively', (s) => (s.free && s.calmSky && s.ok('balloon', 5 * MIN) ? 0.12 * (s.windy ? 0.3 : 1) : 0)],
  paperPlane: ['easy', (s) => (s.free && s.calmSky && s.ok('paperPlane', 5 * MIN) ? 0.12 * (s.writing ? 1.3 : 1) : 0)],
  frog: ['lively', (s) => (s.free && s.ok('frog', 5 * MIN) ? 0.12 * (s.puddle || s.wet ? 2 : 1) : 0)],
  ladybug: ['easy', (s) => (s.free && s.calmSky && s.ok('ladybug', 4 * MIN) ? 0.15 * (s.bloom ? 1.5 : 1) : 0)],
  dandelion: ['easy', (s) => (s.free && s.calmSky && !s.dandelion && s.ok('dandelion', 5 * MIN) ? 0.1 : 0)],
  worm: ['lively', (s) => (s.free && s.ok('worm', 5 * MIN) ? 0.12 * (s.wet ? 2.5 : 1) : 0)], // worms come up in the wet
  // Small finds, each with its own odds: an acorn now and then, a feather seldom, a gem only rarely.
  acorn: ['easy', (s) => (s.free && s.ok('acorn', 5 * MIN) ? 0.14 * (s.tree ? 1.3 : 1) : 0)],
  cricket: ['lively', (s) => (s.free && s.ok('cricket', 5 * MIN) ? 0.09 * (s.night ? 1.6 : 1) : 0)], // they sing at night
  feather: ['easy', (s) => (s.free && s.calmSky && s.ok('feather', 6 * MIN) ? 0.07 : 0)],
  gem: ['easy', (s) => (s.free && s.ok('gem', 10 * MIN) ? 0.038 : 0)],
  // Something small lives in the grass: now and then it darts out, while you're here to see.
  critter: ['lively', (s) => (s.free && s.focused && s.grass && s.ok('critter', 3 * MIN) ? 0.22 : 0)],
  // Five newer neighbours (0.43): a dragonfly by the water to snap at, a bee to run from (at the flowers
  // above all), a kite on the breeze to hang on to (seldom), a rock out of the sand to climb, never the
  // same shape twice (seldom), and a dung beetle to lend a hand.
  dragonfly: ['lively', (s) => (s.free && s.calmSky && !s.night && s.ok('dragonfly', 5 * MIN) ? 0.07 * (s.puddle ? 4 : s.wet ? 2 : 1) : 0)],
  bee: ['lively', (s) => (s.free && s.calmSky && !s.night && s.ok('bee', 5 * MIN) ? (s.bloom ? 0.4 : 0.04) : 0)],
  kite: ['lively', (s) => (s.free && s.calmSky && !s.night && !s.raining && s.ok('kite', 25 * MIN) ? 0.035 * (s.windAgo < 10 * MIN ? 4 : 1) : 0)],
  boulder: ['easy', (s) => (s.rock ? 0.35 : s.free && s.ok('boulder', 12 * MIN) ? 0.05 : 0)], // a new rock seldom; one about, often climbed
  beetle: ['easy', (s) => (s.free && !s.night && s.ok('beetle', 6 * MIN) ? 0.08 * (s.wet ? 0.5 : 1) : 0)],
  // Three newer habits (0.43): leaves swept into a heap to leap into (after a breeze, under a palm),
  // hide and seek behind something big, and tidying away what it left lying about.
  leafPile: ['lively', (s) => (s.leaves >= 2 ? 0.6 : s.windAgo < 4 * MIN && s.free ? 0.25 : 0)],
  hideSeek: ['lively', (s) => (s.hideout ? 0.3 + 0.2 * s.e : 0)],
  tidyUp: ['easy', (s) => (s.litter >= 2 ? 0.2 + 0.25 * Math.min(4, s.litter) : 0)],
  // Unlocked by the writing streak.
  skateboard: ['lively', (s) => (s.unlocked >= 1 && s.free ? 0.3 * (s.wet ? 0.4 : 1) : 0)],
  fireworks: ['lively', (s) => (s.unlocked >= 2 && s.free ? 0.22 * (s.night ? 2 : 1) : 0)], // brightest at night
  rainDance: ['lively', (s) => (s.unlocked >= 3 && !s.tree && !s.cloud && !s.palm && s.ok('rainDance', 8 * MIN) ? 0.24 : 0)],
  egg: ['easy', (s) => (s.free ? 0.015 * s.luck : 0)], // rare surprises
  ufo: ['easy', (s) => 0.0125 * s.luck * (s.night ? 1.5 : 1)],
};
// The tempo of what it did, against the tempo of what it might do now.
const TEMPO_AFTER = {
  lively: { lively: 0.55, easy: 1, calm: 1.6 },
  easy: { lively: 1, easy: 0.9, calm: 1.1 },
  calm: { lively: 1.15, easy: 1.25, calm: 0.75 },
};
const CHOICE_LIST = Object.entries(CHOICES);
const TEMPO = { ...Object.fromEntries(Object.entries(CHOICES).map(([k, [t]]) => [k, t])), celebrate: 'lively', grow: 'easy', shrink: 'easy', nightfall: 'calm', daybreak: 'lively' };
// What tends to follow particular things: { next: { after: factor } }.
const FOLLOWS = {
  stretch: { sleep: 2.4, rest: 2, doze: 2, daydream: 1.6, settleIn: 1.8, stargaze: 1.4, treeShade: 1.5, sunbathe: 1.5, yoga: 0.3, workout: 1.5 },
  walk: { sleep: 1.6, rest: 1.6, daydream: 1.4, readScript: 1.3 },
  explore: { rest: 1.4, sleep: 1.4, patrol: 0.4 },
  look: { zoomies: 1.4, hop: 1.4, sniffTrail: 1.3, kite: 1.3 },
  rest: { zoomies: 2, fetch: 1.5, workout: 1.6, explore: 1.5, patrol: 1.3, kite: 1.6, bee: 1.4, leafPile: 1.3 },
  daydream: { zoomies: 1.6, kite: 1.4 },
  wag: { fetch: 1.3, gem: 1.5, acorn: 1.3 },
  scratch: { dig: 1.3, sandcastle: 1.3, leafPile: 1.8, sniffTrail: 1.2 },
  drink: { zoomies: 2.5, hop: 2.5, dance: 2.5, fetch: 2.5, pounce: 2.5, workout: 2.5, chaseTail: 2.5, juggle: 2.5, somersault: 2.5, patrol: 2.5, explore: 2.5, shadowbox: 2.5, skateboard: 2.5, tightrope: 2.5, dragonfly: 1.6, leafPile: 1.6 },
  shakeOff: { leafPile: 2.2, dig: 1.6, puddleJump: 2.5, roll: 1.5 },
  groom: { graze: 1.6, stick: 1.6, dig: 1.5, roll: 1.4, leafPile: 1.5 },
  sniffTrail: { dig: 1.5, worm: 1.6, critter: 1.5, beetle: 1.6 },
  tidyUp: { gatherPebbles: 2.5, pebbleToss: 2.2, juggle: 1.8, crumple: 2.5, stick: 2, fetch: 1.6, dig: 1.5, acorn: 1.3, inspect: 1.4 },
  photobomb: { doodle: 1.6, sandcastle: 2, palmTree: 1.5, flower: 1.4, boulder: 1.6, strut: 1.3 },
  hideSeek: { boulder: 1.8, palmTree: 1.5, peekaboo: 0.3, bee: 1.3 },
  boulder: { dig: 1.3, hideSeek: 1.2 },
  sleep: { stargaze: 1.6, settleIn: 1.8, nightfall: 1.6, yoga: 1.2 },
  writeAlong: { coffeeBreak: 1.6, readScript: 1.4, watchWriter: 1.3 },
  ponder: { readScript: 1.5, crumple: 1.3 },
  crumple: { writeAlong: 1.6, readScript: 1.3 },
  rainDance: { sunbathe: 0.5 },
  sunbathe: { shakeOff: 1.6, daybreak: 1.6 },
  inspect: { fetch: 1.4, juggle: 1.3 },
  howl: { nightfall: 1.8, stargaze: 1.4 },
  strut: { celebrate: 2, grow: 2, photobomb: 1.2 },
  dance: { celebrate: 1.6 },
  burp: { graze: 1.2 },
};

// Environmental events: started by time, only one at a time, and only when the dinosaur can take part.
const EVENTS = {
  rain: { cool: 8 * MIN, w: 1, ok: (c) => !c.find('cloud') },
  wind: { cool: 10 * MIN, w: 0.6, ok: (c) => !c.wind && c.floating() < 2 },
  bird: { cool: 7 * MIN, w: 0.8, ok: (c) => !c.find('bird') && c.floating() < 2 && c.hat?.kind !== 'bird' && (!!c.grownTree() || (CALM.has(c.activity) && (postureOf(c.frame) !== 'lie' || c.asleep()))) },
  tumbleweed: { cool: 9 * MIN, w: 0.6, ok: (c) => !c.find('tumbleweed') },
  shootingStar: { cool: 10 * MIN, w: 1.4, ok: (c) => c.night() && !c.asleep() },
  sprout: { cool: 8 * MIN, w: 0.8, ok: (c) => !c.props.some((p) => p.wild) && c.loose < 4 },
};

// ---- the behaviour engine ---------------------------------------------------------------------

export class Critter {
  constructor({ rng = Math.random, unit = () => 1.25, width = () => 160, margin = () => 24, home = () => null, corner = () => false, progress = () => ({}), clock = () => Date.now(), timing = {} } = {}) {
    this.rng = rng;
    this.T = { ...TIMING, ...timing };
    this.unitOf = unit;
    this.widthOf = width;
    this.marginOf = margin;  // room out of sight beyond each end of the strip (where visitors come from)
    this.homeOf = home;      // the home stretch around TODAY { lo, hi } in strip px (null: all of it)
    this.cornerOf = corner;  // whether the strip's left end is the window's bottom-left corner
    this.getProgress = progress;
    this.clock = clock;     // wall clock (time of day: night-time things)
    this.x = 30; this.face = 1; this.y = 0; this.flip = false;
    this.frame = 'sit';
    this.effects = [];
    this.particles = [];    // dirt, splashes, puffs, steam
    this.drops = [];        // raindrops
    this.sparks = [];       // fireworks, a shooting star, sparkles
    this.streaks = [];      // gusts of wind
    this.props = [];
    this.hat = null;        // { kind, until }
    this.energy = 0;        // 0 calm … 1 lively (smoothed)
    this.heat = 0;          // recent writing (decays)
    this.lastWrite = 0;
    this.queue = [];        // pending click reactions: { name, at }
    this.envDue = null;     // its part in an environmental event: { name, at }
    this.pokes = [];
    this.history = [];      // recent reactions, newest last
    this.lastUsed = {};
    this.recent = [];       // recent activities
    this.step = null;
    this.gen = null;
    this.paused = null;     // activity interrupted by a reaction
    this.inReaction = null;
    this.activity = '';
    this.pending = null;    // an activity to do next (e.g. celebrate)
    this.mood = 'content';
    this.moodUntil = 0;
    this.cursor = null;     // where the last click landed { x, y, t }, strip coordinates
    this.ack = null;        // { t0 } — a click acknowledged on the spot
    this.celebrated = '';
    this.force = null;      // test hook: name of the next reaction
    this.lastTick = null;
    this.now = 0;
    this.held = [];         // steps waiting behind an inserted get-up step
    this.pid = 0;
    // Environment.
    this.event = null;      // the environmental event under way { kind, t0, … }
    this.envNext = null;    // when the next one may start
    this.lastEnv = {};      // kind → when it last happened
    this.wind = null;       // { dir, t0, until }
    this.wetUntil = 0;
    this.sheltered = false;
    // Writing streak: growth in screen pixels, and how many special loops are unlocked.
    this.g = 0;
    this.targetG = 0;
    this.unlocked = 0;
    this.lastRare = 0;      // when the last rare surprise (an egg, a UFO) came along
    this.lastCorner = 0;    // when it last went all the way to the corner
    this.lastDone = {};     // activity → when it last began (for the rarer ones' cooldowns)
    this.fed = -Infinity;   // when it last ate something (a burp may follow)
    // The window in the background.
    this.focused = true;
    this.blurAt = null;     // when the window lost the focus
    this.backAt = -Infinity; // when it last got it back
    this.grazeAt = 0;       // from when it may start on the grass that grew meanwhile
    this.tuftNext = null;   // when the next tuft comes up (only while in the background)
    this.deep = false;      // in a deep sleep
    this.gapMs = 0;         // real time since the previous tick (uncapped)
    // The small touches of something alive: blinks of its own, and the weight of a landing.
    this.blinkAt = null;    // when its next blink starts
    this.landAt = -Infinity; // when it last came down from a jump
    this.hideIn = null;     // what it is hiding behind (hide and seek)
    this.ownSeed = 0x2545f491;
  }

  // -- randomness --
  /** The small touches' own random numbers (blinks, a landing's dust), so they never change what
   *  it does: the rest of its life runs exactly as it would without them. */
  ownRnd(a, b) { this.ownSeed = (this.ownSeed * 1664525 + 1013904223) >>> 0; return a + (this.ownSeed / 4294967296) * (b - a); }
  rnd(a, b) { return a + this.rng() * (b - a); }
  rint(a, b) { return Math.floor(this.rnd(a, b + 1)); }
  chance(p) { return this.rng() < p; }
  /** Weighted pick from [[value, weight], …] or { value: weight }. */
  pick(items) {
    const list = Array.isArray(items) ? items : Object.entries(items);
    let sum = 0;
    for (const [, w] of list) sum += Math.max(0, w);
    if (sum <= 0) return list[0][0];
    let r = this.rng() * sum;
    for (const [v, w] of list) { r -= Math.max(0, w); if (r <= 0 && w > 0) return v; }
    return list.filter(([, w]) => w > 0).at(-1)[0];
  }

  // -- geometry (x in CSS px along the strip; heights in world rows of `u` px) --
  get u() { return this.unitOf(); }
  /** One of the dinosaur's own pixels: grows with the streak, so it is exactly `g` px taller. */
  get du() { return this.u + this.g / H; }
  get dw() { return W * this.du; }
  get stripW() { return this.widthOf(); }
  get margin() { return this.marginOf(); }
  get maxX() { return Math.max(0, this.stripW - this.dw); }
  clampX(x) { return Math.max(0, Math.min(this.maxX, x)); }
  clampProp(x, cols = 6) { return Math.max(0, Math.min(this.stripW - cols * this.u, x)); }
  /** Dinosaur x at fraction `f` of its home stretch (0 its left end, 1 its right end, 0.5 the middle). */
  zone(f) {
    const h = this.homeOf(), lo = this.clampX(h ? h.lo : 0), hi = Math.max(lo, this.clampX(h ? h.hi - this.dw : this.maxX));
    return lo + f * (hi - lo);
  }
  /** Out beyond its home stretch (on an excursion). */
  away() { return this.x < this.zone(0) - 1 || this.x > this.zone(1) + 1; }
  /** A place to go: usually the middle of its home stretch, now and then further out in it. */
  spot() {
    if (this.chance(0.12)) return this.zone(this.rnd(0.05, 0.95));
    return this.zone(0.5 + (this.rng() + this.rng() - 1) * 0.38);
  }
  /** Near an end of its home stretch (or beyond it): the direction back towards the middle (else 0). */
  inward() { return this.x > this.zone(0.8) ? -1 : this.x < this.zone(0.2) ? 1 : 0; }
  sitting() { return postureOf(this.frame) === 'sit'; }
  onstage() { return this.x >= -0.5 && this.x <= this.maxX + 0.5; }
  center() { return this.x + this.dw / 2; }
  /** Its height in world rows (where the top of the head is). */
  height() { return (H * this.du) / this.u + this.y; }
  headX() { return this.x + (this.face > 0 ? 14 : W - 1 - 14) * this.du; }
  nose() { return this.x + (this.face > 0 ? W - 1 : 0) * this.du; }
  /** x for a prop `cols` wide just in front of the snout (gap in dinosaur pixels; negative overlaps). */
  front(cols, gap = 1) { return this.clampProp(this.face > 0 ? this.x + (W + gap) * this.du : this.x - gap * this.du - cols * this.u, cols); }
  cursorX() { return this.cursor ? this.cursor.x : this.center(); }
  towardCursor() { return this.cursor ? (this.cursor.x >= this.center() ? 1 : -1) : this.face; }
  propW(p) { return this.propCols(p) * this.u; }
  propCenter(p) { return p.x + this.propW(p) / 2; }
  dirTo(p) { return p ? Math.sign(this.propCenter(p) - this.center()) || this.face : this.face; }
  awayFrom(p) { return -this.dirTo(p); }
  gap(p) { return Math.abs(this.propCenter(p) - this.center()) - (this.dw + this.propW(p)) / 2; }
  /** Dinosaur x that centres it on a prop (under a leaf, onto a mushroom, into a puddle). */
  centreOn(p) { return this.clampX(this.propCenter(p) - this.dw / 2); }
  /** Dinosaur x at which its nose reaches a prop on the ground (`inset` columns into it). */
  reach(p, inset = 0) {
    const pw = this.propW(p) - 2 * inset * this.u, left = p.x + inset * this.u;
    return this.clampX(left + pw / 2 < this.center() ? left + pw - 2 * this.du : left - 15 * this.du);
  }
  trunk(tree) { return tree.x + 6.5 * this.u; }
  /** Sitting under a palm: its back against the trunk. */
  under(tree) {
    const side = Math.sign(this.center() - this.trunk(tree)) || 1;
    return this.clampX(this.trunk(tree) - this.dw / 2 + side * 4 * this.du);
  }
  find(kind) { return this.props.find((p) => p.kind === kind && !p.carried) || null; }
  grownTree() { return this.props.find((p) => p.kind === 'palm' && p.frame === GROW.palm[0] && !p.withering) || null; }
  windDir() { return this.wind ? this.wind.dir : -this.face; }
  /** Props, not counting the tufts that grew while the window was in the background (they get in nobody's way). */
  get loose() { let n = 0; for (const p of this.props) if (!p.tuft) n++; return n; }
  tufts() { return this.props.filter((p) => p.tuft && !p.carried); }
  nearestTuft() { let best = null; for (const p of this.tufts()) if (!best || this.gapTo(p) < this.gapTo(best)) best = p; return best; }
  /** How many things are floating or flying about. */
  floating() { let n = 0; for (const p of this.props) if (FLOATING.has(p.kind) || (p.kind === 'leaf' && p.blown)) n++; return n; }
  /**
   * Where a visitor comes in from on side `from` (-1 left, 1 right): just out of
   * sight at that end of the strip, or, if that is a long way off, fading in a
   * little beyond its home stretch. Sets x (and the fade) on the options `o`.
   */
  arrive(o, cols, from) {
    const far = from < 0 ? -this.margin : this.stripW + this.margin - cols * this.u;
    const near = from < 0 ? this.zone(0) - 140 : this.zone(1) + this.dw + 140 - cols * this.u;
    const x = from < 0 ? Math.max(far, near) : Math.min(far, near);
    return Object.assign(o, { x }, x === far ? {} : { alpha: 0, fadeIn: true });
  }
  /** A visitor heading out (direction `dir`) is well past its home stretch: time to fade away. */
  gone(p, dir) { return dir > 0 ? p.x > this.zone(1) + this.dw + 240 : p.x + this.propW(p) < this.zone(0) - 240; }
  /** The plant it has noticed and not yet been to see, once it has let it be a while. */
  plantToVisit() { return this.props.find((p) => p.wild && p.noticed && !p.visited && this.now >= p.visitAt && (this.focused || !p.tuft && p.kind !== 'grass') && p.life - (this.now - p.born) > 30000 + 80 * this.gapTo(p)) || null; } // time to get there and back; small plants only while you're here
  night() { const h = new Date(this.clock()).getHours(); return h >= 21 || h < 6; }
  /** Something nearby worth posing in front of: full grown, whole on the strip, staying a while yet. */
  sight() {
    return this.props.find((p) => SIGHTS.has(p.kind) && !p.carried && !p.withering && p.fadeOutAt == null && (p.alpha ?? 1) >= 1
      && (!GROW[p.kind] || p.frame === GROW[p.kind][0]) && p.x >= 0 && p.x + this.propW(p) <= this.stripW
      && this.gapTo(p) < 400 && p.life - (this.now - p.born) > 20000) || null;
  }
  /** A flower, a bloom or a dandelion about, opened (a bee's errand). */
  bloom() { return this.props.find((p) => (p.kind === 'flower' || p.kind === 'bloom' || p.kind === 'dandelion') && !p.carried && p.frame >= 2 && p.fadeOutAt == null) || null; }
  /** Leaves lying on the ground (not blowing about). */
  groundLeaves() { return this.props.filter((p) => p.kind === 'leaf' && !p.carried && !p.blown && !p.fall && p.y === 0 && p.fadeOutAt == null && p.x >= 0 && p.x + this.propW(p) <= this.stripW); }
  /** Something big enough to hide behind (in its own mind): a grown palm or cactus, or a rock; the nearest. */
  hideout() {
    let best = null;
    for (const p of this.props) {
      const big = p.kind === 'rock' || ((p.kind === 'palm' || p.kind === 'cactus') && p.frame === GROW[p.kind][0] && !p.withering);
      if (!big || p.carried || p.fadeOutAt != null || p.x < 0 || p.x + this.propW(p) > this.stripW || p.life - (this.now - p.born) < 30000) continue;
      if (this.gapTo(p) < 300 && (!best || this.gapTo(p) < this.gapTo(best))) best = p;
    }
    return best;
  }
  /** What it left lying about after playing, on the ground and staying a while yet (it may tidy it away). */
  litter() { return this.props.filter((p) => LITTER.has(p.kind) && !p.carried && !p.balance && p.y === 0 && !p.vx && p.fadeOutAt == null && p.life - (this.now - p.born) > 15000 && p.x >= 0 && p.x + this.propW(p) <= this.stripW); }

  /** What it is doing right now — the context a click or an event is answered in. */
  context() {
    const s = this.step, posture = postureOf(this.frame), near = {};
    for (const p of this.props) if (!p.carried && !p.balance && !(p.kind in near) && Math.abs(this.propCenter(p) - this.center()) < 60) near[p.kind] = p;
    const tree = this.grownTree();
    return {
      activity: this.activity,
      reaction: this.inReaction,
      posture,
      moving: !!(s && s.dx && this.now < s.end && STEPPING.test(s.f)) || (WALKING.has(this.activity) && posture === 'stand' && !this.inReaction),
      air: !!(s && (s.jump || s.lift || s.flip)),
      asleep: this.asleep(),
      near,
      carrying: this.props.find((p) => p.carried)?.kind ?? null,
      hat: this.hat?.kind ?? null,
      raining: !!this.find('cloud')?.raining,
      wet: this.now < this.wetUntil,
      tree: tree && Math.abs(this.trunk(tree) - this.center()) < 120 ? tree : null,
      night: this.night(),
      mood: this.mood,
    };
  }

  // -- writing and energy --
  wrote(n, now) {
    if (n <= 0) return;
    this.heat += Math.min(n, 50); // a single big change counts like a burst, not a marathon
    this.lastWrite = now;
    // Writing again: the plants of a long sleep wither back, a stage at a time, each in its own time.
    for (const p of this.props) if (p.lush && !p.wilting) {
      p.wilting = true;
      p.per = this.rnd(2500, 6000);
      p.life = now - p.born + p.frame * p.per + this.rnd(500, 4000);
    }
  }

  updateEnergy(dt) {
    this.heat *= Math.exp(-dt / 120000);                       // words written, fading over ~2 min
    const wpm = this.heat / 2;                                  // ≈ words per minute recently
    const { today = 0, goal = 0 } = this.getProgress() || {};
    const goalPart = goal > 0 ? 0.12 * Math.min(1, today / goal) : 0;
    const target = Math.min(1, 1 - Math.exp(-wpm / 18) + goalPart * (wpm > 1 ? 1 : 0.3));
    this.energy += (target - this.energy) * (1 - Math.exp(-dt / 20000)); // glide, never jump
  }

  updateMood(now) {
    if (now < this.moodUntil) return;
    const e = this.energy;
    this.mood = this.pick({ content: 3, playful: 0.5 + 2.5 * e, curious: 1.5, sleepy: (this.night() ? 2 : 0.5) + 2 * (1 - e), grumpy: 0.5, silly: 0.6 + e });
    this.moodUntil = now + this.rnd(6, 20) * MIN;
  }

  // -- the writing streak --
  /** Growth in px (0–6) from the streak. Shown with a little ceremony, or at once (at start-up). */
  setGrowth(g, animate = true) {
    this.targetG = g;
    if (!animate) this.g = g;
  }
  setUnlocked(n) { this.unlocked = Math.max(0, Math.min(SPECIALS.length, n | 0)); }

  // -- choosing what to do --
  envOk(kind, cool = 4 * MIN) { return !this.event && this.loose < 4 && this.now - (this.lastEnv[kind] ?? -1e12) > cool; }
  /** How long since activity `a` last began. */
  since(a) { return this.now - (this.lastDone[a] ?? -1e12); }
  envMark(kind) { this.lastEnv[kind] = this.now; }

  /** The state of its world as a choice of what to do sees it (CHOICES). */
  world(now = this.now) {
    const h = new Date(this.clock()).getHours(), cloud = this.find('cloud');
    const { today = 0, goal = 0 } = this.getProgress() || {};
    const tree = this.grownTree();
    const leaves = this.groundLeaves().length + (tree && tree.withering ? 1 : 0), floating = this.floating();
    return {
      e: this.energy,
      idle: (now - this.lastWrite) / 1000,
      writing: this.heat > 6,
      night: h >= 21 || h < 6, late: h >= 22 || h < 5, morning: h >= 6 && h < 11, // (as night() has it)
      focused: this.focused,
      free: this.loose < 2,
      // Back at work after a while away, and writing again: the grass that grew meanwhile.
      tuft: this.focused && this.lastWrite > this.backAt && now >= this.grazeAt ? this.nearestTuft() : null,
      tufts: this.tufts().length,
      grass: this.props.some((p) => (p.tuft || p.lush) && p.frame >= 1),
      tree, cloud, raining: !!cloud?.raining && !this.sheltered,
      palm: this.find('palm'), flower: this.find('flower'), mushroom: this.find('mushroom'), dandelion: this.find('dandelion'),
      bloom: this.bloom(), rock: this.find('rock'), moon: this.find('moon'),
      puddle: this.find('puddle'), wet: now < this.wetUntil,
      floating, calmSky: floating < 2,
      windy: !!this.wind, windAgo: now - (this.lastEnv.wind ?? -1e12),
      fedAgo: now - this.fed,
      roomOut: this.zone(0) > 60 || this.zone(1) < this.maxX - 60, // somewhere beyond its home stretch to explore
      corner: this.cornerOf() && this.zone(0) > 120, cornerAgo: now - this.lastCorner,
      plant: this.plantToVisit(), sight: this.sight(), resting: this.restingProp(), hideout: this.hideout(),
      litter: this.litter().length, leaves,
      goalMet: goal > 0 && today >= goal,
      unlocked: this.unlocked,
      luck: Math.min(5, 1 + (now - this.lastRare) / (25 * MIN)), // the longer since the last rare surprise, the likelier the next
      ok: (kind, cool) => this.envOk(kind, cool),
    };
  }

  /** How much it feels like each activity now: its world, its mood, what it just did, and variety. */
  weights(now = this.now) {
    const s = this.world(now), prev = this.activity, before = TEMPO[prev], w = {};
    for (const [a, [tempo, f]] of CHOICE_LIST) {
      let x = f(s, this);
      if (!(x > 0)) continue;
      if (before) x *= TEMPO_AFTER[before][tempo];
      if (FOLLOWS[a]?.[prev]) x *= FOLLOWS[a][prev];
      // The weather and the hour: under the rain, and at night, it takes things more quietly.
      if (s.raining) x *= tempo === 'lively' ? 0.5 : tempo === 'calm' ? 1.2 : 1;
      if (s.night) x *= tempo === 'lively' ? 0.8 : tempo === 'calm' ? 1.15 : 1;
      w[a] = x;
    }
    const m = MOODS[this.mood].act;
    for (const k in m) if (w[k]) w[k] *= m[k];
    if (this.away()) for (const k of ['explore', 'patrol', 'cornerBite']) delete w[k]; // already out on an excursion
    this.recent.forEach((k, i) => { if (w[k]) w[k] *= i === this.recent.length - 1 ? 0.2 : 0.55; }); // variety
    return w;
  }

  pickActivity(now) {
    if (this.pending) { const a = this.pending; this.pending = null; return a; }
    if (this.deepDue(now)) { this.deep = true; return 'sleep'; } // long in the background: off to sleep, properly
    if (this.targetG !== this.g) return this.targetG > this.g ? 'grow' : 'shrink';
    const w = this.weights(now);
    const a = Object.keys(w).length ? this.pick(w) : 'look';
    if (a === 'egg' || a === 'ufo') this.lastRare = now;
    if (a === 'cornerBite') this.lastCorner = now;
    return a;
  }

  /**
   * The theme just turned dark or light on its schedule: the sun sets (or rises)
   * and it stops what it is doing to see it. A sleeper sleeps on through
   * nightfall (the moon still comes up), but the sunrise wakes it.
   */
  themeShift(dark) {
    if (dark && this.asleep()) {
      const old = this.find('sun');
      if (old) this.fadeOut(old, 1500);
      if (this.loose < 7) this.sky('moon', { x: this.clampProp(this.center() + (this.inward() || 1) * 80, 5), y: 2, ty: 24, alpha: 0, fadeIn: true, life: 40000 });
      return;
    }
    this.pending = dark ? 'nightfall' : 'daybreak';
    if (ABSORBED.has(this.activity) && this.activity !== 'nightfall' && this.activity !== 'daybreak') return; // finish that first
    if (this.inReaction) this.paused = null; else this.gen = null;
  }

  // -- clicks --
  poke(now, x, y) {
    if (x != null) this.cursor = { x, y: y ?? 0, t: now };
    this.pokes = this.pokes.filter((t) => now - t < 4000);
    this.pokes.push(now);
    const a = this.pokes.length;
    // Acknowledged on the spot, whatever it is doing and whatever comes next:
    // a blink and a little start drawn over the current frame (see Dino.draw),
    // and a held pose turns to face you.
    this.ack = { t0: now };
    if (this.step && now < this.step.end && isHold(this.step) && !this.asleep() && !this.inReaction) this.face = this.towardCursor();
    const k = this.context(); // what it was doing at the click decides how it reacts
    if (this.queue.length >= 2) {
      // Plenty queued already: extra clicks are absorbed — or turn the last one into something bigger.
      if (a === 5 || (a >= 8 && a % 3 === 2)) this.queue[this.queue.length - 1] = { name: this.chooseReaction(now, a, k), at: now };
      return;
    }
    const name = this.chooseReaction(now, a, k);
    const R = REACTIONS[name];
    let at = now;
    if (R.delay) at += this.rnd(R.delay[0], R.delay[1]);
    else if (this.chance(0.2)) at += this.rnd(200, 700); // sometimes a beat before reacting
    this.queue.push({ name, at });
  }
  /** The click acknowledgement is showing (blink for 160 ms, a 1-pixel start for the first 90). */
  acking(now) { return this.ack && now - this.ack.t0 < 160 ? (now - this.ack.t0 < 90 ? 2 : 1) : 0; }

  asleep() { return this.activity === 'sleep' && postureOf(this.frame) === 'lie'; }

  // -- the window in the background --
  /**
   * The window got (true) or lost (false) the focus. Away, tufts of grass come up
   * now and then (growWhileAway) and after T.deepSleep it sleeps deeply; back,
   * a deep sleeper wakes gently, and the grass waits until writing resumes.
   */
  setFocus(on, now = this.now) {
    if (on === this.focused) return;
    this.focused = on;
    if (!on) {
      this.blurAt = now;
      this.tuftNext = now + this.rnd(...this.T.tuftFirst);
      if (this.envDue && this.envDue.name === 'deepWake') this.envDue = null; // away again before it woke: it sleeps on
      return;
    }
    // Long enough away for a deep sleep it was never seen to fall into (the window was hidden): found asleep.
    if (!this.deep && this.blurAt != null && now - this.blurAt >= this.T.deepSleep && now - (this.lastTick ?? now) > 5000) this.sleepDeeply();
    this.blurAt = null;
    this.tuftNext = null;
    this.lushNext = null;
    this.backAt = now;
    this.grazeAt = now + this.rnd(...this.T.grazeAfter);
    if (this.step && this.step.dormant) this.step.end = now; // lying still: it breathes again straight away
    if (this.deep) this.envDue = { name: 'deepWake', at: now + this.rnd(1200, 3500) };
  }
  /**
   * Dormant: deep asleep, still in the background, nothing else going on. The dinosaur lies
   * still (no breaths, no z's) and the app rests with it (Dino.onDormant): a tick only
   * when something is due (a tuft of grass), at most every T.dormantTick. Focus ends it at once.
   */
  get dormant() { return this.deep && !this.focused && this.asleep() && !this.inReaction && !this.envDue && !this.queue.length && !this.effects.length; } // (a z still drifting would freeze in mid-air)
  /** Long enough in the background for a deep sleep. */
  deepDue(now = this.now) { return !this.focused && this.blurAt != null && now - this.blurAt >= this.T.deepSleep; }
  /** Straight into a deep sleep where it is (only ever while nobody can see). */
  sleepDeeply() {
    this.tidy();
    if (this.step) this.x = this.step.x1;
    this.step = null; this.queue = []; this.held = []; this.envDue = null; this.pending = null;
    this.inReaction = null; this.paused = null; this.wakeUp = false;
    this.y = 0; this.flip = false; this.frame = 'lie';
    this.deep = true;
    this.activity = 'sleep';
    this.gen = ACTIVITIES.sleep(this);
  }
  /**
   * Tufts of grass come up while the window is in the background. Timed by the
   * clock, not by frames: however late a tick comes (a throttled or hidden
   * window), each tuft comes up when it was due, and has grown as much since.
   */
  growWhileAway(now) {
    if (this.focused) return;
    // Very long away, deep asleep: a fern, a bloom, a reed come up as well, slowly (lushNext).
    if (this.deep && this.blurAt != null) {
      this.lushNext ??= this.blurAt + this.T.lushAfter;
      while (this.lushNext <= now && this.props.filter((p) => p.lush).length < this.T.lushMax) {
        const kind = this.pick(LUSH), x = this.clearSpot(this.propCols({ kind }) * this.u, 0.3, 6);
        if (x != null) this.spawn(kind, { x, born: this.lushNext, grows: true, lush: true, per: this.T.lushGrow });
        this.lushNext += this.rnd(...this.T.lushEvery);
      }
      if (this.lushNext <= now) this.lushNext = Infinity; // enough of them: no more until next time
    }
    if (this.tuftNext == null) return;
    while (this.tuftNext <= now) {
      if (this.tufts().length >= this.T.tuftsMax) { this.tuftNext = null; return; } // enough: no more until next time
      this.tuft(this.tuftNext);
      this.tuftNext += this.rnd(...this.T.tuftEvery);
    }
  }
  tuft(born = this.now) {
    const x = this.clearSpot(PROPS.grass[0][0].length * this.u, 0.08, 4);
    return x == null ? null : this.spawn('grass', { x, born, grows: true, tuft: true, per: this.T.tuftGrow });
  }
  /** A bite out of a tuft (a stage shorter); the last bite takes it. */
  bite(p) {
    if (!this.has(p)) return;
    this.fed = this.now;
    if (p.frame <= 0) { this.remove(p); return; }
    p.frame -= 1;
    p.cut = GROW.grass[0] - p.frame;
  }

  chooseReaction(now, agitation = 1, k = this.context()) {
    if (this.force) { const n = this.force; this.force = null; this.remember(n, now); return n; }
    let name;
    if (agitation === 5) name = this.pick({ annoyed: 1, stomp: 1 });
    else if (agitation >= 8 && agitation % 3 === 2) name = this.pick({ dizzy: 1, storm: 1, runAway: this.lastUsed.runAway && now - this.lastUsed.runAway < 60000 ? 0 : 1, playDead: 0.7, hideFace: 0.8 });
    if (!name) {
      const sleeping = k.asleep;
      const settled = k.posture !== 'stand' || QUIET.has(k.activity) || !!k.carrying;
      const moodW = MOODS[this.mood].react;
      const w = {};
      for (const [n, R] of Object.entries(REACTIONS)) {
        if (R.cat === 'env') continue;
        if (sleeping ? !R.asleep : R.cat === 'asleep') continue;
        let x = R.w * (sleeping ? 1 : CATEGORY[R.cat](agitation)) * (moodW[R.cat] || 1) * ((R.mood && R.mood[this.mood]) || 1);
        if (R.ctx) x *= R.ctx(k, this);
        // Quieter when settled (sitting, lying, absorbed in something, carrying something): it answers
        // from where it is rather than leaping up; on its feet, the leaps come as the clicks keep coming.
        if (R.lively) x *= settled ? 0.12 : R.cat === 'context' ? 1 : Math.min(1, 0.3 + 0.12 * agitation); // (a leap that fits what is there stays)
        else if (settled && R.stay) x *= 1.5;
        if (R.cool && now - (this.lastUsed[n] ?? -1e12) < R.cool) x = 0;
        if (n === 'gift' && !this.cursor) x = 0;
        const i = this.history.lastIndexOf(n);
        if (i >= 0) { const ago = this.history.length - i; x *= ago <= 2 ? 0.03 : ago <= 6 ? 0.3 : ago <= 14 ? 0.7 : 1; }
        if (x > 0) w[n] = x;
      }
      name = this.pick(w);
    }
    this.remember(name, now);
    return name;
  }

  remember(name, now) {
    this.history.push(name);
    if (this.history.length > 30) this.history.shift();
    this.lastUsed[name] = now;
  }

  // -- props --
  spawn(kind, o = {}) {
    const p = { id: ++this.pid, kind, x: this.x, y: 0, vx: 0, vy: 0, frame: 0, carried: false, born: this.now, life: Infinity, ...o };
    this.props.push(p);
    return p;
  }
  has(p) { return !!p && this.props.includes(p); }
  remove(p) { this.props = this.props.filter((q) => q !== p); }
  expire(p, ms) { if (p) p.life = this.now - p.born + ms; }
  /** Fade a prop out over `ms` and then remove it. */
  /** Let something that grows wither away now. */
  wither(p) { if (p && GROW[p.kind]) { p.grows = true; p.life = this.now - p.born + GROW[p.kind][0] * GROW[p.kind][1] + 50; } }
  fadeOut(p, ms) { if (p && p.fadeOutAt == null) { p.fadeOutAt = this.now; p.fadeMs = ms; } }
  propCols(p) { return (p.art || PROPS[p.kind][0])[0].length; } // (a rock: its own shape)
  restingProp() { return this.props.find((p) => !p.carried && !p.balance && p.y === 0 && !p.vx && ['ball', 'bone', 'leaf', 'pebble', 'coconut'].includes(p.kind)); }
  pickUp(p) { if (!p) return; p.carried = true; p.vx = p.vy = 0; p.life = Infinity; p.wander = false; }
  mouthAt() {
    const [col, row] = MOUTH[this.frame] || MOUTH.stand;
    return { x: this.x + (this.face > 0 ? col : W - 1 - col) * this.du, y: (H - row) * (this.du / this.u) + this.y };
  }
  drop(p, vx) {
    if (!p) return;
    p.carried = false;
    p.x = this.clampProp(this.mouthAt().x - this.propW(p) / 2, this.propCols(p));
    p.y = 2; p.vy = 0; p.vx = vx; p.gravity = true;
  }
  /** Let go of something held in the mouth, in the air where it is (a firefly). */
  release(p) {
    if (!p) return;
    const m = this.mouthAt();
    p.carried = false; p.x = this.clampProp(m.x, 1); p.y = m.y; p.wander = true; this.expire(p, 6000);
  }
  /** Toss a held pebble up off the snout. */
  toss(p) {
    if (!p) return;
    const m = this.mouthAt();
    p.carried = false; p.x = this.clampProp(m.x - this.propW(p) / 2, this.propCols(p)); p.y = m.y; p.vy = 30; p.vx = 0; p.gravity = true;
  }
  kick(p, dir, power = 1) { p.vx = dir * this.rnd(70, 140) * power; p.vy = this.rnd(15, 40) * power; p.gravity = true; }
  wear(kind, ms) { this.hat = { kind, until: this.now + ms }; }
  unwear() { this.hat = null; }
  blowBubble() {
    const m = this.mouthAt();
    return this.spawn('bubble', { x: this.clampProp(m.x + this.face * 2 * this.u, 3), y: m.y, vy: this.rnd(5, 7), life: this.rnd(2800, 3800), float: true });
  }
  dirt(n) {
    const fx = this.x + (this.face > 0 ? 16 : 1) * this.du;
    for (let i = 0; i < n; i++) this.particles.push({ x: fx, y: 1, vx: -this.face * this.rnd(10, 40), vy: this.rnd(15, 35), t0: this.now });
  }
  puffAt(x, y = 1) { for (let i = 0; i < 4; i++) this.particles.push({ x: x + this.rnd(0, 6), y: y + this.rnd(0, 3), vx: this.rnd(-20, 20), vy: this.rnd(10, 25), t0: this.now }); }
  splashAt(x, n, dir = 0) { for (let i = 0; i < n; i++) this.particles.push({ x: x + this.rnd(-6, 6), y: 1, vx: (dir || (this.chance(0.5) ? 1 : -1)) * this.rnd(15, 45), vy: this.rnd(20, 40), t0: this.now }); }
  steam(p) { if (p) for (let i = 0; i < 2; i++) this.particles.push({ x: p.x + this.rnd(0, 3 * this.u), y: 5 + i, vx: this.rnd(-3, 3), vy: this.rnd(4, 7), g: 0, t0: this.now }); }
  spark(x, y, n) { for (let i = 0; i < n; i++) this.sparks.push({ x, y, vx: this.rnd(-15, 15), vy: this.rnd(5, 18), g: 30, t0: this.now, life: 500 }); }
  /** The sun or the moon: the one already in the sky (turned round to rise or set), or a new one. */
  sky(kind, o) {
    const p = this.find(kind);
    if (!p) return this.spawn(kind, o);
    return Object.assign(p, { ty: o.ty, fadeOutAt: null, fadeIn: true, life: this.now - p.born + o.life });
  }
  /** Stars coming out, here and there in the sky. */
  twinkle(n) { for (let i = 0; i < n; i++) this.sparks.push({ x: this.rnd(0.05, 0.95) * this.stripW, y: this.rnd(22, 33), vx: 0, vy: 0, g: 0, t0: this.now, life: this.rnd(1500, 2600) }); }
  /** A ring of sparkles around it (growing). */
  sparkle() {
    const cx = this.center(), cy = this.height() / 2;
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * 30, vy: Math.sin(a) * 9, g: 0, t0: this.now, life: 700 }); }
  }
  burst(r) {
    const cx = r.x + this.u * 1.5;
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; this.sparks.push({ x: cx, y: r.y, vx: Math.cos(a) * this.rnd(22, 30), vy: Math.sin(a) * this.rnd(8, 11), g: 8, t0: this.now, life: 950 }); }
    this.remove(r);
  }

  // -- the environment --
  canHost() {
    const s = this.step;
    return this.onstage() && !this.inReaction && !this.queue.length && !this.envDue && !this.event && !this.held.length &&
      !ABSORBED.has(this.activity) && this.loose < 6 && !(s && (s.lift || s.flip));
  }
  maybeEvent(now) {
    if (this.envNext == null) this.envNext = now + this.rnd(2, 5) * MIN;
    if (now < this.envNext) return;
    if (this.deep) { this.envNext = now + this.rnd(3.5, 8) * MIN; return; } // nothing happens around a deep sleeper
    if (!this.canHost()) { this.envNext = now + 4000; return; }
    this.envNext = now + this.rnd(3.5, 8) * MIN; // a few well-spaced events an hour, not a constant bustle
    const w = {};
    for (const [k, E] of Object.entries(EVENTS)) if (now - (this.lastEnv[k] ?? -1e12) > E.cool && E.ok(this)) w[k] = E.w;
    if (Object.keys(w).length) this.startEvent(this.pick(w), now);
  }
  /** Start an environmental event (also the test hook). */
  startEvent(kind, now = this.now) {
    this.lastEnv[kind] = now;
    this.event = { kind, t0: now };
    const u = this.u, side = this.center() < this.zone(0.5) + this.dw / 2 ? 1 : -1; // visitors come from the roomier side
    if (kind === 'rain') {
      const cloud = this.spawn('cloud', this.arrive({ y: this.cloudY(), tx: this.center() - 9 * u, phase: 'enter', alpha: 0, fadeIn: true, life: 60000, ctx: this.context() }, 18, side));
      this.event.cloud = cloud;
    } else if (kind === 'wind') {
      // A breeze: a few faint gusts and perhaps a leaf, rather than a gale.
      const dir = this.chance(0.5) ? 1 : -1;
      this.wind = { dir, t0: now, until: now + this.rnd(6000, 9000) };
      if (this.loose < 6 && this.chance(0.6)) this.spawn('leaf', this.arrive({ y: this.rnd(6, 16), vx: dir * this.rnd(40, 55), blown: true, life: 14000 }, 4, -dir));
      if (this.hat) this.blowHat(dir);
      this.envDue = { name: this.envReaction('wind'), at: now + 600 };
    } else if (kind === 'bird') {
      const tree = this.grownTree();
      this.spawn('bird', this.arrive({ y: 26, fly: true, target: tree ? 'tree' : 'head', frame: 1, life: 40000 }, 5, side));
    } else if (kind === 'tumbleweed') {
      this.spawn('tumbleweed', this.arrive({ vx: -side * 40, life: 60000 }, 7, side));
    } else if (kind === 'shootingStar') {
      const x = this.rnd(0.1, 0.4) * this.stripW, dir = this.chance(0.5) ? 1 : -1;
      this.sparks.push({ x: dir > 0 ? x : this.stripW - x, y: 31, vx: dir * 170, vy: -9, g: 0, t0: now, life: 1100, trail: true });
      this.envDue = { name: 'wish', at: now + 300 };
    } else if (kind === 'sprout') this.sprout(now);
  }
  /**
   * A plant comes up on its own, somewhere clear along the ground: usually in
   * its home stretch, now and then further out. It is noticed in its own time.
   */
  sprout(now = this.now) {
    const kind = this.pick({ grass: 3, cactus: 2, palm: this.find('palm') ? 0 : 0.8 });
    const x = this.clearSpot(PROPS[kind][0][0].length * this.u, 0.15, 8);
    if (x == null) return null;
    // Small plants come and go within a couple of minutes; a cactus or a palm stays a good while.
    const life = LARGE.has(kind) ? this.rnd(6 * MIN, 14 * MIN) : this.rnd(70000, 120000);
    return this.spawn(kind, { x, grows: true, wild: true, life, noticeAt: now + this.rnd(3000, 30000) });
  }
  /** Somewhere clear along the ground for something `w` px wide: usually in or near its home stretch (`far`: the chance of anywhere). */
  clearSpot(w, far = 0.15, room = 8) {
    const lo = this.zone(0), hi = this.zone(1) + this.dw;
    const clear = (x) => x >= 0 && x + w <= this.stripW && Math.abs(x + w / 2 - this.center()) > this.dw / 2 + w / 2 + 16 &&
      this.props.every((q) => q.carried || q.y > 0 || x + w + room < q.x || x > q.x + this.propW(q) + room);
    for (let i = 0; i < 12; i++) {
      const c = this.chance(far) ? this.rnd(0, this.stripW - w) : this.rnd(lo - 60, hi + 60 - w);
      if (clear(c)) return c;
    }
    return null;
  }
  /** Its distance (px) to a prop. */
  gapTo(p) { return Math.abs(this.propCenter(p) - this.center()); }
  eventDone(now) {
    const e = this.event;
    switch (e.kind) {
      case 'rain': return !this.has(e.cloud);
      case 'wind': return !this.wind;
      case 'bird': return !this.find('bird') && this.hat?.kind !== 'bird' && !this.envDue;
      case 'tumbleweed': return !this.find('tumbleweed');
      default: return now - e.t0 > 3000 && !this.envDue;
    }
  }
  /** Which part it plays: chosen by what it is doing when the event reaches it. */
  envReaction(kind, k = this.context()) {
    if (kind === 'rain') {
      if (k.asleep) return 'rainSleep';
      if (k.tree && !DANCING.has(k.activity)) return 'rainShelter'; // the obvious place to be
      return this.pick({ rainTolerate: k.posture === 'sit' ? 3 : 1.4, rainEscape: k.moving ? 3 : 1.1, rainDrink: 1.2, rainUmbrella: k.hat === 'leaf' ? 4 : 1.1, rainJig: DANCING.has(k.activity) || k.mood === 'playful' ? 3 : 0.7 });
    }
    if (kind === 'wind') {
      if (k.asleep) return 'windHunker';
      return this.pick({ windHat: this.props.some((p) => p.blownHat) ? 8 : 0, windHunker: k.posture !== 'stand' ? 3 : 0.4, windLean: 2, windEnjoy: 1.4 });
    }
    if (kind === 'tumbleweed') {
      if (k.asleep || k.posture !== 'stand') return 'tumbleWatch';
      return this.pick({ tumbleJump: 2, tumbleBowled: 1, tumbleChase: 1.3, tumbleWatch: 0.5 });
    }
    return null;
  }
  cloudY() { return Math.ceil((H * this.du) / this.u) + 9; }
  summonCloud(x) {
    const cloud = this.spawn('cloud', { x: this.clampProp(x - 9 * this.u, 18), y: this.cloudY(), tx: this.clampProp(x - 9 * this.u, 18), phase: 'enter', alpha: 0, fadeIn: true, dance: true, life: 40000 });
    this.event = { kind: 'rain', t0: this.now, cloud };
    return cloud;
  }
  endRain() {
    const cloud = this.props.find((p) => p.kind === 'cloud' && p.phase !== 'leave');
    if (!cloud) return;
    cloud.raining = false;
    cloud.phase = 'leave';
    cloud.tx = cloud.x + (this.chance(0.5) ? 1 : -1) * 40;
    this.fadeOut(cloud, 2500);
    this.wetUntil = this.now + 90000;
    this.sheltered = false;
    for (const p of this.props) if (p.kind === 'puddle' && p.life === Infinity) this.expire(p, 45000);
    if (!cloud.dance && this.chance(0.45)) {
      this.spawnRainbow();
      if (!this.asleep() && !this.envDue) this.envDue = { name: 'rainbowLook', at: this.now + 1200 };
    }
  }
  spawnRainbow() {
    if (this.find('rainbow') || this.loose >= 7) return;
    this.spawn('rainbow', { x: this.clampProp(this.center() - 18.5 * this.u, 37), alpha: 0, life: 14000, fadeIn: true });
  }
  blowHat(dir) {
    const kind = this.hat.kind;
    this.unwear();
    if (kind === 'bird') return this.flyOff(this.spawn('bird', { x: this.headX(), y: this.height() }), dir);
    if (kind === 'butterfly') return this.spawn('butterfly', { x: this.clampProp(this.headX(), 3), y: this.height(), vx: 16 * dir, vy: 10, life: 4000 });
    this.spawn(kind, { x: this.clampProp(this.headX() - 2 * this.u, PROPS[kind][0][0].length), y: this.height(), vx: dir * 45, vy: 12, gravity: true, blownHat: true, life: 15000 });
  }
  flyOff(bird, dir = this.chance(0.5) ? 1 : -1) {
    Object.assign(bird, { fly: false, perch: false, away: true, vx: dir * 28, vy: 14, frame: 1 });
    this.expire(bird, 2600);
    this.fadeOut(bird, 2400);
  }
  /** The bird leaves (from its head, or from the tree). */
  birdOff() {
    if (this.hat && this.hat.kind === 'bird') { this.unwear(); this.flyOff(this.spawn('bird', { x: this.headX() - 2 * this.u, y: this.height() })); return; }
    const b = this.find('bird');
    if (b && !b.away) this.flyOff(b);
  }

  /** Steps that walk to x (a number or a function, re-read every step, so moving targets can be chased). */
  *walkTo(target, speed = 1, { max = 200, pauses = false, creep = false } = {}) {
    yield* this.getTo('stand');
    let k = 0;
    const run = speed >= 2.4 && !creep;
    // A stride never goes further than its legs reach (2.5 of its pixels walking, 3
    // running): a faster pace takes more, quicker strides instead. `max` counts
    // full-pace strides, so it means the same distance at any pace.
    const legs = (run ? 3 : 2.5) * this.du;
    for (let i = 0; i < max;) {
      const tx = typeof target === 'function' ? target() : target;
      if (tx == null || Number.isNaN(tx)) return;
      const goal = this.clampX(tx);
      const diff = goal - this.x;
      if (Math.abs(diff) < 1) return;
      const dir = Math.sign(diff);
      const full = (2 + 2 * this.energy) * speed, reach = Math.min(full, legs);
      const t = Math.max(60, (Math.max(110, (240 - 90 * this.energy) / Math.sqrt(speed)) * reach) / full);
      i += reach / full;
      const f = creep ? (k++ % 2 ? 'creep2' : 'creep1') : run ? (k++ % 2 ? 'run2' : 'run1') : (k++ % 2 ? 'walk2' : 'walk1');
      yield { f, t, dx: Math.min(reach, Math.abs(diff)) * dir, face: dir };
      if (pauses && this.chance(0.05)) { yield { f: 'stand', t: 500 }; yield { f: 'up', t: 400 }; }
    }
  }

  /** Watch a moving prop until it settles (turning to follow it). */
  *watch(p, maxMs, frame = 'stand') {
    let t = 0;
    while (this.has(p) && t < maxMs && (p.vx || p.vy || (p.fall && p.y > 0))) {
      yield { f: frame, t: 250, face: postureOf(this.frame) === 'stand' ? this.dirTo(p) : undefined };
      t += 250;
    }
  }

  /** Steps to move from the current posture to another (used before reactions and after them). */
  *getTo(posture) {
    const cur = postureOf(this.frame);
    if (cur === posture) return;
    if (cur === 'lie') { yield { f: 'sitBlink', t: 260 }; if (posture === 'sit') return; }
    if (posture === 'lie') { if (cur === 'stand') yield { f: 'crouch', t: 200 }; yield { f: 'sit', t: 300 }; yield { f: 'lie', t: 300 }; return; }
    if (posture === 'sit') { yield { f: 'crouch', t: 200 }; yield { f: 'sit', t: 250 }; return; }
    yield { f: 'crouch', t: 220 }; // up from sitting
    yield { f: 'stand', t: 200 };
  }

  /** Nothing an abandoned activity was holding or riding is left hanging. */
  tidy() {
    for (const p of this.props) {
      if (p.carried) this.drop(p, 0);
      if (p.balance) { p.balance = false; p.gravity = true; }
      if (p.held) { p.held = false; p.vy = 4; } // a balloon floats off
      p.ride = false;
      if (p.life === Infinity && p.kind !== 'puddle' && !p.tuft) this.expire(p, 8000);
      if (p.kind === 'cloud' && p.dance && p.phase !== 'leave') this.endRain();
    }
    this.sheltered = false;
    this.hideIn = null;
  }

  startReaction(name) {
    const R = REACTIONS[name];
    const self = this;
    const sleeping = this.activity === 'sleep';
    const wakes = R.wakes !== false;
    const resume = postureOf(this.frame);
    const stay = R.stay && (resume !== 'lie' || R.asleep || R.lying); // never pop up from lying without getting up
    this.paused = this.gen;
    this.inReaction = name;
    this.wakeUp = sleeping && wakes;
    this.gen = (function* () {
      if (!stay) yield* self.getTo('stand');
      yield* R.fn(self);
      if (sleeping && !wakes) yield* self.getTo('lie');
      else if (!sleeping && postureOf(self.frame) !== resume) yield* self.getTo(resume);
    })();
  }

  /** Standing up on something: the last step left it off the ground, and the next carries on up there. */
  aloft() { const s = this.step; return !!(s && s.lift && s.lift[1] > 0); }

  dueNow(now) { return (this.queue.length && this.queue[0].at <= now) || (this.envDue && this.envDue.at <= now); }

  nextStep(now) {
    // The play area shrank under it (window resized, a panel opened): stroll back
    // in before anything else, then carry on with whatever it was doing.
    if (!this.onstage() && !this.inReaction) {
      const self = this;
      this.paused = this.gen;
      this.inReaction = 'comeBack';
      const speed = Math.max(1.4, Math.min(3, Math.abs(this.clampX(this.x) - this.x) / 40)); // a long way back: a brisker walk
      this.gen = (function* () { yield* self.walkTo(() => self.clampX(self.x), speed); })();
    }
    // Reactions go in between steps of the current activity, never through one;
    // its part in the environment comes first, then clicks.
    // Up on something (a rock, a skateboard, a kite's pull) it gets down first: they wait till then.
    if (!this.inReaction && this.onstage() && !this.aloft()) {
      if (this.envDue && this.envDue.at <= now) { const { name } = this.envDue; this.envDue = null; if (name !== 'deepWake' || this.deep) this.startReaction(name); }
      else if (this.queue.length && this.queue[0].at <= now) this.startReaction(this.queue.shift().name);
    }
    for (let guard = 0; guard < 6; guard++) {
      if (!this.gen) {
        const a = this.pickActivity(now);
        this.inReaction = null; this.paused = null; // a fresh activity: nothing left over from a reaction
        this.tidy();
        this.activity = a;
        this.lastDone[a] = now;
        this.recent.push(a);
        if (this.recent.length > 4) this.recent.shift();
        this.gen = ACTIVITIES[a](this);
      }
      const r = this.gen.next();
      if (!r.done) return r.value;
      if (this.inReaction) {
        this.inReaction = null;
        this.gen = this.wakeUp ? null : this.paused; // a poked sleeper stays awake
        if (this.wakeUp) this.deep = false;
        this.wakeUp = false;
        this.paused = null;
        if (this.dueNow(now)) return this.nextStep(now);
      } else this.gen = null;
    }
    const rest = postureOf(this.frame);
    return { f: rest === 'lie' ? 'lie' : rest === 'sit' ? 'sit' : 'stand', t: 500 };
  }

  // -- world --
  updateWorld(dt, now) {
    const s = dt / 1000, u = this.u, W2 = this.stripW, M = this.margin;
    const inView = (p, cols) => Math.max(-M, Math.min(W2 + M - cols * u, p.x));
    for (const p of [...this.props]) {
      const cols = this.propCols(p);
      p.live = false;
      if (p.fadeIn && p.fadeOutAt == null) { p.alpha = Math.min(1, (p.alpha ?? 0) + s / 1.2); p.live = p.alpha < 1; if (p.alpha >= 1) p.fadeIn = false; }
      if (p.fadeOutAt != null) { p.alpha = Math.max(0, 1 - (now - p.fadeOutAt) / p.fadeMs); p.live = true; if (p.alpha <= 0) { this.remove(p); continue; } }
      if (p.carried) continue;
      if (now - p.born > p.life) {
        if (GROW[p.kind] || p.kind === 'bubble' || p.kind === 'rocket') this.puffAt(p.x + (cols * u) / 2 - 3, p.kind === 'bubble' ? p.y : 1);
        this.remove(p);
        continue;
      }
      if (p.wobble) { p.wobble = Math.max(0, p.wobble - dt); p.live = true; }
      if (p.wild && !p.noticed && now >= p.noticeAt) {
        // It notices the new plant when it is free to (not asleep, not busy with something else).
        if (!this.envDue && !this.inReaction && !this.queue.length && !this.held.length && !this.asleep() && !ABSORBED.has(this.activity) && this.onstage()) {
          p.noticed = now; p.visitAt = now + this.rnd(5000, 60000);
          this.envDue = { name: 'plantNotice', at: now };
        } else p.noticeAt = now + this.rnd(2000, 6000);
      }
      if (!this.focused && p.wild && LARGE.has(p.kind)) p.life += this.gapMs; // in the background its time stands still
      if (GROW[p.kind] && p.grows) {
        const full = GROW[p.kind][0], per = p.per || GROW[p.kind][1], age = now - p.born, left = p.life - age;
        const f = Math.max(0, Math.min(full - (p.cut || 0), Math.floor(age / per), Math.floor(left / per)));
        p.withering = left < per * full;
        if (p.kind === 'palm' && p.withering && !p.shed && this.loose < 7) { p.shed = true; this.spawn('leaf', { x: p.x + 4 * u, y: 14, fall: true, life: 9000 }); }
        if (f !== p.frame) p.frame = f;
        p.live = p.live || (!p.tuft && !p.lush && age < per * (full + 1)) || (p.withering && !(p.lush && !p.wilting)); // tufts and a long sleep's plants grow too slowly to need frames
        continue;
      }
      switch (p.kind) {
        case 'leaf':
          if (p.blown) {
            p.x += p.vx * s; p.y = Math.max(2, p.y + Math.sin((now - p.born) / 250) * 6 * s);
            p.frame = Math.floor((now - p.born) / 200) % 2; p.live = true;
            if (p.x < -M || p.x > W2 + M - cols * u || this.gone(p, Math.sign(p.vx))) { p.x = inView(p, cols); this.fadeOut(p, 600); p.vx = 0; }
            break;
          }
          if (p.y > 0) { p.live = true; p.y = Math.max(0, p.y - 5 * s); p.x = this.clampProp(p.x + Math.sin((now - p.born) / 380) * 9 * s, cols); p.frame = Math.sin((now - p.born) / 380) > 0 ? 0 : 1; }
          else { p.fall = false; p.x += p.vx * s; p.vx *= Math.exp(-s * 3); if (Math.abs(p.vx) < 1) p.vx = 0; }
          break;
        case 'butterfly': {
          const age = now - p.born;
          p.live = true;
          if (this.rng() < s * 0.8) p.vx = -p.vx;
          p.x = Math.max(-M, Math.min(W2 + M - cols * u, p.x + p.vx * s));
          if (p.vy) { p.y += p.vy * s; p.vy = Math.max(0, p.vy - 20 * s); }
          if (age > p.life - 3000) p.y += 4 * s; // flutters off upward, blinking away
          else p.y += (12 + 4 * Math.sin(age / 300) - p.y) * Math.min(1, s * 2);
          p.y = Math.min(p.y, H + 22);
          if (p.x < 4 - M && p.vx < 0 && age > 2000) p.vx = Math.abs(p.vx);
          if (p.x > W2 + M - 8 && p.vx > 0 && age > 2000) p.vx = -Math.abs(p.vx);
          p.frame = Math.floor(age / 160) % 2;
          break;
        }
        case 'baby':
          p.live = true;
          p.x += p.vx * s;
          p.y = p.hops ? Math.abs(Math.sin((now - p.born) / 220)) * 2 : 0;
          p.frame = Math.floor((now - p.born) / 200) % 2;
          if (p.x < -M || p.x > W2 + M - 8) p.vx = 0;
          break;
        case 'ufo':
          p.live = true;
          p.x += (p.tx - p.x) * (1 - Math.exp(-s * (p.leaving ? 1.2 : 1.8)));
          p.y = 24 + Math.sin((now - p.born) / 300);
          break;
        case 'cloud': {
          p.live = true;
          if (p.phase === 'rain' && !this.sheltered) p.tx = this.center() - 9 * u; // it follows
          p.x = inView({ x: p.x + (p.tx - p.x) * (1 - Math.exp(-s * (p.phase === 'enter' ? 1.4 : 1.2))) }, cols);
          p.y = this.cloudY() + Math.sin((now - p.born) / 700) * 0.6;
          if (p.phase === 'enter' && Math.abs(p.x - p.tx) < 1.5) {
            if (p.dance) p.phase = 'hold';
            else {
              p.phase = 'rain'; p.raining = true; p.rainT0 = now;
              const k = this.context();
              const name = !!p.ctx.asleep === k.asleep ? this.envReaction('rain', p.ctx) : this.envReaction('rain', k);
              this.envDue = { name, at: now };
              if (!this.find('puddle')) this.spawn('puddle', { x: this.clampProp(p.x + u, 16), frame: 0, fill: 0 });
            }
          }
          if (p.raining && !p.dance && now - p.rainT0 > 16000) this.endRain(); // never rains for ever
          p.frame = p.raining ? 1 : 0;
          if (p.raining) {
            p.acc = (p.acc || 0) + s * 30;
            for (; p.acc >= 1 && this.drops.length < 160; p.acc--) this.drops.push({ x: p.x + this.rnd(1, 17) * u, y: p.y });
          }
          break;
        }
        case 'puddle': {
          const raining = this.props.some((q) => q.kind === 'cloud' && q.raining);
          if (raining) { p.fill = Math.min(1, (p.fill || 0) + s / 6); p.frame = Math.min(2, Math.floor(p.fill * 3)); p.live = true; }
          else if (p.life !== Infinity) { const left = p.life - (now - p.born); const f = left < 3000 ? 0 : left < 7000 ? 1 : p.frame; if (f !== p.frame) { p.frame = f; } p.live = left < 7000; }
          break;
        }
        case 'rainbow': {
          const age = now - p.born, left = p.life - age;
          if (!p.fadeIn) p.alpha = Math.max(0, Math.min(1, left / 2000));
          p.live = left < 2000 || p.alpha < 1;
          break;
        }
        case 'bird': {
          p.live = true;
          if (p.away) { p.x = inView({ x: p.x + p.vx * s }, cols); p.y = Math.min(H + 26, p.y + p.vy * s); p.frame = 1 + (Math.floor((now - p.born) / 120) % 2); break; }
          if (p.perch) { p.frame = 0; p.live = false; break; }
          const tree = p.target === 'tree' ? this.grownTree() : null;
          if (p.target === 'tree' && !tree) p.target = 'head';
          const tx = tree ? this.trunk(tree) - 2 * u : this.headX() - 2 * u, ty = tree ? 20 : this.height();
          p.x += (tx - p.x) * (1 - Math.exp(-s * 1.6));
          p.y += (ty - p.y) * (1 - Math.exp(-s * 1.6));
          p.frame = 1 + (Math.floor((now - p.born) / 120) % 2);
          const close = Math.abs(p.x - tx) < 1.5 && Math.abs(p.y - ty) < 1;
          const settled = !this.step || !(this.step.dx || this.step.jump || this.step.lift || this.step.flip);
          if (close && (tree || (settled && !this.inReaction && !this.envDue))) {
            if (tree) { p.perch = true; p.fly = false; p.x = tx; p.y = ty; this.envDue = this.asleep() ? null : { name: 'birdTree', at: now }; }
            else { this.remove(p); this.wear('bird', 60000); this.envDue = { name: this.asleep() ? 'birdSleep' : 'birdHead', at: now }; }
          } else if (now - p.born > 9000) this.flyOff(p);
          break;
        }
        case 'snail':
          if (p.hide > 0) { p.hide -= dt; p.frame = 1; p.live = true; break; }
          p.frame = 0;
          if (p.tx != null && Math.abs(p.tx - p.x) > 0.5) { p.live = true; const d = Math.sign(p.tx - p.x); p.x += d * Math.min(4 * s, Math.abs(p.tx - p.x)); p.face = d; }
          break;
        case 'firefly':
          p.live = true;
          if (p.wander) {
            p.vx = Math.max(-12, Math.min(12, p.vx + this.rnd(-1, 1) * 40 * s));
            p.vy = Math.max(-3, Math.min(3, p.vy + this.rnd(-1, 1) * 10 * s));
            p.x = Math.max(-M, Math.min(W2 + M - u, p.x + p.vx * s));
            p.y = Math.max(4, Math.min(22, p.y + p.vy * s));
          }
          p.on = Math.sin((now - p.born) / 280 + p.id) > -0.3;
          break;
        case 'bubble':
          p.live = true;
          p.y = Math.min(H + 24, p.y + p.vy * s);
          p.x = Math.max(-M, Math.min(W2 + M - cols * u, p.x + Math.sin((now - p.born) / 400) * 6 * s));
          break;
        case 'tumbleweed': {
          p.live = true;
          p.x += p.vx * s;
          p.bump = Math.max(0, (p.bump || 0) - s * 1.5);
          p.y = Math.abs(Math.sin((now - p.born) / 180)) * 3 + p.bump * 6;
          p.frame = Math.floor((now - p.born) / 120) % 2;
          const out = p.vx > 0 ? p.x > W2 + M - cols * u : p.x < -M;
          if (out || (p.told && this.gone(p, Math.sign(p.vx)))) { p.x = inView(p, cols); p.vx = 0; this.fadeOut(p, out ? 300 : 900); }
          if (!p.told && p.vx && this.onstage() && Math.sign(this.center() - this.propCenter(p)) === Math.sign(p.vx) && this.gap(p) < 70) {
            p.told = true;
            if (!this.envDue && !this.inReaction) this.envDue = { name: this.envReaction('tumbleweed'), at: now };
          }
          break;
        }
        case 'rocket':
          if (p.launch) {
            p.live = true;
            p.y += 45 * s;
            if (this.rng() < 0.6) this.sparks.push({ x: p.x + u, y: p.y, vx: this.rnd(-4, 4), vy: -this.rnd(2, 6), g: 0, t0: now, life: 300 });
            if (p.y >= 22) this.burst(p);
          }
          break;
        case 'sun':
        case 'moon':
          // Rises or sets towards ty, unhurried; fades out at the end of its time.
          if (p.ty != null && Math.abs(p.ty - p.y) > 0.05) {
            p.live = true;
            p.y += (p.ty - p.y) * (1 - Math.exp(-s * 0.7));
            if (p.kind === 'sun') p.frame = Math.floor((now - p.born) / 600) % 2;
          } else if (p.kind === 'sun') p.frame = 0;
          if (p.life - (now - p.born) < 2600) this.fadeOut(p, 2500);
          break;
        case 'balloon': {
          p.live = true;
          const top = H + 22 - PROPS.balloon[0].length;
          if (p.held) { const m = this.mouthAt(); p.x = this.clampProp(m.x - (this.face > 0 ? 1 : 3) * u, cols); p.y = Math.min(top, m.y - 1); p.frame = 0; break; }
          p.x = Math.max(-M, Math.min(W2 + M - cols * u, p.x + (p.vx + Math.sin((now - p.born) / 500) * 5) * s));
          p.y = Math.min(top, p.y + p.vy * s);
          p.frame = Math.floor((now - p.born) / 500) % 2;
          if (p.y >= top || (now - p.born > 3000 && (p.x <= -M || p.x >= W2 + M - cols * u))) this.fadeOut(p, 900); // up and away, or off the side
          break;
        }
        case 'plane':
          if (!p.vx) break;
          p.live = true;
          p.x += p.vx * s;
          p.y = Math.max(0, p.y - p.sink * s + Math.sin((now - p.born) / 260) * 2 * s);
          p.frame = 0;
          if (p.y === 0) { p.vx *= Math.exp(-s * 8); if (Math.abs(p.vx) < 3) { p.vx = 0; p.frame = 1; } }
          if (p.x < -M || p.x > W2 + M - cols * u || (p.vx && this.gone(p, Math.sign(p.vx)))) { p.x = inView(p, cols); p.vx = 0; this.fadeOut(p, 400); }
          break;
        case 'mouse': case 'lizard': case 'bunny': {
          // Out of the grass and away: always a little faster than the dinosaur, and quicker still when
          // it comes close; into another tuft ahead, or off the strip.
          if (!p.vx) { p.frame = 0; p.y = 0; break; }
          p.live = true;
          if (Math.abs(this.propCenter(p) - this.center()) < this.dw && Math.abs(p.vx) < 170) p.vx *= 1 + 3 * s;
          p.x += p.vx * s;
          p.face = Math.sign(p.vx);
          p.frame = Math.floor((now - p.born) / (p.kind === 'lizard' ? 90 : 70)) % 2;
          p.y = p.kind === 'bunny' ? Math.round(Math.abs(Math.sin((now - p.born) / 110)) * 4) : 0;
          const bush = p.hide && this.props.find((q) => q !== p.home && (q.tuft || q.lush) && Math.abs(this.propCenter(q) - this.propCenter(p)) < 3);
          if (bush) { bush.wobble = 500; this.remove(p); break; }
          if (p.x < -M || p.x > W2 + M - cols * u) this.remove(p);
          break;
        }
        case 'frog': case 'cricket': {
          if (!p.vx && !p.bounce) { p.y = 0; p.frame = 0; break; }
          p.live = true;
          if (p.vx) p.face = Math.sign(p.vx);
          const ph = ((now - p.born) / 700) % 1; // a hop, then a sit (on the spot while it bounces)
          if (ph < 0.45) { p.x += p.vx * s; p.y = Math.sin((ph / 0.45) * Math.PI) * 4; p.frame = 1; } else { p.y = 0; p.frame = 0; }
          if (p.tx != null && Math.abs(p.tx - p.x) < 2) { p.vx = 0; p.tx = null; }
          if (p.x < -M || p.x > W2 + M - cols * u) { p.x = inView(p, cols); p.vx = 0; this.fadeOut(p, 300); }
          break;
        }
        case 'ladybug':
          if (p.fly) {
            p.live = true;
            p.x = Math.max(-M, Math.min(W2 + M - cols * u, p.x + p.vx * s));
            p.y = Math.min(H + 20, p.y + 6 * s);
            p.frame = Math.floor((now - p.born) / 120) % 2;
            if (p.y > H + 4) this.fadeOut(p, 1500);
            break;
          }
          p.frame = 0;
          if (p.tx != null && Math.abs(p.tx - p.x) > 0.5) { p.live = true; p.x += Math.sign(p.tx - p.x) * Math.min(6 * s, Math.abs(p.tx - p.x)); }
          break;
        case 'feather':
          p.live = true;
          p.frame = Math.sin((now - p.born) / 500 + p.sway) > 0 ? 0 : 1;
          p.x = inView({ x: p.x + Math.cos((now - p.born) / 500 + p.sway) * 7 * s + (p.tx != null ? (p.tx - p.x) * (1 - Math.exp(-s * 0.8)) : 0) }, cols);
          if (p.rise) { p.y = Math.min(H + 26, p.y + 9 * s); if (p.y >= H + 22) this.fadeOut(p, 900); } // blown up and away
          else if (p.y > 0) p.y = Math.max(0, p.y - 3 * s);
          else p.live = false;
          break;
        case 'seed':
          p.live = true;
          p.x = Math.max(-M, Math.min(W2 + M - cols * u, p.x + (p.vx + Math.sin((now - p.born) / 300 + p.id) * 6) * s));
          p.y = Math.min(H + 24, p.y + p.vy * s);
          if (p.y >= H + 24 || p.x <= -M || p.x >= W2 + M - cols * u) this.fadeOut(p, 600);
          break;
        case 'dragonfly': {
          // Darts from one spot to the next about its head, hovering a moment at each (and at once when snapped at).
          p.live = true;
          p.frame = Math.floor(now / 60) % 2;
          if (p.aim === 'away') {
            p.dir ||= this.propCenter(p) < this.center() ? -1 : 1;
            p.x += p.dir * 70 * s; p.y = Math.min(H + 24, p.y + 6 * s); p.face = p.dir;
            if (p.x < -M || p.x > W2 + M - cols * u || this.gone(p, p.dir)) { p.x = inView(p, cols); this.fadeOut(p, 400); p.aim = 'gone'; }
            break;
          }
          if (p.aim === 'gone') break;
          if (p.tx == null || now >= p.nextDart || (p.dodge && now - p.dodge < 120)) {
            p.dodge = null;
            p.tx = this.headX() + this.rnd(-28, 28) - 3.5 * u; p.ty = Math.min(H + 20, this.height() + this.rnd(1, 7));
            p.nextDart = now + this.rnd(500, 1300);
          }
          const k = 1 - Math.exp(-s * 7);
          if (Math.abs(p.tx - p.x) > 0.5) p.face = Math.sign(p.tx - p.x);
          p.x = inView({ x: p.x + (p.tx - p.x) * k }, cols); p.y += (p.ty - p.y) * k;
          break;
        }
        case 'bee': {
          // Buzzes round a flower, round its head (after it, but never as fast as it runs), or off and away.
          p.live = true;
          p.frame = Math.floor(now / 70) % 2;
          const t = (now - p.born) / 1000;
          if (p.aim === 'gone') break;
          if (p.aim === 'away') {
            p.dir ||= this.propCenter(p) < this.center() ? -1 : 1;
            p.x += p.dir * 40 * s; p.y = Math.min(H + 24, p.y + 5 * s); p.face = p.dir;
            if (p.x < -M || p.x > W2 + M - cols * u || this.gone(p, p.dir)) { p.x = inView(p, cols); this.fadeOut(p, 400); p.aim = 'gone'; }
            break;
          }
          let tx, ty, rate = 2.2;
          if (p.aim === 'flower' && this.has(p.at)) {
            const fl = p.at, rows = (PROPS[fl.kind][fl.frame] || PROPS[fl.kind][0]).length;
            tx = this.propCenter(fl) - 2.5 * u + Math.cos(t * 3) * 6; ty = rows + 2 + Math.sin(t * 4) * 2;
          } else if (p.aim === 'dino') { tx = this.headX() - 2.5 * u + Math.cos(t * 5) * 4; ty = this.height() + 1 + Math.sin(t * 6) * 2; rate = 1.6; }
          else { tx = this.center() + Math.cos(t * 0.9) * 40; ty = 10 + Math.sin(t * 2) * 3; }
          const dx = (tx - p.x) * (1 - Math.exp(-s * rate));
          if (Math.abs(dx) > 0.05) p.face = Math.sign(dx);
          p.x = inView({ x: p.x + Math.max(-55 * s, Math.min(55 * s, dx)) }, cols);
          p.y = Math.max(1, Math.min(H + 22, p.y + (ty - p.y) * (1 - Math.exp(-s * 3))));
          break;
        }
        case 'kite': {
          // On the breeze: tumbling in to it, tugging on the string it holds (higher in a gust), or sailing away.
          p.live = true;
          p.frame = Math.floor((now - p.born) / 450) % 2;
          const top = H + 22 - 7, wd = p.dir;
          if (p.held) {
            const m = this.mouthAt(), tx = m.x + wd * 34 - 2.5 * u, ty = Math.min(top, 17 + (p.gust ? 5 : 0) + Math.sin((now - p.born) / 600) * 1.5);
            p.x += (tx - p.x) * (1 - Math.exp(-s * 2)); p.y += (ty - p.y) * (1 - Math.exp(-s * 1.5));
          } else if (p.come) {
            const tx = this.center() + wd * 24 - 2.5 * u;
            p.x += (tx - p.x) * (1 - Math.exp(-s * 1.2)); p.y += (9 + Math.sin((now - p.born) / 400) * 2 - p.y) * (1 - Math.exp(-s));
          } else {
            p.x += wd * 26 * s; p.y = Math.min(top, p.y + 5 * s);
            if ((p.x < -M || p.x > W2 + M - cols * u || this.gone(p, wd)) && p.fadeOutAt == null) this.fadeOut(p, 800);
          }
          p.x = inView(p, cols);
          break;
        }
        case 'beetle': {
          // Rolls its ball along, just behind it; when the ball runs away from it, after it as fast as it can.
          p.live = true;
          p.face = p.dir;
          const b = p.ball && this.has(p.ball) ? p.ball : null;
          let fast = false;
          if (b) {
            const at = p.dir > 0 ? b.x - this.propW(p) : b.x + this.propW(b), d = at - p.x;
            if (b.vx || Math.abs(d) > 1) { p.x += Math.sign(d) * Math.min(Math.abs(d), 34 * s); fast = true; }
            else { p.x += p.dir * p.speed * s; b.x = p.dir > 0 ? p.x + this.propW(p) : p.x - this.propW(b); b.frame = ((Math.floor(b.x / (2 * u)) % 2) + 2) % 2; }
          } else p.x += p.dir * p.speed * s;
          p.frame = Math.floor(now / (fast ? 70 : 160)) % 2;
          // Out at the end it heads for (the ball first, ahead of it), or well past home: it fades away there.
          const lead = b ? (p.dir > 0 ? Math.max(p.x + cols * u, b.x + this.propW(b)) : Math.min(p.x, b.x)) : p.dir > 0 ? p.x + cols * u : p.x;
          const out = p.dir > 0 ? lead > W2 + M : lead < -M;
          if (b) b.x = inView(b, this.propCols(b));
          p.x = inView(p, cols);
          if ((out || this.gone(p, p.dir)) && p.fadeOutAt == null) { this.fadeOut(p, 600); if (b) this.fadeOut(b, 600); p.speed = 0; p.ball = null; }
          break;
        }
        case 'dung':
          if (p.vx) { p.live = true; p.x += p.vx * s; p.vx *= Math.exp(-s * 1.6); if (Math.abs(p.vx) < 2) p.vx = 0; p.frame = ((Math.floor(p.x / (2 * u)) % 2) + 2) % 2; }
          p.x = inView(p, cols);
          break;
        case 'skateboard':
          if (p.ride) { p.live = true; p.x = this.x + (this.dw - cols * u) / 2; p.y = Math.max(0, this.y - 2); }
          break;
        default: // ball, bone, egg, pebble, shell, typewriter, coconut, hats: simple physics
          if (p.balance) {
            p.live = true;
            const [col, row] = MOUTH.up;
            p.x = this.x + (this.face > 0 ? col - 2 : W - 1 - col - 2) * this.du;
            p.y = (H - row) * (this.du / u) + 1 + Math.abs(Math.sin((now - p.born) / 160)) * 3;
            p.frame = Math.floor((now - p.born) / 160) % 4;
            break;
          }
          if (p.gravity || p.y > 0) {
            p.live = true;
            p.vy -= 160 * s; p.y += p.vy * s;
            if (p.y <= 0) { p.y = 0; p.vy = Math.abs(p.vy) > 18 && (p.kind === 'ball' || p.kind === 'coconut') ? -p.vy * 0.45 : 0; if (!p.vy) p.gravity = false; }
          }
          if (p.vx) {
            p.live = true;
            p.x += p.vx * s;
            if (p.y === 0) p.vx *= Math.exp(-s * (p.kind === 'ball' || p.kind === 'coconut' ? 1.1 : p.kind === 'acorn' ? 2.5 : 6));
            const right = W2 - cols * u;
            if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx) * 0.5; }
            if (p.x > right) { p.x = right; p.vx = -Math.abs(p.vx) * 0.5; }
            if (Math.abs(p.vx) < 2) p.vx = 0;
            if (p.kind === 'ball') p.frame = ((Math.floor(p.x / (2 * u)) % 4) + 4) % 4;
          }
      }
    }
    // Raindrops land on the ground — or on the dinosaur, its umbrella, or the palm's fronds.
    if (this.drops.length) {
      const tree = this.grownTree();
      const dinoTop = this.height() + (this.hat?.kind === 'umbrella' ? 3 : 0);
      this.drops = this.drops.filter((q) => {
        q.y -= 42 * s;
        let floor = 0;
        if (q.x >= this.x + this.du && q.x <= this.x + this.dw - this.du) floor = dinoTop;
        if (tree && q.x >= tree.x && q.x <= tree.x + 13 * u) floor = Math.max(floor, 14);
        if (q.y > floor) return true;
        if (this.rng() < 0.25) this.particles.push({ x: q.x, y: floor + 0.5, vx: this.rnd(-12, 12), vy: this.rnd(6, 12), t0: now });
        return false;
      });
    }
    // Gusts: one or two faint ones at a time, across its home stretch.
    if (this.wind) {
      const wd = this.wind.dir;
      if (now < this.wind.until && this.streaks.length < 2 && this.rng() < s * 1.2) {
        const from = wd > 0 ? Math.max(-M, this.zone(0) - 60) : Math.min(W2 + M - 14, this.zone(1) + this.dw + 60);
        this.streaks.push({ x: from, y: this.rnd(4, 24), len: this.rnd(8, 14), vx: wd * this.rnd(85, 115), to: from + wd * (this.zone(1) - this.zone(0) + this.dw + 120) });
      }
      if (now >= this.wind.until && !this.streaks.length) this.wind = null;
    }
    this.streaks = this.streaks.filter((q) => { q.x += q.vx * s; return q.x > -M && q.x + q.len < W2 + M && (q.vx > 0 ? q.x < q.to : q.x > q.to); });
    this.sparks = this.sparks.filter((q) => { q.x += q.vx * s; q.y += q.vy * s; q.vy -= (q.g ?? 30) * s; return now - q.t0 < q.life; });
    this.particles = this.particles.filter((q) => now - q.t0 < 650);
    for (const q of this.particles) { q.x += q.vx * s; q.y = Math.max(0, q.y + q.vy * s); q.vy -= (q.g ?? 90) * s; }
    if (this.hat && now > this.hat.until) this.hat = null;
    if (this.event && this.eventDone(now)) this.event = null;
    if (this.envDue && now - this.envDue.at > 10000) { this.envDue = null; this.endRain(); } // couldn't take part in time
  }

  /** Advance to time `now`. Returns true while anything is moving (the caller ticks faster). */
  advance(now) {
    this.now = now;
    if (this.lastTick === null) this.lastTick = now;
    this.gapMs = Math.max(0, now - this.lastTick);
    const dt = Math.min(1000, this.gapMs);
    // Long in the background with nobody to see it nod off (the window was hidden): it is simply asleep.
    if (!this.deep && this.deepDue(now) && this.gapMs > 5000) this.sleepDeeply();
    this.lastTick = now;
    this.growWhileAway(now);
    this.updateEnergy(dt);
    this.updateMood(now);
    const { today = 0, goal = 0 } = this.getProgress() || {};
    const day = new Date(this.clock()).toDateString();
    if (goal > 0 && today >= goal && this.celebrated !== day) { this.celebrated = day; if (this.lastWrite && now - this.lastWrite < 60000) this.pending = 'celebrate'; }
    this.updateWorld(dt, now);
    this.maybeEvent(now);
    let s = this.step;
    // A reaction that has fallen due starts as soon as the pose being held allows.
    if (s && now < s.end && !this.inReaction && this.dueNow(now) && isHold(s) && this.onstage()) s.end = now;
    if (!s || now >= s.end) {
      if (s) { this.x = s.x1; this.y = s.lift ? s.lift[1] : 0; }
      if (s && s.jump >= 3 && !s.lift && !s.flip) this.land(now);
      const v = this.bridged(this.held.length ? this.held.shift() : this.nextStep(now));
      if (v.do) v.do(this);
      if (v.face) this.face = v.face;
      // Steps stay on the strip; off it (after a resize), they may only head back.
      const x1 = Math.max(Math.min(0, this.x), Math.min(Math.max(this.maxX, this.x), this.x + (v.dx || 0)));
      // On the ground it moves by stepping: the stride is taken with the frame and held,
      // never glided through while the legs stay still. Legs that cannot go anywhere stand.
      let ground = !!v.dx && !v.jump && !v.lift && !v.flip;
      if (ground && x1 === this.x && STEPPING.test(v.f)) { v.f = 'stand'; v.dx = 0; ground = false; }
      s = this.step = { ...v, start: now, end: now + v.t, x0: this.x, x1, ground };
      this.frame = v.f;
      this.flip = !!v.flip;
      if (v.fx) this.effects.push({ g: v.fx, t0: now, face: this.face });
    }
    const k = Math.min(1, (now - s.start) / (s.end - s.start));
    this.x = s.ground ? s.x1 : s.x0 + (s.x1 - s.x0) * k;
    this.y = (s.lift ? s.lift[0] + (s.lift[1] - s.lift[0]) * k : 0) + (s.jump ? s.jump * 4 * k * (1 - k) : 0);
    this.effects = this.effects.filter((e) => now - e.t0 < 1400);
    this.nextBlink(now);
    return s.x1 !== s.x0 || !!s.jump || !!s.lift || this.effects.length > 0 || this.particles.length > 0 || this.acking(now) > 0 || this.landing(now) ||
      this.drops.length > 0 || this.sparks.length > 0 || this.streaks.length > 0 || !!this.wind || this.props.some((p) => p.live);
  }

  // -- the small touches --
  /** Eyes it can blink: open, awake, the right way up. */
  eyesOpen() { return !this.deep && !this.flip && !this.asleep() && (FRAMES[this.frame] || FRAMES.stand).some((r) => r.includes('o')); }

  /** Schedule its own blinks: one every 2.5 to 7 s, now and then two in quick succession. */
  nextBlink(now) {
    if (this.blinkAt == null || now - this.blinkAt > 30000) this.blinkAt = now + this.ownRnd(2500, 7000); // (the first, or back from a long gap)
    else if (now >= this.blinkAt + BLINK_MS) this.blinkAt = now + (this.ownRnd(0, 1) < 0.16 ? this.ownRnd(160, 260) : this.ownRnd(2500, 7000));
  }

  /** In the middle of one of its own blinks (drawn with the eyes shut). */
  blinking(now) { return this.blinkAt != null && now >= this.blinkAt && now < this.blinkAt + BLINK_MS && this.eyesOpen(); }

  /** Down from a jump: a little dust kicked up either side of its feet, and a moment's crouch (Dino.draw). */
  land(now) {
    this.landAt = now;
    const fx = this.x + (W / 2) * this.du;
    for (const dir of [-1, 1]) for (let i = 0; i < 2; i++) this.particles.push({ x: fx + dir * this.ownRnd(3, 6) * this.du, y: 1, vx: dir * this.ownRnd(14, 30), vy: this.ownRnd(8, 18), t0: now });
  }

  /** Just landed: the knees take the weight for a moment. */
  landing(now) { return now - this.landAt < LAND_MS; }

  /** Never jump between postures: getting up from lying or sitting always shows the in-between frames. */
  bridged(v) {
    const from = postureOf(this.frame), to = postureOf(v.f);
    if (from === 'lie' && to === 'stand') { this.held.unshift({ f: 'crouch', t: 170 }, v); return { f: 'sitBlink', t: 220 }; }
    if (from === 'sit' && to === 'stand' && !GET_UP.has(v.f)) { this.held.unshift(v); return { f: 'crouch', t: 170 }; }
    return v;
  }

  /** When the next step starts or a queued reaction falls due (for scheduling). */
  nextEvent() {
    let t = this.step ? this.step.end : 0;
    if (this.queue.length) t = Math.min(t, this.queue[0].at);
    if (this.envDue) t = Math.min(t, this.envDue.at);
    if (this.ack && this.ack.t0 + 160 > this.now) t = Math.min(t, this.ack.t0 + 160);
    if (this.envNext != null) t = Math.min(t, this.envNext);
    if (this.landAt + LAND_MS > this.now) t = Math.min(t, this.landAt + LAND_MS);
    // Its own blinks, on time, while anyone can see them (never asleep or dormant).
    if (this.focused && !this.dormant && this.blinkAt != null && this.eyesOpen()) t = Math.min(t, this.blinkAt > this.now ? this.blinkAt : this.blinkAt + BLINK_MS);
    if (!this.focused && this.tuftNext != null) t = Math.min(t, this.tuftNext);
    if (!this.focused && this.deep && this.lushNext != null) t = Math.min(t, this.lushNext);
    return t;
  }

  /**
   * How long until the next tick: about 11 a second while anything moves, 4 when still, in a
   * deep sleep only for each slow breath, and dormant only when something is due.
   */
  tickDelay(now, moving) {
    const most = this.dormant && !moving ? this.T.dormantTick : this.deep ? (moving ? 250 : 1500) : moving ? 90 : 250;
    return Math.max(16, Math.min(most, this.nextEvent() - now));
  }
}

// ---- drawing and wiring ---------------------------------------------------------------------

// The playground: the whole width of the editor area (never over the side
// panels or the scrollbar), just above the status bar. Its home stretch is
// centred on TODAY, up to HOME_MAX px wide. Visitors come from MARGIN px out of
// sight beyond the ends. HEADROOM rows above the dinosaur hold jumps, glyphs,
// clouds and fireworks.
const HOME_MAX = 560, MARGIN = 24, HEADROOM = 30;
// Drawn behind everything else.
const BACKDROP = ['sun', 'moon', 'rainbow', 'palm', 'cactus', 'grass', 'cloud', 'puddle', 'rock', 'pile'];

export class Dino {
  constructor({ anchor, area, getProgress }) {
    this.anchor = anchor;           // the TODAY element in the status bar
    this.area = area;               // the editor area the dinosaur lives above
    this.root = document.createElement('div');
    this.root.id = 'dino';
    this.root.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.hit = document.createElement('div');
    this.hit.className = 'dino-hit';
    this.root.append(this.canvas, this.hit);
    document.body.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.stripW = 300;
    this.stripLeft = null;          // the strip's left edge in the window
    this.off = MARGIN;              // canvas x of the strip's left edge
    this.home = null;               // the home stretch { lo, hi } in strip px, around TODAY
    this.c = new Critter({ unit: () => this.pxDev / (window.devicePixelRatio || 1), width: () => this.stripW, margin: () => MARGIN, home: () => this.home, corner: () => this.stripLeft === 0, progress: getProgress });
    this.c.lastWrite = performance.now(); // idle time counts from launch: it starts awake
    this.born = performance.now();
    this.timer = 0;
    this.lastSig = '';
    this.enabled = true;
    this.dormantShown = false; // last told to onDormant
    this.onDormant = null;     // (on) => the app rests with a dormant dinosaur (app.js)

    // Only a click on the dinosaur itself does anything; the pointer passing over it doesn't.
    this.hit.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.poke(this.stripLeft == null ? undefined : e.clientX - this.stripLeft, this.bottom - e.clientY);
    });
    // While a mouse button is held elsewhere (selecting text, dragging a
    // scrollbar), the dinosaur lets everything through, so it can never catch
    // a drag that passes over it.
    window.addEventListener('pointerdown', (e) => { if (e.target !== this.hit) this.root.classList.add('pass'); }, true);
    window.addEventListener('pointerup', () => this.root.classList.remove('pass'), true);
    window.addEventListener('blur', () => this.root.classList.remove('pass'));
    // In the background (another application has the focus) its little world carries on more quietly.
    const focus = () => { this.c.setFocus(document.hasFocus(), performance.now()); this.dormancy(); this.schedule(0); };
    window.addEventListener('focus', focus);
    window.addEventListener('blur', focus);
    this.c.focused = document.hasFocus();
    if (!this.c.focused) { this.c.focused = true; this.c.setFocus(false, performance.now()); }
    // TODAY moves whenever anything before it in the status bar changes width;
    // the editor area narrows and widens as side panels open and close.
    const ro = new ResizeObserver(() => this.place());
    for (const el of anchor.parentElement.children) ro.observe(el);
    if (area) ro.observe(area);
    window.addEventListener('resize', () => this.place());
    document.addEventListener('visibilitychange', () => { this.dormancy(); this.schedule(0); });
    new MutationObserver(() => { this.lastSig = ''; this.draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.place();
    this.schedule(0);
  }

  setEnabled(on) {
    this.enabled = on;
    this.root.hidden = !on;
    if (on) this.place();
    this.schedule(0);
    this.dormancy();
  }

  /** Words the writer just wrote (net, own writing only). */
  wrote(n) { this.c.wrote(n, performance.now()); }
  /** The theme turned on its own (its AM/PM schedule): a sunset or a sunrise. */
  themeChanged(theme) {
    if (performance.now() - this.born < 3000) return; // just opened: nothing to see
    this.c.themeShift(theme === 'dark');
    this.schedule(0);
  }
  poke(x, y) { this.c.poke(performance.now(), x, y); this.schedule(0); }
  /**
   * The writing streak's rewards: `growth` px (one per milestone) and the
   * number of special loops unlocked. At start-up they are simply restored; a
   * milestone reached while writing is shown with a little ceremony.
   */
  setStreak({ growth, unlocked }, animate = true) {
    const before = this.c.targetG;
    this.c.setGrowth(growth, animate && growth !== before);
    this.c.setUnlocked(unlocked);
    if (!animate) this.place();
    this.schedule(0);
  }

  // -- layout --
  get pxDev() { return Math.max(1, Math.round(1.25 * (window.devicePixelRatio || 1))); }

  /**
   * Fit the playground to the window. The dinosaur and its props keep their
   * place on screen when the area moves or changes size; if the area shrinks
   * out from under it, it walks back in (Critter.nextStep) rather than jumping,
   * and the canvas stretches to keep it whole meanwhile. The canvas's bottom
   * edge is the top of the status bar's border, on a whole device pixel, so
   * the feet stand on the line and never cover it.
   */
  place() {
    const r = this.anchor.getBoundingClientRect(), bar = this.anchor.parentElement.getBoundingClientRect();
    const a = this.area ? this.area.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const lo = Math.max(a.left, 0), hi = Math.min(a.right - 10, window.innerWidth); // 10: the editor's scrollbar
    const visible = this.enabled && r.width > 0 && getComputedStyle(this.anchor).display !== 'none' && hi - lo >= 140;
    this.root.hidden = !visible;
    if (!visible) return;
    const c = this.c, dpr = window.devicePixelRatio || 1, p = this.pxDev;
    const left = Math.round(lo), width = Math.round(hi) - left;
    const span = Math.min(HOME_MAX, width), mid = r.left + r.width / 2 - left;
    const homeLo = Math.max(0, Math.min(width - span, mid - span / 2));
    this.home = { lo: homeLo, hi: homeLo + span };
    this.stripW = width;
    // While the window is still laying itself out it simply starts in the middle of home; after
    // that it keeps its place on screen.
    if (performance.now() - this.born < 1500 && !c.step?.dx) c.x = c.zone(0.5);
    else if (this.stripLeft != null && left !== this.stripLeft) {
      const d = this.stripLeft - left;
      c.x += d;
      if (c.step) { c.step.x0 += d; c.step.x1 += d; }
      for (const q of c.props) { q.x += d; if (q.tx != null) q.tx += d; }
      for (const q of [...c.particles, ...c.drops, ...c.sparks, ...c.streaks]) q.x += d;
      if (c.cursor) c.cursor.x += d;
    }
    this.stripLeft = left;
    // Never further out than the window allows.
    const dw = c.dw;
    c.x = Math.max(-left + 2, Math.min(window.innerWidth - left - dw - 2, c.x));
    // The canvas: the strip, and wherever the dinosaur is right now.
    const from = Math.max(-left, Math.min(0, Math.floor(c.x) - 4));
    const to = Math.min(window.innerWidth - left, Math.max(width, Math.ceil(c.x + dw) + 4));
    this.off = -from;
    this.wide = !c.onstage(); // stretched to keep it whole while it walks back in
    const wDev = Math.round((to - from) * dpr), hDev = (H + HEADROOM) * p;
    if (this.canvas.width !== wDev || this.canvas.height !== hDev) {
      this.canvas.width = wDev;
      this.canvas.height = hDev;
      this.canvas.style.width = wDev / dpr + 'px';
      this.canvas.style.height = hDev / dpr + 'px';
    }
    const ground = Math.floor(bar.top * dpr + 0.01); // device row of the border's top edge
    this.bottom = ground / dpr;
    Object.assign(this.root.style, { left: left + from + 'px', top: (ground - hDev) / dpr + 'px' });
    this.lastSig = '';
    this.draw();
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (document.hidden || !this.enabled) { // no work at all in the background: just one look when the app may rest
      const c = this.c, now = performance.now();
      if (!this.dormantShown && !c.focused && c.blurAt != null) this.timer = setTimeout(() => this.dormancy(), Math.max(0, c.blurAt + c.T.deepSleep - now) + 50);
      return;
    }
    this.timer = setTimeout(() => this.tick(), delay);
  }

  tick() {
    const now = performance.now();
    const moving = this.c.advance(now);
    if (this.wide && this.c.onstage()) this.place(); // back inside: the canvas can shrink again
    this.draw(now);
    this.dormancy();
    // Always on time for the next step, so every stride is shown (Critter.tickDelay).
    this.schedule(this.c.tickDelay(now, moving));
  }

  /** Tell the app when the dinosaur turns dormant or stops being so (it rests with it). Minimised,
   *  or with the companion turned off, the app rests once the window has been long in the background. */
  dormancy() {
    const c = this.c, idle = !c.focused && c.deepDue(performance.now());
    // (back on screen, still resting until its first tick catches up with the deep sleep it is due)
    const on = this.enabled && !document.hidden ? c.dormant || (idle && !c.deep && this.dormantShown) : idle;
    if (on === this.dormantShown) return;
    this.dormantShown = on;
    if (this.onDormant) this.onDormant(on);
  }

  draw(now = performance.now()) {
    if (this.root.hidden) return;
    const c = this.c, p = this.pxDev, dpr = window.devicePixelRatio || 1;
    const off = this.off;
    const snap = (x) => Math.round(((x + off) * dpr) / p) * p;  // strip x → canvas, on the world's pixel grid
    const cs = c.du * dpr;                                      // device px per dinosaur pixel (grows with the streak)
    const ack = c.acking(now);
    const px = snap(c.x);
    const py = (Math.round(c.y) + (ack === 2 && c.y === 0 ? 1 : 0)) * p;
    const fx = c.effects.map((e) => `${e.g}${Math.round((now - e.t0) / 140)}`).join();
    const props = c.props.map((q) => `${q.kind}${q.frame}${snap(q.x)},${Math.round(q.y)}${q.carried ? 'c' : ''}${q.wobble ? Math.round(now / 90) % 2 : ''}${q.beam ? 'b' : ''}${q.on ? 'o' : ''}${q.alpha != null ? Math.round(q.alpha * 10) : ''}${this.blinkOut(q, now) ? 'x' : ''}`).join();
    const parts = c.particles.map((q) => `${snap(q.x)},${Math.round(q.y)}`).join();
    const busy = c.drops.length || c.sparks.length || c.streaks.length ? Math.round(now / 45) : '';
    // Its own blinks; a moment's crouch as it lands from a jump; its shadow on the ground while it is up in the air.
    const shut = ack || c.blinking(now);
    const frame = c.landing(now) && c.y < 1 && !c.flip && postureOf(c.frame) === 'stand' && !c.hat && !c.props.some((q) => q.carried) ? 'crouch' : FRAMES[c.frame] ? c.frame : 'stand';
    const air = c.step?.jump && !c.step.lift && c.y >= 1 ? Math.round(c.y) : 0;
    const sig = `${frame}|${px}|${py}|${c.face}|${c.flip}|${ack}|${shut}|${air}|${c.step?.hide ? 'h' : ''}|${c.g}|${fx}|${props}|${parts}|${busy}|${c.hat ? c.hat.kind : ''}${c.step?.hatUp ? '^' : ''}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const g = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000';
    const ground = ch;
    // A pixel grid at `cell` device px per pixel, with whole-pixel edges (crisp at any size).
    const grid = (rows, x, bottomY, cell, mirror = false) => {
      const h = rows.length, w = rows[0].length;
      for (let r = 0; r < h; r++) {
        const row = rows[r];
        const y0 = bottomY - Math.round((h - r) * cell), y1 = bottomY - Math.round((h - r - 1) * cell);
        for (let i = 0; i < w; i++) {
          if (row[i] !== '#') continue;
          const col = mirror ? w - 1 - i : i;
          const x0 = x + Math.round(col * cell), x1 = x + Math.round((col + 1) * cell);
          g.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }
    };
    const drawProp = (q) => {
      if (q.carried || this.blinkOut(q, now) || (q.kind === 'firefly' && !q.on)) return;
      const art = q.art || PROPS[q.kind][q.frame] || PROPS[q.kind][0];
      const jitter = q.wobble ? (Math.round(now / 90) % 2 ? p : -p) : 0;
      g.globalAlpha = (ALPHA[q.kind] ?? 1) * (q.alpha ?? 1);
      const mirror = (q.kind === 'baby' && q.vx < 0) || (q.kind === 'snail' && q.face < 0) || (q.kind === 'bird' && q.vx < 0) || ((q.kind === 'plane' || q.kind === 'frog' || q.kind === 'cricket' || q.kind === 'dragonfly' || q.kind === 'bee' || q.kind === 'beetle' || q.kind in CRITTERS) && q.face < 0);
      grid(art, snap(q.x) + jitter, ground - Math.round(q.y) * p, p, mirror);
      if (q.kind === 'ufo' && q.beam) {
        const bx = snap(q.x) + 4 * p;
        for (let y = ground - Math.round(q.y) * p + p; y < ground; y += 2 * p) { g.fillRect(bx - 3 * p, y, p, p); g.fillRect(bx + 3 * p, y, p, p); }
      }
      g.globalAlpha = 1;
    };
    // The scenery, then loose props behind the dinosaur; what it is hiding behind, in front of it.
    const behind = c.step?.hide && c.has(c.hideIn) ? c.hideIn : null;
    for (const kind of BACKDROP) for (const q of c.props) if (q.kind === kind && q !== behind) drawProp(q);
    for (const q of c.props) if (!BACKDROP.includes(q.kind) && q !== behind) drawProp(q);
    // The dinosaur, pixel by pixel on edges that keep its face the same shape at any size, either way round.
    let rows = FRAMES[frame];
    if (shut) rows = rows.map((r) => r.replace('o', '#')); // a blink (on a click: noticed!)
    const e = spriteEdges(frame, cs), sw = e.cols[W], sh = e.rows[H];
    if (air) {
      // Its shadow: under it on the ground, narrower and fainter the higher it goes.
      const sw2 = Math.max(3, 11 - Math.round(air / 2)) * p;
      g.globalAlpha = Math.max(0.1, 0.32 - air * 0.02);
      g.fillRect(Math.round((px + sw / 2 - sw2 / 2) / p) * p, ground - p, sw2, p);
      g.globalAlpha = 1;
    }
    const top = ground - py - sh;
    const colX = (i) => px + (c.face > 0 ? e.cols[i] : sw - e.cols[i + 1]); // left edge of sprite column i on screen
    for (let r = 0; r < H; r++) {
      const y0 = c.flip ? ground - py - e.rows[r + 1] : top + e.rows[r], hgt = e.rows[r + 1] - e.rows[r];
      for (let i = 0; i < W; i++) if (rows[r][i] === '#') g.fillRect(colX(i), y0, e.cols[i + 1] - e.cols[i], hgt);
    }
    // Carried props, held in the mouth: just past the snout, centred on the mouth row.
    for (const q of c.props) {
      if (!q.carried || (q.kind === 'firefly' && !q.on)) continue;
      const [col, row] = MOUTH[frame] || MOUTH.stand;
      const art = PROPS[q.kind][q.frame] || PROPS[q.kind][0], aw = art[0].length;
      const x = c.face > 0 ? px + e.cols[col + 1] : colX(col) - aw * p;
      grid(art, x, top + e.rows[row + 1] + Math.ceil(art.length / 2) * p, p, c.face < 0);
    }
    // Something on its head.
    if (c.hat && HEAD_TOP[frame] && !c.flip) {
      const [col, row] = HEAD_TOP[frame];
      const k = c.hat.kind;
      const art = k === 'butterfly' ? PROPS.butterfly[Math.floor(now / 400) % 2] : k === 'bird' ? PROPS.bird[0] : PROPS[k][0];
      const lift = (k === 'leaf' ? -p : 0) + (c.step?.hatUp ? 2 * p : 0);
      grid(art, colX(col) - Math.floor(art[0].length / 2) * p, top + e.rows[row] - lift, p, k === 'bird' && c.face < 0);
    }
    if (behind) drawProp(behind);
    // A kite's string, from the kite down to its mouth (a dotted line, a little lighter).
    for (const q of c.props) {
      if (q.kind !== 'kite' || !q.held) continue;
      const m = c.mouthAt(), x0 = snap(q.x) + 2 * p, y0 = ground - Math.round(q.y) * p, x1 = snap(m.x), y1 = ground - Math.round(m.y) * p;
      const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / p));
      g.globalAlpha = 0.55 * (q.alpha ?? 1);
      for (let i = 1; i < n; i += 2) g.fillRect(Math.round((x0 + ((x1 - x0) * i) / n) / p) * p, Math.round((y0 + ((y1 - y0) * i) / n) / p) * p, p, p);
      g.globalAlpha = 1;
    }
    for (const q of c.particles) g.fillRect(snap(q.x), ground - (Math.round(q.y) + 1) * p, p, p);
    // Rain, wind and sparks.
    if (c.drops.length) {
      g.globalAlpha = 0.6;
      for (const q of c.drops) g.fillRect(snap(q.x), ground - (Math.round(q.y) + 2) * p, p, 2 * p);
    }
    g.globalAlpha = 0.25;
    for (const q of c.streaks) g.fillRect(snap(q.x), ground - Math.round(q.y) * p, Math.max(p, Math.round((q.len * dpr) / p) * p), p);
    for (const q of c.sparks) {
      g.globalAlpha = Math.max(0, 1 - (now - q.t0) / q.life);
      g.fillRect(snap(q.x), ground - (Math.round(q.y) + 1) * p, p, p);
      if (q.trail) for (let t = 1; t <= 3; t++) { g.globalAlpha *= 0.6; g.fillRect(snap(q.x - (q.vx * t) / 60), ground - (Math.round(q.y - (q.vy * t) / 60) + 1) * p, p, p); }
    }
    g.globalAlpha = 1;
    for (const e of c.effects) {
      const gl = GLYPHS[e.g];
      if (!gl) continue;
      const age = (now - e.t0) / 1400;
      const rise = Math.round(age * 5) * p;
      const gx = px + Math.round((e.face > 0 ? 13 : 2) * cs) + (e.g === 'z' ? Math.round(age * 3) * p * e.face : 0);
      const gy = top - 6 * p - rise + 2 * p;
      for (let r = 0; r < 5; r++) for (let i = 0; i < 3; i++) if (gl[r][i] === '#') g.fillRect(gx + i * p, gy + r * p, p, p);
    }
    // Click target follows the dinosaur, with a pixel or two to spare.
    Object.assign(this.hit.style, { left: px / dpr - 2 + 'px', top: top / dpr - 2 + 'px', width: sw / dpr + 4 + 'px', height: sh / dpr + 2 + 'px' });
  }

  /** Props about to vanish blink for their last 1.2 s (scenery fades or withers instead). */
  blinkOut(q, now) {
    if (q.grows || q.fadeOutAt != null || ['rainbow', 'cloud', 'puddle', 'sun', 'moon'].includes(q.kind)) return false;
    const left = q.life - (now - q.born);
    return left < 1200 && Math.floor(left / 150) % 2 === 1;
  }
}

export const _test = { CHOICES, TEMPO, FOLLOWS, FRAMES, PROPS, GLYPHS, W, H, ACTIVITIES, REACTIONS, MOODS, EVENTS, SPECIALS, ENV_ACTIVITIES, GET_UP, BASELINE_0_8, postureOf, MOUTH, HEAD_TOP };
