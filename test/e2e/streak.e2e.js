// 0.9 in the real app: the writing streak beside TODAY and the dinosaur
// growing with it (milestones, special loops, restarts, an update from 0.8,
// several screenplays a day, opening and pasting text, Reset), the simplified
// boxes at the top of the weekly view, and the dinosaur's weather and scenery
// drawn whole on its canvas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';
import { restUsed, REST_DAYS } from '../../src/core/streak.js';

let tmp, app;
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };
const H = 14;

/** stats.json with `n` days of writing in a row ending `endAgo` days ago (with or without a streak record, as 0.8 saved it). */
async function seed(ud, n, endAgo = 1, { record = true, words = 10 } = {}) {
  await fs.mkdir(ud, { recursive: true });
  const days = {};
  for (let i = 0; i < n; i++) days[dayAgo(endAgo + i)] = { w: words, docs: { a: words } };
  const since = dayAgo(endAgo + n + 3);
  const data = { version: 2, start: new Date(Date.now() - (endAgo + n + 3) * 864e5).toISOString(), since, total: n * words, days, docs: n ? { a: { w: n * words, title: 'Night Ferry', path: null, first: dayAgo(endAgo + n - 1), last: dayAgo(endAgo) } } : {}, resets: [] };
  if (record) data.streak = n ? { last: dayAgo(endAgo), count: n, best: n, prev: null } : { last: null, count: 0, best: 0, prev: null };
  await fs.writeFile(path.join(ud, 'stats.json'), JSON.stringify(data));
  await fs.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ goals: { daily: 1000, weekly: 6000 } }));
}
const launch = (ud) => App.launch({ userData: ud });
/** Quit with everything written saved (the window's credits sent, the main process's copy on disk). */
const closeApp = async () => {
  await app.eval('__stet.writing.flush()');
  await app.eval('window.stet.invoke("stats:flush")');
  await app.close();
  app = null;
};
const newDoc = (title = 'T', text = '') => app.eval(`(async () => { const { newDocument, makeBlock } = await import('../core/model.js'); const d = newDocument(${JSON.stringify(title)}); d.settings.backup.enabled = false; d.blocks = ${JSON.stringify(text)} ? ${JSON.stringify(text)}.split('\\n').map((t) => { const b = makeBlock('action'); b.text = t; return b; }) : [makeBlock('action')]; __stet.session.load(d, null); document.getElementById('input').focus(); })()`);
const paste = (t) => app.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(t)}); const ta = document.getElementById('input'); ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
const shown = async () => { await sleep(450); return app.eval(`(() => { const s = document.getElementById('st-streak'), c = __stet.dino.c; return { text: s.textContent, title: s.title, cls: s.className, targetG: c.targetG, g: c.g, unlocked: c.unlocked, data: __stet.writing.book.data.streak }; })()`); };
/** Height in screen px of the ink the dinosaur itself is drawn with, standing still, and whether every pixel is solid. */
const measure = () => app.eval(`(() => {
  const d = __stet.dino, c = d.c;
  c.frame = 'stand'; c.y = 0; c.flip = false; c.effects = []; c.props = []; c.particles = []; c.drops = []; c.sparks = []; c.streaks = []; c.hat = null; c.ack = null; c.step = { ...c.step, f: 'stand', x0: c.x, x1: c.x, start: performance.now(), end: performance.now() + 60000, t: 60000 };
  d.lastSig = ''; d.draw();
  const cv = d.canvas, g = cv.getContext('2d'), dpr = devicePixelRatio || 1, p = d.pxDev;
  const x0 = Math.max(0, Math.round(((c.x + d.off) * dpr) / p) * p - 2), w = Math.ceil(c.dw * dpr) + 4;
  const img = g.getImageData(x0, 0, Math.min(w, cv.width - x0), cv.height).data, rowW = Math.min(w, cv.width - x0);
  let top = -1, bottom = -1, soft = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < rowW; x++) { const a = img[(y * rowW + x) * 4 + 3]; if (a) { if (top < 0) top = y; bottom = y; if (a !== 255) soft++; } }
  return { css: (bottom - top + 1) / dpr, dev: bottom - top + 1, dpr, u: c.u, soft };
})()`);

