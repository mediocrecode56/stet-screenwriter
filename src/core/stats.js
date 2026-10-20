// Writing statistics: a ledger of words actually written, across every
// screenplay, kept for good.
//
// What counts as writing is decided by the editor (see "writing activity" in
// src/core/editor.js): it turns each edit into a credit of words the writer
// added — never a document's existing words, never pastes, never undo/redo
// replays. This module only books those credits:
//
//   entry { doc, n, t }   n words (negative: an undone or rephrased credit)
//                         written in document `doc` at time t (ms)
//
// into per-day, per-document and all-time totals. The same pure code runs in
// the main process (the authoritative copy, saved to <userData>/stats.json)
// and in the window (an instant mirror for the status bar), so both always
// agree. Nothing here ever resets on its own: only reset(), which the app
// calls after the writer clicks Reset and confirms.
//
// Data (version 2):
//   { version: 2,
//     start: ISO time recording began (first run, migration or last reset),
//     since: day key of `start`        — days before it have no data
//     total: words written since start (all screenplays),
//     days:  { 'YYYY-MM-DD': { w, docs: { [docId]: words } } },
//     docs:  { [docId]: { w, title, path, first, last, from? } },
//     resets: [{ at, total }],          — when the writer reset, and what was cleared
//     migrated?: { from: 1, at } }
// Invariant: total = Σ days[*].w = Σ docs[*].w, and days[k].w = Σ days[k].docs.

export const STATS_VERSION = 2;
const UNKNOWN_DOC = '(earlier)'; // per-document detail the old format had already dropped

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
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}

export function emptyStats(now = new Date()) {
  return { version: STATS_VERSION, start: now.toISOString(), since: dayKey(now), total: 0, days: {}, docs: {}, resets: [] };
}

export class FutureStatsError extends Error {
  constructor(v) { super(`These statistics were saved by a newer version of STET (format ${v}).`); this.version = v; }
}

/**
 * Bring stored data of any known format to the current one. Never loses
 * recorded words: version-1 day totals and per-document detail are carried
 * over as they were measured. Returns { data, migrated }.
 * Throws FutureStatsError for a format newer than this build understands —
 * the caller must then leave the file alone.
 */
