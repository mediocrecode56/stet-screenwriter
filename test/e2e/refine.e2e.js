// 0.6 refinements in the real app: word counting and TODAY, Ctrl+wheel zoom,
// Open Recent actions, the writing companion, animation consistency and the
// toolbar spacing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, app, bin;
const launch = () => App.launch({ userData: path.join(tmp, 'ud'), env: { STET_TEST_TRASH_DIR: bin } });
const newDoc = () => app.eval(`(async () => { const { newDocument, makeBlock } = await import('../core/model.js'); const d = newDocument('T'); d.settings.backup.enabled = false; d.blocks = [makeBlock('action')]; __stet.session.load(d, null); })()`);
const paste = (t) => app.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(t)}); const ta = document.getElementById('input'); ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
const words = () => app.eval(`({ words: __stet.editor.words, shown: document.getElementById('st-words').textContent, recount: __stet.editor.blocks.reduce((n, b) => n + (b.text.match(/[\\p{L}\\p{N}]+(?:['’\\-][\\p{L}\\p{N}]+)*/gu) || []).length, 0) })`);
const today = async () => { await sleep(450); return app.eval(`+document.getElementById('st-goal').textContent.match(/TODAY ([\\d,]+)/)[1].replace(/,/g, '')`); };
const frame = () => app.eval('__stet.view.frame()');

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-ref-'));
  bin = path.join(tmp, 'bin');
  await fs.mkdir(bin);
  app = await launch();
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('word count: typing, large and repeated pastes, undo/redo, delete-all, switch and reopen', async () => {
  await newDoc();
  const t0 = await today();
  await app.type('one two three ');
  await frame();
  let w = await words();
  assert.equal(w.words, 3); assert.equal(w.shown, '3 WORDS');
  assert.equal(await today(), t0 + 3);
  const big = Array.from({ length: 2500 }, (_, i) => (i % 40 === 39 ? 'end.\n\n' : 'w' + i)).join(' ');
  await paste(big);
  await frame();
  w = await words();
  assert.equal(w.words, w.recount, 'counted immediately and correctly');
  assert.ok(w.words > 2000);
  assert.equal(w.shown.replace(/\D/g, ''), String(w.words));
  assert.equal(await today(), t0 + 3, 'pasting is not counted as writing');
  await paste('  spaced\t\tout \n\n  lines   ');
  await paste('  spaced\t\tout \n\n  lines   ');
  await frame();
  w = await words(); assert.equal(w.words, w.recount);
  // Undo the pastes: typing must count again straight away (the reported bug).
  await app.key('Ctrl+Z'); await app.key('Ctrl+Z'); await app.key('Ctrl+Z');
  await frame();
  w = await words(); assert.equal(w.words, 3); assert.equal(w.shown, '3 WORDS');
  await app.type('four five ');
  assert.equal(await today(), t0 + 5, 'progress continues right after undoing a paste');
  await app.key('Ctrl+Y');
  w = await words(); assert.equal(w.words, w.recount);
  // Delete everything.
  await app.key('Ctrl+A'); await app.key('Backspace'); await frame();
  w = await words(); assert.equal(w.words, 0); assert.equal(w.shown, '0 WORDS');
  await app.key('Ctrl+Z'); await frame();
  w = await words(); assert.equal(w.words, w.recount);
  // Save, switch to another document, come back.
  const file = path.join(tmp, 'Count.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`)).ok, true);
  const saved = (await words()).words;
  const before = await today();
  await newDoc();
  await app.type('alpha beta ');
  assert.equal(await today(), before + 2);
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(path.join(tmp, 'Other.stet'))})`)).ok, true);
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  await frame();
  w = await words();
  assert.equal(w.words, saved); assert.equal(w.words, w.recount);
  assert.equal(await today(), before + 2, 'opening a document adds nothing');
});

test('Ctrl+wheel zooms in exact 5-point steps within the limits', async () => {
  await app.eval('__stet.view.setZoom(1)');
  const wheel = async (deltaY, n = 1) => {
    for (let i = 0; i < n; i++) await app.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 300, deltaX: 0, deltaY, modifiers: 2 });
    await sleep(50);
    return app.eval('__stet.view.z');
  };
  assert.equal(await wheel(-100), 1.05);
  assert.equal(await wheel(-100, 4), 1.25);
  assert.equal(await wheel(100, 5), 1);
  assert.equal(await app.eval('document.getElementById("zoom-val").textContent'), '100%');
  assert.equal(await wheel(-600), 1.05, 'one oversized event is still one step');
  await app.eval('__stet.view.setZoom(2.97)');
  assert.equal(await wheel(-100, 3), 3, 'maximum kept');
  await app.eval('__stet.view.setZoom(0.53)');
  await sleep(500);
  assert.equal(await wheel(100, 3), 0.5, 'minimum kept');
  await app.eval('__stet.view.setZoom(1)');
});

test('Open Recent: dismiss hides an entry, trash moves the file to the bin after confirming', async () => {
  const files = ['Keep.stet', 'Hide.stet', 'Bin.stet', 'Gone.stet'].map((f) => path.join(tmp, f));
  for (const f of files) { await newDoc(); await app.type('x '); assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(f)})`)).ok, true); }
  await newDoc(); // none of them is the open document
  await fs.rm(files[3]); // a project that no longer exists
  const open = () => app.eval(`(void __stet.cmd.run('recent'), new Promise(r => setTimeout(r, 300)))`);
  const rows = () => app.eval(`[...document.querySelectorAll('#overlay .recent-row')].map(r => ({ name: r.cells[0].textContent, missing: r.classList.contains('missing') }))`);
  const clickIn = (name, cls) => app.eval(`(() => { const r = [...document.querySelectorAll('#overlay .recent-row')].find(r => r.cells[0].textContent === ${JSON.stringify(name)}); r.querySelector('${cls}').click(); })()`);
  await open();
  let r = await rows();
  for (const n of ['Keep', 'Hide', 'Bin', 'Gone']) assert.ok(r.some((x) => x.name === n), n);
  assert.equal(r.find((x) => x.name === 'Gone').missing, true, 'missing file is marked');
  // Icons are hidden until hover and are two distinct controls.
  const ui = await app.eval(`(() => { const row = document.querySelector('#overlay .recent-row'); const d = row.querySelector('.ra-dismiss'), t = row.querySelector('.ra-trash'); return { op: getComputedStyle(d).opacity, dTitle: d.title, tTitle: t.title, gap: t.getBoundingClientRect().left - d.getBoundingClientRect().right }; })()`);
  assert.equal(ui.op, '0');
  assert.match(ui.dTitle, /file is kept/);
  assert.match(ui.tTitle, /Recycle Bin/);
  assert.ok(ui.gap >= 10, 'kept apart');

  await clickIn('Hide', '.ra-dismiss');
  await sleep(150);
  r = await rows();
  assert.ok(!r.some((x) => x.name === 'Hide'), 'list updates immediately');
  await fs.access(files[1]); // file untouched
  assert.ok(!(await app.eval(`window.stet.invoke('settings:get')`)).recent.some((x) => x.path === files[1]));

  await clickIn('Bin', '.ra-trash');
  await sleep(150);
  assert.match(await app.eval(`document.querySelector('#overlay .dlg h2').textContent`), /RECYCLE BIN/);
  // Cancel first: nothing happens, list comes back.
  await app.eval(`[...document.querySelectorAll('#overlay .btn')].find(b => b.textContent === 'Cancel').click()`);
  await sleep(150);
  await fs.access(files[2]);
  assert.ok((await rows()).some((x) => x.name === 'Bin'));
  await clickIn('Bin', '.ra-trash');
  await sleep(150);
  await app.eval(`[...document.querySelectorAll('#overlay .btn')].find(b => b.textContent === 'Move to Bin').click()`);
  await sleep(300);
  await assert.rejects(fs.access(files[2]), 'moved out of its folder');
  await fs.access(path.join(bin, 'Bin.stet')); // into the (test) bin, not deleted
  assert.ok(!(await rows()).some((x) => x.name === 'Bin'), 'list updated');

  await clickIn('Gone', '.ra-trash');
  await sleep(150);
  await app.eval(`[...document.querySelectorAll('#overlay .btn')].find(b => b.textContent === 'Move to Bin').click()`);
  await sleep(300);
  assert.match(await app.eval(`document.querySelector('#overlay .dlg').textContent`), /no longer exists/);
  await app.eval(`document.querySelector('#overlay .btn.primary').click()`);
  await sleep(200);
  assert.ok(!(await rows()).some((x) => x.name === 'Gone'), 'missing entry removed');
  await app.eval(`document.querySelector('#overlay .btn').click()`); // Cancel
  await sleep(100);
  await fs.access(files[0]);
});

