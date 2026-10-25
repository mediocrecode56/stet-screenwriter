// Writing in the real app: completion from the cast, capitals, highlights and notes, find, the
// four styles, alignment, Tab inside text, changed shortcuts, the notes panel, the caret on the
// drawn letters at every scale, zoom, and the word count and TODAY through every editing route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { App, scratch } from './harness.js';
import { referenceDocCount } from '../helpers/wordref.js';

let tmp, app;
before(async () => {
  tmp = await scratch('stet-writing');
  app = await App.launch({ userData: path.join(tmp, 'ud') });
});
after(() => app?.close());

const ghost = () => app.eval("document.querySelector('.ghost').style.display === 'none' ? '' : document.querySelector('.ghost').textContent");
const dialogOpen = () => app.eval(`!document.getElementById('overlay').hidden && !!document.querySelector('#overlay .dlg')`);

test('a cue completes from the cast, most recent first; capitals on a first appearance in action', async () => {
  await app.load([['scene', '']]);
  await app.type('int. dock - day');
  await app.key('Enter'); await app.key('Tab'); await app.type('MARA'); await app.key('Enter'); await app.type('Here.');
  await app.key('Enter'); await app.key('Tab'); await app.type('TEO'); await app.key('Enter'); await app.type('There.');
  await app.key('Enter'); await app.key('Tab'); await app.type('Ma');
  assert.equal(await ghost(), 'RA', 'the rest of MARA, in grey');
  assert.equal(await app.eval('__stet.editor.block.text'), 'MA', 'nothing typed for you');
  await app.key('Enter');
  assert.deepEqual((await app.blocks()).slice(-2), [['character', 'MARA'], ['dialogue', '']]);
  await app.type('Again.');
  await app.key('Enter'); await app.key('Tab'); await app.type('T');
  assert.equal(await ghost(), 'EO');
  await app.key('Escape');
  assert.equal(await ghost(), '', 'Escape hides it');
  await app.type('E');
  await app.key('Tab'); // Tab takes it too
  assert.equal(await app.eval('__stet.editor.block.text'), 'TEO');
  await app.key('Enter');
  assert.deepEqual(await app.eval('__stet.session.doc.cast'), ['TEO', 'MARA'], 'kept in the document, the most recent first');
  await app.type('Fine.');
  await app.key('Enter'); // dialogue → action
  await app.type('Teo sits. ');
  assert.equal(await app.eval('__stet.editor.block.text'), 'TEO sits. ', 'a character’s first appearance in action: in capitals');
  await app.type('Teo smiles.');
  assert.equal(await app.eval('__stet.editor.block.text'), 'TEO sits. Teo smiles.', 'and only the first time');
});

test('a highlight and a note from the keyboard; the find bar counts and slides away', async () => {
  await app.key('Mod+Shift+ArrowLeft');
  await app.key('Alt+2');
  assert.deepEqual((await app.eval('__stet.editor.block.marks')).map((m) => [m.k, m.v]), [['hl', 'yellow']]);
  await app.key('Mod+Alt+M');
  await app.until('!document.getElementById("right").hidden && document.activeElement.tagName === "TEXTAREA"', { what: 'the note open to write in' });
  await app.type('Check this beat.');
  const id = await app.eval('__stet.editor.commentAnchors()[0].id');
  assert.equal(await app.eval(`__stet.session.doc.comments["${id}"].text`), 'Check this beat.');
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.eval('__stet.input.focus()');
  await app.key('Mod+F');
  await app.type('mara');
  await app.until(`/\\/ 2$/.test(document.getElementById('find-count').textContent)`, { what: 'both MARAs counted' });
  await app.key('Escape');
  assert.equal(await app.eval('document.getElementById("findbar").dataset.open'), '0', 'closing at once');
  await app.until('document.getElementById("findbar").hidden', { what: 'gone after sliding away' });
});

const styles = () => app.eval(`__stet.editor.block.marks.filter((m) => 'bius'.includes(m.k)).map((m) => m.k + m.s + '-' + m.e).sort()`);
const pressed = () => app.eval(`[...document.querySelectorAll('#stbar .tb')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.s).join('')`);

