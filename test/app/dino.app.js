// The writing companion in the real app: where it lives (on the status bar, the editor's whole width,
// at home around TODAY, taking no room and no clicks but its own), the pointer passing over it
// ignored while a click is answered at once, a drag going straight through, a side panel narrowing
// its ground, real writing (not pasting or opening) livening it up, its ink following the theme, the
// weather and scenery drawn whole, the theme's sunset and sunrise, the four shameless routines, and
// hiding it from the View menu for good.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { App, scratch } from './harness.js';

let tmp, app;
before(async () => {
  tmp = await scratch('stet-dino');
  app = await App.launch({ userData: path.join(tmp, 'ud') });
  await app.load([['action', '']]);
});
after(() => app?.close());

/** Start it on `activity` from a clean slate (nothing queued, nothing happening around it). */
const doing = (activity, setup = '') => app.eval(`(() => { const c = __stet.dino.c; c.queue = []; c.envDue = null; c.event = null; c.inReaction = null; c.paused = null; c.held = []; c.props = []; c.envNext = Infinity; c.cursor = null; ${setup}; c.pending = ${JSON.stringify(activity)}; c.gen = null; })()`);
const c = (expr) => app.eval(`(() => { const c = __stet.dino.c; return ${expr}; })()`);
const feet = `(() => { const d = document.getElementById('dino').getBoundingClientRect(), s = document.getElementById('status').getBoundingClientRect(); return { bottom: d.bottom, line: s.top, px: 1 / devicePixelRatio }; })()`;
const onLine = (g, when) => assert.ok(g.bottom <= g.line + 1e-6 && g.bottom > g.line - g.px - 1e-6, `${when}: feet at ${g.bottom}, the status bar's border at ${g.line}`);

test('it lives on the status bar across the editor’s whole width, at home around TODAY, taking no room and no clicks but its own', async () => {
  const g = await app.eval(`(() => { const d = document.getElementById('dino'), r = d.getBoundingClientRect(), t = document.getElementById('st-goal').getBoundingClientRect(), a = document.getElementById('scroller').getBoundingClientRect();
    return { hidden: d.hidden, top: r.top, bottom: r.bottom, left: r.left, right: r.right, today: (t.left + t.right) / 2, area: [a.left, a.right], strip: __stet.dino.stripW, home: __stet.dino.home, home0: __stet.dino.stripLeft, pe: getComputedStyle(d).pointerEvents }; })()`);
  assert.equal(g.hidden, false);
  onLine(await app.eval(feet), 'full width');
  assert.ok(g.strip >= g.area[1] - g.area[0] - 12, `the whole editor width (${g.strip})`);
  assert.ok(g.left >= g.area[0] - 0.5 && g.right <= g.area[1] + 0.5, 'within the editor area, never over a panel');
  assert.ok(g.home.hi - g.home.lo <= 560 && g.home.hi - g.home.lo < g.strip, 'a home stretch…');
  assert.ok(g.home0 + g.home.lo <= g.today && g.home0 + g.home.hi >= g.today, '…around TODAY');
  assert.ok(g.bottom - g.top <= 60, 'an overlay just above the status bar: it takes no room');
  assert.equal(g.pe, 'none', 'only the dinosaur itself takes clicks');
});

