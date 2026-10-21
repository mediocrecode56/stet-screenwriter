// 0.8 in the real app: the dinosaur's play area and responsiveness (clicks, not hovering), the weekly
// view with large numbers, one slide animation for every panel, Open Recent
// with long paths, and the header (menus left, centred title, icon and version
// bottom left) — alongside word counting, statistics and the Reset flow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, ud, app;
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mouse = (type, x, y, extra = {}) => app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
const newDoc = (title = 'T') => app.eval(`(async () => { const { newDocument, makeBlock } = await import('../core/model.js'); const d = newDocument(${JSON.stringify(title)}); d.settings.backup.enabled = false; d.blocks = [makeBlock('action')]; __stet.session.load(d, null); })()`);
async function forceHover(sel) {
  const { root } = await app.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await app.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  await app.send('CSS.enable');
  await app.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
}
const anims = (sel) => app.eval(`document.querySelector(${JSON.stringify(sel)}).getAnimations().length`);
// Last week: heavy, very uneven writing; this week: a little.
const LAST = [18450, 2240, 0, 131830, 9420, 0, 612];

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-lay-'));
  ud = path.join(tmp, 'ud');
  await fs.mkdir(ud, { recursive: true });
  const today = new Date();
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = {};
  let total = 0;
  for (let i = -7; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    if (key(d) > key(today)) break;
    const w = i < 0 ? LAST[i + 7] : 700;
    if (!w) continue;
    days[key(d)] = { w, docs: { a: w } };
    total += w;
  }
  const start = new Date(monday); start.setDate(monday.getDate() - 7);
  await fs.writeFile(path.join(ud, 'stats.json'), JSON.stringify({ version: 2, start: start.toISOString(), since: key(start), total, days, docs: { a: { w: total, title: 'Night Ferry', path: 'C:\\x\\Night Ferry.stet', first: key(start), last: key(today) } }, resets: [] }));
  // Recent projects with very long names and paths.
  const deep = path.join(tmp, 'OneDrive - Personal', 'Documents', 'Screenwriting', 'Features', 'In Development', 'Second Draft Notes and Revisions', 'Archive');
  await fs.mkdir(deep, { recursive: true });
  const recent = [];
  for (const n of ['The Extraordinarily Long Title of a Screenplay That Never Ends, Part Two', 'Night Ferry']) {
    const f = path.join(deep, n + '.stet');
    await fs.writeFile(f, '{}');
    recent.push({ path: f, name: n, opened: Date.now() - recent.length * 3600e3 });
  }
  await fs.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ recent, goals: { daily: 1000, weekly: 6000 } }));
  app = await App.launch({ userData: ud });
  await sleep(600);
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('header: File/Edit/Element at the left edge, only the title, centred on the window; icon and version bottom left', async () => {
  await newDoc('Night Ferry');
  await sleep(100);
  const g = await app.eval(`(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; }; const m = [...document.querySelectorAll('#menubar .mb')].map((b) => b.textContent); return { menus: m.slice(0, 3), menuLeft: r('menubar').left, menuRight: r('menubar').right, title: document.getElementById('doctitle').textContent, centre: (r('docname').left + r('docname').right) / 2, win: innerWidth, brand: r('brand'), status: r('status'), mark: r('mark').width, inTop: !!document.querySelector('#top #mark, #top #ver') }; })()`);
  assert.deepEqual(g.menus, ['File', 'Edit', 'Element']);
  assert.equal(g.menuLeft, 0, 'the menus start at the left edge');
  assert.equal(g.title, 'Night Ferry', 'the title alone: no path, no status');
  assert.ok(Math.abs(g.centre - g.win / 2) <= 1, `centred on the window (${g.centre} of ${g.win})`);
  assert.equal(g.inTop, false, 'icon and version are no longer in the header');
  assert.ok(g.brand.left <= 8 && g.brand.top >= g.status.top - 0.5 && g.brand.bottom <= g.status.bottom + 0.5, `bottom left, in the status bar (${JSON.stringify([g.brand, g.status])})`);
  assert.equal(g.mark, 11, 'a little smaller (11 px, was 14)');
  // Saved under a long name: still the name only, centred, shortened before it reaches the menus.
  const f = path.join(tmp, 'An Extraordinarily Long Screenplay Title That Keeps On Going And Going And Going Well Past The Menus.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(f)})`)).ok, true);
  await sleep(150);
  const l = await app.eval(`(() => { const t = document.getElementById('doctitle'), d = document.getElementById('docname').getBoundingClientRect(); return { text: t.textContent, clipped: t.scrollWidth > t.clientWidth, left: d.left, right: d.right, menus: document.getElementById('menubar').getBoundingClientRect().right, win: innerWidth }; })()`);
  assert.ok(!l.text.includes('\\') && !l.text.includes(tmp), 'no path');
  assert.ok(l.clipped, 'shortened with an ellipsis');
  assert.ok(l.left >= l.menus + 8, 'never reaches the menus');
  assert.ok(Math.abs((l.left + l.right) / 2 - l.win / 2) <= 1, 'still centred');
  await newDoc('Second');
  assert.equal(await app.eval(`document.getElementById('doctitle').textContent`), 'Second', 'updates when switching documents');
});

test('the dinosaur: wide play area, ignores the pointer passing over it, acknowledges clicks at once, never gets in the way of a drag', async () => {
  const d = await app.eval(`(() => { const d = __stet.dino, c = d.c; return { strip: d.stripW, left: d.stripLeft, bottom: d.bottom, maxX: c.maxX }; })()`);
  assert.ok(d.strip >= 400, `strip ${d.strip}`);
  // Its feet stand on the status bar's top border, never over it, and the playground spans the editor's whole width.
  const feet = `(() => { const d = document.getElementById('dino').getBoundingClientRect(), s = document.getElementById('status').getBoundingClientRect(), a = document.getElementById('scroller').getBoundingClientRect();
    return { bottom: d.bottom, line: s.top, px: 1 / devicePixelRatio, width: __stet.dino.stripW, area: a.width, home: __stet.dino.home }; })()`;
  const onLine = (g, when) => assert.ok(g.bottom <= g.line + 1e-6 && g.bottom > g.line - g.px - 1e-6, `${when}: feet at ${g.bottom}, border at ${g.line}`);
  let g = await app.eval(feet);
  onLine(g, 'full width');
  assert.ok(g.width >= g.area - 12, `the whole editor width (${g.width} of ${g.area})`);
  assert.ok(g.home.hi - g.home.lo <= 560 && g.home.hi - g.home.lo < g.width, 'with a home stretch around TODAY');
  // Put it in a resting pose, then sweep the pointer over it, around it, in and out.
  await app.eval(`(() => { const c = __stet.dino.c; c.queue = []; c.props = []; c.inReaction = null; c.paused = null; c.held = []; c.envNext = Infinity; c.pending = 'rest'; c.gen = null; c.cursor = null; c.rng = () => 0.5; })()`);
  await sleep(900);
  const before = await app.eval(`(() => { const c = __stet.dino.c; return { x: c.x, activity: c.activity, history: c.history.length }; })()`);
  assert.equal(before.activity, 'rest');
  const box = await app.eval(`(() => { const r = document.querySelector('.dino-hit').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; })()`);
  for (let i = 0; i <= 8; i++) {
    const x = box.l - 60 + (i / 8) * (box.r - box.l + 120), y = i % 2 ? (box.t + box.b) / 2 : box.t - 15;
    await mouse('mouseMoved', x, y);
    await sleep(25);
  }
  const after = await app.eval(`(() => { const c = __stet.dino.c; return { activity: c.activity, reaction: c.inReaction, queued: c.queue.length, cursor: c.cursor, history: c.history.length, ack: c.ack }; })()`);
  assert.equal(after.activity, 'rest', 'still resting');
  assert.equal(after.reaction, null, 'no reaction');
  assert.equal(after.queued, 0);
  assert.equal(after.history, before.history, 'nothing chosen');
  assert.equal(after.cursor, null, 'it was never even told where the pointer is');
  assert.equal(after.ack, null, 'no acknowledgement without a click');
  await app.eval('__stet.dino.c.rng = Math.random');
  // A click on it: acknowledged in the same moment, the reaction follows shortly.
  const hit = await app.eval(`(() => { const r = document.querySelector('.dino-hit').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await app.eval(`__stet.dino.c.force = 'love'`);
  await mouse('mousePressed', hit.x, hit.y, { clickCount: 1 });
  await mouse('mouseReleased', hit.x, hit.y, { clickCount: 1 });
  const ack = await app.eval('__stet.dino.c.ack && performance.now() - __stet.dino.c.ack.t0');
  assert.ok(ack != null && ack < 200, 'acknowledged');
  let reacted = false;
  for (let i = 0; i < 40 && !reacted; i++) { await sleep(25); reacted = await app.eval(`__stet.dino.c.inReaction === 'love' || __stet.dino.c.history.at(-1) === 'love' && !__stet.dino.c.queue.length`); }
  assert.ok(reacted, 'the reaction began within a second');
  // A text selection dragged across it is not caught by it.
  const page = await app.eval(`(() => { const r = document.querySelector('.page').getBoundingClientRect(); return { x: r.left + 120, y: r.top + 100 }; })()`);
  await mouse('mousePressed', page.x, page.y, { clickCount: 1 });
  assert.equal(await app.eval(`getComputedStyle(document.querySelector('.dino-hit')).pointerEvents`), 'none', 'lets the drag through');
  await mouse('mouseMoved', hit.x, hit.y, { buttons: 1 });
  await mouse('mouseReleased', hit.x, hit.y, { clickCount: 1 });
  assert.equal(await app.eval(`getComputedStyle(document.querySelector('.dino-hit')).pointerEvents`), 'auto', 'clickable again afterwards');
  // Opening a side panel narrows the area: it stays whole and on screen, and walks back in if need be.
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await sleep(400);
  let inside = false;
  for (let i = 0; i < 60 && !inside; i++) { await sleep(250); inside = await app.eval(`(() => { const r = document.getElementById('dino').getBoundingClientRect(), s = document.getElementById('scroller').getBoundingClientRect(); return __stet.dino.c.onstage() && r.right <= s.right + 0.5; })()`); }
  assert.ok(inside, 'back inside the narrower area, never over the panel');
  onLine(await app.eval(feet), 'with a side panel open');
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await sleep(300);
});

test('weekly view with thousands of words a day: readable, proportional, compact', async () => {
  await app.eval('void __stet.cmd.run("stats")');
  await sleep(300);
  await app.eval(`document.querySelector('#overlay .wk-nav').click()`); // last week
  await sleep(300);
  const v = await app.eval(`(() => {
    const dlg = document.querySelector('#overlay .dlg'), body = dlg.querySelector('.body');
    const cols = [...dlg.querySelectorAll('.wk-col')].map((c) => { const val = c.querySelector('.wk-val'), r = val.getBoundingClientRect(), cr = c.getBoundingClientRect(); return { text: val.textContent, l: r.left, r: r.right, bar: c.querySelector('.wk-bar').getBoundingClientRect().height, over: c.classList.contains('over'), colL: cr.left, colR: cr.right, clipped: val.scrollWidth > val.clientWidth + 1 }; });
    const plot = dlg.querySelector('.wk-plot').getBoundingClientRect();
    return { cols, h: dlg.getBoundingClientRect().height, w: dlg.getBoundingClientRect().width, scroll: [body.scrollWidth - body.clientWidth, body.scrollHeight - body.clientHeight], goalLine: !!dlg.querySelector('.wk-goal'), centred: (() => { const b = dlg.querySelector('.wk-chart').getBoundingClientRect(), p = dlg.querySelector('.wk-plot').getBoundingClientRect(); return Math.abs((p.left - b.left) - (b.right - p.right)) <= 1; })(), ticks: [...dlg.querySelectorAll('.wk-axis-l .wk-tick')].map((t) => t.textContent), head: [...dlg.querySelectorAll('.wk-n')].map((n) => n.textContent), plotTop: plot.top };
  })()`);
  const total = LAST.reduce((a, b) => a + b, 0);
  const fmt = (n) => app.eval(`(${n}).toLocaleString()`); // as the app formats numbers
  assert.equal(v.head[0], `${await fmt(total)} / ${await fmt(6000)}`, 'week total against the weekly goal');
  const want = [];
  for (const n of LAST) want.push(await fmt(n));
  assert.deepEqual(v.cols.map((c) => c.text), want, 'every day exactly, with separators');
  assert.deepEqual(v.scroll, [0, 0], 'no scrolling');
  assert.ok(v.h < 520 && v.w <= 562, `compact (${Math.round(v.w)}×${Math.round(v.h)})`);
  for (let i = 1; i < v.cols.length; i++) assert.ok(v.cols[i].l >= v.cols[i - 1].r, `labels never overlap (${v.cols[i - 1].text} / ${v.cols[i].text})`);
  // The outlier day is broken off; the others keep their proportions.
  const thu = v.cols[3];
  assert.equal(thu.over, true, '131,830 drawn as a broken bar');
  const [mon, tue, , , fri] = v.cols;
  assert.ok(Math.abs(mon.bar / fri.bar - 18450 / 9420) < 0.1 && Math.abs(fri.bar / tue.bar - 9420 / 2240) < 0.3, 'bars in proportion');
  assert.ok(v.goalLine, 'the goal drawn as a line across the chart');
  assert.ok(v.centred, 'the chart is centred: the same margin on both sides');
  assert.equal(v.ticks.length, 3, 'a word scale: 0, half and full (' + v.ticks.join(', ') + ')');
  await app.key('Escape');
  await sleep(200);
  // Reset still asks first, and Cancel leaves everything as it was.
  const kept = await app.eval('__stet.writing.book.data.total');
  await app.eval('void __stet.cmd.run("stats")');
  await sleep(250);
  await app.eval(`document.querySelector('#overlay .wk-reset').click()`);
  await sleep(250);
  assert.match(await app.eval(`document.querySelector('#overlay .dlg h2').textContent`), /RESET STATISTICS/);
  await app.eval(`[...document.querySelectorAll('#overlay .btn')].find((b) => b.textContent === 'Cancel').click()`);
  await sleep(250);
  assert.equal(await app.eval('__stet.writing.book.data.total'), kept, 'nothing cleared');
  assert.ok(kept >= total);
  await app.key('Escape');
  await sleep(200);
});

test('every panel opens and closes with the same slide; Ctrl+F never delays typing', async () => {
  await newDoc();
  await app.eval(`document.getElementById('input').focus()`);
  await app.type('mara and mara ');
  await app.key('Ctrl+F');
  const f = await app.eval(`(() => { const b = document.getElementById('findbar'); return { open: b.dataset.open, anims: b.getAnimations().map((a) => a.effect.getTiming()), focus: document.activeElement.id, side: b.dataset.side }; })()`);
  assert.equal(f.open, '1');
  assert.equal(f.side, 'top', 'slides from under the toolbar');
  assert.equal(f.focus, 'find-q', 'the field has focus at once');
  assert.equal(f.anims.length, 1);
  const panel = await app.eval(`(() => { const host = document.getElementById('left'); __stet.cmd.run('panel-scenes'); const t = host.getAnimations()[0].effect.getTiming(); __stet.cmd.run('panel-scenes'); return t; })()`);
  assert.equal(f.anims[0].duration, panel.duration, 'same duration as the side panels');
  assert.equal(f.anims[0].easing, panel.easing, 'same easing');
  await app.type('mara');
  await sleep(200);
  assert.match(await app.eval(`document.getElementById('find-count').textContent`), /\/ 2$/, 'searched while it slid in');
  // Closing and reopening during the slide reverses smoothly, no jump.
  await app.key('Escape');
  // (Sampled once the slide is under way: a busy machine may take a frame or two to start it.)
  const mid = await app.eval(`new Promise((r) => { const t0 = performance.now(), m = () => parseFloat(getComputedStyle(document.getElementById('findbar')).marginTop); const go = () => (m() < 0 || performance.now() - t0 > 400 ? r(m()) : setTimeout(go, 10)); setTimeout(go, 30); })`);
  await app.key('Ctrl+F');
  const back = await app.eval(`parseFloat(getComputedStyle(document.getElementById('findbar')).marginTop)`);
  assert.ok(mid < 0 && back <= 0 && back >= mid - 2, `reverses from where it was (${mid} → ${back})`);
  await sleep(300);
  assert.equal(await app.eval(`parseFloat(getComputedStyle(document.getElementById('findbar')).marginTop)`), 0);
  await app.key('Escape');
  await sleep(300);
  assert.equal(await app.eval(`document.getElementById('findbar').hidden`), true);
  // Dialogs and menus arrive the same way; a dialog that replaces another doesn't arrive twice.
  await app.eval('void __stet.cmd.run("keys")');
  assert.equal(await anims('#overlay .dlg'), 1, 'a dialog drops in');
  await app.key('Escape');
  assert.equal(await app.eval('document.getElementById("overlay").style.pointerEvents'), 'none', 'a closing dialog no longer takes input');
  await sleep(250);
  assert.equal(await app.eval('document.getElementById("overlay").hidden'), true);
  await app.eval(`document.querySelector('#menubar .mb').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  assert.equal(await anims('.menu'), 1, 'a menu drops in');
  await app.key('Escape');
  await sleep(200);
  assert.equal(await app.eval('document.querySelectorAll(".menu").length'), 0);
  // Reduced motion: no movement at all.
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await app.key('Ctrl+F');
  assert.equal(await anims('#findbar'), 0);
  await app.key('Escape');
  assert.equal(await app.eval(`document.getElementById('findbar').hidden`), true, 'closes at once');
  await app.send('Emulation.setEmulatedMedia', { features: [] });
});

test('File menu: hovering Open Recent shows the recent screenplays, compact, long titles shortened; a click opens one', async () => {
  await app.eval(`document.querySelector('#menubar .mb').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await sleep(150);
  await app.eval(`document.querySelector('.menu .mi.has-sub').dispatchEvent(new MouseEvent('mouseenter'))`);
  await sleep(50);
  const v = await app.eval(`(() => { const s = document.querySelector('.msub'); if (!s) return null; const r = s.getBoundingClientRect(), t = [...s.querySelectorAll('.mi-t')], long = t.find((x) => x.textContent.startsWith('The Extraordinarily')); return { names: t.map((x) => x.textContent), clipped: long.scrollWidth > long.clientWidth, width: r.width, inside: r.right <= innerWidth && r.left >= 0 }; })()`);
  assert.ok(v, 'the flyout appears');
  assert.ok(v.names.includes('Night Ferry'), v.names.join(', '));
  assert.ok(v.clipped && v.width <= 260, 'a long title ends in … and the list stays narrow (' + v.width + 'px)');
  assert.ok(v.inside, 'within the window');
  await app.eval(`[...document.querySelectorAll('.msub .mi')].find((m) => m.textContent === 'Night Ferry').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))`);
  await sleep(400);
  assert.equal(await app.eval('document.querySelectorAll(".menu").length'), 0, 'the menu closes');
  assert.ok(await app.eval(`document.getElementById('doctitle').textContent.includes('Night Ferry') || !!document.querySelector('#overlay .dlg')`), 'the screenplay is opened (or its error shown)');
  if (await app.eval(`!!document.querySelector('#overlay .dlg')`)) { await app.key('Escape'); await sleep(200); }
});

test('Open Recent: both actions visible and working on hover, no horizontal scrolling, long paths shortened from the start', async () => {
  // A hidden test window doesn't run CSS transitions, so read the hovered state with motion reduced (no fade).
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const w of [1280, 760]) {
    await app.send('Emulation.setDeviceMetricsOverride', { width: w, height: 700, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    await app.eval(`void __stet.cmd.run('recent')`);
    await sleep(350);
    const row = await app.eval(`(() => { const r = document.querySelector('#overlay .recent-row').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
    await mouse('mouseMoved', row.x, row.y);
    await sleep(150);
    // A hidden test window may not update :hover from synthetic mouse moves; then force it on that row.
    if (!(await app.eval(`document.querySelector('#overlay .recent-row').matches(':hover')`))) await forceHover('#overlay .recent-row');
    const r = await app.eval(`(() => {
      const dlg = document.querySelector('#overlay .dlg').getBoundingClientRect(), body = document.querySelector('#overlay .body');
      const row = document.querySelector('#overlay .recent-row');
      const icons = [...row.querySelectorAll('.ra')].map((e) => { const q = e.getBoundingClientRect(), at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { label: e.getAttribute('aria-label'), title: e.title, op: getComputedStyle(e).opacity, inside: q.left >= dlg.left && q.right <= dlg.right, onTop: e === at || e.contains(at) }; });
      const p = row.querySelector('.rc-path'), n = row.querySelector('.rc-name');
      return { scroll: body.scrollWidth - body.clientWidth, icons, path: p.textContent, full: p.title, pathFits: p.scrollWidth <= p.clientWidth, nameRight: n.getBoundingClientRect().right, pathLeft: p.getBoundingClientRect().left, iconLeft: Math.min(...[...row.querySelectorAll('.ra')].map((e) => e.getBoundingClientRect().left)), pathRight: p.getBoundingClientRect().right };
    })()`);
    assert.equal(r.scroll, 0, `no horizontal scrolling at ${w} px`);
    assert.equal(r.icons.length, 3);
    for (const i of r.icons) { assert.equal(i.op, '1', `${i.title} visible on hover`); assert.ok(i.inside && i.onTop, `${i.title} inside the dialog and not covered`); }
    assert.match(r.icons[0].title, /Show in Folder/);
    assert.match(r.icons[1].title, /Remove from Recent/);
    assert.match(r.icons[2].title, /Move to Recycle Bin/);
    assert.ok(r.path.startsWith('…') && r.full.endsWith(r.path.slice(1)), `shortened at the start: ${r.path}`);
    assert.ok(r.path.endsWith('.stet'), 'the file name is kept');
    assert.ok(r.pathFits && r.pathRight <= r.iconLeft, 'the path never runs under the icons');
    await app.key('Escape');
    await sleep(200);
  }
  await app.send('Emulation.clearDeviceMetricsOverride');
  await app.send('Emulation.setEmulatedMedia', { features: [] });
  // Dismiss (the file stays) updates the list at once.
  await app.eval(`void __stet.cmd.run('recent')`);
  await sleep(300);
  const n0 = await app.eval(`document.querySelectorAll('#overlay .recent-row').length`);
  const target = await app.eval(`document.querySelectorAll('#overlay .rc-path')[1].title`);
  await app.eval(`document.querySelectorAll('#overlay .recent-row')[1].querySelector('.ra-dismiss').click()`);
  await sleep(150);
  assert.equal(await app.eval(`document.querySelectorAll('#overlay .recent-row').length`), n0 - 1);
  await fs.access(target);
  await app.key('Escape');
});
