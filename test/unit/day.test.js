// The day the statistics and the streak count by: the computer's own calendar day (core/stats.js,
// "the day"), taken from the operating system where it can be asked (main/osclock.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, weekStart, msToNextDay, setDayOffset, getDayOffset, StatsBook } from '../../src/core/stats.js';
import { parseActiveBias, systemUtcOffset } from '../../src/main/osclock.js';

test('with the system’s offset the day turns at the system’s midnight, whatever this runtime thinks the zone is', (t) => {
  t.after(() => setDayOffset(null));
  // 22:30 UTC on the 12th. The computer is at UTC+1: 23:30, still the 12th.
  const at = new Date(Date.UTC(2026, 10, 12, 22, 30));
  assert.equal(setDayOffset(60), true);
  assert.equal(setDayOffset(60), false, 'unchanged: nothing to redraw');
  assert.equal(getDayOffset(), 60);
  assert.equal(dayKey(at), '2026-11-12');
  assert.equal(msToNextDay(at), 30 * 60000, 'half an hour to midnight');
  assert.equal(dayKey(new Date(at.getTime() + 30 * 60000)), '2026-11-13', 'midnight itself is the next day');
  // A runtime that believed in summer time (UTC+2) would have turned the day an hour early.
  setDayOffset(120);
  assert.equal(dayKey(at), '2026-11-13');
  setDayOffset(-300);
  assert.equal(dayKey(at), '2026-11-12');
  assert.equal(dayKey(new Date(Date.UTC(2026, 10, 12, 3, 0))), '2026-11-11', 'west of UTC: still the evening before');
});

test('without one, the runtime’s local time stands; a nonsense offset is refused', (t) => {
  t.after(() => setDayOffset(null));
  setDayOffset(60);
  setDayOffset(NaN);
  assert.equal(getDayOffset(), null);
  setDayOffset(5000);
  assert.equal(getDayOffset(), null);
  const d = new Date(2026, 10, 12, 23, 59);
  assert.equal(dayKey(d), '2026-11-12');
  assert.equal(msToNextDay(d), 60000);
});

test('days are counted on the calendar alone: across months, years, leap days and clock changes', () => {
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26', 'a 25-hour day (clocks back in Europe) is still one day');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30', 'and a 23-hour one');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-11-12', -12), '2026-10-31');
  assert.equal(weekStart('2026-11-12'), '2026-11-09', 'a Thursday: its Monday');
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09', 'Sunday ends the week');
  assert.equal(weekStart('2026-10-26'), '2026-10-26', 'the Monday after the clocks went back');
});

test('the streak and today follow the system’s day: 11 pm is still today', (t) => {
  t.after(() => setDayOffset(null));
  setDayOffset(60);
  const data = { version: 2, start: '2026-10-20T09:00:00.000Z', since: '2026-10-20', total: 1463, resets: [], docs: { a: { w: 1463, title: 'A', path: null, first: '2026-11-09', last: '2026-11-11' } },
    days: { '2026-11-09': { w: 791, docs: { a: 791 }, g: 600 }, '2026-11-11': { w: 672, docs: { a: 672 }, g: 600 } },
    streak: { last: '2026-11-11', count: 2, best: 2, spared: ['2026-11-10'], prev: null, rule: 'goal' } };
  let now = new Date(Date.UTC(2026, 10, 12, 22, 5)); // 23:05 on the computer's clock
  const book = new StatsBook(structuredClone(data), () => now);
  book.setGoal(600);
  let s = book.summary({ daily: 600 });
  assert.deepEqual([s.today.day, s.writing.days, s.writing.rest.left], ['2026-11-12', 2, 1], 'still the 12th: its rest day not spent yet');
  book.apply([{ doc: 'a', n: 600, t: now.getTime() }], {}, 600);
  s = book.summary({ daily: 600 });
  assert.deepEqual([s.today.words, s.writing.days, s.writing.today], [600, 3, true], 'words written at 11 pm count for the 12th');
  now = new Date(Date.UTC(2026, 10, 12, 23, 0, 1)); // a second past midnight there
  s = book.summary({ daily: 600 });
  assert.deepEqual([s.today.day, s.today.words, s.writing.days], ['2026-11-13', 0, 3]);
});

test('Windows says how far its clock is from UTC; anything unreadable leaves the runtime’s own', async () => {
  assert.equal(parseActiveBias('\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation\r\n    ActiveTimeBias    REG_DWORD    0xffffffc4\r\n'), 60, 'Madrid in winter');
  assert.equal(parseActiveBias('    ActiveTimeBias    REG_DWORD    0xffffff88'), 120, 'and in summer');
  assert.equal(parseActiveBias('    ActiveTimeBias    REG_DWORD    0x12c'), -300, 'New York');
  assert.equal(parseActiveBias('    ActiveTimeBias    REG_DWORD    0x0'), 0);
  assert.equal(parseActiveBias('ERROR: The system was unable to find the specified registry key or value.'), null);
  assert.equal(parseActiveBias('    ActiveTimeBias    REG_DWORD    0x7fffffff'), null, 'not an offset');
  assert.equal(await systemUtcOffset({ platform: 'darwin' }), null, 'a Mac: its local time is the system’s already');
  const calls = [];
  const run = (exe, args, opts, cb) => { calls.push([exe, args]); cb(null, '    ActiveTimeBias    REG_DWORD    0xffffffc4'); };
  assert.equal(await systemUtcOffset({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, run }), 60);
  assert.match(calls[0][0], /System32[\\/]reg\.exe$/);
  assert.deepEqual(calls[0][1].slice(-2), ['/v', 'ActiveTimeBias']);
  assert.equal(await systemUtcOffset({ platform: 'win32', env: {}, run: (e, a, o, cb) => cb(new Error('no')) }), null);
  assert.equal(await systemUtcOffset({ platform: 'win32', env: {}, run: () => { throw new Error('cannot start'); } }), null);
});
