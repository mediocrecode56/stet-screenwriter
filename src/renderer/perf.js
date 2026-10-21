// In-app performance probe. Drives the real editor, view and input paths on
// generated scripts and measures input-to-frame latency, not just JS time, then
// scores the results against fixed budgets (100 = everything within budget).
// Run with `npm run perf` (writes .perf/renderer-results.json) or from
// Tools > Run Performance Probe (shows the score in a dialog).
//
// It leaves no trace: the screenplay that was open comes back as it was, and the
// probe's own scripts are never autosaved, recovered, backed up, counted in the
// writing statistics or added to Open Recent (they are saved only to a scratch
// folder, deleted afterwards).

import { generateScript } from '../dev/sample.js';
import { newDocument } from '../core/model.js';
import { paginate } from '../core/layout.js';
import { pos } from '../core/editor.js';
import * as dlg from './ui/dialog.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), max: +s[s.length - 1].toFixed(3), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3) };
}

async function timeIt(fn) { const t = performance.now(); await fn(); return performance.now() - t; }

/** The display's frame time (ms), from the median of a few animation frames. */
async function frameTime() {
  const ts = [];
  for (let i = 0; i < 12; i++) ts.push(await new Promise((r) => requestAnimationFrame(r)));
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  return d[d.length >> 1] || 16.7;
}

/**
 * What is scored, on the large script: [label, value, budget (ms), weight].
 * Within budget scores 100; over it, in proportion (twice the budget = 50).
 * Typing must show on the next frame, so its budget follows the display.
 */
function scoreOf(r, frame) {
  const items = [
    ['Typing to screen (p95)', r.typingToFrame.p95, frame + 4, 3],
    ['Typing while saving (p95)', r.typingDuringSave.p95, frame + 4, 2],
    ['Keystroke work (p95)', r.typingJs.p95, 4, 2],
    ['New line (p95)', r.enterJs.p95, 4, 1],
    ['Caret move (p95)', r.arrowDownJs.p95, 2, 1],
    ['Scroll frame (p95)', r.scrollFrame.p95, 8, 1],
    ['Scene jump (p95)', r.sceneJump.p95, 8, 1],
    ['Open the script', r.openMs, 250, 1],
    ['Repaginate everything', r.paginateFull.p50, 8, 1],
    ['Find all', r.findAll.p50, 16, 0.5],
    ['Save round trip', r.saveRoundTrip, 150, 1],
  ].map(([label, value, budget, weight]) => ({ label, value, budget: +budget.toFixed(1), weight, score: value <= budget ? 100 : Math.round(100 * budget / value) }));
  const w = items.reduce((a, i) => a + i.weight, 0);
  return { score: Math.round(items.reduce((a, i) => a + i.score * i.weight, 0) / w), items };
}

const grade = (s) => (s >= 95 ? 'EXCELLENT' : s >= 85 ? 'GOOD' : s >= 70 ? 'FAIR' : 'SLOW');

