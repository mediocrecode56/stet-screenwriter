// Google Drive sync. Once the writer connects Google Drive (File menu), every screenplay they open or
// save on this computer is also kept, as the same .stet file, in a STET folder in their Drive. The file
// on the computer stays the one STET works on and saves to as always; Drive gets a copy a few seconds
// after the writer stops saving.
//
//  - Signing in: Google's sign-in for desktop apps, in the system browser, answered on a loopback
//    address (with PKCE). Only the drive.file permission: STET sees the files it put in Drive, never
//    the rest of the writer's Drive.
//  - The sign-in is kept encrypted by the operating system (safeStorage), never in a screenplay.
//  - Few requests: one upload per screenplay a few seconds after the last save (QUIET, never later than
//    MAX_WAIT), the open screenplay checked for changes from elsewhere once a minute and when the window
//    comes back, and every request waits longer each time Google says to slow down.
//  - A screenplay changed in Drive from another computer is never overwritten unasked: the window offers
//    the Drive version (this one is backed up first) or keeping this one (Drive keeps the other in its
//    version history).
//  - A screenplay can be left out (its own setting, in the file): nothing of it is sent.
// Nothing here sends anything until the writer connects.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'STET';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_MIME = 'application/octet-stream';
const FIELDS = 'id,name,md5Checksum,modifiedTime,trashed';
export const URLS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
  folder: 'https://drive.google.com/drive/folders/',
};
export const TIMING = {
  quiet: 4000,        // an upload this long after the last save...
  maxWait: 30000,     // ...and never later than this after the first unsent one
  poll: 60000,        // the open screenplay checked for changes made elsewhere
  focusGap: 15000,    // ...and when the window comes back, at most this often
  backoff: 5000,      // the first wait after Google says to slow down (or can't be reached), doubling
  backoffMax: 300000, // up to five minutes
  signIn: 300000,     // the browser sign-in may take this long
};

