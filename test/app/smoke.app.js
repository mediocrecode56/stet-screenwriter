// The workflows a release must not break, in one start of the real app, each in well under a
// second: writing from the keyboard, element and alignment changes, the Tab cycle, scene
// navigation, the timeline (stepping with Ctrl held, timecodes, a scene's own), a changed
// shortcut, saving, reopening and the PDF. `npm run quick` runs it after the unit tests.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { App, scratch } from './harness.js';

let tmp, app;
before(async () => {
  tmp = await scratch('stet-smoke');
  app = await App.launch({ userData: path.join(tmp, 'ud') });
  await app.eval('__stet.input.focus()');
});
after(() => app?.close());
afterEach(() => app?.releaseAll()); // a failure while Ctrl is held must not spill into the next test

test('starts with the script font, the elements in their order, the timeline on', async () => {
  const r = await app.eval(`(async () => { await document.fonts.ready; return {
    font: document.fonts.check('16px "STET Courier"') && [...document.fonts].some((f) => f.family === 'STET Courier' && f.status === 'loaded'),
    types: [...document.querySelectorAll('#eltypes .tb')].map((b) => b.dataset.t),
    boxes: document.querySelectorAll('#tabcycle .cyc-box').length,
    timeline: !document.getElementById('timeline').hidden,
  }; })()`);
  assert.deepEqual(r, { font: true, types: ['scene', 'action', 'character', 'dialogue', 'paren', 'transition', 'shot'], boxes: 1, timeline: true });
});

test('writing a scene from the keyboard: each element leads to the next', async () => {
  await app.load([['scene', '']]);
  await app.type('int. coffee shop - night');
  await app.key('Escape'); // any suggestion
  await app.key('Enter');
  await app.type('Rain on the glass.');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('mara');
  await app.key('Enter');
  await app.type('You came.');
  await app.key('Tab');
  await app.type('softly');
  await app.key('Enter');
  await app.type('I always do.');
  assert.deepEqual(await app.blocks(), [['scene', 'INT. COFFEE SHOP - NIGHT'], ['action', 'Rain on the glass.'], ['character', 'MARA'], ['dialogue', 'You came.'], ['paren', '(softly)'], ['dialogue', 'I always do.']]);
  // Set as written: no bold of STET's own, characters 7pt apart (format.js PITCH).
  const r = await app.eval(`(() => { const l = [...document.querySelectorAll('.page .l')].find((l) => l.textContent === 'MARA');
    return { weight: getComputedStyle(l).fontWeight, pitch: __stet.view.cw / __stet.view.col * 7.2 }; })()`);
  assert.equal(r.weight, '400');
  assert.ok(Math.abs(r.pitch - 7) < 0.02, `pitch ${r.pitch}pt`);
  // Ctrl+number turns the selected text into another element; undo and redo from the keyboard.
  await app.key('Home'); await app.key('Shift+End');
  await app.key('Mod+6');
  assert.deepEqual((await app.blocks()).at(-1), ['transition', 'I ALWAYS DO.']);
  await app.key('Mod+Z');
  assert.deepEqual((await app.blocks()).at(-1), ['dialogue', 'I always do.']);
  await app.key('Mod+Y');
  assert.equal(await app.eval('__stet.editor.block.type'), 'transition');
});

test('the Tab cycle: Ctrl+click and dragging the outline choose the types; Tab steps only through them', async () => {
  await app.load([['action', '']]);
  await app.down('Mod');
  await app.clickOn('.tb[data-t="character"]');
  await app.clickOn('.tb[data-t="paren"]');
  await app.up('Mod');
  assert.equal(await app.eval('document.querySelectorAll("#tabcycle .cyc-box").length'), 3, 'three boxes: the types kept, apart');
  const seen = [];
  for (let i = 0; i < 5; i++) { await app.key('Tab'); seen.push(await app.eval('__stet.editor.block.type')); }
  assert.deepEqual(seen, ['dialogue', 'transition', 'shot', 'scene', 'action']);
  // Drag the right end of the first box (Scene, Action) over to Shot: every type between is taken in.
  const h = await app.rect('#tabcycle .cyc-box .cyc-h.r'), shot = await app.rect('.tb[data-t="shot"]');
  await app.drag(h.x, h.y, shot.x, h.y);
  assert.equal(await app.eval('__stet.editor.tabTypes'), null, 'all of them again');
  assert.equal(await app.eval(`window.stet.invoke('settings:get').then((s) => s.tabTypes)`), null, 'and remembered');
  await app.clickOn('.tb[data-t="dialogue"]'); // a plain click still changes the element
  assert.equal(await app.eval('__stet.editor.block.type'), 'dialogue');
});

