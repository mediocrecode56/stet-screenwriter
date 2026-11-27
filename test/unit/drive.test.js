// Google Drive sync (src/main/drive.js) against a stand-in for Google (test/helpers/fake-drive.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Drive, fileKey, FOLDER_NAME } from '../../src/main/drive.js';
import { atomicWrite } from '../../src/main/files.js';
import { encode, check, decode } from '../../src/main/container.js';
import { fakeDrive } from '../helpers/fake-drive.js';

let g, dir;
before(async () => { g = await fakeDrive(); dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-drive-')); });
after(async () => { await g.close(); await fs.rm(dir, { recursive: true, force: true }); });

const memStore = (data = {}) => ({ get: () => data, replace: (d) => { data = d; } });
const secret = { available: () => true, encrypt: (s) => Buffer.from('enc:' + s), decrypt: (b) => b.toString().replace(/^enc:/, '') };
const until = async (fn, what, ms = 3000) => {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await new Promise((r) => setTimeout(r, 10)); }
};
const doc = (text) => encode(JSON.stringify({ format: 'stet', text }));
const textOf = async (bytes) => JSON.parse(await decode(bytes)).text;

function make(extra = {}) {
  const events = [];
  const d = new Drive({
    store: memStore(), tokenFile: path.join(dir, 'token-' + Math.random().toString(36).slice(2) + '.bin'), secret,
    fetch: (url, opts) => fetch(url, opts), open: (url) => fetch(url).then((r) => r.text()), // (the "browser" follows the redirect)
    config: { clientId: 'test-client', clientSecret: 'not-secret' },
    emit: (ch, p) => events.push([ch, p]), write: atomicWrite, verify: check,
    urls: g.urls, timing: { quiet: 30, maxWait: 200, poll: 1e9, focusGap: 0, backoff: 20, backoffMax: 80, signIn: 3000 },
    ...extra,
  });
  d.events = events;
  return d;
}

async function screenplay(name, text) {
  const file = path.join(dir, name + '.stet');
  await atomicWrite(file, await doc(text));
  return file;
}

test('not connected: nothing is sent, and a copy without the Google setup says so', async () => {
  const d = make({ config: { clientId: '' } });
  assert.equal((await d.status()).configured, false);
  assert.match((await d.signIn()).error, /not set up/);
  const before = g.log.length;
  d.saved(await screenplay('Quiet', 'a'));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(g.log.length, before, 'no request at all');
  d.stop();
});

test('connecting: the browser sign-in, the sign-in kept encrypted, the STET folder made once', async () => {
  const d = make();
  const r = await d.signIn();
  assert.deepEqual(r, { ok: true, email: 'writer@example.com' });
  const st = await d.status();
  assert.equal(st.signedIn, true);
  assert.match(st.folderUrl, /\/folders\/id\d+$/);
  assert.match((await fs.readFile(d.tokenFile)).toString(), /^enc:rt/);
  const folders = [...g.files.values()].filter((f) => f.name === FOLDER_NAME);
  assert.equal(folders.length, 1);
  // A second computer (a new Drive object) finds the same folder instead of making another.
  const d2 = make();
  await d2.signIn();
  assert.equal([...g.files.values()].filter((f) => f.name === FOLDER_NAME).length, 1);
  assert.equal(d2.data().folderId, d.data().folderId);
  // A sign-in refused in the browser.
  g.deny(true);
  const no = await make().signIn();
  g.deny(false);
  assert.equal(no.ok, false);
  assert.match(no.error, /not allowed/);
  d.stop(); d2.stop();
});

test('a saved screenplay reaches Drive once, a moment after the last of several saves', async () => {
  const d = make({ timing: { quiet: 400, maxWait: 4000, poll: 1e9, focusGap: 0, backoff: 20, backoffMax: 80, signIn: 3000 } }); // (writing a file can take a while here)
  await d.signIn();
  const file = await screenplay('Night Shift', 'one');
  const before = g.uploads();
  for (let i = 0; i < 5; i++) { await atomicWrite(file, await doc('take ' + i)); d.saved(file); await new Promise((r) => setTimeout(r, 5)); }
  await until(() => d.stateOf(file).state === 'synced', 'synced');
  assert.equal(g.uploads() - before, 1, 'five saves, one upload');
  const link = d.link(file);
  const remote = g.files.get(link.id);
  assert.equal(remote.name, 'Night Shift.stet');
  assert.deepEqual(remote.parents, [d.data().folderId]);
  assert.equal(await textOf(remote.bytes), 'take 4');
  assert.ok(d.isLinked(file.toUpperCase()) || process.platform === 'linux', 'the same file however its path is spelt');
  // Saved again later: a new version of the same Drive file, not another file.
  await atomicWrite(file, await doc('take 5'));
  d.saved(file);
  await until(async () => g.files.get(link.id).bytes && (await textOf(g.files.get(link.id).bytes)) === 'take 5', 'the new version');
  assert.equal([...g.files.values()].filter((f) => f.name === 'Night Shift.stet').length, 1);
  assert.ok(d.events.some(([ch, p]) => ch === 'drive:state' && p.state === 'waiting'));
  d.stop();
});

test('left out: a screenplay with syncing off sends nothing, and turning it on sends it at once', async () => {
  const d = make();
  await d.signIn();
  const file = await screenplay('Private', 'secret');
  const before = g.uploads();
  await d.opened(file, { sync: false });
  d.saved(file, { sync: false });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(g.uploads(), before);
  assert.equal(d.stateOf(file).state, 'off');
  await d.setSync(file, true);
  await until(() => d.isLinked(file), 'linked');
  assert.equal(g.uploads(), before + 1);
  d.stop();
});

test('opened: a screenplay not yet in Drive is sent at once; one changed elsewhere is offered, never overwritten', async () => {
  const d = make();
  await d.signIn();
  const file = await screenplay('Two Desks', 'start');
  await d.opened(file);
  await until(() => d.isLinked(file), 'sent on opening');
  const id = d.link(file).id;
  // Another computer saves a new version; this one hasn't changed since.
  g.edit(id, await doc('from the laptop'));
  await d.check(file);
  const ev = d.events.findLast(([ch]) => ch === 'drive:remote');
  assert.deepEqual([ev[1].path, ev[1].conflict], [file, false]);
  assert.equal(d.stateOf(file).state, 'conflict');
  // A save here meanwhile does not overwrite it either.
  await atomicWrite(file, await doc('from the desktop'));
  await d.flush(fileKey(file)) ; d.saved(file); await d.flush(fileKey(file));
  assert.equal(await textOf(g.files.get(id).bytes), 'from the laptop');
  assert.equal(d.events.findLast(([ch]) => ch === 'drive:remote')[1].conflict, true);
  // Take the Drive version: written here, and in step again.
  assert.deepEqual(await d.pull(file), { ok: true });
  assert.equal(await textOf(await fs.readFile(file)), 'from the laptop');
  assert.equal(d.stateOf(file).state, 'synced');
  // Or keep this one: it goes over the other.
  g.edit(id, await doc('laptop again'));
  await atomicWrite(file, await doc('desktop wins'));
  await d.keepLocal(file);
  assert.equal(await textOf(g.files.get(id).bytes), 'desktop wins');
  d.stop();
});

test('Google says slow down: the upload waits longer and tries again, without a flood', async () => {
  const d = make();
  await d.signIn();
  const file = await screenplay('Busy', 'x');
  const before = g.log.length;
  g.fail(429, 403, 503);
  d.saved(file);
  await until(() => d.stateOf(file).state === 'synced', 'synced after the refusals', 5000);
  assert.ok(d.events.some(([ch, p]) => ch === 'drive:state' && p.state === 'offline'));
  assert.ok(g.log.length - before < 15, `few requests (${g.log.length - before})`);
  assert.equal(d.wait, 0, 'back to normal once it went through');
  d.stop();
});

test('the folder in Drive: listed, downloaded to this computer, renamed with the file', async () => {
  const d = make();
  await d.signIn();
  const file = await screenplay('Harbour', 'boats');
  await d.opened(file);
  await until(() => d.isLinked(file), 'sent');
  const l = await d.list();
  assert.equal(l.ok, true);
  const h = l.files.find((f) => f.name === 'Harbour');
  assert.ok(h && h.here, 'listed, and known to be on this computer');
  // The same file is simply opened again; one from elsewhere is downloaded beside the others.
  assert.deepEqual(await d.download(h.id, dir), { ok: true, path: file, existing: true });
  const other = make();
  await other.signIn();
  const elsewhere = path.join(dir, 'away');
  const got = await other.download(h.id, elsewhere);
  assert.equal(got.ok, true);
  assert.equal(path.basename(got.path), 'Harbour.stet');
  assert.equal(await textOf(await fs.readFile(got.path)), 'boats');
  assert.ok(other.isLinked(got.path), 'and linked: its saves go to the same Drive file');
  assert.equal(path.basename((await other.download(h.id, path.join(dir, 'away'))).path), 'Harbour.stet');
  // Renamed on this computer: the Drive file follows at the next upload.
  const to = path.join(dir, 'Harbour Lights.stet');
  await fs.rename(file, to);
  d.renamed(file, to);
  await until(() => g.files.get(h.id).name === 'Harbour Lights.stet', 'renamed in Drive');
  assert.equal(d.isLinked(file), false);
  d.stop(); other.stop();
});

test('disconnecting forgets the sign-in; a sign-in Google ended disconnects and says so', async () => {
  const d = make();
  await d.signIn();
  const file = await screenplay('Ends', 'x');
  await d.opened(file);
  await until(() => d.isLinked(file), 'sent');
  await d.signOut();
  assert.equal((await d.status()).signedIn, false);
  await assert.rejects(fs.access(d.tokenFile));
  assert.equal(d.isLinked(file), true, 'which file is which is kept for connecting again');
  const e = make();
  await e.signIn();
  g.revokeAll();
  e.access = null;
  await atomicWrite(file, await doc('y'));
  await e.upload(file);
  assert.equal((await e.status()).signedIn, false);
  assert.ok(e.events.some(([ch, p]) => ch === 'drive:account' && p.lost));
  d.stop(); e.stop();
});
