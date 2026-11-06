// The performance probe's rules, kept apart from the app so they can be tested on their own:
// how a run is kept to its time, and how what was measured becomes a score from 0 to 100.
//
// Nothing here knows any hardware. The score comes from how the running app behaved, against
// what a person can notice: a future computer, a virtual machine or a phone-sized laptop is
// judged by the same measures, and only the display's own frame time (measured) moves them.
// docs/PERFORMANCE.md explains the method.

/** Summary of a list of times (ms). Null with no samples: a measure not taken is never a zero. */
export function stats(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (v) => +v.toFixed(3);
  return { n: s.length, p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]), mean: r(s.reduce((a, b) => a + b, 0) / s.length) };
}

export const SMOOTH_SCORE = 70; // a measure exactly at its `smooth` mark

/**
 * A time as a score. At or under `ideal`: 100, nothing more to feel. At `smooth`: 70, the last
 * point it still feels smooth. At `limit`: 0, too slow to work with. Between them the score falls
 * by ratio (log scale), since twice as slow is the same step at any speed.
 */
export function curve(value, { ideal, smooth, limit }) {
  if (!Number.isFinite(value)) return null;
  const lerp = (v, a, b) => Math.log(v / a) / Math.log(b / a);
  if (value <= ideal) return 100;
  if (value <= smooth) return Math.round(100 - (100 - SMOOTH_SCORE) * lerp(value, ideal, smooth));
  if (value >= limit) return 0;
  return Math.round(SMOOTH_SCORE * (1 - lerp(value, smooth, limit)));
}

const p95 = (k) => (c) => c[k]?.p95;
const p50 = (k) => (c) => c[k]?.p50;

/**
 * What is scored: [key, label, weight, where to read it, marks (from the display's frame time f)].
 * Marks are what people notice, in ms. The ones that wait for a frame also allow for slow
 * displays (a remote desktop at 30 frames a second cannot show a key sooner than that).
 * `key` measures decide the verdict: a fast computer that stutters while typing is not smooth.
 */
export const MEASURES = [
  { id: 'typing', label: 'Typing to screen', weight: 3, key: true, read: p95('typingToFrame'), marks: (f) => ({ ideal: Math.max(f + 4, 20), smooth: Math.max(2 * f + 4, 50), limit: Math.max(8 * f, 400) }) },
  { id: 'saving', label: 'Typing while saving', weight: 2, key: true, read: p95('typingDuringSave'), marks: (f) => ({ ideal: Math.max(f + 4, 20), smooth: Math.max(2 * f + 4, 50), limit: Math.max(8 * f, 400) }) },
  { id: 'scroll', label: 'Scrolling, frame to frame', weight: 2, key: true, read: p95('scrollPacing'), marks: (f) => ({ ideal: Math.max(1.3 * f, 20), smooth: Math.max(2.2 * f, 40), limit: Math.max(8 * f, 250) }) },
  { id: 'work', label: 'Work for each key', weight: 2, read: p95('typingJs'), marks: () => ({ ideal: 4, smooth: 16, limit: 150 }) },
  { id: 'stall', label: 'Longest stall while typing', weight: 1, read: (c) => c.typingToFrame?.max, marks: (f) => ({ ideal: Math.max(3 * f, 50), smooth: Math.max(6 * f, 120), limit: 1000 }) },
  { id: 'enter', label: 'New line', weight: 1, read: p95('enterJs'), marks: () => ({ ideal: 6, smooth: 24, limit: 200 }) },
  { id: 'caret', label: 'Caret move', weight: 1, read: p95('arrowDownJs'), marks: () => ({ ideal: 3, smooth: 16, limit: 150 }) },
  { id: 'jump', label: 'Scene jump', weight: 1, read: p95('sceneJump'), marks: () => ({ ideal: 16, smooth: 50, limit: 500 }) },
  { id: 'open', label: 'Open the script', weight: 1, read: (c) => c.openMs, marks: () => ({ ideal: 250, smooth: 1000, limit: 10000 }) },
  { id: 'layout', label: 'Lay out every page', weight: 1, read: p50('paginateFull'), marks: () => ({ ideal: 16, smooth: 100, limit: 1500 }) },
  { id: 'find', label: 'Find all', weight: 0.5, read: p50('findAll'), marks: () => ({ ideal: 16, smooth: 100, limit: 1500 }) },
  { id: 'disk', label: 'Save to disk', weight: 1, read: (c) => c.saveRoundTrip, marks: () => ({ ideal: 150, smooth: 1000, limit: 15000 }) },
];

const LONG_SHARE = 0.3;  // how much the long script counts beside the feature-length one
const KEY_REACH = 25;    // the score stands at most this far above its worst key measure
const MIN_COVERAGE = 0.5; // below this share of the weight measured there is no honest score

export const grade = (s) => (s == null ? 'NO RESULT' : s >= 85 ? 'EXCELLENT' : s >= SMOOTH_SCORE ? 'GOOD' : s >= 50 ? 'FAIR' : 'SLOW');

export function verdict(s) {
  if (s == null) return 'The test could not measure enough to give a score.';
  if (s >= 85) return 'This computer runs STET smoothly, with room to spare.';
  if (s >= SMOOTH_SCORE) return 'This computer runs STET smoothly.';
  if (s >= 50) return 'STET runs here, though long scripts may feel slow.';
  return 'STET will feel slow on this computer.';
}

/**
 * cases: the measurements of each script, the feature-length one first, a long one after it.
 * Returns { score, grade, verdict, coverage, items: [{ id, label, value, long, score, weight, ... }] };
 * score is null when too little was measured to say anything.
 */
