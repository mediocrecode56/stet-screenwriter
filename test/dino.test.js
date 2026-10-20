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
        if (!c.resized) assert.ok(prev.x1 >= -0.01 && prev.x1 <= c.maxX + 0.01, `stays on the strip: ${prev.x1} [${c.activity}]`);
        // Responsiveness never speeds anything up: moves, jumps and lifts always run their full length.
        if (prev.dx || prev.jump || prev.lift) assert.ok(Math.abs(prev.end - prev.start - prev.t) < 1e-6, `${prev.f} ran its full ${prev.t} ms`);
      }
      assert.ok(FRAMES[s.f], `frame ${s.f}`);
      assert.ok(s.t > 0 && s.t <= 1500, `step ${s.f} ${s.t} ms is short enough to blend a reaction in`);
      if (s.fx) assert.ok(GLYPHS[s.fx], `glyph ${s.fx}`);
      steps.push({ ...s, activity: c.activity, reaction: c.inReaction });
      prev = s;
    }
    assert.ok(c.queue.length <= 2, 'at most two reactions queued');
    assert.ok(c.props.length <= 5, `props bounded (${c.props.map((p) => p.kind)})`);
    if (!c.resized) assert.ok(c.x > -W * 1.25 - 6 && c.x < c.stripW + 6, 'never wanders far off');
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

/** Dimensions in the app: a 560 px strip at 1.25 px per sprite pixel, 24 px margins, 24 rows of headroom. */
function wide(seed) { return make(seed, { width: () => 560, margin: () => 24 }); }

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
      for (const p of c.props) {
        if (p.carried || p.balance) continue;
        const w = PROPS[p.kind][0][0].length * c.u, h = PROPS[p.kind][0].length;
        assert.ok(p.x >= -c.margin - 0.5 && p.x + w <= c.stripW + c.margin + 0.5, `${p.kind} stays in view (x=${p.x.toFixed(1)})`);
        assert.ok(p.y + h <= H + 24, `${p.kind} stays below the top (y=${p.y.toFixed(1)})`);
      }
      assert.ok(c.onstage(), `the dinosaur never leaves the play area [${c.activity}/${c.inReaction}]`);
    },
  });
  assert.ok(outer / n < 0.12, `rarely at the ends (${(100 * outer / n).toFixed(1)} %)`);
  assert.ok(middle / n > 0.45, `mostly in the middle stretch (${(100 * middle / n).toFixed(1)} %)`);
  assert.ok(outer > 0, 'but it does go there now and then');
});

test('clicks are acknowledged on the spot; a held pose gives way at once, a move always finishes first', () => {
  const c = wide(12);
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

test('the cursor is noticed at once: a held pose turns towards it, a move finishes first, and nothing else changes', () => {
  const c = wide(21);
  c.pending = 'rest';
  run(c, 4000, { dt: 10 });
  c.face = 1;
  const gen = c.gen;
  let turnedAt = null;
  c.cursorAt(c.center() - 50, 8, 4000);
  run(c, 600, { from: 4000, dt: 10, each: (now) => { c.cursorAt(c.center() - 50, 8, now); if (turnedAt == null && c.face === -1) turnedAt = now; } });
  assert.ok(turnedAt != null && turnedAt - 4000 <= 140, `turned towards the cursor after ${turnedAt - 4000} ms`);
  assert.equal(c.gen, gen, 'still the same rest, not restarted');
  assert.equal(c.activity, 'rest');
  assert.equal(c.inReaction, null, 'a glance, not a reaction');
  // Crossing to the other side gets another glance; staying put does not keep it turning.
  let turns = 0, last = c.face;
  run(c, 3000, { from: 4600, dt: 10, each: (now) => { c.cursorAt(c.center() + 50, 8, now); if (c.face !== last) { turns++; last = c.face; } } });
  assert.equal(turns, 1, 'turned back once');
});

test('when the play area shrinks under it, it walks back in — no jump, nothing cut', () => {
  let width = 560;
  const c = make(77, { width: () => width, margin: () => 24 });
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