test('element and alignment changes touch only the selection, or what is written next', async () => {
  await app.load([['action', 'She waits. He comes.'], ['action', 'Below.']]);
  await app.caret(0, 11);
  await app.key('Mod+4');
  await app.type('Hello.');
  assert.deepEqual(await app.blocks(), [['action', 'She waits.'], ['dialogue', 'Hello.'], ['action', 'He comes.'], ['action', 'Below.']]);
  await app.caret(2, 0, 9);
  await app.key('Mod+E');
  assert.deepEqual(await app.eval('__stet.editor.blocks.map((b) => b.align || null)'), [null, null, 'center', null]);
  for (let i = 0; i < 3; i++) await app.key('Mod+Z'); // the alignment, the typing, the new element
  assert.deepEqual(await app.blocks(), [['action', 'She waits. He comes.'], ['action', 'Below.']]);
});

const SCRIPT = [];
for (let i = 1; i <= 12; i++) {
  SCRIPT.push(['scene', `INT. ROOM ${i} - DAY`]);
  for (let j = 0; j < 5; j++) SCRIPT.push(['action', `Scene ${i}, line ${j}. Something happens here that takes a little room.`]);
}
const glided = () => app.until('!__stet.view.glide', { what: 'the glide to end' });

test('scene navigation glides to the heading, nothing of the scene before it in view', async () => {
  for (const spacing of [2, 1]) {
    await app.load(SCRIPT, { sceneSpacing: spacing });
    await app.eval('document.getElementById("scroller").scrollTop = 0');
    for (let i = 0; i < 4; i++) await app.key('Alt+ArrowDown');
    // It glides there (a few frames in between), then stops on the heading.
    const seen = await app.eval(`new Promise((done) => { const s = document.getElementById('scroller'), out = []; const tick = () => { out.push(Math.round(s.scrollTop)); __stet.view.glide ? requestAnimationFrame(tick) : done(out); }; tick(); })`);
    if (!(await app.eval(`matchMedia('(prefers-reduced-motion: reduce)').matches`))) assert.ok(new Set(seen).size > 3, `it glides (${new Set(seen).size} positions)`); // (with motion reduced it goes straight there)
    await glided();
    const r = await app.eval(`(() => { const { view, editor } = __stet; const s = view.scroller.scrollTop, b = editor.caret.b;
      const end = view.caretRect({ b: b - 1, o: editor.blocks[b - 1].text.length });
      return { text: editor.block.text, off: view.caretRect().y - s, blank: view.blankAbove(editor.caret), row: view.row, prevBottom: end.y + view.row - s }; })()`);
    assert.equal(r.text, 'INT. ROOM 5 - DAY');
    assert.ok(Math.abs(r.off - r.blank * r.row) <= 1 && r.blank <= spacing, `spacing ${spacing}: heading ${r.off}px down`);
    assert.ok(r.prevBottom <= 0, `spacing ${spacing}: the line before is out of view (${r.prevBottom}px)`);
  }
  // The scene list does the same: a click on a scene glides there and stops on its heading.
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  await app.until(`!!document.querySelector('#scenes .row[data-b="${9 * 6}"]') && !document.getElementById('left').getAnimations().length`, { what: 'the scene list' });
  const row = await app.rect(`#scenes .row[data-b="${9 * 6}"]`);
  await app.click(row.x, row.y);
  await glided();
  const p = await app.eval(`(() => { const { view, editor } = __stet; return { text: editor.block.text, off: view.caretRect().y - view.scroller.scrollTop, blank: view.blankAbove(editor.caret), row: view.row }; })()`);
  assert.equal(p.text, 'INT. ROOM 10 - DAY');
  assert.ok(Math.abs(p.off - p.blank * p.row) <= 1, `from the scene list too (${p.off}px down)`);
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  await app.until('document.getElementById("left").hidden');
});