test('the pointer passing over it does nothing; a click is answered at once; a text drag goes straight through it', async () => {
  await doing('rest', 'c.rng = () => 0.5');
  await app.until(`__stet.dino.c.activity === 'rest' && __stet.dino.c.sitting()`, { what: 'a rest' });
  const before = await c('c.history.length');
  const box = await app.rect('.dino-hit');
  for (let i = 0; i <= 8; i++) await app.move(box.left - 60 + (i / 8) * (box.width + 120), i % 2 ? box.y : box.top - 15);
  assert.deepEqual(await c('({ activity: c.activity, reaction: c.inReaction, queued: c.queue.length, cursor: c.cursor, chosen: c.history.length, ack: c.ack })'),
    { activity: 'rest', reaction: null, queued: 0, cursor: null, chosen: before, ack: null }, 'not even told where the pointer is');
  await c('(c.rng = Math.random, c.force = "love")');
  await app.click(box.x, box.y);
  assert.ok(await c('!!c.ack && performance.now() - c.ack.t0 < 200'), 'acknowledged in the same moment');
  await app.until(`__stet.dino.c.inReaction === 'love' || __stet.dino.c.history.at(-1) === 'love' && !__stet.dino.c.queue.length`, { what: 'the reaction', timeout: 3000 });
  // Many quick clicks are absorbed: at most two queued.
  for (let i = 0; i < 8; i++) await app.click(box.x, box.y);
  assert.ok(await c('c.queue.length') <= 2);
  // A selection dragged across it is not caught by it.
  const page = await app.rect('.page');
  await app.mouse('mousePressed', page.left + 120, page.top + 100, { button: 'left', buttons: 1, clickCount: 1 });
  assert.equal(await app.eval(`getComputedStyle(document.querySelector('.dino-hit')).pointerEvents`), 'none', 'lets the drag through');
  await app.move(box.x, box.y, { button: 'left', buttons: 1 });
  await app.mouse('mouseReleased', box.x, box.y, { button: 'left', clickCount: 1 });
  assert.equal(await app.eval(`getComputedStyle(document.querySelector('.dino-hit')).pointerEvents`), 'auto', 'clickable again afterwards');
});

test('a reaction blends in at the next step without cutting the one in progress, then it carries on', async () => {
  await doing('walk');
  await app.until(`!!__stet.dino.c.step?.dx`, { what: 'a stride' });
  const s = await app.eval(`(() => { const c = __stet.dino.c; c.force = 'startle'; const s = c.step, end = s.end; document.querySelector('.dino-hit').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return { ack: c.acking(performance.now()), queued: c.queue.length, same: c.step === s && c.step.end === end }; })()`);
  assert.deepEqual(s, { ack: 2, queued: 1, same: true }, 'a blink and a start at once, the stride not cut');
  await app.until('!!__stet.dino.c.inReaction', { what: 'the reaction to start', timeout: 3000 });
  await app.until('!__stet.dino.c.inReaction', { what: 'and to hand back', timeout: 10000 });
});

test('a side panel narrows its ground: it stays whole and walks back in', async () => {
  await app.until('performance.now() - __stet.dino.born > 1600', { what: 'past its first moments (while the window lays itself out it starts in the middle)' });
  await doing('rest');
  const wide = await app.eval('__stet.dino.stripW');
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.until(`__stet.dino.stripW < ${wide} - 100 && !document.getElementById('right').getAnimations().length`, { what: 'the ground to narrow, the panel in place' });
  await app.frame();
  await c('(c.step = null, c.x = c.maxX + 15)'); // standing just past the new end (a step in progress would put it back where the step goes)
  assert.equal(await c('c.onstage()'), false);
  await app.until(`(() => { const d = __stet.dino, s = document.getElementById('scroller').getBoundingClientRect(); return d.c.onstage() && d.stripLeft + d.c.x + d.c.dw <= s.right + 0.5; })()`, { what: 'back inside the narrower ground', timeout: 15000 });
  onLine(await app.eval(feet), 'with a side panel open');
  await app.eval(`__stet.cmd.run('panel-notes')`);
  await app.until('document.getElementById("right").hidden');
});

test('it livens up with real writing only: not pasting, not opening a screenplay', async () => {
  await app.load([]);
  await c('(c.heat = 0, c.energy = 0)');
  await app.paste(Array.from({ length: 400 }, (_, i) => 'p' + i).join(' '));
  assert.equal(await c('c.heat'), 0, 'pasting does not excite it');
  await app.load([['action', 'a b c d e f g h i j k l m n o p']]);
  assert.equal(await c('c.heat'), 0, 'opening a screenplay does not either');
  await app.type('the quick brown fox jumps over the lazy dog again and again ');
  assert.ok(await c('c.heat') >= 10, 'typing does');
  const e1 = await c('(c.updateEnergy(30000), c.energy)');
  assert.ok(e1 > 0.2 && e1 < 1, `gradually (${e1})`);
  assert.ok(await c('(() => { for (let i = 0; i < 60; i++) c.updateEnergy(10000); return c.energy; })()') < 0.1, 'and calms down without writing');
});

