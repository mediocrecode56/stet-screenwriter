// Document session: owns the open document's persistence state.
//
// Revision model: `rev` = editor revision + metadata revision. Both only grow,
// so rev is monotonic. A save carries the rev it serialised; the main process
// refuses to write a rev older than one already written, and `savedRev` only
// moves forward — a slow save can never mark newer edits as saved.

import { serialize, deserialize } from '../core/serialize.js';
import { newDocument } from '../core/model.js';

const api = window.stet;

export class Session {
  constructor({ editor, onState, onLoaded, appVersion }) {
    this.editor = editor;
    this.onState = onState;     // UI refresh for save status
    this.onLoaded = onLoaded;   // a new document was loaded
    this.appVersion = appVersion;
    this.doc = null;
    this.path = null;
    this.metaRev = 0;
    this.savedRev = 0;
    this.status = 'saved';      // saved | dirty | saving | error | conflict
    this.error = null;
    this.lastSavedAt = null;
    this.autosave = true;
    this.autosaveDelay = 1200;
    this.timer = 0;
    this.saving = null;
    this.retryMs = 2000;
    this.lastBackupRev = -1;
    this.lastBackupAt = Date.now();
    this.recoveryRev = -1;
    this.ownsRecovery = false; // only clear recovery copies this session wrote or restored
    this.backupTimer = setInterval(() => this.maybeBackup(), 20000);
    this.lastSerializeMs = 0;
  }

  get rev() { return this.editor.rev + this.metaRev; }
  get dirty() { return this.rev !== this.savedRev; }
  get name() { return this.path ? this.path.split(/[\\/]/).pop().replace(/\.stet$/i, '') : 'Untitled'; }
  ref() { return { path: this.path, id: this.doc.meta.id, dir: this.doc.settings.backup.dir }; }

  /** Load a document object into the editor. */
  load(doc, path, { dirty = false } = {}) {
    clearTimeout(this.timer);
    this.doc = doc;
    this.path = path;
    this.editor.reset(doc.blocks);
    this.editor.autoCapitalize = doc.settings.autoCapitalize;
    this.metaRev = 0;
    this.savedRev = dirty ? -1 : this.rev;
    this.lastBackupRev = dirty ? -1 : this.rev;
    this.lastBackupAt = Date.now();
    this.recoveryRev = -1;
    this.ownsRecovery = dirty;
    this.status = dirty ? 'dirty' : 'saved';
    this.error = null;
    this.onLoaded(this);
    this.emit();
    if (dirty) this.changed();
  }

  newUntitled(title = '') {
    this.load(newDocument(title), null);
    api.invoke('settings:set', { lastOpen: null });
  }

  /** Mark a non-editor change (title page, settings, comment text). */
  touch() {
    this.metaRev++;
    this.changed();
  }

  /** Called after every document change. Debounces autosave / recovery. */
  changed() {
    if (!this.dirty) return;
    if (this.status !== 'saving' && this.status !== 'error' && this.status !== 'conflict') this.status = 'dirty';
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flushQuiet(), this.autosaveDelay);
  }

  emit() { if (this.onState) this.onState(this); }

  serialize() {
    const t0 = performance.now();
    this.doc.blocks = this.editor.blocks;
    this.doc.meta.modified = new Date().toISOString();
    const json = serialize(this.doc, this.appVersion);
    this.lastSerializeMs = performance.now() - t0;
    return json;
  }

  /** Autosave tick: save to the file if possible, otherwise to recovery. */
  async flushQuiet() {
    if (!this.dirty) return;
    if (this.path && this.autosave && this.status !== 'conflict') {
      const r = await this.writeFile();
      if (!r.ok) await this.writeRecovery();
    } else {
      await this.writeRecovery();
    }
  }

  async writeRecovery() {
    const rev = this.rev;
    if (rev === this.recoveryRev) return;
    const json = this.serialize();
    const r = await api.invoke('recovery:write', { id: this.doc.meta.id, info: { path: this.path, name: this.name, rev }, json });
    if (r.ok) { this.recoveryRev = rev; this.ownsRecovery = true; }
  }

  /** Remove this document's recovery copy, if this session is responsible for it. */
  clearRecovery() {
    if (!this.ownsRecovery || !this.doc) return Promise.resolve();
    this.ownsRecovery = false;
    return api.invoke('recovery:clear', this.doc.meta.id);
  }

  async writeFile({ force = false } = {}) {
    if (this.saving) { await this.saving; if (!this.dirty) return { ok: true }; }
    const rev = this.rev;
    const json = this.serialize();
    this.status = 'saving';
    this.emit();
    const p = api.invoke('doc:save', { path: this.path, rev, json, force });
    this.saving = p;
    let r;
    try { r = await p; } finally { this.saving = null; }
    if (r.ok) {
      if (rev > this.savedRev) this.savedRev = rev;
      this.lastSavedAt = new Date();
      this.error = null;
      this.retryMs = 2000;
      this.status = this.dirty ? 'dirty' : 'saved';
      if (!this.dirty) this.clearRecovery();
      else this.changed();
    } else if (r.conflict) {
      this.status = 'conflict';
      this.error = r.error;
    } else {
      this.status = 'error';
      this.error = r.error || 'Unknown error';
      // Keep trying in the background; the recovery copy covers us meanwhile.
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flushQuiet(), this.retryMs);
      this.retryMs = Math.min(60000, this.retryMs * 2);
    }
    this.emit();
    return r;
  }

  /** Explicit save to a known path. */
  async saveTo(path, { force = false } = {}) {
    const prev = this.path;
    this.path = path;
    if (prev !== path) { this.savedRev = -1; if (prev) api.invoke('doc:forget', prev); }
    const r = await this.writeFile({ force });
    if (r.ok) {
      api.invoke('settings:set', { lastOpen: path });
      if (prev !== path) this.lastBackupRev = -1;
    } else if (prev !== path && !r.conflict) {
      this.path = prev;
    }
    return r;
  }

  /** Make sure everything is on disk (before close / switching documents). */
  async flushAll() {
    clearTimeout(this.timer);
    if (this.saving) await this.saving;
    if (!this.dirty) return true;
    if (this.path) {
      const r = await this.writeFile();
      if (r.ok) return true;
    }
    await this.writeRecovery();
    return false;
  }

  // ---- backups -------------------------------------------------------------------

  async maybeBackup(force = false) {
    if (!this.doc) return;
    const b = this.doc.settings.backup;
    if (!b.enabled && !force) return;
    const rev = this.rev;
    if (rev === this.lastBackupRev && !force) return;
    if (!force && Date.now() - this.lastBackupAt < b.intervalMin * 60000) return;
    if (!this.path && this.editor.blocks.length === 1 && !this.editor.blocks[0].text) return; // nothing to protect
    const json = this.serialize();
    const r = await api.invoke('backup:create', { ...this.ref(), json });
    if (r.ok) {
      this.lastBackupRev = rev;
      this.lastBackupAt = Date.now();
      api.invoke('backup:prune', { ...this.ref(), retentionDays: b.retentionDays });
    }
    return r;
  }

  // ---- opening -------------------------------------------------------------------

  /** Read and parse a file. Returns { ok, doc, warnings } or { ok:false, error }. */
  static async readFile(path, channel = 'doc:read') {
    const r = await api.invoke(channel, path);
    if (!r.ok) return r;
    try {
      const { doc, warnings, migratedFrom } = deserialize(r.json);
      return { ok: true, doc, warnings, migratedFrom, mtimeMs: r.mtimeMs, raw: r.json };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code };
    }
  }
}
