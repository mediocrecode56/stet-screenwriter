// Durable file operations: atomic writes, revision-guarded saves, backups,
// retention and crash recovery. Everything here is async and runs off the
// renderer, so the writing surface is never blocked by disk I/O.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { check, decode, encode } from './container.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Write `buf` to `target` atomically: temp file in the same directory, fsync,
 * read back and verify, then rename over the target. A crash at any point
 * leaves either the old file or the new one — never a partial file.
 */
export async function atomicWrite(target, buf, { verify = check } = {}) {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  let fh;
  try {
    fh = await fs.open(tmp, 'w');
    await fh.writeFile(buf);
    await fh.sync();
    await fh.close();
    fh = null;
    if (verify) verify(await fs.readFile(tmp));
    // Windows can briefly lock files (indexers, antivirus): retry the rename.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(tmp, target); break; } catch (e) {
        if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        await sleep(25 * (attempt + 1));
      }
    }
  } catch (e) {
    if (fh) await fh.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** Remove temp files left behind by an interrupted write: another process's (one that ended
 *  mid-write), never this one's, which are writes still under way. */
export async function cleanTemps(dir) {
  let names;
  try { names = await fs.readdir(dir); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    const m = /^\..+\.(\d+)\.[0-9a-f]{8}\.tmp$/.exec(name);
    if (m && +m[1] !== process.pid) {
      await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
      n++;
    }
  }
  return n;
}

export async function readDocument(file) {
  const buf = await fs.readFile(file);
  const json = await decode(buf);
  const st = await fs.stat(file);
  return { json, mtimeMs: st.mtimeMs, size: buf.length };
}

export async function isValidDocument(file) {
  try { check(await fs.readFile(file)); return true; } catch { return false; }
}

/**
 * Serialises saves per path and refuses stale revisions, so a slow older
 * save can never land after (and overwrite) a newer one.
 */
export class SaveQueue {
  constructor() { this.state = new Map(); }

  _get(file) {
    let s = this.state.get(file);
    if (!s) { s = { chain: Promise.resolve(), lastRev: -1, mtimeMs: null }; this.state.set(file, s); }
    return s;
  }

  /** Record the mtime we last saw on disk (after open or save). */
  known(file, mtimeMs) { this._get(file).mtimeMs = mtimeMs; }

  forget(file) { this.state.delete(file); }

  save(file, rev, json, { force = false } = {}) {
    const s = this._get(file);
    const job = s.chain.then(async () => {
      if (rev <= s.lastRev) return { ok: true, skipped: true, rev: s.lastRev };
      if (!force && s.mtimeMs != null) {
        const st = await fs.stat(file).catch(() => null);
        if (st && Math.abs(st.mtimeMs - s.mtimeMs) > 1) {
          return { ok: false, conflict: true, error: 'The file was changed on disk by another program since it was opened.' };
        }
      }
      const buf = await encode(json);
      await atomicWrite(file, buf);
      const st = await fs.stat(file);
      s.lastRev = rev;
      s.mtimeMs = st.mtimeMs;
      return { ok: true, rev, mtimeMs: st.mtimeMs, bytes: buf.length };
    }).catch((e) => ({ ok: false, error: e.message, code: e.code }));
    s.chain = job.then(() => {});
    return job;
  }
}

// ---- backups -------------------------------------------------------------------

const STAMP_RE = / (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})(?:-(\d+))?\.stet$/;

export function docBase(file) { return path.basename(file).replace(/\.stet$/i, ''); }

/** Default backup directory: "<Name> Backups" next to the document. */
export function backupDirFor(file, customDir) {
  if (customDir) return path.join(customDir, docBase(file) + ' Backups');
  return path.join(path.dirname(file), docBase(file) + ' Backups');
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function backupTime(name) {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

export async function createBackup(dir, base, json, now = new Date()) {
  let name = `${base} ${stamp(now)}.stet`;
  for (let i = 2; await exists(path.join(dir, name)); i++) name = `${base} ${stamp(now)}-${i}.stet`;
  const file = path.join(dir, name);
  await atomicWrite(file, await encode(json));
  return file;
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

export async function listBackups(dir) {
  let names;
  try { names = await fs.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const t = backupTime(name);
    if (t == null) continue;
    const full = path.join(dir, name);
    const st = await fs.stat(full).catch(() => null);
    if (!st) continue;
    out.push({ file: full, name, time: t, size: st.size });
  }
  return out.sort((a, b) => b.time - a.time);
}

/**
 * Delete one backup the writer chose (File > Restore Backup): only a file named as a backup, right
 * inside the screenplay's own backup folder, is ever removed. Resolves with whether it was.
 */
export async function deleteBackup(dir, file) {
  const f = path.resolve(file);
  if (path.dirname(f) !== path.resolve(dir) || backupTime(path.basename(f)) == null) return false;
  try { await fs.rm(f); return true; } catch { return false; }
}

/**
 * Delete backups older than `retentionDays`. Safety rules:
 *  - the newest *valid* backup is always kept;
 *  - nothing is deleted unless `primaryValid` (the document itself, or its
 *    recovery copy, is known to be intact) — otherwise backups may be the only copy.
 */
export async function pruneBackups(dir, retentionDays, primaryValid, now = Date.now()) {
  if (!primaryValid) return [];
  const list = await listBackups(dir);
  let keeper = null;
  for (const b of list) {
    try { check(await fs.readFile(b.file)); keeper = b; break; } catch { /* damaged, look further */ }
  }
  if (!keeper) return [];
  const cutoff = now - retentionDays * 86400000;
  const removed = [];
  for (const b of list) {
    if (b === keeper || b.time >= cutoff) continue;
    await fs.rm(b.file, { force: true });
    removed.push(b.file);
  }
  return removed;
}

// ---- crash recovery ------------------------------------------------------------

/**
 * Recovery snapshots live in <userData>/recovery as <docId>.stet plus a small
 * <docId>.json sidecar. They exist only while a document has changes that are
 * not yet in its real file; a clean save or close removes them.
 */
export class Recovery {
  constructor(dir) { this.dir = dir; }

  async write(id, info, json) {
    await atomicWrite(path.join(this.dir, id + '.stet'), await encode(json));
    await atomicWrite(path.join(this.dir, id + '.json'), Buffer.from(JSON.stringify({ ...info, id, time: Date.now() })), { verify: null });
  }

  async clear(id) {
    await fs.rm(path.join(this.dir, id + '.stet'), { force: true });
    await fs.rm(path.join(this.dir, id + '.json'), { force: true });
  }

  async list() {
    await cleanTemps(this.dir);
    let names;
    try { names = await fs.readdir(this.dir); } catch { return []; }
    const out = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const info = JSON.parse(await fs.readFile(path.join(this.dir, n), 'utf8'));
        const file = path.join(this.dir, info.id + '.stet');
        if (await isValidDocument(file)) out.push({ ...info, file });
      } catch { /* unreadable sidecar: ignore */ }
    }
    return out.sort((a, b) => b.time - a.time);
  }

  backupDir(id) { return path.join(this.dir, 'backups', id); }
}