test('its ink follows the theme; the weather and scenery are drawn whole: a rain cloud never cut off, a palm, a special loop', async () => {
  const ink = () => app.eval(`(() => { const d = __stet.dino; d.lastSig = ''; d.draw(); const cv = d.canvas, x = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < x.length; i += 4) if (x[i] > 200) return [x[i - 3], x[i - 2], x[i - 1]].join(); return null; })()`);
  await app.eval(`__stet.cmd.run('theme-dark')`);
  const dark = await ink();
  await app.eval(`__stet.cmd.run('theme-light')`);
  const light = await ink();
  assert.ok(dark && light && dark !== light, `${dark} vs ${light}`);
  await doing('look');
  await app.until(`__stet.dino.c.activity === 'look'`);
  await c('(c.startEvent("rain"), c.event.cloud.x = c.event.cloud.tx)'); // (overhead at once: its drifting in is simulated in the unit tests)
  // (How a shower runs its course is simulated in test/unit/dino.test.js; here: drawn whole while it rains.)
  let part = null, samples = 0;
  await app.until(async () => {
    const r = await app.eval(`(() => { const d = __stet.dino, c = d.c; d.lastSig = ''; d.draw(); const cv = d.canvas, img = cv.getContext('2d').getImageData(0, 0, cv.width, 6).data; let top = 0; for (let i = 3; i < img.length; i += 4) if (img[i]) top++; return { drops: c.drops.length, reaction: c.inReaction, top }; })()`);
    assert.equal(r.top, 0, 'nothing reaches the top edge of its canvas');
    if (r.reaction && !part) part = r.reaction;
    if (r.drops) samples++;
    return part && samples >= 10;
  }, { timeout: 15000, every: 50, what: 'rain on it, and its part in it' });
  assert.match(part, /^rain/, `it took part: ${part}`);
  assert.ok(await c('c.props.filter((p) => !p.carried).every((p) => p.x >= -c.margin - 0.5 && p.y >= 0)'), 'everything in view');
  await doing('look', `c.spawn('palm', { x: c.clampProp(c.center() + 30, 11), frame: 3, life: 1e9 })`);
  const palm = await app.eval(`(() => { const d = __stet.dino, c = d.c, cv = d.canvas, g = cv.getContext('2d');
    const ink = () => { d.lastSig = ''; d.draw(); const all = g.getImageData(0, 0, cv.width, cv.height).data, top = g.getImageData(0, 0, cv.width, 2).data; let n = 0, t = 0; for (let i = 3; i < all.length; i += 4) n += !!all[i]; for (let i = 3; i < top.length; i += 4) t += !!top[i]; return { n, t }; };
    const p = c.find('palm'), with_ = ink(); c.remove(p); const without = ink(); c.props.push(p); return { more: with_.n - without.n, top: with_.t }; })()`);
  assert.ok(palm.more > 50 && palm.top === 0, `a full-grown palm drawn, whole (${JSON.stringify(palm)})`);
  await doing('fetch');
  await app.until(`__stet.dino.c.activity === 'fetch' && __stet.dino.c.props.some((p) => p.kind === 'ball')`, { timeout: 8000, what: 'a ball to fetch' });
  await doing('skateboard', '__stet.dino.setStreak({ growth: 6, unlocked: 3 }, false)');
  await app.until(`!!__stet.dino.c.props.find((p) => p.kind === 'skateboard' && p.ride)`, { timeout: 8000, what: 'a ride on the skateboard' });
  await app.eval('__stet.dino.setStreak({ growth: 0, unlocked: 0 }, false)');
});

