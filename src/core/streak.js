// The writing streak: calendar days (local time, the same day boundary as
// every other statistic) on which the writer wrote at least one new word, and
// what it earns the dinosaur.
//
// Stored with the statistics (stats.json → streak), never derived from a
// document: opening, importing or pasting text books no credits, so it can
// never count as writing. A day is booked once however many screenplays are
// written in or however often the app restarts; a word written and then
// undone the same day unbooks it again.
//
// Rest days: up to two days a week (Monday to Sunday, local time: the weeks
// of the weekly view) may go by without writing and the streak carries on,
// whether the two are next to each other or days apart. The allowance belongs
// to the week, not to the streak: writing again doesn't give it back, and
// each new week brings two more. A rest day is spent on the day it carries the
// streak over (so a streak that breaks later that week has still spent it,
// and the next one doesn't get it again); a day is never spent twice, and a
// day missed once the streak has broken spends nothing.
//
//   { last: 'YYYY-MM-DD' | null,   the latest day written on
//     count: n,                    days written in the streak ending on `last`
//     best: n,                     the longest streak so far
//     spared: ['YYYY-MM-DD', …]    rest days spent (only those from the week of `last` on are kept)
//     prev: { last, count, spared } | null  the streak before `last` was booked (to unbook it) }
//
// The current streak is `count` while every day between `last` and today
// (today isn't over yet) can be spared, and 0 once one can't.
//
// Growth: one pixel at each milestone — 1, 2, 4, 8, 16 and 32 days — so at
// most six. A special loop animation is unlocked at every second milestone
// (the 2nd, 4th and 6th: 2, 8 and 32 days). Both follow the current streak,
// so when it breaks the dinosaur is back to its first size.

import { addDays, weekStart } from './stats.js';

export const MILESTONES = [1, 2, 4, 8, 16, 32];
export const REST_DAYS = 2; // days a week without writing that don't break the streak

export function emptyStreak() { return { last: null, count: 0, best: 0, spared: [], prev: null }; }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (k) => (typeof k === 'string' && DAY.test(k) ? k : null);
const dayList = (a) => (Array.isArray(a) ? [...new Set(a.filter(day))].sort() : []);

/** A valid streak record, or null. Records from before rest days simply have none spent. */
export function cleanStreak(s) {
  if (!s || typeof s !== 'object') return null;
  const n = (v) => Math.max(0, Math.round(+v) || 0);
  const last = day(s.last);
  const count = last ? Math.max(1, n(s.count)) : 0;
  const prev = s.prev && typeof s.prev === 'object' ? { last: day(s.prev.last), count: day(s.prev.last) ? n(s.prev.count) : 0, spared: dayList(s.prev.spared) } : null;
  const spared = last ? dayList(s.spared).filter((k) => k < last) : [];
  return { last, count, best: Math.max(count, n(s.best)), spared, prev };
}

/**
 * The days missed after `last` and before `upto`, taken one by one: those
 * spared (`spent`, while their week has rest days left) and whether the
 * streak got all the way through (`ok`). Pure: nothing is spent until
 * bookDay() books the next day written.
 */
export function spareGap(spared = [], last, upto) {
  const used = {};
  for (const k of spared) { const w = weekStart(k); used[w] = (used[w] || 0) + 1; }
  const spent = [];
  // Any three missed days in a row overflow some week, so this ends within a few days.
  for (let k = addDays(last, 1); k < upto; k = addDays(k, 1)) {
    if (spared.includes(k)) continue; // already spent: never counted twice
    const w = weekStart(k);
    if ((used[w] || 0) >= REST_DAYS) return { spent, ok: false }; // broken: later days off spend nothing
    used[w] = (used[w] || 0) + 1;
    spent.push(k);
  }
  return { spent, ok: true };
}

/** Rest days spent in the week of `today`: those already booked, and the ones the gap up to today takes. */
export function restUsed(s, today) {
  if (!s || !s.last) return 0;
  const w = weekStart(today);
  const gap = s.last < today ? spareGap(s.spared, s.last, today).spent : [];
  return [...(s.spared || []), ...gap].filter((k) => weekStart(k) === w).length;
}

/** The streak booked by writing on these days, one by one in order, rest days included. */
export function replayStreak(keys) {
  const s = emptyStreak();
  for (const k of [...keys].sort()) bookDay(s, k);
  return s;
}

/** The streak as the per-day word totals show it (for statistics saved before streaks existed). */
export function streakFromDays(days, today) {
  const s = replayStreak(Object.keys(days).filter((k) => k <= today && days[k] && days[k].w > 0));
  s.prev = null;
  return s;
}

/** Book day k (the writer wrote a new word on it). Returns true when the streak changed. */
export function bookDay(s, k) {
  if (s.last === k || (s.last && k < s.last)) return false; // once a day; a late credit for an earlier day changes nothing
  const spared = s.spared || [];
  s.prev = { last: s.last, count: s.count, spared: [...spared] };
  const gap = s.last ? spareGap(spared, s.last, k) : { spent: [], ok: false };
  s.count = gap.ok ? s.count + 1 : 1;
  // Only rest days that can still matter are kept: any gap from now on starts after k.
  const from = weekStart(k);
  s.spared = [...spared, ...gap.spent].filter((d) => d >= from);
  s.last = k;
  s.best = Math.max(s.best, s.count);
  return true;
}

/** Day k no longer has any writing (the day's words were all undone): take it back. */
export function unbookDay(s, k) {
  if (s.last !== k || !s.prev) return false;
  s.last = s.prev.last;
  s.count = s.prev.count;
  s.spared = s.prev.spared || [];
  s.prev = null;
  return true;
}

/** The current streak on `today`: 0 once a day has gone by without writing that no rest day covers. */
export function currentStreak(s, today) {
  if (!s || !s.last) return 0;
  if (s.last >= today) return s.count;
  return spareGap(s.spared, s.last, today).ok ? s.count : 0;
}

/** Pixels of growth earned by a streak of n days (0–6). */
export function growthFor(n) { return MILESTONES.filter((m) => n >= m).length; }

/** Special loops unlocked by that growth: one per two milestones (0–3). */
export function unlocksFor(growth) { return Math.floor(growth / 2); }

/** The next milestone after n days, or null past the last one. */
export function nextMilestone(n) { return MILESTONES.find((m) => m > n) ?? null; }