// ---- the timeline ----

const lbl = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, p2 = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p2(m)}:${p2(sec % 60)}` : `${m}:${p2(sec % 60)}`; };
const hms = (sec) => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, '0')).join(':');
const LOCKS = process.platform === 'linux';
const tl = (expr) => app.eval(`(() => { const t = __stet.timeline; return ${expr}; })()`);

test('the timeline: a tick for each scene, note and highlight; a click goes there, drawn to what is near', async () => {
  await app.load(SCRIPT);
  await app.eval(`(() => { const ed = __stet.editor; ed.setSel({ b: 1, o: 0 }, { b: 1, o: 5 }); ed.highlight('pink'); __stet.session.doc.comments.n1 = { text: 'Why?', created: '', modified: '' }; ed.setSel({ b: 8, o: 0 }, { b: 8, o: 5 }); ed.attachComment('n1'); })()`);
  await app.until(`document.querySelectorAll('#timeline .tl-note').length === 1`, { what: 'the bar to catch up' });
  const r = await app.eval(`(() => { const q = (s) => document.querySelectorAll('#timeline ' + s).length; return { scenes: q('.tl-scene'), notes: q('.tl-note'), pink: q('.tl-hl.hl-pink'), end: document.querySelector('#timeline .tl-end').textContent, pages: __stet.view.pages.length }; })()`);
  assert.deepEqual([r.scenes, r.notes, r.pink], [12, 1, 1]);
  assert.equal(r.end, lbl(60 * r.pages), 'a minute a page: the length at the end of the ruler');
  // A click on the tick for scene 9: the caret goes to its heading.
  const s9 = await app.rect('#timeline .tl-scene', 8);
  await app.click(s9.left + 1, s9.top + 6);
  assert.equal(await app.eval('__stet.editor.block.text'), 'INT. ROOM 9 - DAY');
  // Pointing a few pixels off a scene: the tick lights up and the line sits on it.
  const s5 = await app.rect('#timeline .tl-scene', 4);
  await app.move(s5.left + 4, s5.top + 6);
  assert.ok(await app.eval(`document.querySelectorAll('#timeline .tl-scene')[4].classList.contains('near')`), 'drawn to the scene');
  assert.ok(Math.abs(await tl('t.hover.getBoundingClientRect().left') - s5.left) < 1, 'the line on the tick');
});

test('the timeline: zoom by dragging the ruler, the whole script again by double-clicking it, scroll by dragging the band', async () => {
  const fit = await tl('t.drawn');
  assert.equal(await app.eval('document.querySelector("#timeline .tl-reset").hidden'), true, 'no reset while it all fits');
  const bar = await app.rect('#timeline .tl-inner');
  await app.drag(bar.left + bar.width * 0.3, bar.bottom - 5, bar.left + bar.width * 0.3 + 60, bar.bottom - 5);
  assert.ok(await tl('t.drawn') > fit * 1.9, 'dragging right on the ruler zooms in');
  await app.clickOn('#timeline .tl-reset');
  assert.equal(await tl('t.drawn'), fit, 'the corner button: the whole script');
  await app.drag(bar.left + bar.width * 0.3, bar.bottom - 5, bar.left + bar.width * 0.3 + 60, bar.bottom - 5);
  const r = await app.rect('#timeline .tl-scroll'); // (zoomed in, the strip itself runs off the window)
  await app.click(r.left + 50, r.bottom - 5); await app.click(r.left + 50, r.bottom - 5, { count: 2 });
  assert.equal(await tl('t.drawn'), fit, 'double-click on the ruler: the whole script again');
  await app.eval('__stet.view.scroller.scrollTop = 0');
  await app.frame();
  const band = await tl('(() => { const r = t.inner.getBoundingClientRect(); return { x: (t.bandA + t.bandB) / 2 * t.drawn + r.left, y: r.top + 20 }; })()');
  await app.drag(band.x, band.y, band.x + 120, band.y);
  assert.ok(await app.eval('__stet.view.scroller.scrollTop') > 300, 'dragging the band moves the window');
});

// What shows where the caret is: the element and alignment in the toolbar, the status bar, the current scene.
const shown = () => app.eval(`[...document.querySelectorAll('#eltypes .tb.on, #stbar .on')].map((b) => b.dataset.t || b.dataset.s).join() + '|' + document.getElementById('btn-align').dataset.a + '|' + ['st-el', 'st-page', 'st-scene'].map((id) => document.getElementById(id).textContent).join('|') + '|' + document.querySelector('#scenes .cur')?.dataset.b`);
// Every change anywhere in the window but the script, the timeline and what lives on its own (the dinosaur, the clock).
const watch = () => app.eval(`(() => { const log = window.__changed = [];
  window.__watch?.disconnect();
  window.__watch = new MutationObserver((ms) => { for (const m of ms) { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (t === document.body || t.closest('#content, #timeline, #dino, #st-clock, .tl-cover') || [...m.addedNodes, ...m.removedNodes].some((n) => n.classList?.contains('tl-cover'))) continue;
    log.push((t.id || t.className || t.nodeName) + ' ' + (m.attributeName || m.type)); } });
  window.__watch.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true }); })()`);
const changed = async () => { await app.frame(); return app.eval('[...new Set(window.__changed)].join(", ")'); };

test('the timeline: holding Ctrl steps a second at a time with the pointer locked; the script follows, nothing else in the window changes', async () => {
  await app.eval(`__stet.cmd.run('panel-scenes')`); // (the scene list open, to see it stay as it is)
  await app.caret(0, 0);
  await app.until(`document.querySelector('#scenes .cur')?.dataset.b === '0'`, { what: 'the scene list' });
  await app.eval('__stet.view.scroller.scrollTop = 0');
  await app.frame();
  const bar = await app.rect('#timeline .tl-inner');
  const x = bar.left + bar.width * 0.3, y = bar.top + 12; // clear of the band at the start
  await app.move(x, y);
  const tab = await app.eval('JSON.stringify(__stet.editor.tabTypes)'), shown0 = await shown();
  const t0 = await tl(`Math.round(t.time.at(t.posAt(${x})))`);
  const top = () => app.eval('__stet.view.scroller.scrollTop');
  const caretAt = () => app.eval('JSON.stringify(__stet.editor.sel)'), caret0 = await caretAt();
  await watch();
  // Ctrl pressed with the pointer resting on the bar: the line shows and the pointer is locked to
  // the bar; the script stays put until the line moves (Ctrl+S and the like leave it alone).
  await app.down('Mod');
  await app.until('!!__stet.timeline.stepping', { what: 'stepping' });
  // The system grants the lock only to the window with the focus, which a writer's always is; so is
  // each one here on Linux (a display of its own). A CI Mac's may not be: there the cover stands in.
  if (LOCKS) await app.until('document.pointerLockElement === __stet.timeline.inner', { what: 'the pointer locked to the bar' });
  assert.equal(await top(), 0, 'Ctrl alone moves nothing');
  // The mouse wanders up over the toolbar while it moves 400px: ever further on, wherever it goes up or down.
  for (let i = 1; i <= 10; i++) await app.move(x + i * 12, y - i * 4); // (up into the toolbar, within the window)
  assert.equal(await tl('t.stepping.t'), t0 + 10, '120px with Ctrl held is ten seconds on');
  for (let i = 11; i <= 34; i++) await app.move(x + i * 12, y - (i % 10) * 4);
  assert.equal(await tl('t.drawn'), await tl('t.fit'), 'Ctrl steps, it does not zoom');
  assert.ok(await top() > 300, 'the script follows the line');
  // Nothing outside the bar lights up or takes the pointer: no hover, nothing selected.
  const hovered = await app.eval(`[...document.querySelectorAll(':hover')].map((e) => e.id || e.className).filter(Boolean).at(-1)`);
  assert.ok(['tl-inner', 'tl-cover'].includes(hovered), `the pointer is the timeline's while Ctrl is held (hovering ${hovered})`);
  assert.equal(await caretAt(), caret0, 'the caret itself stays put');
  assert.equal(await changed(), '', 'nothing else in the window changes while Ctrl is held');
  assert.equal(await app.eval(`(() => { const p = __stet.view.scrubAt || {}, r = __stet.view.caretRect(p), c = document.getElementById('caret');
    return p.b > 6 && c.style.display !== 'none' && parseFloat(c.style.top) === r.y; })()`), true, 'the caret drawn on the line stepped to');
  // Letting go ends it: the pointer is free again, on the bar where it was locked, now on the second
  // stepped to (the bar slid under it); the script stays there, and still nothing else changes.
  await app.move(x + 34 * 12, y); // (back down onto the bar, no further on: off it, the bar slides back)
  const stepped = await top();
  await app.up('Mod');
  await app.until('!__stet.timeline.stepping && !document.pointerLockElement && !document.querySelector(".tl-cover")', { what: 'stepping to end' });
  assert.equal(await top(), stepped, 'the script stays where it stepped to');
  const at = LOCKS ? x : x + 34 * 12; // the pointer: let go where it was locked, or where it went
  await app.frame();
  await app.move(at, y);
  assert.equal(await tl(`Math.round(t.time.at(t.posAt(${at})))`), t0 + 34, 'the pointer is left on the second stepped to');
  assert.equal(await tl('t.hover.hidden'), false, 'and the line with it');
  assert.equal(await caretAt(), caret0);
  assert.equal(await shown(), shown0);
  assert.equal(await changed(), '', 'nor after letting go of Ctrl');
  // Esc while stepping puts the script back.
  await app.move(x, y);
  await app.down('Mod');
  await app.until('!!__stet.timeline.stepping');
  if (LOCKS) await app.until('document.pointerLockElement === __stet.timeline.inner');
  for (let i = 1; i <= 30; i++) await app.move(x + i * 12, y);
  await app.until(async () => (await top()) !== stepped, { what: 'stepped on' });
  await app.key('Escape'); // (Chromium takes it to let go of the pointer; the page never sees the key)
  await app.until('!__stet.timeline.stepping && !document.pointerLockElement', { what: 'Esc to end stepping' });
  assert.equal(await top(), stepped, 'Esc: back where it was');
  await app.until(`!__stet.timeline.shift && !__stet.timeline.inner.getAnimations().length`, { what: 'the bar back as well' });
  await app.move(x + 80, y); // Ctrl still held: no stepping again until it is pressed afresh
  assert.equal(await tl('!!t.stepping'), false, 'not again until Ctrl is pressed afresh');
  assert.equal(await top(), stepped);
  await app.up('Mod');
  assert.equal(await changed(), '', 'nor with Esc');
  // A right-click pins a timecode at that second, at once; a click puts the caret there, and only
  // then does the toolbar show where it is.
  await app.move(x, y);
  await app.down('Mod');
  await app.until('!!__stet.timeline.stepping'); // (just after an Esc, Chromium may refuse the lock: the cover stands in)
  for (let i = 1; i <= 10; i++) await app.move(x + i * 12, y - i * 4);
  const type = await app.rect('.tb[data-t="character"]');
  await app.click(type.x, type.y, { button: 'right' });
  assert.deepEqual(await app.eval('__stet.session.doc.timecodes.map((t) => t.t)'), [t0 + 10], 'Ctrl + right-click pins the second stepped to');
  assert.equal(await caretAt(), caret0, 'pinning leaves the caret');
  await app.click(type.x, type.y);
  assert.equal(await app.eval('JSON.stringify(__stet.editor.tabTypes)'), tab, 'a click over the toolbar is no Ctrl+click on an element type');
  assert.equal(await app.eval('JSON.stringify(__stet.editor.sel.f) === JSON.stringify(__stet.view.scrubAt)'), true, 'a click puts the caret on the line');
  await app.up('Mod');
  await app.until('!__stet.timeline.stepping');
  assert.equal(await app.eval('getSelection().toString()'), '', 'and selects nothing');
  await app.until(async () => /^action\|/.test(await shown()), { what: 'the toolbar to show where the caret went' });
  // With Ctrl held nothing draws the pointer: right beside the timecode it starts where the pointer is.
  await app.until('!__stet.timeline.inner.getAnimations().length', { what: 'the bar settled' }); // (easing back if the pointer was let go off it)
  const tc = await app.rect('#timeline .tl-tcm');
  await app.move(tc.left + 4, y);
  await app.down('Mod');
  await app.until('!!__stet.timeline.stepping');
  assert.equal(await tl(`t.stepping.t0 === Math.round(t.time.at(t.posAt(${tc.left + 4}))) && t.stepping.t0 !== ${t0 + 10}`), true, 'no magnetism with Ctrl held');
  await app.up('Mod'); // (a quick tap: the lock it asked for may come after it ended, and is let go at once)
  await app.until(`!__stet.timeline.stepping && new Promise((r) => setTimeout(() => r(!document.pointerLockElement), 100))`, { what: 'the pointer free after a quick tap' });
  await app.eval(`(() => { window.__watch.disconnect(); __stet.cmd.run('panel-scenes'); })()`);
});

