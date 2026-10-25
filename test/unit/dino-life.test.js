// Hours of the dinosaur's life, simulated once and shared, with every rule checked on every frame;
// and how often things happen, read from its choices (test/unit/dino.test.js has each behaviour).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROW_FULL, seeded, make, wide, run, inView, doing, until, world, STEPPING, walksNotSlides, MINUTE, writer, chosen } from '../helpers/dino-sim.js';

// ---- one long life, shared ----------------------------------------------------------------------
//
// Hours of use, simulated once (two playgrounds as wide as the app's, one at night, and a narrower
// one) with every rule checked on every frame: seamless steps, walking never sliding, everything in
// view, on the playground, at most two reactions queued. Writing comes in bursts with idle spells
// between, clicks now and then (sometimes a storm), the theme turns, the window goes into the
// background and comes back. The tests below read what happened from it.

let LIFE = null;
function life() {
  if (LIFE) return LIFE;
  LIFE = [];
  const night = Date.parse('2026-10-21T22:30:00');
  for (const [seed, mk, hours] of [[41, (s) => world(s), 3], [42, (s) => world(s, { clock: () => night }), 3], [405, (s) => wide(s), 2]]) {
    const c = mk(seed), rng = seeded(seed);
    const L = { c, hours, n: 0, away: 0, outer: 0, middle: 0, walked: 0, activities: {}, reactions: new Set(), events: [], floating: 0, gusts: 0, shifts: 0, suns: 0, times: {}, back: 0 };
    const orig = c.startEvent.bind(c);
    c.startEvent = (kind, now) => { assert.equal(c.event, null, `${kind} while ${c.event?.kind} is still going`); L.events.push({ kind, now }); return orig(kind, now); };
    let writingUntil = 0, nextBurst = 0, dark = false, last = '', awayUntil = 0;
    run(c, hours * 3600e3, { dt: 150, each: (now) => {
      if (now > nextBurst) { writingUntil = now + (rng() < 0.5 ? 5 : 20) * MINUTE; nextBurst = writingUntil + rng() * 40 * MINUTE; }
      if (now < writingUntil && rng() < 0.04) { c.wrote(2, now); c.progress.today += 2; }
      if (rng() < 0.0008) { const k = rng() < 0.2 ? 6 + Math.floor(rng() * 8) : 1; for (let i = 0; i < k; i++) c.poke(now + i * 50, c.center() + (rng() - 0.5) * 20, 8); }
      if (rng() < 0.0002) { dark = !dark; L.shifts++; c.themeShift(dark); }
      if (c.focused && rng() < 0.00005) { c.setFocus(false, now); awayUntil = now + (5 + rng() * 25) * MINUTE; }
      if (!c.focused && now > awayUntil) c.setFocus(true, now);
      if (c.inReaction) L.reactions.add(c.inReaction);
      if (c.activity !== last) { last = c.activity; L.activities[last] = (L.activities[last] || 0) + 1; (L.times[last] ||= []).push(now); }
      L.n++;
      if (c.away()) L.away++;
      if (c.step && (c.step.f === 'fallen' || c.step.flip)) L.back++;
      const f = c.x / c.maxX;
      if (f < 0.08 || f > 0.92) L.outer++;
      if (f > 0.25 && f < 0.75) L.middle++;
      if (c.step) { walksNotSlides(c); if (c.step.ground && STEPPING.test(c.step.f)) L.walked++; }
      L.floating = Math.max(L.floating, c.floating());
      L.gusts = Math.max(L.gusts, c.streaks.length);
      L.suns = Math.max(L.suns, c.props.filter((p) => p.kind === 'sun' || p.kind === 'moon').length);
      inView(c);
      assert.ok(c.onstage(), `always on the playground [${c.activity}/${c.inReaction}]`);
    } });
    LIFE.push(L);
  }
  return LIFE;
}
const sum = (f) => life().reduce((n, L) => n + f(L), 0);

