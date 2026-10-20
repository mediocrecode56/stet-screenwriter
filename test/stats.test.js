// Writing statistics: the ledger (core/stats.js) and its saved copy
// (main/statsstore.js). Covers accumulation across documents and projects,
// restarts, upgrades from older versions, damaged files, double-send
// protection, internal consistency, the confirmed reset, and performance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StatsBook, upgradeStats, dayKey, weekStart, addDays, STATS_VERSION } from '../src/core/stats.js';
import { StatsStore } from '../src/main/statsstore.js';
import { Editor, pos } from '../src/core/editor.js';
import { makeBlock } from '../src/core/model.js';
import { parsePlainText } from '../src/core/plaintext.js';

function clock(start) {
  let t = new Date(start);
  const now = () => new Date(t);
  now.set = (d) => { t = new Date(d); };
  now.ms = () => t.getTime();
  return now;
}
const at = (s) => Date.parse(s);
const tmpdir = () => fs.mkdtemp(path.join(os.tmpdir(), 'stet-stats-'));

/** Σ checks: total = Σ days = Σ docs; each day = Σ its documents. */
function consistent(data) {
  let days = 0, docs = 0;
  for (const [k, d] of Object.entries(data.days)) {
    const s = Object.values(d.docs).reduce((a, b) => a + b, 0);
    assert.equal(d.w, s, `day ${k} = Σ its documents`);
    assert.ok(d.w > 0, 'no empty days stored');
    days += d.w;
  }
  for (const m of Object.values(data.docs)) { assert.ok(m.w >= 0); docs += m.w; }
  assert.equal(data.total, days, 'total = Σ days');
  assert.equal(data.total, docs, 'total = Σ documents');
}

test('credits accumulate per day, per document and in total', () => {
  const now = clock('2026-10-21T10:00:00');
  const book = new StatsBook(null, now);
  book.apply([{ doc: 'a', n: 120, t: now.ms() }, { doc: 'b', n: 30, t: now.ms() }], { a: { title: 'Alpha', path: 'C:\\s\\Alpha.stet' }, b: { title: '', path: null } });
  book.apply([{ doc: 'a', n: 5, t: now.ms() }]);
  assert.equal(book.wordsOn('2026-10-21'), 155);
  assert.equal(book.data.docs.a.w, 125);
  assert.equal(book.data.total, 155);
  assert.equal(book.title('a'), 'Alpha');
  assert.equal(book.title('b'), 'Untitled screenplay');
  consistent(book.data);
});

test('a negative credit (undo) is charged to the day the words were written, never below zero', () => {
  const now = clock('2026-10-21T23:59:00');
  const book = new StatsBook(null, now);
  book.apply([{ doc: 'a', n: 10, t: now.ms() }]);
  now.set('2026-10-22T00:01:00');
  book.apply([{ doc: 'a', n: 4, t: now.ms() }]);
  book.apply([{ doc: 'a', n: -10, t: at('2026-10-21T23:59:00') }]); // undo of yesterday's typing
  assert.equal(book.wordsOn('2026-10-21'), 0);
  assert.equal(book.wordsOn('2026-10-22'), 4);
  book.apply([{ doc: 'a', n: -50, t: now.ms() }]);
  assert.equal(book.wordsOn('2026-10-22'), 0, 'floored at zero');
  book.apply([{ doc: 'zzz', n: -5, t: now.ms() }]);
  assert.equal(book.data.total, 0);
  consistent(book.data);
});

