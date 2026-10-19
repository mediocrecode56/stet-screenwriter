import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, dayKey, weekStart, addDays } from '../src/core/stats.js';

function clock(start) {
  let t = new Date(start);
  const now = () => new Date(t);
  now.set = (d) => { t = new Date(d); };
  return now;
}

test('net new words, high-water mark: undo churn and deletes do not inflate', () => {
  const now = clock('2026-10-19T10:00:00');
  const tr = new Tracker({ days: {} }, now);
  tr.begin('d', 1000);
  tr.update('d', 1100);
  assert.equal(tr.wordsOn('2026-10-19'), 100);
  tr.update('d', 1050); // deleted 50
  tr.update('d', 1100); // retyped / redo
  assert.equal(tr.wordsOn('2026-10-19'), 100);
  tr.update('d', 1130);
  assert.equal(tr.wordsOn('2026-10-19'), 130);
});

test('pasted words are not counted as writing', () => {
  const tr = new Tracker({ days: {} }, clock('2026-10-19T10:00:00'));
  tr.begin('d', 0);
  tr.update('d', 500, 500);
  assert.equal(tr.wordsOn('2026-10-19'), 0);
  tr.update('d', 520);
  assert.equal(tr.wordsOn('2026-10-19'), 20);
});

test('documents are tracked separately and summed per day', () => {
  const tr = new Tracker({ days: {} }, clock('2026-10-19T10:00:00'));
  tr.begin('a', 10); tr.begin('b', 0);
  tr.update('a', 60); tr.update('b', 30);
  assert.equal(tr.wordsOn('2026-10-19'), 80);
});

test('day rollover starts a fresh baseline; streaks and weekly pace', () => {
  const now = clock('2026-10-12T09:00:00'); // Monday
  const tr = new Tracker({ days: {} }, now);
  let words = 0;
  for (let d = 0; d < 5; d++) {
    now.set(`2026-10-${12 + d}T09:00:00`);
    tr.begin('x', words);
    words += d === 2 ? 200 : 600;
    tr.update('x', words);
  }
  now.set('2026-10-16T20:00:00'); // Friday
  const s = tr.summary({ daily: 500, weekly: 3500 });
  assert.equal(s.today, 600);
  assert.equal(s.week, 2600);
  assert.equal(s.streak, 2, 'Thu+Fri met, Wed missed');
  assert.equal(s.bestStreak, 2);
  assert.equal(s.dayIndex, 4);
  assert.equal(s.weekExpected, 2500);
  assert.equal(s.weekDelta, 100);
  assert.equal(s.series.length, 28);
});

test('rebase keeps the words already earned today', () => {
  const tr = new Tracker({ days: {} }, clock('2026-10-19T10:00:00'));
  tr.begin('d', 100);
  tr.update('d', 300);
  tr.rebase('d', 50); // restored an older backup
  assert.equal(tr.wordsOn('2026-10-19'), 200);
  tr.update('d', 80);
  assert.equal(tr.wordsOn('2026-10-19'), 230);
});

test('date helpers', () => {
  assert.equal(weekStart('2026-10-19'), '2026-10-19'); // Monday
  assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});
