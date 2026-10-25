// The dinosaur's behaviour engine run headlessly, with its rules checked on every frame: shared by
// test/unit/dino.test.js (the art and each behaviour) and test/unit/dino-life.test.js (hours of it).
import assert from 'node:assert/strict';
import { Critter, _test } from '../../src/renderer/dino.js';

const { FRAMES, PROPS, GLYPHS, H, GET_UP, postureOf } = _test;

export const GROW_FULL = { cactus: 2, grass: 2, palm: 3 };
export const HEADROOM = 30;
export function seeded(seed) { // mulberry32
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function make(seed = 1, opts = {}) {
  const progress = { today: 0, goal: 1000 };
  const c = new Critter({ rng: seeded(seed), unit: () => 1.25, width: () => 170, progress: () => progress, clock: () => opts.clock ?? Date.parse('2026-10-21T15:00:00'), ...opts });
  c.progress = progress;
  return c;
}
/** Dimensions in the app: a 560 px strip at 1.25 px per sprite pixel, 24 px margins. */
export function wide(seed, opts = {}) { return make(seed, { width: () => 560, margin: () => 24, ...opts }); }
/** Run the engine with checks on every step. */
export function run(c, ms, { from = 0, dt = 100, each, stop } = {}) {
  let now = from;
  let prev = null;
  const steps = [];
  for (; now < from + ms; now += dt) {
    if (each) each(now);
    if (stop && stop()) break;
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
export function inView(c) {
  for (const p of c.props) {
    if (p.carried || p.balance) continue;
    const w = (p.art || PROPS[p.kind][0])[0].length * c.u, h = p.art ? p.art.length : Math.max(...PROPS[p.kind].map((f) => f.length));
    assert.ok(p.x >= -c.margin - 0.5 && p.x + w <= c.stripW + c.margin + 0.5, `${p.kind} stays in view (x=${p.x.toFixed(1)})`);
    assert.ok(p.y >= 0 && p.y + h <= H + HEADROOM, `${p.kind} stays below the top (y=${p.y.toFixed(1)})`);
  }
}
/** Get the critter into an activity, a few seconds in. */
export function doing(activity, seed = 3, setup) {
  const c = wide(seed);
  c.envNext = Infinity;
  if (setup) setup(c);
  c.pending = activity;
  run(c, 4000, { dt: 50 });
  return c;
}
/** Run until a condition holds (or fail after `ms`). */
export function until(c, cond, ms, what, each) {
  const end = c.now + ms;
  while (!cond()) {
    assert.ok(c.now < end, `${what} (after ${ms} ms) [${c.activity}/${c.inReaction}]`);
    run(c, 100, { from: c.now + 50, dt: 50, each });
  }
}
/** The app's playground at 1280 px: the editor's whole width, its home stretch around TODAY, the window's corner at its left end. */
export function world(seed, opts = {}) { return make(seed, { width: () => 1270, margin: () => 24, home: () => ({ lo: 450, hi: 1010 }), corner: () => true, ...opts }); }
export const STEPPING = /^(walk|run|creep)/;
/** Every move along the ground is a step of the legs, taken with the frame and held (never glided), no longer than they reach. */
export function walksNotSlides(c) {
  const s = c.step;
  if (s && STEPPING.test(s.f) && !s.still && !s.jump && !s.lift && !s.flip) assert.ok(s.x1 !== s.x0, `${s.f}: its legs walk on the spot [${c.activity}/${c.inReaction}]`);
  if (!s || !s.ground) return;
  const wiggle = Math.abs(s.dx) <= 1 && (s.f === 'crouch' || s.f === 'cower'); // a wiggle on the spot before a pounce, a shiver
  const roll = s.f === 'fallen' || s.f === 'lie';                               // rolling over and over
  assert.ok(STEPPING.test(s.f) || wiggle || roll, `${s.f} moves ${s.dx.toFixed(1)} px on the ground without stepping [${c.activity}/${c.inReaction}]`);
  assert.equal(c.x, s.x1, `the stride is taken with the frame, not glided through [${s.f} in ${c.activity}]`);
  if (STEPPING.test(s.f)) assert.ok(Math.abs(s.x1 - s.x0) <= 3 * c.du + 1e-9, `a stride its legs can reach: ${(s.x1 - s.x0).toFixed(2)} px [${c.activity}]`);
}
export const MINUTE = 60000;
/** Writing now and then (about every `every` ms on average) while it runs. */
export const writer = (c, rng, every = 4000, dt = 100) => () => { if (rng() < dt / every) c.wrote(3, c.now); };
/** How often each activity is chosen in this state (many independent choices). */
export function chosen(c, n, now = 1e9, each) {
  const k = {};
  for (let i = 0; i < n; i++) { c.recent = []; c.energy = c.rng(); if (each) each(c, i); const a = c.pickActivity(now); k[a] = (k[a] || 0) + 1; }
  return k;
}