test('weekly summary: totals, goals, unavailable days vs genuine zeros, future days, streak', () => {
  const now = clock('2026-10-14T09:00:00'); // Wednesday; recording starts mid-week
  const book = new StatsBook(null, now);
  const write = (day, n, doc = 'x') => { now.set(day + 'T12:00:00'); book.apply([{ doc, n, t: now.ms() }]); };
  write('2026-10-14', 600);
  write('2026-10-15', 0);
  write('2026-10-16', 1200, 'y');
  now.set('2026-10-17T08:00:00'); // Saturday morning, nothing yet
  const s = book.summary({ daily: 500, weekly: 3000 });
  assert.equal(s.week.start, '2026-10-12');
  assert.deepEqual(s.week.days.map((d) => [d.known, d.words, d.future]), [
    [false, 0, false], [false, 0, false], // Mon, Tue: before recording began → no data, not zero
    [true, 600, false], [true, 0, false], [true, 1200, false], [true, 0, false],
    [false, 0, true],
  ]);
  assert.equal(s.week.total, 1800);
  assert.equal(s.week.active, 2);
  assert.equal(s.week.met, 2);
  assert.deepEqual(s.week.best, { day: '2026-10-16', words: 1200 });
  assert.deepEqual(s.week.docs.map((d) => [d.id, d.words]), [['y', 1200], ['x', 600]]);
  assert.equal(s.today.words, 0);
  assert.equal(s.streak, 1, 'Friday met; Saturday not over yet so it does not break the streak');
  assert.equal(s.hasEarlier, false);
  // Next week: last week is browsable and unchanged.
  now.set('2026-10-20T10:00:00');
  const prev = book.summary({ daily: 500 }, -1);
  assert.equal(prev.week.total, 1800);
  assert.equal(prev.week.current, false);
  assert.equal(book.summary({ daily: 500 }).week.total, 0, 'a new week starts at zero — the totals are kept');
  assert.equal(book.summary({}).total, 1800);
});

test('per-document, per-project, weekly and all-time figures agree under random load', () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const now = clock('2026-09-01T09:00:00');
  const book = new StatsBook(null, now);
  const docs = ['a', 'b', 'c', 'd', 'e'];
  const meta = { a: { path: 'C:\\P1\\a.stet' }, b: { path: 'C:\\P1\\b.stet' }, c: { path: 'C:\\P2\\c.stet' }, d: { path: null }, e: { path: 'C:\\P2\\e.stet' } };
  let net = 0;
  for (let i = 0; i < 20000; i++) {
    now.set(now.ms() + Math.floor(rnd() * 600000));
    const doc = docs[Math.floor(rnd() * docs.length)];
    const n = rnd() < 0.8 ? 1 + Math.floor(rnd() * 20) : -Math.floor(rnd() * 10);
    net += book.apply([{ doc, n, t: now.ms() - Math.floor(rnd() * 3600000) }]);
  }
  book.apply([], meta);
  consistent(book.data);
  assert.equal(book.data.total, net, 'the net returned by apply() adds up to the total');
  const projects = book.byProject();
  assert.equal(Object.values(projects).reduce((a, b) => a + b, 0), book.data.total, 'Σ projects = total');
  assert.equal(projects['C:\\P1'], book.data.docs.a.w + book.data.docs.b.w);
  // Σ of all weeks = total.
  let weeks = 0;
  for (let o = 0; ; o--) { const s = book.summary({}, o); weeks += s.week.total; if (!s.hasEarlier) break; }
  assert.equal(weeks, book.data.total, 'Σ weeks = total');
});

test('upgrade from the 0.6 format keeps every recorded word', () => {
  const v1 = {
    days: {
      '2026-10-19': { w: 110, docs: { a: { base: 0, peak: 6 }, b: { base: 560, peak: 566 }, c: { base: 97066, peak: 97114 }, z: { base: 0, peak: 0 } } },
      '2026-10-20': { w: 2, docs: { b: { base: 562, peak: 564 } } },
      '2026-08-01': { w: 900, docs: {} }, // per-document detail already compacted away
    },
  };
  const { data, migrated } = upgradeStats(v1, new Date('2026-10-21T10:00:00'));
  assert.equal(migrated, true);
  assert.equal(data.version, STATS_VERSION);
  assert.equal(data.total, 110 + 2 + 900);
  assert.equal(data.days['2026-10-19'].w, 110);
  assert.equal(data.days['2026-10-19'].docs.c, 48);
  assert.equal(data.days['2026-08-01'].w, 900);
  assert.equal(data.since, '2026-08-01');
  assert.equal(data.docs.b.w, 8);
  consistent(data);
  // Upgrading again (or loading v2) changes nothing.
  assert.deepEqual(upgradeStats(data).data.days, data.days);
});