test('hours of use — writing bursts, idle spells, click storms, the weather, the theme, the window away — always seamless and varied', () => {
  const acts = new Set(life().flatMap((L) => Object.keys(L.activities))), reacts = new Set(life().flatMap((L) => [...L.reactions]));
  assert.ok(acts.size >= 45, `activities seen: ${acts.size}`);
  assert.ok(reacts.size >= 30, `reactions seen: ${reacts.size}`);
  assert.ok(sum((L) => L.shifts) > 4 && acts.has('nightfall') && acts.has('daybreak'), 'the theme turned, and it watched');
  assert.ok(life().every((L) => L.suns <= 2), 'never a sky full of suns');
  for (const a of ['backScratch', 'strut']) assert.ok(acts.has(a), `${a} turns up on its own`);
  const back = sum((L) => L.back) / sum((L) => L.n);
  assert.ok(back < 0.01, `on its back or upside down only now and then (${(100 * back).toFixed(2)} % of the time)`);
});

test('it walks whenever it moves (checked on every frame), lives at home around TODAY, and goes exploring now and then', () => {
  assert.ok(sum((L) => L.walked) > 1000, 'it did walk');
  const [a, b] = life();
  const away = (a.away + b.away) / (a.n + b.n);
  assert.ok(away < 0.12, `mostly at home (${(100 * away).toFixed(1)} % away)`);
  assert.ok(away > 0 && sum((L) => L.activities.explore || 0) >= 1, `but it does go exploring (${(100 * away).toFixed(2)} % away, explored ${sum((L) => L.activities.explore || 0)} times in all)`);
  const w = life()[2];
  assert.ok(w.outer / w.n < 0.15 && w.outer > 0, `on a narrower strip it rarely goes to the ends (${(100 * w.outer / w.n).toFixed(1)} %), but does`);
  assert.ok(w.middle / w.n > 0.45, `mostly in the middle stretch (${(100 * w.middle / w.n).toFixed(1)} %)`);
});

test('the environment surprises now and then: a few events an hour, never two at once, well spaced; only a few things float about', () => {
  for (const L of life()) {
    const perHour = L.events.length / L.hours;
    assert.ok(perHour >= 3 && perHour <= 20, `${perHour} events an hour`);
    for (let i = 1; i < L.events.length; i++) assert.ok(L.events[i].now - L.events[i - 1].now >= 60000, 'spaced out');
    assert.ok(L.floating <= 4, `at most ${L.floating} things floating at once`);
    assert.ok(L.gusts <= 2, 'never more than two gusts');
  }
  assert.ok(new Set(life().flatMap((L) => L.events.map((e) => e.kind))).size >= 4, 'of several kinds');
});

// ---- how often: read from the choice itself -------------------------------------------------------


test('rare surprises (an egg, a UFO) are rare, and the longer since the last, the likelier the next', () => {
  const c = make(3);
  const soon = chosen(c, 15000, 1e9, (d) => { d.lastRare = 1e9 - 60000; });
  const long = chosen(c, 15000, 1e9, (d) => { d.lastRare = 1e9 - 3 * 3600e3; });
  for (const k of ['egg', 'ufo']) {
    assert.ok((long[k] || 0) > 0 && long[k] / 15000 < 0.004, `${k}: rare (${long[k]})`);
    assert.ok((long[k] || 0) > 2 * (soon[k] || 0), `${k}: likelier after a long while (${soon[k] || 0} → ${long[k]})`);
  }
});

