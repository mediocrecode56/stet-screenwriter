// The writing streak (core/streak.js, booked by core/stats.js, saved by
// main/statsstore.js): the day rules, the milestones and what they earn the
// dinosaur, and that it persists without ever touching the word counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StatsBook, upgradeStats, dayKey, addDays, weekStart } from '../src/core/stats.js';
import { StatsStore } from '../src/main/statsstore.js';
import { MILESTONES, growthFor, unlocksFor, currentStreak, bookDay, unbookDay, emptyStreak, cleanStreak, spareGap, restUsed, replayStreak } from '../src/core/streak.js';

function clock(start) {
  let t = new Date(start);
  const now = () => new Date(t);
  now.set = (d) => { t = new Date(d); };
  return now;
}
const noon = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); };
const write = (book, k, n = 1, doc = 'a') => book.apply([{ doc, n, t: noon(k).getTime() + Math.random() * 1000 }]);

/** A book that has been written in on each of the `n` days up to and including `today`. */
function daysInARow(n, today = '2026-10-20') {
  const now = clock(noon(today));
  const start = addDays(today, -n - 2);
  now.set(noon(start));
  const book = new StatsBook(null, now);
  for (let i = n - 1; i >= 0; i--) { const k = addDays(today, -i); now.set(noon(k)); write(book, k, 3); }
  now.set(noon(today));
  return book;
}

test('milestones at 1, 2, 4, 8, 16 and 32 days: one pixel each, a special loop every second one', () => {
  assert.deepEqual(MILESTONES, [1, 2, 4, 8, 16, 32]);
  const want = { 0: [0, 0], 1: [1, 0], 2: [2, 1], 3: [2, 1], 4: [3, 1], 7: [3, 1], 8: [4, 2], 15: [4, 2], 16: [5, 2], 31: [5, 2], 32: [6, 3], 33: [6, 3], 100: [6, 3] };
  for (const [n, [g, u]] of Object.entries(want)) {
    const book = n === '0' ? new StatsBook(null, clock(noon('2026-10-20'))) : daysInARow(+n);
    const s = book.summary({}).writing;
    assert.equal(s.days, +n, `${n} days in a row`);
    assert.equal(s.growth, g, `${n} days: +${g} px`);
    assert.equal(s.unlocked, u, `${n} days: ${u} special loops`);
    assert.equal(growthFor(+n), g);
    assert.equal(unlocksFor(g), u);
  }
  // Each milestone adds exactly one pixel, never more; the special loops arrive at the 2nd, 4th and 6th.
  for (let n = 1; n <= 40; n++) {
    const d = growthFor(n) - growthFor(n - 1);
    assert.equal(d, MILESTONES.includes(n) ? 1 : 0, `day ${n}`);
  }
  assert.deepEqual([2, 4, 6].map(unlocksFor), [1, 2, 3]);
  assert.deepEqual([1, 3, 5].map(unlocksFor), [0, 1, 2]);
});

