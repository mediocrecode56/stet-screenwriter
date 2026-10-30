// The dinosaur's pace (0.53): never frozen for long while awake, never several things at once, and
// small things passing by between the bigger events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../../src/renderer/dino.js';
import { wide, run, inView, doing, MINUTE } from '../helpers/dino-sim.js';

const { ACTIVITIES, postureOf } = _test;
const STILL_OK = new Set(['sleep', 'doze', 'cornerBite', 'tightrope', 'headstand']);
const held = (s) => !s.dx && !s.jump && !s.lift && !s.flip && !s.fx;

test('awake and in view, it never holds still for long: something small happens every few seconds', () => {
  for (const seed of [3, 8, 21]) {
    const c = wide(seed);
    let quiet = 0, worst = 0, face = c.face, frame = '';
    const { steps } = run(c, 20 * MINUTE, { dt: 50 });
    for (const s of steps) {
      const moved = !held(s) || s.face && s.face !== face || postureOf(s.f) !== postureOf(frame) || /Tap|Blink|Up|sniff|wag|blink/.test(s.f);
      face = s.face || face; frame = s.f;
      if (moved || s.reaction || STILL_OK.has(s.activity) || c.deep) { quiet = s.end; continue; }
      worst = Math.max(worst, s.end - quiet);
    }
    assert.ok(worst <= 9000, `the longest stretch with nothing to see: ${Math.round(worst)} ms (seed ${seed})`);
  }
});

test('stirs and glimpses never change what it chooses to do', () => {
  const trace = (c) => { const out = []; run(c, 6 * MINUTE, { dt: 50, each: () => { if (c.activity !== out.at(-1)) out.push(c.activity); } }); return out; };
  const plain = wide(11);
  plain.stirred = (v) => v;
  plain.maybeGlimpse = () => {};
  const a = trace(wide(11)), b = trace(plain);
  // (the same choices, in the same order; stirs only shift them a little in time)
  assert.deepEqual(a.slice(0, 6), b.slice(0, 6));
});

test('after a reaction, a breather before an event or a new plant comes its way', () => {
  const c = doing('rest', 5);
  c.envNext = c.now;
  c.reactEnd = c.now;
  c.advance(c.now + 100);
  assert.equal(c.event, null, 'no event straight after a reaction');
  assert.ok(c.envNext >= c.reactEnd + 5000, 'put off until the breather is over');
});

test('small things pass by now and then, need nothing of it, and fade away; it glances at them', () => {
  const kinds = ['leaf', 'fluff', 'butterfly', 'feather', 'firefly', 'breeze'];
  for (const kind of kinds) {
    const c = doing('rest', kind.length * 7);
    c.glimpseNext = Infinity; // (only this one)
    const before = c.props.length;
    const p = c.startGlimpse(kind, c.now);
    if (kind === 'breeze') assert.ok(c.streaks.length > 0, 'a gust');
    else assert.ok(p && p.glimpse && c.props.length === before + 1, `${kind} comes`);
    run(c, 30000, { from: c.now + 50, dt: 50, each: () => inView(c) });
    assert.ok(!c.props.some((q) => q.glimpse), `${kind} gone in the end`);
    assert.ok(!c.inReaction || c.inReaction === 'comeBack', `${kind}: nothing asked of it`);
  }
  // Over an hour, a few dozen of them, never crowding the sky.
  const c = wide(9);
  let n = 0, most = 0;
  const orig = c.startGlimpse.bind(c);
  c.startGlimpse = (k, t) => { n++; return orig(k, t); };
  run(c, 60 * MINUTE, { dt: 100, each: () => { most = Math.max(most, c.floating()); } });
  assert.ok(n >= 20 && n <= 130, `${n} glimpses an hour`);
  assert.ok(most <= 4, 'only a few things float about');
  // It looks their way: a glance follows soon after one comes.
  const d = doing('rest', 12);
  d.glimpseNext = Infinity;
  const g = d.startGlimpse('leaf', d.now);
  const { steps } = run(d, 4000, { from: d.now + 50, dt: 50 });
  assert.ok(steps.some((s) => s.f === 'sitUp' && s.face === d.dirTo(g)) || !d.has(g), 'it glances at the leaf');
});

test('three newer habits: humming a tune, watching the clouds on its back, dribbling a pebble', () => {
  for (const a of ['hum', 'cloudGaze', 'kickPebble']) {
    assert.ok(ACTIVITIES[a], a);
    for (let seed = 0; seed < 4; seed++) {
      const c = wide(seed * 13 + a.length);
      c.envNext = Infinity;
      c.glimpseNext = Infinity;
      c.pending = a;
      const { steps } = run(c, 40000, { dt: 50, each: () => inView(c) });
      const own = steps.filter((s) => s.activity === a);
      assert.ok(own.length > 4, `${a} plays (${own.length} steps)`);
      if (a === 'cloudGaze') assert.ok(own.some((s) => s.f === 'fallen'), 'on its back');
      if (a === 'hum') assert.ok(own.some((s) => s.fx === 'note'), 'a note');
      if (a === 'kickPebble') assert.ok(own.some((s) => s.f === 'kick'), 'a kick');
      run(c, 40000, { from: c.now + 50, dt: 100 });
      if (a === 'kickPebble') assert.ok(!c.props.some((p) => p.kind === 'pebble' && !p.carried), 'the pebble gone in the end');
    }
  }
});