async function probeCase({ pages, editor, view, input, session, scratch }) {
  const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null);
  const doc = newDocument('PERF');
  doc.blocks = generateScript(pages, 11);
  const tLoad = await timeIt(async () => { session.load(doc, null); view.relayout(); view.frame(); await nextFrame(); });
  const r = { blocks: doc.blocks.length, pages: view.pages.length, words: editor.words, openMs: +tLoad.toFixed(1), heapMB: heap() };

  // Full pagination (pure JS).
  const full = [];
  for (let i = 0; i < 10; i++) { const t = performance.now(); paginate(editor.blocks, doc.settings); full.push(performance.now() - t); }
  r.paginateFull = stats(full);

  // Typing in the middle of the script: input -> edit -> layout -> paint.
  let bi = Math.floor(editor.blocks.length / 2);
  while (editor.blocks[bi].type !== 'action') bi++;
  editor.setSel(pos(bi, editor.blocks[bi].text.length));
  view.revealCaret(true);
  await nextFrame();
  const lat = [], js = [];
  for (const ch of ' She crosses to the window and waits for the rain to stop before she speaks again.') {
    const t0 = performance.now();
    input.typed(ch);
    js.push(performance.now() - t0);
    await nextFrame();
    lat.push(performance.now() - t0);
  }
  r.typingJs = stats(js);
  r.typingToFrame = stats(lat);

  // Enter / Tab element flow.
  const en = [];
  for (let k = 0; k < 20; k++) {
    const t0 = performance.now();
    editor.enter(); input.after();
    en.push(performance.now() - t0);
    await nextFrame();
  }
  for (let k = 0; k < 20; k++) editor.undo();
  input.after();
  r.enterJs = stats(en);

  // Caret movement.
  const mv = [];
  for (let k = 0; k < 100; k++) {
    const t0 = performance.now();
    input.keydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    mv.push(performance.now() - t0);
    if (k % 10 === 0) await nextFrame();
  }
  r.arrowDownJs = stats(mv);

  // Scrolling through the whole script, two viewports per frame.
  const sc = view.scroller;
  sc.scrollTop = 0;
  await nextFrame();
  const fr = [];
  for (let y = 0; y < sc.scrollHeight; y += 2 * sc.clientHeight) {
    sc.scrollTop = y;
    const t0 = performance.now();
    view.frame();
    fr.push(performance.now() - t0);
    await nextFrame();
  }
  r.scrollFrame = stats(fr);

  // Scene jumps.
  const sj = [];
  const sceneList = editor.scenes();
  for (let k = 0; k < Math.min(60, sceneList.length); k++) {
    const s = sceneList[(k * 37) % sceneList.length];
    const t0 = performance.now();
    editor.setSel(pos(s.b, 0)); view.frame(); view.revealCaret(true); view.frame();
    sj.push(performance.now() - t0);
  }
  r.sceneJump = stats(sj);

  // Find / replace.
  const tf = [];
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); editor.findAll('the'); tf.push(performance.now() - t0); }
  r.findAll = stats(tf);
  r.findMatches = editor.findAll('the').length;
  const m = editor.findAll('rain');
  r.replaceAllMs = +(await timeIt(() => { editor.replaceMatches(m, 'snow'); view.relayout(); view.frame(); })).toFixed(2);
  r.replaceCount = m.length;
  editor.undo(); view.relayout(); view.frame();

  // Serialization (main-thread part of every save).
  const ser = [];
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); session.serialize(); ser.push(performance.now() - t0); }
  r.serialize = stats(ser);
  r.jsonKB = Math.round(session.serialize().length / 1024);

  // Typing while saves run in the background (to the scratch file only).
  session.path = scratch;
  const sl = [], saves = [];
  for (let k = 0; k < 30; k++) {
    if (k % 5 === 0) saves.push(session.writeFile());
    const t0 = performance.now();
    input.typed('x');
    await nextFrame();
    sl.push(performance.now() - t0);
  }
  r.savesOk = (await Promise.all(saves)).every((x) => x.ok);
  r.typingDuringSave = stats(sl);
  r.saveRoundTrip = +(await timeIt(() => session.writeFile({ force: true }))).toFixed(1);
  session.path = null;

  // Long session: many edits, then memory.
  const h0 = heap();
  for (let k = 0; k < 3000; k++) { editor.insertText(k % 7 === 0 ? ' ' : 'a'); if (k % 500 === 0) { view.relayout(); view.frame(); } }
  view.relayout(); view.frame();
  r.heapAfterEditsMB = heap();
  r.heapDeltaMB = h0 != null ? +(heap() - h0).toFixed(1) : null;
  return r;
}

export async function runPerfProbe({ editor, view, input, session, writing, api, report }) {
  // Put the open screenplay aside (saved first, as on any switch) and silence everything that
  // would otherwise remember the probe's scripts.
  await session.flushAll();
  session.doc.blocks = editor.blocks;
  const prev = { doc: session.doc, path: session.path, dirty: session.dirty, caret: editor.caret, scroll: view.scroller.scrollTop };
  const recording = writing.enabled;
  writing.enabled = false;
  session.quiet = true;
  const scratch = await api.invoke('perf:scratch');
  const results = { when: new Date().toISOString(), cases: {} };
  try {
    const frame = await frameTime();
    for (const pages of [120, 400]) results.cases[`${pages}p`] = await probeCase({ pages, editor, view, input, session, scratch });
    Object.assign(results, scoreOf(results.cases['400p'], frame), { frameMs: +frame.toFixed(1) });
    results.ui = { devicePixelRatio, viewport: `${innerWidth}x${innerHeight}` };
  } finally {
    await api.invoke('perf:cleanup');
    session.quiet = false;
    writing.enabled = recording;
    session.load(prev.doc, prev.path, { dirty: prev.dirty });
    await nextFrame();
    editor.setSel(prev.caret);
    view.scroller.scrollTop = prev.scroll;
    view.frame();
    input.after();
  }
  if (report) { await api.invoke('perf:report', results); return results; }
  showResults(results);
  return results;
}

function showResults(r) {
  const { h } = dlg;
  const fmt = (v) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString());
  const rows = r.items.map((i) => h('tr', {},
    h('td', {}, i.label), h('td', { class: 'pf-n' }, `${fmt(i.value)} ms`), h('td', { class: 'pf-n pf-dim' }, `≤ ${fmt(i.budget)}`), h('td', { class: 'pf-n' }, String(i.score))));
  const big = r.cases['400p'];
  const body = h('div', { class: 'body pf' },
    h('div', { class: 'pf-head' }, h('div', { class: 'pf-score' }, String(r.score)), h('div', {}, h('div', { class: 'pf-grade' }, grade(r.score)), h('div', { class: 'pf-dim' }, `out of 100 · ${big.pages} pages · display ${fmt(r.frameMs)} ms per frame`))),
    h('table', { class: 't pf-t' }, h('thead', {}, h('tr', {}, h('th', {}, 'Measured on the large script'), h('th', { class: 'pf-n' }, 'Time'), h('th', { class: 'pf-n' }, 'Budget'), h('th', { class: 'pf-n' }, 'Score'))), h('tbody', {}, ...rows)),
    h('p', { class: 'hint' }, 'Your screenplay was put back as it was; nothing from the probe was kept.'));
  dlg.open({ title: 'PERFORMANCE', body, cls: 'pf-dlg', buttons: [{ label: 'Close', value: null, primary: true }] });
}