before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-streak-e2e-')); });
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('the streak beside TODAY: 0, 1, 2, 3, 4, 7, 8, 15, 16, 31 and 32 days, and the growth and special loops each brings', { timeout: 180000 }, async () => {
  const ud = path.join(tmp, 'a');
  await seed(ud, 0);
  app = await launch(ud);
  await sleep(500);
  const where = await app.eval(`(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; }; const s = document.getElementById('st-streak'); return { streak: r(s), meter: r(document.querySelector('#st-goal .meter')), status: r(document.getElementById('status')), inGoal: s.parentElement.id, win: innerWidth }; })()`);
  assert.equal(where.inGoal, 'st-goal', 'part of TODAY, in the status bar');
  assert.ok(where.streak.l >= where.meter.r && where.streak.l - where.meter.r < 14, 'right beside the day’s count');
  assert.ok(where.streak.t >= where.status.t && where.streak.b <= where.status.b, 'inside the status bar');
  assert.ok(where.streak.r < where.win / 2, 'in its left half');
  const want = { 0: [0, 0], 1: [1, 0], 2: [2, 1], 3: [2, 1], 4: [3, 1], 7: [3, 1], 8: [4, 2], 15: [4, 2], 16: [5, 2], 31: [5, 2], 32: [6, 3] };
  const base = await measure();
  for (const [n, [g, u]] of Object.entries(want)) {
    for (const last of [0, 1]) { // written today, or yesterday (today not over yet)
      await app.eval(`(() => { __stet.writing.book.data.streak = ${n} ? { last: ${JSON.stringify(dayAgo(last))}, count: ${n}, best: ${n}, prev: null } : { last: null, count: 0, best: 0, prev: null }; __stet.renderGoal(); })()`);
      const s = await shown();
      assert.equal(s.text, String(n), `${n} days shown`);
      assert.equal(s.targetG, g, `${n} days: +${g} px`);
      assert.equal(s.unlocked, u, `${n} days: ${u} special loops`);
      assert.equal(s.cls.includes('none'), +n === 0);
      assert.match(s.title, +n ? new RegExp(`${n} day`) : /none yet/);
    }
    // Exactly one pixel per milestone, drawn crisply.
    await app.eval(`__stet.dino.setStreak({ growth: ${g}, unlocked: ${u} }, false)`);
    const m = await measure();
    assert.ok(Math.abs(m.dev - (base.dev + g * m.dpr)) <= 1, `${n} days: ${m.css} px tall (${base.css} + ${g})`);
    assert.equal(m.soft, 0, 'crisp: every pixel solid, no blur');
  }
  // Five days missed in a row (more than any week's two rest days): back to 0 and to its first size.
  await app.eval(`(() => { __stet.writing.book.data.streak = { last: ${JSON.stringify(dayAgo(6))}, count: 10, best: 10, prev: null }; __stet.renderGoal(); })()`);
  const broken = await shown();
  assert.equal(broken.text, '0');
  assert.equal(broken.targetG, 0);
  assert.equal(broken.unlocked, 0);
  assert.match(broken.title, /none yet/);
  await app.close(); app = null;
});

test('a shield beside the flame: the rest days left this week', { timeout: 120000 }, async () => {
  const ud = path.join(tmp, 'rest');
  await seed(ud, 3, 0);
  app = await launch(ud);
  await sleep(500);
  const read = () => app.eval(`(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const z = document.getElementById('st-rest'), f = document.getElementById('st-streak');
    return { text: z.textContent, title: z.title, cls: z.className, shield: !!z.querySelector('svg.shield'), at: r(z), flame: r(f), status: r(document.getElementById('status')), parent: z.parentElement.id, flameText: f.textContent }; })()`);
  const today = dayAgo(0);
  const cases = [
    { last: dayAgo(0), count: 3, spared: [] },  // written today
    { last: dayAgo(2), count: 3, spared: [] },  // yesterday missed: a rest day (if yesterday is this week)
    { last: dayAgo(3), count: 3, spared: [] },  // two missed
  ];
  for (const rec of cases) {
    const want = Math.max(0, REST_DAYS - restUsed(rec, today));
    await app.eval(`(() => { __stet.writing.book.data.streak = { ...${JSON.stringify(rec)}, best: 3, prev: null }; __stet.renderGoal(); })()`);
    const z = await read();
    if (z.flameText === '0') { assert.ok(z.cls.includes('none'), 'no streak: the shield is dimmed'); continue; } // (a week boundary can end the streak)
    assert.equal(z.text, String(want), `${rec.last}: ${want} rest days left`);
    assert.ok(z.shield, 'a pixel shield');
    assert.match(z.title, new RegExp(`Rest days left this week: ${want} of 2`));
    assert.equal(z.cls.includes('none'), want === 0, 'dimmed when none are left');
    assert.equal(z.parent, 'st-goal', 'part of TODAY');
    assert.ok(z.at.l >= z.flame.r && z.at.l - z.flame.r < 14, 'right beside the flame');
    assert.ok(z.at.t >= z.status.t && z.at.b <= z.status.b, 'inside the status bar');
  }
  await app.close(); app = null;
});

