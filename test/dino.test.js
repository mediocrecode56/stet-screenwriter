// The dinosaur's pixel art and behaviour engine, simulated headlessly: every
// activity and reaction, hours of use with writing bursts, idle spells and
// clicks, reactions that follow what it was doing, the environment (rain,
// wind, a bird, a tumbleweed, a shooting star, plants coming up…), the whole-width
// playground with its home around TODAY, walking (never sliding), growing with the
// writing streak, and the rules that keep it seamless (reactions only between
// steps, no impossible jumps between postures, bounded queue and props,
// everything in view).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Critter, _test } from '../src/renderer/dino.js';
import { FACE, HEADS, spriteEdges } from '../src/renderer/dino-art.js';

const { FRAMES, PROPS, GLYPHS, W, H, ACTIVITIES, REACTIONS, SPECIALS, GET_UP, BASELINE_0_8, EVENTS, postureOf } = _test;
const GROW_FULL = { cactus: 2, grass: 2, palm: 3 };
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
      assert.ok(s.t > 0 && (s.t <= 1500 || (s.dormant && s.f === 'lie')), `step ${s.f} ${s.t} ms is short enough to blend a reaction in [${c.activity}/${c.inReaction}]`); // (lying still while dormant: focus ends it)
      if (s.fx) assert.ok(GLYPHS[s.fx], `glyph ${s.fx}`);
      steps.push({ ...s, activity: c.activity, reaction: c.inReaction });
      prev = s;
    }
    assert.ok(c.queue.length <= 2, 'at most two reactions queued');
    assert.ok(c.loose <= 8 && c.tufts().length <= c.T.tuftsMax, `props bounded (${c.props.map((p) => p.kind)})`); // (tufts grown in the background have their own cap)
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

/** The head window of a frame (rows top-down as the head is drawn), from each row's head outline on. */
function headOf(name) {
  const { top, left, upsideDown } = FACE[name];
  const rows = FRAMES[name].slice(top, top + 5).map((r) => r.slice(left).padEnd(18 - 10, '.'));
  return upsideDown ? rows.reverse() : rows;
}
const closedEyes = (rows) => rows.map((r) => r.replace('o', '#'));

