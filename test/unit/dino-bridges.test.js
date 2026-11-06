// What the dinosaur does between two things: every bridge is sound, ends where the next activity
// wants it, and takes nothing away from what it chooses to do.

import test from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../../src/renderer/dino.js';
import { wide, run } from '../helpers/dino-sim.js';

const { BRIDGES, FRAMES, GLYPHS, ACTIVITIES, CHOICES, TEMPO, settles, postureOf } = _test;
const MINUTE = 60000;
const steps = (name, d) => [...BRIDGES[name].fn({ face: 1, now: 0, wetUntil: 0, ...d })];

test('every bridge is made of real frames, short steps and no travelling, and lasts a moment', () => {
  for (const name of Object.keys(BRIDGES)) {
    const all = steps(name);
    assert.ok(all.length >= 3, name);
    for (const s of all) {
      assert.ok(FRAMES[s.f], `${name}: frame ${s.f}`);
      assert.ok(s.t > 0 && s.t <= 1500, `${name}: ${s.f} ${s.t} ms`);
      assert.ok(!s.dx && !s.jump && !s.lift && !s.do, `${name} stays where it is and touches nothing`);
      if (s.fx) assert.ok(GLYPHS[s.fx], `${name}: glyph ${s.fx}`);
    }
    const ms = all.reduce((a, s) => a + s.t, 0);
    assert.ok(ms >= 500 && ms <= 2800, `${name} takes ${ms} ms`);
  }
});

test('a bridge ends where it can go on from: on its feet, and sitting when that is the point of it', () => {
  const k = (pose, next, after = 'look') => ({ pose, next, after, from: TEMPO[after], to: TEMPO[next], down: settles(next), night: false, wet: false });
  for (const [name, b] of Object.entries(BRIDGES)) {
    for (const [pose, next] of [['stand', 'rest'], ['stand', 'zoomies'], ['sit', 'rest'], ['sit', 'zoomies'], ['lie', 'zoomies']]) {
      const c = k(pose, next);
      if (!b.fit(c)) continue;
      const end = postureOf(steps(name).at(-1).f);
      assert.equal(end, ['circleDown', 'sinkDown', 'shuffle'].includes(name) ? 'sit' : 'stand', `${name} from ${pose} to ${next}`);
    }
  }
});

test('whatever it stands like and whatever comes next, a bridge fits', () => {
  for (const after of Object.keys(CHOICES)) {
    for (const next of Object.keys(CHOICES)) {
      for (const pose of ['stand', 'sit']) {
        const k = { pose, after, next, from: TEMPO[after], to: TEMPO[next], down: settles(next), night: false, wet: false };
        assert.ok(Object.values(BRIDGES).some((b) => b.fit(k) > 0), `${pose}: ${after} to ${next}`);
      }
    }
  }
});

test('a settling activity really does start low (the list is kept honest)', () => {
  for (const a of ['rest', 'sleep', 'readScript', 'daydream']) assert.ok(settles(a) && ACTIVITIES[a], a);
  assert.ok(!settles('zoomies') && !settles('walk'));
});

test('in hours of its life it bridges often and varies them, never the same twice running, all rules kept', () => {
  const c = wide(11), seen = {};
  const was = c.bridgeTo.bind(c);
  let tried = 0, last = null, given = 0;
  c.bridgeTo = (next, after) => {
    const b = was(next, after);
    tried++;
    if (b) { assert.notEqual(b, last, 'never the same one twice running'); seen[b] = (seen[b] || 0) + 1; last = b; given++; }
    return b;
  };
  run(c, 90 * MINUTE, { dt: 100 });
  assert.ok(tried > 50, `${tried} changes of activity`);
  assert.ok(given / tried > 0.5, `${given} of ${tried}`);
  assert.ok(Object.keys(seen).length >= 10, Object.keys(seen).join());
});

test('it chooses the same things with bridges as without', () => {
  const trace = (bridges) => {
    const c = wide(5), out = [];
    if (!bridges) c.bridgeTo = () => null;
    for (let i = 0; i < 12; i++) { c.activity = 'look'; c.recent = []; out.push(c.pickActivity(0)); if (bridges) c.bridgeTo('rest', 'look'); }
    return out;
  };
  assert.deepEqual(trace(true), trace(false));
});

test('nothing leads in while the window is in the background, or when something is urgent', () => {
  const c = wide(3);
  c.focused = false;
  for (let i = 0; i < 20; i++) assert.equal(c.bridgeTo('rest', 'walk'), null);
  c.focused = true;
  assert.equal(c.bridgeTo('rest', null), null, 'nothing to lead on from');
  c.deep = true;
  assert.equal(c.bridgeTo('rest', 'walk'), null);
});
