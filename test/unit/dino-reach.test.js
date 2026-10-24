// Everything the dinosaur can do, and everything that can happen around it, does come up now and then:
// for each, a world in which it can, and then it is seen to. And every choice it makes for itself
// depends on its world and on what it did just before (since 0.43). Also the five newer neighbours and
// the three newer habits, each played through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { _test } from '../../src/renderer/dino.js';
import { rockArt } from '../../src/renderer/dino-art.js';
import { make, wide, world, run, inView, until, walksNotSlides, seeded, MINUTE } from '../helpers/dino-sim.js';

const { CHOICES, TEMPO, ACTIVITIES, REACTIONS, EVENTS } = _test;
const NOW = 1e9;

/** A critter in a world set up by `setup`, with the clock at NOW. */
function scene(setup = () => {}, mk = (s) => wide(s), seed = 7) {
  const c = mk(seed);
  c.now = NOW; c.lastTick = NOW; c.envNext = Infinity; c.lastWrite = NOW - 30000;
  setup(c);
  return c;
}
const grown = (c, kind, o = {}) => c.spawn(kind, { x: c.clampProp(c.center() + 60, 13), frame: { palm: 3, cactus: 2, flower: 3, mushroom: 2, dandelion: 2 }[kind] ?? 0, born: NOW - 30000, life: 20 * MINUTE, grows: true, ...o });
const at = (iso) => () => Date.parse(iso);
// Worlds to look in: each a little different from the plain one.
const SCENES = {
  plain: [() => {}],
  writing: [(c) => { c.heat = 40; c.energy = 0.8; }],
  lively: [(c) => { c.energy = 0.9; }],
  sleepy: [(c) => { c.energy = 0.05; c.lastWrite = NOW - 600e3; }],
  late: [(c) => { c.energy = 0.3; }, (s) => wide(s, { clock: at('2026-10-21T23:30:00') })],
  morning: [() => {}, (s) => wide(s, { clock: at('2026-10-21T08:00:00') })],
  rainy: [(c) => { c.spawn('puddle', { x: c.clampProp(c.center() + 50, 16), life: Infinity }); c.wetUntil = NOW + 60000; }],
  tree: [(c) => grown(c, 'palm')],
  flowers: [(c) => grown(c, 'flower')],
  grass: [(c) => { for (let i = 0; i < 3; i++) c.spawn('grass', { x: 20 + i * 60, frame: 2, tuft: true, grows: true, born: NOW - 600e3, per: 1000 }); c.backAt = NOW - 120e3; c.grazeAt = NOW - 60e3; c.lastWrite = NOW - 1000; }],
  plant: [(c) => grown(c, 'cactus', { wild: true, noticed: NOW - 60000, visitAt: NOW - 1000 })],
  ball: [(c) => c.spawn('ball', { x: c.clampProp(c.center() + 40, 4), life: 60000 })],
  litter: [(c) => { for (let i = 0; i < 3; i++) c.spawn('pebble', { x: 30 + 40 * i, life: 60000 }); }],
  leaves: [(c) => { for (let i = 0; i < 3; i++) c.spawn('leaf', { x: 40 + 50 * i, life: 60000 }); }],
  breeze: [(c) => { c.lastEnv.wind = NOW - 60000; }],
  rock: [(c) => c.spawn('rock', { x: c.clampProp(c.center() + 70, 12), art: rockArt(seeded(3)), life: 10 * MINUTE })],
  fed: [(c) => { c.fed = NOW - 30000; }],
  goal: [(c) => { c.progress.today = c.progress.goal; }],
  streak: [(c) => { c.unlocked = 3; }],
  corner: [(c) => { c.x = c.zone(0.5); c.lastCorner = -1e12; }, (s) => world(s)],
  rareLuck: [(c) => { c.lastRare = NOW - 4 * 3600e3; }],
};
const make1 = (name) => { const [setup, mk] = SCENES[name]; return scene(setup, mk); };
const share = (w, a) => (w[a] || 0) / Object.values(w).reduce((x, y) => x + y, 0);
// Come by other ways than a choice of its own (see the tests below).
const OTHER_WAYS = ['nightfall', 'daybreak', 'celebrate', 'grow', 'shrink'];

