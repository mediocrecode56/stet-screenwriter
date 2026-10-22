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
  // The bold elements are drawn bold on the page.
  assert.equal(await app.eval(`getComputedStyle([...document.querySelectorAll('.page .l')].find((l) => l.textContent === 'MARA')).fontWeight`), '700');
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
  assert.match(bytes, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(bytes, /\/BaseFont \/STETCourier-Bold/);
  assert.match(bytes, /\/FontFile2/);
});
