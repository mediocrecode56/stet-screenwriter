// The dinosaur's pixel art and behaviour engine, simulated headlessly: every
// activity and reaction, hours of use with writing bursts, idle spells, clicks
// and the cursor, and the rules that keep it seamless (reactions only between
// steps, no impossible jumps between postures, bounded queue and props).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Critter, _test } from '../src/renderer/dino.js';

const { FRAMES, PROPS, GLYPHS, W, H, ACTIVITIES, REACTIONS, postureOf } = _test;

function seeded(seed) { // mulberry32
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function make(seed = 1, opts = {}) {
  const progress = { today: 0, goal: 1000 };
  const c = new Critter({ rng: seeded(seed), unit: () => 1.25, width: () => 170, progress: () => progress, clock: () => opts.clock ?? Date.parse('2026-10-21T15:00:00'), ...opts });
  c.progress = progress;
  return c;
}

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
        if (a === 'sit' && b === 'stand') assert.ok(['crouch', 'sniff'].includes(s.f) || s.f === 'stand' && prev.f === 'crouch', `sit (${prev.f}) → ${s.f} without getting up [${c.activity}/${c.inReaction}]`);
        if (!prev.free) assert.ok(prev.x1 >= -0.01 && prev.x1 <= c.maxX + 0.01, `stays on the strip: ${prev.x1} [${c.activity}]`);
      }
      assert.ok(FRAMES[s.f], `frame ${s.f}`);
      assert.ok(s.t > 0 && s.t <= 1500, `step ${s.f} ${s.t} ms is short enough to blend a reaction in`);
      if (s.fx) assert.ok(GLYPHS[s.fx], `glyph ${s.fx}`);
      steps.push({ ...s, activity: c.activity, reaction: c.inReaction });
      prev = s;
    }
    assert.ok(c.queue.length <= 2, 'at most two reactions queued');
    assert.ok(c.props.length <= 5, `props bounded (${c.props.map((p) => p.kind)})`);
    assert.ok(c.x > -W * 1.25 - 6 && c.x < c.stripW + 6, 'never wanders far off');
  }
  return { steps, now };
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
      assert.ok(rows.every((r) => r.length === rows[0].length && /^[#.o]+$/.test(r)), name);
      assert.ok(rows.join('').includes('#'), name);
    }
  }
});

test('every activity plays through, at any energy, from any posture', () => {
  for (const name of Object.keys(ACTIVITIES)) {
    for (const [energy, frame] of [[0, 'sit'], [0.5, 'stand'], [1, 'lie']]) {
      const c = make(name.length * 7 + energy * 10);
      c.frame = frame;
      c.energy = energy;
      c.heat = energy * 40;
      c.pending = name;
      const { steps } = run(c, 120000, { each: () => { c.energy = energy; } });
      const own = steps.filter((s) => s.activity === name);
      assert.ok(own.length >= 3, `${name} ran`);
      const total = own.reduce((n, s) => n + s.t, 0);
      assert.ok(total >= 1000, `${name} lasts a while (${total} ms)`);
      assert.ok(steps.some((s) => s.activity !== name), `${name} finishes`);
      assert.ok(c.onstage() || c.activity === 'peekaboo', `${name} comes back on stage`);
    }
  }
});

test('every reaction blends in and hands back to the activity, from standing, sitting and sleeping', () => {
  for (const name of Object.keys(REACTIONS)) {
    for (const start of ['look', 'rest', 'sleep']) {
      const c = make(name.length + start.length);
      c.pending = start;
      c.cursorAt(150, 10, 0);
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

test('hours of use: writing bursts, idle spells, click storms and the cursor — always seamless', () => {
  const c = make(2026);
  const rng = seeded(99);
  let writingUntil = 0, nextBurst = 0;
  const seenReactions = new Set(), seenActivities = new Set();
  const { steps } = run(c, 4 * 3600 * 1000, {
    dt: 120,
    each: (now) => {
      if (now > nextBurst) { writingUntil = now + (rng() < 0.5 ? 5 : 20) * 60000; nextBurst = writingUntil + rng() * 40 * 60000; }
      if (now < writingUntil && rng() < 0.03) { c.wrote(1, now); c.progress.today++; }
      if (rng() < 0.0009) { const n = rng() < 0.2 ? 6 + Math.floor(rng() * 8) : 1; for (let i = 0; i < n; i++) c.poke(now + i * 50); }
      if (rng() < 0.02) c.cursorAt(rng() * 200 - 20, rng() * 60 - 10, now);
      if (c.inReaction) seenReactions.add(c.inReaction);
      seenActivities.add(c.activity);
    },
  });
  assert.ok(steps.length > 20000);
  assert.ok(seenActivities.size >= 18, `activities seen: ${[...seenActivities]}`);
  assert.ok(seenReactions.size >= 15, `reactions seen: ${[...seenReactions]}`);
});

test('clicks: large, unpredictable variety that holds up over a long session', () => {
  const c = make(7);
  c.cursorAt(100, 10, 0);
  c.pending = 'look';
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
  assert.ok(distinct >= 25, `distinct reactions: ${distinct}`);
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
  run(c, 1500);
  const stepBefore = c.step;
  for (let i = 0; i < 14; i++) c.poke(1500 + i * 90);
  assert.ok(c.queue.length <= 2);
  assert.equal(c.step, stepBefore, 'the current step is untouched');
  assert.ok(c.history.some((n) => ['annoyed', 'dizzy', 'storm', 'runAway', 'playDead'].includes(n)), `escalated: ${c.history}`);
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
  const lively = (m) => ['walk', 'hop', 'dance', 'fetch', 'juggle'].reduce((s, k) => s + (m[k] || 0), 0);
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

test('a nearby cursor gets a casual glance without adding or interrupting steps', () => {
  const c = make(21);
  c.pending = 'rest';
  run(c, 3000);
  c.face = 1;
  const before = c.gen;
  let turned = false;
  run(c, 6000, { from: 3000, each: (now) => { c.cursorAt(-30, 5, now); if (c.face === -1) turned = true; } });
  assert.ok(turned, 'turned toward the cursor');
  assert.equal(c.gen, before, 'still the same rest');
  assert.equal(c.activity, 'rest');
  assert.equal(c.inReaction, null, 'not a reaction');
});

test('props are cleaned up after themselves', () => {
  const c = make(31);
  c.pending = 'fetch';
  run(c, 30000);
  run(c, 120000, { from: 30000, each: () => { c.pending = c.pending || 'look'; } });
  assert.ok(c.props.length <= 1, `left over: ${c.props.map((p) => p.kind)}`);
});