test('the timeline: a click on a timecode edits it; a right-click on a scene gives it its own, shown beside the heading', async () => {
  await app.until('!__stet.timeline.inner.getAnimations().length', { what: 'the bar settled' });
  if (!(await app.eval('__stet.session.doc.timecodes?.length'))) await tl(`t.setTimecodes([{ id: __stet.editor.blocks[2].id, line: 0, t: 100 }])`);
  await app.frame();
  const t0 = await app.eval('__stet.session.doc.timecodes[0].t');
  const tc = await app.rect('#timeline .tl-tcm');
  await app.move(tc.left + 9, tc.top + 20);
  assert.equal(await tl('t.inner.dataset.zone'), 'tc', 'drawn to it from 9px off, with the edit pointer');
  await app.click(tc.left + 9, tc.top + 20);
  assert.equal(await app.eval(`document.querySelector('.tc-pop .tc-time').value`), hms(t0));
  await app.clickOn('.tc-pop .tc-del');
  assert.equal(await app.eval('__stet.session.doc.timecodes.length + document.querySelectorAll(".tc-pop, #timeline .tl-tcm").length'), 0, 'the bin removes it');
  // A right-click on the tick for scene 4: the editor names the scene; typed in, Enter keeps it.
  const s4 = await app.rect('#timeline .tl-scene', 3);
  await app.click(s4.left + 1, s4.top + 6, { button: 'right' });
  assert.equal(await app.eval(`document.querySelector('.tc-pop .tc-head').textContent`), 'INT. ROOM 4 - DAY');
  assert.equal(await app.eval('document.activeElement.className'), 'tc-time', 'the time, ready to type over');
  await app.type('00:09:00');
  await app.eval(`document.querySelector('.tc-pop .tc-tag').value = 'Turn'`);
  await app.key('Enter');
  assert.deepEqual(await app.eval(`(() => { const b = __stet.editor.blocks; return __stet.session.doc.timecodes.map((t) => [b.find((x) => x.id === t.id).text, t.line, t.t, t.tag]); })()`), [['INT. ROOM 4 - DAY', 0, 540, 'Turn']]);
  assert.equal(await app.eval('document.querySelector("#timeline .tl-tcm").className'), 'tl-tcm sc', 'on a scene: the stronger line');
  await app.caret(18, 0);
  await app.until(`[...document.querySelectorAll('#content .sctc')].map((e) => e.textContent).join() === '00:09:00 · Turn'`, { what: 'the timecode beside the heading' });
  const beside = await app.eval(`(() => { const t = document.querySelector('#content .sctc'), h = [...document.querySelectorAll('#content .l')].find((e) => e.textContent === 'INT. ROOM 4 - DAY');
    const a = t.getBoundingClientRect(), b = h.getBoundingClientRect(); return a.left > b.right && a.left - b.right < 40 && Math.abs(a.top - b.top) < 6; })()`);
  assert.equal(beside, true, 'on the heading’s line, just after it');
  assert.equal(await tl('Math.round(t.time.at(t.tl.scenes[3].x))'), 540, 'the ruler there reads 9:00');
  await tl('t.setTimecodes([])');
});

