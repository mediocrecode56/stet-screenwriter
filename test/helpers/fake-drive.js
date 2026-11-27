// A stand-in for Google's sign-in and the Drive REST API, enough for src/main/drive.js: the sign-in
// redirect and tokens, files and folders, multipart uploads, downloads, and answers that say slow down.
// Used by test/unit/drive.test.js and the app tests (STET_DRIVE_URL).

import http from 'node:http';
import crypto from 'node:crypto';

export async function fakeDrive({ email = 'writer@example.com' } = {}) {
  const files = new Map(); // id -> { id, name, mimeType, parents, bytes, modifiedTime, trashed, appProperties }
  const tokens = new Set(), refresh = new Set();
  const log = [];
  let failNext = [], seq = 0, deniedAuth = false;
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  const meta = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, md5Checksum: f.bytes ? md5(f.bytes) : undefined, modifiedTime: f.modifiedTime, trashed: !!f.trashed });
  const touch = (f) => { f.modifiedTime = new Date(Date.now() + seq++).toISOString(); };
  const read = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body));
  };
  const multipart = (buf, type) => {
    const boundary = /boundary=([^;]+)/.exec(type)[1];
    const parts = buf.toString('latin1').split(`--${boundary}`).slice(1, -1).map((p) => {
      const i = p.indexOf('\r\n\r\n');
      return Buffer.from(p.slice(i + 4, p.length - 2), 'latin1');
    });
    return { meta: JSON.parse(parts[0].toString('utf8')), bytes: parts[1] };
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const body = await read(req);
    log.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams) });
    if (u.pathname === '/auth') {
      const to = new URL(u.searchParams.get('redirect_uri'));
      to.searchParams.set('state', u.searchParams.get('state'));
      if (deniedAuth) to.searchParams.set('error', 'access_denied'); else to.searchParams.set('code', 'code-' + u.searchParams.get('code_challenge').slice(0, 6));
      res.writeHead(302, { Location: to.toString() }).end();
      return;
    }
    if (u.pathname === '/token') {
      const f = new URLSearchParams(body.toString());
      if (f.get('grant_type') === 'authorization_code') {
        if (!f.get('code') || !f.get('code_verifier')) return send(res, 400, { error: 'invalid_request' });
        const a = 'at' + seq++, r = 'rt' + seq++;
        tokens.add(a); refresh.add(r);
        return send(res, 200, { access_token: a, refresh_token: r, expires_in: 3600 });
      }
      if (!refresh.has(f.get('refresh_token'))) return send(res, 400, { error: 'invalid_grant' });
      const a = 'at' + seq++;
      tokens.add(a);
      return send(res, 200, { access_token: a, expires_in: 3600 });
    }
    if (u.pathname === '/revoke') { refresh.delete(u.searchParams.get('token')); return send(res, 200, {}); }
    if (!tokens.has((req.headers.authorization || '').replace(/^Bearer /, ''))) return send(res, 401, { error: { message: 'Invalid Credentials' } });
    if (failNext.length) { const status = failNext.shift(); return send(res, status, { error: { message: 'slow down', errors: [{ reason: status === 403 ? 'userRateLimitExceeded' : 'rateLimitExceeded' }] } }); }

    if (u.pathname === '/drive/v3/about') return send(res, 200, { user: { emailAddress: email } });
    if (u.pathname === '/drive/v3/files' && req.method === 'GET') {
      const qy = u.searchParams.get('q') || '';
      let list = [...files.values()].filter((f) => !f.trashed);
      const name = /name='([^']*)'/.exec(qy), parent = /'([^']*)' in parents/.exec(qy);
      if (name) list = list.filter((f) => f.name === name[1]);
      if (/mimeType='application\/vnd.google-apps.folder'/.test(qy)) list = list.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
      if (/mimeType!='application\/vnd.google-apps.folder'/.test(qy)) list = list.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
      if (parent) list = list.filter((f) => (f.parents || []).includes(parent[1]));
      list.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      return send(res, 200, { files: list.map(meta) });
    }
    if (u.pathname === '/drive/v3/files' && req.method === 'POST') {
      const m = JSON.parse(body.toString());
      const f = { id: 'id' + seq++, ...m, parents: m.parents || [] };
      touch(f);
      files.set(f.id, f);
      return send(res, 200, meta(f));
    }
    let m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === 'GET') {
      const f = files.get(m[1]);
      if (!f) return send(res, 404, { error: { message: 'File not found' } });
      if (u.searchParams.get('alt') === 'media') return send(res, 200, f.bytes || Buffer.alloc(0), 'application/octet-stream');
      return send(res, 200, meta(f));
    }
    m = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
    if (m) {
      const p = multipart(body, req.headers['content-type']);
      let f;
      if (m[1]) {
        f = files.get(m[1]);
        if (!f) return send(res, 404, { error: { message: 'File not found' } });
        Object.assign(f, { name: p.meta.name || f.name, bytes: p.bytes });
      } else {
        f = { id: 'id' + seq++, ...p.meta, bytes: p.bytes };
        files.set(f.id, f);
      }
      touch(f);
      return send(res, 200, meta(f));
    }
    send(res, 404, { error: { message: 'no such endpoint' } });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, files, log,
    urls: { auth: base + '/auth', token: base + '/token', revoke: base + '/revoke', api: base + '/drive/v3', upload: base + '/upload/drive/v3', folder: base + '/folders/' },
    /** The next requests answer with these statuses (429, 403 rate limit, 503). */
    fail: (...statuses) => { failNext = statuses; },
    deny: (on = true) => { deniedAuth = on; },
    /** Another computer saves a new version. */
    edit: (id, bytes) => { const f = files.get(id); f.bytes = bytes; touch(f); },
    trash: (id) => { files.get(id).trashed = true; },
    revokeAll: () => { refresh.clear(); tokens.clear(); },
    uploads: () => log.filter((l) => l.path.startsWith('/upload/')).length,
    close: () => new Promise((ok) => server.close(ok)),
  };
}
