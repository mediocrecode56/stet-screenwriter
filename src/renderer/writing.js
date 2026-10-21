// The window's side of the writing statistics: an instant local mirror of the
// ledger (so TODAY moves with every word) plus a reliable feed of credits to
// the main process, which owns the saved copy (src/main/statsstore.js).
//
// Credits are sent in numbered batches. A batch that fails to send is kept and
// re-sent with the same id, which the main process books at most once.

import { StatsBook, isProbePath } from '../core/stats.js';

export class WritingStats {
  constructor(api, state, { enabled = true } = {}) {
    this.api = api;
    this.enabled = enabled && !state.readOnly;
    this.notice = state.notice || null;
    this.readOnly = !!state.readOnly;
    this.book = new StatsBook(state.data);
    this.session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.seq = 0;
    this.queue = [];        // credits not yet in a batch
    this.meta = {};         // document names not yet sent
    this.info = {};         // docId → { title, path, from } as last described
    this.inflight = null;   // batch being sent (re-sent as-is after a failure)
    this.timer = 0;
    this.failures = 0;
    this.onChange = null;
    this.goal = null;       // the daily goal, sent with every batch so both copies count the same days
  }

  /** The daily goal now in force (the streak counts the days that reach it). */
  setGoal(goal) {
    goal = Math.max(0, Math.round(+goal) || 0);
    if (goal === this.goal) return;
    this.goal = goal;
    this.book.setGoal(goal);
    this.goalDirty = true;
    this.schedule();
  }

  /** Record a document's credits ([{ n, t }]). Returns the net words booked. */
  record(docId, credits) {
    if (!this.enabled || !credits.length || isProbePath(this.info[docId]?.path)) return 0;
    const entries = credits.map((c) => ({ doc: docId, n: c.n, t: c.t }));
    const first = !this.book.data.docs[docId];
    const net = this.book.apply(entries, {}, this.goal);
    this.queue.push(...entries);
    if (first && this.info[docId]) { this.meta[docId] = this.info[docId]; this.book.apply([], { [docId]: this.info[docId] }); }
    this.schedule();
    return net;
  }

  /** Name/location of a document, kept with its statistics (survives renames and moves via the document id). */
  describe(docId, info) {
    if (!this.enabled || !docId) return;
    this.info[docId] = { ...(this.info[docId] || {}), ...info };
    const cur = this.book.data.docs[docId];
    if (!cur) return; // sent with its first words
    if (cur.title === info.title && cur.path === info.path && (!info.from || cur.from)) return;
    this.meta[docId] = { ...(this.meta[docId] || {}), ...info };
    this.book.apply([], { [docId]: info });
    this.schedule();
  }

  // Credits go to the main process within a quarter of a second (about one
  // message per word), so even a crashed window loses at most that much.
  schedule(ms = 250) {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = 0; this.flush(); }, ms);
  }

  /** Send everything pending. Resolves true when the main process has it all. */
  async flush() {
    clearTimeout(this.timer);
    this.timer = 0;
    if (!this.enabled) return true;
    while (this.inflight || this.queue.length || Object.keys(this.meta).length || this.goalDirty) {
      if (!this.inflight) {
        this.inflight = { id: `${this.session}:${++this.seq}`, entries: this.queue, meta: this.meta, goal: this.goal };
        this.queue = [];
        this.meta = {};
        this.goalDirty = false;
      }
      let r;
      try { r = await this.api.invoke('stats:add', this.inflight); } catch (e) { r = { ok: false, error: e }; }
      if (r && r.ok) { this.inflight = null; this.failures = 0; continue; }
      if (r && r.readOnly) { this.enabled = false; this.readOnly = true; return false; }
      this.failures++;
      this.schedule(Math.min(30000, 1000 * 2 ** this.failures));
      return false;
    }
    return true;
  }

  summary(goals, weekOffset = 0) { return this.book.summary(goals, weekOffset); }

  /** The confirmed Reset. Resolves { ok, error }. The local view changes only after the saved copy did. */
  async reset() {
    const sent = await this.flush();
    if (!sent && !this.readOnly) return { ok: false, error: 'Recent writing could not be saved, so nothing was reset. Try again in a moment.' };
    let r;
    try { r = await this.api.invoke('stats:reset'); } catch (e) { r = { ok: false, error: e.message || String(e) }; }
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Unknown error.' };
    this.book = new StatsBook(r.data);
    this.notice = null;
    if (this.onChange) this.onChange();
    return { ok: true };
  }
}
