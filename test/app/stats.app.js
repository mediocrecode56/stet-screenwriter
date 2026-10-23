// Writing statistics and the streak in the real app, each from the statistics file a writer would
// have: 0.6's carried over, then restarts, the weekly view and its confirmed Reset, a crash; a
// heavy, uneven week (the chart, the top boxes in both themes, the streak beside TODAY at every
// milestone, the rest days); a day joining the streak at its goal (several screenplays, opening and
// pasting never counting, the dinosaur growing, a restart, a Reset that keeps it); and 0.8's file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { App, scratch, userData, dayAgo } from './harness.js';
import { referenceDocCount } from '../helpers/wordref.js';
import { restUsed, REST_DAYS } from '../../src/core/streak.js';

let app, tmp;
after(() => app?.close());

const total = () => app.eval('__stet.writing.book.data.total');
const TODAY = `+document.getElementById('st-goal').textContent.match(/TODAY ([\\d,.\\s]+)/)[1].replace(/\\D/g, '')`;
const today = () => app.eval(TODAY);
const todayIs = (n) => app.until(`${TODAY} === ${n}`, { what: 'TODAY to read ' + n });
const exact = async () => {
  await app.eval('__stet.view.frame()');
  const s = await app.eval(`({ words: __stet.editor.words, shown: +document.getElementById('st-words').textContent.replace(/\\D/g, ''), texts: __stet.editor.blocks.map((b) => ({ text: b.text })) })`);
  assert.equal(s.words, referenceDocCount(s.texts));
  assert.equal(s.shown, s.words);
  return s.words;
};
/** The streak beside TODAY and the dinosaur's size, as shown now. */
const streak = () => app.eval(`(() => { __stet.renderGoal(); const s = document.getElementById('st-streak'), c = __stet.dino.c; return { text: s.textContent, title: s.title, cls: s.className, targetG: c.targetG, g: c.g, unlocked: c.unlocked, data: __stet.writing.book.data.streak }; })()`);
/** Quit with everything written saved (the window's credits sent, the main process's copy on disk). */
const quit = async () => { await app.eval('__stet.writing.flush()'); await app.eval('window.stet.invoke("stats:flush")'); await app.close(); app = null; };
const openStats = async () => { await app.eval('void __stet.cmd.run("stats")'); await app.until(`!!document.querySelector('#overlay .wk-col')`, { what: 'the weekly view' }); };
const stats = (days, o = {}) => {
  const keys = Object.keys(days).sort(), since = dayAgo(20);
  return { version: 2, start: new Date(Date.now() - 20 * 864e5).toISOString(), since, total: Object.values(days).reduce((n, d) => n + d.w, 0), days, docs: { a: { w: Object.values(days).reduce((n, d) => n + d.w, 0), title: 'Night Ferry', path: null, first: keys[0], last: keys.at(-1) } }, resets: [], ...o };
};

// ---- from 0.6's statistics ----

test('0.6 statistics are carried over; they survive a restart, and reopening counts nothing again', async () => {
  tmp = await scratch('stet-stats');
  const ud = await userData({ 'stats.json': { days: { [dayAgo(1)]: { w: 321, docs: { old: { base: 1000, peak: 1321 } } } } } });
  app = await App.launch({ userData: ud });
  assert.equal(await total(), 321);
  assert.ok((await fs.readdir(ud)).includes('stats-v1.json'), 'the old file is kept');
  await app.load([]);
  await app.type('before the restart ');
  await todayIs(3);
  const file = path.join(tmp, 'Restart.stet');
  assert.ok((await app.saveTo(file)).ok);
  await quit();
  app = await App.launch({ userData: ud });
  assert.equal(await total(), 324, 'the all-time total intact');
  assert.equal(await today(), 3, 'today intact');
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  assert.equal(await exact(), 3);
  assert.equal(await today(), 3, 'reopening counts nothing');
  const saved = JSON.parse(await fs.readFile(path.join(ud, 'stats.json'), 'utf8'));
  assert.deepEqual([saved.version, saved.total], [2, 324]);
});