test('the dinosaur sits above TODAY and livens up only with real writing', async () => {
  const geo = await app.eval(`(() => { const d = document.getElementById('dino').getBoundingClientRect(), g = document.getElementById('st-goal').getBoundingClientRect(); return { hidden: document.getElementById('dino').hidden, dBottom: d.bottom, gTop: g.top, dLeft: d.left, gLeft: g.left, h: d.height, w: d.width }; })()`);
  assert.equal(geo.hidden, false);
  assert.ok(Math.abs(geo.dBottom - geo.gTop) <= 1, 'directly above TODAY');
  assert.ok(Math.abs(geo.dLeft - geo.gLeft) <= 1);
  assert.ok(geo.h <= 40, 'small');
  await newDoc();
  await app.eval('(() => { const d = __stet.dino.c; d.heat = 0; d.energy = 0; })()');
  await paste(Array.from({ length: 400 }, (_, i) => 'p' + i).join(' '));
  assert.equal(await app.eval('__stet.dino.c.heat'), 0, 'pasting does not excite it');
  await app.eval(`(async () => { const { newDocument, makeBlock } = await import('../core/model.js'); const d = newDocument('Big'); d.blocks = [makeBlock('action', 'a b c d e f g h i j k l m n o p')]; __stet.session.load(d, null); })()`);
  assert.equal(await app.eval('__stet.dino.c.heat'), 0, 'opening a document does not either');
  await app.type('the quick brown fox jumps over the lazy dog again and again ');
  assert.ok(await app.eval('__stet.dino.c.heat') >= 10, 'typing does');
  const e1 = await app.eval('(() => { const d = __stet.dino.c; d.updateEnergy(30000); return d.energy; })()');
  assert.ok(e1 > 0.2 && e1 < 1, `energy rose gradually (${e1})`);
  const e2 = await app.eval('(() => { const d = __stet.dino.c; for (let i = 0; i < 60; i++) d.updateEnergy(10000); return d.energy; })()');
  assert.ok(e2 < 0.1, `calms down after a while without writing (${e2})`);
});

