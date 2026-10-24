// The dinosaur's pixel art and its behaviour, simulated headlessly: every frame drawn whole with its
// face, every activity and reaction playing through, clicks answered to fit what it was doing (with
// variety, escalation and a bounded queue), energy from writing, props cleaned up, and walking back
// in when its ground shrinks, the window in the background (grass, deep sleep, dormancy), and the
// rarer routines. Its world (weather, plants, visitors, growth): dino-world.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../../src/renderer/dino.js';
import { FACE, HEADS, spriteEdges } from '../../src/renderer/dino-art.js';
import { GROW_FULL, seeded, make, wide, run, inView, doing, until, world, walksNotSlides, MINUTE, writer, chosen } from '../helpers/dino-sim.js';

const { FRAMES, PROPS, W, H, ACTIVITIES, REACTIONS, BASELINE_0_8 } = _test;
import { CRITTERS } from '../../src/renderer/dino-acts.js';
const LUSH_KINDS = ['fern', 'bloom', 'reed'];

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
      let began = false;
      const { steps } = run(c, 120000, { each: () => { c.energy = energy; inView(c); if (c.activity === name) began = true; }, stop: () => began && c.activity !== name && c.step && c.step.end - c.now > 50 }); // until it has finished
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

test('doodling: a squiggle drawn a stroke at a time, then kept a while or scuffed out, and gone in the end', () => {
  for (let seed = 0; seed < 8; seed++) {
    const c = wide(seed * 13 + 3);
    c.envNext = Infinity;
    c.pending = 'doodle';
    const frames = new Set();
    const look = () => { const p = c.find('doodle'); if (p && c.activity === 'doodle') frames.add(p.frame); inView(c); };
    until(c, () => c.activity === 'doodle', 60000, 'starts doodling', look);
    until(c, () => c.activity !== 'doodle', 60000, 'finishes', look);
    assert.ok(frames.size >= 3, `drawn in strokes (${[...frames]})`);
    run(c, 60000, { from: c.now + 50, each: () => { c.pending = c.pending || 'look'; } });
    assert.ok(!c.find('doodle'), 'gone afterwards');
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

// ---- the window in the background: grass, deep sleep, large plants, dormancy ----------------------


test('back at the window, it eats the grass only once writing resumes — progressively, a bite at a time', () => {
  for (const seed of [211, 212]) {
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
    until(c, () => c.inReaction !== 'deepWake', 20000, 'wakes up', () => { if (c.inReaction !== 'deepWake') return; frames.push(c.frame); assert.ok(Math.abs(c.x - x) < 0.01, 'no teleport'); }); // (only while waking: not the first step of what comes next)
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
    if (c.dormant) { dormantAt ??= now; if (c.step?.dormant) frames.add(c.frame); assert.equal(c.effects.length, 0, 'no z\'s'); }
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

// ---- four shameless routines ----------------------------------------------------------------------

test('a scratch on its back, a strut, a burp after a meal, a photobomb: each when it fits, and each plays through', () => {
  // When: a burp only after eating; a photobomb only with something worth posing by; a strut more
  // once today's goal is met; a roll in the dust more after the rain.
  const c = world(601);
  assert.ok(!chosen(c, 6000).burp, 'no burp without a meal');
  assert.ok(chosen(c, 3000, 1e9, (d) => { d.fed = 1e9 - 30000; }).burp > 150, 'often soon after one');
  assert.ok(!chosen(c, 3000, 1e9, (d) => { d.fed = 1e9 - 5 * MINUTE; }).burp, 'not long after');
  assert.ok(!chosen(c, 6000).photobomb, 'no photobomb with nothing to pose by');
  const palm = c.spawn('palm', { x: c.clampProp(c.center() + 120, 11), frame: 3, life: 1e12 });
  assert.ok(chosen(c, 6000, 1e9, (d) => { d.lastDone = {}; }).photobomb > 0, 'by a full-grown palm');
  assert.ok(!chosen(c, 3000, 1e9, (d) => { d.lastDone = { photobomb: 1e9 - MINUTE }; }).photobomb, 'not again straight away');
  c.remove(palm);
  const plain = chosen(c, 8000).strut || 0, proud = chosen(c, 8000, 1e9, (d) => { d.progress.today = d.progress.goal; }).strut || 0;
  assert.ok(proud > 1.5 * plain, `more of a strut once the goal is met (${plain} → ${proud})`);
  c.progress.today = 0;
  const dry = chosen(c, 8000).backScratch || 0, wet = chosen(c, 8000, 1e9, (d) => { d.wetUntil = 2e9; }).backScratch || 0;
  assert.ok(wet > 1.5 * dry, `more of a roll after the rain (${dry} → ${wet})`);
  // How: each from any posture, with its own frames, walking where it moves, and back to its day.
  for (const [name, frames, setup] of [
    ['backScratch', ['sitScratch1', 'fallen', 'hunch'], (d) => { d.wetUntil = d.now + 60000; }],
    ['strut', ['stretch', 'walk1', 'up', 'armsUp']],
    ['burp', ['roar', 'sitHowl'], (d) => { d.fed = d.now; }],
    ['photobomb', ['up', 'armsUp'], (d) => { d.spawn('palm', { x: d.clampProp(d.center() + 90, 11), frame: 3, life: 1e9 }); }],
  ]) for (const start of ['sit', 'stand', 'lie']) {
    const d = doing('look', name.length * 3 + start.length, setup);
    d.frame = start; d.step = null; d.pending = name; d.gen = null; // (no step left over from another posture)
    const seen = new Set();
    let lens = 0;
    until(d, () => d.recent.includes(name) && d.activity !== name, 60000, `${name} from ${start}`, () => { if (d.activity === name) { seen.add(d.frame); lens++; } walksNotSlides(d); inView(d); });
    assert.ok(frames.some((f) => seen.has(f)) && lens > 5, `${name} from ${start}: ${[...seen]}`);
    if (name === 'burp') assert.equal(d.fed, -Infinity, 'one burp a meal');
    if (name === 'backScratch') assert.ok(d.now >= d.wetUntil, 'the dust shaken off with the wet');
  }
  // The photobomb ends up right in front of what it poses by.
  const d = doing('look', 77, (x) => { x.spawn('palm', { x: x.clampProp(x.center() + 150, 11), frame: 3, life: 1e9 }); });
  d.pending = 'photobomb'; d.gen = null;
  let posed = null;
  until(d, () => d.recent.includes('photobomb') && d.activity !== 'photobomb', 60000, 'photobomb', () => { if (d.activity === 'photobomb' && d.frame === 'armsUp' && posed == null) posed = Math.abs(d.center() - d.propCenter(d.find('palm'))); });
  assert.ok(posed != null && posed < 4, `in front of the palm (${posed?.toFixed(1)} px off)`);
  // Grazing back at the window is a meal: a burp is likely to follow.
  let burps = 0;
  for (let seed = 0; seed < 4; seed++) {
    const g = world(620 + seed);
    g.setFocus(false, 0); run(g, 20 * MINUTE, { dt: 250 }); g.setFocus(true, g.now);
    const rng = seeded(seed);
    let ate = false;
    run(g, 20 * MINUTE, { from: g.now, dt: 150, each: () => { writer(g, rng)(); if (g.activity === 'graze') ate = true; if (ate && g.activity === 'burp') burps++; } });
  }
  assert.ok(burps > 0, 'a burp after grazing');
});

test('a crumpled page, a drink at the puddle, a stick to chew: each when it fits, each plays through and tidies up', () => {
  // When: the page often, the stick seldom, the drink only with a puddle (the more after a run about).
  const c = world(640);
  const k = chosen(c, 12000, 1e9, (d) => { d.lastEnv = {}; });
  assert.ok(k.crumple > k.stick && k.stick > 0, `the page more often than the stick (${k.crumple}, ${k.stick})`);
  assert.ok(!k.drink, 'no drink without a puddle');
  const pd = c.spawn('puddle', { x: c.clampProp(c.center() + 80, 9), life: 1e12 });
  const calm = chosen(c, 6000).drink || 0, after = chosen(c, 6000, 1e9, (d) => { d.activity = 'zoomies'; }).drink || 0;
  assert.ok(calm > 0 && after > 1.5 * calm, `a drink, the more after a run (${calm} → ${after})`);
  c.remove(pd);
  // How: from any posture, with its own props and frames, and nothing of it left behind.
  for (const [name, props, frames, setup] of [
    ['crumple', ['page', 'wad'], ['sitUp', 'up']],
    ['drink', [], ['sniff', 'sniffBlink'], (d) => { d.spawn('puddle', { x: d.clampProp(d.center() + 70, 9), life: 1e12 }); }],
    ['stick', ['stick'], ['chomp', 'lie']],
  ]) for (const start of ['sit', 'stand', 'lie']) {
    const d = doing('look', name.length * 5 + start.length, setup);
    d.frame = start; d.step = null; d.pending = name; d.gen = null;
    const seen = new Set(), kinds = new Set();
    until(d, () => d.recent.includes(name) && d.activity !== name, 60000, `${name} from ${start}`, () => { if (d.activity === name) { seen.add(d.frame); for (const p of d.props) kinds.add(p.kind); } walksNotSlides(d); inView(d); });
    assert.ok(frames.every((f) => seen.has(f)) && props.every((p) => kinds.has(p)), `${name} from ${start}: ${[...seen]} / ${[...kinds]}`);
    run(d, 70000, { from: d.now + 50, each: () => { d.pending = d.pending || 'look'; } });
    assert.ok(!d.props.some((p) => props.includes(p.kind)), `${name}: tidied up (${d.props.map((p) => p.kind)})`);
  }
});

test('clicks are answered quietly and from where it is: few leaps when settled, more as the clicks keep coming', () => {
  const lively = Object.keys(REACTIONS).filter((n) => REACTIONS[n].lively);
  const leaps = (c, a = 1) => {
    let n = 0, now = c.now;
    const saved = { history: c.history, lastUsed: c.lastUsed };
    for (let i = 0; i < 600; i++) { now += 9000; c.history = []; c.lastUsed = {}; if (lively.includes(c.chooseReaction(now, a, c.context()))) n++; }
    Object.assign(c, saved);
    return n / 600;
  };
  const standing = doing('look', 11);
  const first = leaps(standing), more = leaps(standing, 4);
  assert.ok(first < 0.12, `a first click on its feet: mostly no leap (${first})`);
  assert.ok(more > 1.3 * first, `the clicks keep coming: livelier (${first} → ${more})`);
  for (const a of ['readScript', 'daydream', 'sleep']) {
    const c = doing(a, 12);
    run(c, 4000, { from: c.now + 50, dt: 50 });
    assert.ok(leaps(c) < 0.03, `${a} (${c.frame}): hardly ever leaps up (${leaps(c)})`);
  }
  // Settled, it looks round from where it is: up from lying, up from sitting.
  const lying = doing('daydream', 13);
  run(lying, 3000, { from: lying.now + 50, dt: 50 });
  assert.ok(share(answers(lying), ['glance', 'smile', 'ack', 'tilt']) > 0.2, 'a look round from where it lies');
});

test('something small darts out of the grass now and then; it gives chase, never catches it, and nothing is left behind', () => {
  const plain = world(660);
  assert.ok(!chosen(plain, 4000, 1e9, (d) => { d.lastEnv = {}; }).critter, 'no grass, no critters');
  const kinds = new Set();
  let chases = 0;
  for (let seed = 0; seed < 10; seed++) {
    const d = doing('look', 661 + seed, (c) => { for (const off of [-140, 120, 200]) c.spawn('grass', { x: c.clampProp(c.center() + off, 7), frame: 2, tuft: true, life: 1e9 }); });
    if (seed === 0) assert.ok(chosen(d, 4000, 1e9, (c) => { c.lastEnv = {}; }).critter > 0, 'with grass about, now and then');
    d.pending = 'critter'; d.gen = null; d.step = null;
    let closest = Infinity, ran = false;
    until(d, () => d.recent.includes('critter') && d.activity !== 'critter', 60000, 'the critter', () => {
      for (const p of d.props) if (p.kind in CRITTERS) { kinds.add(p.kind); closest = Math.min(closest, Math.abs(d.propCenter(p) - d.center())); }
      if (d.activity === 'critter' && /^run/.test(d.frame)) ran = true;
      walksNotSlides(d); inView(d);
    });
    if (ran) chases++;
    assert.ok(closest > d.dw * 0.35, `never caught (${closest.toFixed(1)} px at the closest)`);
    assert.equal(d.tufts().length, 3, 'the grass where it was');
    run(d, 30000, { from: d.now + 50, each: () => { d.pending = d.pending || 'look'; } });
    assert.ok(!d.props.some((p) => p.kind in CRITTERS), 'gone: into the grass or off the strip');
  }
  assert.ok(chases >= 2 && kinds.size >= 2, `chases ${chases}, kinds ${[...kinds]}`);
});

test('a very long sleep: rarer plants come up slowly, and wither away a stage at a time once writing starts again', () => {
  const c = world(670);
  run(c, 30000, { dt: 100 });
  c.setFocus(false, c.now);
  const away = c.now;
  run(c, c.T.lushAfter - 60000, { from: c.now, dt: 2000 });
  assert.ok(!c.props.some((p) => p.lush), 'nothing before a long while');
  run(c, 30 * MINUTE, { from: c.now, dt: 2000 });
  const lush = c.props.filter((p) => p.lush);
  assert.ok(c.deep && lush.length >= 1 && lush.length <= c.T.lushMax, `${lush.length} after ${Math.round((c.now - away) / MINUTE)} minutes`);
  assert.ok(lush.every((p) => p.born >= away + c.T.lushAfter && LUSH_KINDS.includes(p.kind)));
  assert.ok(lush.some((p) => p.frame >= 1), 'growing');
  // Back, and writing: each withers back a stage at a time, and is gone within moments.
  c.setFocus(true, c.now);
  run(c, 3000, { from: c.now, dt: 100 });
  assert.equal(c.props.filter((p) => p.lush).length, lush.length, 'still there until writing starts');
  c.wrote(5, c.now);
  const frames = new Map(lush.map((p) => [p, [p.frame]]));
  run(c, 30000, { from: c.now, dt: 100, each: () => { for (const p of lush) if (c.has(p) && frames.get(p).at(-1) !== p.frame) frames.get(p).push(p.frame); } });
  assert.ok(!c.props.some((p) => p.lush), 'all gone');
  for (const f of frames.values()) assert.ok(f.every((x, i) => i === 0 || x === f[i - 1] - 1), `a stage at a time (${f})`);
});

test('it blinks on its own every few seconds (never asleep), lands from a jump with weight, and neither changes what it does', () => {
  // Blinks: counted as they start, over ten minutes of its life.
  const c = wide(7);
  let blinks = 0, was = false, asleepBlinks = 0;
  run(c, 10 * MINUTE, { dt: 20, each: (now) => {
    const b = c.blinking(now);
    if (b && !was) blinks++;
    if (b && (c.asleep() || c.deep)) asleepBlinks++;
    was = b;
  } });
  assert.ok(blinks >= 20 && blinks <= 300, `${blinks} blinks in ten minutes`);
  assert.equal(asleepBlinks, 0, 'never with its eyes shut already');
  // The same life with and without them, step for step: they draw on random numbers of their own.
  const trace = (c) => { const out = []; run(c, 5 * MINUTE, { dt: 50, each: () => out.push(c.frame + c.x.toFixed(2)) }); return out.join(); };
  const plain = wide(11);
  plain.nextBlink = () => {};
  plain.land = () => {};
  assert.equal(trace(wide(11)), trace(plain), 'the same activities, the same moves');
  // A landing: dust either side of its feet, and a moment's crouch.
  const d = wide(3);
  run(d, 2000, { dt: 50 });
  const t0 = d.now, dust = d.particles.length;
  d.step = { f: 'jump', t: 340, jump: 5, start: t0, end: t0 + 340, x0: d.x, x1: d.x, ground: false };
  d.advance(t0 + 341);
  assert.equal(d.landAt, t0 + 341);
  assert.ok(d.particles.length >= dust + 4, 'dust kicked up');
  assert.ok(d.landing(t0 + 400) && !d.landing(t0 + 500), 'the crouch is brief');
});