test('four shameless routines run in the app: a scratch on its back, a strut, a burp after a meal, a photobomb', async () => {
  for (const [name, setup, frames] of [
    ['backScratch', '', ['fallen']],
    ['strut', '', ['walk1', 'armsUp']],
    ['burp', 'c.fed = c.now', ['roar', 'sitHowl']],
    ['photobomb', `c.energy = 1; c.heat = 40; c.spawn('palm', { x: c.clampProp(c.center() + 40, 11), frame: 3, life: 1e9 })`, ['armsUp']],
  ]) {
    await doing(name, setup);
    const seen = new Set();
    await app.until(async () => { const f = await c(`c.activity === ${JSON.stringify(name)} && c.frame`); if (f) seen.add(f); return frames.some((x) => seen.has(x)); }, { timeout: 15000, every: 40, what: `${name}: ${frames.join(' or ')}` });
    assert.ok(await app.eval(`(() => { const d = __stet.dino; d.lastSig = ''; d.draw(); const x = d.canvas.getContext('2d').getImageData(0, 0, d.canvas.width, d.canvas.height).data; for (let i = 3; i < x.length; i += 4) if (x[i]) return true; return false; })()`), `${name} is drawn`);
  }
  // The photobomb: in front of the palm.
  assert.ok(await c(`Math.abs(c.center() - c.propCenter(c.find('palm'))) < 12`), 'right in front of the palm');
});

test('when AUTO turns the theme, it sees the sun set and rise; a manual switch leaves it be', async () => {
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = Date.now();
  await app.eval(`__stet.cmd.run('theme-light')`);
  await doing('look');
  await app.until(`__stet.dino.c.activity === 'look'`);
  await app.eval(`__stet.cmd.run('theme-dark')`);
  assert.notEqual(await c('c.activity'), 'nightfall', 'a manual switch: no sunset');
  assert.notEqual(await c('c.pending'), 'nightfall');
  await app.eval(`__stet.cmd.run('theme-light')`);
  await doing('look');
  await app.until(`__stet.dino.c.activity === 'look'`);
  await app.eval(`__stet.settings().schedule = ${JSON.stringify({ enabled: true, darkAt: hhmm(new Date(now - 60e3)), lightAt: hhmm(new Date(now + 3600e3)) })}`);
  await app.eval('window.dispatchEvent(new Event("focus"))'); // the schedule is checked on focus (and every minute)
  assert.equal(await app.eval('document.documentElement.dataset.theme'), 'dark');
  await app.until(`__stet.dino.c.activity === 'nightfall' && !!__stet.dino.c.find('sun')`, { what: 'the sun to go down', timeout: 5000 });
  await app.eval(`__stet.settings().schedule = ${JSON.stringify({ enabled: true, darkAt: hhmm(new Date(now + 3600e3)), lightAt: hhmm(new Date(now - 60e3)) })}`);
  await app.eval('window.dispatchEvent(new Event("focus"))');
  assert.equal(await app.eval('document.documentElement.dataset.theme'), 'light');
  await app.until(`__stet.dino.c.activity === 'daybreak'`, { what: 'and come up again', timeout: 5000 });
  await app.eval(`__stet.settings().schedule = { ...__stet.settings().schedule, enabled: false }`);
});

test('View > the companion hides it, and it stays hidden after a restart', async () => {
  await app.eval(`__stet.cmd.run('companion')`);
  assert.equal(await app.eval('document.getElementById("dino").hidden'), true);
  await app.until(`window.stet.invoke('settings:get').then((s) => s.companion === false)`, { what: 'the choice saved' });
  await app.close();
  app = await App.launch({ userData: path.join(tmp, 'ud') });
  assert.equal(await app.eval('document.getElementById("dino").hidden'), true);
  await app.eval(`__stet.cmd.run('companion')`);
  assert.equal(await app.eval('document.getElementById("dino").hidden'), false);
});
