// The dinosaur's pixel art and behaviour engine, simulated headlessly: every
// activity and reaction, hours of use with writing bursts, idle spells and
// clicks, reactions that follow what it was doing, the environment (rain,
// wind, a bird, a tumbleweed, a shooting star, a palm tree…), growing with the
// writing streak, and the rules that keep it seamless (reactions only between
// steps, no impossible jumps between postures, bounded queue and props,
// everything in view).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Critter, _test } from '../src/renderer/dino.js';

const { FRAMES, PROPS, GLYPHS, W, H, ACTIVITIES, REACTIONS, SPECIALS, GET_UP, BASELINE_0_8, postureOf } = _test;
const HEADROOM = 30;

function seeded(seed) { // mulberry32
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function make(seed = 1, opts = {}) {
  const progress = { today: 0, goal: 1000 };
  const c = new Critter({ rng: seeded(seed), unit: () => 1.25, width: () => 170, progress: () => progress, clock: () => opts.clock ?? Date.parse('2026-10-21T15:00:00'), ...opts });
  c.progress = progress;
  return c;
}
/** Dimensions in the app: a 560 px strip at 1.25 px per sprite pixel, 24 px margins. */
function wide(seed, opts = {}) { return make(seed, { width: () => 560, margin: () => 24, ...opts }); }

/** Run the engine with checks on every step. */
function run(c, ms, { from = 0, dt = 100, each } = {}) {
  let now = from;
  let prev = null;
  const steps = [];
  for (; now < from + ms; now += dt) {
    if (each) each(now);
    c.advance(now);
    const s = c.step;
    if (s !== prev) {
      if (prev) {
        assert.ok(s.start >= prev.end - 1e-6, 'a step never starts before the previous one ended');
        const a = postureOf(prev.f), b = postureOf(s.f);
        if (a === 'lie') assert.ok(b !== 'stand', `no jump from lying (${prev.f}) straight to ${s.f} [${c.activity}/${c.inReaction}]`);
        if (a === 'sit' && b === 'stand') assert.ok(GET_UP.has(s.f) || (s.f === 'stand' && prev.f === 'crouch'), `sit (${prev.f}) → ${s.f} without getting up [${c.activity}/${c.inReaction}]`);
        if (!c.resized) assert.ok(prev.x1 >= -0.01 && prev.x1 <= c.maxX + 0.01, `stays on the strip: ${prev.x1} [${c.activity}]`);
        // Responsiveness never speeds anything up: moves, jumps and lifts always run their full length.
        if (prev.dx || prev.jump || prev.lift) assert.ok(Math.abs(prev.end - prev.start - prev.t) < 1e-6, `${prev.f} ran its full ${prev.t} ms`);
      }
      assert.ok(FRAMES[s.f], `frame ${s.f}`);
      assert.ok(s.t > 0 && s.t <= 1500, `step ${s.f} ${s.t} ms is short enough to blend a reaction in [${c.activity}/${c.inReaction}]`);
      if (s.fx) assert.ok(GLYPHS[s.fx], `glyph ${s.fx}`);
      steps.push({ ...s, activity: c.activity, reaction: c.inReaction });
      prev = s;
    }
    assert.ok(c.queue.length <= 2, 'at most two reactions queued');
    assert.ok(c.props.length <= 8, `props bounded (${c.props.map((p) => p.kind)})`);
    if (!c.resized) assert.ok(c.x > -c.dw - 6 && c.x < c.stripW + 6, 'never wanders far off');
  }
  return { steps, now };
}

/** Every prop whole and inside the drawn area (the strip, its margins, the headroom). */
function inView(c) {
  for (const p of c.props) {
    if (p.carried || p.balance) continue;
    const w = PROPS[p.kind][0][0].length * c.u, h = Math.max(...PROPS[p.kind].map((f) => f.length));
    assert.ok(p.x >= -c.margin - 0.5 && p.x + w <= c.stripW + c.margin + 0.5, `${p.kind} stays in view (x=${p.x.toFixed(1)})`);
    assert.ok(p.y >= 0 && p.y + h <= H + HEADROOM, `${p.kind} stays below the top (y=${p.y.toFixed(1)})`);
  }
}

test('every frame and prop is a full grid of known pixels', () => {
  for (const [name, rows] of Object.entries(FRAMES)) {
    assert.equal(rows.length, H, name + ' height');
    for (const r of rows) {
      assert.equal(r.length, W, `${name} row "${r}"`);
      assert.match(r, /^[#.o]+$/, name);
    }
    assert.ok(rows.join('').includes('#'), name + ' is not empty');
  }
  for (const [name, frames] of Object.entries(PROPS)) {
    for (const rows of frames) {
      assert.ok(rows.every((r) => r.length === frames[0][0].length && /^[#.o]+$/.test(r)), `${name}: every frame the same width`);
      assert.ok(rows.join('').includes('#'), name);
    }
  }
});

test('the repertoire is more than twice what it was, and every behaviour is its own', () => {
  const acts = Object.keys(ACTIVITIES), reacts = Object.keys(REACTIONS);
  assert.ok(acts.length + reacts.length >= 2 * BASELINE_0_8, `${acts.length} activities + ${reacts.length} reactions vs ${BASELINE_0_8} in 0.8.0`);
  assert.ok(acts.length >= 2 * 28, `activities doubled (${acts.length})`);
  assert.ok(reacts.filter((n) => REACTIONS[n].cat !== 'env').length >= 2 * 33, 'click reactions doubled');
  // No copies: every generator's body is different.
  const bodies = new Set([...acts.map((n) => String(ACTIVITIES[n])), ...reacts.map((n) => String(REACTIONS[n].fn))]);
  assert.equal(bodies.size, acts.length + reacts.length, 'no two behaviours are the same code');
  for (const cat of ['subtle', 'normal', 'big', 'absurd', 'none', 'context', 'escalate', 'asleep', 'env']) assert.ok(reacts.some((n) => REACTIONS[n].cat === cat), cat);
});

test('every activity plays through, at any energy, from any posture', () => {
  for (const name of Object.keys(ACTIVITIES)) {
    for (const [energy, frame] of [[0, 'sit'], [0.5, 'stand'], [1, 'lie']]) {
      const c = make(name.length * 7 + energy * 10);
      c.frame = frame;
      c.energy = energy;
      c.heat = energy * 40;
      c.pending = name;
      c.envNext = Infinity;
      const { steps } = run(c, 120000, { each: () => { c.energy = energy; inView(c); } });
      const own = steps.filter((s) => s.activity === name);
      assert.ok(own.length >= 3, `${name} ran`);
      const total = own.reduce((n, s) => n + s.t, 0);
      assert.ok(total >= 1000, `${name} lasts a while (${total} ms)`);
      assert.ok(steps.some((s) => s.activity !== name), `${name} finishes`);
      assert.ok(c.onstage() || c.activity === 'peekaboo', `${name} comes back on stage`);
    }
  }
});

test('every click reaction blends in and hands back to the activity, from standing, sitting and sleeping', () => {
  for (const name of Object.keys(REACTIONS)) {
    if (REACTIONS[name].cat === 'env') continue;
    for (const start of ['look', 'rest', 'sleep']) {
      const c = make(name.length + start.length);
      c.envNext = Infinity;
      c.pending = start;
      c.cursor = { x: 150, y: 10, t: 0 };
      run(c, 3000); // well into the activity
      if (start === 'sleep') run(c, 4000, { from: 3000 });
      const before = c.activity;
      c.force = name;
      c.poke(7000);
      const { steps } = run(c, 30000, { from: 7000 });
      const mine = steps.filter((s) => s.reaction === name);
      const dur = mine.reduce((n, s) => n + s.t, 0);
      const R = REACTIONS[name];
      if (R.cat !== 'none' || name === 'noticeLater') {
        if (name !== 'nothing') assert.ok(mine.length > 0, `${name} happened (from ${start})`);
      }
      assert.ok(dur < 9000, `${name}: ${dur} ms`);
      assert.ok(!c.inReaction || c.inReaction !== name || steps.length > mine.length, `${name} ends`);
      if (start !== 'sleep' && mine.length) assert.ok(steps.some((s) => s.activity === before && !s.reaction && s.start > mine.at(-1).start) || c.activity !== before, `${name} → back to ${before}`);
    }
  }
});

/** Get the critter into an activity, a few seconds in. */
function doing(activity, seed = 3, setup) {
  const c = wide(seed);
  c.envNext = Infinity;
  if (setup) setup(c);
  c.pending = activity;
  run(c, 4000, { dt: 50 });
  return c;
}
/** What it answers clicks with, in this situation (many separate clicks). */
function answers(c, n = 400) {
  const counts = {};
  const saved = { history: c.history, lastUsed: c.lastUsed };
  let now = c.now;
  for (let i = 0; i < n; i++) {
    now += 9000;
    c.history = []; c.lastUsed = {};
    const k = c.context();
    const r = c.chooseReaction(now, 1, k);
    counts[r] = (counts[r] || 0) + 1;
  }
  Object.assign(c, saved);
  return counts;
}
const share = (counts, names) => names.reduce((s, k) => s + (counts[k] || 0), 0) / Object.values(counts).reduce((a, b) => a + b, 0);

test('click reactions follow what it was doing at that moment', () => {
  const walking = doing('walk', 4, (c) => { c.x = 30; });
  assert.ok(walking.context().moving, 'walking');
  const w = answers(walking);
  assert.ok(share(w, ['stopInTracks', 'skip', 'tripUp']) > 0.15, `walking: stops, skips, trips (${JSON.stringify(w)})`);

  const sleeping = doing('sleep', 5);
  run(sleeping, 6000, { from: sleeping.now + 50, dt: 50 });
  assert.ok(sleeping.asleep());
  const z = answers(sleeping);
  assert.ok(Object.keys(z).every((k) => REACTIONS[k].asleep), `asleep: only sleepy answers (${Object.keys(z)})`);
  assert.ok(share(z, ['sleepTalk', 'rollOver', 'wakeGrumpy', 'snore', 'grumble']) > 0.5);

  const typing = doing('writeAlong', 6, (c) => { c.heat = 30; });
  for (let i = 0; i < 60 && !(typing.sitting() && typing.find('typewriter')); i++) run(typing, 100, { from: typing.now + 50, dt: 50 });
  const t = answers(typing);
  assert.ok(share(t, ['carriageReturn', 'showPage', 'shush']) > 0.2, `typing: ding, the page, shush (${JSON.stringify(t)})`);

  const chewing = doing('dig', 7);
  for (let i = 0; i < 300 && !chewing.context().carrying; i++) run(chewing, 100, { from: chewing.now + 50, dt: 50 });
  assert.equal(chewing.context().carrying, chewing.props.find((p) => p.carried)?.kind);
  if (chewing.context().carrying === 'bone') assert.ok(share(answers(chewing), ['guardBone', 'shareSnack']) > 0.15, 'with a bone: guards or shares it');

  const shaded = doing('look', 8, (c) => { c.spawn('palm', { x: c.clampProp(c.center() + 30, 11), frame: 3, life: 1e9 }); });
  assert.ok(shaded.context().tree);
  assert.ok(share(answers(shaded), ['treeHide', 'bumpTree']) > 0.1, 'by a tree: hides behind it, bumps into it');

  // And none of these where they make no sense.
  const idle = doing('rest', 9);
  const i = answers(idle);
  for (const k of ['stopInTracks', 'carriageReturn', 'guardBone', 'treeHide', 'sleepTalk', 'birdShoo', 'snailBoop']) assert.ok(!i[k], `${k} not when just looking about`);
});

test('repeated clicks get different answers, never a fixed cycle', () => {
  const c = doing('rest', 12);
  const seq = [];
  let now = c.now;
  for (let i = 0; i < 60; i++) { now += 6000; seq.push(c.chooseReaction(now, 1, c.context())); }
  assert.ok(new Set(seq).size >= 25, `${new Set(seq).size} different answers in 60 clicks`);
  for (let period = 1; period <= 12; period++) assert.ok(seq.some((r, k) => k >= period && r !== seq[k - period]), `not a cycle of ${period}`);
});

test('hours of use: writing bursts, idle spells, click storms and the weather — always seamless', () => {
  const c = make(2026);
  const rng = seeded(99);
  let writingUntil = 0, nextBurst = 0;
  const seenReactions = new Set(), seenActivities = new Set();
  const { steps } = run(c, 4 * 3600 * 1000, {
    dt: 120,
    each: (now) => {
      if (now > nextBurst) { writingUntil = now + (rng() < 0.5 ? 5 : 20) * 60000; nextBurst = writingUntil + rng() * 40 * 60000; }
      if (now < writingUntil && rng() < 0.03) { c.wrote(1, now); c.progress.today++; }
      if (rng() < 0.0009) { const n = rng() < 0.2 ? 6 + Math.floor(rng() * 8) : 1; for (let i = 0; i < n; i++) c.poke(now + i * 50, c.center() + (rng() - 0.5) * 20, 8); }
      if (c.inReaction) seenReactions.add(c.inReaction);
      seenActivities.add(c.activity);
      inView(c);
    },
  });
  assert.ok(steps.length > 20000);
  assert.ok(seenActivities.size >= 35, `activities seen: ${seenActivities.size}`);
  assert.ok(seenReactions.size >= 30, `reactions seen: ${seenReactions.size}`);
});

test('the pointer passing by is ignored: only clicks count', () => {
  const c = wide(21);
  assert.equal(c.cursorAt, undefined, 'no hover tracking at all');
  assert.equal(c.notice, undefined);
  c.pending = 'rest';
  c.envNext = Infinity;
  run(c, 8000, { dt: 20 });
  assert.equal(c.inReaction, null);
  assert.equal(c.cursor, null, 'it has never been told where the pointer is');
});

test('clicks: large, unpredictable variety that holds up over a long session', () => {
  const c = make(7);
  c.cursor = { x: 100, y: 10, t: 0 };
  c.pending = 'look';
  c.envNext = Infinity;
  run(c, 2000);
  const picks = [];
  let now = 2000;
  for (let i = 0; i < 800; i++) {
    now += 4000 + Math.floor(c.rng() * 30000); // separate clicks
    picks.push(c.chooseReaction(now, 1));
  }
  const counts = {};
  for (const p of picks) counts[p] = (counts[p] || 0) + 1;
  const distinct = Object.keys(counts).length;
  assert.ok(distinct >= 35, `distinct reactions: ${distinct}`);
  const top = Math.max(...Object.values(counts));
  assert.ok(top / picks.length < 0.1, `no reaction dominates (${top}/${picks.length})`);
  let repeats = 0;
  for (let i = 1; i < picks.length; i++) if (picks[i] === picks[i - 1]) repeats++;
  assert.ok(repeats / picks.length < 0.02, `immediate repeats ${repeats}`);
  // The second half is as varied as the first: variety doesn't run out.
  const half = (a) => new Set(a).size;
  assert.ok(half(picks.slice(400)) >= half(picks.slice(0, 400)) - 3);
  // Categories from subtle to absurd, and sometimes nothing at all.
  const cats = new Set(picks.map((p) => REACTIONS[p].cat));
  for (const k of ['subtle', 'normal', 'big', 'absurd', 'none']) assert.ok(cats.has(k), k);
});

test('rapid clicks escalate, stay queued at most two deep, and never break the animation', () => {
  const c = make(11);
  c.pending = 'walk';
  c.envNext = Infinity;
  run(c, 1500);
  const stepBefore = c.step;
  for (let i = 0; i < 14; i++) c.poke(1500 + i * 90);
  assert.ok(c.queue.length <= 2);
  assert.equal(c.step, stepBefore, 'the current step is untouched');
  assert.ok(c.history.some((n) => REACTIONS[n].cat === 'escalate' || ['runAway', 'playDead'].includes(n)), `escalated: ${c.history}`);
  run(c, 40000, { from: 1500 });
  assert.equal(c.inReaction, null);
  assert.equal(c.queue.length, 0);
});

test('livelier while writing, calmer when idle — gradually', () => {
  const c = make(5);
  for (let i = 0; i < 40; i++) c.wrote(1, 1000 + i * 1500);
  c.updateEnergy(30000);
  const e1 = c.energy;
  assert.ok(e1 > 0.2 && e1 < 1, `rose gradually (${e1})`);
  for (let i = 0; i < 60; i++) c.updateEnergy(10000);
  assert.ok(c.energy < 0.1, `calms down (${c.energy})`);
  const mix = (energy, writing) => {
    const d = make(8);
    d.energy = energy;
    d.heat = writing ? 30 : 0;
    d.lastWrite = writing ? 1e9 : 0;
    const n = {};
    for (let i = 0; i < 4000; i++) { d.recent = []; const a = d.pickActivity(1e9 + 500000); n[a] = (n[a] || 0) + 1; }
    return n;
  };
  const calm = mix(0, false), busy = mix(0.9, true);
  const lively = (m) => ['walk', 'hop', 'dance', 'fetch', 'juggle', 'zoomies'].reduce((s, k) => s + (m[k] || 0), 0);
  assert.ok(lively(busy) > 3 * lively(calm), 'more active while writing');
  assert.ok((calm.sleep || 0) + (calm.rest || 0) > 2 * ((busy.sleep || 0) + (busy.rest || 0)), 'rests more when idle');
  assert.ok(!calm.writeAlong && busy.writeAlong > 0, 'types along only while you write');
});

test('rare surprises are rare but do happen', () => {
  const c = make(3);
  const n = {};
  for (let i = 0; i < 60000; i++) { c.recent = []; c.energy = c.rng(); const a = c.pickActivity(1e9); n[a] = (n[a] || 0) + 1; }
  for (const k of ['egg', 'ufo']) {
    assert.ok(n[k] > 0, `${k} happens`);
    assert.ok(n[k] / 60000 < 0.004, `${k} stays rare (${n[k]})`);
  }
});

test('props are cleaned up after themselves', () => {
  const c = make(31);
  c.envNext = Infinity;
  c.pending = 'fetch';
  run(c, 30000);
  run(c, 120000, { from: 30000, each: () => { c.pending = c.pending || 'look'; } });
  assert.ok(c.props.length <= 1, `left over: ${c.props.map((p) => p.kind)}`);
});

test('a generous play area: it prefers the middle, rarely goes to the ends, and it and its props always stay in view', () => {
  const c = wide(404);
  const rng = seeded(5);
  let writingUntil = 0, nextBurst = 0, outer = 0, middle = 0, n = 0;
  run(c, 3 * 3600 * 1000, {
    dt: 150,
    each: (now) => {
      if (now > nextBurst) { writingUntil = now + 15 * 60000; nextBurst = writingUntil + rng() * 30 * 60000; }
      if (now < writingUntil && rng() < 0.03) c.wrote(1, now);
      if (rng() < 0.0006) c.poke(now);
      const f = c.x / c.maxX;
      n++;
      if (f < 0.08 || f > 0.92) outer++;
      if (f > 0.25 && f < 0.75) middle++;
      inView(c);
      assert.ok(c.onstage(), `the dinosaur never leaves the play area [${c.activity}/${c.inReaction}]`);
    },
  });
  assert.ok(outer / n < 0.12, `rarely at the ends (${(100 * outer / n).toFixed(1)} %)`);
  assert.ok(middle / n > 0.45, `mostly in the middle stretch (${(100 * middle / n).toFixed(1)} %)`);
  assert.ok(outer > 0, 'but it does go there now and then');
});

test('clicks are acknowledged on the spot; a held pose gives way at once, a move always finishes first', () => {
  const c = wide(12);
  c.envNext = Infinity;
  c.pending = 'rest';
  run(c, 4000, { dt: 10 });
  assert.equal(c.sitting(), true);
  const held = c.step;
  c.force = 'love';
  c.poke(4005);
  assert.equal(c.acking(4005), 2, 'a blink and a little start, right away');
  c.queue[0].at = 4005; // no thoughtful pause this time
  let started = null;
  run(c, 400, { from: 4005, dt: 10, each: (now) => { if (started == null && c.inReaction === 'love') started = now; } });
  assert.ok(started != null && started - 4005 <= 70, `the reaction began ${started - 4005} ms after the click`);
  assert.ok(held.end - held.start >= 50, 'the held pose was shown, just held shorter');
  // While walking, the stride in progress finishes first.
  const w = wide(13);
  w.envNext = Infinity;
  w.pending = 'walk'; w.x = 20;
  run(w, 2000, { dt: 10 });
  while (!w.step.dx) run(w, 10, { from: w.now + 10, dt: 10 });
  const stride = w.step, end = stride.end;
  w.force = 'spin';
  w.poke(w.now);
  assert.equal(w.step, stride);
  assert.equal(w.step.end, end, 'the stride is not cut short');
  assert.equal(w.acking(w.now), 2, 'but the click is acknowledged at once');
});

test('when the play area shrinks under it, it walks back in — no jump, nothing cut', () => {
  let width = 560;
  const c = make(77, { width: () => width, margin: () => 24 });
  c.envNext = Infinity;
  c.pending = 'rest';
  c.x = 520;
  run(c, 3000, { dt: 20 });
  width = 300; c.resized = true;
  assert.equal(c.onstage(), false);
  let prevX = c.x, maxJump = 0;
  run(c, 20000, { from: 3000, dt: 20, each: () => { maxJump = Math.max(maxJump, Math.abs(c.x - prevX)); prevX = c.x; } });
  assert.ok(c.onstage(), 'back in');
  assert.ok(maxJump < 4, `moves smoothly (largest move between frames ${maxJump.toFixed(2)} px)`);
  assert.equal(c.inReaction, null);
});

// ---- the environment ----------------------------------------------------------------------------

/** Run until a condition holds (or fail after `ms`). */
function until(c, cond, ms, what, each) {
  const end = c.now + ms;
  while (!cond()) {
    assert.ok(c.now < end, `${what} (after ${ms} ms) [${c.activity}/${c.inReaction}]`);
    run(c, 100, { from: c.now + 50, dt: 50, each });
  }
}

test('a rain cloud: drifts in, rains on it, it reacts to fit what it was doing, the rain ends, the cloud fades away', () => {
  const cases = [
    ['sleep', (r) => r === 'rainSleep', 'sleeps through it'],
    ['rest', (r) => ['rainTolerate', 'rainEscape', 'rainDrink', 'rainUmbrella', 'rainJig'].includes(r), 'awake'],
    ['dance', (r) => r !== 'rainSleep', 'awake'],
    ['look', (r) => r === 'rainShelter', 'shelters under the palm', (c) => c.spawn('palm', { x: c.clampProp(c.center() + 60, 11), frame: 3, life: 1e9 })],
  ];
  const seen = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    for (const [activity, fits, what, setup] of cases) {
      const c = doing(activity, seed * 10 + activity.length, setup);
      if (activity === 'sleep') until(c, () => c.asleep(), 10000, 'falls asleep');
      if (setup && seed > 1) continue;
      const before = c.activity;
      c.startEvent('rain', c.now);
      const cloud = c.find('cloud');
      assert.ok(cloud && cloud.alpha === 0 && cloud.phase === 'enter', 'the cloud fades in from the side');
      let rained = false, reaction = null, hit = false;
      until(c, () => !c.has(cloud) && !c.inReaction, 40000, 'the shower passes', () => {
        if (c.drops.length) rained = true;
        if (c.inReaction && REACTIONS[c.inReaction].cat === 'env' && !reaction) reaction = c.inReaction;
        if (c.drops.some((d) => d.x > c.x && d.x < c.x + c.dw && d.y < c.height() + 3)) hit = true;
        inView(c);
      });
      assert.ok(rained, 'it rained');
      if (!setup) assert.ok(hit || reaction === 'rainEscape', 'onto the dinosaur');
      assert.ok(reaction && fits(reaction), `${activity}: ${reaction} — ${what}`);
      seen.add(reaction);
      assert.equal(c.drops.length, 0);
      assert.ok(c.find('puddle'), 'leaves a puddle');
      assert.equal(c.event, null, 'the event is over');
      if (activity === 'sleep') assert.equal(c.activity, before, 'still asleep afterwards');
    }
  }
  assert.ok(seen.size >= 4, `several different reactions to rain: ${[...seen]}`);
});

test('a palm tree grows from the ground, it goes over and settles in, and the tree withers away in its time', () => {
  const c = doing('palmTree', 44);
  const tree = c.find('palm');
  assert.ok(tree, 'a tree');
  const frames = [tree.frame];
  const dist0 = Math.abs(c.trunk(tree) - c.center());
  let closest = dist0;
  until(c, () => tree.frame === 3, 8000, 'grows to full height', () => { frames.push(tree.frame); });
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i] >= frames[i - 1], 'grows, never shrinks while growing');
  assert.deepEqual([...new Set(frames)], [...new Set(frames)].sort(), 'stage by stage');
  until(c, () => c.activity !== 'palmTree', 60000, 'the visit ends', () => { closest = Math.min(closest, Math.abs(c.trunk(tree) - c.center())); });
  assert.ok(closest < dist0 && closest < 30, `it went over to the tree (${dist0.toFixed(0)} → ${closest.toFixed(0)} px)`);
  // Later, the tree withers stage by stage and is gone.
  const left = tree.life - (c.now - tree.born);
  c.envNext = Infinity;
  const late = [];
  until(c, () => !c.has(tree), left + 5000, 'the tree goes', () => { if (c.has(tree)) late.push(tree.frame); inView(c); });
  assert.ok(late.includes(2) && late.includes(1) && late.includes(0), 'withers through every stage');
});

test('every environmental event runs its course from many situations, one at a time, never stuck', () => {
  const night = Date.parse('2026-10-21T23:30:00');
  const kinds = ['rain', 'wind', 'bird', 'tumbleweed', 'shootingStar'];
  const reacted = new Set();
  for (const kind of kinds) {
    for (const [activity, setup] of [['rest'], ['look'], ['walk'], ['sleep'], ['look', (c) => c.spawn('palm', { x: c.clampProp(c.center() - 70, 11), frame: 3, life: 1e9 })], ['look', (c) => c.wear('party', 60000)]]) for (let seed = 0; seed < 3; seed++) {
      const c = doing(activity, kind.length * 13 + activity.length + seed * 101, (d) => { d.clock = () => night; if (setup) setup(d); });
      c.startEvent(kind, c.now);
      assert.ok(c.event, `${kind} under way`);
      until(c, () => !c.event && !c.inReaction && !c.envDue, 60000, `${kind} from ${activity} ends`, () => {
        if (c.inReaction && REACTIONS[c.inReaction].cat === 'env') reacted.add(c.inReaction);
        inView(c);
        assert.ok(c.drops.length <= 160 && c.sparks.length <= 60 && c.streaks.length <= 60, 'effects bounded');
      });
      assert.ok(!c.props.some((p) => ['cloud', 'bird', 'tumbleweed'].includes(p.kind)), `${kind}: visitors gone`);
    }
  }
  const env = Object.keys(REACTIONS).filter((n) => REACTIONS[n].cat === 'env');
  const missing = env.filter((n) => !reacted.has(n));
  assert.ok(missing.length <= 2, `environment reactions seen: ${[...reacted]}; not seen: ${missing}`);
});

test('the environment surprises now and then: a few events an hour, never two at once', () => {
  const c = wide(808);
  const starts = [];
  const orig = c.startEvent.bind(c);
  c.startEvent = (kind, now) => { assert.equal(c.event, null, `${kind} while ${c.event?.kind} is still going`); starts.push({ kind, now }); return orig(kind, now); };
  const rng = seeded(4);
  run(c, 4 * 3600 * 1000, { dt: 150, each: (now) => { if (rng() < 0.002) c.wrote(3, now); inView(c); } });
  const perHour = starts.length / 4;
  assert.ok(perHour >= 4 && perHour <= 20, `${perHour} events an hour`);
  assert.ok(new Set(starts.map((s) => s.kind)).size >= 4, `variety: ${starts.map((s) => s.kind)}`);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].now - starts[i - 1].now >= 60000, 'spaced out');
});

// ---- growing with the writing streak ------------------------------------------------------------

test('each streak milestone makes it exactly one pixel taller, crisply, and it stays on its strip', () => {
  for (let g = 0; g <= 6; g++) {
    const c = wide(50 + g);
    c.setGrowth(g, false);
    assert.ok(Math.abs(H * c.du - (H * c.u + g)) < 1e-9, `+${g} px tall`);
    assert.ok(Math.abs(c.maxX - (c.stripW - W * (c.u + g / H))) < 1e-9, 'and its width grows in proportion');
  }
  const c = wide(60);
  c.envNext = Infinity;
  c.pending = 'look';
  run(c, 3000);
  c.setGrowth(1); // a milestone reached while writing
  assert.equal(c.g, 0, 'not instantly');
  let grewIn = null;
  run(c, 60000, { from: 3000, each: () => { if (grewIn == null && c.g === 1) grewIn = c.activity; } });
  assert.equal(grewIn, 'grow', 'with a proud stretch at its next natural moment');
  assert.equal(c.g, 1);
  c.setGrowth(0); // the streak ended
  run(c, 60000, { from: 63000 });
  assert.equal(c.g, 0, 'back to its first size');
});

test('special loops unlock at every second milestone, appear naturally, and stay out otherwise', () => {
  const freq = (unlocked) => {
    const c = make(70);
    c.setUnlocked(unlocked);
    const n = {};
    for (let i = 0; i < 20000; i++) { c.recent = []; c.energy = c.rng(); const a = c.pickActivity(1e9); n[a] = (n[a] || 0) + 1; }
    return n;
  };
  const none = freq(0);
  for (const s of SPECIALS) assert.ok(!none[s], `${s} locked`);
  for (let k = 1; k <= 3; k++) {
    const n = freq(k);
    SPECIALS.forEach((s, i) => {
      if (i < k) assert.ok(n[s] > 0 && n[s] / 20000 < 0.03, `${s} unlocked at ${k}, now and then (${n[s]})`);
      else assert.ok(!n[s], `${s} still locked at ${k}`);
    });
  }
});

test('its part in the weather follows what it was doing when the weather came', () => {
  const c = wide(90);
  const base = { activity: 'look', posture: 'stand', moving: false, asleep: false, near: {}, hat: null, tree: null, mood: 'content' };
  const dist = (kind, k) => { const n = {}; for (let i = 0; i < 2000; i++) { const r = c.envReaction(kind, { ...base, ...k }); n[r] = (n[r] || 0) + 1; } return n; };
  assert.deepEqual(Object.keys(dist('rain', { asleep: true, posture: 'lie', activity: 'sleep' })), ['rainSleep'], 'asleep: sleeps through it');
  assert.deepEqual(Object.keys(dist('rain', { tree: {} })), ['rainShelter'], 'a palm nearby: under it');
  assert.ok(dist('rain', { activity: 'walk', moving: true }).rainEscape > 600, 'on the move: makes a run for it');
  assert.ok(dist('rain', { hat: 'leaf' }).rainUmbrella > 700, 'a leaf on its head: an umbrella');
  assert.ok(dist('rain', { activity: 'dance' }).rainJig > 500, 'dancing: dances on in the rain');
  assert.ok(dist('rain', { activity: 'rest', posture: 'sit' }).rainTolerate > 700, 'sitting: sits it out');
  assert.deepEqual(Object.keys(dist('tumbleweed', { posture: 'sit' })), ['tumbleWatch'], 'sitting: watches it roll by');
  assert.deepEqual(Object.keys(dist('wind', { asleep: true, posture: 'lie' })), ['windHunker']);
});

// ---- 0.11: chin up, the theme's sunset and sunrise, more variety, more visitors ----------------

test('it lies on its front, chin up, to look at the sky — and does so while resting, sleeping, stargazing and stretching', () => {
  for (const f of ['lieUp', 'lieUpBlink', 'lieUpHowl', 'lieUpTail']) assert.equal(postureOf(f), 'lie', f);
  const top = (f) => FRAMES[f].findIndex((r) => r.includes('#'));
  assert.ok(top('lieUp') < top('lie') - 2, 'the head is raised above the lying body');
  const c = doing('daydream', 5);
  const { steps } = run(c, 30000, { from: c.now + 50, dt: 50 });
  assert.ok(steps.filter((s) => s.activity === 'daydream' && s.f.startsWith('lieUp')).length >= 4, 'daydreaming, chin up');
  const seen = new Set();
  for (let seed = 1; seed < 30 && seen.size < 4; seed++) {
    for (const a of ['rest', 'stargaze', 'sleep', 'stretch']) {
      const d = wide(seed * 7 + a.length);
      d.envNext = Infinity;
      d.pending = a;
      for (const s of run(d, 50000, { dt: 100 }).steps) if (s.activity === a && s.f.startsWith('lieUp')) seen.add(a);
    }
  }
  assert.deepEqual([...seen].sort(), ['rest', 'sleep', 'stargaze', 'stretch']);
});

test('the theme turning dark on its schedule: it watches the sun go down and the moon come up, then lies chin up under the stars', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const c = doing('look', 20 + seed);
    c.themeShift(true);
    until(c, () => c.activity === 'nightfall', 3000, 'stops what it was doing to watch');
    let sunSet = false, moonUp = false, stars = 0, chinUp = false;
    until(c, () => c.activity !== 'nightfall', 60000, 'nightfall ends', () => {
      const sun = c.find('sun');
      if (sun && sun.y < 3) sunSet = true;
      if ((c.find('moon')?.y ?? 0) > 15) moonUp = true;
      stars = Math.max(stars, c.sparks.filter((q) => !q.vx && !q.vy).length);
      if (c.frame.startsWith('lieUp')) chinUp = true;
      inView(c);
    });
    assert.ok(sunSet && moonUp && stars > 0 && chinUp, JSON.stringify({ sunSet, moonUp, stars, chinUp }));
    assert.ok(!c.find('sun'), 'the sun has gone');
  }
});

