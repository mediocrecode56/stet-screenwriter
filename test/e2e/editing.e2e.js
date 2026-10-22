// Alignment, Tab, capitals, changed shortcuts, scene navigation and notes in the real app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, app;
const blocks = () => app.eval('__stet.editor.blocks.map((b) => [b.type, b.text])');
const load = (list) => app.eval(`(async () => {
  const { newDocument, makeBlock } = await import('../core/model.js');
  const d = newDocument('T'); d.settings.backup.enabled = false;
  d.blocks = ${JSON.stringify(list)}.map(([t, x]) => makeBlock(t, x));
  __stet.session.load(d, null);
  await new Promise((r) => setTimeout(r, 80));
  __stet.input.focus();
})()`);
const caret = (b, o, f = o) => app.eval(`(() => { __stet.editor.setSel({ b: ${b}, o: ${o} }, { b: ${b}, o: ${f} }); __stet.input.after(); })()`);
const dialogOpen = () => app.eval(`!document.getElementById('overlay').hidden && !!document.querySelector('#overlay .dlg')`);

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-editing-'));
  app = await App.launch({ userData: path.join(tmp, 'ud'), hidden: false }); // a shown window: real animation frames for the glides
  await app.eval('__stet.input.focus()');
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('alignment: the toolbar menu and Ctrl+L / E / R / J; text, type and styles untouched; caret on the drawn letters', async () => {
  const long = 'The rain does not stop. It runs down the glass in long grey lines and nobody in the diner looks up from their plates.';
  await load([['action', long], ['transition', 'CUT TO:']]);
  await app.eval(`(() => { const ed = __stet.editor; ed.setSel({ b: 0, o: 4 }, { b: 0, o: 8 }); ed.toggleStyle('b'); ed.setSel({ b: 0, o: 0 }); __stet.input.after(); })()`);
  // The menu: a click on the button opens it, a click on Center applies it and closes it.
  await app.eval(`(() => { const b = document.getElementById('btn-align'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); })()`);
  await sleep(150);
  const rows = await app.eval(`[...document.querySelectorAll('.menu .mi')].map((r) => r.textContent)`);
  assert.deepEqual(rows.map((r) => r.replace(/(Ctrl|⌘).*$/, '')), ['Align Left', 'Center', 'Align Right', 'Justify']);
  assert.ok(await app.eval(`document.querySelector('.menu .mi.cur').textContent.startsWith('Align Left')`), 'the current alignment is marked');
  await app.eval(`(() => { const r = [...document.querySelectorAll('.menu .mi')][1]; r.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
  await sleep(300);
  assert.equal(await app.eval('__stet.editor.blocks[0].align'), 'center');
  assert.equal(await app.eval('document.querySelectorAll(".menu").length'), 0);
  assert.equal(await app.eval('document.getElementById("btn-align").dataset.a'), 'center');
  // The shortcuts.
  for (const [k, a] of [['R', 'right'], ['J', 'justify'], ['L', undefined], ['E', 'center']]) {
    await app.key('Ctrl+' + k);
    assert.equal(await app.eval('__stet.editor.blocks[0].align'), a, 'Ctrl+' + k);
  }
  await app.key('Ctrl+J');
  assert.deepEqual(await blocks(), [['action', long], ['transition', 'CUT TO:']], 'the words and elements are untouched');
  assert.deepEqual(await app.eval('__stet.editor.blocks[0].marks'), [{ s: 4, e: 8, k: 'b', v: 1 }], 'and so are the styles');
  // Justified: the first line reaches the right margin, and the caret stands on the drawn letters.
  await sleep(100);
  const r = await app.eval(`(() => {
    const { view, editor } = __stet;
    const page = document.querySelector('.page:not(.title-page):not(.metric-probe)');
    const line = [...page.querySelectorAll('.l')].find((l) => /^The +rain/.test(l.textContent));
    const out = { width: line.textContent.length, offs: [] };
    const text = editor.blocks[0].text;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
    // Each word's first letter on screen against where the caret goes for it.
    let shown = 0;
    for (const node of nodes) {
      for (let i = 0; i < node.data.length; i++, shown++) {
        if (node.data[i] === ' ' || (i > 0 && node.data[i - 1] !== ' ') ) continue;
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const x = range.getBoundingClientRect().left;
        const word = node.data.slice(i).split(' ')[0] || line.textContent.slice(shown).split(' ')[0];
        const o = text.indexOf(word, out.offs.length ? out.offs[out.offs.length - 1].o + 1 : 0);
        const c = view.caretRect({ b: 0, o });
        const sc = view.scroller.getBoundingClientRect();
        const hit = view.posAt(x + 1, range.getBoundingClientRect().top + 2); // a click on the letter
        out.offs.push({ o, dx: Math.abs(c.x - view.scroller.scrollLeft + sc.left - x), hit: hit.b === 0 ? hit.o : -1 });
      }
    }
    return out;
  })()`);
  assert.equal(r.width, 60, 'the justified line fills the action width');
  assert.ok(r.offs.length > 5);
  for (const w of r.offs) {
    assert.ok(w.dx < 1.5, `caret at offset ${w.o} is ${w.dx}px off its letter`);
    assert.equal(w.hit, w.o, 'a click on the letter puts the caret before it');
  }
  // Undo takes the alignment back.
  await app.key('Ctrl+Z');
  assert.equal(await app.eval('__stet.editor.blocks[0].align'), 'center');
  // A transition can be set left, and back to its own right.
  await caret(1, 0);
  await app.key('Ctrl+L');
  assert.equal(await app.eval('__stet.editor.blocks[1].align'), 'left');
  await app.key('Ctrl+R');
  assert.equal(await app.eval('__stet.editor.blocks[1].align'), undefined);
});

test('Tab inside written text starts a new element at the caret; the text around it keeps its element', async () => {
  await load([['action', 'She waits. He comes.'], ['dialogue', 'Below.']]);
  await caret(0, 11);
  await app.key('Tab');
  await app.type('mara');
  assert.deepEqual(await blocks(), [['action', 'She waits.'], ['character', 'MARA'], ['action', 'He comes.'], ['dialogue', 'Below.']]);
  // A selection: only the selected words change.
  await caret(2, 3, 8);
  await app.key('Tab');
  assert.deepEqual(await blocks(), [['action', 'She waits.'], ['character', 'MARA'], ['action', 'He'], ['character', 'COMES'], ['action', '.'], ['dialogue', 'Below.']]);
  await app.key('Ctrl+Z');
  assert.deepEqual((await blocks()).slice(2), [['action', 'He comes.'], ['dialogue', 'Below.']]);
});

test('Dialogue to Character and back keeps the capitalisation it was written with', async () => {
  await load([['dialogue', 'You said eight, Mara.']]);
  await caret(0, 21);
  await app.key('Ctrl+3');
  assert.deepEqual(await blocks(), [['character', 'YOU SAID EIGHT, MARA.']]);
  await app.type(' Yes');
  await app.key('Ctrl+5');
  assert.deepEqual(await blocks(), [['dialogue', 'You said eight, Mara. Yes']]);
  // Saved and opened again, it still comes back.
  await app.key('Ctrl+3');
  const again = await app.eval(`(async () => {
    const { serialize, deserialize } = await import('../core/serialize.js');
    const d = deserialize(serialize({ ...__stet.session.doc, blocks: __stet.editor.blocks })).doc;
    __stet.session.load(d, null);
    await new Promise((r) => setTimeout(r, 50));
    __stet.editor.setSel({ b: 0, o: 0 }); __stet.editor.setType('dialogue');
    return __stet.editor.block.text;
  })()`);
  assert.equal(again, 'You said eight, Mara. Yes');
});

test('shortcuts can be changed in Help > Keyboard Shortcuts: a clash is named first, sequences work, all saved', async () => {
  await load([['action', 'One.']]);
  await app.eval(`__stet.cmd.run('keys')`);
  await sleep(150);
  assert.ok(await dialogOpen());
  const row = (id) => `document.querySelector('#overlay tr[data-id="${id}"]')`;
  const cell = (id) => app.eval(`${row(id)}.lastChild.textContent`);
  assert.match(await cell('zoom-in'), /=/);
  // Zoom In on Ctrl+J, which Justify has: nothing changes until Replace is clicked.
  await app.eval(`${row('zoom-in')}.click()`);
  assert.match(await cell('zoom-in'), /press the keys/);
  await app.key('Ctrl+J');
  await sleep(1600);
  assert.ok(await dialogOpen(), 'the dialog stays open');
  assert.match(await app.eval(`document.querySelector('#overlay .foot').textContent`), /already used by Justify/);
  assert.equal(await app.eval(`__stet.cmd.keyText('align-justify')`).then((k) => k.replace('⌘', 'Ctrl+')), 'Ctrl+J', 'not replaced yet');
  await app.eval(`[...${row('zoom-in')}.querySelectorAll('button')].find((b) => b.textContent === 'replace').click()`);
  assert.equal(await app.eval(`__stet.cmd.keyText('zoom-in')`).then((k) => k.replace('⌘', 'Ctrl+')), 'Ctrl+J');
  assert.equal(await app.eval(`__stet.cmd.keyText('align-justify')`), '', 'Justify gave it up');
  // Find & Replace on a sequence of two: Ctrl+M, then H.
  await app.eval(`${row('replace')}.click()`);
  await app.key('Ctrl+M');
  await app.key('H');
  await sleep(1600);
  assert.match(await cell('replace'), /M H/);
  // A shortcut that would get in the way of typing is refused.
  await app.eval(`${row('find')}.click()`);
  await app.key('K');
  await sleep(1600);
  assert.match(await app.eval(`document.querySelector('#overlay .foot').textContent`), /starts with/);
  assert.match(await cell('find'), /F$/);
  // Escape while recording cancels, and leaves the dialog open.
  await app.eval(`${row('find')}.click()`);
  await app.key('Escape');
  assert.ok(await dialogOpen());
  assert.match(await cell('find'), /F$/);
  await app.key('Escape');
  await sleep(150);
  assert.ok(!(await dialogOpen()));
  // In the editor: the new keys run, the old ones no longer do, and the tooltips say so.
  await app.eval('__stet.input.focus()');
  const z = await app.eval('__stet.view.z');
  await app.key('Ctrl+J');
  await sleep(200);
  assert.equal(await app.eval('__stet.editor.blocks[0].align'), undefined, 'Ctrl+J no longer justifies');
  assert.ok(await app.eval('__stet.view.z') > z, 'it zooms in');
  await app.eval(`__stet.cmd.run('zoom-reset')`);
  await app.key('Ctrl+M');
  await app.key('H');
  await sleep(150);
  assert.ok(await app.eval(`!document.getElementById('findbar').hidden`), 'Ctrl+M H opened Find & Replace');
  assert.equal(await app.eval(`__stet.editor.blocks[0].text`), 'One.', 'and typed nothing');
  await app.key('Escape');
  assert.match(await app.eval(`document.getElementById('btn-notes').title`), /^Comments \(/);
  // Saved in the settings.
  await sleep(100);
  const saved = await app.eval(`window.stet.invoke('settings:get').then((s) => s.shortcuts)`);
  assert.deepEqual(saved['zoom-in'], ['Ctrl+J']);
  assert.deepEqual(saved['align-justify'], []);
  assert.deepEqual(saved.replace, ['Ctrl+M H']);
  // Reset All.
  await app.eval(`__stet.cmd.run('keys')`);
  await sleep(150);
  await app.eval(`[...document.querySelectorAll('#overlay .foot .btn')].find((b) => b.textContent === 'Reset All').click()`);
  await app.key('Escape');
  await sleep(100);
  assert.equal(await app.eval(`__stet.cmd.keyText('align-justify')`).then((k) => k.replace('⌘', 'Ctrl+')), 'Ctrl+J');
  assert.deepEqual(await app.eval(`window.stet.invoke('settings:get').then((s) => s.shortcuts)`), {});
});

test('scene navigation glides, and ends with the scene heading at the top of the view', async () => {
  const list = [];
  for (let i = 1; i <= 30; i++) {
    list.push(['scene', `INT. ROOM ${i} - DAY`]);
    for (let j = 0; j < 6; j++) list.push(['action', `Scene ${i}, line ${j}. Something happens here that takes a little room on the page.`]);
  }
  await load(list);
  await caret(0, 0);
  await app.eval('document.getElementById("scroller").scrollTop = 0');
  for (let i = 0; i < 3; i++) await app.key('Alt+ArrowDown');
  await sleep(1000);
  const before = await app.eval('document.getElementById("scroller").scrollTop');
  await app.key('Alt+ArrowDown');
  const seen = await app.eval(`new Promise((done) => { const s = document.getElementById('scroller'); const out = []; const t0 = performance.now(); const tick = () => { out.push(s.scrollTop); performance.now() - t0 < 900 ? requestAnimationFrame(tick) : done(out); }; tick(); })`);
  assert.ok(seen[0] - before < seen[seen.length - 1] - before, 'it does not jump straight there');
  const steps = new Set(seen.map(Math.round));
  assert.ok(steps.size > 5, `it glides (${steps.size} positions)`);
  await sleep(400);
  const r = await app.eval(`(() => { const { view, editor } = __stet; const c = view.caretRect(); return { b: editor.caret.b, text: editor.block.text, off: c.y - view.scroller.scrollTop, row: view.row }; })()`);
  assert.equal(r.text, 'INT. ROOM 5 - DAY');
  assert.ok(Math.abs(r.off - 2 * r.row) <= 1, `heading at the top of the view (${r.off}px down)`);
  // The scene navigator does the same.
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  await sleep(400);
  await app.eval(`(() => { const r = document.querySelector('#scenes .row[data-b="${7 * 20}"]'); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); })()`);
  await sleep(1000);
  const p = await app.eval(`(() => { const { view, editor } = __stet; const c = view.caretRect(); return { text: editor.block.text, off: c.y - view.scroller.scrollTop, row: view.row }; })()`);
  assert.equal(p.text, 'INT. ROOM 21 - DAY');
  assert.ok(Math.abs(p.off - 2 * p.row) <= 1, `heading at the top of the view (${p.off}px down)`);
  await app.eval(`__stet.cmd.run('panel-scenes')`);
});

test('notes: a click on a note opens the panel with the same slide as NOTES, and the note is plain text to write in', async () => {
  await load([['action', 'A line with a note on it.']]);
  await app.eval(`(() => { const ed = __stet.editor; ed.setSel({ b: 0, o: 2 }, { b: 0, o: 6 }); __stet.cmd.run('note-add'); })()`);
  await sleep(300);
  await app.eval(`__stet.cmd.run('panel-notes')`); // closed again
  await sleep(400);
  const viaLabel = await app.eval(`(() => { const host = document.getElementById('right'); __stet.cmd.run('panel-notes'); const a = host.getAnimations()[0]; return { t: a.effect.getTiming(), k: a.effect.getKeyframes().map((f) => f.marginRight) }; })()`);
  await sleep(400);
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await sleep(400);
  await app.eval('__stet.input.focus()');
  const viaNote = await app.eval(`new Promise((done) => {
    const host = document.getElementById('right'), main = document.getElementById('main');
    const tick = document.querySelector('.cmtick');
    tick.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const a = host.getAnimations()[0];
    const r = { t: a.effect.getTiming(), k: a.effect.getKeyframes().map((f) => f.marginRight), scroll: [] };
    const t0 = performance.now();
    const step = () => { r.scroll.push(main.scrollLeft, host.scrollLeft); performance.now() - t0 < 300 ? requestAnimationFrame(step) : done(r); };
    requestAnimationFrame(step);
  })`);
  assert.deepEqual(viaNote.t, viaLabel.t, 'the same timing and easing');
  assert.deepEqual(viaNote.k, viaLabel.k, 'the same movement');
  assert.ok(viaNote.scroll.every((x) => x === 0), 'nothing scrolls under the slide');
  const ta = await app.eval(`(() => { const t = document.querySelector('#notes textarea'); const s = getComputedStyle(t); return { focused: document.activeElement === t, border: s.borderTopWidth, bg: s.backgroundColor, resize: s.resize }; })()`);
  assert.ok(ta.focused, 'the note is ready to write in');
  assert.equal(ta.border, '0px');
  assert.equal(ta.bg, 'rgba(0, 0, 0, 0)');
  assert.equal(ta.resize, 'none');
  await app.type('Check this.');
  assert.equal(await app.eval(`Object.values(__stet.session.doc.comments)[0].text`), 'Check this.');
});
