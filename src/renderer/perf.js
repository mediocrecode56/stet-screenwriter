// In-app performance probe. Drives the real editor, view and input paths on
// generated scripts and measures input-to-frame latency, not just JS time.
// Run with `npm run perf` (writes .perf/renderer-results.json) or from
// Tools > Run Performance Probe (shows results in a dialog).

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

export async function runPerfProbe({ editor, view, input, session, api, report }) {
  const results = { when: new Date().toISOString(), cases: {} };
  const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null);

  for (const pagesTarget of [120, 400]) {
    const doc = newDocument('PERF');
    doc.blocks = generateScript(pagesTarget, 11);
    const tag = `${pagesTarget}p`;
    const tLoad = await timeIt(async () => { session.load(doc, null); view.relayout(); view.frame(); await nextFrame(); });
    const r = { blocks: doc.blocks.length, pages: view.pages.length, words: editor.words, openMs: +tLoad.toFixed(1), heapMB: heap() };

    // Full vs incremental pagination (pure JS).
    const full = [];
    for (let i = 0; i < 20; i++) { const t = performance.now(); paginate(editor.blocks, doc.settings); full.push(performance.now() - t); }
    r.paginateFull = stats(full);

    // Typing in the middle of the script: input -> edit -> layout -> paint.
    const mid = Math.floor(editor.blocks.length / 2);
    let bi = mid;
    while (editor.blocks[bi].type !== 'action') bi++;
    editor.setSel(pos(bi, editor.blocks[bi].text.length));
    view.revealCaret(true);
    await nextFrame();
    const lat = [], js = [];
    const text = ' She crosses to the window and waits for the rain to stop before she speaks again.';
    for (let k = 0; k < 3; k++) {
      for (const ch of text) {
        const t0 = performance.now();
        input.typed(ch);
        js.push(performance.now() - t0);
        await nextFrame();
        lat.push(performance.now() - t0);
      }
    }
    r.typingJs = stats(js);
    r.typingToFrame = stats(lat);

    // Enter / Tab element flow.
    const en = [];
    for (let k = 0; k < 40; k++) {
      const t0 = performance.now();
      editor.enter(); input.after(true);
      en.push(performance.now() - t0);
      await nextFrame();
    }
    for (let k = 0; k < 40; k++) editor.undo();
    input.after();
    r.enterJs = stats(en);

    // Caret movement.
    const mv = [];
    for (let k = 0; k < 200; k++) {
      const t0 = performance.now();
      input.keydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      mv.push(performance.now() - t0);
      if (k % 10 === 0) await nextFrame();
    }
    r.arrowDownJs = stats(mv);

    // Scrolling through the whole script, one viewport per frame.
    const sc = view.scroller;
    sc.scrollTop = 0;
    await nextFrame();
    const fr = [];
    const stepPx = sc.clientHeight;
    for (let y = 0; y < sc.scrollHeight; y += stepPx) {
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
    for (let k = 0; k < Math.min(100, sceneList.length); k++) {
      const s = sceneList[(k * 37) % sceneList.length];
      const t0 = performance.now();
      editor.setSel(pos(s.b, 0)); view.frame(); view.revealCaret(true); view.frame();
      sj.push(performance.now() - t0);
    }
    r.sceneJump = stats(sj);

    // Find / replace.
    const tf = [];
    for (let k = 0; k < 10; k++) { const t0 = performance.now(); editor.findAll('the'); tf.push(performance.now() - t0); }
    r.findAll = stats(tf);
    r.findMatches = editor.findAll('the').length;
    const m = editor.findAll('rain');
    r.replaceAllMs = +(await timeIt(() => { editor.replaceMatches(m, 'snow'); view.relayout(); view.frame(); })).toFixed(2);
    r.replaceCount = m.length;
    editor.undo(); view.relayout(); view.frame();

    // Serialization (main-thread part of every save).
    const ser = [];
    for (let k = 0; k < 10; k++) { const t0 = performance.now(); session.serialize(); ser.push(performance.now() - t0); }
    r.serialize = stats(ser);
    r.jsonKB = Math.round(session.serialize().length / 1024);

    // Typing while saves run in the background.
    const info = await api.invoke('app:info');
    const tmp = await api.invoke('path:join', info.userData, 'perf-probe.stet');
    session.path = tmp;
    const sl = [];
    const saves = [];
    for (let k = 0; k < 60; k++) {
      if (k % 10 === 0) saves.push(session.writeFile());
      const t0 = performance.now();
      input.typed('x');
      await nextFrame();
      sl.push(performance.now() - t0);
    }
    const saveRes = await Promise.all(saves);
    r.typingDuringSave = stats(sl);
    r.savesOk = saveRes.every((x) => x.ok);
    r.saveRoundTrip = +(await timeIt(() => session.writeFile({ force: true }))).toFixed(1);

    // Long session: many edits, then memory.
    const h0 = heap();
    for (let k = 0; k < 5000; k++) { editor.insertText(k % 7 === 0 ? ' ' : 'a'); if (k % 500 === 0) { view.relayout(); view.frame(); } }
    view.relayout(); view.frame();
    r.heapAfter5000EditsMB = heap();
    r.heapDeltaMB = h0 != null ? +(heap() - h0).toFixed(1) : null;
    results.cases[tag] = r;
    session.path = null;
  }

  // Leave a clean untitled document behind.
  session.newUntitled();
  results.ui = { devicePixelRatio: devicePixelRatio, viewport: `${innerWidth}x${innerHeight}` };
  if (report) { await api.invoke('perf:report', results); return results; }
  const pre = dlg.h('pre', { style: 'max-height:60vh;overflow:auto;font-size:11px;user-select:text' }, JSON.stringify(results, null, 1));
  dlg.open({ title: 'PERFORMANCE PROBE', body: dlg.h('div', { class: 'body' }, pre), buttons: [{ label: 'Close', value: null, primary: true }] });
  return results;
}