test('the theme turning light: the sun comes up and wakes it, and it greets the day', () => {
  const c = doing('sleep', 31);
  until(c, () => c.asleep(), 10000, 'falls asleep');
  c.themeShift(true); // nightfall while it sleeps: it sleeps on, the moon comes up all the same
  assert.equal(c.activity, 'sleep');
  assert.ok(c.find('moon'));
  run(c, 3000, { from: c.now + 50, dt: 50 });
  assert.ok(c.asleep(), 'still asleep');
  c.themeShift(false);
  until(c, () => c.activity === 'daybreak', 3000, 'the light wakes it');
  let sunUp = false, roar = false;
  until(c, () => c.activity !== 'daybreak', 60000, 'daybreak ends', () => {
    if ((c.find('sun')?.y ?? 0) > 15) sunUp = true;
    if (c.step.f === 'roar') roar = true;
    inView(c);
  });
  assert.ok(sunUp, 'the sun rose');
  assert.ok(roar, 'a good-morning roar');
  assert.ok(!c.find('moon'), 'the moon has gone');
  // In the middle of something it shouldn't drop, it finishes that first.
  const e = doing('egg', 32);
  e.themeShift(true);
  assert.equal(e.activity, 'egg');
  until(e, () => e.activity === 'nightfall', 60000, 'then watches the sunset');
});

