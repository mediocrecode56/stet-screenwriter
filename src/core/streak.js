// The writing streak: consecutive calendar days (local time, the same day
// boundary as every other statistic) on which the writer wrote at least one
// new word, and what it earns the dinosaur.
//
// Stored with the statistics (stats.json → streak), never derived from a
// document: opening, importing or pasting text books no credits, so it can
// never count as writing. A day is booked once however many screenplays are
// written in or however often the app restarts; a word written and then
// undone the same day unbooks it again.
//
//   { last: 'YYYY-MM-DD' | null,   the latest day written on
//     count: n,                    consecutive days ending on `last`
//     best: n,                     the longest streak so far
//     prev: { last, count } | null the streak before `last` was booked (to unbook it) }
//
// The current streak is `count` while `last` is today or yesterday (today
// isn't over yet), and 0 once a whole calendar day has passed without writing.
//
// Growth: one pixel at each milestone — 1, 2, 4, 8, 16 and 32 days in a row —
// so at most six. A special loop animation is unlocked at every second
// milestone (the 2nd, 4th and 6th: 2, 8 and 32 days). Both follow the current
// streak, so when it breaks the dinosaur is back to its first size.

import { addDays } from './stats.js';

export const MILESTONES = [1, 2, 4, 8, 16, 32];

export function emptyStreak() { return { last: null, count: 0, best: 0, prev: null }; }

/** A valid streak record, or null. */
export function cleanStreak(s) {
  if (!s || typeof s !== 'object') return null;
  const day = (k) => (typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null);
  const n = (v) => Math.max(0, Math.round(+v) || 0);
  const last = day(s.last);
  const count = last ? Math.max(1, n(s.count)) : 0;
  const prev = s.prev && typeof s.prev === 'object' ? { last: day(s.prev.last), count: day(s.prev.last) ? n(s.prev.count) : 0 } : null;
  return { last, count, best: Math.max(count, n(s.best)), prev };
}

/** The streak as the per-day word totals show it (for statistics saved before streaks existed). */
export function streakFromDays(days, today) {
  const wrote = (k) => !!(days[k] && days[k].w > 0);
  const keys = Object.keys(days).filter((k) => k <= today && wrote(k)).sort();
  if (!keys.length) return emptyStreak();
  const last = keys[keys.length - 1];
  let count = 0;
  for (let k = last; wrote(k); k = addDays(k, -1)) count++;
  let best = 0, run = 0, prevKey = null;
  for (const k of keys) { run = prevKey && addDays(prevKey, 1) === k ? run + 1 : 1; best = Math.max(best, run); prevKey = k; }
  return { last, count, best, prev: null };
}

/** Book day k (the writer wrote a new word on it). Returns true when the streak changed. */
export function bookDay(s, k) {
  if (s.last === k || (s.last && k < s.last)) return false; // once a day; a late credit for an earlier day changes nothing
  s.prev = { last: s.last, count: s.count };
  s.count = s.last && addDays(s.last, 1) === k ? s.count + 1 : 1;
  s.last = k;
  s.best = Math.max(s.best, s.count);
  return true;
}

/** Day k no longer has any writing (the day's words were all undone): take it back. */
export function unbookDay(s, k) {
  if (s.last !== k || !s.prev) return false;
  s.last = s.prev.last;
  s.count = s.prev.count;
  s.prev = null;
  return true;
}

/** The current streak on `today`: 0 once a full calendar day has gone by without writing. */
export function currentStreak(s, today) {
  if (!s || !s.last) return 0;
  return s.last === today || addDays(s.last, 1) === today ? s.count : 0;
}

/** Pixels of growth earned by a streak of n days (0–6). */
export function growthFor(n) { return MILESTONES.filter((m) => n >= m).length; }

/** Special loops unlocked by that growth: one per two milestones (0–3). */
export function unlocksFor(growth) { return Math.floor(growth / 2); }

/** The next milestone after n days, or null past the last one. */
export function nextMilestone(n) { return MILESTONES.find((m) => m > n) ?? null; }