test('the timeline: a timecode sets the pace of the ruler; crowded labels give way to the newest; Ctrl+Shift+T hides it', async () => {
  const pages = await app.eval('__stet.view.pages.length');
  // At the start of the last page at twice its minutes (Up nudges a second on): twice the running time.
  await tl('t.editTimecode(__stet.view.pages.length - 1)');
  await app.eval(`document.querySelector('.tc-pop .tc-time').value = '${hms(120 * (pages - 1) - 1)}'`);
  await app.key('ArrowUp');
  await app.eval(`(() => { const p = document.querySelector('.tc-pop'); p.querySelector('.tc-tag').value = 'Act three'; p.querySelector('[aria-label="pink"]').click(); p.querySelector('.tc-tag').focus(); })()`);
  await app.key('Enter');
  assert.equal(await app.eval('!!document.querySelector(".tc-pop")'), false, 'Enter closes it');
  assert.equal(await app.eval(`document.querySelector('#timeline .tl-end').textContent`), lbl(120 * pages));
  assert.equal(await app.eval(`document.querySelector('#timeline .tl-tc.c-pink b').textContent`), 'Act three');
  assert.match(await app.eval('__stet.session.serialize()'), /"timecodes".*"n":"Act three","c":"pink"/s, 'saved with the script');
  await tl(`(() => { const b = __stet.editor.blocks; t.setTimecodes([{ id: b[1].id, line: 0, t: 60, tag: 'Older' }, { id: b[2].id, line: 0, t: 62, tag: 'Newer' }]); })()`);
  assert.deepEqual(await app.eval(`[...document.querySelectorAll('#timeline .tl-tc')].map((e) => e.classList.contains('mute') + ':' + e.textContent)`), ['true:1:00Older', 'false:1:02Newer']);
  await app.key('Mod+Shift+T');
  assert.equal(await app.eval('document.getElementById("timeline").hidden'), true);
  await app.key('Mod+Shift+T');
});

