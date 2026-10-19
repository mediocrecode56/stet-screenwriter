// Writing progress. Progress is *net new words*, measured per document per
// day as a high-water mark above the day's starting word count:
//
//   written(doc, day) = max(0, peak - base)
//
// where base is the word count when the document was first touched that day
// (plus anything pasted in), and peak the highest count reached. Undo/redo
// churn, autosaves, formatting and re-typing deleted text never inflate it.

export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDay(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(k, n) {
  const d = parseDay(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Monday of the week containing day k. */
export function weekStart(k) {
  const d = parseDay(k);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return dayKey(d);
}

export class Tracker {
  constructor(data, now = () => new Date()) {
    this.data = data && data.days ? data : { days: {} };
    this.now = now;
    this.changed = false;
  }

  _day(k) {
    let d = this.data.days[k];
    if (!d) { d = this.data.days[k] = { w: 0, docs: {} }; this.changed = true; }
    return d;
  }

  /** Register the current word count of a document (on open or after reload). */
  begin(docId, words) {
    const day = this._day(dayKey(this.now()));
    if (!day.docs[docId]) { day.docs[docId] = { base: words, peak: words }; this.changed = true; }
  }

  /** Record the current word count. `pasted` = words pasted since last call. */
  update(docId, words, pasted = 0) {
    const day = this._day(dayKey(this.now()));
    let e = day.docs[docId];
    if (!e) e = day.docs[docId] = { base: words - pasted, peak: words - pasted };
    if (pasted) { e.base += pasted; e.peak = Math.max(e.peak, e.base); }
    if (words > e.peak) e.peak = words;
    let w = 0;
    for (const x of Object.values(day.docs)) w += Math.max(0, x.peak - x.base);
    if (w !== day.w) { day.w = w; this.changed = true; }
  }

  /** Re-base a document (e.g. after restoring a backup) without changing today's total. */
  rebase(docId, words) {
    const day = this._day(dayKey(this.now()));
    const e = day.docs[docId];
    if (!e) return this.begin(docId, words);
    const earned = Math.max(0, e.peak - e.base);
    e.base = words - earned;
    e.peak = words;
    this.changed = true;
  }

  wordsOn(k) { return this.data.days[k] ? this.data.days[k].w : 0; }

  summary(goals, days = 28) {
    const today = dayKey(this.now());
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const k = addDays(today, -i); series.push({ day: k, words: this.wordsOn(k) }); }
    const ws = weekStart(today);
    let week = 0;
    for (let k = ws; k <= today; k = addDays(k, 1)) week += this.wordsOn(k);
    const dayIndex = Math.round((parseDay(today) - parseDay(ws)) / 86400000); // 0 = Monday
    const keys = Object.keys(this.data.days).sort();
    const first = keys[0] || today;
    const spanDays = Math.max(1, Math.min(30, Math.round((parseDay(today) - parseDay(first)) / 86400000) + 1));
    let last30 = 0;
    for (let i = 0; i < spanDays; i++) last30 += this.wordsOn(addDays(today, -i));
    // Weekly average over up to 8 weeks that have data, current week included.
    const weeks = [];
    for (let i = 0; i < 8; i++) {
      const s = addDays(ws, -7 * i);
      if (s < weekStart(first)) break;
      let t = 0;
      for (let d = 0; d < 7; d++) t += this.wordsOn(addDays(s, d));
      weeks.push(t);
    }
    const todayWords = this.wordsOn(today);
    const goal = goals.daily || 0;
    let streak = 0;
    let k = todayWords >= goal && goal > 0 ? today : addDays(today, -1);
    while (goal > 0 && this.wordsOn(k) >= goal) { streak++; k = addDays(k, -1); }
    let best = 0, run = 0;
    for (const key of keys) {
      // walk calendar days between recorded keys
      if (goal > 0 && this.wordsOn(key) >= goal) {
        const prev = addDays(key, -1);
        run = this.wordsOn(prev) >= goal ? run + 1 : 1;
        best = Math.max(best, run);
      }
    }
    const weekExpected = Math.round((goals.weekly || 0) * (dayIndex + 1) / 7);
    return {
      today: todayWords,
      week,
      dayIndex,
      dailyGoal: goal,
      weeklyGoal: goals.weekly || 0,
      dailyAvg: Math.round(last30 / spanDays),
      weeklyAvg: weeks.length ? Math.round(weeks.reduce((a, b) => a + b, 0) / weeks.length) : 0,
      streak,
      bestStreak: Math.max(best, streak),
      todayDelta: todayWords - goal,
      weekDelta: week - weekExpected,
      weekExpected,
      series,
    };
  }

  /** Drop per-document detail older than `keepDays` (totals are kept forever). */
  compact(keepDays = 60) {
    const cutoff = addDays(dayKey(this.now()), -keepDays);
    for (const [k, d] of Object.entries(this.data.days)) {
      if (k < cutoff && d.docs && Object.keys(d.docs).length) { d.docs = {}; this.changed = true; }
    }
  }
}