test('one streak day for several screenplays; opening and pasting text never count; a milestone grows it while you watch', { timeout: 180000 }, async () => {
  const ud = path.join(tmp, 'b');
  await seed(ud, 1, 1); // wrote yesterday
  app = await launch(ud);
  await sleep(500);
  assert.equal((await shown()).text, '1');
  // Opening a document full of text, and pasting more: not writing.
  await newDoc('Opened', 'INT. HOUSE - NIGHT\nMara stands at the window, waiting for the ferry lights.\nNothing moves on the water.');
  await paste('A long pasted passage of twenty or so words that somebody wrote elsewhere and brings in here to keep.');
  let s = await shown();
  assert.equal(s.text, '1', 'opening and pasting book nothing');
  assert.equal(s.data.last, dayAgo(1));
  // Writing: today joins the streak — 2 days, a milestone: it grows a pixel, with a stretch.
  await app.eval(`document.getElementById('input').focus()`);
  await app.type(' Mara waits.');
  s = await shown();
  assert.equal(s.text, '2');
  assert.equal(s.targetG, 2);
  assert.equal(s.unlocked, 1, 'the first special loop');
  assert.equal(s.data.last, dayAgo(0));
  await app.eval(`(() => { const c = __stet.dino.c; c.queue = []; c.envDue = null; c.inReaction = null; c.paused = null; c.held = []; c.gen = null; })()`);
  let grew = false;
  for (let i = 0; i < 80 && !grew; i++) { await sleep(150); grew = await app.eval('__stet.dino.c.g === 2'); }
  assert.ok(grew, 'grew: ' + JSON.stringify(await app.eval('(() => { const c = __stet.dino.c; return { g: c.g, t: c.targetG, a: c.activity }; })()')));
  // More writing in two other screenplays the same day: still one day.
  await newDoc('Pilot');
  await app.type('The pilot opens.');
  await newDoc('Short');
  await app.type('A short begins.');
  s = await shown();
  assert.equal(s.text, '2', 'one day, however many screenplays');
  assert.equal(s.data.count, 2);
  await closeApp();
  // A restart: the streak and the size it earned come back as they were.
  app = await launch(ud);
  await sleep(500);
  s = await shown();
  assert.equal(s.text, '2', 'after a restart');
  assert.equal(s.g, 2, 'restored at once, no ceremony');
  assert.equal(s.unlocked, 1);
  const saved = JSON.parse(await fs.readFile(path.join(ud, 'stats.json'), 'utf8'));
  assert.equal(saved.streak.count, 2, 'saved with the statistics');
  assert.equal(saved.streak.last, dayAgo(0));
  // Reset: the words go, the streak stays, and the confirmation says so.
  const kept = await app.eval('__stet.writing.book.data.total');
  assert.ok(kept > 0);
  await app.eval('void __stet.cmd.run("stats")');
  await sleep(300);
  await app.eval(`document.querySelector('#overlay .wk-reset').click()`);
  await sleep(300);
  assert.match(await app.eval(`document.querySelector('#overlay .dlg').textContent`), /writing streak/, 'the confirmation lists the streak as kept');
  await app.eval(`[...document.querySelectorAll('#overlay .btn')].find((b) => b.textContent === 'Reset statistics').click()`);
  await sleep(600);
  assert.equal(await app.eval('__stet.writing.book.data.total'), 0, 'statistics cleared');
  await app.key('Escape');
  await sleep(200);
  assert.equal((await shown()).text, '2', 'streak kept');
  await app.close(); app = null;
});

test('an update from 0.8: the streak its statistics already show, with the size to match', { timeout: 180000 }, async () => {
  const ud = path.join(tmp, 'c');
  await seed(ud, 8, 1, { record: false }); // 0.8 saved no streak
  app = await launch(ud);
  await sleep(500);
  const s = await shown();
  assert.equal(s.text, '8');
  assert.equal(s.g, 4, '+4 px straight away');
  assert.equal(s.unlocked, 2);
  assert.equal(await app.eval('__stet.writing.book.data.total'), 80, 'word counts untouched');
  await app.close(); app = null;
});