test('the face: every frame has one of its head drawings, whole — nothing of the body shows through it', () => {
  const heads = Object.entries(HEADS).map(([k, rows]) => [k, rows.map((r) => r.slice(10))]);
  for (const name of Object.keys(FRAMES)) {
    const got = headOf(name);
    // Each row from the head's own outline on must be exactly that head (the eye open or shut).
    const match = heads.find(([, h]) => h.every((r, i) => {
      const from = r.search(/[^.]/);
      return closedEyes([got[i].slice(from)])[0] === closedEyes([r.slice(from)])[0] && (!got[i].includes('o') || got[i].indexOf('o') === r.indexOf('o'));
    }));
    assert.ok(match, `${name}: the head is a HEAD drawing: ${got.join(' ')}`);
    // An eye, open or shut, exactly where the head has it; and the open mouth stays open.
    const eyeRow = FACE[name].upsideDown ? 3 : 1;
    assert.ok(/#/.test(got[eyeRow]), name);
    if (match[0] === 'roar' || match[0] === 'howl') assert.ok(got[3].endsWith('...'), `${name}: the mouth is open`);
  }
  // The frames whose heads used to be cut or filled in: now whole.
  for (const name of ['sniff', 'creep1', 'chomp', 'gnaw', 'lie', 'lieBreath', 'fallen']) assert.ok(headOf(name).join('').length === 40, name);
  assert.equal(headOf('chomp')[3], '###.....', 'chomp: jaws apart');
  assert.equal(headOf('sniff')[3], '####....', 'sniffing: mouth line kept');
  assert.equal(headOf('lie')[4], '######..', 'lying: the jaw whole');
});

test('the face keeps its exact shape on screen: either way round, upside down, at every size the streak gives it', () => {
  // Rasterise as Dino.draw does and compare the head's pixels.
  const raster = (name, cell, mirror, upsideDown) => {
    const e = spriteEdges(name, cell), sw = e.cols[W], sh = e.rows[H];
    const px = Array.from({ length: sh }, () => Array(sw).fill(0));
    FRAMES[name].forEach((row, r) => {
      const y0 = upsideDown ? sh - e.rows[r + 1] : e.rows[r], y1 = y0 + e.rows[r + 1] - e.rows[r];
      for (let i = 0; i < W; i++) {
        if (row[i] !== '#') continue;
        const x0 = mirror ? sw - e.cols[i + 1] : e.cols[i], x1 = x0 + e.cols[i + 1] - e.cols[i];
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[y][x] = 1;
      }
    });
    // The head's box, read back in sprite orientation.
    const { top, left } = FACE[name];
    const out = [];
    for (let y = e.rows[top]; y < e.rows[top + 5]; y++) {
      let line = '';
      for (let x = e.cols[left]; x < sw; x++) line += px[upsideDown ? sh - 1 - y : y][mirror ? sw - 1 - x : x] ? '#' : '.';
      out.push(line);
    }
    return { out, total: [sw, sh] };
  };
  for (const unit of [1, 2, 3]) {
    for (let g = 0; g <= 6; g++) {
      for (const dpr of [1, 1.25, 1.5]) {
        const cell = unit + (g * dpr) / H;
        const k = Math.max(1, Math.round(cell));
        for (const name of ['stand', 'sit', 'sniff', 'lie', 'stretch', 'chomp']) {
          const a = raster(name, cell, false, false);
          assert.deepEqual(a.total, [Math.round(W * cell), Math.round(H * cell)], 'its size still grows a device px at a time');
          assert.deepEqual(raster(name, cell, true, false).out, a.out, `${name} @${cell.toFixed(3)}: the same face facing left`);
          assert.deepEqual(raster(name, cell, false, true).out, a.out, `${name} @${cell.toFixed(3)}: the same face upside down`);
          const e = spriteEdges(name, cell);
          for (let i = FACE[name].left; i < W; i++) assert.equal(e.cols[i + 1] - e.cols[i], k, 'head columns all the same size');
          for (let r = FACE[name].top; r < FACE[name].top + 5; r++) assert.equal(e.rows[r + 1] - e.rows[r], k, 'head rows all the same size');
          for (let i = 0; i < W; i++) assert.ok(Math.abs(e.cols[i + 1] - e.cols[i] - cell) < 1.5, 'the rest within a device px or so of the true size');
        }
        // The same head drawing gives the same pixels in every frame that has it.
        assert.deepEqual(raster('sniff', cell, true, false).out, raster('stand', cell, false, false).out, 'sniffing: the standing face');
        assert.deepEqual(raster('lie', cell, false, false).out, raster('stand', cell, false, false).out, 'lying: the standing face');
      }
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
  const kinds = ['rain', 'wind', 'bird', 'tumbleweed', 'shootingStar', 'sprout'];
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
  // (Noticing a plant comes after the sprout event is over, and waking from a deep sleep belongs to the window's focus: both tested on their own.)
  const env = Object.keys(REACTIONS).filter((n) => REACTIONS[n].cat === 'env' && n !== 'plantNotice' && n !== 'deepWake');
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
  assert.ok(top('lieUp') <= top('lie') - 2, 'the head is raised above the lying body');
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

test('rare surprises (an egg, a UFO) stay rare, but never go missing for long', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const c = wide(500 + seed);
    const rng = seeded(seed);
    let last = '', rare = 0;
    run(c, 4 * 3600 * 1000, {
      dt: 150,
      each: (now) => {
        if (rng() < 0.01) c.wrote(1, now);
        if (c.activity !== last) { last = c.activity; if (last === 'egg' || last === 'ufo') rare++; }
      },
    });
    assert.ok(rare >= 1 && rare <= 12, `seed ${seed}: ${rare} rare surprises in 4 hours`);
  }
});

// ---- 0.13: the whole width, walking not sliding, restrained weather, plants that come and go ----

/** The app's playground at 1280 px: the editor's whole width, its home stretch around TODAY, the window's corner at its left end. */
function world(seed, opts = {}) { return make(seed, { width: () => 1270, margin: () => 24, home: () => ({ lo: 450, hi: 1010 }), corner: () => true, ...opts }); }
const STEPPING = /^(walk|run|creep)/;
/** Every move along the ground is a step of the legs, taken with the frame and held (never glided), no longer than they reach. */
function walksNotSlides(c) {
  const s = c.step;
  if (!s || !s.ground) return;
  const wiggle = Math.abs(s.dx) <= 1 && (s.f === 'crouch' || s.f === 'cower'); // a wiggle on the spot before a pounce, a shiver
  const roll = s.f === 'fallen' || s.f === 'lie';                               // rolling over and over
  assert.ok(STEPPING.test(s.f) || wiggle || roll, `${s.f} moves ${s.dx.toFixed(1)} px on the ground without stepping [${c.activity}/${c.inReaction}]`);
  assert.equal(c.x, s.x1, `the stride is taken with the frame, not glided through [${s.f} in ${c.activity}]`);
  if (STEPPING.test(s.f)) assert.ok(Math.abs(s.x1 - s.x0) <= 3 * c.du + 1e-9, `a stride its legs can reach: ${(s.x1 - s.x0).toFixed(2)} px [${c.activity}]`);
}

test('it walks whenever it moves: every move along the ground is a stride of its legs, never a slide', () => {
  for (const seed of [31, 32]) {
    const c = world(seed);
    const rng = seeded(seed);
    let walked = 0;
    run(c, 2 * 3600 * 1000, { dt: 40, each: (now) => {
      if (rng() < 0.004) c.wrote(4, now);
      if (rng() < 0.0002) c.poke(now);
      if (c.step) { walksNotSlides(c); if (c.step.ground && STEPPING.test(c.step.f)) walked++; }
    } });
    assert.ok(walked > 1000, `it did walk (${walked} frames)`);
  }
  // Legs that can't go anywhere (at the very end of the strip) stand still instead of walking on the spot.
  const c = world(5);
  c.envNext = Infinity; c.x = 0; c.activity = 'test';
  c.gen = (function* () { for (let i = 0; i < 40; i++) yield { f: i % 2 ? 'walk2' : 'walk1', t: 200, dx: -3 }; })();
  run(c, 400, { dt: 20 });
  assert.equal(c.step.f, 'stand');
});

test('home is around TODAY: nearly all its time is spent there, with curious excursions now and then', () => {
  let away = 0, n = 0, explored = 0;
  for (const seed of [41, 42, 43]) {
    const c = world(seed);
    const rng = seeded(seed);
    let last = '';
    run(c, 4 * 3600 * 1000, { dt: 150, each: (now) => {
      if (rng() < 0.003) c.wrote(4, now);
      n++; if (c.away()) away++;
      if (c.activity !== last) { last = c.activity; if (last === 'explore') explored++; }
      inView(c);
      assert.ok(c.onstage(), 'always on the playground');
    } });
  }
  assert.ok(away / n < 0.12, `mostly at home (${(100 * away / n).toFixed(1)} % away)`);
  assert.ok(away > 0 && explored >= 3, `but it does go exploring (${explored} excursions, ${(100 * away / n).toFixed(1)} % away)`);
});

test('very rarely it walks all the way to the bottom-left corner and has a bite at the border', () => {
  // On its own: rare (never twice within 40 minutes), but it does happen.
  let bites = 0, hours = 0;
  for (const seed of [51, 52, 53, 54]) {
    const c = world(seed);
    const times = [];
    let last = '';
    run(c, 6 * 3600 * 1000, { dt: 200, each: () => { if (c.activity !== last) { last = c.activity; if (last === 'cornerBite') times.push(c.now); } } });
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] > 40 * 60000, 'never twice in 40 minutes');
    bites += times.length; hours += 6;
  }
  assert.ok(bites >= 1 && bites / hours <= 0.5, `${bites} corner bites in ${hours} hours`);
  // The excursion itself: it walks the whole way (no jumps, no teleport), bites facing the corner, and comes home.
  const c = world(7);
  c.envNext = Infinity;
  c.x = c.zone(0.5);
  c.pending = 'cornerBite';
  let prev = c.x, maxMove = 0, bitAt = null, minX = Infinity, done = false;
  run(c, 4 * 60000, { dt: 40, each: () => {
    if (done) return;
    walksNotSlides(c);
    maxMove = Math.max(maxMove, Math.abs(c.x - prev)); prev = c.x;
    minX = Math.min(minX, c.x);
    if (c.frame === 'gnaw' && bitAt == null) bitAt = { x: c.x, face: c.face };
    if (bitAt && c.activity !== 'cornerBite') done = true;
  } });
  assert.ok(done, 'the excursion ends');
  assert.ok(maxMove <= 3 * c.du + 1e-9, `walked all the way (largest move ${maxMove.toFixed(2)} px)`);
  assert.deepEqual(bitAt, { x: 0, face: -1 }, 'bites at the very corner, facing it');
  assert.equal(minX, 0);
  assert.ok(c.x > c.zone(0) - 1, 'and walked home again');
  // Never where the strip's left end is not the window's corner (a side panel open there).
  const p = world(8, { corner: () => false });
  p.now = 3 * 3600e3;
  for (let i = 0; i < 4000; i++) assert.notEqual(p.pickActivity(3 * 3600e3), 'cornerBite');
});

test('a gentle breeze: a gust or two at a time, not a gale; and only a few things float about at once', () => {
  const c = doing('look', 61);
  c.startEvent('wind', c.now);
  let most = 0, leaves = 0;
  until(c, () => !c.event && !c.envDue && !c.inReaction, 30000, 'the breeze passes', () => { most = Math.max(most, c.streaks.length); leaves = Math.max(leaves, c.props.filter((p) => p.kind === 'leaf').length); });
  assert.ok(most >= 1 && most <= 2, `${most} gusts at most`);
  assert.ok(leaves <= 1, 'one leaf at most');
  for (const seed of [62, 63]) {
    const w = world(seed, { clock: () => Date.parse('2026-10-21T22:30:00') });
    const rng = seeded(seed);
    let peak = 0;
    run(w, 3 * 3600 * 1000, { dt: 150, each: (now) => { if (rng() < 0.004) w.wrote(4, now); peak = Math.max(peak, w.floating()); assert.ok(w.streaks.length <= 2, 'never more than two gusts'); } });
    assert.ok(peak <= 4, `at most ${peak} things floating at once`);
  }
});

test('plants come up on their own: one at a time, it notices in its own time, sometimes goes to see, and they wither away', () => {
  const kinds = new Set();
  let visits = 0, plants = 0;
  for (let seed = 0; seed < 16; seed++) {
    const c = doing('look', 70 + seed, (d) => { d.widthOf = () => 1270; d.homeOf = () => ({ lo: 450, hi: 1010 }); d.x = 700; });
    c.startEvent('sprout', c.now);
    const p = c.props.find((q) => q.wild);
    if (!p) continue;
    plants++; kinds.add(p.kind);
    assert.equal(p.frame, 0, 'starts as a sprout');
    assert.ok(p.x >= 0 && p.x + c.propW(p) <= c.stripW, 'on the playground');
    assert.ok(Math.abs(c.propCenter(p) - c.center()) > c.dw / 2, 'not under its feet');
    assert.equal(EVENTS.sprout.ok(c), false, 'no second plant while this one is up');
    const born = c.now;
    let noticedAt = null, visitedAt = null, closest = Infinity, maxFrame = 0;
    until(c, () => !c.has(p), p.life + 10000, 'the plant withers away', () => {
      if (c.inReaction === 'plantNotice' && noticedAt == null) noticedAt = c.now;
      if (c.activity === 'visitPlant' && visitedAt == null) visitedAt = c.now;
      if (c.has(p)) { maxFrame = Math.max(maxFrame, p.frame); if (c.activity === 'visitPlant') closest = Math.min(closest, c.gap(p)); }
      walksNotSlides(c);
      inView(c);
    });
    assert.equal(maxFrame, GROW_FULL[p.kind], `${p.kind} grew to full size`);
    assert.ok(noticedAt != null && noticedAt - born >= 3000, `noticed, but not at once (${noticedAt && noticedAt - born} ms)`);
    if (visitedAt != null) { visits++; assert.ok(visitedAt > noticedAt, 'visited after noticing'); assert.ok(closest < 8, `went right up to it (${closest.toFixed(1)} px)`); }
  }
  assert.ok(plants >= 12, `${plants} plants came up`);
  assert.deepEqual([...kinds].sort(), ['cactus', 'grass', 'palm'], 'cacti, grass and palms');
  assert.ok(visits >= 3 && visits < plants, `it went to see ${visits} of ${plants} — some, not all`);
  // What it does there depends on the plant.
  for (const [kind, frames] of [['cactus', ['cower', 'sitUp', 'hunch']], ['grass', ['chomp', 'lieUp', 'wag']]]) {
    const seen = new Set();
    for (let seed = 0; seed < 12; seed++) {
      const c = doing('look', 90 + seed);
      const p = c.spawn(kind, { x: c.clampProp(c.center() + 60, 7), grows: true, wild: true, life: 120000, noticed: c.now, visitAt: c.now, noticeAt: c.now });
      c.pending = 'visitPlant'; c.gen = null;
      let chomped = false;
      until(c, () => c.recent.includes('visitPlant') && c.activity !== 'visitPlant', 60000, `${kind} visit`, () => { if (c.activity === 'visitPlant') { seen.add(c.frame); if (c.frame === 'chomp') chomped = true; } walksNotSlides(c); });
      assert.equal(p.visited, true);
      if (chomped) assert.equal(p.cut, 1, 'a bite out of the grass');
    }
    assert.ok(frames.filter((f) => seen.has(f)).length >= 2, `${kind}: different visits (${frames.filter((f) => seen.has(f))})`);
  }
});

// ---- 0.14: the window in the background, deep sleep, large plants, four new routines ----

const MINUTE = 60000;
/** Writing now and then (about every `every` ms on average) while it runs. */
const writer = (c, rng, every = 4000, dt = 100) => () => { if (rng() < dt / every) c.wrote(3, c.now); };

test('in the background, tufts of grass come up slowly and only so many — on the clock, not on frames', () => {
  // A window that is hardly ticking at all (throttled, or hidden): one tick an hour later still finds every tuft that was due.
  const a = world(201);
  run(a, 30000, { dt: 100 });
  a.setFocus(false, a.now);
  const t0 = a.now;
  a.advance(t0 + 60 * MINUTE);
  const tufts = a.tufts().sort((p, q) => p.born - q.born);
  assert.equal(tufts.length, a.T.tuftsMax, `${tufts.length} tufts after an hour away, at most ${a.T.tuftsMax}`);
  assert.ok(tufts[0].born - t0 >= a.T.tuftFirst[0] && tufts[0].born - t0 <= a.T.tuftFirst[1], 'the first one not at once');
  for (let i = 1; i < tufts.length; i++) assert.ok(tufts[i].born - tufts[i - 1].born >= a.T.tuftEvery[0], 'one at a time, minutes apart');
  for (const p of tufts) { assert.equal(p.kind, 'grass'); assert.ok(p.x >= 0 && p.x + a.propW(p) <= a.stripW, 'on the playground'); }
  a.advance(t0 + 61 * MINUTE);
  assert.ok(tufts.every((p) => p.frame === GROW_FULL.grass || a.now - p.born < 2 * a.T.tuftGrow), 'grown as much as their age says');
  a.advance(t0 + 300 * MINUTE);
  assert.equal(a.tufts().length, a.T.tuftsMax, 'and never more, however long');
  // Ticking all the while: the same pace, and it never eats or touches them while the window is in the background.
  for (const seed of [202, 203]) {
    const c = world(seed);
    const rng = seeded(seed);
    run(c, 60000, { dt: 100, each: writer(c, rng) });
    c.setFocus(false, c.now);
    const from = c.now, seen = new Map();
    let at10 = null;
    run(c, 45 * MINUTE, { from: c.now, dt: 200, each: (now) => {
      for (const [p, f] of seen) { assert.ok(c.has(p), 'never eaten while away'); assert.ok(p.frame >= f, 'never nibbled while away'); }
      for (const p of c.tufts()) seen.set(p, p.frame);
      assert.notEqual(c.activity, 'graze');
      if (c.activity === 'visitPlant') assert.ok(!['chomp'].includes(c.frame) || c.step?.f !== 'chomp' || !c.plantToVisit(), 'no nibbling');
      if (at10 == null && now - from >= 10 * MINUTE) at10 = c.tufts().length;
    } });
    assert.ok(at10 <= 3, `slowly: ${at10} after ten minutes`);
    assert.ok(c.tufts().length >= 4 && c.tufts().length <= c.T.tuftsMax, `${c.tufts().length} after 45 minutes`);
  }
});

test('back at the window, it eats the grass only once writing resumes — progressively, a bite at a time', () => {
  for (const seed of [211, 212, 213]) {
    const c = world(seed);
    const rng = seeded(seed);
    c.setFocus(false, 0);
    run(c, 40 * MINUTE, { dt: 250 });
    const grass = c.tufts();
    assert.ok(grass.length >= 3, `${grass.length} tufts grew`);
    c.setFocus(true, c.now);
    // Back, but not writing yet (reading, thinking): the grass stays.
    run(c, 3 * MINUTE, { from: c.now, dt: 100 });
    assert.equal(c.tufts().length, grass.length, 'nothing eaten before writing resumes');
    assert.ok(grass.every((p) => p.frame === GROW_FULL.grass), 'not a bite');
    // Writing again: it gets round to them in its own time, a bite at a time.
    const lastFrame = new Map(), eatenAt = [];
    let bites = 0;
    run(c, 40 * MINUTE, { from: c.now, dt: 100, each: (now) => {
      writer(c, rng)();
      for (const p of grass) {
        if (!lastFrame.has(p) || !c.has(p)) continue;
        if (p.frame < lastFrame.get(p)) { bites++; assert.equal(c.activity, 'graze', 'only when grazing'); }
      }
      for (const p of grass) if (lastFrame.has(p) && !c.has(p) && !eatenAt.some((e) => e.p === p)) { assert.equal(lastFrame.get(p), 0, 'the last bite takes the last of it'); eatenAt.push({ p, at: now }); }
      for (const p of grass) if (c.has(p)) lastFrame.set(p, p.frame);
      walksNotSlides(c);
    } });
    assert.ok(eatenAt.length >= Math.min(3, grass.length), `ate ${eatenAt.length} of ${grass.length}`);
    assert.ok(bites >= eatenAt.length * 2, 'bite by bite');
    assert.ok(eatenAt[eatenAt.length - 1].at - eatenAt[0].at > MINUTE, 'not all at once');
  }
});

test('a long while in the background: it settles into a deep sleep, sleeps on quietly, and wakes gently when you are back', () => {
  for (const seed of [221, 222]) {
    const c = world(seed);
    run(c, 60000, { dt: 100 });
    c.setFocus(false, c.now);
    const away = c.now;
    run(c, 11 * MINUTE, { from: c.now, dt: 100 });
    assert.ok(!c.deep, 'not yet');
    until(c, () => c.deep && c.asleep(), 8 * MINUTE, 'falls into a deep sleep (after what it was doing)');
    assert.ok(c.now - away >= c.T.deepSleep);
    // Asleep for good while the window stays in the background, and little to do: no events, few ticks.
    let ticks = 0, now = c.now;
    const end = now + 40 * MINUTE;
    while (now < end) {
      const moving = c.advance(now);
      assert.ok(c.asleep() && c.deep, `sleeps on [${c.activity}/${c.frame}]`);
      assert.equal(c.event, null, 'nothing happens around it');
      ticks++;
      now += c.tickDelay(now, moving); // as Dino.tick schedules
    }
    assert.ok(ticks < 40 * 2 + 30, `${ticks} ticks in 40 minutes (dormant: a couple a minute)`);
    assert.ok(c.tufts().length >= 3, 'the grass grew meanwhile');
    const grass = c.tufts().length, x = c.x;
    // Back for a moment and away again before it wakes: it sleeps on (no wake left over for later).
    c.setFocus(true, c.now);
    c.setFocus(true, c.now); // focus events can come twice
    run(c, 500, { from: c.now, dt: 50 });
    c.setFocus(false, c.now);
    run(c, 20000, { from: c.now, dt: 50, each: () => assert.notEqual(c.inReaction, 'deepWake') });
    assert.ok(c.deep && c.asleep());
    // Back for good: it comes round slowly, where it lay.
    c.setFocus(true, c.now);
    const frames = [];
    until(c, () => c.inReaction === 'deepWake', 5000, 'starts to wake');
    until(c, () => c.inReaction !== 'deepWake', 20000, 'wakes up', () => { frames.push(c.frame); assert.ok(Math.abs(c.x - x) < 0.01, 'no teleport'); });
    for (const f of ['lieUp', 'lieUpHowl', 'sitChew', 'stretch']) assert.ok(frames.includes(f), `wakes with ${f}`);
    assert.ok(!c.deep);
    run(c, 30000, { from: c.now, dt: 100 });
    assert.ok(c.activity !== 'sleep' || !c.deep, 'back to its day');
    assert.equal(c.tufts().length, grass, 'the grass is still there for later');
  }
  // Hidden all that time (no ticks at all): found asleep when you come back, then wakes the same gentle way.
  const h = world(223);
  run(h, 30000, { dt: 100 });
  h.setFocus(false, h.now);
  h.advance(h.now + 30 * MINUTE);
  assert.ok(h.deep && h.asleep(), 'asleep');
  h.setFocus(true, h.now + 1000);
  until(h, () => h.inReaction === 'deepWake', 5000, 'wakes');
  until(h, () => !h.inReaction, 20000, 'awake');
});

test('palms and cacti last longer than small plants, are never eaten, and their time stands still in the background', () => {
  const life = { grass: [], cactus: [], palm: [] };
  for (let seed = 0; seed < 40; seed++) {
    const c = world(300 + seed);
    c.envNext = Infinity;
    const p = c.sprout(0);
    if (p) life[p.kind].push(p.life);
  }
  assert.ok(life.cactus.length && life.palm.length && life.grass.length);
  for (const k of ['cactus', 'palm']) assert.ok(Math.min(...life[k]) >= 6 * MINUTE && Math.max(...life[k]) <= 14 * MINUTE, `${k}: 6 to 14 minutes`);
  assert.ok(Math.max(...life.grass) < Math.min(...life.cactus, ...life.palm), 'small plants come and go sooner');
  assert.ok(new Set(life.cactus.map(Math.round)).size > 1, 'not all the same');
  // In the background its clock stops; back at the window it carries on where it was.
  const c = world(340);
  run(c, 10000, { dt: 100 });
  c.envNext = Infinity;
  const cactus = c.spawn('cactus', { x: c.clampProp(c.zone(0.5) + 120, 7), grows: true, wild: true, life: 7 * MINUTE, noticeAt: Infinity });
  run(c, 2 * MINUTE, { from: c.now, dt: 100 });
  c.setFocus(false, c.now);
  run(c, 30 * MINUTE, { from: c.now, dt: 250 });
  assert.ok(c.has(cactus), 'still there after half an hour in the background');
  c.setFocus(true, c.now);
  const back = c.now;
  until(c, () => !c.has(cactus), 7 * MINUTE, 'withers in its time once you are back');
  assert.ok(c.now - back > 4 * MINUTE, 'the five minutes it had left');
  // Visits to a cactus or a palm never take it away.
  for (const kind of ['cactus', 'palm']) for (let seed = 0; seed < 6; seed++) {
    const d = doing('look', 350 + seed);
    const p = d.spawn(kind, { x: d.clampProp(d.center() + 60, kind === 'palm' ? 11 : 7), frame: GROW_FULL[kind], grows: true, wild: true, life: 1e9, noticed: d.now, visitAt: d.now, noticeAt: d.now });
    d.pending = 'visitPlant'; d.gen = null;
    until(d, () => d.recent.includes('visitPlant') && d.activity !== 'visitPlant', 60000, `${kind} visit`);
    assert.ok(d.has(p) && !p.cut, `${kind} untouched`);
  }
});

test('two longer everyday routines (making its bed, lining up pebbles) and two rarer ones (a tightrope act, planting a flower)', () => {
  const counts = { settleIn: 0, gatherPebbles: 0, tightrope: 0, plantSeed: 0 }, hours = 4;
  for (const seed of [401, 402, 403, 404, 405, 406]) {
    const c = world(seed);
    const rng = seeded(seed);
    const times = { tightrope: [], plantSeed: [] };
    let last = '';
    run(c, hours * 3600e3, { dt: 200, each: (now) => {
      if (rng() < 0.002) c.wrote(4, now);
      if (c.activity !== last) { last = c.activity; if (last in counts) counts[last]++; if (last in times) times[last].push(now); }
    } });
    for (const k in times) for (let i = 1; i < times[k].length; i++) assert.ok(times[k][i] - times[k][i - 1] > 35 * MINUTE, `${k} never twice in 35 minutes`);
  }
  const n = 6 * hours;
  assert.ok(counts.settleIn / n >= 1 && counts.gatherPebbles / n >= 1, `the everyday ones come up often: ${JSON.stringify(counts)} in ${n} h`);
  assert.ok(counts.tightrope >= 1 && counts.plantSeed >= 1, 'the rarer ones do happen');
  assert.ok(counts.tightrope / n <= 0.8 && counts.plantSeed / n <= 0.8, 'but now and then, not every hour');
  assert.ok(counts.tightrope * 3 < counts.settleIn && counts.plantSeed * 3 < counts.gatherPebbles, 'much rarer than the everyday ones');
  // Each has its beginning, middle and end.
  for (let seed = 0; seed < 4; seed++) {
    // Making its bed: round and round, a scrape, down — and it ends lying down.
    const a = doing('look', 410 + seed);
    a.pending = 'settleIn'; a.gen = null;
    const fs = [];
    until(a, () => a.recent.includes('settleIn') && a.activity !== 'settleIn', 60000, 'settles in', () => { if (a.activity === 'settleIn') fs.push(a.frame); walksNotSlides(a); });
    assert.ok(fs.includes('walk1') && fs.includes('crouch') && fs.includes('lie'), 'turns round, scrapes, lies down');
    // Lining up pebbles: a row, a pebble apart.
    const b = doing('look', 420 + seed);
    b.pending = 'gatherPebbles'; b.gen = null;
    let row = [];
    until(b, () => b.recent.includes('gatherPebbles') && b.activity !== 'gatherPebbles', 90000, 'lines up pebbles', () => {
      const now = b.props.filter((p) => p.kind === 'pebble' && !p.carried && !p.vx && p.y === 0);
      if (b.activity === 'gatherPebbles' && now.length >= row.length) row = now; // (before any swish of the tail)
      walksNotSlides(b);
    });
    assert.ok(row.length >= 3, `${row.length} pebbles set down`);
    const xs = row.map((p) => p.x).sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 4 * b.u) < 1.5 * b.u, `in a row (${xs.map((x) => x.toFixed(1))})`);
    // The tightrope: careful steps along the line, a wobble, and off.
    const t = doing('look', 430 + seed);
    t.pending = 'tightrope'; t.gen = null;
    const tf = new Set();
    until(t, () => t.recent.includes('tightrope') && t.activity !== 'tightrope', 60000, 'tightrope', () => { if (t.activity === 'tightrope') tf.add(t.frame); walksNotSlides(t); });
    for (const f of ['armsUp', 'creep1', 'creep2', 'oneLeg']) assert.ok(tf.has(f), `tightrope: ${f}`);
    // Planting: the seed goes in the ground, and up comes a flower.
    const p = doing('look', 440 + seed);
    p.pending = 'plantSeed'; p.gen = null;
    let grown = 0;
    until(p, () => p.recent.includes('plantSeed') && p.activity !== 'plantSeed', 90000, 'plants a seed', () => { const fl = p.find('flower'); if (fl) grown = Math.max(grown, fl.frame); walksNotSlides(p); });
    assert.equal(grown, 3, 'a flower came up and opened');
    assert.ok(!p.props.some((q) => q.kind === 'seed' && q.carried), 'the seed went in the ground');
  }
});