test('a format from a newer STET is refused, not overwritten', async () => {
  const dir = await tmpdir();
  const file = path.join(dir, 'stats.json');
  const future = JSON.stringify({ version: 99, total: 5, whatever: true });
  writeFileSync(file, future);
  const store = new StatsStore(dir);
  assert.equal(store.readOnly, true);
  assert.match(store.notice, /newer version/);
  assert.equal(store.add({ id: 'x', entries: [{ doc: 'a', n: 3, t: Date.now() }] }).ok, false);
  await store.flush();
  await assert.rejects(store.reset());
  assert.equal(readFileSync(file, 'utf8'), future, 'file untouched');
  await fs.rm(dir, { recursive: true, force: true });
});

test('a damaged file is kept aside and the backup is used — never a silent reset', async () => {
  const dir = await tmpdir();
  const now = clock('2026-10-21T10:00:00');
  let store = new StatsStore(dir, now);
  store.add({ id: 's:1', entries: [{ doc: 'a', n: 700, t: now.ms() }] });
  await store.flush();
  now.set('2026-10-22T10:00:00'); // next day: the first write makes the daily backup
  store = new StatsStore(dir, now);
  store.add({ id: 's2:1', entries: [{ doc: 'a', n: 50, t: now.ms() }] });
  await store.flush();
  assert.ok(existsSync(path.join(dir, 'stats.bak.json')));
  writeFileSync(path.join(dir, 'stats.json'), '{"version":2,"days":{ truncated');
  store = new StatsStore(dir, now);
  assert.equal(store.data.total, 700, 'yesterday’s backup restored');
  assert.match(store.notice, /backup/);
  const names = await fs.readdir(dir);
  assert.ok(names.some((n) => n.startsWith('stats.json.corrupt-')), 'damaged file kept for inspection');
  await store.flush();
  await fs.rm(dir, { recursive: true, force: true });
});

test('statistics survive restarts and a newer build, and a re-sent batch is booked once', async () => {
  const dir = await tmpdir();
  const now = clock('2026-10-21T10:00:00');
  // Session 1 (old build): an existing v1 file from STET 0.6.
  writeFileSync(path.join(dir, 'stats.json'), JSON.stringify({ days: { '2026-10-20': { w: 40, docs: { a: { base: 0, peak: 40 } } } } }));
  let store = new StatsStore(dir, now);
  assert.equal(store.data.total, 40);
  assert.equal(store.add({ id: 'w1:1', entries: [{ doc: 'a', n: 10, t: now.ms() }] }).ok, true);
  assert.equal(store.add({ id: 'w1:1', entries: [{ doc: 'a', n: 10, t: now.ms() }] }).duplicate, true, 'retry ignored');
  await store.flush();
  assert.ok(existsSync(path.join(dir, 'stats-v1.json')), 'the old-format file is kept');
  // Session 2: "restart" — a fresh store reading the same folder (as a rebuilt exe would).
  store = new StatsStore(dir, now);
  assert.equal(store.data.total, 50);
  store.add({ id: 'w2:1', entries: [{ doc: 'new-project-doc', n: 25, t: now.ms() }], meta: {} });
  await store.flush();
  // Session 3, a week later.
  now.set('2026-10-28T10:00:00');
  store = new StatsStore(dir, now);
  assert.equal(store.data.total, 75);
  assert.equal(store.book.summary({}).week.total, 0);
  assert.equal(store.book.summary({}, -1).week.total, 75);
  consistent(store.data);
  await fs.rm(dir, { recursive: true, force: true });
});