test('bold, italic, underline and strikeout: the shortcuts toggle the selection and the buttons follow', async () => {
  await app.load([['action', 'He was never here.']]);
  await app.caret(0, 7, 12); // "never"
  for (const k of ['B', 'I', 'U', 'D']) await app.key('Mod+' + k);
  assert.deepEqual(await styles(), ['b7-12', 'i7-12', 's7-12', 'u7-12']);
  await app.until(async () => (await pressed()) === 'bius', { what: 'the buttons pressed' });
  await app.key('Mod+D');
  assert.deepEqual(await styles(), ['b7-12', 'i7-12', 'u7-12'], 'a second press turns it off');
  await app.key('Mod+Z');
  assert.deepEqual(await styles(), ['b7-12', 'i7-12', 's7-12', 'u7-12'], 'and undo brings it back');
  assert.equal(await app.eval('__stet.editor.block.text'), 'He was never here.', 'the words untouched');
  // Drawn so, on the same character grid as the caret and the selection.
  await app.frame();
  const r = await app.eval(`(() => {
    const sp = [...document.querySelectorAll('.page .l span')].find((s) => s.textContent === 'never'), cs = getComputedStyle(sp), line = sp.parentElement;
    const range = document.createRange(); range.selectNodeContents(line);
    return { cls: sp.className, weight: +cs.fontWeight, style: cs.fontStyle, deco: cs.textDecorationLine, width: range.getBoundingClientRect().width, chars: line.textContent.length, cw: __stet.view.cw };
  })()`);
  assert.equal(r.cls, 'sb si su ss');
  assert.ok(r.weight >= 700 && r.style === 'italic' && r.deco.includes('underline') && r.deco.includes('line-through'), JSON.stringify(r));
  assert.ok(Math.abs(r.width - r.chars * r.cw) < 1.5, `${r.width} vs ${r.chars * r.cw}`);
});