test('a changed shortcut works, and the old keys no longer do', async () => {
  await app.load([['action', 'Text.']]);
  await app.caret(0, 0, 5);
  await app.eval(`__stet.cmd.setShortcuts({ 'type-character': ['Ctrl+T C'] })`);
  await app.key('Mod+3');
  assert.equal(await app.eval('__stet.editor.block.type'), 'action', 'Ctrl+3 is free now');
  await app.key('Mod+T'); await app.key('C'); // (shortcuts written with Ctrl are Cmd on a Mac; Cmd+M would be the Mac's Minimize)
  assert.deepEqual(await app.blocks(), [['character', 'TEXT.']]);
  await app.eval(`__stet.cmd.setShortcuts({})`);
});

test('save, reopen and export a PDF on A4 in the script font', async () => {
  await app.load([['scene', 'INT. HARBOUR - NIGHT'], ['character', 'MARA'], ['dialogue', 'And instead of a Watson he always has with him a cute twenty-year-old.']]);
  const file = path.join(tmp, 'smoke.stet'), pdf = path.join(tmp, 'smoke.pdf');
  assert.ok((await app.saveTo(file)).ok, 'saved');
  await app.load([['action', 'Something else.']]);
  assert.equal(await app.eval(`__stet.openPath(${JSON.stringify(file)})`), true);
  assert.deepEqual((await app.blocks()).map((b) => b[0]), ['scene', 'character', 'dialogue'], 'reopened');
  const r = await app.eval(`window.stet.invoke('export:pdf', { json: __stet.session.serialize(), options: { titlePage: false }, name: 'smoke', file: ${JSON.stringify(pdf)} })`);
  assert.ok(r.ok, r.error);
  const bytes = (await fs.readFile(pdf)).toString('latin1');
  assert.match(bytes, /^%PDF-/);
  assert.match(bytes, /\/MediaBox \[0 0 595\.32 841\.92\]/);
  assert.match(bytes, /\/BaseFont \/STETCourier-Regular/);
  assert.match(bytes, /\/FontFile2/);
});
