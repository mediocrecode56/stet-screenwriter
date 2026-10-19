// The dinosaur's pixel art and behaviour scripts (the renderer itself is
// exercised end-to-end in test/e2e/companion.e2e.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../src/renderer/dino.js';

const { FRAMES, W, H, ACTIVITIES, REACTIONS, postureOf } = _test;

test('every frame is a full grid of known pixels', () => {
  for (const [name, rows] of Object.entries(FRAMES)) {
    assert.equal(rows.length, H, name + ' height');
    for (const r of rows) {
      assert.equal(r.length, W, `${name} row "${r}"`);
      assert.match(r, /^[#.o]+$/, name);
    }
    assert.ok(rows.join('').includes('#'), name + ' is not empty');
  }
});

function fakeDino(energy) {
  const d = {
    x: 40, face: 1, energy, frame: 'stand',
    maxX: () => 140,
    *getTo(posture) { if (postureOf(d.frame) !== posture) yield { f: posture === 'lie' ? 'lie' : posture === 'sit' ? 'sit' : 'stand', t: 200 }; },
  };
  return d;
}

function run(gen, d) {
  const steps = [];
  for (const s of gen) {
    steps.push(s);
    if (s.face) d.face = s.face;
    d.frame = s.f;
    d.x = Math.max(0, Math.min(d.maxX(), d.x + (s.dx || 0)));
    if (steps.length > 500) break;
  }
  return steps;
}

test('activities are long loops of short, valid steps that stay inside the strip', () => {
  for (const [name, fn] of Object.entries(ACTIVITIES)) {
    for (const e of [0, 0.5, 1]) {
      const d = fakeDino(e);
      const steps = run(fn(d), d);
      assert.ok(steps.length >= 3, name);
      const total = steps.reduce((n, s) => n + s.t, 0);
      assert.ok(total >= 1000, `${name} lasts a while (${total} ms)`);
      for (const s of steps) {
        assert.ok(FRAMES[s.f], `${name}: frame ${s.f}`);
        assert.ok(s.t > 0 && s.t <= 1500, `${name}: step ${s.t} ms is short enough to blend a reaction in`);
        assert.ok(d.x >= 0 && d.x <= d.maxX());
      }
    }
  }
});

test('reactions are varied and every one is short', () => {
  assert.ok(Object.keys(REACTIONS).length >= 8);
  for (const [name, fn] of Object.entries(REACTIONS)) {
    const d = fakeDino(0.5);
    const steps = run(fn(d), d);
    const total = steps.reduce((n, s) => n + s.t, 0);
    assert.ok(total > 300 && total < 4500, `${name}: ${total} ms`);
    for (const s of steps) assert.ok(FRAMES[s.f], `${name}: ${s.f}`);
  }
});