test('the style buttons sit after the highlights, work with no selection, and the Format menu lists them', async () => {
  assert.deepEqual(await app.eval(`(() => { const h = document.getElementById('hlbar'); return [h.nextElementSibling.className, h.nextElementSibling.nextElementSibling.id]; })()`), ['sep', 'stbar']);
  const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl+';
  assert.deepEqual(await app.eval(`[...document.querySelectorAll('#stbar .tb')].map((b) => b.title)`), ['Bold', 'Italic', 'Underline', 'Strikethrough'].map((n, i) => `${n} (${mod}${'BIUD'[i]})`));
  await app.key('End');
  await app.until(async () => (await pressed()) === '', { what: 'nothing styled after the full stop' });
  await app.clickOn('#stbar [data-s="b"]');
  await app.until(async () => (await pressed()) === 'b', { what: 'bold pressed, for what is typed next' });
  await app.type(' Gone');
  assert.equal(await app.eval('__stet.editor.block.text'), 'He was never here. Gone');
  assert.ok((await styles()).includes('b18-23'));
  assert.equal(await app.eval('document.activeElement.id'), 'input', 'the script keeps the focus');
  await app.eval(`[...document.querySelectorAll('#menubar .mb')].find((b) => b.textContent === 'Format').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  const items = await app.until(`(() => { const t = [...document.querySelectorAll('.mi')].map((r) => r.textContent); return t.length && t; })()`);
  for (const n of ['Bold', 'Italic', 'Underline', 'Strikethrough']) assert.ok(items.some((t) => t.startsWith(n + mod)), `${n} in ${items.join(' | ')}`);
  await app.key('Escape');
  await app.until('document.querySelectorAll(".menu").length === 0', { what: 'the menu to slide away' });
});

test('alignment: the toolbar menu and the shortcuts; words, element and styles untouched; the caret on the drawn letters', async () => {
  const long = 'The rain does not stop. It runs down the glass in long grey lines and nobody in the diner looks up from their plates.';
  await app.load([['action', long], ['transition', 'CUT TO:']]);
  await app.eval(`(() => { const ed = __stet.editor; ed.setSel({ b: 0, o: 4 }, { b: 0, o: 8 }); ed.toggleStyle('b'); })()`);
  await app.caret(0, 0, long.length);
  await app.clickOn('#btn-align');
  const rows = await app.until(`(() => { const r = [...document.querySelectorAll('.menu .mi')].map((r) => r.textContent); return r.length && r; })()`);
  assert.deepEqual(rows.map((r) => r.replace(/(Ctrl|⌘).*$/, '')), ['Align Left', 'Center', 'Align Right', 'Justify']);
  assert.ok(await app.eval(`document.querySelector('.menu .mi.cur').textContent.startsWith('Align Left')`), 'the current one marked');
  const center = await app.rect('.menu .mi', 1);
  await app.click(center.x, center.y);
  await app.until('document.querySelectorAll(".menu").length === 0', { what: 'the menu to close' });
  assert.equal(await app.eval('__stet.editor.blocks[0].align'), 'center');
  assert.equal(await app.eval('document.getElementById("btn-align").dataset.a'), 'center', 'the button shows it');
  for (const [k, a] of [['R', 'right'], ['J', 'justify'], ['L', undefined], ['E', 'center']]) {
    await app.key('Mod+' + k);
    assert.equal(await app.eval('__stet.editor.blocks[0].align'), a, 'Ctrl+' + k);
  }
  await app.key('Mod+J');
  assert.deepEqual(await app.blocks(), [['action', long], ['transition', 'CUT TO:']], 'the words and elements untouched');
  assert.deepEqual(await app.eval('__stet.editor.blocks[0].marks'), [{ s: 4, e: 8, k: 'b', v: 1 }], 'and the styles');
  // With the caret in the text, only what is written next takes it: a new paragraph starts there.
  await app.caret(1, 7);
  await app.key('Mod+E');
  assert.deepEqual(await app.eval('__stet.editor.blocks.map((b) => [b.text, b.align || null])'), [[long, 'justify'], ['CUT TO:', null], ['', 'center']]);
  await app.key('Mod+Z');
  // Justified: the first line fills the action width, and each word's caret and click land on its letter.
  await app.frame();
  const r = await app.eval(`(() => {
    const { view, editor } = __stet, text = editor.blocks[0].text;
    const line = [...document.querySelectorAll('.page .l')].find((l) => /^The +rain/.test(l.textContent));
    const out = { width: line.textContent.length, offs: [] };
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
    const sc = view.scroller.getBoundingClientRect();
    for (const node of nodes) for (let i = 0; i < node.data.length; i++) {
      if (node.data[i] === ' ' || (i > 0 && node.data[i - 1] !== ' ')) continue;
      const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
      const g = range.getBoundingClientRect(), word = node.data.slice(i).split(' ')[0];
      const o = text.indexOf(word, out.offs.length ? out.offs.at(-1).o + 1 : 0);
      const c = view.caretRect({ b: 0, o }), hit = view.posAt(g.left + 1, g.top + 2);
      out.offs.push({ o, dx: Math.abs(c.x - view.scroller.scrollLeft + sc.left - g.left), hit: hit.b === 0 ? hit.o : -1 });
    }
    return out;
  })()`);
  assert.equal(r.width, 60, 'the justified line fills the action width');
  assert.ok(r.offs.length > 5);
  for (const w of r.offs) { assert.ok(w.dx < 1.5, `caret at ${w.o} is ${w.dx}px off its letter`); assert.equal(w.hit, w.o, 'a click on the letter puts the caret before it'); }
  await app.key('Mod+Z');
  assert.equal(await app.eval('__stet.editor.blocks[0].align'), 'center', 'undo takes it back');
  await app.caret(1, 0);
  await app.key('Mod+L');
  assert.equal(await app.eval('__stet.editor.blocks[1].align'), 'left', 'a transition can go left');
  await app.key('Mod+R');
  assert.equal(await app.eval('__stet.editor.blocks[1].align'), undefined, 'and back to its own right');
});

test('Tab inside written text starts a new element at the caret; Dialogue to Character and back keeps the capitals', async () => {
  await app.load([['action', 'She waits. He comes.'], ['dialogue', 'Below.']]);
  await app.caret(0, 11);
  await app.key('Tab');
  await app.type('mara');
  assert.deepEqual(await app.blocks(), [['action', 'She waits.'], ['character', 'MARA'], ['action', 'He comes.'], ['dialogue', 'Below.']]);
  await app.caret(2, 3, 8); // a selection: only the selected words change
  await app.key('Tab');
  assert.deepEqual(await app.blocks(), [['action', 'She waits.'], ['character', 'MARA'], ['action', 'He'], ['character', 'COMES'], ['action', '.'], ['dialogue', 'Below.']]);
  await app.key('Mod+Z');
  assert.deepEqual((await app.blocks()).slice(2), [['action', 'He comes.'], ['dialogue', 'Below.']]);
  await app.load([['dialogue', 'You said eight, Mara.']]);
  await app.caret(0, 0, 21);
  await app.key('Mod+3');
  assert.deepEqual(await app.blocks(), [['character', 'YOU SAID EIGHT, MARA.']]);
  await app.caret(0, 21);
  await app.type(' Yes');
  await app.caret(0, 0, 25);
  await app.key('Mod+4');
  assert.deepEqual(await app.blocks(), [['dialogue', 'You said eight, Mara. Yes']], 'written so, it comes back so');
  await app.key('Mod+3');
  const again = await app.eval(`(async () => {
    const { serialize, deserialize } = await import('../core/serialize.js');
    __stet.session.load(deserialize(serialize({ ...__stet.session.doc, blocks: __stet.editor.blocks })).doc, null);
    __stet.editor.setSel({ b: 0, o: 0 }); __stet.editor.setType('dialogue');
    return __stet.editor.block.text;
  })()`);
  assert.equal(again, 'You said eight, Mara. Yes', 'saved and opened again too');
});

test('shortcuts can be changed in Help > Keyboard Shortcuts: a clash is named first, sequences work, all saved', async () => {
  await app.load([['action', 'One.']]);
  await app.eval(`__stet.cmd.run('keys')`);
  await app.until(dialogOpen);
  const row = (id) => `document.querySelector('#overlay tr[data-id="${id}"]')`;
  const cell = (id) => app.eval(`${row(id)}.lastChild.textContent`);
  const foot = () => app.eval(`document.querySelector('#overlay .foot').textContent`);
  const keyText = (id) => app.eval(`__stet.cmd.keyText('${id}')`).then((k) => k.replace('⌘', 'Ctrl+'));
  // Zoom In on Ctrl+J, which Justify has: nothing changes until Replace is clicked.
  await app.eval(`${row('zoom-in')}.click()`);
  assert.match(await cell('zoom-in'), /press the keys/);
  await app.key('Mod+J');
  await app.until(async () => /already used by Justify/.test(await foot()), { what: 'the clash named' });
  assert.equal(await keyText('align-justify'), 'Ctrl+J', 'not replaced yet');
  await app.eval(`[...${row('zoom-in')}.querySelectorAll('button')].find((b) => b.textContent === 'replace').click()`);
  assert.equal(await keyText('zoom-in'), 'Ctrl+J');
  assert.equal(await keyText('align-justify'), '', 'Justify gave it up');
  // Find & Replace on a sequence of two: Ctrl+T, then H (not M: on a Mac Cmd+M minimizes the window).
  await app.eval(`${row('replace')}.click()`);
  await app.key('Mod+T'); await app.key('H');
  await app.until(async () => { const c = await cell('replace'); return /T H/.test(c) && !c.includes('…'); }, { what: 'the sequence recorded (no “…” waiting for a third key)' });
  // A key that would get in the way of typing is refused; Escape while recording cancels.
  await app.eval(`${row('find')}.click()`);
  await app.key('K');
  await app.until(async () => /starts with/.test(await foot()), { what: 'the refusal' });
  assert.match(await cell('find'), /F$/);
  await app.eval(`${row('find')}.click()`);
  await app.key('Escape');
  assert.ok(await dialogOpen(), 'Escape while recording leaves the dialog open');
  assert.match(await cell('find'), /F$/);
  await app.key('Escape');
  await app.until(async () => !(await dialogOpen()));
  // In the script: the new keys run, the old ones no longer do, and the tooltips say so.
  await app.eval('__stet.input.focus()');
  const z = await app.eval('__stet.view.z');
  await app.key('Mod+J');
  assert.equal(await app.eval('__stet.editor.blocks[0].align'), undefined, 'Ctrl+J no longer justifies');
  assert.ok(await app.eval('__stet.view.z') > z, 'it zooms in');
  await app.eval(`__stet.cmd.run('zoom-reset')`);
  await app.key('Mod+T'); await app.key('H');
  await app.until(`!document.getElementById('findbar').hidden`, { what: 'Ctrl+T H to open Find & Replace' });
  assert.equal(await app.eval(`__stet.editor.blocks[0].text`), 'One.', 'and typed nothing');
  await app.key('Escape');
  assert.match(await app.eval(`document.getElementById('btn-notes').title`), /^Comments \(/);
  const saved = await app.until(`window.stet.invoke('settings:get').then((s) => s.shortcuts.replace && s.shortcuts)`);
  assert.deepEqual([saved['zoom-in'], saved['align-justify'], saved.replace], [['Ctrl+J'], [], ['Ctrl+T H']], 'saved in the settings');
  await app.eval(`__stet.cmd.run('keys')`);
  await app.until(dialogOpen);
  await app.press('Reset All');
  await app.key('Escape');
  assert.equal(await keyText('align-justify'), 'Ctrl+J', 'Reset All');
  await app.until(`window.stet.invoke('settings:get').then((s) => !Object.keys(s.shortcuts).length)`, { what: 'the reset saved' });
});

test('a click on a note opens the panel with the same slide as NOTES, the note plain text to write in', async () => {
  await app.load([['action', 'A line with a note on it.']]);
  await app.caret(0, 2, 6);
  await app.eval(`__stet.cmd.run('note-add')`);
  await app.eval(`__stet.cmd.run('panel-notes')`); // closed again
  await app.until('document.getElementById("right").hidden');
  const viaLabel = await app.eval(`(() => { const host = document.getElementById('right'); __stet.cmd.run('panel-notes'); const a = host.getAnimations()[0]; return { t: a.effect.getTiming(), k: a.effect.getKeyframes().map((f) => f.marginRight) }; })()`);
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.until('document.getElementById("right").hidden');
  await app.eval('__stet.input.focus()');
  const tick = await app.rect('.cmtick');
  await app.click(tick.x, tick.y);
  const viaNote = await app.eval(`(() => { const a = document.getElementById('right').getAnimations()[0]; return { t: a.effect.getTiming(), k: a.effect.getKeyframes().map((f) => f.marginRight), scroll: document.getElementById('main').scrollLeft }; })()`);
  assert.deepEqual([viaNote.t, viaNote.k], [viaLabel.t, viaLabel.k], 'the same timing, easing and movement');
  assert.equal(viaNote.scroll, 0, 'nothing scrolls under the slide');
  const ta = await app.until(`(() => { const t = document.querySelector('#notes textarea'), s = t && getComputedStyle(t); return t && document.activeElement === t && { border: s.borderTopWidth, bg: s.backgroundColor, resize: s.resize }; })()`, { what: 'the note ready to write in' });
  assert.deepEqual(ta, { border: '0px', bg: 'rgba(0, 0, 0, 0)', resize: 'none' }, 'plain text, no box');
  await app.type('Check this.');
  assert.equal(await app.eval(`Object.values(__stet.session.doc.comments)[0].text`), 'Check this.');
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.until('document.getElementById("right").hidden', { what: 'the panel to slide shut' });
});

test('+NOTE again on the same selection goes back to its note; a new selection makes a new one; delete takes a second press', async () => {
  await app.load([['action', 'A line with two notes on it.']]);
  const n = () => app.eval('__stet.editor.commentAnchors().length');
  await app.caret(0, 2, 6);
  await app.clickOn('#btn-comment');
  await app.until('document.activeElement.tagName === "TEXTAREA"', { what: 'the note open to write in' });
  await app.type('Fir');
  // The list refreshed (as it is a moment after +NOTE) while the note is being written: it keeps it.
  await app.eval('__stet.notes.lastKey = ""; __stet.notes.render()');
  await app.type('st.');
  assert.equal(await app.eval('document.activeElement.value'), 'First.', 'every key in the note');
  await app.clickOn('#btn-comment');
  await app.clickOn('#btn-comment');
  assert.equal(await n(), 1, 'pressed again and again: still one note');
  await app.until('document.activeElement.tagName === "TEXTAREA" && document.activeElement.value === "First."', { what: 'back in that note' });
  await app.caret(0, 12, 17);
  await app.clickOn('#btn-comment');
  assert.equal(await n(), 2, 'another passage: a new note');
  const del = '#notes .note:first-child .ndel';
  await app.until('!document.getElementById("right").getAnimations().length', { what: 'the panel in place' });
  await app.clickOn(del);
  assert.deepEqual(await app.eval(`(() => { const b = document.querySelector('${del}'); return [b.classList.contains('armed'), b.textContent, !!b.querySelector('svg'), b.title]; })()`), [true, '', true, 'Press again to delete this note'], 'armed: an X, no word');
  assert.deepEqual(await app.eval(`(() => { const b = document.querySelector('${del}'); return [b.classList.contains('held'), b._arm ?? null, getComputedStyle(b, '::after').display]; })()`), [true, null, 'none'], 'no countdown: it waits for a press elsewhere');
  assert.equal(await n(), 2, 'one press deletes nothing');
  await app.clickOn(del);
  await app.until(`__stet.editor.commentAnchors().length === 1 && document.querySelectorAll('#notes .note').length === 1`, { what: 'the note folded away' });
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.until('document.getElementById("right").hidden');
});

test('a press on a note\'s header or margin goes to its passage, as one on the passage does', async () => {
  await app.load([['action', 'At the top.'], ...Array.from({ length: 120 }, () => ['action', 'Filler line.']), ['action', 'The passage with the note.']]);
  const b = await app.eval('__stet.editor.blocks.length - 1');
  await app.caret(b, 4, 11);
  await app.clickOn('#btn-comment');
  await app.until('document.activeElement.tagName === "TEXTAREA"', { what: 'the note open' });
  await app.until('!document.getElementById("right").getAnimations().length', { what: 'the panel in place' });
  for (const where of ['header', 'margin']) {
    await app.caret(0, 0);
    if (where === 'header') await app.clickOn('#notes .note .when');
    else { const r = await app.rect('#notes .note'); await app.click(r.left + 5, r.top + r.height / 2); }
    await app.until(`__stet.editor.caret.b === ${b}`, { what: 'the note\'s passage, from its ' + where });
  }
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.until('document.getElementById("right").hidden');
});

test('a note pinned glides to the top and keeps its writing; its colour shows on the card and the timeline', async () => {
  await app.load([['scene', 'INT. ROOM - DAY'], ['action', 'A first passage. A second passage.']]);
  await app.caret(1, 2, 7);
  await app.clickOn('#btn-comment');
  await app.until('document.activeElement.tagName === "TEXTAREA"', { what: 'the first note open' });
  await app.type('One');
  await app.caret(1, 19, 25);
  await app.clickOn('#btn-comment');
  await app.until('document.querySelectorAll("#notes .note").length === 2 && document.activeElement.tagName === "TEXTAREA"', { what: 'the second note open' });
  await app.type('Two');
  await app.until('!document.getElementById("right").getAnimations().length', { what: 'the panel in place' });
  const order = `[...document.querySelectorAll('#notes .note textarea')].map((t) => t.value).join()`;
  await app.clickOn('#notes .note:nth-child(2) [data-x="pin"]');
  await app.until(`${order} === 'Two,One'`, { what: 'the pinned note at the top' });
  assert.equal(await app.eval('document.activeElement.value'), 'Two', 'the note being written keeps the focus');
  assert.equal(await app.eval('Object.values(__stet.session.doc.comments).filter((c) => c.pinned).length'), 1);
  await app.type('!');
  assert.equal(await app.eval('document.activeElement.value'), 'Two!', 'and every key after');
  await app.eval('__stet.timeline.visible || __stet.timeline.show(true)');
  await app.clickOn('#notes .note:first-child [data-x="col"]');
  await app.until('document.querySelector("#notes .note:first-child").classList.contains("picking")', { what: 'the swatches out' });
  await app.clickOn('#notes .note:first-child [data-sw="pink"]');
  await app.until(`document.querySelector('#notes .note:first-child').className.includes('c-pink') && !document.querySelector('#notes .picking')`, { what: 'the card in pink, the swatches away' });
  await app.until(`document.querySelectorAll('#timeline .tl-note.c-pink').length === 1`, { what: 'its mark on the timeline in pink' });
  await app.until(`document.querySelectorAll('.page .mk.hl-pink').length === 1 && document.querySelectorAll('.page .cmtick.c-pink').length === 1`, { what: 'its passage highlighted in pink, and its marker on the page' });
  assert.ok(await app.eval(`(() => { const r = document.querySelector('.page .cmtick').getBoundingClientRect(); return Math.abs(r.width - r.height) < 0.5 && r.width > 2; })()`), 'the marker is a square');
  assert.deepEqual(await app.eval('[...__stet.editor.noteColors().values()]'), ['pink'], 'the colour is the highlight on its passage');
  assert.equal(await app.eval(`__stet.editor.blocks[1].marks.filter((m) => m.k === 'hl').length`), 1);
  await app.clickOn('#notes .note:first-child [data-x="pin"]');
  await app.until(`${order} === 'One,Two!'`, { what: 'unpinned: back to its place in the script' });
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.until('document.getElementById("right").hidden');
});

test('a selecting drag let go out of sight ends: the selection stays, it no longer follows the pointer', async () => {
  await app.load([['action', 'One line to select across, and on.']]);
  const line = await app.eval(`(() => { const r = [...document.querySelectorAll('.page:not(.metric-probe) .l')].find((l) => l.textContent.startsWith('One line')).getBoundingClientRect(); return { left: r.left, y: r.top + r.height / 2 }; })()`);
  const sel = () => app.eval('JSON.stringify(__stet.editor.sel)');
  for (const away of ['blur', 'buttons']) {
    await app.mouse('mousePressed', line.left + 2, line.y, { button: 'left', buttons: 1, clickCount: 1 });
    await app.move(line.left + 60, line.y, { buttons: 1 });
    // Alt+Tab mid-drag (the window loses the focus), or the button let go where no mouseup came.
    if (away === 'blur') await app.eval(`window.dispatchEvent(new Event('blur'))`);
    else await app.move(line.left + 70, line.y);
    const held = await sel();
    assert.equal(await app.eval('__stet.input.drag'), null, `${away}: the drag is over`);
    await app.move(line.left + 160, line.y);
    assert.equal(await sel(), held, `${away}: the selection no longer follows the pointer`);
    await app.mouse('mouseReleased', line.left + 160, line.y, { button: 'left', clickCount: 1 });
  }
});

test('the caret, the selection and clicks sit on the drawn letters at display scales 1 and 1.5 and every zoom', async () => {
  // Regression: v0.3.0 drew the caret into the text (inherited letter-spacing).
  const LINE = 'INT. COFFEE SHOP - NIGHT AND THE RAIN KEEPS FALLING ON IT';
  await app.load([['action', LINE]]);
  await app.caret(0, LINE.length);
  for (const dpr of [1, 1.5]) {
    await app.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: dpr, mobile: false });
    for (const z of [1, 1.25, 0.8]) {
      const m = await app.eval(`(async () => {
        __stet.view.setZoom(${z}); await new Promise((r) => requestAnimationFrame(r));
        const ed = __stet.editor, view = __stet.view;
        const t = [...document.querySelectorAll('.page .l')].find((l) => l.textContent === ed.block.text).firstChild, r = document.createRange();
        const edge = (i) => { r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect(); };
        const caretErr = document.getElementById('caret').getBoundingClientRect().left - edge(t.length - 1).right;
        ed.setSel({ b: 0, o: 5 }, { b: 0, o: 20 }); view.frame();
        const sel = document.querySelector('.selr').getBoundingClientRect();
        const selErr = Math.max(Math.abs(sel.left - edge(5).left), Math.abs(sel.right - edge(19).right));
        let hitErrors = 0;
        for (let i = 0; i < t.length; i += 3) { const g = edge(i), p = view.posAt(g.left + g.width * 0.25, g.top + g.height / 2); if (p.o !== i) hitErrors++; }
        ed.setSel({ b: 0, o: ed.block.text.length }); view.frame();
        return { caretErr, selErr, hitErrors, dpr: devicePixelRatio };
      })()`);
      const at = `scale ${m.dpr}, zoom ${z}`;
      assert.ok(m.caretErr >= -0.05 && m.caretErr < 1.01, `${at}: the caret ${m.caretErr.toFixed(2)}px from the last letter`);
      assert.ok(m.selErr < 0.75, `${at}: the selection ${m.selErr.toFixed(2)}px off`);
      assert.equal(m.hitErrors, 0, `${at}: clicks landed on the wrong character ${JSON.stringify(m)}`);
    }
  }
  await app.send('Emulation.clearDeviceMetricsOverride');
  await app.eval('__stet.view.setZoom(1)');
});

test('zoom: Ctrl+= and Ctrl+0, and Ctrl+wheel in exact 5-point steps within the limits', async () => {
  await app.key('Mod+=');
  assert.equal(await app.eval('document.getElementById("zoom-val").textContent'), '105%');
  await app.key('Mod+0');
  assert.equal(await app.eval('document.getElementById("zoom-val").textContent'), '100%');
  const page = await app.rect('#scroller');
  const wheel = async (deltaY, n = 1) => {
    await app.down('Control'); // a pinch arrives as Ctrl+wheel on every platform
    for (let i = 0; i < n; i++) await app.wheel(page.x, page.y, deltaY);
    await app.up('Control');
    return app.eval('__stet.view.z');
  };
  assert.equal(await wheel(-100), 1.05);
  assert.equal(await wheel(-100, 4), 1.25);
  assert.equal(await wheel(100, 5), 1);
  assert.equal(await wheel(-600), 1.05, 'one oversized event is still one step');
  await app.eval('__stet.view.setZoom(1.97)');
  assert.equal(await wheel(-100, 3), 2, 'the maximum kept (200%)');
  assert.deepEqual(await app.eval(`['--pz-notes', '--pz-scenes'].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v))`), ['1.5', '1.1'], 'the notes and Revise follow half the zoom, the scenes a tenth');
  await app.eval('__stet.view.setZoom(0.53)');
  assert.equal(await wheel(100, 3), 0.5, 'the minimum kept');
  await app.eval('__stet.view.setZoom(1)');
});

// ---- the word count and TODAY ----

const count = async () => {
  await app.eval('__stet.view.frame()');
  const s = await app.eval(`({ words: __stet.editor.words, shown: +document.getElementById('st-words').textContent.replace(/\\D/g, ''), texts: __stet.editor.blocks.map((b) => ({ text: b.text })) })`);
  return { words: s.words, shown: s.shown, ref: referenceDocCount(s.texts) };
};
const exact = async (msg) => { const s = await count(); assert.equal(s.words, s.ref, 'the count, ' + msg); assert.equal(s.shown, s.ref, 'shown in the status bar, ' + msg); return s.words; };
/** TODAY as the status bar shows it, once it has caught up with `want` (the bar updates a moment after the typing). */
const TODAY = `+document.getElementById('st-goal').textContent.match(/TODAY ([\\d,.\\s]+)/)[1].replace(/\\D/g, '')`;
const todayNow = () => app.eval(TODAY);
const today = async (want) => { await app.until(`${TODAY} === ${want}`, { what: 'TODAY to read ' + want }); return want; };
const big = (n, every) => Array.from({ length: n }, (_, i) => (i % every === every - 1 ? 'end.\n\n' : 'w' + i)).join(' ');

test('the word count is exact after typing, pastes, replacing, deleting, undo and redo; only typing counts towards TODAY', async () => {
  await app.load([]);
  assert.equal(await exact('empty'), 0);
  const t0 = await todayNow();
  await app.type('one two three ');
  assert.equal(await exact('typed'), 3);
  await today(t0 + 3);
  await app.paste(big(6000, 30)); await exact('a large paste');
  await app.paste(big(6000, 30)); await exact('a second large paste');
  await app.paste('  tabs\t\tand   spaces \r\n\r\n — dash… don\'t 日本 '); await exact('a mixed paste');
  await app.key('Mod+Z'); await app.key('Mod+Z'); await app.key('Mod+Z');
  assert.equal(await exact('the pastes undone'), 3);
  await app.type('four five ');
  await today(t0 + 5); // pasting is not writing, and typing right after undoing a paste counts at once
  await app.key('Mod+Y'); await exact('redo');
  await app.key('Mod+A'); await app.paste('Replaced everything.'); await exact('replace all');
  for (let i = 0; i < 4; i++) { await app.key('Mod+Z'); await exact('undo ' + i); }
  for (let i = 0; i < 4; i++) { await app.key('Mod+Y'); await exact('redo ' + i); }
  await app.key('Mod+A'); await app.key('Backspace');
  assert.equal(await exact('cleared'), 0);
  await app.type('fresh words now ');
  assert.equal(await exact('after clearing'), 3);
  await today(t0 + 8);
  for (let i = 0; i < 4; i++) await app.key('Backspace');
  await app.type('wow ');
  assert.equal(await today(t0 + 8), t0 + 8, 'a fixed typo is not counted twice');
});

test('switching rapidly between screenplays and reopening them counts nothing new', async () => {
  const sizes = [0, 50, 2000], files = [];
  for (const n of sizes) {
    await app.load([]);
    if (n) await app.paste(Array.from({ length: n }, (_, i) => 'z' + i).join(' '));
    const f = path.join(tmp, `Switch${n}.stet`);
    assert.ok((await app.saveTo(f)).ok);
    files.push(f);
  }
  const t0 = await todayNow();
  for (let r = 0; r < 9; r++) {
    const i = r % files.length;
    await app.eval(`__stet.openPath(${JSON.stringify(files[i])})`);
    assert.equal(await exact(`opening ${i}`), sizes[i]);
  }
  // Write in one, switch, write in another: both count once.
  await app.eval(`__stet.openPath(${JSON.stringify(files[1])})`);
  await app.key('Mod+End'); await app.type(' extra words');
  await app.eval('__stet.save()');
  await app.eval(`__stet.openPath(${JSON.stringify(files[2])})`);
  await app.key('Mod+End'); await app.type(' more');
  await app.eval('__stet.save()');
  await today(t0 + 3);
  await app.eval(`__stet.openPath(${JSON.stringify(files[1])})`);
  assert.equal(await exact('reopened after writing in it'), 52);
  assert.equal(await todayNow(), t0 + 3, 'no words from opening and switching');
});