export function scoreResults(cases, frame) {
  const f = Number.isFinite(frame) && frame > 0 ? frame : 1000 / 60;
  const main = cases[0], long = cases.length > 1 ? cases[cases.length - 1] : null;
  const total = MEASURES.reduce((a, m) => a + m.weight, 0);
  const items = [];
  for (const m of MEASURES) {
    const marks = m.marks(f);
    const value = main ? m.read(main) : undefined, longValue = long ? m.read(long) : undefined;
    const a = curve(value, marks), b = curve(longValue, marks);
    if (a == null && b == null) continue;
    const score = a == null ? b : b == null ? a : Math.round(a * (1 - LONG_SHARE) + b * LONG_SHARE);
    items.push({ id: m.id, label: m.label, value: value ?? null, long: longValue ?? null, score, weight: m.weight, key: !!m.key, ideal: +marks.ideal.toFixed(1), smooth: +marks.smooth.toFixed(1) });
  }
  const measured = items.reduce((a, i) => a + i.weight, 0);
  const coverage = +(measured / total).toFixed(2);
  if (coverage < MIN_COVERAGE) return { score: null, grade: grade(null), verdict: verdict(null), coverage, items };
  const mean = items.reduce((a, i) => a + i.score * i.weight, 0) / measured;
  const keys = items.filter((i) => i.key).map((i) => i.score);
  const score = Math.max(0, Math.min(100, Math.round(keys.length ? Math.min(mean, Math.min(...keys) + KEY_REACH) : mean)));
  return { score, grade: grade(score), verdict: verdict(score), coverage, items };
}

/**
 * How far the result can be trusted, and why not more: 'high', 'fair' or 'low' and notes for the
 * writer. Everything here is seen during the run, so a busy, covered or overheating computer says
 * so rather than quietly giving a score that is not its own.
 */
export function reliability({ framesLost = 0, framesAsked = 0, noFrames = false, drift = 1, jitter = 1, failed = [], skipped = [], coverage = 1, software = false, battery = false } = {}) {
  const notes = [];
  let level = 2;
  const down = (to, note) => { level = Math.min(level, to); if (note) notes.push(note); };
  if (noFrames) down(0, 'The window was covered or minimised, so nothing on screen was measured. Keep it in view and run the test again.');
  else if (framesAsked && framesLost / framesAsked > 0.1) down(1, 'The window missed many frames during the test.');
  if (drift > 1.6) down(1, 'The computer slowed down during the test: it may be busy or hot.');
  if (jitter > 2) down(1, 'Frames came unevenly: something else was busy.');
  if (failed.length) down(coverage < 0.8 ? 0 : 1, `Not measured: ${failed.join(', ')}.`);
  if (skipped.length) down(1, `Left out for time: ${skipped.join(', ')}.`);
  if (software) notes.push('The window is drawn without the graphics card.');
  if (battery) notes.push('On battery: a computer can run slower than on mains power.');
  return { level: ['low', 'fair', 'high'][level], notes };
}

/** What the computer says about itself, for the reader only (the score never uses it): any part may be missing. */
export function describeSystem(s = {}) {
  const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const parts = [];
  if (typeof s.cpu === 'string' && s.cpu.trim()) parts.push(s.cpu.replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ').trim());
  if (num(s.cores)) parts.push(`${s.cores} threads`);
  if (num(s.memGB)) parts.push(`${Math.round(s.memGB)} GB memory`);
  if (typeof s.gpu === 'string' && s.gpu.trim()) parts.push(s.gpu.trim());
  return parts.join(' · ');
}

/**
 * What a stage is given to keep to its time. `more()` is false once the stage's time is up or the
 * run was stopped; `breathe()` lets the window answer whenever the stage has held it a moment.
 */
export class StageTime {
  constructor({ limitMs, now, stopped, rest, holdMs = 24 }) {
    this.now = now; this.isStopped = stopped; this.rest = rest; this.holdMs = holdMs;
    this.end = now() + limitMs;
    this.held = now();
    this.dead = false;
  }

  more() { return !this.dead && !this.isStopped() && this.now() < this.end; }

  async breathe() {
    if (this.now() - this.held < this.holdMs) return;
    await this.rest();
    this.held = this.now();
  }
}

/**
 * Run the stages one after another, each kept to its own limit and all of them to `limitMs`.
 * A stage that throws, or that never comes back, costs only itself: the others still run. A stage
 * never waited for past its limit, so nothing here can hang however a stage behaves.
 * Returns { done, failed, skipped, stopped }, each a list of stage names (stopped a boolean).
 */
export async function runStages(stages, { limitMs, now = () => performance.now(), stopped = () => false, rest = () => new Promise((r) => setTimeout(r, 0)), onStage = () => {}, graceMs = 1500 }) {
  const out = { done: [], failed: [], skipped: [], stopped: false, errors: {} };
  const end = now() + limitMs;
  for (const [i, stage] of stages.entries()) {
    if (stopped()) { out.stopped = true; break; }
    const left = end - now();
    if (left <= 0 || stage.skip?.()) { if (stage.skipLabel && !out.skipped.includes(stage.skipLabel)) out.skipped.push(stage.skipLabel); continue; }
    onStage(stage, i, stages.length);
    const time = new StageTime({ limitMs: Math.min(stage.limitMs ?? left, left), now, stopped, rest });
    let timer;
    const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error('took too long')), Math.min(stage.limitMs ?? left, left) + graceMs); });
    try {
      await Promise.race([Promise.resolve().then(() => stage.run(time)), late]);
      out.done.push(stage.name);
    } catch (e) {
      out.failed.push(stage.label || stage.name);
      out.errors[stage.name] = String(e?.message || e);
    } finally {
      clearTimeout(timer);
      time.dead = true; // (a stage left behind ends at its next look at the time)
    }
  }
  if (stopped()) out.stopped = true;
  return out;
}
