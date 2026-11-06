// Saving, Google Drive's calls (against a stand-in, never Google) and what each browser can do.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Saver, stateText } from '../src/saving.js';
import { DriveClient, DrivePlace, DriveError } from '../src/drive.js';
import { abilities, HandlePlace, CopyPlace, handOver, pickFile } from '../src/device.js';
import { driveConfigured } from '../src/config.js';
import { fit } from '../src/fit.js';

const noTimers = { setTimeout: () => 0, clearTimeout() {} };
function setup(place, over = {}) {
  let rev = 1, drafts = 0;
  const s = new Saver({ rev: () => rev, read: async () => Uint8Array.of(rev), draft: async () => { drafts++; }, ask: async () => 'keep', timers: noTimers, ...over });
  s.opened(place);
  return { s, edit: () => { rev++; s.changed(); }, bump: () => { rev++; }, drafts: () => drafts };
}
const place = (o = {}) => ({ inPlace: true, label: 'x', name: 'A.stet', writes: [], allowed: async () => true, changedElsewhere: async () => false, async write(b) { this.writes.push(b[0]); }, ...o });

test('a save reaches the place and clears the state', async () => {
  const p = place(), { s, edit } = setup(p);
  edit();
  assert.equal(s.dirty, true);
  assert.equal(await s.save(), true);
  assert.deepEqual(p.writes, [2]);
  assert.equal(s.dirty, false);
  assert.equal(s.status, 'saved');
});

test('a draft goes once everything has reached the file, and stays while anything has not', async () => {
  let dropped = 0;
  const { s, edit } = setup(place(), { saved: () => { dropped++; } });
  edit();
  await s.save();
  assert.equal(dropped, 1);
  const failing = setup(place({ async write() { throw new Error('no'); } }), { saved: () => { dropped++; } });
  failing.edit();
  await failing.s.save();
  assert.equal(dropped, 1);
});

test('a slow save never marks newer writing as saved', async () => {
  let release;
  const p = place({ write: () => new Promise((r) => { release = r; }) }), { s, edit, bump } = setup(p);
  edit();
  const saving = s.save();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  bump();
  release();
  await saving;
  assert.equal(s.dirty, true, 'the newer change is still unsaved');
  assert.equal(s.status, 'unsaved');
});

test('saves run one at a time', async () => {
  let active = 0, most = 0;
  const p = place({ async write() { most = Math.max(most, ++active); await new Promise((r) => setTimeout(r, 5)); active--; } }), { s, edit } = setup(p);
  edit();
  const a = s.save();
  edit();
  await Promise.all([a, s.save()]);
  assert.equal(most, 1);
});

test('a failed save keeps a draft, says so, and the next try goes through', async () => {
  let fail = true;
  const p = place({ async write(b) { if (fail) throw new Error('no network'); this.writes.push(b[0]); } }), { s, edit, drafts } = setup(p);
  edit();
  assert.equal(await s.save(), false);
  assert.equal(s.status, 'offline');
  assert.equal(drafts(), 1);
  assert.equal(stateText(s), 'KEPT IN THIS BROWSER');
  fail = false;
  assert.equal(await s.save(), true);
  assert.equal(s.status, 'saved');
});

test('a file changed elsewhere is never overwritten unasked', async () => {
  const p = place({ changedElsewhere: async () => true }), { s, edit } = setup(p);
  edit();
  assert.equal(await s.save(), false);
  assert.deepEqual(p.writes, []);
  assert.equal(s.status, 'conflict');
  assert.equal(stateText(s), 'CHANGED ELSEWHERE');
  await s.tick();
  assert.deepEqual(p.writes, [], 'autosave leaves it for the writer to decide');
});

test('replacing it is the writer\'s choice', async () => {
  const p = place({ changedElsewhere: async () => true }), { s, edit } = setup(p, { ask: async () => 'overwrite' });
  edit();
  assert.equal(await s.save(), true);
  assert.deepEqual(p.writes, [2]);
});