test('a third day off in one week breaks the streak; an unfinished today never does', () => {
  const now = clock(noon('2026-10-01'));
  const book = new StatsBook(null, now);
  for (const k of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']) { now.set(noon(k)); write(book, k); }
  assert.equal(book.summary({}).writing.days, 5);
  now.set(new Date(2026, 9, 6, 23, 59)); // the 6th, not written yet: still alive
  assert.equal(book.summary({}).writing.days, 5);
  assert.equal(book.summary({}).writing.today, false);
  now.set(new Date(2026, 9, 7, 0, 1)); // the 6th went by without a word: a rest day
  assert.equal(book.summary({}).writing.days, 5, 'one day off is spared');
  now.set(new Date(2026, 9, 8, 12)); // the 7th too: the week's second
  assert.equal(book.summary({}).writing.days, 5, 'two days off are spared');
  assert.deepEqual(book.summary({}).writing.rest, { used: 2, left: 0 });
  now.set(new Date(2026, 9, 9, 0, 1)); // and the 8th: a third day off in the same week
  assert.equal(book.summary({}).writing.days, 0, 'broken');
  assert.equal(book.summary({}).writing.growth, 0, 'back to its first size');
  write(book, '2026-10-09');
  const s = book.summary({}).writing;
  assert.equal(s.days, 1, 'a new streak starts');
  assert.equal(s.growth, 1);
  assert.equal(s.best, 5, 'the best is remembered');
  // Midnight is the boundary, in local time: 23:59 and 00:01 are different days.
  now.set(new Date(2026, 9, 9, 23, 59)); book.apply([{ doc: 'a', n: 1, t: now().getTime() }]);
  now.set(new Date(2026, 9, 10, 0, 1)); book.apply([{ doc: 'a', n: 1, t: now().getTime() }]);
  assert.equal(book.summary({}).writing.days, 2);
});

test('one streak day however many screenplays, sessions or restarts; never twice a day', () => {
  const now = clock(noon('2026-10-10'));
  let book = new StatsBook(null, now);
  write(book, '2026-10-10', 5, 'film');
  write(book, '2026-10-10', 7, 'pilot');
  write(book, '2026-10-10', 1, 'short');
  assert.equal(book.summary({}).writing.days, 1);
  // A restart the same day: the saved data comes back and more is written.
  book = new StatsBook(JSON.parse(JSON.stringify(book.data)), now);
  write(book, '2026-10-10', 4, 'film');
  assert.equal(book.summary({}).writing.days, 1, 'still one day');
  now.set(noon('2026-10-11'));
  book = new StatsBook(JSON.parse(JSON.stringify(book.data)), now);
  write(book, '2026-10-11', 1, 'pilot');
  write(book, '2026-10-11', 1, 'film');
  assert.equal(book.summary({}).writing.days, 2, 'the next day adds one');
  // A late credit for an earlier day (a delayed send) changes nothing.
  write(book, '2026-10-09', 3, 'film');
  assert.equal(book.summary({}).writing.days, 2);
});

test('only new words count: nothing else books a day, and undone words unbook it', () => {
  const now = clock(noon('2026-10-12'));
  const book = new StatsBook(null, now);
  // Opening, importing or loading a document books no credits (see the editor's writing
  // activity) — and describing a document, or an empty batch, books nothing either.
  book.apply([], { a: { title: 'Imported', path: 'C:\\x.stet' } });
  book.apply([{ doc: 'a', n: 0, t: now().getTime() }]);
  assert.equal(book.summary({}).writing.days, 0);
  // A word written and taken back the same day: not a writing day after all.
  write(book, '2026-10-12', 1);
  assert.equal(book.summary({}).writing.days, 1);
  book.apply([{ doc: 'a', n: -1, t: noon('2026-10-12').getTime() }]);
  assert.equal(book.summary({}).writing.days, 0, 'unbooked');
  write(book, '2026-10-12', 2);
  assert.equal(book.summary({}).writing.days, 1);
});

test('it persists through restarts, older statistics and a confirmed Reset — and never touches the word counts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-streak-'));
  const now = clock(noon('2026-10-15'));
  let store = new StatsStore(dir, now);
  let id = 0;
  for (const k of ['2026-10-13', '2026-10-14', '2026-10-15']) store.add({ id: 'b' + ++id, entries: [{ doc: 'a', n: 10, t: noon(k).getTime() }] });
  // (Days before the store began are refused, as ever — so the first two aren't booked.)
  assert.equal(store.book.summary({}).writing.days, 1);
  now.set(noon('2026-10-16'));
  store.add({ id: 'b' + ++id, entries: [{ doc: 'b', n: 4, t: now().getTime() }] });
  await store.flush();
  const total = store.data.total;
  store = new StatsStore(dir, now); // restart, or a newer build reading the same file
  assert.equal(store.book.summary({}).writing.days, 2, 'survives a restart');
  assert.equal(store.data.total, total, 'word counts untouched');
  await store.reset();
  assert.equal(store.data.total, 0, 'Reset clears the words…');
  assert.equal(store.book.summary({}).writing.days, 2, '…and keeps the streak');
  store = new StatsBook(JSON.parse(await fs.readFile(path.join(dir, 'stats.json'), 'utf8')), now);
  assert.equal(store.summary({}).writing.days, 2, 'the streak is in the saved file');

  // Statistics saved before streaks existed: the streak their days already show.
  const days = {};
  for (let i = 0; i < 9; i++) days[addDays('2026-10-16', -i)] = { w: 5, docs: { a: 5 } };
  days['2026-09-01'] = { w: 2, docs: { a: 2 } };
  const old = { version: 2, start: '2026-08-01T00:00:00.000Z', since: '2026-08-01', total: 47, days, docs: { a: { w: 47, title: 'A', path: null, first: '2026-09-01', last: '2026-10-16' } }, resets: [] };
  const up = new StatsBook(old, now);
  assert.equal(up.summary({}).writing.days, 9);
  assert.equal(up.summary({}).writing.growth, 4);
  assert.equal(up.data.total, 47, 'nothing recounted');
  const v1 = upgradeStats({ days: { '2026-10-15': { w: 3, docs: { a: { base: 0, peak: 3 } } }, '2026-10-16': { w: 2, docs: { a: { base: 0, peak: 2 } } } } }, noon('2026-10-16')).data;
  assert.equal(currentStreak(v1.streak, '2026-10-16'), 2, 'even from the 0.6 format');
  // A damaged streak record is repaired, not trusted.
  const bad = new StatsBook({ ...old, streak: { last: 'nonsense', count: -4 } }, now);
  assert.equal(bad.summary({}).writing.days, 0);
});

