// Bold, italic, underline and strikethrough in the real app: the shortcuts,
// the toolbar buttons, the Format menu, and how the styled text is drawn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, app;
const styles = () => app.eval(`__stet.editor.block.marks.filter((m) => 'bius'.includes(m.k)).map((m) => m.k + m.s + '-' + m.e).sort()`);
const pressed = () => app.eval(`[...document.querySelectorAll('#stbar .tb')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.s).join('')`);
const select = (a, f) => app.eval(`(() => { const { editor } = __stet; editor.setSel({ b: editor.caret.b, o: ${a} }, { b: editor.caret.b, o: ${f} }); __stet.input.after(); })()`);

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-styles-'));
  app = await App.launch({ userData: path.join(tmp, 'ud') });
  await app.eval('__stet.input.focus()');
  await app.key('Ctrl+2'); // action
  await app.type('He was never here.');
  await app.key('Escape');
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('Ctrl+B, Ctrl+I, Ctrl+U and Ctrl+D toggle the selection, and the buttons follow', async () => {
  await select(7, 12); // "never"
  for (const k of ['B', 'I', 'U', 'D']) await app.key('Ctrl+' + k);
  assert.deepEqual(await styles(), ['b7-12', 'i7-12', 's7-12', 'u7-12']);
  await sleep(50);
  assert.equal(await pressed(), 'bius');
  await app.key('Ctrl+D');
  assert.deepEqual(await styles(), ['b7-12', 'i7-12', 'u7-12'], 'a second press turns it off');
  await app.key('Ctrl+Z');
  assert.deepEqual(await styles(), ['b7-12', 'i7-12', 's7-12', 'u7-12'], 'and undo brings it back');
  assert.equal(await app.eval('__stet.editor.block.text'), 'He was never here.', 'the words are untouched');
});

test('drawn on the page in bold, italic, underlined and struck through, on the same grid', async () => {
  await sleep(100);
  const r = await app.eval(`(() => {
    const sp = [...document.querySelectorAll('.page .l span')].find((s) => s.textContent === 'never');
    if (!sp) return null;
    const cs = getComputedStyle(sp), line = sp.parentElement;
    const range = document.createRange(); range.selectNodeContents(line);
    return { cls: sp.className, weight: cs.fontWeight, style: cs.fontStyle, deco: cs.textDecorationLine,
      width: range.getBoundingClientRect().width, chars: line.textContent.length, cw: __stet.view.cw };
  })()`);
  assert.ok(r, 'the styled word is a span');
  assert.equal(r.cls, 'sb si su ss');
  assert.ok(+r.weight >= 700);
  assert.equal(r.style, 'italic');
  assert.ok(r.deco.includes('underline') && r.deco.includes('line-through'), r.deco);
  // Courier keeps every style on the character grid the caret and selection use.
  assert.ok(Math.abs(r.width - r.chars * r.cw) < 1.5, `${r.width} vs ${r.chars * r.cw}`);
});

test('toolbar buttons sit right after the highlights and work with no selection too', async () => {
  const order = await app.eval(`[...document.getElementById('elbar').querySelectorAll('#hlbar, #stbar')].map((e) => e.id)`);
  assert.deepEqual(order, ['hlbar', 'stbar']);
  const next = await app.eval(`(() => { const h = document.getElementById('hlbar'); return [h.nextElementSibling.className, h.nextElementSibling.nextElementSibling.id]; })()`);
  assert.deepEqual(next, ['sep', 'stbar']);
  assert.deepEqual(await app.eval(`[...document.querySelectorAll('#stbar .tb')].map((b) => b.title)`), ['Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Underline (Ctrl+U)', 'Strikethrough (Ctrl+D)']);
  await app.key('End');
  await sleep(30);
  assert.equal(await pressed(), '', 'after the full stop nothing is styled');
  await app.eval(`document.querySelector('#stbar [data-s="b"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  await sleep(30);
  assert.equal(await pressed(), 'b', 'pressed, ready for what is typed next');
  await app.type(' Gone');
  const t = await app.eval('__stet.editor.block');
  assert.equal(t.text, 'He was never here. Gone');
  assert.ok((await styles()).includes('b18-23'));
  assert.equal(await app.eval('document.activeElement.id'), 'input', 'the editor keeps the focus');
});

test('the Format menu lists the four styles with their shortcuts', async () => {
  await app.eval(`[...document.querySelectorAll('#menubar .mb')].find((b) => b.textContent === 'Format').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await sleep(50);
  const items = await app.eval(`[...document.querySelectorAll('.mi')].map((r) => r.textContent)`);
  for (const want of ['BoldCtrl+B', 'ItalicCtrl+I', 'UnderlineCtrl+U', 'StrikethroughCtrl+D']) assert.ok(items.includes(want), `${want} in ${items.join(' | ')}`);
  await app.key('Escape');
});