test('the corner bite: very rare, never within 40 minutes of the last, and never where the strip does not end at the corner', () => {
  const c = world(51);
  const n = (since, k) => chosen(c, k, 5 * 3600e3, (d) => { d.x = d.zone(0.5); d.lastCorner = 5 * 3600e3 - since; }).cornerBite || 0;
  assert.equal(n(30 * MINUTE, 20000), 0, 'not within 40 minutes');
  const later = n(4 * 3600e3, 40000);
  assert.ok(later > 0 && later / 40000 < 0.002, `very rare (${later} in 40000 choices)`);
  const p = world(8, { corner: () => false });
  assert.ok(!chosen(p, 4000, 3 * 3600e3, (d) => { d.lastCorner = 0; }).cornerBite, 'not with a side panel there');
  // The excursion itself: the whole way there on foot, a bite facing the corner, and home again.
  const w = world(7);
  w.envNext = Infinity; w.x = w.zone(0.5); w.pending = 'cornerBite';
  let prev = w.x, maxMove = 0, bitAt = null, done = false;
  run(w, 4 * MINUTE, { dt: 40, each: () => {
    if (done) return;
    walksNotSlides(w);
    maxMove = Math.max(maxMove, Math.abs(w.x - prev)); prev = w.x;
    if (w.frame === 'gnaw' && bitAt == null) bitAt = { x: w.x, face: w.face };
    if (bitAt && w.activity !== 'cornerBite') done = true;
  } });
  assert.ok(done, 'the excursion ends');
  assert.ok(maxMove <= 3 * w.du + 1e-9, `walked all the way (largest move ${maxMove.toFixed(2)} px)`);
  assert.deepEqual(bitAt, { x: 0, face: -1 }, 'a bite at the very corner, facing it');
  assert.ok(w.x > w.zone(0) - 1, 'and home again');
});

test('the longer routines: making its bed and lining up pebbles often, a tightrope act and planting a flower rarely (never twice in 35 minutes)', () => {
  const c = world(401);
  const k = chosen(c, 20000, 3 * 3600e3, (d) => { d.lastDone = {}; });
  assert.ok(k.settleIn > 3 * (k.tightrope || 0) && k.gatherPebbles > 3 * (k.plantSeed || 0), `much rarer: ${JSON.stringify({ settleIn: k.settleIn, gatherPebbles: k.gatherPebbles, tightrope: k.tightrope, plantSeed: k.plantSeed })}`);
  assert.ok(k.tightrope > 0 && k.plantSeed > 0, 'but they do happen');
  const recent = chosen(c, 6000, 3 * 3600e3, (d) => { d.lastDone = { tightrope: 3 * 3600e3 - 20 * MINUTE, plantSeed: 3 * 3600e3 - 20 * MINUTE }; });
  assert.ok(!recent.tightrope && !recent.plantSeed, 'not again within 35 minutes');
  // Each has its beginning, middle and end.
  for (let seed = 0; seed < 2; seed++) {
    const a = doing('look', 410 + seed);
    a.pending = 'settleIn'; a.gen = null;
    const fs = [];
    until(a, () => a.recent.includes('settleIn') && a.activity !== 'settleIn', 60000, 'settles in', () => { if (a.activity === 'settleIn') fs.push(a.frame); walksNotSlides(a); });
    assert.ok(fs.includes('walk1') && fs.includes('crouch') && fs.includes('lie'), 'round and round, a scrape, down');
    const b = doing('look', 420 + seed);
    b.pending = 'gatherPebbles'; b.gen = null;
    let row = [];
    until(b, () => b.recent.includes('gatherPebbles') && b.activity !== 'gatherPebbles', 90000, 'lines up pebbles', () => {
      const now = b.props.filter((p) => p.kind === 'pebble' && !p.carried && !p.vx && p.y === 0);
      if (b.activity === 'gatherPebbles' && now.length >= row.length) row = now;
      walksNotSlides(b);
    });
    const xs = row.map((p) => p.x).sort((p, q) => p - q);
    assert.ok(xs.length >= 3, `${xs.length} pebbles set down`);
    for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 4 * b.u) < 1.5 * b.u, `in a row (${xs.map((x) => x.toFixed(1))})`);
    const t = doing('look', 430 + seed);
    t.pending = 'tightrope'; t.gen = null;
    const tf = new Set();
    until(t, () => t.recent.includes('tightrope') && t.activity !== 'tightrope', 60000, 'tightrope', () => { if (t.activity === 'tightrope') tf.add(t.frame); walksNotSlides(t); });
    for (const f of ['armsUp', 'creep1', 'creep2', 'oneLeg']) assert.ok(tf.has(f), `tightrope: ${f}`);
    const p = doing('look', 440 + seed);
    p.pending = 'plantSeed'; p.gen = null;
    let grown = 0;
    until(p, () => p.recent.includes('plantSeed') && p.activity !== 'plantSeed', 90000, 'plants a seed', () => { const fl = p.find('flower'); if (fl) grown = Math.max(grown, fl.frame); walksNotSlides(p); });
    assert.equal(grown, 3, 'a flower came up and opened');
  }
});