test('the weekly view: today on its bar; Reset only after an explicit yes, and counting carries on after it', async () => {
  await openStats();
  const view = await app.eval(`(() => { const q = (s) => [...document.querySelectorAll('#overlay ' + s)]; return { cols: q('.wk-col').length, vals: q('.wk-val').map((v) => v.textContent), days: q('.wk-days > div').map((d) => d.textContent.slice(0, 3)), head: document.querySelector('#overlay .wk-head').textContent }; })()`);
  assert.equal(view.cols, 7);
  assert.deepEqual(view.days, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  assert.ok(view.vals.includes((3).toLocaleString()), 'today’s number on its bar');
  assert.match(view.head, /THIS WEEK/);
  const before = await total();
  const confirm = async () => { await app.eval(`document.querySelector('#overlay .wk-reset').click()`); await app.dialogMatching(/^RESET STATISTICS/); };
  await confirm();
  assert.match(await app.dialog(), /Not affected/);
  assert.equal(await app.eval('document.activeElement.textContent'), 'Cancel', 'Cancel has the focus, not Reset');
  await app.key('Escape');
  await app.dialogMatching(/^WRITING/);
  assert.equal(await total(), before, 'Escape is no yes');
  await confirm();
  await app.eval(`document.getElementById('overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await app.until(async () => !/^RESET/.test(await app.dialog()));
  assert.equal(await total(), before, 'nor is a click outside');
  await openStats();
  await confirm();
  await app.press('Cancel');
  await app.dialogMatching(/^WRITING/);
  assert.equal(await total(), before, 'nor Cancel: back to the week');
  await confirm();
  await app.press('Reset statistics');
  await app.until(`(document.querySelector('#overlay .wk-flash')?.textContent || '').match(/reset/i)`, { what: 'the reset done' });
  assert.equal(await total(), 0);
  assert.match(await app.eval(`document.querySelector('#overlay .wk-head .wk-n').textContent`), /^0/);
  await app.key('Escape');
  await todayIs(0);
  const ud = app.userData;
  await app.until(async () => JSON.parse(await fs.readFile(path.join(ud, 'stats.json'), 'utf8')).total === 0, { what: 'saved' });
  assert.ok((await fs.readdir(ud)).some((f) => f.startsWith('stats-before-reset-')), 'the old figures archived');
  const w = await exact();
  await app.key('Mod+End'); await app.type(' new');
  assert.equal(await exact(), w + 1, 'the word count unaffected');
  await todayIs(1);
});

test('a crash loses at most the last moment of writing', async () => {
  const ud = app.userData;
  await app.load([]);
  const t = await total();
  await app.type('written just before a crash ');
  // Within about a second it is on disk: then the power goes.
  await app.until(async () => JSON.parse(await fs.readFile(path.join(ud, 'stats.json'), 'utf8')).total === t + 5, { what: 'the words on disk', timeout: 3000 });
  await app.kill();
  app = await App.launch({ userData: ud });
  await app.key('Escape'); // the recovery offer for the unsaved screenplay
  assert.equal(await total(), t + 5);
  await app.close(); app = null;
});

// ---- a heavy, uneven week ----

const LAST = [18450, 2240, 0, 131830, 9420, 0, 612]; // last week, Monday first
const TODAY_WORDS = 123456;

test('a heavy, uneven week: every day readable on its bar, in proportion, the outlier broken off, no scrolling', async () => {
  const now = new Date(), monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const days = {};
  for (let i = -7; i <= 0; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const ago = Math.round((now - d) / 864e5);
    const w = i < 0 ? LAST[i + 7] : 0;
    if (w) days[dayAgo(ago)] = { w, docs: { a: w } };
  }
  days[dayAgo(0)] = { w: TODAY_WORDS, docs: { a: TODAY_WORDS } }; // and today, a great deal
  app = await App.launch({ userData: await userData({ 'stats.json': stats(days, { streak: { last: dayAgo(0), count: 3, best: 3, prev: null } }), 'settings.json': { goals: { daily: 1000, weekly: 6000 } } }) });
  await openStats();
  await app.eval(`document.querySelector('#overlay .wk-nav').click()`); // last week
  await app.until(`document.querySelectorAll('#overlay .wk-val')[3]?.textContent === (131830).toLocaleString()`, { what: 'last week' });
  const v = await app.eval(`(() => {
    const dlg = document.querySelector('#overlay .dlg'), body = dlg.querySelector('.body');
    const cols = [...dlg.querySelectorAll('.wk-col')].map((c) => { const val = c.querySelector('.wk-val'), r = val.getBoundingClientRect(); return { text: val.textContent, l: r.left, r: r.right, bar: c.querySelector('.wk-bar').getBoundingClientRect().height, over: c.classList.contains('over') }; });
    const b = dlg.querySelector('.wk-chart').getBoundingClientRect(), p = dlg.querySelector('.wk-plot').getBoundingClientRect();
    return { cols, h: dlg.getBoundingClientRect().height, w: dlg.getBoundingClientRect().width, scroll: [body.scrollWidth - body.clientWidth, body.scrollHeight - body.clientHeight], goal: !!dlg.querySelector('.wk-goal'), centred: Math.abs((p.left - b.left) - (b.right - p.right)) <= 1, ticks: dlg.querySelectorAll('.wk-axis-l .wk-tick').length, head: dlg.querySelector('.wk-n').textContent };
  })()`);
  const fmt = (n) => app.eval(`(${n}).toLocaleString()`);
  assert.equal(v.head, `${await fmt(LAST.reduce((a, b) => a + b, 0))} / ${await fmt(6000)}`, 'the week against the weekly goal');
  const want = [];
  for (const n of LAST) want.push(await fmt(n));
  assert.deepEqual(v.cols.map((c) => c.text), want, 'every day exactly, with separators');
  assert.deepEqual(v.scroll, [0, 0], 'no scrolling');
  assert.ok(v.h < 520 && v.w <= 562, `compact (${Math.round(v.w)}×${Math.round(v.h)})`);
  for (let i = 1; i < v.cols.length; i++) assert.ok(v.cols[i].l >= v.cols[i - 1].r, `labels never overlap (${v.cols[i - 1].text} / ${v.cols[i].text})`);
  assert.equal(v.cols[3].over, true, '131,830 drawn as a broken bar');
  const [mon, tue, , , fri] = v.cols;
  assert.ok(Math.abs(mon.bar / fri.bar - 18450 / 9420) < 0.1 && Math.abs(fri.bar / tue.bar - 9420 / 2240) < 0.3, 'the others in proportion');
  assert.ok(v.goal && v.centred && v.ticks === 3, 'the goal as a line; centred; a scale of 0, half and full');
  await app.key('Escape');
  await app.noDialog();
});

test('the top boxes: just the day, the count and the target, readable with big numbers, in both themes', async () => {
  for (const theme of ['theme-light', 'theme-dark']) {
    await app.eval(`__stet.cmd.run('${theme}')`);
    await openStats();
    const b = await app.eval(`[...document.querySelectorAll('#overlay .wk-big')].map((el) => { const n = el.querySelector('.wk-n'), s = n.querySelector('small'); return { kids: [...el.children].map((c) => c.className), label: el.querySelector('.wk-k').textContent, n: n.textContent, colours: [getComputedStyle(n).color, getComputedStyle(s).color], sizes: [parseFloat(getComputedStyle(n).fontSize), parseFloat(getComputedStyle(s).fontSize)], clipped: n.scrollWidth > n.clientWidth, h: el.getBoundingClientRect().height }; })`);
    assert.equal(b.length, 2);
    for (const box of b) {
      assert.deepEqual(box.kids, ['wk-k', 'wk-n'], 'only the label and the figures');
      assert.ok(!/%|×|to go|reached|over \d/.test(box.n + box.label), `no extra text: "${box.label}" "${box.n}"`);
      assert.ok(box.colours[0] !== box.colours[1] && box.sizes[0] > box.sizes[1], 'the count larger than the target, and set apart');
      assert.ok(!box.clipped && box.h < 52, `readable and compact: ${box.n}`);
    }
    assert.match(b[0].n, /^[\d,. ]+ \/ 6[,.]?000$/, 'the week: total / weekly goal');
    assert.match(b[1].label, /^TODAY · (MON|TUE|WED|THU|FRI|SAT|SUN) \d+$/, 'today, with its date');
    assert.match(b[1].n, /^123[,.]?456 \/ 1[,.]?000$/, 'today: count / daily goal, thousands and all');
    assert.equal(await app.eval(`!!document.querySelector('#overlay .wk-facts')`), false, 'no list of facts under the chart');
    await app.key('Escape');
    await app.noDialog();
  }
});

/** Height in screen px of the dinosaur's own ink, standing still, and whether every pixel is solid. */
const measure = () => app.eval(`(() => {
  const d = __stet.dino, c = d.c;
  c.frame = 'stand'; c.y = 0; c.flip = false; c.effects = []; c.props = []; c.particles = []; c.drops = []; c.sparks = []; c.streaks = []; c.hat = null; c.ack = null; c.step = { ...c.step, f: 'stand', x0: c.x, x1: c.x, start: performance.now(), end: performance.now() + 60000, t: 60000 };
  d.lastSig = ''; d.draw();
  const cv = d.canvas, g = cv.getContext('2d'), dpr = devicePixelRatio || 1, p = d.pxDev;
  const x0 = Math.max(0, Math.round(((c.x + d.off) * dpr) / p) * p - 2), w = Math.min(Math.ceil(c.dw * dpr) + 4, cv.width - x0);
  const img = g.getImageData(x0, 0, w, cv.height).data;
  let top = -1, bottom = -1, soft = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < w; x++) { const a = img[(y * w + x) * 4 + 3]; if (a) { if (top < 0) top = y; bottom = y; if (a !== 255) soft++; } }
  return { dev: bottom - top + 1, dpr, soft };
})()`);

test('the streak beside TODAY at 0 to 32 days: the size and special loops each milestone brings, a pixel at a time, crisply', async () => {
  const where = await app.eval(`(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; const s = document.getElementById('st-streak'); return { streak: r(s), meter: r(document.querySelector('#st-goal .meter')), status: r(document.getElementById('status')), parent: s.parentElement.id, clock: document.getElementById('st-clock').getBoundingClientRect().left }; })()`);
  assert.equal(where.parent, 'st-goal', 'part of TODAY, in the status bar');
  assert.ok(where.streak.l >= where.meter.r && where.streak.l - where.meter.r < 14, 'right beside the day’s count');
  assert.ok(where.streak.t >= where.status.t && where.streak.b <= where.status.b && where.streak.r < where.clock, 'inside the status bar, clear of the clock');
  const want = { 0: [0, 0], 1: [1, 0], 2: [2, 1], 3: [2, 1], 4: [3, 1], 7: [3, 1], 8: [4, 2], 15: [4, 2], 16: [5, 2], 31: [5, 2], 32: [6, 3] };
  await app.eval(`__stet.dino.setStreak({ growth: 0, unlocked: 0 }, false)`);
  const base = await measure();
  for (const [n, [g, u]] of Object.entries(want)) {
    for (const last of [0, 1]) { // written today, or yesterday (today not over yet)
      const s = await app.eval(`(() => { __stet.writing.book.data.streak = ${n} ? { last: ${JSON.stringify(dayAgo(last))}, count: ${n}, best: ${n}, prev: null } : { last: null, count: 0, best: 0, prev: null }; return 1; })()`).then(streak);
      assert.deepEqual([s.text, s.targetG, s.unlocked, s.cls.includes('none')], [String(n), g, u, +n === 0], `${n} days (last ${last} days ago)`);
      assert.match(s.title, +n ? new RegExp(`${n} day`) : /none yet/);
    }
    await app.eval(`__stet.dino.setStreak({ growth: ${g}, unlocked: ${u} }, false)`);
    const m = await measure();
    assert.ok(Math.abs(m.dev - (base.dev + g * m.dpr)) <= 1, `${n} days: ${m.dev} device px tall (${base.dev} + ${g})`);
    assert.equal(m.soft, 0, 'crisp: every pixel solid');
  }
  // Five days missed in a row (more than a week's two rest days): back to 0 and its first size.
  const broken = await app.eval(`(() => { __stet.writing.book.data.streak = { last: ${JSON.stringify(dayAgo(6))}, count: 10, best: 10, prev: null }; return 1; })()`).then(streak);
  assert.deepEqual([broken.text, broken.targetG, broken.unlocked], ['0', 0, 0]);
  assert.match(broken.title, /none yet/);
});

test('a shield beside the flame: the rest days left this week', async () => {
  const read = () => app.eval(`(() => { __stet.renderGoal(); const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const z = document.getElementById('st-rest'), f = document.getElementById('st-streak');
    return { text: z.textContent, title: z.title, cls: z.className, shield: !!z.querySelector('svg.shield'), at: r(z), flame: r(f), status: r(document.getElementById('status')), parent: z.parentElement.id, flameText: f.textContent }; })()`);
  for (const ago of [0, 2, 3]) { // written today; one day missed; two
    const rec = { last: dayAgo(ago), count: 3, spared: [] };
    const want = Math.max(0, REST_DAYS - restUsed(rec, dayAgo(0)));
    await app.eval(`__stet.writing.book.data.streak = { ...${JSON.stringify(rec)}, best: 3, prev: null }`);
    const z = await read();
    if (z.flameText === '0') continue; // (a week boundary can end the streak)
    assert.equal(z.text, String(want), `last written ${ago} days ago: ${want} rest days left`);
    assert.ok(z.shield, 'a pixel shield');
    assert.match(z.title, new RegExp(`Rest days left this week: ${want} of 2`));
    assert.equal(z.cls.includes('none'), want === 0, 'dimmed when none are left');
    assert.equal(z.parent, 'st-goal');
    assert.ok(z.at.l >= z.flame.r && z.at.l - z.flame.r < 14 && z.at.t >= z.status.t && z.at.b <= z.status.b, 'right beside the flame, in the status bar');
  }
  await app.close(); app = null;
});

// ---- a day joining the streak ----

test('a day joins the streak at its goal, once however many screenplays; opening and pasting never count; the dinosaur grows', async () => {
  const ud = await userData({ 'stats.json': stats({ [dayAgo(1)]: { w: 10, docs: { a: 10 } } }, { streak: { last: dayAgo(1), count: 1, best: 1, prev: null } }), 'settings.json': { goals: { daily: 6, weekly: 6000 } } });
  app = await App.launch({ userData: ud });
  assert.equal((await streak()).text, '1', 'yesterday’s, while today isn’t over');
  // A screenplay full of text opened, and more pasted in: not writing.
  await app.load([['scene', 'INT. HOUSE - NIGHT'], ['action', 'Mara stands at the window, waiting for the ferry lights.'], ['action', 'Nothing moves on the water.']]);
  await app.key('Mod+End');
  await app.paste(' A long pasted passage of twenty or so words that somebody wrote elsewhere and brings in here to keep.');
  await app.type(' Mara waits there.'); // 3 of 6
  await todayIs(3);
  let s = await streak();
  assert.equal(s.text, '1', 'three words: not yet');
  assert.ok(!s.cls.includes('lit'));
  assert.ok(s.title.includes('reach your daily goal (6 words)'), s.title);
  assert.match(await app.eval('document.getElementById("st-rest").title'), /misses the daily goal/);
  await app.type(' The ferry comes.'); // 6 of 6
  await todayIs(6);
  s = await streak();
  assert.deepEqual([s.text, s.data.last, s.targetG, s.unlocked], ['2', dayAgo(0), 2, 1], 'the goal reached: two days, a milestone, the first special loop');
  assert.ok(s.cls.includes('lit'));
  // It grows at its next natural moment, while you watch.
  await app.eval(`(() => { const c = __stet.dino.c; c.queue = []; c.envDue = null; c.inReaction = null; c.paused = null; c.held = []; c.gen = null; })()`);
  await app.until('__stet.dino.c.g === 2', { timeout: 30000, what: 'the dinosaur to grow' });
  for (const t of ['Pilot', 'Short']) { await app.load([], {}, t); await app.type(`The ${t.toLowerCase()} opens.`); }
  await todayIs(12);
  s = await streak();
  assert.deepEqual([s.text, s.data.count], ['2', 2], 'one day, however many screenplays');
  await quit();
  // A restart: the streak and the size it earned, at once.
  app = await App.launch({ userData: ud });
  s = await streak();
  assert.deepEqual([s.text, s.g, s.unlocked], ['2', 2, 1], 'restored at once, no ceremony');
  const saved = JSON.parse(await fs.readFile(path.join(ud, 'stats.json'), 'utf8'));
  assert.deepEqual([saved.streak.count, saved.streak.last], [2, dayAgo(0)], 'saved with the statistics');
  // Reset: the words go, the streak stays, and the confirmation says so.
  await openStats();
  await app.eval(`document.querySelector('#overlay .wk-reset').click()`);
  await app.dialogMatching(/writing streak/);
  await app.press('Reset statistics');
  await app.until(async () => (await total()) === 0, { what: 'the statistics cleared' });
  await app.key('Escape');
  assert.equal((await streak()).text, '2', 'the streak kept');
  await app.close(); app = null;
});

test('an update from 0.8: the streak its statistics already show, with the size to match', async () => {
  const days = {};
  for (let i = 1; i <= 8; i++) days[dayAgo(i)] = { w: 10, docs: { a: 10 } };
  app = await App.launch({ userData: await userData({ 'stats.json': stats(days), 'settings.json': { goals: { daily: 10, weekly: 6000 } } }) }); // 0.8 kept no streak
  const s = await streak();
  assert.deepEqual([s.text, s.g, s.unlocked], ['8', 4, 2], '+4 px and two special loops straight away');
  assert.equal(await total(), 80, 'the word counts untouched');
});