test('every activity it chooses for itself has a world where it can, and in that world it comes up', () => {
  assert.deepEqual(Object.keys(ACTIVITIES).filter((a) => !CHOICES[a]).sort(), [...OTHER_WAYS].sort(), 'the others come by other ways');
  for (const a of Object.keys(CHOICES)) {
    assert.ok(ACTIVITIES[a], `${a} is in the repertoire`);
    let best = null;
    for (const name of Object.keys(SCENES)) { const c = make1(name), p = share(c.weights(NOW), a); if (p > 0 && (!best || p > best.p)) best = { name, p }; }
    assert.ok(best, `${a}: some world where it can`);
    const n = Math.min(60000, Math.ceil(40 / best.p));
    const c = make1(best.name);
    let seen = 0;
    for (let i = 0; i < n && !seen; i++) { c.recent = []; c.lastRare = SCENES[best.name] === SCENES.rareLuck ? NOW - 4 * 3600e3 : c.lastRare; c.lastCorner = -1e12; if (c.pickActivity(NOW) === a) seen++; }
    assert.ok(seen, `${a} came up in "${best.name}" (${(100 * best.p).toFixed(3)} % of choices there)`);
  }
});

test('the others come their own ways: the sun going down or up, today’s goal, the streak growing or ending', () => {
  const c = make(1);
  c.themeShift(true); assert.equal(c.pending, 'nightfall');
  c.pending = null; c.themeShift(false); assert.equal(c.pending, 'daybreak');
  const d = make(2);
  run(d, 2000);
  d.progress.today = d.progress.goal; d.wrote(10, d.now);
  d.advance(d.now + 100);
  assert.equal(d.pending, 'celebrate');
  const g = make(3);
  g.setGrowth(2); assert.equal(g.pickActivity(1e6), 'grow');
  g.g = 2; g.setGrowth(0); assert.equal(g.pickActivity(1e6), 'shrink');
});

test('every choice depends on its world and on what it did just before', () => {
  const tempos = { lively: 'zoomies', easy: 'look', calm: 'rest' };
  for (const a of Object.keys(CHOICES)) {
    const byWorld = new Set(), byPrev = new Set();
    for (const name of Object.keys(SCENES)) byWorld.add(make1(name).weights(NOW)[a] || 0);
    assert.ok(byWorld.size > 1, `${a}: its world matters`);
    const name = Object.keys(SCENES).find((n) => make1(n).weights(NOW)[a] > 0);
    for (const prev of Object.values(tempos)) { const c = make1(name); c.activity = prev; byPrev.add(c.weights(NOW)[a].toFixed(6)); }
    assert.ok(byPrev.size > 1, `${a}: what it did before matters`);
  }
  assert.ok(Object.keys(TEMPO).every((a) => ['lively', 'easy', 'calm'].includes(TEMPO[a])), 'everything has a tempo');
});

test('a little less active than it was, and the rare things a little less rare', () => {
  // The lively things a quarter lighter: at mid energy, under a third of what it chooses.
  const c = make(11), n = 20000;
  let lively = 0;
  for (let i = 0; i < n; i++) { c.recent = []; c.activity = 'look'; c.energy = 0.5; if (TEMPO[c.pickActivity(NOW)] === 'lively') lively++; }
  assert.ok(lively / n < 0.33, `lively ${(100 * lively / n).toFixed(1)} %`);
  // Its energy rises more slowly with the words: a steady 20 words a minute for ten minutes.
  const e = make(12);
  for (let t = 0; t < 10 * MINUTE; t += 1000) { if (t % 3000 === 0) e.wrote(1, t); e.updateEnergy(1000); }
  assert.ok(e.energy > 0.5 && e.energy < 0.7, `energy ${e.energy.toFixed(2)} (0.76 in 0.42)`);
  // The rare surprises and finds: each a little likelier than in 0.42.
  const s = { ...make1('plain').world(NOW), free: true, luck: 1, ok: () => true, corner: true, cornerAgo: 2 * 3600e3 };
  const was = { egg: 0.012, ufo: 0.01, gem: 0.03, feather: 0.06, cornerBite: 0.004 * 2 };
  for (const [a, w] of Object.entries(was)) assert.ok(CHOICES[a][1](s, make(1)) > w, `${a}: ${CHOICES[a][1](s, make(1))} > ${w}`);
});