test('Reset clears everything it promises, archives a copy, and ignores later undo of older writing', async () => {
  const dir = await tmpdir();
  const now = clock('2026-10-21T10:00:00');
  const store = new StatsStore(dir, now);
  const before = now.ms();
  store.add({ id: 'a:1', entries: [{ doc: 'a', n: 300, t: before }, { doc: 'b', n: 20, t: before }] });
  now.set('2026-10-21T11:00:00');
  const r = await store.reset();
  assert.equal(r.data.total, 0);
  assert.deepEqual(r.data.days, {});
  assert.deepEqual(r.data.docs, {});
  assert.equal(r.data.resets.length, 1);
  assert.equal(r.data.resets[0].total, 320);
  assert.equal(JSON.parse(readFileSync(r.archive, 'utf8')).total, 320, 'archived copy of what was cleared');
  store.add({ id: 'a:2', entries: [{ doc: 'a', n: -300, t: before }] }); // undo of pre-reset typing
  store.add({ id: 'a:3', entries: [{ doc: 'a', n: 15, t: now.ms() }] });
  assert.equal(store.data.total, 15, 'recording starts again from zero');
  await store.flush();
  assert.equal(new StatsStore(dir, now).data.total, 15, 'the reset is saved');
  await fs.rm(dir, { recursive: true, force: true });
});

test('a failed Reset leaves the statistics exactly as they were', async () => {
  const dir = await tmpdir();
  const now = clock('2026-10-21T10:00:00');
  const store = new StatsStore(dir, now);
  store.add({ id: 'a:1', entries: [{ doc: 'a', n: 300, t: now.ms() }] });
  await store.flush();
  const snapshot = JSON.stringify(store.data);
  store._write = async () => { throw new Error('disk full'); };
  await assert.rejects(store.reset(), /disk full/);
  assert.equal(JSON.stringify(store.data), snapshot);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'stats.json'), 'utf8')).total, 300);
  await fs.rm(dir, { recursive: true, force: true });
});

test('end to end: editing sessions across documents, reopening and restarting', async () => {
  const dir = await tmpdir();
  const now = clock('2026-10-21T09:00:00');
  let store = new StatsStore(dir, now);
  let seq = 0;
  const session = (blocks, id, fn) => {
    const ed = new Editor(blocks);
    ed.now = () => now.ms();
    ed.onChange = () => { const c = ed.takeCredits(); if (c.length) store.add({ id: 'e:' + ++seq, entries: c.map((x) => ({ doc: id, ...x })) }); };
    fn(ed);
    return ed.blocks;
  };
  const type = (ed, s) => { for (const ch of s) ed.insertText(ch); };
  // A 10,000-word screenplay opened: nothing counted. Then 4 words written.
  const big = parsePlainText(Array.from({ length: 10000 }, (_, i) => 'w' + i).join(' '));
  let bigBlocks = session(big, 'big', (ed) => { ed.setSel(pos(0, ed.blocks[0].text.length)); type(ed, ' four new words here'); });
  assert.equal(store.data.total, 4);
  // A new screenplay in another project.
  session([makeBlock('action')], 'fresh', (ed) => { type(ed, 'Hello world'); ed.undo(); ed.redo(); });
  assert.equal(store.data.total, 6);
  // Switch back and forth, reopen: no new words.
  for (let i = 0; i < 5; i++) bigBlocks = session(bigBlocks, 'big', () => {});
  assert.equal(store.data.total, 6);
  await store.flush();
  store = new StatsStore(dir, now); // restart
  assert.equal(store.data.total, 6);
  assert.equal(store.data.docs.big.w, 4);
  await fs.rm(dir, { recursive: true, force: true });
});