test('with permission gone it does not write, and keeps a draft', async () => {
  const p = place({ allowed: async () => false }), { s, edit, drafts } = setup(p);
  edit();
  assert.equal(await s.save(), false);
  assert.equal(s.error.code, 'auth');
  assert.equal(drafts(), 1);
  assert.deepEqual(p.writes, []);
});

test('a copy cannot be saved in place: changes stay as a draft until one is handed over', async () => {
  const { s, edit, drafts } = setup(new CopyPlace('A.stet'));
  edit();
  await s.tick();
  assert.equal(drafts(), 1);
  assert.equal(await s.save(), false);
  assert.equal(stateText(s), 'KEPT IN THIS BROWSER');
  s.savedAs(new CopyPlace('A.stet'), 2);
  assert.equal(s.dirty, false);
  assert.equal(stateText(s), 'COPY SAVED');
});

// ---- Google Drive ----

const res = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, arrayBuffer: async () => Uint8Array.of(1, 2).buffer });
function drive(replies, token = 'tok') {
  const calls = [], waits = [];
  const c = new DriveClient({ token: () => token, wait: async (ms) => { waits.push(ms); }, fetch: async (url, init) => { calls.push({ url, init }); const r = replies.shift(); if (r instanceof Error) throw r; return r; } });
  return { c, calls, waits };
}
const codeOf = async (p) => { try { await p; return 'none'; } catch (e) { assert.ok(e instanceof DriveError, String(e)); return e.code; } };

test('Drive: every call carries the token, and only the drive.file file is touched', async () => {
  const { c, calls } = drive([res(200, { version: '7' })]);
  await c.update('id/1', Uint8Array.of(1));
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.match(calls[0].url, /upload\/drive\/v3\/files\/id%2F1\?uploadType=media/);
});

test('Drive: a new file goes up with its name and content in one request', async () => {
  const { c, calls } = drive([res(200, { id: 'n', name: 'A.stet', version: '1' })]);
  const made = await c.create('A "B".stet', Uint8Array.of(9, 8));
  assert.equal(made.id, 'n');
  const body = await calls[0].init.body.text();
  assert.match(calls[0].init.headers['Content-Type'], /^multipart\/related; boundary=/);
  assert.ok(body.includes(JSON.stringify({ name: 'A "B".stet', mimeType: 'application/octet-stream' })));
});

test('Drive: busy servers and lost connections are retried, then reported', async () => {
  const a = drive([res(503), res(429), res(200, { version: '1' })]);
  await a.c.meta('x');
  assert.equal(a.calls.length, 3);
  assert.deepEqual(a.waits, [1000, 2000]);
  const b = drive([new TypeError('x'), new TypeError('x'), new TypeError('x')]);
  assert.equal(await codeOf(b.c.meta('x')), 'offline');
  assert.equal(b.calls.length, 3);
});

test('Drive: each refusal says what it is, and none is retried', async () => {
  const quota = { error: { errors: [{ reason: 'storageQuotaExceeded' }] } };
  for (const [r, code] of [[res(401), 'auth'], [res(404), 'gone'], [res(403, quota), 'full'], [res(403, {}), 'denied'], [res(400), 'failed']]) {
    const d = drive([r]);
    assert.equal(await codeOf(d.c.meta('x')), code);
    assert.equal(d.calls.length, 1);
  }
});

test('Drive: no token, no call', async () => {
  const d = drive([], null);
  assert.equal(await codeOf(d.c.meta('x')), 'auth');
  assert.equal(d.calls.length, 0);
});

test('Drive: a change from elsewhere is seen by the version, and a save moves it on', async () => {
  const d = drive([res(200, { version: '5' }), res(200, { version: '6' }), res(200, { version: '6' }), res(200, { version: '9' })]);
  const p = new DrivePlace(d.c, { id: 'a', name: 'A.stet', version: '5' });
  assert.equal(await p.changedElsewhere(), false);
  await p.write(Uint8Array.of(1));
  assert.equal(p.version, '6');
  assert.equal(await p.changedElsewhere(), false);
  assert.equal(await p.changedElsewhere(), true);
});

