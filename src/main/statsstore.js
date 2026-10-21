// The authoritative copy of the writing statistics, kept in
// <userData>/stats.json (%APPDATA%\STET on Windows). That folder belongs to
// the user, not to any build: replacing or rebuilding STET.exe, or installing
// a newer version, never touches it.
//
// Safety:
//  * every write is atomic (temp file, fsync, verify, rename);
//  * the last good file is copied to stats.bak.json once a day, before an
//    upgrade from an older format, and the whole ledger is archived to
//    stats-before-reset-<time>.json before a confirmed reset;
//  * an unreadable file is never overwritten silently: it is kept as
//    stats.json.corrupt-<time>, the backup is used instead, and the window is
//    told what happened;
//  * a file written by a newer STET is left untouched (read-only mode) rather
//    than being downgraded.
//
// The window sends credits in numbered batches; a batch already booked is
// acknowledged without being booked again, so a retried send can't double-count.

import fs from 'node:fs/promises';
import { readFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './files.js';
import { StatsBook, upgradeStats, dayKey, FutureStatsError, isProbePath } from '../core/stats.js';

const parse = (buf) => {
  const v = JSON.parse(buf.toString('utf8'));
  if (!v || typeof v !== 'object') throw new Error('not a statistics object');
  return v;
};

export class StatsStore {
  constructor(dir, now = () => new Date()) {
    this.file = path.join(dir, 'stats.json');
    this.bak = path.join(dir, 'stats.bak.json');
    this.dir = dir;
    this.now = now;
    this.notice = null;     // something the writer should know about (shown in the weekly view)
    this.readOnly = false;
    this.seen = new Set();  // batch ids already booked
    this.timer = null;
    this.writing = Promise.resolve();
    this.lastBackupDay = null;
    this.dirty = false;
    this.book = new StatsBook(null, now);
    this._load();
  }

  _read(file) { return parse(readFileSync(file)); }

  _load() {
    let raw = null;
    if (existsSync(this.file)) {
      try { raw = this._read(this.file); } catch (e) {
        const keep = `${this.file}.corrupt-${Date.now()}`;
        try { renameSync(this.file, keep); } catch {}
        try {
          raw = this._read(this.bak);
          this.notice = `The statistics file could not be read, so the most recent backup was used. The unreadable file was kept as ${path.basename(keep)}.`;
        } catch {
          this.notice = `The statistics file could not be read and no usable backup was found. It was kept as ${path.basename(keep)}; recording continues from now.`;
          raw = null;
        }
        this.dirty = true;
      }
    } else if (existsSync(this.bak)) {
      try { raw = this._read(this.bak); this.notice = 'The statistics file was missing, so the most recent backup was used.'; this.dirty = true; } catch {}
    }
    try {
      const { data, migrated } = upgradeStats(raw, this.now());
      this.book = new StatsBook(data, this.now);
      if (migrated && raw) {
        // Keep the old-format file before the first rewrite.
        const v1 = path.join(this.dir, 'stats-v1.json');
        try { if (!existsSync(v1)) copyFileSync(this.file, v1); } catch {}
        this.dirty = true;
      }
    } catch (e) {
      if (!(e instanceof FutureStatsError)) throw e;
      this.readOnly = true;
      this.notice = `${e.message} This version can't add to them without risking them, so writing isn't being recorded. Your statistics are untouched — use the newest STET.`;
      this.book = new StatsBook(null, this.now);
    }
    // Words the performance probe once booked (before 0.19.1) are taken out, with the file as it
    // was kept beside it first.
    if (!this.readOnly && this.book.data.docs && Object.values(this.book.data.docs).some((d) => isProbePath(d.path))) {
      const keep = path.join(this.dir, `stats-before-probe-cleanup-${this.now().toISOString().replace(/[:.]/g, '-')}.json`);
      try { if (existsSync(this.file)) copyFileSync(this.file, keep); } catch {}
      if (this.book.purgeProbe()) this.dirty = true;
    }
    if (this.dirty) this.schedule(0);
  }

  get data() { return this.book.data; }

  state() { return { data: this.book.data, notice: this.notice, readOnly: this.readOnly }; }

  /** Book a batch of credits from the window. Idempotent per batch id. */
  add(batch) {
    if (this.readOnly) return { ok: false, readOnly: true };
    if (!batch || !batch.id) return { ok: false };
    if (this.seen.has(batch.id)) return { ok: true, duplicate: true };
    this.seen.add(batch.id);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    const before = JSON.stringify(this.book.data.streak);
    const net = this.book.apply(batch.entries, batch.meta, batch.goal);
    if (net || batch.meta || JSON.stringify(this.book.data.streak) !== before) this.schedule();
    return { ok: true, net };
  }

  /** The confirmed Reset: archive, clear, save. Throws (data unchanged) if any step fails. */
  async reset() {
    if (this.readOnly) throw new Error('These statistics belong to a newer version of STET and are read-only here.');
    await this.flush();
    const before = structuredClone(this.book.data);
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const archive = path.join(this.dir, `stats-before-reset-${stamp}.json`);
    await atomicWrite(archive, Buffer.from(JSON.stringify(before, null, 1)), { verify: parse });
    this.book.reset();
    try {
      await this._write();
    } catch (e) {
      this.book.data = before;
      throw e;
    }
    this.notice = null;
    return { data: this.book.data, archive };
  }

  schedule(delay = 400) {
    if (this.readOnly) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.readOnly) return this.writing;
    this.writing = this.writing.then(() => this._write()).catch((e) => console.error('stats write failed', e));
    return this.writing;
  }

  async _write() {
    const today = dayKey(this.now());
    if (this.lastBackupDay !== today && existsSync(this.file)) {
      // Daily safety copy of the last good file.
      try { parse(await fs.readFile(this.file)); await fs.copyFile(this.file, this.bak); this.lastBackupDay = today; } catch {}
    }
    await atomicWrite(this.file, Buffer.from(JSON.stringify(this.book.data, null, 1)), { verify: parse });
  }
}

