// In-app performance probe: does this computer run STET smoothly? It drives the real editor, view
// and input on generated scripts, a feature-length one and a long one, and measures what a writer
// would feel, from key to frame. core/perfscore.js turns that into a score from 0 to 100. Run with
// `npm run perf` (writes .perf/renderer-results.json) or Tools > Run Performance Probe.
//
// It cannot get stuck. Every step is a stage with a time limit, and each loop asks the clock rather
// than counting to a fixed number, so a slow computer simply takes fewer samples. A stage that fails
// or never returns costs only that stage; a frame that never comes (a covered or minimised window)
// is noticed and those measures are left out, and the score says so. The window stays responsive
// throughout, and Esc or Cancel ends the run at once.
//
// It leaves no trace: the screenplay that was open comes back as it was, undo history included, and
// the probe's own scripts are never autosaved, recovered, backed up, counted in the writing
// statistics or added to Open Recent (they are saved only to a scratch folder, deleted afterwards).

import { generateScript } from '../dev/sample.js';
import { newDocument } from '../core/model.js';
import { paginate } from '../core/layout.js';
import { pos } from '../core/editor.js';
import { stats, runStages, scoreResults, reliability, describeSystem } from '../core/perfscore.js';
import * as dlg from './ui/dialog.js';

const RUN_MS = 45000;    // the whole test, on the slowest computer
const LOST_MS = 1000;    // a frame this late is taken as not coming
const LOST_IN_A_ROW = 3; // and after this many there are no frames to measure
const TEXT = ' She crosses to the window and waits for the rain to stop before she speaks again.';

