// Google Drive's files, through its REST API. Only the plain calls live here, with fetch and the token
// handed in, so all of it is tested without Google (test/drive.test.js); google.js does the sign-in and
// the picker. The scope is drive.file: STET sees only the files the writer opens or makes with it.

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,version,modifiedTime';
const MIME = 'application/octet-stream';
const TRIES = 3;

export class DriveError extends Error {
  /** code: 'auth' (sign in again), 'denied', 'gone', 'full', 'offline', 'failed'. */
  constructor(code, message) { super(message); this.code = code; }
}

const MESSAGES = {
  auth: 'Google Drive needs you to sign in again.',
  denied: 'Google Drive refused access to this file.',
  gone: 'This file is no longer in Google Drive.',
  full: 'Your Google Drive storage is full.',
  offline: 'Google Drive could not be reached.',
  failed: 'Google Drive could not complete that.',
};

async function reasonOf(res) {
  try { return (await res.json()).error?.errors?.[0]?.reason || ''; } catch { return ''; }
}

export class DriveClient {
  /** token(): the current access token, or null. wait(ms) is there for tests. */
  constructor({ fetch: doFetch = (...a) => globalThis.fetch(...a), token, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.fetch = doFetch; this.token = token; this.wait = wait;
  }

  async call(url, init = {}) {
    const token = this.token();
    if (!token) throw new DriveError('auth', MESSAGES.auth);
    for (let attempt = 1; ; attempt++) {
      let res = null;
      try { res = await this.fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } }); } catch { /* no network: as a busy server */ }
      if (res?.ok) return res;
      const reason = res && res.status === 403 ? await reasonOf(res) : '';
      const busy = !res || res.status === 429 || res.status >= 500 || /rateLimit/i.test(reason);
      if (busy && attempt < TRIES) { await this.wait(500 * 2 ** attempt); continue; }
      if (!res) throw new DriveError('offline', MESSAGES.offline);
      const code = res.status === 401 ? 'auth' : res.status === 404 ? 'gone' : /storageQuota/i.test(reason) ? 'full' : res.status === 403 ? 'denied' : busy ? 'offline' : 'failed';
      throw new DriveError(code, MESSAGES[code]);
    }
  }

  async meta(id) { return (await this.call(`${API}/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`)).json(); }

  async download(id) {
    const res = await this.call(`${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** A new file in the writer's Drive. */
  async create(name, bytes) {
    const boundary = `stet${Date.now().toString(36)}`;
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: MIME })}\r\n--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n`;
    const body = new Blob([head, bytes, `\r\n--${boundary}--`]);
    const res = await this.call(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return res.json();
  }

  /** The file's content replaced. Drive keeps the old one in the file's version history. */
  async update(id, bytes) {
    const res = await this.call(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}&supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': MIME }, body: bytes });
    return res.json();
  }
}

/** A screenplay kept in Drive. `version` is what was last seen, so a change from elsewhere is noticed. */
export class DrivePlace {
  constructor(client, { id, name, version = null }) { this.kind = 'drive'; this.client = client; this.id = id; this.name = name; this.version = version; this.inPlace = true; this.label = 'Google Drive'; }

  async allowed() { return !!this.client.token(); }

  async changedElsewhere() {
    if (this.version == null) return false;
    return (await this.client.meta(this.id)).version !== this.version;
  }

  async write(bytes) { this.version = (await this.client.update(this.id, bytes)).version; }

  remember() { return { kind: 'drive', id: this.id, name: this.name }; }
}