test('in the background tufts of grass come up on the clock, one at a time, minutes apart, and only so many; never touched meanwhile', () => {
  // A window hardly ticking at all (throttled, or hidden): one tick an hour later finds every tuft that was due.
  const a = world(201);
  run(a, 30000, { dt: 100 });
  a.setFocus(false, a.now);
  const t0 = a.now;
  a.advance(t0 + 60 * MINUTE);
  const tufts = a.tufts().sort((p, q) => p.born - q.born);
  assert.equal(tufts.length, a.T.tuftsMax, `${tufts.length} after an hour away, at most ${a.T.tuftsMax}`);
  assert.ok(tufts[0].born - t0 >= a.T.tuftFirst[0] && tufts[0].born - t0 <= a.T.tuftFirst[1], 'the first not at once');
  for (let i = 1; i < tufts.length; i++) assert.ok(tufts[i].born - tufts[i - 1].born >= a.T.tuftEvery[0] && tufts[i].born - tufts[i - 1].born <= a.T.tuftEvery[1], 'one at a time, minutes apart');
  for (const p of tufts) assert.ok(p.kind === 'grass' && p.x >= 0 && p.x + a.propW(p) <= a.stripW, 'grass, on the playground');
  a.advance(t0 + 61 * MINUTE);
  assert.ok(tufts.every((p) => p.frame === GROW_FULL.grass || a.now - p.born < 2 * a.T.tuftGrow), 'grown as much as their age says');
  a.advance(t0 + 300 * MINUTE);
  assert.equal(a.tufts().length, a.T.tuftsMax, 'and never more, however long');
  // Ticking all the while: the same clock, and it never eats or nibbles them while the window is away.
  const c = world(202), rng = seeded(202);
  run(c, 60000, { dt: 100, each: writer(c, rng) });
  c.setFocus(false, c.now);
  const from = c.now, seen = new Map();
  run(c, 30 * MINUTE, { from, dt: 250, each: () => {
    for (const [p, f] of seen) { assert.ok(c.has(p), 'never eaten while away'); assert.ok(p.frame >= f, 'never nibbled while away'); }
    for (const p of c.tufts()) seen.set(p, p.frame);
    assert.notEqual(c.activity, 'graze');
  } });
  const born = c.tufts().map((p) => p.born - from).sort((x, y) => x - y);
  assert.ok(born.length >= 3 && born[0] >= c.T.tuftFirst[0], `${born.length} came up, the first after ${Math.round(born[0] / 1000)} s`);
});


test('what grows while you are away comes up and grows a quarter faster than it did (0.38)', () => {
  const T = world(990).T, before = { tuftFirst: [1, 2.5], tuftEvery: [1.5, 4], tuftGrow: 0.75, lushAfter: 40, lushEvery: [3, 7], lushGrow: 3 }; // (minutes, until 0.37)
  for (const [k, v] of Object.entries(before)) assert.deepEqual([T[k]].flat().map((x) => Math.round(x / MINUTE * 1.25 * 1000) / 1000), [v].flat(), k);
  assert.deepEqual([T.tuftsMax, T.lushMax, T.deepSleep], [12, 3, 12 * MINUTE], 'as many, and the same deep sleep');
});