test('Drive is off until its settings are in, and a saved place holds no token', () => {
  assert.equal(driveConfigured({ clientId: '', apiKey: '', projectNumber: '' }), false);
  assert.equal(driveConfigured({ clientId: 'a', apiKey: 'b', projectNumber: '1' }), true);
  const p = new DrivePlace({ token: () => 'secret' }, { id: 'a', name: 'A.stet' });
  assert.ok(!JSON.stringify(p.remember()).includes('secret'));
});

// ---- the device ----

test('each browser is taken for what it can do', () => {
  const chrome = abilities({ navigator: { userAgent: 'Chrome', platform: 'Win32' }, showOpenFilePicker() {}, showSaveFilePicker() {} });
  assert.deepEqual(chrome, { inPlace: true, share: false, apple: false });
  const iphone = abilities({ navigator: { userAgent: 'iPhone', canShare() {}, share() {} } });
  assert.deepEqual(iphone, { inPlace: false, share: true, apple: true });
  assert.equal(abilities({ navigator: { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 } }).apple, true, 'an iPad says it is a Mac');
  assert.equal(abilities({ navigator: { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 } }).apple, false);
});

test('a file handle notices a change from elsewhere and takes its new date after a save', async () => {
  let modified = 100;
  const handle = { name: 'A.stet', getFile: async () => ({ lastModified: modified }), createWritable: async () => ({ write: async () => {}, close: async () => { modified = 200; } }) };
  const p = new HandlePlace(handle, 100);
  assert.equal(await p.changedElsewhere(), false);
  await p.write(Uint8Array.of(1));
  assert.equal(p.modified, 200);
  assert.equal(await p.changedElsewhere(), false);
  modified = 300;
  assert.equal(await p.changedElsewhere(), true);
});

function fakeWindow(nav) {
  const made = [];
  return {
    made, navigator: nav, File: class { constructor(parts, name, o) { this.name = name; this.type = o.type; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    document: { createElement: (tag) => { const el = { tag, click() { made.push(this); }, addEventListener() {} }; return el; } },
  };
}

test('on an iPhone a copy goes to the share sheet (Save to Files reaches iCloud Drive)', async () => {
  const shared = [];
  const w = fakeWindow({ userAgent: 'iPhone', canShare: () => true, share: async (d) => { shared.push(d.files[0].name); } });
  assert.equal(await handOver(Uint8Array.of(1), 'A.stet', { w }), 'shared');
  assert.deepEqual(shared, ['A.stet']);
});

test('closing the share sheet is not an error and nothing is saved; anywhere else a copy downloads', async () => {
  const closed = fakeWindow({ userAgent: 'iPhone', canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
  assert.equal(await handOver(Uint8Array.of(1), 'A.stet', { w: closed }), null);
  const plain = fakeWindow({ userAgent: 'Firefox', platform: 'Win32' });
  assert.equal(await handOver(Uint8Array.of(1), 'A.stet', { w: plain }), 'downloaded');
  assert.equal(plain.made[0].download, 'A.stet');
});

test('an iPhone is offered every file: it greys out extensions it does not know', async () => {
  const w = fakeWindow({ userAgent: 'iPhone' });
  const picking = pickFile(w);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.made[0].accept, undefined);
  const desk = fakeWindow({ userAgent: 'Firefox', platform: 'Win32' });
  pickFile(desk);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(desk.made[0].accept, '.stet,.fdx');
  void picking;
});

// ---- the screen ----

test('the page fits the screen: the whole sheet while it can, then the text column', () => {
  assert.deepEqual(fit(1400), { z: 1, left: 0 });
  const tablet = fit(768);
  assert.ok(tablet.z < 1 && tablet.z >= 0.8 && tablet.left === 0, JSON.stringify(tablet));
  const phone = fit(375);
  assert.ok(phone.z >= 0.5 && phone.z < 0.8 && phone.left > 0, JSON.stringify(phone));
  assert.ok(5.77 * 96 * phone.z <= 375, 'the text column is all on screen');
  assert.ok(fit(200).z >= 0.5, 'never under the smallest zoom');
});
