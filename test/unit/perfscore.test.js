// The performance probe's rules: the score, how far a result is trusted, and keeping to time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { stats, curve, scoreResults, reliability, describeSystem, runStages, grade, MEASURES, SMOOTH_SCORE } from '../../src/core/perfscore.js';

const marks = { ideal: 10, smooth: 40, limit: 400 };
/** Measurements of a computer `x` times slower than one sitting exactly on every ideal mark. */
function computer(x, frame = 1000 / 60) {
  const c = {};
  const set = (k, v) => { c[k] = { n: 50, p50: v, p95: v, max: v, mean: v }; };
  const at = (id) => MEASURES.find((m) => m.id === id).marks(frame).ideal * x;
  set('typingToFrame', at('typing')); set('typingDuringSave', at('saving')); set('scrollPacing', at('scroll'));
  set('typingJs', at('work')); set('enterJs', at('enter')); set('arrowDownJs', at('caret')); set('sceneJump', at('jump'));
  set('paginateFull', at('layout')); set('findAll', at('find'));
  c.openMs = at('open'); c.saveRoundTrip = at('disk');
  return c;
}

test('stats: nothing measured is null, never a zero', () => {
  assert.equal(stats([]), null);
  assert.equal(stats([NaN, undefined]), null);
  assert.deepEqual(stats([1, 2, 3, 4]), { n: 4, p50: 3, p95: 4, max: 4, mean: 2.5 });
});

test('the curve: 100 to the ideal, 70 at the smooth mark, 0 at the limit, always falling', () => {
  assert.equal(curve(1, marks), 100);
  assert.equal(curve(10, marks), 100);
  assert.equal(curve(40, marks), SMOOTH_SCORE);
  assert.equal(curve(400, marks), 0);
  assert.equal(curve(1e9, marks), 0);
  assert.equal(curve(undefined, marks), null);
  let last = 101;
  for (let v = 10; v <= 400; v *= 1.2) { const s = curve(v, marks); assert.ok(s <= last && s >= 0, `${v}: ${s}`); last = s; }
});

test('a score tells computers apart: the faster the higher, from 100 down to 0', () => {
  const scores = [1, 2, 4, 8, 16, 32, 128].map((x) => scoreResults([computer(x)], 1000 / 60).score);
  assert.equal(scores[0], 100);
  assert.equal(scores.at(-1), 0);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] < scores[i - 1], scores.join(' '));
  assert.ok(scores.every((s) => Number.isInteger(s) && s >= 0 && s <= 100));
});

test('a fast display is never held against a computer: what a person cannot tell apart scores the same at 60 and 240 Hz', () => {
  const c = computer(1, 1000 / 240);
  assert.equal(scoreResults([c], 1000 / 60).score, 100);
  assert.equal(scoreResults([c], 1000 / 240).score, 100);
});

test('a slow display (a remote desktop) is allowed its own frame', () => {
  const frame = 1000 / 20, c = computer(1, frame);
  assert.equal(scoreResults([c], frame).score, 100);
  assert.ok(scoreResults([c], 1000 / 60).score < 100, 'the same times on a 60 Hz display are slow');
});

test('stuttering while typing can never be hidden by everything else being fast', () => {
  const c = computer(1);
  c.typingToFrame = { n: 50, p50: 300, p95: 300, max: 300, mean: 300 };
  const r = scoreResults([c], 1000 / 60);
  assert.ok(r.score < SMOOTH_SCORE, `score ${r.score}`);
  assert.ok(['FAIR', 'SLOW'].includes(r.grade));
});

test('the long script counts, less than the feature-length one', () => {
  const both = scoreResults([computer(1), computer(16)], 1000 / 60).score;
  const alone = scoreResults([computer(1)], 1000 / 60).score;
  const worse = scoreResults([computer(16), computer(1)], 1000 / 60).score;
  assert.ok(both < alone && both > worse, `${worse} < ${both} < ${alone}`);
});

test('what was not measured is left out, and with too little there is no score at all', () => {
  const c = computer(1);
  delete c.saveRoundTrip;
  const r = scoreResults([c], 1000 / 60);
  assert.equal(r.score, 100);
  assert.ok(r.coverage < 1 && !r.items.some((i) => i.id === 'disk'));
  const none = scoreResults([{ openMs: 100 }], 1000 / 60);
  assert.equal(none.score, null);
  assert.equal(none.grade, 'NO RESULT');
  assert.equal(scoreResults([], null).score, null);
  assert.equal(grade(null), 'NO RESULT');
});