test('poking the dinosaur blends a reaction in without cutting its animation', async () => {
  const s0 = await app.eval(`(() => { const d = __stet.dino.c; d.force = 'startle'; return { step: d.step && d.step.f, end: d.step && d.step.end, gen: !!d.gen }; })()`);
  await app.eval(`document.querySelector('.dino-hit').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  const s1 = await app.eval(`(() => { const d = __stet.dino.c; return { step: d.step && d.step.f, end: d.step && d.step.end, queued: d.queue.length, focus: document.activeElement.id }; })()`);
  assert.equal(s1.queued, 1, 'queued');
  assert.equal(s1.step, s0.step, 'current step not interrupted');
  assert.equal(s1.end, s0.end);
  let saw = false;
  for (let i = 0; i < 60 && !saw; i++) { await sleep(100); saw = await app.eval('!!__stet.dino.c.inReaction'); }
  assert.ok(saw, 'reaction starts at the next step boundary');
  let back = false;
  for (let i = 0; i < 100 && !back; i++) { await sleep(100); back = await app.eval('!__stet.dino.c.inReaction'); }
  assert.ok(back, 'then it carries on');
  // Many quick pokes are absorbed: at most two queued.
  await app.eval(`for (let i = 0; i < 8; i++) document.querySelector('.dino-hit').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  assert.ok(await app.eval('__stet.dino.c.queue.length') <= 2);
  // Props are drawn, and the cursor nearby gets noticed without becoming a reaction.
  const props = await app.eval(`(async () => { const d = __stet.dino, c = d.c; c.queue = []; c.pending = 'fetch'; c.gen = null; await new Promise((r) => setTimeout(r, 2500)); return { kinds: c.props.map((p) => p.kind), activity: c.activity }; })()`);
  assert.equal(props.activity, 'fetch');
  assert.ok(props.kinds.includes('ball'), 'a ball rolled in');
  const glance = await app.eval(`(async () => { const d = __stet.dino, c = d.c; c.pending = 'rest'; c.gen = null; c.props = []; await new Promise((r) => setTimeout(r, 3000)); const r = d.canvas.getBoundingClientRect(); c.face = 1; const x = r.left + c.x - 12, y = r.bottom - 5; window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y })); let turned = false; for (let i = 0; i < 40 && !turned; i++) { await new Promise((r) => setTimeout(r, 100)); window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y })); turned = c.face === -1; } return { turned, activity: c.activity, reaction: c.inReaction }; })()`);
  assert.ok(glance.turned, 'it glanced at the cursor');
  assert.equal(glance.activity, 'rest');
  assert.equal(glance.reaction, null);
  // Its ink follows the theme.
  const ink = () => app.eval(`(() => { const d = __stet.dino; d.lastSig = ''; d.draw(); const c = d.canvas, x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < x.length; i += 4) if (x[i] > 200) return [x[i - 3], x[i - 2], x[i - 1]].join(); return null; })()`);
  await app.eval(`__stet.cmd.run('theme-dark')`); await sleep(100);
  const dark = await ink();
  await app.eval(`__stet.cmd.run('theme-light')`); await sleep(100);
  const light = await ink();
  assert.ok(dark && light && dark !== light, `${dark} vs ${light}`);
  // It can be hidden from the View menu, and stays hidden after a restart.
  await app.eval(`__stet.cmd.run('companion')`);
  assert.equal(await app.eval('document.getElementById("dino").hidden'), true);
  await app.close();
  app = await launch();
  assert.equal(await app.eval('document.getElementById("dino").hidden'), true);
  await app.eval(`__stet.cmd.run('companion')`);
  assert.equal(await app.eval('document.getElementById("dino").hidden'), false);
});

test('animations: one calm easing everywhere, panels glide, nothing bounces', async () => {
  const curves = await app.eval(`(() => { const out = []; for (const sh of document.styleSheets) for (const r of sh.cssRules) { const t = r.cssText; for (const m of t.matchAll(/cubic-bezier\\(([^)]+)\\)/g)) out.push(m[1]); if (/bounce|elastic|spring/i.test(t)) out.push('NAMED:' + t.slice(0, 60)); } return out; })()`);
  for (const c of curves) {
    assert.ok(!c.startsWith('NAMED'), c);
    const [, y1, , y2] = c.split(',').map(Number);
    assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `no overshoot in cubic-bezier(${c})`);
  }
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  const anim = await app.eval(`(() => document.getElementById('left').getAnimations().map(a => ({ easing: a.effect.getTiming().easing, duration: a.effect.getTiming().duration })))()`);
  assert.equal(anim.length, 1);
  assert.equal(anim[0].easing, 'cubic-bezier(0.2, 0, 0, 1)');
  assert.ok(anim[0].duration >= 100 && anim[0].duration <= 200);
  // Typing still works while it moves.
  await app.type('z');
  await sleep(250);
  assert.equal(await app.eval(`document.getElementById('left').hidden`), false);
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  assert.equal(await app.eval(`document.getElementById('left').getAnimations()[0].effect.getTiming().easing`), 'cubic-bezier(0.4, 0, 0.2, 1)');
  await sleep(250);
  assert.equal(await app.eval(`document.getElementById('left').hidden`), true, 'closed after easing out');
  // Toolbar: colour transitions only, pressed/active states immediate, no movement.
  const tb = await app.eval(`(() => { const b = document.getElementById('btn-scenes'); const cs = getComputedStyle(b); b.classList.add('on'); const on = getComputedStyle(b).transitionDuration; b.classList.remove('on'); return { prop: cs.transitionProperty, on, transform: cs.transform, anim: cs.animationName }; })()`);
  assert.match(tb.prop, /background-color/);
  assert.ok(!/transform/.test(tb.prop));
  assert.equal(tb.on, '0s');
  assert.equal(tb.transform, 'none');
  assert.equal(tb.anim, 'none');
  // Switching elements doesn't shift the status bar sideways.
  const xs = [];
  for (const k of ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+5', 'Ctrl+6']) { await app.key(k); await frame(); xs.push(await app.eval(`document.getElementById('st-page').getBoundingClientRect().left`)); }
  assert.equal(new Set(xs).size, 1, `status items stay put (${xs})`);
});

test('toolbar: the active REVISE button stops short of the separator lines', async () => {
  await app.eval('__stet.revision.show(true)');
  await sleep(250);
  const g = await app.eval(`(() => { const bar = document.getElementById('elbar').getBoundingClientRect(), top = document.getElementById('top').getBoundingClientRect(), b = document.getElementById('btn-rev'); const r = b.getBoundingClientRect(); return { on: b.classList.contains('on'), gapTop: r.top - top.bottom, gapBottom: (bar.bottom - 1) - r.bottom, others: [...document.querySelectorAll('#elbar .tb')].map(x => Math.round(x.getBoundingClientRect().top - top.bottom)) }; })()`);
  assert.equal(g.on, true);
  assert.ok(g.gapTop >= 2, `gap above (${g.gapTop})`);
  assert.ok(g.gapBottom >= 2, `gap below (${g.gapBottom})`);
  assert.equal(new Set(g.others).size, 1, 'same spacing for every toolbar button');
  // The rule above the toolbar ends a margin before REVISE.
  const line = await app.eval(`(() => { const r = document.getElementById('elright'), cs = getComputedStyle(r, '::before'); const rev = document.getElementById('btn-rev').getBoundingClientRect(); const top = document.getElementById('top').getBoundingClientRect(); return { maskStart: r.getBoundingClientRect().left + parseFloat(cs.left), maskTop: r.getBoundingClientRect().top + parseFloat(cs.top), lineY: top.bottom - 1, revLeft: rev.left, bg: cs.backgroundColor, bar: getComputedStyle(document.getElementById('elbar')).backgroundColor }; })()`);
  assert.equal(line.maskTop, line.lineY, 'covers the rule exactly');
  assert.equal(line.bg, line.bar);
  assert.ok(line.revLeft - line.maskStart >= 10, `line stops ${line.revLeft - line.maskStart}px before REVISE`);
  await app.eval('__stet.revision.show(false)');
});