test('the weekly view’s top boxes: just the day, the count and the target — readable with big numbers, in both themes', { timeout: 180000 }, async () => {
  const ud = path.join(tmp, 'd');
  await seed(ud, 3, 0, { words: 123456 });
  app = await launch(ud);
  await sleep(400);
  for (const theme of ['theme-light', 'theme-dark']) {
    await app.eval(`__stet.cmd.run('${theme}')`);
    await app.eval('void __stet.cmd.run("stats")');
    await sleep(350);
    const b = await app.eval(`(() => [...document.querySelectorAll('#overlay .wk-big')].map((el) => ({ kids: [...el.children].map((c) => c.className), label: el.querySelector('.wk-k').textContent, n: el.querySelector('.wk-n').textContent, count: getComputedStyle(el.querySelector('.wk-n')).color, target: getComputedStyle(el.querySelector('.wk-n small')).color, size: [parseFloat(getComputedStyle(el.querySelector('.wk-n')).fontSize), parseFloat(getComputedStyle(el.querySelector('.wk-n small')).fontSize)], clipped: el.querySelector('.wk-n').scrollWidth > el.querySelector('.wk-n').clientWidth, h: el.getBoundingClientRect().height })))()`);
    assert.equal(b.length, 2);
    for (const box of b) {
      assert.deepEqual(box.kids, ['wk-k', 'wk-n'], 'only the label and the figures');
      assert.ok(!/%|×|to go|reached|over \d/.test(box.n + box.label), `no extra text: "${box.label}" "${box.n}"`);
      assert.notEqual(box.count, box.target, 'count and target look different');
      assert.ok(box.size[0] > box.size[1], 'the count larger than the target');
      assert.ok(!box.clipped, `readable: ${box.n}`);
      assert.ok(box.h < 52, `compact (${box.h} px)`);
    }
    assert.match(b[0].n, /^[\d,. ]+ \/ 6[,.]?000$/, 'week: total / weekly goal');
    assert.match(b[1].label, /^TODAY · (MON|TUE|WED|THU|FRI|SAT|SUN) \d+$/, 'today, with its date');
    assert.match(b[1].n, /^123[,.]?456 \/ 1[,.]?000$/, 'today: count / daily goal, thousands and all');
    // The detail is still there further down.
    assert.match(await app.eval(`document.querySelector('#overlay .wk-facts').textContent`), /writing streak 3 days/);
    await app.key('Escape');
    await sleep(250);
  }
  await app.close(); app = null;
});

test('the weather and the scenery, drawn whole: a rain cloud, a palm tree, a special loop', { timeout: 180000 }, async () => {
  const ud = path.join(tmp, 'e');
  await seed(ud, 0);
  app = await launch(ud);
  await sleep(600);
  const bounds = `(() => { const d = __stet.dino, c = d.c, P = ${JSON.stringify(H)}; return c.props.filter((p) => !p.carried).map((p) => ({ k: p.kind, ok: p.x >= -c.margin - 0.5 && p.y >= 0 })) })()`;
  await app.eval(`(() => { const c = __stet.dino.c; c.queue = []; c.envDue = null; c.inReaction = null; c.paused = null; c.held = []; c.envNext = Infinity; c.pending = 'look'; c.gen = null; })()`);
  await sleep(800);
  await app.eval(`__stet.dino.c.startEvent('rain')`);
  let rained = false, part = null;
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const r = await app.eval(`(() => { const d = __stet.dino, c = d.c; d.lastSig = ''; d.draw(); const cv = d.canvas, img = cv.getContext('2d').getImageData(0, 0, cv.width, 6).data; let topInk = 0; for (let i = 3; i < img.length; i += 4) if (img[i]) topInk++; return { drops: c.drops.length, cloud: !!c.find('cloud'), reaction: c.inReaction, event: !!c.event, topInk, rows: cv.height / d.pxDev }; })()`);
    if (r.drops) rained = true;
    if (r.reaction && !part) part = r.reaction;
    assert.equal(r.topInk, 0, 'nothing reaches the top edge of its canvas: never cut off');
    if (rained && !r.event) break;
  }
  assert.ok(rained, 'it rained');
  assert.ok(/^rain/.test(part), `it took part: ${part}`);
  assert.equal(await app.eval('!!__stet.dino.c.event'), false, 'and the shower passed');
  for (const p of await app.eval(bounds)) assert.ok(p.ok, `${p.k} in view`);
  // A palm tree grows next to it.
  await app.eval(`(() => { const c = __stet.dino.c; c.props = []; c.pending = 'palmTree'; c.gen = null; c.inReaction = null; c.paused = null; c.held = []; c.queue = []; c.envDue = null; })()`);
  let full = false;
  for (let i = 0; i < 80 && !full; i++) { await sleep(100); full = await app.eval(`__stet.dino.c.find('palm')?.frame === 3`); }
  assert.ok(full, 'the palm grew to full height');
  // An unlocked special loop runs in the real app too.
  await app.eval(`(() => { const d = __stet.dino, c = d.c; d.setStreak({ growth: 6, unlocked: 3 }, false); c.props = []; c.pending = 'skateboard'; c.gen = null; c.inReaction = null; c.paused = null; c.held = []; })()`);
  let rode = false;
  for (let i = 0; i < 60 && !rode; i++) { await sleep(100); rode = await app.eval(`!!__stet.dino.c.props.find((p) => p.kind === 'skateboard' && p.ride)`); }
  assert.ok(rode, 'on the skateboard');
  await app.close(); app = null;
});