export function upgradeStats(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') return { data: emptyStats(now), migrated: false };
  if (typeof raw.version === 'number' && raw.version > STATS_VERSION) throw new FutureStatsError(raw.version);
  if (raw.version === STATS_VERSION) return { data: repair(raw, now), migrated: false };
  // Version 1 (STET ≤ 0.6): { days: { k: { w, docs: { id: { base, peak } } } } }.
  const out = emptyStats(now);
  const keys = Object.keys(raw.days || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  for (const k of keys) {
    const d = raw.days[k] || {};
    const docs = {};
    let sum = 0;
    for (const [id, e] of Object.entries(d.docs || {})) {
      const n = Math.max(0, Math.round((e && e.peak) - (e && e.base)) || 0);
      if (n) { docs[id] = n; sum += n; }
    }
    const w = Math.max(sum, Math.round(+d.w) || 0);
    if (w > sum) docs[UNKNOWN_DOC] = (docs[UNKNOWN_DOC] || 0) + w - sum;
    if (!w) continue;
    out.days[k] = { w, docs };
    for (const [id, n] of Object.entries(docs)) {
      const m = out.docs[id] || (out.docs[id] = { w: 0, title: id === UNKNOWN_DOC ? 'Earlier screenplays' : '', path: null, first: k, last: k });
      m.w += n; m.last = k;
    }
    out.total += w;
  }
  if (keys.length) {
    out.since = keys[0];
    out.start = parseDay(keys[0]).toISOString();
  }
  out.migrated = { from: 1, at: now.toISOString() };
  return { data: out, migrated: true };
}

/** Make version-2 data internally consistent (recompute totals from the per-day detail). */
function repair(raw, now) {
  const out = { ...emptyStats(now), ...raw, days: {}, docs: {}, total: 0 };
  if (!Array.isArray(out.resets)) out.resets = [];
  if (typeof out.since !== 'string') out.since = dayKey(now);
  if (typeof out.start !== 'string') out.start = parseDay(out.since).toISOString();
  for (const [k, d] of Object.entries(raw.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !d) continue;
    const docs = {};
    let w = 0;
    for (const [id, n] of Object.entries(d.docs || {})) { const v = Math.max(0, Math.round(+n) || 0); if (v) { docs[id] = v; w += v; } }
    if (!w) continue;
    out.days[k] = { w, docs };
    out.total += w;
    for (const [id, n] of Object.entries(docs)) {
      const prev = raw.docs && raw.docs[id];
      const m = out.docs[id] || (out.docs[id] = { title: '', path: null, ...(prev || {}), w: 0, first: k, last: k });
      m.w += n;
      if (k < m.first) m.first = k;
      if (k > m.last) m.last = k;
    }
  }
  return out;
}

export class StatsBook {
  constructor(data, now = () => new Date()) {
    this.now = now;
    this.data = upgradeStats(data, now()).data;
  }

  get startMs() { return Date.parse(this.data.start) || 0; }

  /**
   * Book credits. `meta` = { [docId]: { title, path, from } } refreshes the
   * documents' names. Returns the net words actually booked (credits from
   * before the last reset are ignored; a negative credit never takes a
   * document's day below zero).
   */
  apply(entries, meta = {}) {
    let net = 0;
    for (const e of entries || []) {
      const n = Math.round(+e.n) || 0;
      const t = +e.t || 0;
      if (!n || !e.doc || t < this.startMs) continue;
      const k = dayKey(new Date(t));
      let day = this.data.days[k];
      if (n > 0) {
        if (!day) day = this.data.days[k] = { w: 0, docs: {} };
        day.docs[e.doc] = (day.docs[e.doc] || 0) + n;
        day.w += n;
        const m = this._doc(e.doc, k);
        m.w += n;
        this.data.total += n;
        net += n;
      } else {
        const have = day ? day.docs[e.doc] || 0 : 0;
        const take = Math.min(-n, have);
        if (!take) continue;
        day.docs[e.doc] = have - take;
        if (!day.docs[e.doc]) delete day.docs[e.doc];
        day.w -= take;
        if (!day.w) delete this.data.days[k];
        const m = this.data.docs[e.doc];
        if (m) m.w = Math.max(0, m.w - take);
        this.data.total -= take;
        net -= take;
      }
    }
    for (const [id, info] of Object.entries(meta || {})) {
      if (!info) continue;
      const m = this.data.docs[id];
      if (!m) continue;
      if (info.title) m.title = String(info.title).slice(0, 200);
      if (info.path !== undefined) m.path = info.path;
      if (info.from && !m.from) m.from = info.from;
    }
    return net;
  }

  _doc(id, k) {
    let m = this.data.docs[id];
    if (!m) m = this.data.docs[id] = { w: 0, title: '', path: null, first: k, last: k };
    if (k < m.first) m.first = k;
    if (k > m.last) m.last = k;
    return m;
  }

  wordsOn(k) { const d = this.data.days[k]; return d ? d.w : 0; }

  /** Whether day k has data (on or after the day recording began, and not in the future). */
  known(k, today = dayKey(this.now())) { return k >= this.data.since && k <= today; }

  /**
   * Everything the weekly view and the status bar show.
   * weekOffset 0 = this week, -1 = last week, …
   */
  summary(goals = {}, weekOffset = 0) {
    const today = dayKey(this.now());
    const daily = Math.max(0, +goals.daily || 0), weekly = Math.max(0, +goals.weekly || 0);
    const start = addDays(weekStart(today), 7 * Math.min(0, weekOffset | 0));
    const days = [];
    let total = 0, active = 0, met = 0, best = null;
    for (let i = 0; i < 7; i++) {
      const k = addDays(start, i);
      const future = k > today;
      const known = this.known(k, today);
      const words = known ? this.wordsOn(k) : 0;
      total += words;
      if (words > 0) active++;
      if (daily && words >= daily) met++;
      if (known && words > 0 && (!best || words > best.words)) best = { day: k, words };
      days.push({ day: k, words, known, future, today: k === today, metGoal: !!daily && words >= daily });
    }
    const byDoc = {};
    for (const d of days) {
      const rec = d.known && this.data.days[d.day];
      if (rec) for (const [id, n] of Object.entries(rec.docs)) byDoc[id] = (byDoc[id] || 0) + n;
    }
    const docs = Object.entries(byDoc).map(([id, words]) => ({ id, words, title: this.title(id) })).sort((a, b) => b.words - a.words);
    // Streak: consecutive days up to today reaching the daily goal (any writing when there is none);
    // today only extends it once reached, so an unfinished today never breaks it.
    const hit = (k) => (daily ? this.wordsOn(k) >= daily : this.wordsOn(k) > 0);
    let streak = 0;
    for (let k = hit(today) ? today : addDays(today, -1); k >= this.data.since && hit(k); k = addDays(k, -1)) streak++;
    return {
      today: { day: today, words: this.wordsOn(today) },
      goals: { daily, weekly },
      week: { start, end: addDays(start, 6), offset: Math.min(0, weekOffset | 0), days, total, active, met, best, docs, current: start === weekStart(today) },
      hasEarlier: start > weekStart(this.data.since),
      streak,
      total: this.data.total,
      since: this.data.since,
      documents: Object.keys(this.data.docs).length,
    };
  }

  title(id) {
    const m = this.data.docs[id];
    if (m && m.title) return m.title;
    if (m && m.path) return m.path.split(/[\\/]/).pop().replace(/\.stet$/i, '');
    return 'Untitled screenplay';
  }

  /** All-time words per project — the folder a screenplay is saved in ('' = never saved). */
  byProject() {
    const out = {};
    for (const m of Object.values(this.data.docs)) {
      const dir = m.path ? m.path.replace(/[\\/][^\\/]*$/, '') : '';
      out[dir] = (out[dir] || 0) + m.w;
    }
    return out;
  }

  /** Clear all recorded writing (the confirmed Reset). Goals and screenplays are untouched. */
  reset() {
    const now = this.now();
    const resets = [...(this.data.resets || []), { at: now.toISOString(), total: this.data.total }];
    this.data = { ...emptyStats(now), resets };
    return this.data;
  }
}