test('the everyday activities come out a little different each time', () => {
  for (const a of ['rest', 'look', 'walk', 'sleep', 'dance', 'stretch']) {
    const shapes = new Set();
    for (let seed = 0; seed < 30; seed++) {
      const c = wide(seed * 31 + a.length);
      c.envNext = Infinity;
      c.pending = a;
      const own = [];
      for (const s of run(c, 60000, { dt: 100 }).steps) { if (s.activity !== a || s.reaction) { if (own.length) break; continue; } own.push(s); }
      shapes.add([...new Set(own.map((s) => s.f + (s.fx ? '+' + s.fx : '')))].sort().join());
    }
    assert.ok(shapes.size >= 4, `${a}: ${shapes.size} different shapes in 30 runs`);
  }
});

test('visitors now and then: a balloon, a paper plane, a frog, a ladybird, a dandelion, a worm — each comes, plays its part and goes', () => {
  const kinds = { balloon: ['balloon'], paperPlane: ['plane'], frog: ['frog'], ladybug: ['ladybug'], dandelion: ['dandelion', 'seed'], worm: ['worm'] };
  for (const [a, props] of Object.entries(kinds)) {
    for (let seed = 0; seed < 6; seed++) {
      const c = wide(seed * 17 + a.length);
      c.envNext = Infinity;
      c.pending = a;
      const seen = new Set();
      const look = () => { for (const p of c.props) seen.add(p.kind); if (c.hat) seen.add(c.hat.kind); inView(c); };
      run(c, 1000, { dt: 50, each: look });
      until(c, () => c.activity !== a, 60000, `${a} ends`, look);
      assert.ok(props.every((k) => seen.has(k)), `${a}: ${[...seen]}`);
      run(c, 70000, { from: c.now + 50, each: () => { c.pending = c.pending || 'look'; inView(c); } });
      assert.ok(!c.props.some((p) => props.includes(p.kind)), `${a}: gone afterwards (${c.props.map((p) => p.kind)})`);
    }
  }
  const c = make(5);
  const n = {};
  for (let i = 0; i < 40000; i++) { c.recent = []; c.lastEnv = {}; c.energy = c.rng(); const a = c.pickActivity(1e9); n[a] = (n[a] || 0) + 1; }
  for (const k of Object.keys(kinds)) assert.ok(n[k] > 0 && n[k] / 40000 < 0.02, `${k} turns up now and then (${n[k]})`);
});

test('theme changes at any moment — walking, mid-reaction, asleep, mid-sunset — are always seamless', () => {
  const c = wide(2027);
  const rng = seeded(7);
  let dark = false, shifts = 0;
  const seen = new Set();
  run(c, 2 * 3600 * 1000, {
    dt: 120,
    each: (now) => {
      if (rng() < 0.0005) { dark = !dark; shifts++; c.themeShift(dark); }
      if (rng() < 0.001) c.poke(now, c.center() + (rng() - 0.5) * 20, 8);
      if (rng() < 0.002) c.wrote(2, now);
      seen.add(c.activity);
      inView(c);
    },
  });
  assert.ok(shifts > 10, `${shifts} theme changes`);
  assert.ok(seen.has('nightfall') && seen.has('daybreak'));
  assert.ok(c.props.filter((p) => p.kind === 'sun' || p.kind === 'moon').length <= 2, 'never a sky full of suns');
});