export class DriveError extends Error {
  constructor(message, { status = 0, retry = false, auth = false, missing = false } = {}) {
    super(message);
    Object.assign(this, { status, retry, auth, missing });
  }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
/** The same file whatever the spelling of its path (Windows and macOS ignore case). */
export const fileKey = (file, platform = process.platform) => {
  const p = path.resolve(file);
  return platform === 'linux' ? p : p.toLowerCase();
};
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class Drive {
  /**
   * store: a JsonStore for what Drive holds ({ email, folderId, links: { key: { id, md5, name } } });
   * tokenFile: where the encrypted sign-in is kept; secret: { available(), encrypt(s) -> Buffer, decrypt(Buffer) -> s };
   * fetch; open(url): the system browser; config: { clientId, clientSecret };
   * emit(channel, payload): to the window; write(file, bytes): an atomic write, checked; known(file): after a pull.
   */
  constructor({ store, tokenFile, secret, fetch, open, config, emit = () => {}, write, verify = () => {}, known = () => {}, urls = URLS, timing = TIMING, platform = process.platform }) {
    Object.assign(this, { store, tokenFile, secret, fetch, open, config, emit, write, verify, known, urls, timing, platform });
    this.refresh = null;   // the refresh token, once read
    this.access = null;    // { token, until }
    this.jobs = new Map(); // key -> { file, first, timer }
    this.chain = Promise.resolve(); // uploads, one at a time
    this.states = new Map(); // key -> { state, at, message }
    this.current = null;   // { file, sync } the screenplay open in the window
    this.wait = 0;         // the current back-off, after a refusal
    this.lastCheck = 0;
    this.signingIn = null; // { cancel }
    this.ready = this.load();
    this.poller = setInterval(() => this.checkCurrent(), timing.poll);
    this.poller.unref?.();
  }

  // ---- state ---------------------------------------------------------------------------------

  configured() { return !!(this.config && this.config.clientId); }
  data() { return this.store.get(); }
  save(patch) { this.store.replace({ ...this.data(), ...patch }); }
  link(file) { return (this.data().links || {})[fileKey(file, this.platform)] || null; }
  setLink(file, link) {
    const links = { ...(this.data().links || {}) }, k = fileKey(file, this.platform);
    if (link) links[k] = { id: link.id, md5: link.md5, path: file }; else delete links[k];
    this.save({ links });
  }
  isLinked(file) { return !!this.link(file); }

  async load() {
    try { this.refresh = this.secret.decrypt(await fs.readFile(this.tokenFile)) || null; } catch { this.refresh = null; }
  }

  async status() {
    await this.ready;
    const d = this.data();
    return { configured: this.configured(), signedIn: !!this.refresh, email: d.email || '', folderUrl: d.folderId ? this.urls.folder + d.folderId : '', signingIn: !!this.signingIn };
  }

  /** How one screenplay stands: 'off' (not connected or left out), 'waiting' (a change not sent yet),
   *  'syncing', 'synced', 'offline', 'conflict', 'error'. */
  stateOf(file) {
    if (!this.refresh) return { state: 'off' };
    return this.states.get(fileKey(file, this.platform)) || (this.isLinked(file) ? { state: 'synced' } : { state: 'waiting' });
  }

  setState(file, state, message = '') {
    const s = { state, at: Date.now(), message };
    this.states.set(fileKey(file, this.platform), s);
    this.emit('drive:state', { path: file, ...s });
  }

  // ---- signing in ----------------------------------------------------------------------------

  /** The browser sign-in: resolves { ok, email } or { ok: false, error, cancelled }. */
  async signIn() {
    if (!this.configured()) return { ok: false, error: 'Google Drive is not set up in this copy of STET.' };
    if (!this.secret.available()) return { ok: false, error: 'This computer cannot keep a sign-in safely, so Google Drive cannot be connected.' };
    if (this.signingIn) this.signingIn.cancel();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let server, timer, finish;
    const answer = new Promise((resolve, reject) => { finish = { resolve, reject }; });
    answer.catch(() => {}); // (an answer may come while the browser is still being opened)
    try {
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404).end(); return; }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>STET</title><body style="font:15px/1.5 system-ui;margin:15vh auto;max-width:28em;text-align:center">${ok ? 'STET is connected to Google Drive. You can close this tab.' : 'Google Drive was not connected. You can close this tab and try again from STET.'}</body>`);
        if (u.searchParams.get('state') !== state) return;
        if (ok) finish.resolve(u.searchParams.get('code'));
        else finish.reject(new DriveError(u.searchParams.get('error') === 'access_denied' ? 'Google Drive was not connected: access was not allowed.' : 'Google Drive was not connected.'));
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const redirect = `http://127.0.0.1:${server.address().port}`;
      timer = setTimeout(() => finish.reject(new DriveError('Signing in to Google took too long. Try again.')), this.timing.signIn);
      this.signingIn = { cancel: () => finish.reject(Object.assign(new DriveError('Cancelled.'), { cancelled: true })) };
      const url = `${this.urls.auth}?` + new URLSearchParams({
        client_id: this.config.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
      });
      await this.open(url);
      const code = await answer;
      const t = await this.tokenRequest({ code, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
      if (!t.refresh_token) throw new DriveError('Google did not keep STET signed in. Try again.');
      this.refresh = t.refresh_token;
      this.access = { token: t.access_token, until: Date.now() + (Number(t.expires_in) - 60) * 1000 };
      await this.write(this.tokenFile, this.secret.encrypt(this.refresh), { verify: null });
      const about = await this.json('GET', `${this.urls.api}/about?fields=user(emailAddress)`);
      this.save({ email: about.user?.emailAddress || '' });
      await this.folder();
      this.wait = 0;
      this.emit('drive:account', await this.status());
      if (this.current) this.opened(this.current.file, { sync: this.current.sync });
      return { ok: true, email: this.data().email };
    } catch (e) {
      return { ok: false, error: e.message, cancelled: !!e.cancelled };
    } finally {
      clearTimeout(timer);
      this.signingIn = null;
      server?.close();
    }
  }

  cancelSignIn() { if (this.signingIn) this.signingIn.cancel(); }

  /** Disconnect: the sign-in is forgotten (and given back to Google). The files stay in Drive, and which
   *  file is which stays known, so connecting the same account again carries on with the same files. */
  async signOut() {
    const token = this.refresh;
    this.refresh = null;
    this.access = null;
    for (const j of this.jobs.values()) clearTimeout(j.timer);
    this.jobs.clear();
    this.states.clear();
    await fs.rm(this.tokenFile, { force: true }).catch(() => {});
    this.save({ email: '' });
    if (token) await this.fetch(`${this.urls.revoke}?` + new URLSearchParams({ token }), { method: 'POST' }).catch(() => {});
    this.emit('drive:account', await this.status());
    return { ok: true };
  }

  async tokenRequest(params) {
    let r;
    try {
      r = await this.fetch(this.urls.token, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.config.clientId, ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}), ...params }).toString(),
      });
    } catch { throw new DriveError('Google could not be reached.', { retry: true }); }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (body.error === 'invalid_grant') throw new DriveError('The Google sign-in has ended. Connect Google Drive again.', { auth: true, status: r.status });
      throw new DriveError(body.error_description || 'Signing in to Google failed.', { status: r.status, retry: r.status >= 500 });
    }
    return body;
  }

  async token() {
    await this.ready;
    if (!this.refresh) throw new DriveError('Google Drive is not connected.', { auth: true });
    if (this.access && Date.now() < this.access.until) return this.access.token;
    try {
      const t = await this.tokenRequest({ refresh_token: this.refresh, grant_type: 'refresh_token' });
      this.access = { token: t.access_token, until: Date.now() + (Number(t.expires_in) - 60) * 1000 };
      return this.access.token;
    } catch (e) {
      if (e.auth) await this.lost();
      throw e;
    }
  }

  /** The sign-in no longer works (revoked, expired): disconnected, and the window told so. */
  async lost() {
    this.refresh = null;
    this.access = null;
    await fs.rm(this.tokenFile, { force: true }).catch(() => {});
    this.emit('drive:account', { ...(await this.status()), lost: true });
  }

  // ---- requests ------------------------------------------------------------------------------

  async request(method, url, { body, headers = {}, retried = false } = {}) {
    const token = await this.token();
    let r;
    try { r = await this.fetch(url, { method, body, headers: { ...headers, Authorization: `Bearer ${token}` } }); } catch {
      throw new DriveError('Google Drive could not be reached.', { retry: true });
    }
    if (r.status === 401 && !retried) { this.access = null; return this.request(method, url, { body, headers, retried: true }); }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const reason = e.error?.errors?.[0]?.reason || '';
      const slow = r.status === 429 || r.status >= 500 || (r.status === 403 && /rate|quota|limit/i.test(reason));
      throw new DriveError(slow ? 'Google Drive asked STET to slow down.' : e.error?.message || `Google Drive answered ${r.status}.`, { status: r.status, retry: slow, missing: r.status === 404, auth: r.status === 401 });
    }
    return r;
  }

  async json(method, url, opts) { return (await this.request(method, url, opts)).json(); }

  /** The STET folder in the writer's Drive (made the first time, found again after). */
  async folder() {
    const d = this.data();
    if (d.folderId) {
      try {
        const f = await this.json('GET', `${this.urls.api}/files/${d.folderId}?fields=id,trashed`);
        if (!f.trashed) return d.folderId;
      } catch (e) { if (!e.missing) throw e; }
    }
    const found = await this.json('GET', `${this.urls.api}/files?` + new URLSearchParams({ q: `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`, fields: 'files(id)', spaces: 'drive' }));
    const id = found.files?.[0]?.id || (await this.json('POST', `${this.urls.api}/files?fields=id`, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    })).id;
    this.save({ folderId: id });
    return id;
  }

  /** A file's name and contents in one multipart request: a new file (no id) or a new version of one. */
  async put(id, name, bytes, parent) {
    const boundary = 'stet' + crypto.randomBytes(8).toString('hex');
    const meta = id ? { name } : { name, parents: [parent], mimeType: FILE_MIME, appProperties: { stet: '1' } };
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${FILE_MIME}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--`),
    ]);
    const url = id ? `${this.urls.upload}/files/${id}?uploadType=multipart&fields=${FIELDS}` : `${this.urls.upload}/files?uploadType=multipart&fields=${FIELDS}`;
    return this.json(id ? 'PATCH' : 'POST', url, { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } });
  }

  async meta(id) {
    try { return await this.json('GET', `${this.urls.api}/files/${id}?fields=${FIELDS}`); } catch (e) { if (e.missing) return null; throw e; }
  }

  async bytes(id) { return Buffer.from(await (await this.request('GET', `${this.urls.api}/files/${id}?alt=media`)).arrayBuffer()); }

  // ---- syncing -------------------------------------------------------------------------------

  /** A screenplay was saved: its copy goes to Drive a moment after the writer stops saving. */
  saved(file, { sync = true } = {}) {
    if (!this.refresh || !sync || !file) return;
    const k = fileKey(file, this.platform), now = Date.now();
    const j = this.jobs.get(k) || { file, first: now, timer: 0 };
    j.file = file;
    clearTimeout(j.timer);
    j.timer = setTimeout(() => this.flush(k), Math.max(0, Math.min(this.timing.quiet, j.first + this.timing.maxWait - now)) + this.wait);
    this.jobs.set(k, j);
    const st = this.states.get(k)?.state;
    if (st !== 'conflict' && st !== 'syncing') this.setState(file, 'waiting');
  }

  /** Send now (the timer ran out, or the window is closing). Resolves once it is in Drive (or failed). */
  flush(k) {
    const j = this.jobs.get(k);
    if (!j) return Promise.resolve();
    clearTimeout(j.timer);
    this.jobs.delete(k);
    return (this.chain = this.chain.then(() => this.upload(j.file)));
  }

  /** Everything not sent yet goes now (quitting). */
  flushAll() { return Promise.all([...this.jobs.keys()].map((k) => this.flush(k))); }

  async upload(file, { force = false } = {}) {
    if (!this.refresh) return;
    this.setState(file, 'syncing');
    try {
      const bytes = await fs.readFile(file);
      const sum = md5(bytes), name = path.basename(file), link = this.link(file);
      const folder = await this.folder();
      if (link && link.id) {
        const remote = await this.meta(link.id);
        if (remote && !remote.trashed) {
          // Changed in Drive from somewhere else since STET last saw it: never overwritten unasked.
          if (!force && remote.md5Checksum && remote.md5Checksum !== link.md5 && remote.md5Checksum !== sum) {
            this.setState(file, 'conflict');
            this.emit('drive:remote', { path: file, modified: remote.modifiedTime, conflict: true });
            return;
          }
          if (remote.md5Checksum === sum && remote.name === name) this.setLink(file, { id: link.id, md5: sum });
          else { const r = await this.put(link.id, name, bytes); this.setLink(file, { id: r.id, md5: r.md5Checksum || sum }); }
          return this.done(file);
        }
      }
      const r = await this.put(null, name, bytes, folder);
      this.setLink(file, { id: r.id, md5: r.md5Checksum || sum });
      this.done(file);
    } catch (e) { this.failed(file, e, () => this.saved(file)); }
  }

  done(file) { this.wait = 0; this.setState(file, 'synced'); }

  failed(file, e, again) {
    if (e.code === 'ENOENT') { this.states.delete(fileKey(file, this.platform)); return; } // (the file is gone: nothing to send)
    if (e.auth) { this.setState(file, 'off', e.message); return; }
    if (e.retry) {
      this.wait = Math.min(this.timing.backoffMax, this.wait ? this.wait * 2 : this.timing.backoff);
      this.setState(file, 'offline', e.message);
      again();
      return;
    }
    this.setState(file, 'error', e.message);
  }

  /** The window opened a screenplay (or it was saved under a new name): sent now if Drive doesn't have it
   *  yet, otherwise checked for changes made elsewhere. `sync: false` leaves it out. */
  async opened(file, { sync = true } = {}) {
    this.current = file ? { file, sync } : null;
    if (!file || !this.refresh) return;
    if (!sync) { this.forgetJob(file); this.setState(file, 'off'); return; }
    if (!this.isLinked(file)) { this.saved(file); return this.flush(fileKey(file, this.platform)); }
    return this.check(file);
  }

  forgetJob(file) {
    const k = fileKey(file, this.platform), j = this.jobs.get(k);
    if (j) { clearTimeout(j.timer); this.jobs.delete(k); }
  }

  /** The writer turned syncing on or off for this screenplay. Off keeps the copy already in Drive. */
  setSync(file, on) {
    if (this.current && file && fileKey(this.current.file, this.platform) === fileKey(file, this.platform)) this.current.sync = on;
    return this.opened(file, { sync: on });
  }

  /** Has the screenplay changed in Drive since STET last saw it? Then the window offers that version. */
  async check(file) {
    const link = this.link(file);
    if (!link || !this.refresh) return;
    this.lastCheck = Date.now();
    try {
      const remote = await this.meta(link.id);
      if (!remote || remote.trashed) { this.setLink(file, null); this.saved(file); return this.flush(fileKey(file, this.platform)); } // (gone from Drive: put back)
      if (!remote.md5Checksum || remote.md5Checksum === link.md5) {
        const local = md5(await fs.readFile(file));
        if (local !== link.md5) this.saved(file); // (saved here while away: sent)
        else this.done(file);
        return;
      }
      const local = md5(await fs.readFile(file));
      if (local === remote.md5Checksum) { this.setLink(file, { id: link.id, md5: local }); return this.done(file); }
      const conflict = local !== link.md5;
      this.setState(file, 'conflict');
      this.emit('drive:remote', { path: file, modified: remote.modifiedTime, conflict });
    } catch (e) { this.failed(file, e, () => {}); }
  }

  checkCurrent() {
    const c = this.current;
    if (c && c.sync && this.refresh && !this.jobs.has(fileKey(c.file, this.platform)) && this.stateOf(c.file).state !== 'conflict') this.check(c.file);
  }

  /** The window came back to the front: the open screenplay checked, unless it was a moment ago. */
  focused() { if (Date.now() - this.lastCheck > this.timing.focusGap) this.checkCurrent(); }

  /** Keep this one: it goes to Drive over the other (which Drive keeps in the file's version history). */
  keepLocal(file) { this.forgetJob(file); return (this.chain = this.chain.then(() => this.upload(file, { force: true }))); }

  /** Take the Drive version: written over the file on this computer (the window backs it up first). */
  async pull(file) {
    const link = this.link(file);
    if (!link) return { ok: false, error: 'This screenplay is not in Google Drive.' };
    try {
      const bytes = await this.bytes(link.id);
      this.verify(bytes);
      await this.write(file, bytes);
      await this.known(file);
      this.forgetJob(file);
      this.setLink(file, { id: link.id, md5: md5(bytes) });
      this.done(file);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof DriveError ? e.message : 'The version in Google Drive could not be read.' };
    }
  }

  /** The screenplays in the STET folder, newest first: [{ id, name, modified, path }] (path: the file on
   *  this computer it is, if any). */
  async list() {
    try {
      const folder = await this.folder();
      const r = await this.json('GET', `${this.urls.api}/files?` + new URLSearchParams({
        q: `'${q(folder)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`, fields: 'files(id,name,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '200', spaces: 'drive',
      }));
      const byId = new Map(Object.entries(this.data().links || {}).map(([k, v]) => [v.id, k]));
      return { ok: true, files: (r.files || []).filter((f) => /\.stet$/i.test(f.name)).map((f) => ({ id: f.id, name: f.name.replace(/\.stet$/i, ''), modified: f.modifiedTime, here: byId.has(f.id) })) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /** A screenplay from Drive onto this computer, in `dir`: resolves { ok, path }. One already here (the
   *  same Drive file) is simply opened; a file of the same name that isn't gets a number. */
  async download(id, dir) {
    try {
      const here = Object.values(this.data().links || {}).find((v) => v.id === id);
      if (here && here.path && await exists(here.path)) return { ok: true, path: here.path, existing: true };
      const m = await this.meta(id);
      if (!m || m.trashed) return { ok: false, error: 'That screenplay is no longer in Google Drive.' };
      const bytes = await this.bytes(id);
      this.verify(bytes);
      const base = m.name.replace(/\.stet$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Untitled';
      let target = path.join(dir, base + '.stet');
      for (let n = 2; await exists(target); n++) target = path.join(dir, `${base} (${n}).stet`);
      await this.write(target, bytes);
      this.setLink(target, { id, md5: md5(bytes) });
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: e instanceof DriveError ? e.message : 'That screenplay could not be read from Google Drive.' };
    }
  }

  /** A screenplay renamed on this computer: the same file in Drive, renamed at its next upload. */
  renamed(from, to) {
    const link = this.link(from);
    if (!link) return;
    this.setLink(from, null);
    this.setLink(to, link);
    this.forgetJob(from);
    this.saved(to);
  }

  stop() { clearInterval(this.poller); for (const j of this.jobs.values()) clearTimeout(j.timer); this.cancelSignIn(); }
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