test('an unknown frame time falls back to a usual display', () => {
  for (const f of [null, undefined, NaN, 0, -1]) assert.equal(scoreResults([computer(1)], f).score, 100);
});

test('reliability says what went wrong', () => {
  assert.deepEqual(reliability({}), { level: 'high', notes: [] });
  assert.equal(reliability({ noFrames: true }).level, 'low');
  assert.equal(reliability({ drift: 2 }).level, 'fair');
  assert.equal(reliability({ jitter: 3 }).level, 'fair');
  assert.equal(reliability({ framesAsked: 100, framesLost: 20 }).level, 'fair');
  assert.equal(reliability({ skipped: ['the 400-page script'] }).level, 'fair');
  assert.equal(reliability({ failed: ['typing'], coverage: 0.9 }).level, 'fair');
  assert.equal(reliability({ failed: ['typing', 'saving'], coverage: 0.6 }).level, 'low');
  const r = reliability({ software: true, battery: true });
  assert.equal(r.level, 'high');
  assert.equal(r.notes.length, 2);
});

test('the system line copes with a computer that says little or nothing', () => {
  assert.equal(describeSystem(), '');
  assert.equal(describeSystem({ cpu: '', cores: 0, memGB: NaN, gpu: null }), '');
  assert.equal(describeSystem({ cpu: 'Intel(R) Core(TM)  i9', cores: 32, memGB: 63.7, gpu: 'A GPU' }), 'Intel Core i9 · 32 threads · 64 GB memory · A GPU');
});

test('stages: one that throws costs only itself', async () => {
  const seen = [];
  const r = await runStages([
    { name: 'a', run: () => { seen.push('a'); } },
    { name: 'b', label: 'the second', run: () => { throw new Error('broken'); } },
    { name: 'c', run: async () => { seen.push('c'); } },
  ], { limitMs: 1000 });
  assert.deepEqual(seen, ['a', 'c']);
  assert.deepEqual(r.done, ['a', 'c']);
  assert.deepEqual(r.failed, ['the second']);
  assert.equal(r.errors.b, 'broken');
});

test('stages: one that never comes back is left behind at its limit, and the rest still run', async () => {
  const t0 = performance.now(), seen = [];
  const r = await runStages([
    { name: 'stuck', label: 'stuck', limitMs: 20, run: () => new Promise(() => {}) },
    { name: 'next', run: () => { seen.push('next'); } },
  ], { limitMs: 1000, graceMs: 10 });
  assert.deepEqual(seen, ['next']);
  assert.deepEqual(r.failed, ['stuck']);
  assert.ok(performance.now() - t0 < 500);
});

test('stages: a loop asks the clock, so a slow computer just takes fewer samples', async () => {
  let n = 0, clock = 0;
  await runStages([{ name: 'loop', limitMs: 100, run: async (t) => { while (t.more()) { n++; clock += 10; await t.breathe(); } } }], { limitMs: 1000, now: () => clock, rest: async () => {} });
  assert.equal(n, 10);
});

test('stages: a stage left behind stops at its next look at the time', async () => {
  let looked = null;
  await runStages([{ name: 'late', limitMs: 5, run: async (t) => { await new Promise((r) => setTimeout(r, 60)); looked = t.more(); } }], { limitMs: 1000, graceMs: 5 });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(looked, false);
});

test('stages: the whole run keeps to its time, what is left out being named once', async () => {
  let clock = 0;
  const r = await runStages([
    { name: 'long', run: () => { clock += 100; } },
    { name: 'x', skipLabel: 'the long script', run: () => assert.fail('no time for it') },
    { name: 'y', skipLabel: 'the long script', run: () => assert.fail('no time for it') },
  ], { limitMs: 50, now: () => clock });
  assert.deepEqual(r.skipped, ['the long script']);
});

test('stages: stopping ends the run before the next stage, and during a loop', async () => {
  let stop = false, ran = 0, loops = 0;
  const r = await runStages([
    { name: 'a', run: async (t) => { while (t.more() && loops < 1000) { if (++loops === 3) stop = true; } ran++; } },
    { name: 'b', run: () => { ran++; } },
  ], { limitMs: 1000, stopped: () => stop });
  assert.equal(loops, 3);
  assert.equal(ran, 1);
  assert.equal(r.stopped, true);
});

test('stages: a stage can decline, as the long script does when it would not fit', async () => {
  const r = await runStages([{ name: 'a', skip: () => true, skipLabel: 'it', run: () => assert.fail('declined') }], { limitMs: 1000 });
  assert.deepEqual(r.skipped, ['it']);
  assert.deepEqual(r.done, []);
});
