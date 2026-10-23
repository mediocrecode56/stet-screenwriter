// Smoke test: one start of the real app, then the workflows a release must not break, each in
// a few hundred milliseconds. `npm run quick` runs it after the unit tests; the other e2e files
// go deeper into each area (`npm run e2e`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, app;
const blocks = () => app.eval('__stet.editor.blocks.map((b) => [b.type, b.text])');
const load = (list, settings = {}) => app.eval(`(async () => {
  const { newDocument, makeBlock } = await import('../core/model.js');
  const d = newDocument('T'); d.settings.backup.enabled = false; Object.assign(d.settings, ${JSON.stringify(settings)});
  d.blocks = ${JSON.stringify(list)}.map(([t, x]) => makeBlock(t, x));
  __stet.session.load(d, null);
  await new Promise((r) => setTimeout(r, 60));
  __stet.input.focus();
})()`);
const caret = (b, o, f = o) => app.eval(`(() => { __stet.editor.setSel({ b: ${b}, o: ${o} }, { b: ${b}, o: ${f} }); __stet.input.after(); })()`);
const press = (sel, init = {}) => app.eval(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...${JSON.stringify(init)} }))`);

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-smoke-'));
  app = await App.launch({ userData: path.join(tmp, 'ud'), hidden: false }); // shown: real frames for the glide and fonts
  await app.eval('__stet.input.focus()');
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('starts with the script font, and the elements in their order', async () => {
  const r = await app.eval(`(async () => { await document.fonts.ready; return {
    font: document.fonts.check('16px "STET Courier"') && [...document.fonts].some((f) => f.family === 'STET Courier' && f.status === 'loaded'),
    types: [...document.querySelectorAll('#eltypes .tb')].map((b) => b.dataset.t),
    boxes: document.querySelectorAll('#tabcycle .cyc-box').length,
  }; })()`);
  assert.ok(r.font, 'STET Courier is loaded');
  assert.deepEqual(r.types, ['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'shot']);
  assert.equal(r.boxes, 1, 'all types in the Tab cycle: one box around them');
});

test('writing a scene from the keyboard', async () => {
  await load([['scene', '']]);
  await app.type('int. harbour - night');
  await app.key('Enter');
  await app.type('Rain.');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('mara');
  await app.key('Enter');
  await app.type('You came.');
  await app.key('Tab');
  await app.type('softly');
  assert.deepEqual(await blocks(), [['scene', 'INT. HARBOUR - NIGHT'], ['action', 'Rain.'], ['character', 'MARA'], ['dialogue', 'You came.'], ['paren', '(softly)']]);
  // Set as written: no bold of STET's own, characters 7pt apart (format.js PITCH).
  const r = await app.eval(`(() => { const l = [...document.querySelectorAll('.page .l')].find((l) => l.textContent === 'MARA');
    return { weight: getComputedStyle(l).fontWeight, cw: __stet.view.cw, col: __stet.view.col }; })()`);
  assert.equal(r.weight, '400');
  assert.ok(Math.abs(r.cw / r.col - 7 / 7.2) < 0.002, `pitch ${r.cw / r.col * 7.2}pt`);
});

test('the Tab cycle: Ctrl+click and dragging the outline choose the types; Tab steps only through them', async () => {
  await load([['action', '']]);
  await press('.tb[data-t="character"]', { ctrlKey: true });
  await press('.tb[data-t="paren"]', { ctrlKey: true });
  assert.equal(await app.eval('document.querySelectorAll("#tabcycle .cyc-box").length'), 3, 'three boxes: types kept apart');
  const seen = [];
  for (let i = 0; i < 5; i++) { await app.key('Tab'); seen.push(await app.eval('__stet.editor.block.type')); }
  assert.deepEqual(seen, ['dialogue', 'transition', 'shot', 'scene', 'action']);
  // Drag the right end of the first box (Scene, Action) over to Shot: every type between is taken in.
  await app.eval(`(() => {
    const h = document.querySelector('#tabcycle .cyc-box .cyc-h.r'), last = document.querySelector('.tb[data-t="shot"]').getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    dispatchEvent(new MouseEvent('mousemove', { clientX: last.left + last.width / 2, clientY: last.top + 5 }));
    dispatchEvent(new MouseEvent('mouseup', {}));
  })()`);
  assert.equal(await app.eval('__stet.editor.tabTypes'), null, 'all of them again');
  const saved = await app.eval(`window.stet.invoke('settings:get').then((s) => s.tabTypes)`);
  assert.equal(saved, null, 'and remembered');
  // Plain click still changes the element.
  await press('.tb[data-t="dialogue"]');
  assert.equal(await app.eval('__stet.editor.block.type'), 'dialogue');
});

test('element and alignment changes touch only the selection, or what is written next', async () => {
  await load([['action', 'She waits. He comes.'], ['action', 'Below.']]);
  await caret(0, 11);
  await app.key('Ctrl+4');
  await app.type('Hello.');
  assert.deepEqual(await blocks(), [['action', 'She waits.'], ['dialogue', 'Hello.'], ['action', 'He comes.'], ['action', 'Below.']]);
  await caret(2, 0, 9);
  await app.key('Ctrl+E');
  assert.deepEqual(await app.eval('__stet.editor.blocks.map((b) => b.align || null)'), [null, null, 'center', null]);
  for (let i = 0; i < 3; i++) await app.key('Ctrl+Z'); // the alignment, the typing, the new element
  assert.deepEqual(await blocks(), [['action', 'She waits. He comes.'], ['action', 'Below.']]);
});

test('scene navigation lands on the heading, nothing of the scene before it in view', async () => {
  const list = [];
  for (let i = 1; i <= 12; i++) {
    list.push(['scene', `INT. ROOM ${i} - DAY`]);
    for (let j = 0; j < 5; j++) list.push(['action', `Scene ${i}, line ${j}. Something happens here that takes a little room.`]);
  }
  for (const spacing of [2, 1]) {
    await load(list, { sceneSpacing: spacing });
    await caret(0, 0);
    await app.eval('document.getElementById("scroller").scrollTop = 0');
    for (let i = 0; i < 4; i++) await app.key('Alt+ArrowDown');
    await sleep(1100);
    const r = await app.eval(`(() => { const { view, editor } = __stet; const s = view.scroller.scrollTop, b = editor.caret.b;
      const prev = view.caretRect({ b: b - 1, o: 0 }); const lines = editor.blocks[b - 1].text.length;
      const end = view.caretRect({ b: b - 1, o: lines });
      return { text: editor.block.text, off: view.caretRect().y - s, blank: view.blankAbove(editor.caret), row: view.row, prevBottom: end.y + view.row - s }; })()`);
    assert.equal(r.text, 'INT. ROOM 5 - DAY');
    assert.ok(Math.abs(r.off - r.blank * r.row) <= 1 && r.blank <= spacing, `spacing ${spacing}: heading ${r.off}px down`);
    assert.ok(r.prevBottom <= 0, `spacing ${spacing}: the line before is out of view (${r.prevBottom}px)`);
  }
});

test('the timeline: off at first, Ctrl+Shift+T shows it with each scene, note and highlight, a click goes there, a timecode sets the ruler', async () => {
  const list = [];
  for (let i = 1; i <= 12; i++) {
    list.push(['scene', `INT. ROOM ${i} - DAY`]);
    for (let j = 0; j < 5; j++) list.push(['action', `Scene ${i}, line ${j}. Something happens here that takes a little room.`]);
  }
  await load(list);
  await app.eval(`(() => { const ed = __stet.editor; ed.setSel({ b: 1, o: 0 }, { b: 1, o: 5 }); ed.highlight('pink'); __stet.session.doc.comments.n1 = { text: 'Why?', created: '', modified: '' }; ed.setSel({ b: 8, o: 0 }, { b: 8, o: 5 }); ed.attachComment('n1'); })()`);
  assert.equal(await app.eval('document.getElementById("timeline").hidden'), true, 'off by default');
  await app.key('Ctrl+Shift+T');
  await sleep(80);
  const r = await app.eval(`(() => { const q = (s) => document.querySelectorAll('#timeline ' + s).length;
    return { hidden: document.getElementById('timeline').hidden, scenes: q('.tl-scene'), notes: q('.tl-note'), pink: q('.tl-hl.hl-pink'),
      end: document.querySelector('#timeline .tl-end').textContent, pages: __stet.view.pages.length, saved: null }; })()`);
  assert.equal(r.hidden, false);
  assert.deepEqual([r.scenes, r.notes, r.pink], [12, 1, 1]);
  const lbl = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, p2 = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p2(m)}:${p2(sec % 60)}` : `${m}:${p2(sec % 60)}`; };
  assert.equal(r.end, lbl(60 * r.pages), 'a minute a page: the length at the end of the ruler');
  // Click the line for scene 9: the caret goes there.
  const click = (sel, i, dx = 0) => app.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}], l = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: l.left + ${dx}, clientY: l.top + 10 }));
    dispatchEvent(new MouseEvent('mouseup', { clientX: l.left + ${dx}, clientY: l.top + 10 })); })()`);
  await click('#timeline .tl-scene', 8);
  assert.equal(await app.eval('__stet.editor.block.text'), 'INT. ROOM 9 - DAY');
  // The pointer is drawn to a scene a few pixels off: the tick lights up and the line sits on it.
  const snapped = await app.eval(`(() => { const t = __stet.timeline, el = document.querySelectorAll('#timeline .tl-scene')[4], l = el.getBoundingClientRect();
    t.inner.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: l.left + 4, clientY: l.top + 10 }));
    return { near: el.classList.contains('near'), off: Math.abs(t.hover.getBoundingClientRect().left - l.left) }; })()`);
  assert.ok(snapped.near && snapped.off < 1, `drawn to the scene (${JSON.stringify(snapped)})`);
  // Zoomed in (so no mark is near), anywhere else: the line drawn there; the corner button shows the whole script again.
  const fit = await app.eval('__stet.timeline.drawn');
  assert.equal(await app.eval('document.querySelector("#timeline .tl-reset").hidden'), true, 'no reset while it all fits');
  await app.eval('__stet.timeline.setScale(3000, 2.5, 300)');
  const x = await app.eval(`__stet.timeline.drawn * (2 + 30 / 54)`);
  await click('#timeline .tl-inner', 0, x);
  const want = await app.eval(`[...__stet.view.pages[2].items].reverse().find((it) => it.y <= 30.5).bi`);
  assert.equal(await app.eval('__stet.editor.caret.b'), want, 'the line on page 3, row 31');
  await app.eval('document.querySelector("#timeline .tl-reset").click()');
  assert.equal(await app.eval('__stet.timeline.drawn'), fit, 'reset: the whole script again');
  // The gestures: drag sideways to zoom, double-click the ruler for the whole script;
  // drag the band to move the window; move with Ctrl held to step second by second.
  const drag = (zone, dx, dy) => app.eval(`(() => {
    const t = __stet.timeline, r = t.inner.getBoundingClientRect();
    const x = ${zone === 'band' ? '(t.bandA + t.bandB) / 2 * t.drawn + r.left' : 'r.left + r.width * 0.3'}, y = ${zone === 'ruler' ? 'r.bottom - 5' : 'r.top + 20'};
    t.inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
    for (let i = 1; i <= 4; i++) dispatchEvent(new MouseEvent('mousemove', { clientX: x + ${dx} * i / 4, clientY: y + ${dy} * i / 4 }));
    const read = t.hover.textContent;
    dispatchEvent(new MouseEvent('mouseup', { clientX: x + ${dx}, clientY: y + ${dy} }));
    return read;
  })()`);
  await drag('ruler', 60, 0);
  assert.ok(await app.eval('__stet.timeline.drawn') > fit * 1.9, 'dragging right zooms in');
  await app.eval(`__stet.timeline.inner.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: __stet.timeline.inner.getBoundingClientRect().left + 50, clientY: __stet.timeline.inner.getBoundingClientRect().bottom - 5 }))`);
  assert.equal(await app.eval('__stet.timeline.drawn'), fit, 'double-click: the whole script again');
  await app.eval('__stet.view.scroller.scrollTop = 0');
  await sleep(50);
  await drag('band', 120, 0);
  assert.ok(await app.eval('__stet.view.scroller.scrollTop') > 300, 'dragging the band moves the window');
  await caret(0, 0);
  await app.eval('__stet.view.scroller.scrollTop = 0');
  await sleep(50);
  const before = await app.eval('__stet.editor.caret.b');
  const t0 = await app.eval('Math.round(__stet.timeline.time.at(__stet.timeline.posAt(__stet.timeline.inner.getBoundingClientRect().left + __stet.timeline.inner.getBoundingClientRect().width * 0.3)))');
  // Just moving over it with Ctrl held, no click: from a third of the way along, clear of the band at the start.
  const read = await app.eval(`(() => {
    const t = __stet.timeline, r = t.inner.getBoundingClientRect(), x = r.left + r.width * 0.3, y = r.top + 20;
    for (let i = 0; i <= 8; i++) t.inner.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + i * 10, clientY: y, ctrlKey: true }));
    return t.hover.textContent;
  })()`);
  assert.ok(await app.eval('__stet.editor.caret.b') > before, 'stepping moves the caret');
  const secs = read.trim().slice(0, 8).split(':').reduce((n, v) => n * 60 + +v, 0);
  assert.equal(secs, t0 + 10, `80px with Ctrl held is ten seconds on (${read}, from ${t0})`);
  assert.equal(await app.eval('__stet.timeline.drawn'), fit, 'Ctrl steps, it does not zoom');
  const stepped = await app.eval('__stet.editor.caret.b');
  await app.eval(`dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))`);
  assert.equal(await app.eval('!!__stet.timeline.stepping || document.body.classList.contains("tl-fine")'), false, 'letting go of Ctrl ends it');
  assert.equal(await app.eval('__stet.editor.caret.b'), stepped, 'and the caret stays where it stepped to');
  // A timecode at the start of the last page at twice its minutes doubles the pace: the script comes to twice its pages in minutes.
  const hms = (sec) => [sec / 3600, (sec / 60) % 60, sec % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
  await app.eval(`void __stet.timeline.addTimecode(__stet.view.pages.length - 1)`);
  await sleep(50);
  await app.eval(`(() => { const d = document.querySelector('.dlg'); d.querySelector('input').value = '${hms(120 * (r.pages - 1))}'; d.querySelector('.btn.primary').click(); })()`);
  await sleep(50);
  assert.equal(await app.eval(`document.querySelector('#timeline .tl-end').textContent`), lbl(120 * r.pages));
  assert.equal(await app.eval(`document.querySelectorAll('#timeline .tl-tc').length`), 1);
  assert.match(await app.eval('__stet.session.serialize()'), /"timecodes"/, 'saved with the script');
  await app.key('Ctrl+Shift+T');
  assert.equal(await app.eval('document.getElementById("timeline").hidden'), true);
});

test('a changed shortcut works, and the old keys no longer do', async () => {
  await load([['action', 'Text.']]);
  await caret(0, 0, 5);
  await app.eval(`__stet.cmd.setShortcuts({ 'type-character': ['Ctrl+M C'] })`);
  await app.key('Ctrl+3');
  assert.equal(await app.eval('__stet.editor.block.type'), 'action', 'Ctrl+3 is free now');
  await app.key('Ctrl+M'); await app.key('C');
  assert.deepEqual(await blocks(), [['character', 'TEXT.']]);
  await app.eval(`__stet.cmd.setShortcuts({})`);
});

test('save, reopen and export a PDF on A4 in the script font', async () => {
  await load([['scene', 'INT. HARBOUR - NIGHT'], ['character', 'MARA'], ['dialogue', 'And instead of a Watson he always has with him a cute twenty-year-old.']]);
  const file = path.join(tmp, 'smoke.stet'), pdf = path.join(tmp, 'smoke.pdf');
  const w = await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`);
  assert.ok(w.ok, 'saved');
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  await sleep(200);
  assert.deepEqual((await blocks()).map((b) => b[0]), ['scene', 'character', 'dialogue'], 'reopened');
  const r = await app.eval(`window.stet.invoke('export:pdf', { json: __stet.session.serialize(), options: { titlePage: false }, name: 'smoke', file: ${JSON.stringify(pdf)} })`);
  assert.ok(r.ok, r.error);
  const bytes = (await fs.readFile(pdf)).toString('latin1');
  assert.match(bytes, /\/MediaBox \[0 0 595\.32 841\.92\]/);
  assert.match(bytes, /\/BaseFont \/STETCourier-Regular/);
  assert.match(bytes, /\/FontFile2/);
});
