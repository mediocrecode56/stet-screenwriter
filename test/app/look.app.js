// How the real app looks and moves: the header (menus at the left, the title alone and centred, the
// icon and version bottom left), the status bar, the theme switch and its schedule (a time-zone
// change, a restart), one slide for every panel and bar, one calm easing, a toolbar that never
// shifts, and the REVISE button inside its rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { App, scratch } from './harness.js';

let tmp, app, ud;
before(async () => {
  tmp = await scratch('stet-look');
  ud = path.join(tmp, 'ud');
  app = await App.launch({ userData: ud });
});
after(() => app?.close());

const anims = (sel) => app.eval(`document.querySelector(${JSON.stringify(sel)}).getAnimations().length`);
const theme = () => app.eval('document.documentElement.dataset.theme');
const settings = () => app.eval('window.stet.invoke("settings:get")');
// A time of day `min` minutes from now on the wall clock (not now plus so many hours: on the night the clocks go back, an hour on can read as now).
const wall = (min) => { const n = new Date(), m = (((n.getHours() * 60 + n.getMinutes() + Math.round(min)) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const refocus = () => app.eval('window.dispatchEvent(new Event("focus"))'); // the schedule is checked on focus (and every minute)

test('the header: File, Edit, Element at the left edge; the title alone, centred, shortened before the menus; icon and version bottom left', async () => {
  await app.load([], {}, 'Night Ferry');
  const g = await app.eval(`(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; }; return { menus: [...document.querySelectorAll('#menubar .mb')].map((b) => b.textContent).slice(0, 3), menuLeft: r('menubar').left, title: document.getElementById('doctitle').textContent, centre: (r('docname').left + r('docname').right) / 2, win: innerWidth, brand: r('brand'), status: r('status'), mark: r('mark').width, inTop: !!document.querySelector('#top #mark, #top #ver') }; })()`);
  assert.deepEqual(g.menus, ['File', 'Edit', 'Element']);
  assert.equal(g.menuLeft, 0, 'the menus start at the left edge');
  assert.equal(g.title, 'Night Ferry', 'the title alone: no path, no status');
  assert.ok(Math.abs(g.centre - g.win / 2) <= 1, `centred on the window (${g.centre} of ${g.win})`);
  assert.equal(g.inTop, false, 'no icon or version in the header');
  assert.ok(g.brand.left <= 8 && g.brand.top >= g.status.top - 0.5 && g.brand.bottom <= g.status.bottom + 0.5, 'bottom left, in the status bar');
  assert.equal(g.mark, 11);
  const f = path.join(tmp, 'An Extraordinarily Long Screenplay Title That Keeps On Going And Going And Going Well Past The Menus.stet');
  assert.equal((await app.saveTo(f)).ok, true);
  const l = await app.until(`(() => { const t = document.getElementById('doctitle'), d = document.getElementById('docname').getBoundingClientRect(); return t.textContent.startsWith('An Extra') && { text: t.textContent, clipped: t.scrollWidth > t.clientWidth, left: d.left, right: d.right, menus: document.getElementById('menubar').getBoundingClientRect().right, win: innerWidth }; })()`);
  assert.ok(!l.text.includes(tmp), 'no path');
  assert.ok(l.clipped && l.left >= l.menus + 8, 'shortened with an ellipsis, never reaching the menus');
  assert.ok(Math.abs((l.left + l.right) / 2 - l.win / 2) <= 1, 'still centred');
  await app.load([], {}, 'Second');
  assert.equal(await app.eval(`document.getElementById('doctitle').textContent`), 'Second', 'it follows the open screenplay');
});

test('the status bar: a plain clock, no save text (the square beside the title is the only sign); goals take clicks only on their numbers', async () => {
  const v = await app.eval(`(() => { const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return { clock: document.getElementById('st-clock').textContent, now: [t(Date.now() - 5000), t(Date.now())], save: !!document.getElementById('st-save'), dot: document.getElementById('docdot').title }; })()`);
  assert.ok(v.now.includes(v.clock), `the time now, in this computer’s format (${v.clock}, ${v.now})`);
  assert.equal(v.save, false);
  assert.match(v.dot, /saved/i, 'the square says whether it is saved');
  await app.eval(`void __stet.cmd.run('stats')`);
  await app.until(`!!document.querySelector('#overlay .wk-goals')`);
  const g = await app.eval(`(() => { const d = document.querySelector('#overlay .dlg'), k = d.querySelector('.wk-goals .wk-k'); return { labels: d.querySelectorAll('label').length, inputs: d.querySelectorAll('.wk-goals input').length, select: getComputedStyle(k).userSelect, cursor: getComputedStyle(k).cursor, inCursor: getComputedStyle(d.querySelector('.wk-in')).cursor }; })()`);
  assert.deepEqual(g, { labels: 0, inputs: 2, select: 'none', cursor: 'default', inCursor: 'text' }, 'no dialog text to select by accident');
  await app.key('Escape');
  await app.noDialog();
});

test('the theme switch in the status bar shows the theme; buttons show they are pressed at once; Ctrl+Shift+L toggles', async () => {
  assert.ok(await app.eval('!!document.querySelector("#status .seg #th-light")'));
  await app.clickOn('#th-light');
  assert.equal(await theme(), 'light');
  assert.ok(await app.eval('document.getElementById("th-light").classList.contains("on")'));
  await app.clickOn('#th-dark');
  assert.equal(await theme(), 'dark');
  assert.ok(await app.eval('document.getElementById("th-dark").classList.contains("on")'));
  await app.until(async () => (await settings()).theme === 'dark', { what: 'saved' });
  await app.key('Mod+Shift+L');
  assert.equal(await theme(), 'light');
  await app.key('Mod+Shift+L');
  assert.equal(await theme(), 'dark');
  // Pressed feedback at pointerdown, before the click is even complete.
  const b = await app.rect('[data-t="action"]');
  await app.mouse('mousePressed', b.x, b.y, { button: 'left', buttons: 1, clickCount: 1 });
  assert.ok(await app.eval(`document.querySelector('[data-t="action"]').classList.contains('pressed')`), 'pressed at once');
  await app.mouse('mouseReleased', b.x, b.y, { button: 'left', clickCount: 1 });
  assert.equal(await app.eval(`document.querySelector('[data-t="action"]').classList.contains('pressed')`), false);
});

test('AUTO applies the scheduled theme at once; a manual pick turns it off; a time-zone change moves it at the next check', async () => {
  const now = new Date();
  const sched = { enabled: false, darkAt: wall(-60), lightAt: wall(60) }; // dark now
  await app.clickOn('#th-light');
  await app.eval(`window.stet.invoke('settings:set', { schedule: ${JSON.stringify(sched)} }).then(() => { __stet.settings().schedule = ${JSON.stringify(sched)}; })`);
  await app.clickOn('#th-auto');
  assert.equal(await theme(), 'dark', 'the scheduled theme, at once');
  assert.ok(await app.eval('document.getElementById("th-auto").classList.contains("on")'));
  await app.clickOn('#th-light');
  assert.equal(await theme(), 'light');
  await app.until(async () => (await settings()).schedule.enabled === false, { what: 'AUTO off, saved' });
  await refocus();
  assert.equal(await theme(), 'light', 'the check on focus does not undo a manual choice');
  // Dark from five hours from now: light here; six hours further east, dark.
  const later = { enabled: true, darkAt: wall(300), lightAt: wall(540) };
  await app.eval(`window.stet.invoke('settings:set', { schedule: ${JSON.stringify(later)} }).then(() => { __stet.settings().schedule = ${JSON.stringify(later)}; })`);
  await refocus();
  assert.equal(await theme(), 'light', 'outside the dark hours here');
  const h = -Math.round(-now.getTimezoneOffset() / 60 + 6);
  await app.send('Emulation.setTimezoneOverride', { timezoneId: 'Etc/GMT' + (h >= 0 ? '+' + h : h) });
  await refocus();
  assert.equal(await theme(), 'dark', 'switched after the zone change');
  await app.send('Emulation.setTimezoneOverride', { timezoneId: '' });
  await refocus();
  assert.equal(await theme(), 'light');
});

test('the schedule is kept across a restart and applies at launch; the manual choice waits for AUTO to be turned off', async () => {
  const now = new Date();
  const sched = { enabled: true, darkAt: wall(-60), lightAt: wall(60) };
  await app.eval(`window.stet.invoke('settings:set', { theme: 'light', schedule: ${JSON.stringify(sched)} })`);
  await app.close();
  app = await App.launch({ userData: ud });
  assert.equal(await theme(), 'dark');
  assert.ok(await app.eval('document.getElementById("th-auto").classList.contains("on")'));
  assert.equal((await settings()).theme, 'light', 'the manual preference kept');
  await app.clickOn('#th-auto');
  assert.equal(await theme(), 'light', 'and back when AUTO goes off');
});

test('every panel, bar, dialog and menu arrives with the same slide; Find searches while it slides and reverses smoothly', async () => {
  await app.load([]);
  await app.type('mara and mara ');
  await app.key('Mod+F');
  const f = await app.eval(`(() => { const b = document.getElementById('findbar'); return { open: b.dataset.open, anims: b.getAnimations().map((a) => a.effect.getTiming()), focus: document.activeElement.id, side: b.dataset.side }; })()`);
  assert.deepEqual([f.open, f.side, f.focus, f.anims.length], ['1', 'top', 'find-q', 1], 'from under the toolbar, the field ready at once');
  const panel = await app.eval(`(() => { const host = document.getElementById('left'); __stet.cmd.run('panel-scenes'); const t = host.getAnimations()[0].effect.getTiming(); __stet.cmd.run('panel-scenes'); return t; })()`);
  assert.deepEqual([f.anims[0].duration, f.anims[0].easing], [panel.duration, panel.easing], 'the same timing as the side panels');
  await app.type('mara');
  await app.until(`/\\/ 2$/.test(document.getElementById('find-count').textContent)`, { what: 'searched while it slid in' });
  await app.key('Escape');
  // Reopened mid-slide (sampled in the same moment, so a slow machine can't move it on between): it reverses from where it was.
  const [mid, back] = await app.eval(`new Promise((r) => { const t0 = performance.now(), m = () => parseFloat(getComputedStyle(document.getElementById('findbar')).marginTop);
    const go = () => { if (!(m() < 0) && performance.now() - t0 <= 1500) return setTimeout(go, 5); const was = m(); __stet.cmd.run('find'); r([was, m()]); }; go(); })`);
  assert.ok(mid < 0 && back <= 0 && back >= mid - 2, `reverses from where it was (${mid} → ${back})`);
  await app.until(`parseFloat(getComputedStyle(document.getElementById('findbar')).marginTop) === 0 && !document.getElementById('findbar').getAnimations().length`, { what: 'fully open again' });
  await app.key('Escape');
  await app.until(`document.getElementById('findbar').hidden`);
  await app.eval('void __stet.cmd.run("keys")');
  assert.equal(await anims('#overlay .dlg'), 1, 'a dialog drops in');
  await app.key('Escape');
  assert.equal(await app.eval('document.getElementById("overlay").style.pointerEvents'), 'none', 'a closing dialog takes no more input');
  await app.noDialog();
  await app.clickOn('#menubar .mb');
  assert.equal(await anims('.menu'), 1, 'a menu drops in');
  await app.key('Escape');
  await app.until('document.querySelectorAll(".menu").length === 0');
  // A notice rises in centred (its own transform kept, no sideways jump); a newer one takes the same box.
  const t = await app.eval(`(() => { __stet.spelling.notify('one'); const el = document.querySelector('.toast'); const a = el.getAnimations()[0]; a.pause(); a.currentTime = 1;
    const r = { transform: getComputedStyle(el).transform, translate: getComputedStyle(el).translate }; a.play(); __stet.spelling.notify('two'); r.boxes = document.querySelectorAll('.toast').length; r.text = el.textContent; return r; })()`);
  assert.match(t.transform, /^matrix\(1, 0, 0, 1, -\d/, `still centred while it arrives (${t.transform})`);
  assert.ok(parseFloat(t.translate.split(' ')[1]) > 0, `from below (${t.translate})`);
  assert.deepEqual([t.boxes, t.text], [1, 'two']);
  // The timeline's fade behind the reset button: no blur; it follows the pointer (--tl-end), each step smoothed.
  const fade = await app.eval(`(() => { const f = document.querySelector('#timeline .tl-fade'), s = getComputedStyle(f); return { blur: s.backdropFilter, ms: parseFloat(s.transitionDuration) * 1000, follows: (document.getElementById('timeline').style.setProperty('--tl-end', '0.5'), f.style.transition = 'none', getComputedStyle(f).opacity) }; })()`);
  await app.eval(`(() => { const f = document.querySelector('#timeline .tl-fade'); f.style.transition = ''; document.getElementById('timeline').style.removeProperty('--tl-end'); })()`);
  assert.equal(fade.blur, 'none');
  assert.equal(fade.follows, '0.5', 'as far up as the pointer has brought it');
  assert.ok(fade.ms > 0 && fade.ms <= 160, `a short smoothing (${fade.ms}ms)`);
  // Reduced motion: no movement at all.
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await app.key('Mod+F');
  assert.equal(await anims('#findbar'), 0);
  await app.key('Escape');
  assert.equal(await app.eval(`document.getElementById('findbar').hidden`), true, 'closed at once');
  await app.send('Emulation.setEmulatedMedia', { features: [] });
});

test('Find holds still while you type, and Enter glides the match to where a click on the timeline puts it', async () => {
  await app.load([...Array.from({ length: 150 }, (_, i) => ['action', `The rain goes on, line ${i + 1}.`]), ['action', 'A heron lands.'],
    ...Array.from({ length: 60 }, (_, i) => ['action', `After, line ${i + 1}.`])], {}, 'FIND');
  await app.eval('document.getElementById("scroller").scrollTop = 0');
  await app.key('Mod+F');
  const left = () => app.eval(`Math.round(document.getElementById('find-q').getBoundingClientRect().left)`);
  const at = [await left()];
  await app.type('line');
  await app.until(`document.getElementById('find-count').textContent === '1 / 210'`, { what: 'every line' });
  at.push(await left());
  await app.key('Mod+A');
  await app.type('heron');
  await app.until(`document.getElementById('find-count').textContent === '1 / 1'`, { what: 'the one heron' });
  at.push(await left());
  await app.type('x');
  await app.until(`document.getElementById('find-count').textContent === 'no matches'`);
  at.push(await left());
  assert.equal(new Set(at).size, 1, `the field never shifts (${at})`);
  await app.key('Backspace');
  await app.until(`document.getElementById('find-count').textContent === '1 / 1'`);
  await app.key('Enter');
  await app.until('__stet.editor.hasSelection() && !__stet.view.glide', { what: 'the glide to end' });
  const w = await app.eval(`(() => { const v = __stet.view; return { top: Math.round(v.scroller.scrollTop), key: v.keyOf(__stet.editor.ordered()[0]), row: v.row, focus: document.activeElement.id }; })()`);
  assert.ok(Math.abs(w.top - w.key) <= 1, `10% of the window above its middle, as the timeline does (${w.top} vs ${w.key})`);
  assert.equal(w.focus, 'find-q', 'Enter again finds the next');
  await app.key('Escape');
});

test('one calm easing, nothing bounces; panels glide while you type; toolbar buttons change colour only; the status bar never shifts', async () => {
  const curves = await app.eval(`(() => { const out = []; for (const sh of document.styleSheets) for (const r of sh.cssRules) { const t = r.cssText; for (const m of t.matchAll(/cubic-bezier\\(([^)]+)\\)/g)) out.push(m[1]); if (/bounce|elastic|spring/i.test(t)) out.push('NAMED:' + t.slice(0, 60)); } return out; })()`);
  for (const c of curves) {
    assert.ok(!c.startsWith('NAMED'), c);
    const [, y1, , y2] = c.split(',').map(Number);
    assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `no overshoot in cubic-bezier(${c})`);
  }
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  const a = await app.eval(`document.getElementById('left').getAnimations().map((a) => ({ easing: a.effect.getTiming().easing, duration: a.effect.getTiming().duration }))`);
  assert.equal(a.length, 1);
  assert.equal(a[0].easing, 'cubic-bezier(0.2, 0, 0, 1)');
  assert.ok(a[0].duration >= 100 && a[0].duration <= 200);
  await app.type('z'); // typing goes on while it moves
  assert.equal(await app.eval(`document.getElementById('left').hidden`), false);
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  assert.equal(await app.eval(`document.getElementById('left').getAnimations()[0].effect.getTiming().easing`), 'cubic-bezier(0.4, 0, 0.2, 1)', 'easing out');
  await app.until(`document.getElementById('left').hidden`, { what: 'closed after easing out' });
  const tb = await app.eval(`(() => { const b = document.getElementById('btn-scenes'); const cs = getComputedStyle(b); b.classList.add('on'); const on = getComputedStyle(b).transitionDuration; b.classList.remove('on'); return { prop: cs.transitionProperty, on, transform: cs.transform, anim: cs.animationName }; })()`);
  assert.match(tb.prop, /background-color/);
  assert.ok(!/transform/.test(tb.prop));
  assert.deepEqual([tb.on, tb.transform, tb.anim], ['0s', 'none', 'none'], 'pressed and active states at once, no movement');
  const xs = [];
  for (const k of ['Mod+1', 'Mod+2', 'Mod+3', 'Mod+5', 'Mod+6']) { await app.key(k); await app.frame(); xs.push(await app.eval(`document.getElementById('st-page').getBoundingClientRect().left`)); }
  assert.equal(new Set(xs).size, 1, `the status bar stays put whatever the element (${xs})`);
});

test('the active REVISE button stops short of the toolbar’s rules, spaced like every other button', async () => {
  await app.eval('__stet.revision.show(true)');
  await app.until(`document.getElementById('btn-rev').classList.contains('on')`);
  await app.frame();
  const g = await app.eval(`(() => { const bar = document.getElementById('elbar').getBoundingClientRect(), top = document.getElementById('top').getBoundingClientRect(), r = document.getElementById('btn-rev').getBoundingClientRect(); return { gapTop: r.top - top.bottom, gapBottom: (bar.bottom - 1) - r.bottom, others: [...document.querySelectorAll('#elbar .tb')].map((x) => Math.round(x.getBoundingClientRect().top - top.bottom)) }; })()`);
  assert.ok(g.gapTop >= 2 && g.gapBottom >= 2, `room above and below (${g.gapTop}, ${g.gapBottom})`);
  assert.equal(new Set(g.others).size, 1, 'the same spacing for every toolbar button');
  const line = await app.eval(`(() => { const r = document.getElementById('elright'), cs = getComputedStyle(r, '::before'); const rev = document.getElementById('btn-rev').getBoundingClientRect(), top = document.getElementById('top').getBoundingClientRect(); return { maskStart: r.getBoundingClientRect().left + parseFloat(cs.left), maskTop: r.getBoundingClientRect().top + parseFloat(cs.top), lineY: top.bottom - 1, revLeft: rev.left, bg: cs.backgroundColor, bar: getComputedStyle(document.getElementById('elbar')).backgroundColor }; })()`);
  assert.equal(line.maskTop, line.lineY, 'the rule above is covered exactly');
  assert.equal(line.bg, line.bar);
  assert.ok(line.revLeft - line.maskStart >= 10, `the rule stops ${line.revLeft - line.maskStart}px before REVISE`);
  await app.eval('__stet.revision.show(false)');
});

test('View > Hide Toolbar slides it away and is kept; Focus Mode: full screen, the page alone, the toolbar back at the top edge, the rail at the right, Esc back', async () => {
  await app.load([['action', 'Rain.']], {}, 'Focus');
  await app.eval(`__stet.cmd.run('toolbar')`);
  await app.until(`document.getElementById('elbar').hidden`, { what: 'the toolbar hidden' });
  assert.equal((await settings()).toolbar, false, 'kept');
  await app.eval(`__stet.cmd.run('panel-scenes')`);
  await app.until(`!document.getElementById('left').hidden`, { what: 'the scene list open' });
  await app.eval(`__stet.cmd.run('focus')`);
  await app.until(`document.documentElement.classList.contains('focus')`, { what: 'focus mode' });
  await app.until(`document.getElementById('left').hidden`, { what: 'the panels away' });
  const shown = (sel) => app.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; })()`);
  for (const sel of ['#top', '#elbar', '#status']) assert.equal(await shown(sel), false, sel + ' out of sight');
  assert.equal(await shown('#content'), true, 'the page');
  // The top edge: the menus and the toolbar (hidden in the window) come down over the page.
  await app.move(400, 300); await app.move(400, 1);
  await app.until(`document.documentElement.classList.contains('peek') && document.getElementById('elbar').getBoundingClientRect().top >= 29`, { what: 'the toolbar back at the top' });
  await app.move(400, 400);
  await app.until(`!document.documentElement.classList.contains('peek')`, { what: 'gone again' });
  // The right edge: the rail, its NOTES opens the notes beside the page.
  const w = await app.eval('innerWidth'), h = await app.eval('innerHeight');
  await app.move(w - 40, h / 2); await app.move(w - 2, h / 2);
  await app.until(`document.getElementById('focus-rail').classList.contains('on')`, { what: 'the rail' });
  await app.until(`document.getElementById('focus-rail').getBoundingClientRect().right <= innerWidth + 1`, { what: 'the rail in view' });
  await app.clickOn('#focus-rail [data-f="notes"]');
  await app.until(`!document.getElementById('right').hidden`, { what: 'the notes open' });
  await app.key('Escape');
  await app.until(`!document.documentElement.classList.contains('focus')`, { what: 'back to the window' });
  await app.until(`!document.getElementById('left').hidden && document.getElementById('right').hidden`, { what: 'the panels as they were' });
  assert.equal(await shown('#status'), true, 'the status bar back');
  await app.eval(`__stet.cmd.run('toolbar')`);
  await app.until(`!document.getElementById('elbar').hidden`, { what: 'the toolbar back' });
  await app.eval(`__stet.cmd.run('panel-scenes')`);
});

test('the title page slides away and back with the script, and further down nothing moves', async () => {
  await app.load(Array.from({ length: 300 }, (_, i) => ['action', 'Line ' + i]), {}, 'Slide');
  const v = '__stet.view', thirdTop = `[...document.querySelectorAll('.page')].find((p) => p._vi === 2 + ${v}.offset).getBoundingClientRect().top`;
  await app.eval(`${v}.scroller.scrollTop = 0; ${v}.frame()`);
  await app.eval(`__stet.cmd.run('title-toggle')`);
  const s = await app.eval(`(() => { const a = document.getElementById('content').getAnimations(); return { anims: a.length, ghost: !!document.querySelector('.title-page'), shown: ${v}.showTitle, pressed: document.getElementById('btn-title').getAttribute('aria-pressed') }; })()`);
  assert.deepEqual(s, { anims: 1, ghost: true, shown: false, pressed: 'false' }, 'the title page leaves in one move');
  await app.until(`!document.querySelector('.title-page') && !document.getElementById('content').getAnimations().length`, { what: 'the title page gone' });
  assert.equal((await settings()).showTitlePage, false, 'kept');
  await app.eval(`__stet.cmd.run('title-toggle')`);
  assert.equal(await app.eval(`document.getElementById('content').getAnimations().length`), 1, 'it comes back the same way');
  // Turned around halfway, it carries on from where it is.
  await app.eval(`__stet.cmd.run('title-toggle')`);
  await app.eval(`__stet.cmd.run('title-toggle')`);
  await app.until(`!document.getElementById('content').getAnimations().length && !!document.querySelector('.title-page')`, { what: 'the title page back' });
  assert.equal(await app.eval(`document.querySelectorAll('.title-page').length`), 1, 'only one of it');
  // Further down the script stands exactly where it was.
  await app.eval(`${v}.scroller.scrollTop = ${v}.pageTop(3); ${v}.frame()`);
  const before = await app.eval(thirdTop);
  await app.eval(`__stet.cmd.run('title-toggle')`);
  assert.equal(await app.eval(`document.getElementById('content').getAnimations().length`), 0, 'no slide');
  assert.equal(Math.round(await app.eval(thirdTop)), Math.round(before), 'not a pixel');
  await app.eval(`__stet.cmd.run('title-toggle')`);
});

test('Focus Mode from Preferences; the element buttons at the top left on Tab alone; Keyboard Shortcuts from Preferences; the dinosaur only on request', async () => {
  await app.load([['action', 'Rain.'], ['action', 'Wind.']], {}, 'Corner');
  const apply = `[...document.querySelectorAll('.dlg .foot .btn')].find((b) => b.textContent === 'Apply')`;
  const inCorner = `(() => { const e = document.getElementById('eltypes').getBoundingClientRect(); return e.top >= 0 && e.top < 10 && document.documentElement.classList.contains('peek-el'); })()`;
  await app.eval(`__stet.cmd.run('prefs')`);
  await app.until(`!!document.getElementById('pref-focus')`, { what: 'Preferences' });
  assert.equal(await app.eval(`document.getElementById('pref-focus').checked`), false);
  await app.clickOn('#pref-focus');
  await app.eval(`${apply}.click()`);
  await app.until(`document.documentElement.classList.contains('focus-ready')`, { what: 'focus mode' });
  // Moving between lines or a shortcut shows nothing; Tab does, for long enough to click.
  await app.key('ArrowDown');
  await app.until(`__stet.editor.caret.b === 1`, { what: 'the next line' });
  assert.equal(await app.eval(`document.documentElement.classList.contains('peek-el')`), false, 'only a move');
  await app.eval(`__stet.cmd.run('type-scene')`);
  await app.until(`document.querySelector('#eltypes .tb.on').dataset.t === 'scene'`, { what: 'the shortcut applied' });
  assert.equal(await app.eval(`document.documentElement.classList.contains('peek-el')`), false, 'only a shortcut');
  await app.key('Tab');
  await app.until(inCorner, { what: 'the element buttons in the corner' });
  await app.until(`document.querySelector('#eltypes .tb.on').dataset.t === 'action'`, { what: 'the new element lit' });
  const clipped = await app.eval(`getComputedStyle(document.getElementById('elbar')).clipPath`);
  assert.notEqual(clipped, 'none', 'the rest of the toolbar clipped away');
  assert.deepEqual(await app.eval(`[getComputedStyle(document.getElementById('elbar')).boxShadow, getComputedStyle(document.querySelector('.cyc-box')).boxShadow]`), ['none', 'none'], 'one plain outline');
  // They are the real buttons, and the pointer on them keeps them.
  await app.until(`!document.getElementById('elbar').getAnimations().length`, { what: 'in place' });
  await app.clickOn('#eltypes [data-t="character"]');
  await app.until(`__stet.editor.block.type === 'character'`, { what: 'a click changes the element' });
  await app.move(400, 400);
  await app.until(`!document.documentElement.classList.contains('peek-el')`, { what: 'gone again', timeout: 6000 });
  await app.until(`!document.getElementById('elbar').getAnimations().length`, { what: 'out of sight' });
  // The pointer alone never brings them: near the top left nothing comes, on the edge the whole toolbar.
  await app.move(60, 20);
  assert.equal(await app.eval(`document.documentElement.classList.contains('peek-el')`), false, 'not on hover');
  await app.move(60, 1);
  await app.until(`document.documentElement.classList.contains('peek') && document.getElementById('elbar').getBoundingClientRect().top >= 29`, { what: 'the whole toolbar' });
  await app.move(400, 400);
  await app.until(`!document.documentElement.classList.contains('peek') && !document.documentElement.classList.contains('peek-el')`, { what: 'all away' });
  // The dinosaur: out of focus mode by default, on the window's edge when asked for.
  const dino = `getComputedStyle(document.getElementById('dino')).display`;
  assert.equal(await app.eval(dino), 'none', 'off by default');
  assert.equal((await settings()).focusDino, false);
  await app.eval(`__stet.cmd.run('focus-dino')`);
  await app.until(`${dino} !== 'none' && !document.getElementById('dino').hidden`, { what: 'the dinosaur' });
  await app.until(`Math.abs(document.getElementById('dino').getBoundingClientRect().bottom - innerHeight) <= 2`, { what: 'its feet on the edge' });
  assert.equal((await settings()).focusDino, true, 'kept');
  assert.equal(await app.eval(`getComputedStyle(document.getElementById('status')).display`), 'none', 'the dinosaur alone: no status bar at all');
  await app.eval(`__stet.cmd.run('focus-dino')`);
  await app.until(`${dino} === 'none'`, { what: 'the dinosaur away' });
  // Preferences shows focus mode on, leaves it, and its Keyboard Shortcuts opens the real dialog.
  await app.eval(`__stet.cmd.run('prefs')`);
  await app.until(`!!document.getElementById('pref-focus')`, { what: 'Preferences' });
  assert.equal(await app.eval(`document.getElementById('pref-focus').checked`), true);
  await app.clickOn('#pref-focus');
  await app.clickOn('#pref-keys');
  await app.until(`!document.getElementById('pref-focus') && /^KEYS/.test(document.querySelector('.dlg h2')?.textContent || '')`, { what: 'the shortcuts' });
  await app.until(`!document.documentElement.classList.contains('focus')`, { what: 'what was changed is kept' });
  await app.key('Escape');
  await app.until(`!document.querySelector('.dlg')`, { what: 'closed' });
});

test('a narrow window: the toolbar tightens only as far as it must, NOTES and every button still in the window', async () => {
  const inView = `(() => { const bar = document.getElementById('elbar'), r = bar.getBoundingClientRect(), last = document.getElementById('btn-notes').getBoundingClientRect();
    const btns = [...bar.querySelectorAll('.tb')].map((b) => b.getBoundingClientRect()).filter((q) => q.width);
    return { cls: bar.className, notes: last.right <= innerWidth - 1 && last.width > 0, all: btns.every((q) => q.left >= r.left && q.right <= r.right), apart: btns.every((q, i) => !i || q.left >= btns[i - 1].right - 0.5) }; })()`;
  const at = async (w) => {
    await app.send('Emulation.setDeviceMetricsOverride', { width: w, height: 700, deviceScaleFactor: 1, mobile: false });
    return app.until(async () => { const s = await app.eval(inView); return s.notes && s.all && s.apart && s; }, { what: `the toolbar fitted at ${w}px` });
  };
  try {
    const wide = await at(1600);
    assert.equal(wide.cls, '', 'a wide window: as it always was');
    const mid = await at(1024);
    assert.ok(/tight-/.test(mid.cls) && !/tight-5/.test(mid.cls), `1024px: tightened, the full labels kept (${mid.cls})`);
    const min = await at(720); // (the smallest the window goes: main.js minWidth)
    assert.match(min.cls, /tight-/);
  } finally {
    await app.send('Emulation.clearDeviceMetricsOverride');
  }
});