test('performance: a year of heavy use books and summarises quickly', () => {
  const now = clock('2025-10-21T09:00:00');
  const book = new StatsBook(null, now);
  const t0 = performance.now();
  for (let d = 0; d < 365; d++) {
    const day = now.ms() + d * 86400000;
    for (let i = 0; i < 3000; i++) book.apply([{ doc: 'd' + (i % 7), n: 1, t: day + i * 1000 }]);
  }
  const booked = performance.now() - t0;
  now.set(now.ms() + 364 * 86400000);
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) book.summary({ daily: 1000, weekly: 5000 });
  const sum = (performance.now() - t1) / 100;
  assert.equal(book.data.total, 365 * 3000);
  assert.ok(booked < 3000, `booking 1.1M credits took ${booked.toFixed(0)} ms`);
  assert.ok(sum < 5, `summary took ${sum.toFixed(2)} ms`);
  assert.equal(JSON.stringify(book.data).length < 400000, true, 'the saved file stays small');
});

test('date helpers', () => {
  assert.equal(weekStart('2026-10-19'), '2026-10-19'); // Monday
  assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

// ---- the weekly chart's scale and numbers ----
import { fmtWords, niceTop, weekScale } from '../src/core/chart.js';

test('week chart: the scale adapts to the data, bars stay proportional, an outlier gets a broken bar', () => {
  const day = (words, o = {}) => ({ words, known: true, future: false, ...o });
  const L = (n) => n.toLocaleString();
  // Round tops just above the highest day or the goal.
  assert.deepEqual([90, 100, 101, 640, 980, 1240, 7830, 12210, 131830].map(niceTop), [100, 100, 200, 1000, 1000, 2000, 10000, 20000, 200000]);
  // Small, ordinary, large and very large weeks.
  for (const [words, goal, top] of [
    [[0, 12, 0, 230, 40, 0, 0], 500, 500],
    [[640, 720, 655, 690, 702, 610, 980], 600, 1000],
    [[0, 1240, 0, 7830, 420, 12210, 960], 500, 20000],
    [[3100, 4200, 2900, 5100, 4800, 3900, 4400], 1000, 10000],
  ]) {
    const s = weekScale(words.map((w) => day(w)), goal, 104);
    assert.equal(s.top, top, `top for ${words}`);
    for (const w of words) {
      assert.ok(s.px(w) <= 104, 'never taller than the plot');
      if (w > 0) assert.ok(s.px(w) >= 2, 'any words show a sliver');
      if (w > 0) assert.ok(Math.abs(s.px(w) - (w / top) * 104) <= 1, `${w} drawn in proportion`);
      assert.equal(s.over(w), false, 'no break in an ordinary week');
    }
    assert.ok(s.px(goal) <= 104, 'the goal line is on the chart');
  }
  // One day dwarfs the rest: scale by the others, break that bar.
  const huge = weekScale([18450, 2240, 0, 131830, 9420, 0, 60].map((w) => day(w)), 1000, 104);
  assert.equal(huge.top, 25000);
  assert.equal(huge.over(131830), true);
  assert.equal(huge.px(131830), 104);
  assert.ok(huge.px(18450) > 3 * huge.px(9420) / 2 && huge.px(9420) > 3 * huge.px(2240), 'the other days still compare');
  // Days with no record and days to come don't count towards the scale.
  const partial = weekScale([day(800), day(0, { known: false }), day(0, { future: true })], 0, 104);
  assert.equal(partial.top, 1000);
  // Numbers: exact everywhere, abbreviated only on the axis or from a million.
  assert.equal(fmtWords(612), '612');
  assert.equal(fmtWords(12210), L(12210));
  assert.equal(fmtWords(131830), L(131830));
  assert.equal(fmtWords(2500000), L(2.5) + 'M');
  assert.equal(fmtWords(12500, true), L(12.5) + 'k');
  assert.equal(fmtWords(200000, true), '200k');
  assert.equal(fmtWords(500, true), '500');
});