test('every event can come about, and every reaction can be seen', () => {
  // Events: each has a world where it may start.
  const night = scene(() => {}, (s) => wide(s, { clock: at('2026-10-21T23:30:00') }));
  for (const [kind, E] of Object.entries(EVENTS)) {
    const ok = [make1('plain'), night, make1('tree')].some((c) => E.ok(c));
    assert.ok(ok && E.w > 0, `${kind} can happen`);
  }
  // Click reactions: every one comes up, in some situation, at some pace of clicks.
  const c = make(21);
  c.cursor = { x: c.center() + 20, y: 4, t: NOW };
  const base = { activity: 'look', reaction: null, posture: 'stand', moving: false, air: false, asleep: false, near: {}, carrying: null, hat: null, raining: false, wet: false, tree: null, night: false, mood: 'content' };
  const ctxs = [{}, { moving: true, activity: 'walk' }, { carrying: 'bone' }, { near: { bone: 1, ball: 1, flower: 1, puddle: 1 } }, { activity: 'writeAlong', posture: 'sit' }, { activity: 'readScript', posture: 'sit' },
    { activity: 'dance' }, { reaction: 'boogie' }, { night: true }, { tree: {} }, { raining: true }, { wet: true }, { hat: 'party' }, { hat: 'bird' }, { activity: 'snail', posture: 'lie' },
    { carrying: 'pebble' }, { activity: 'strut' }, { posture: 'sit' }, { posture: 'lie' }, { asleep: true, posture: 'lie', activity: 'sleep' }];
  const seen = new Set();
  for (const o of ctxs) for (const mood of Object.keys(_test.MOODS)) for (const a of [1, 2, 3, 5, 8, 11]) for (let i = 0; i < 40; i++) {
    c.history = []; c.lastUsed = {}; c.mood = mood;
    seen.add(c.chooseReaction(NOW, a, { ...base, ...o, mood }));
  }
  const clicks = Object.keys(REACTIONS).filter((n) => REACTIONS[n].cat !== 'env');
  assert.deepEqual(clicks.filter((n) => !seen.has(n)), [], 'every click reaction');
  // Its part in the weather and the visitors: chosen to fit (rain, wind, a tumbleweed), or set off by them.
  const env = new Set();
  for (const o of ctxs) for (const kind of ['rain', 'wind', 'tumbleweed']) for (let i = 0; i < 40; i++) { c.props = i % 2 ? [] : [{ kind: 'party', blownHat: true }]; env.add(c.envReaction(kind, { ...base, ...o })); }
  const src = fs.readFileSync(new URL('../../src/renderer/dino.js', import.meta.url), 'utf8');
  for (const n of Object.keys(REACTIONS).filter((k) => REACTIONS[k].cat === 'env')) assert.ok(env.has(n) || src.includes(`'${n}'`), `${n} is set off somewhere`);
});

// ---- the newer neighbours and habits ---------------------------------------------------------------