/** Waits for the next frame to be drawn; false if it does not come. */
const nextFrame = (ms = LOST_MS) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), ms);
  requestAnimationFrame(() => setTimeout(() => { clearTimeout(timer); resolve(true); }, 0));
});
const rest = () => new Promise((r) => setTimeout(r, 0));
const within = (promise, ms, fallback = null) => {
  let timer;
  return Promise.race([promise, new Promise((r) => { timer = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(timer));
};
const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null);

/** The graphics card's name, as the browser engine knows it (null where it will not say). */
function graphicsName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const name = gl && gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name.replace(/^ANGLE \([^,]*,\s*/, '').replace(/\s*\(0x.*$|\s+Direct3D.*$|,.*$/, '').trim() : null;
  } catch { return null; }
}

/** A fixed piece of layout work, the same at the start and end of a run: if it got slower, the computer did. */
function referenceWork() {
  const blocks = generateScript(20, 3), doc = newDocument('REF'), times = [];
  for (let i = 0; i < 3; i++) {
    const fresh = blocks.map((b) => ({ ...b })), t0 = performance.now();
    paginate(fresh, doc.settings);
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[1];
}

/** The display's frame time (ms) and how evenly frames come, from a few frames at rest. */
async function measureFrames(run, t) {
  const gaps = [];
  let last = performance.now();
  while (gaps.length < 24 && t.more() && !run.noFrames) {
    const ok = await run.frame(), now = performance.now();
    if (ok) gaps.push(now - last);
    last = now;
  }
  const s = stats(gaps);
  if (!s) return;
  run.frameMs = s.p50;
  run.jitter = s.p95 / Math.max(s.p50, 0.1);
}

/** The steps for one script. Each reads and writes `r`, the script's measurements. */
function caseStages(pages, run, r) {
  const { editor, view, input, session } = run;
  const doc = newDocument('PERF');
  const size = `the ${pages}-page script`;
  const step = (name, say, limitMs, fn) => ({
    name: `${pages}p ${name}`, label: `${say.toLowerCase()} (${pages} pages)`, say: `${say}, ${pages} pages`, limitMs, skipLabel: size,
    skip: () => (name === 'open' ? !run.fits() : !r.pages),
    run: fn,
  });
  return [
    step('open', 'Opening', 8000, async () => {
      run.caseStart = performance.now();
      doc.blocks = generateScript(pages, 11);
      const t0 = performance.now();
      session.load(doc, null); view.relayout(); view.frame();
      await run.frame();
      Object.assign(r, { openMs: +(performance.now() - t0).toFixed(1), blocks: doc.blocks.length, pages: view.pages.length, words: editor.words, heapMB: heap() });
    }),
    step('layout', 'Laying out pages', 3000, async (t) => {
      const times = [];
      for (let i = 0; i < 10 && t.more(); i++) {
        const fresh = editor.blocks.map((b) => ({ ...b })), t0 = performance.now(); // (new paragraphs: a real layout, not the cache)
        paginate(fresh, doc.settings);
        times.push(performance.now() - t0);
        await t.breathe();
      }
      r.paginateFull = stats(times);
    }),
    step('typing', 'Typing', 4000, async (t) => {
      let bi = editor.blocks.findIndex((b, i) => i >= editor.blocks.length >> 1 && b.type === 'action');
      if (bi < 0) bi = editor.blocks.length - 1;
      editor.setSel(pos(bi, editor.blocks[bi].text.length));
      view.revealCaret(true);
      await run.frame();
      const lat = [], js = [];
      for (const ch of TEXT) {
        if (!t.more()) break;
        const t0 = performance.now();
        input.typed(ch);
        js.push(performance.now() - t0);
        if (await run.frame()) lat.push(performance.now() - t0);
      }
      r.typingJs = stats(js);
      r.typingToFrame = stats(lat);
    }),
    step('enter', 'New lines', 2000, async (t) => {
      const en = [];
      while (en.length < 20 && t.more()) {
        const t0 = performance.now();
        editor.enter(); input.after();
        en.push(performance.now() - t0);
        await run.frame();
      }
      for (let k = 0; k < en.length; k++) editor.undo();
      input.after();
      r.enterJs = stats(en);
    }),
    step('caret', 'Moving the caret', 1000, async (t) => {
      const mv = [];
      while (mv.length < 100 && t.more()) {
        const t0 = performance.now();
        input.keydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        mv.push(performance.now() - t0);
        await t.breathe();
      }
      r.arrowDownJs = stats(mv);
    }),
    step('scroll', 'Scrolling', 4000, async (t) => {
      const sc = view.scroller, fr = [], pace = [];
      sc.scrollTop = 0;
      await run.frame();
      const by = Math.max(2 * sc.clientHeight, sc.scrollHeight / 120, 1); // (through the whole script in at most 120 frames)
      let last = performance.now();
      for (let y = 0; y < sc.scrollHeight && t.more(); y += by) {
        sc.scrollTop = y;
        const t0 = performance.now();
        view.frame();
        fr.push(performance.now() - t0);
        const ok = await run.frame(), now = performance.now();
        if (ok) pace.push(now - last);
        last = now;
      }
      r.scrollFrame = stats(fr);
      r.scrollPacing = stats(pace);
    }),
    step('scenes', 'Jumping between scenes', 1000, async (t) => {
      const sj = [], list = editor.scenes();
      for (let k = 0; k < Math.min(60, list.length) && t.more(); k++) {
        const s = list[(k * 37) % list.length], t0 = performance.now();
        editor.setSel(pos(s.b, 0)); view.frame(); view.revealCaret(true); view.frame();
        sj.push(performance.now() - t0);
        await t.breathe();
      }
      r.sceneJump = stats(sj);
    }),
    step('find', 'Finding', 1000, async (t) => {
      const tf = [];
      for (let k = 0; k < 5 && t.more(); k++) {
        const t0 = performance.now();
        r.findMatches = editor.findAll('the').length;
        tf.push(performance.now() - t0);
        await t.breathe();
      }
      r.findAll = stats(tf);
      const m = editor.findAll('rain'), t0 = performance.now();
      editor.replaceMatches(m, 'snow'); view.relayout(); view.frame();
      r.replaceAllMs = +(performance.now() - t0).toFixed(2);
      r.replaceCount = m.length;
      editor.undo(); view.relayout(); view.frame();
    }),
    step('save', 'Saving', 9000, async (t) => {
      const ser = [];
      for (let k = 0; k < 5 && t.more(); k++) {
        const t0 = performance.now();
        r.jsonKB = Math.round(session.serialize().length / 1024);
        ser.push(performance.now() - t0);
        await t.breathe();
      }
      r.serialize = stats(ser);
      session.path = run.scratch; // (only the scratch file: the probe's folder)
      try {
        const sl = [], saves = [];
        for (let k = 0; k < 30 && t.more(); k++) {
          if (k % 5 === 0) saves.push(session.writeFile());
          const t0 = performance.now();
          input.typed('x');
          if (await run.frame()) sl.push(performance.now() - t0);
        }
        const all = await within(Promise.all(saves), 4000);
        r.savesOk = !!all && all.every((x) => x.ok);
        r.typingDuringSave = stats(sl);
        const t0 = performance.now(), last = await within(session.writeFile({ force: true }), 4000);
        if (last?.ok) r.saveRoundTrip = +(performance.now() - t0).toFixed(1);
      } finally {
        session.path = null;
        session.saving = null; // (a save still out there is the scratch file's, and is left to finish)
      }
    }),
    step('session', 'Writing at length', 1500, async (t) => {
      const h0 = heap();
      let n = 0;
      while (n < 3000 && t.more()) {
        editor.insertText(n % 7 === 0 ? ' ' : 'a');
        if (++n % 200 === 0) { view.relayout(); view.frame(); }
        await t.breathe();
      }
      view.relayout(); view.frame();
      r.edits = n;
      r.heapAfterEditsMB = heap();
      r.heapDeltaMB = h0 != null ? +(heap() - h0).toFixed(1) : null;
      run.caseMs = performance.now() - run.caseStart;
    }),
  ];
}

let running = null;
let stopRequested = false;

/** Ends a run under way, the screenplay put back, and resolves when that is done (at once if none is). */
export function stopPerfProbe() {
  if (!running) return Promise.resolve();
  stopRequested = true;
  return running.catch(() => {});
}

/** The run in progress, if there is one: a second request is the same run, never one on top of it. */
export function runPerfProbe(opts) {
  if (running) return running;
  stopRequested = false;
  running = probe(opts).finally(() => { running = null; });
  return running;
}

/** A window saying what is being measured, with Cancel. */
function progressWindow() {
  const say = dlg.h('span', {}, 'Getting ready'), amt = dlg.h('span', { class: 'upd-amt' }, ''), fill = dlg.h('i', {});
  let close = null;
  const closed = dlg.open({
    title: 'PERFORMANCE',
    cls: 'upd',
    body: dlg.h('div', { class: 'body' },
      dlg.h('p', {}, 'Testing how STET runs here. This takes under a minute.'),
      dlg.h('div', { class: 'upd-stage' }, say, amt),
      dlg.h('div', { class: 'upd-bar' }, fill)),
    buttons: [{ label: 'Cancel', value: 'cancel' }],
    init: (_d, c) => { close = c; },
  });
  closed.then((v) => { if (v !== 'done') stopRequested = true; }); // (Cancel, Esc or a click outside)
  return {
    update(text, part) { say.textContent = text; const p = Math.round(part * 100); amt.textContent = `${p}%`; fill.style.width = `${p}%`; },
    close() { close?.('done'); },
  };
}

async function probe({ editor, view, input, session, writing, api, report, sizes = [120, 400], limitMs = RUN_MS }) {
  const show = report ? null : progressWindow();
  const results = { when: new Date().toISOString(), cases: {} };
  // The open screenplay is saved first, as on any switch; if that cannot be done, nothing is touched.
  const flushed = await within(session.flushAll().then(() => true, () => false), 8000, false);
  if (!flushed && session.dirty && session.path || stopRequested) {
    show?.close();
    if (!stopRequested) dlg.alertBox('PERFORMANCE', 'The test did not start: your screenplay could not be saved first.');
    return { ...results, cancelled: stopRequested, score: null };
  }
  session.doc.blocks = editor.blocks;
  const prev = { doc: session.doc, path: session.path, dirty: session.dirty, caret: editor.caret, scroll: view.scroller.scrollTop, undo: [...editor.undoStack], redo: [...editor.redoStack] };
  const recording = writing.enabled;
  writing.enabled = false;
  session.quiet = true;

  const started = performance.now();
  const run = {
    editor, view, input, session, scratch: null, frameMs: null, jitter: 1, framesAsked: 0, framesLost: 0, noFrames: false, lostInARow: 0, caseMs: null, caseStart: 0,
    /** Waits a frame, keeping count of the ones that never came. */
    async frame() {
      if (this.noFrames) { await rest(); return false; }
      this.framesAsked++;
      if (await nextFrame()) { this.lostInARow = 0; return true; }
      this.framesLost++;
      if (++this.lostInARow >= LOST_IN_A_ROW) this.noFrames = true;
      return false;
    },
    /** Whether another script can be done in the time left (from how long the last one took). */
    fits() { return this.caseMs == null || limitMs - (performance.now() - started) > this.caseMs * 1.2; },
  };

  let reference = null, drift = 1, system = null;
  const names = sizes.map((pages) => `${pages}p`);
  const stages = [
    { name: 'scratch', say: 'Getting ready', limitMs: 4000, run: async () => { run.scratch = await api.invoke('perf:scratch'); if (!run.scratch) throw new Error('no scratch folder'); } },
    { name: 'system', say: 'Looking at this computer', limitMs: 3000, run: async () => { system = { ...(await within(api.invoke('perf:system'), 2500, {})), gpu: graphicsName() }; } },
    { name: 'display', label: 'the display', say: 'Measuring the display', limitMs: 3000, run: (t) => measureFrames(run, t) },
    { name: 'reference', say: 'Warming up', limitMs: 3000, run: () => { reference = referenceWork(); } },
    ...sizes.flatMap((pages, i) => caseStages(pages, run, (results.cases[names[i]] = {}))),
    { name: 'reference again', say: 'Finishing', limitMs: 3000, run: () => { if (reference) drift = referenceWork() / Math.max(reference, 0.01); } },
  ];

  let outcome = { done: [], failed: ['the test'], skipped: [], errors: {}, stopped: false };
  try {
    outcome = await runStages(stages, {
      limitMs, rest, stopped: () => stopRequested,
      onStage: (stage, i, n) => show?.update(stage.say || 'Measuring', i / n),
    });
  } catch (e) {
    outcome.errors.run = String(e?.message || e);
  } finally {
    await restore({ prev, recording, editor, view, input, session, writing, api });
  }

  const cases = names.map((n) => results.cases[n]).filter((c) => c.pages);
  for (const n of names) if (!results.cases[n].pages) delete results.cases[n];
  const score = scoreResults(cases, run.frameMs);
  Object.assign(results, score, {
    frameMs: run.frameMs == null ? null : +run.frameMs.toFixed(1),
    system, systemText: describeSystem(system || {}),
    reliability: reliability({ framesLost: run.framesLost, framesAsked: run.framesAsked, noFrames: run.noFrames, drift, jitter: run.jitter, failed: outcome.failed, skipped: outcome.skipped, coverage: score.coverage, software: !!system?.software, battery: !!system?.battery }),
    stages: { done: outcome.done.length, failed: outcome.failed, skipped: outcome.skipped, errors: outcome.errors },
    seconds: +((performance.now() - started) / 1000).toFixed(1),
    ui: { devicePixelRatio, viewport: `${innerWidth}x${innerHeight}` },
  });
  if (outcome.stopped) {
    show?.close();
    if (report) await within(api.invoke('perf:report', { ...results, cancelled: true }), 4000);
    return { ...results, cancelled: true };
  }
  if (report) { await within(api.invoke('perf:report', results), 4000); return results; }
  show?.close();
  showResults(results);
  return results;
}

/** The writer's screenplay back as it was. Each part is on its own: one failing never stops the next. */
async function restore({ prev, recording, editor, view, input, session, writing, api }) {
  const attempt = (fn) => { try { fn(); } catch (e) { console.error('perf restore', e); } };
  await within(api.invoke('perf:cleanup'), 3000);
  session.quiet = false;
  writing.enabled = recording;
  attempt(() => session.load(prev.doc, prev.path, { dirty: prev.dirty }));
  attempt(() => { editor.undoStack.push(...prev.undo); editor.redoStack.push(...prev.redo); });
  await nextFrame(200);
  attempt(() => editor.setSel(prev.caret));
  attempt(() => { view.scroller.scrollTop = prev.scroll; view.frame(); input.after(false); });
}

function showResults(r) {
  const { h } = dlg;
  const fmt = (v) => (v == null ? '–' : v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v).toLocaleString()} ms`);
  const scripts = Object.values(r.cases).map((c) => c.pages);
  const two = scripts.length > 1;
  const rows = r.items.map((i) => h('tr', {},
    h('td', {}, i.label), h('td', { class: 'pf-n' }, fmt(i.value)), two ? h('td', { class: 'pf-n pf-dim' }, fmt(i.long)) : null, h('td', { class: 'pf-n' }, String(i.score))));
  const trust = { high: 'Reliable result.', fair: 'Fairly reliable: run it again to be sure.', low: 'Not reliable.' }[r.reliability.level];
  const body = h('div', { class: 'body pf' },
    h('div', { class: 'pf-head' },
      h('div', { class: 'pf-score' }, r.score == null ? '–' : String(r.score)),
      h('div', {}, h('div', { class: 'pf-grade' }, r.grade), h('div', { class: 'pf-dim' }, r.verdict))),
    r.items.length ? h('table', { class: 't pf-t' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Measured'), ...scripts.slice(0, 2).map((p) => h('th', { class: 'pf-n' }, `${p} pages`)), h('th', { class: 'pf-n' }, 'Score'))),
      h('tbody', {}, ...rows)) : null,
    h('p', { class: 'hint' }, [trust, ...r.reliability.notes].join(' ')),
    r.systemText ? h('p', { class: 'hint' }, `${r.systemText}${r.frameMs ? ` · display ${Math.round(1000 / r.frameMs)} Hz` : ''}`) : null,
    h('p', { class: 'hint' }, 'Your screenplay was put back as it was; nothing from the test was kept.'));
  dlg.open({ title: 'PERFORMANCE', body, cls: 'pf-dlg', buttons: [{ label: 'Close', value: null, primary: true }] });
}