test('the streak rules on their own', () => {
  const s = emptyStreak();
  assert.equal(currentStreak(s, '2026-01-01'), 0);
  assert.equal(bookDay(s, '2026-01-01'), true);
  assert.equal(bookDay(s, '2026-01-01'), false, 'once a day');
  bookDay(s, '2026-01-02');
  bookDay(s, '2026-01-03');
  assert.equal(currentStreak(s, '2026-01-03'), 3);
  assert.equal(currentStreak(s, '2026-01-04'), 3, 'today is not over');
  assert.equal(currentStreak(s, '2026-01-05'), 3, 'a day off (Sunday) is spared');
  bookDay(s, '2026-01-05');
  assert.equal(currentStreak(s, '2026-01-05'), 4);
  assert.equal(currentStreak(s, '2026-01-09'), 0, 'three days off in one week (Tue–Thu)');
  bookDay(s, '2026-01-09');
  assert.equal(currentStreak(s, '2026-01-09'), 1);
  assert.equal(s.best, 4);
  // Across a month and a year end.
  const t = emptyStreak();
  for (const k of ['2026-12-30', '2026-12-31', '2027-01-01']) bookDay(t, k);
  assert.equal(currentStreak(t, '2027-01-01'), 3);
  assert.equal(dayKey(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
});

// ---- 0.14: two rest days a week ----

/** A book written in on exactly these days (each at noon), with the clock left at `today`. */
function wroteOn(keys, today) {
  const now = clock(noon(addDays(keys[0], -1)));
  const book = new StatsBook(null, now);
  for (const k of keys) { now.set(noon(k)); write(book, k); }
  now.set(noon(today));
  return { book, now, days: () => book.summary({}).writing.days };
}
// October 2026: the Mondays are the 5th, 12th, 19th and 26th.

test('rest days: two days off in a row are spared, a third that week is not', () => {
  const w = wroteOn(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-10'], '2026-10-10'); // Thu 8 and Fri 9 off
  assert.equal(w.days(), 4, 'Thursday and Friday spared');
  assert.deepEqual(w.book.summary({}).writing.rest, { used: 2, left: 0 });
  w.now.set(noon('2026-10-11')); assert.equal(w.days(), 4, 'Sunday not over yet');
  w.now.set(noon('2026-10-12')); assert.equal(w.days(), 0, 'Sunday off as well: the third that week breaks it');
});

test('rest days: two separate days off in a week are spared, and writing in between gives nothing back', () => {
  const w = wroteOn(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-10'], '2026-10-10'); // Tue 6 and Thu 8 off
  assert.equal(w.days(), 4);
  assert.deepEqual(w.book.summary({}).writing.rest, { used: 2, left: 0 }, 'writing on Wednesday did not refund Tuesday');
  w.now.set(noon('2026-10-12')); assert.equal(w.days(), 0, 'a third day off (Sunday) breaks it');
  // A streak that breaks mid-week has still spent that week's rest days: the next one gets none until Monday.
  const b = wroteOn(['2026-10-05', '2026-10-09', '2026-10-10'], '2026-10-12'); // Tue–Thu off (broken on Thursday), then Sunday off
  assert.equal(b.days(), 0, 'Tuesday and Wednesday were spent, so Sunday is not spared');
});

test('rest days: the allowance comes back each Monday, even in the middle of a gap', () => {
  // Sat 10 and Sun 11 off (that week's two), Mon 12 and Tue 13 off (the new week's two).
  const w = wroteOn(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-14'], '2026-10-14');
  assert.equal(w.days(), 6, 'four days off across a weekend: two from each week');
  assert.deepEqual(w.book.summary({}).writing.rest, { used: 2, left: 0 });
  w.now.set(noon('2026-10-16')); assert.equal(w.days(), 0, 'Thursday off: this week has none left');
  // Two a week, week after week.
  const n = wroteOn(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14', '2026-10-16'], '2026-10-16');
  assert.equal(n.days(), 8, 'Tue and Thu off, then Tue and Thu off again the next week');
  assert.deepEqual(n.book.summary({}).writing.rest, { used: 2, left: 0 });
  n.now.set(noon('2026-10-17')); assert.equal(n.days(), 8, 'Saturday not over yet');
  n.now.set(noon('2026-10-19')); assert.equal(n.days(), 0, 'Sat and Sun off on top: too many');
  const m = wroteOn(['2026-10-07', '2026-10-09', '2026-10-10', '2026-10-11'], '2026-10-13'); // Thu 8 spent last week; Mon 12 off
  assert.deepEqual(m.book.summary({}).writing.rest, { used: 1, left: 1 }, 'a new week starts with two (one now spent)');
});

test('rest days: a day is never spent twice, however often it is evaluated, booked or restarted', async () => {
  const s = emptyStreak();
  for (const k of ['2026-10-05', '2026-10-07']) bookDay(s, k); // Tue 6 spared
  assert.deepEqual(s.spared, ['2026-10-06']);
  for (let i = 0; i < 50; i++) { assert.equal(currentStreak(s, '2026-10-09'), 2); assert.equal(restUsed(s, '2026-10-09'), 2); }
  assert.deepEqual(s.spared, ['2026-10-06'], 'evaluating spends nothing');
  for (let i = 0; i < 5; i++) assert.equal(bookDay(s, '2026-10-07'), false);
  assert.deepEqual(s.spared, ['2026-10-06'], 'booking the same day again spends nothing');
  bookDay(s, '2026-10-09'); // Thu 8 spared
  assert.deepEqual(s.spared, ['2026-10-06', '2026-10-08']);
  assert.equal(spareGap(s.spared, '2026-10-07', '2026-10-09').ok, true, 'days already spent are not counted again');
  unbookDay(s, '2026-10-09'); // its words were all undone
  assert.deepEqual(s.spared, ['2026-10-06'], 'unbooking gives back the day it spent');
  assert.equal(currentStreak(s, '2026-10-09'), 2);
  // Through a restart: the spent days are saved and read back as they were.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-rest-'));
  const now = clock(noon('2026-10-05'));
  let store = new StatsStore(dir, now), id = 0;
  for (const k of ['2026-10-05', '2026-10-07', '2026-10-09']) { now.set(noon(k)); store.add({ id: 'r' + ++id, entries: [{ doc: 'a', n: 3, t: now().getTime() }] }); }
  await store.flush();
  store = new StatsStore(dir, now);
  assert.deepEqual(store.data.streak.spared, ['2026-10-06', '2026-10-08']);
  now.set(noon('2026-10-10')); assert.equal(store.book.summary({}).writing.days, 3);
  now.set(noon('2026-10-11')); assert.equal(store.book.summary({}).writing.days, 0, 'Saturday off: the week had none left');
  await fs.rm(dir, { recursive: true, force: true });
});

test('rest days: a streak saved by an earlier version carries on, and damaged entries are dropped', () => {
  const now = clock(noon('2026-10-14'));
  const raw = (streak) => ({ version: 2, start: '2026-10-01T00:00:00.000Z', since: '2026-10-01', total: 0, days: {}, docs: {}, resets: [], streak });
  // 0.13 saved no `spared`. It was written in last on Monday the 12th; Tuesday went by: now a rest day, not the end.
  const book = new StatsBook(raw({ last: '2026-10-12', count: 9, best: 9, prev: { last: '2026-10-11', count: 8 } }), now);
  assert.equal(book.summary({}).writing.days, 9);
  assert.deepEqual(book.data.streak.spared, []);
  assert.deepEqual(cleanStreak({ last: '2026-10-12', count: 3, spared: ['x', 4, '2026-10-10', '2026-10-10', '2026-10-13'] }).spared, ['2026-10-10'], 'only real days before `last`, once each');
});

test('rest days against a day-by-day reference, over random months of writing', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let run = 0; run < 40; run++) {
    const p = 0.35 + 0.6 * rnd(), start = '2026-03-02';
    const written = new Set();
    for (let i = 0; i < 90; i++) if (rnd() < p) written.add(addDays(start, i));
    // Reference: day by day. A day off spends one of its week's two while the streak lives, else ends it.
    let count = 0, alive = false;
    const used = {};
    const now = clock(noon(start));
    const book = new StatsBook(null, now);
    for (let i = 0; i < 90; i++) {
      const k = addDays(start, i);
      now.set(noon(k));
      if (written.has(k)) { write(book, k); count = alive ? count + 1 : 1; alive = true; }
      assert.equal(book.summary({}).writing.days, alive ? count : 0, `run ${run}, ${k}`);
      if (!written.has(k) && alive) { const w = weekStart(k); if ((used[w] || 0) < 2) used[w] = (used[w] || 0) + 1; else { alive = false; count = 0; } }
    }
    if (written.size) assert.equal(replayStreak([...written]).best, book.data.streak.best, 'replaying the days gives the same streak');
  }
});

test('the weekly view’s goal streak has the same two rest days a week', () => {
  const now = clock('2026-10-05T09:00:00');
  const book = new StatsBook(null, now);
  const put = (k, n) => book.apply([{ doc: 'x', n, t: noon(k).getTime() }]);
  put('2026-10-05', 600); put('2026-10-06', 100); put('2026-10-07', 700); put('2026-10-08', 50); put('2026-10-09', 900);
  now.set(noon('2026-10-09'));
  assert.equal(book.summary({ daily: 500 }).streak, 3, 'Tue and Thu short of the goal: spared');
  now.set(noon('2026-10-11'));
  assert.equal(book.summary({ daily: 500 }).streak, 0, 'Saturday short too: the third that week');
});