test('five newer neighbours: a dragonfly, a bee, a kite, a rock, a dung beetle — each comes, plays its part and goes', () => {
  const kinds = { dragonfly: ['dragonfly'], bee: ['bee'], kite: ['kite'], beetle: ['beetle', 'dung'], boulder: ['rock'] };
  for (const [a, props] of Object.entries(kinds)) {
    for (let seed = 0; seed < 5; seed++) {
      const c = wide(seed * 13 + a.length);
      c.envNext = Infinity;
      if (a === 'bee' && seed % 2) grown(c, 'flower', { born: 0 }); // at the flowers above all
      c.pending = a;
      const seen = new Set();
      let high = 0, held = false, ran = false;
      const look = () => {
        for (const p of c.props) seen.add(p.kind);
        if (c.hat) seen.add(c.hat.kind);
        if (c.activity === a) { high = Math.max(high, c.y); held ||= c.props.some((p) => p.kind === 'kite' && p.held); ran ||= /^run/.test(c.frame); }
        inView(c); walksNotSlides(c);
      };
      run(c, 1000, { dt: 50, each: look });
      until(c, () => c.activity !== a, 90000, `${a} ends`, look);
      assert.ok(props.every((k) => seen.has(k)), `${a}: ${[...seen]}`);
      if (a === 'kite') assert.ok(held && high >= 2.9, `${a}: it held on and was lifted (${high.toFixed(1)})`);
      if (a === 'boulder') { const r = c.find('rock'); assert.ok(r && high >= r.art.length - 0.01, `climbed the rock (${high.toFixed(1)})`); assert.ok(c.y === 0, 'and came down'); }
      if (a === 'bee') assert.ok(ran, 'it ran from the bee');
      run(c, 80000, { from: c.now + 50, each: () => { c.pending = c.pending || 'look'; inView(c); } });
      if (a !== 'boulder') assert.ok(!c.props.some((p) => props.includes(p.kind)), `${a}: gone afterwards (${c.props.map((p) => p.kind)})`);
    }
  }
  // A rock is never the same twice, and always something to stand on.
  const shapes = new Set();
  for (let i = 0; i < 40; i++) {
    const art = rockArt(seeded(i));
    shapes.add(art.join('/'));
    assert.ok(art.every((r) => r.length === art[0].length && /^[#.]+$/.test(r)) && /^#+$/.test(art.at(-1)), art.join('/'));
    assert.ok(art[0].length >= 7 && art[0].length <= 12 && art.length >= 3 && art.length <= 5, 'its size');
  }
  assert.ok(shapes.size >= 35, `${shapes.size} shapes in 40`);
  // The kite and the rock are seldom; a bee mostly where the flowers are; a dragonfly mostly by the water.
  const plain = make1('plain').weights(NOW), wet = make1('rainy').weights(NOW), fl = make1('flowers').weights(NOW);
  for (const a of ['kite', 'boulder']) assert.ok(share(plain, a) > 0 && share(plain, a) < 0.006, `${a} seldom (${(100 * share(plain, a)).toFixed(2)} %)`);
  assert.ok(fl.bee > 5 * plain.bee, 'bees at the flowers');
  assert.ok(wet.dragonfly > 2 * plain.dragonfly, 'dragonflies by the water');
});

test('three newer habits: leaves swept into a heap and leapt into, hide and seek, tidying up', () => {
  for (let seed = 0; seed < 4; seed++) {
    // Leaves: with some lying about, or brought down by the breeze.
    const c = wide(300 + seed);
    c.envNext = Infinity;
    if (seed % 2) for (let i = 0; i < 3; i++) c.spawn('leaf', { x: c.clampProp(c.center() + (i - 1) * 50, 4), life: 60000 });
    else c.lastEnv.wind = -60000;
    c.pending = 'leafPile';
    let pile = false, leapt = false;
    const look = () => { if (c.find('pile')) pile = true; if (pile && !c.find('pile') && c.activity === 'leafPile') leapt = true; inView(c); walksNotSlides(c); };
    run(c, 500, { dt: 50, each: look });
    until(c, () => c.activity !== 'leafPile', 90000, 'leafPile ends', look);
    assert.ok(pile && leapt, `a heap, and a leap into it (${seed})`);
    // Hide and seek: behind a rock, the rock drawn in front of it; and out again.
    const h = wide(310 + seed);
    h.envNext = Infinity;
    const rock = h.spawn('rock', { x: h.clampProp(h.center() + 60, 12), art: rockArt(seeded(seed)), life: 10 * MINUTE });
    h.pending = 'hideSeek';
    let hid = false;
    const peek = () => { if (h.step?.hide) { hid = true; assert.equal(h.hideIn, rock); } inView(h); walksNotSlides(h); };
    run(h, 500, { dt: 50, each: peek });
    until(h, () => h.activity !== 'hideSeek', 90000, 'hideSeek ends', peek);
    assert.ok(hid && h.hideIn === null, 'hid behind it, and came out');
    // Tidying up: what lies about is gone afterwards; something just tossed (still rolling) waits.
    const t = wide(320 + seed);
    t.envNext = Infinity;
    const left = [0, 1, 2].map((i) => t.spawn(i === 2 ? 'stick' : 'pebble', { x: 40 + 120 * i, life: 120000 }));
    t.pending = 'tidyUp';
    until(t, () => t.recent.includes('tidyUp') && t.activity !== 'tidyUp', 120000, 'tidyUp ends', () => { inView(t); walksNotSlides(t); });
    assert.ok(left.every((p) => !t.has(p)), `tidied away (${t.props.map((p) => p.kind)})`);
  }
  // When each comes up: leaves about, something to hide behind, things lying about; and after a mess.
  assert.ok(!make1('plain').weights(NOW).tidyUp && make1('litter').weights(NOW).tidyUp > 0, 'tidies only what lies about');
  const after = make1('litter'); after.activity = 'gatherPebbles';
  assert.ok(after.weights(NOW).tidyUp > 2 * make1('litter').weights(NOW).tidyUp, 'the more just after playing with them');
  assert.ok(!make1('plain').weights(NOW).hideSeek && make1('rock').weights(NOW).hideSeek > 0 && make1('tree').weights(NOW).hideSeek > 0, 'hides behind something big');
  assert.ok(!make1('plain').weights(NOW).leafPile && make1('leaves').weights(NOW).leafPile > 0 && make1('breeze').weights(NOW).leafPile > 0, 'leaves about, or a breeze just now');
});

test('a click while it is up on something waits until it is down', () => {
  const c = wide(40);
  c.envNext = Infinity;
  c.spawn('rock', { x: c.clampProp(c.center() + 50, 12), art: ['..####..', '.######.', '########', '########'], life: 10 * MINUTE });
  c.pending = 'boulder';
  until(c, () => c.y >= 3.99 && c.step?.lift?.[1] === 4, 60000, 'up on the rock');
  c.poke(c.now, c.center(), 8);
  let up = true;
  until(c, () => !!c.inReaction, 30000, 'the click answered', () => { if (c.inReaction) assert.ok(!up || c.y === 0, 'never while up there'); up = c.y > 0; });
  assert.equal(c.y, 0);
});