test('dormant: deep asleep in the background, it lies still and needs hardly a tick; focus brings it back at once', () => {
  const c = world(231);
  run(c, 30000, { dt: 100 });
  c.setFocus(false, c.now);
  until(c, () => c.deep && c.asleep(), 25 * MINUTE, 'a deep sleep');
  // As Dino.tick schedules: it turns dormant once the last z has drifted away.
  const asleepAt = c.now;
  let now = c.now, ticks = 0, frames = new Set(), dormantAt = null;
  const grassBefore = c.tufts().length;
  const end = now + 60 * MINUTE;
  while (now < end) {
    const moving = c.advance(now);
    ticks++;
    if (c.dormant) { dormantAt ??= now; frames.add(c.frame); assert.equal(c.effects.length, 0, 'no z\'s'); }
    now += c.tickDelay(now, moving);
  }
  assert.ok(dormantAt != null && dormantAt - asleepAt < 20000, 'dormant within moments of the deep sleep');
  assert.deepEqual([...frames], ['lie'], 'lying quite still');
  assert.ok(ticks <= 60 * 2 + 20, `${ticks} ticks in an hour`);
  if (process.env.STET_REPORT) console.log(`dormant: ${ticks} ticks in an hour`);
  assert.ok(c.tufts().length > grassBefore || c.tufts().length === c.T.tuftsMax, 'the grass still came up on time');
  // A tuft due in the middle of a still spell: the tick comes then, not at the end of it.
  c.tuftNext = c.now + 5000;
  assert.ok(c.tickDelay(c.now, false) <= 5000);
  c.tuftNext = null;
  // Back: no longer dormant there and then, breathing again on the next tick, and the gentle wake-up follows.
  const t = c.now + 100;
  c.setFocus(true, t);
  assert.equal(c.dormant, false);
  c.advance(t);
  assert.ok(c.step.t <= 1500 && !c.step.dormant, 'a breath at once');
  until(c, () => c.inReaction === 'deepWake', 5000, 'wakes');
});
