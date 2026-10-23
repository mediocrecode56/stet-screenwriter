// In-app updates (src/main/update.js): finding a newer release, downloading it with its
// checks, unpacking the portable STET.exe and swapping it in. GitHub is replaced by a
// local HTTP server; nothing here touches the network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  compareVersions, parseRelease, checkForUpdate, installKind, download, readZipEntry,
  preparePortable, swapPortable, cleanupPortable, Updater, UpdateError, ASSETS, INSTALLER_ARGS,
} from '../../src/main/update.js';
import { makeZip } from '../helpers/zip.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300000, 7)]); // a stand-in STET.exe
const ZIP = makeZip([{ name: 'STET.exe', data: EXE }]);
const SETUP = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200000, 3)]);

let tmp, server, base, routes;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-upd-'));
  routes = {};
  server = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) { res.writeHead(404); return res.end(); }
    if (typeof r === 'function') return r(req, res);
    res.writeHead(r.status || 200, { 'content-type': r.type || 'application/octet-stream', 'content-length': r.body.length });
    res.end(r.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); server.close(); await fs.rm(tmp, { recursive: true, force: true }); });

function release(version, { zip = ZIP, setup = SETUP, digest = true } = {}) {
  return {
    tag_name: 'v' + version, html_url: 'https://example.invalid/r', draft: false, prerelease: false,
    body: '**To get STET, download STET-Windows.zip below, unzip it and double-click STET.exe.** More.\n\n- Fixed a thing.\n- Changed another.\n',
    assets: [
      { name: ASSETS.portable, browser_download_url: base + '/zip', size: zip.length, digest: digest ? 'sha256:' + sha(zip) : null },
      { name: ASSETS.installer, browser_download_url: base + '/setup', size: setup.length, digest: digest ? 'sha256:' + sha(setup) : null },
    ],
  };
}
const json = (o, status = 200) => ({ status, type: 'application/json', body: Buffer.from(JSON.stringify(o)) });

test('versions compare by number, not text', () => {
  assert.equal(compareVersions('0.19.10', '0.19.9'), 1);
  assert.equal(compareVersions('v0.20.0', '0.19.4'), 1);
  assert.equal(compareVersions('0.19.4', 'v0.19.4'), 0);
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

test('a release is read with its files, checksums and notes (without the download instructions)', () => {
  const r = parseRelease(release('0.20.0'));
  assert.equal(r.version, '0.20.0');
  assert.equal(r.notes, '- Fixed a thing.\n- Changed another.');
  assert.equal(r.assets[ASSETS.portable].sha256, sha(ZIP));
  assert.equal(r.assets[ASSETS.installer].size, SETUP.length);
  assert.equal(parseRelease({ ...release('0.20.0'), draft: true }), null);
  assert.equal(parseRelease({ ...release('0.20.0'), prerelease: true }), null);
  assert.equal(parseRelease({ ...release('0.20.0'), tag_name: 'nightly' }), null);
  assert.equal(parseRelease(null), null);
});

test('checking: newer, the same, older, and every way GitHub can fail', async () => {
  const at = (r) => { routes['/latest'] = r; return checkForUpdate({ current: '0.19.4', fetch, url: base + '/latest' }); };
  const newer = await at(json(release('0.20.0')));
  assert.equal(newer.status, 'available');
  assert.equal(newer.version, '0.20.0');
  assert.equal(newer.current, '0.19.4');
  assert.deepEqual(await at(json(release('0.19.4'))), { status: 'current', version: '0.19.4' });
  assert.equal((await at(json(release('0.19.0')))).status, 'current', 'never offers an older version');
  for (const [r, words] of [
    [{ status: 404, body: Buffer.from('') }, 'No published version'],
    [{ status: 403, body: Buffer.from('') }, 'limiting requests'],
    [{ status: 500, body: Buffer.from('') }, '500'],
    [{ status: 200, body: Buffer.from('not json') }, 'could not read'],
    [json({ tag_name: 'v0.20.0', draft: true }), 'could not read'],
  ]) {
    const res = await at(r);
    assert.equal(res.status, 'error');
    assert.match(res.message, new RegExp(words));
  }
  const offline = await checkForUpdate({ current: '0.19.4', fetch: () => Promise.reject(new Error('offline')) });
  assert.equal(offline.status, 'error');
  assert.match(offline.message, /internet connection/);
});

test('how this copy was installed decides how it updates', () => {
  const base = { platform: 'win32', packaged: true, execPath: '/apps/STET/STET.exe', env: {}, exists: () => false };
  assert.deepEqual(installKind(base), { kind: 'manual' }, 'a plain folder updates from the website');
  assert.deepEqual(installKind({ ...base, exists: (f) => f === path.join('/apps/STET', 'unins000.exe') }), { kind: 'installer' });
  assert.deepEqual(installKind({ ...base, env: { STET_PORTABLE_EXE: '/me/Desktop/STET.exe' } }), { kind: 'portable', target: '/me/Desktop/STET.exe' });
  assert.deepEqual(installKind({ ...base, packaged: false, env: { STET_PORTABLE_EXE: '/x/STET.exe' } }), { kind: 'manual' }, 'running from source');
  assert.deepEqual(installKind({ ...base, platform: 'linux' }), { kind: 'manual' });
});

test('a download is checked against the published size and SHA-256 before it is used', async () => {
  routes['/zip'] = { body: ZIP };
  const dest = path.join(tmp, 'dl', 'STET-Windows.zip');
  const seen = [];
  await download({ asset: parseRelease(release('0.20.0')).assets[ASSETS.portable], dest, fetch, onProgress: (r, t) => seen.push([r, t]) });
  assert.deepEqual(await fs.readFile(dest), ZIP);
  assert.equal(seen.at(-1)[0], ZIP.length);
  assert.equal(seen.at(-1)[1], ZIP.length);
  assert.ok(seen.every(([r], i) => i === 0 || r >= seen[i - 1][0]), 'progress only goes forward');

  const tampered = { ...parseRelease(release('0.20.0')).assets[ASSETS.portable], sha256: 'f'.repeat(64) };
  const bad = path.join(tmp, 'dl', 'bad.zip');
  await assert.rejects(download({ asset: tampered, dest: bad, fetch }), /didn't match/);
  await assert.rejects(fs.access(bad), 'nothing is left behind');
  await assert.rejects(fs.access(bad + '.part'));
  await assert.rejects(download({ asset: { ...tampered, sha256: null, size: ZIP.length + 1 }, dest: bad, fetch }), /didn't match/);

  routes['/gone'] = { status: 404, body: Buffer.from('') };
  await assert.rejects(download({ asset: { url: base + '/gone', size: 1 }, dest: bad, fetch }), /download failed \(404\)/);
});

test('a download can be cancelled midway, leaving nothing behind', async () => {
  routes['/slow'] = (_req, res) => {
    res.writeHead(200, { 'content-length': 1000000 });
    res.write(Buffer.alloc(1000));
    const t = setInterval(() => res.write(Buffer.alloc(1000)), 20);
    res.on('close', () => clearInterval(t));
  };
  const ac = new AbortController();
  const dest = path.join(tmp, 'dl', 'slow.bin');
  const p = download({ asset: { url: base + '/slow', size: 1000000 }, dest, fetch, signal: ac.signal, onProgress: (r) => { if (r >= 3000) ac.abort(); } });
  await assert.rejects(p, (e) => e instanceof UpdateError && e.cancelled);
  await assert.rejects(fs.access(dest + '.part'));
});

test('the zip reader finds STET.exe (deflated or stored, in a folder or not) and refuses damage', async () => {
  const z = path.join(tmp, 'a.zip');
  await fs.writeFile(z, makeZip([{ name: 'readme.txt', data: Buffer.from('hi') }, { name: 'STET/STET.exe', data: EXE }]));
  assert.deepEqual(await readZipEntry(z, 'STET.exe'), EXE);
  await fs.writeFile(z, makeZip([{ name: 'STET.exe', data: EXE, method: 0 }]));
  assert.deepEqual(await readZipEntry(z, 'stet.exe'), EXE);
  await assert.rejects(readZipEntry(z, 'Other.exe'), /has no Other\.exe/);
  const broken = Buffer.from(ZIP);
  broken[60] ^= 0xff; // inside the compressed data
  await fs.writeFile(z, broken);
  await assert.rejects(readZipEntry(z, 'STET.exe'), /damaged/);
  await fs.writeFile(z, Buffer.from('not a zip at all'));
  await assert.rejects(readZipEntry(z, 'STET.exe'), /damaged/);
});

test('the portable STET.exe is replaced by renaming, with the old one kept until the next start', async () => {
  const dir = path.join(tmp, 'portable');
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, 'STET.exe');
  await fs.writeFile(target, 'old version');
  const z = path.join(tmp, 'p.zip');
  await fs.writeFile(z, ZIP);
  await preparePortable({ zipPath: z, target });
  assert.equal(await fs.readFile(target, 'utf8'), 'old version', 'nothing changes until the swap');
  await swapPortable(target);
  assert.deepEqual(await fs.readFile(target), EXE);
  assert.equal(await fs.readFile(target + '.old', 'utf8'), 'old version');
  await assert.rejects(fs.access(target + '.new'));
  await cleanupPortable(target);
  await assert.rejects(fs.access(target + '.old'));
  assert.deepEqual(await fs.readFile(target), EXE);

  // Not a Windows program: refused before anything is written.
  await fs.writeFile(z, makeZip([{ name: 'STET.exe', data: Buffer.from('hello') }]));
  await assert.rejects(preparePortable({ zipPath: z, target }), /not a Windows program/);
  await assert.rejects(fs.access(target + '.new'));
  // A folder STET can't write to: a clear message, the running STET.exe untouched.
  await fs.writeFile(z, ZIP);
  await assert.rejects(preparePortable({ zipPath: z, target: path.join(tmp, 'no-such-folder', 'STET.exe') }), /can't replace itself/);
  await assert.rejects(swapPortable(path.join(tmp, 'no-such-folder', 'STET.exe')), /can't replace itself/);
});

test('the whole update for the portable STET.exe: check, download, unpack, swap, relaunch', async () => {
  routes['/latest'] = json(release('0.20.0'));
  routes['/zip'] = { body: ZIP };
  const dir = path.join(tmp, 'flow-portable');
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, 'STET.exe');
  await fs.writeFile(target, 'old version');
  const u = new Updater({ current: '0.19.4', fetch, kind: { kind: 'portable', target }, dir: path.join(tmp, 'work1'), url: base + '/latest' });
  await assert.rejects(u.download(), /Check for updates first/);
  const r = await u.check();
  assert.equal(r.status, 'available');
  assert.equal(r.kind, 'portable');
  assert.equal(r.ready, false);
  assert.equal(r.assets, undefined, 'download addresses stay in the main process');
  let last = 0;
  await u.download((rec) => { last = rec; });
  assert.equal(last, ZIP.length);
  assert.equal((await u.check()).ready, true, 'a second check knows it is already downloaded');
  const again = await u.download(() => assert.fail('no second download'));
  assert.equal(again.version, '0.20.0');
  let relaunched = null;
  await u.apply({ spawn: () => assert.fail('no installer for the portable copy'), relaunch: (exe) => { relaunched = exe; } });
  assert.equal(relaunched, target);
  assert.deepEqual(await fs.readFile(target), EXE);
});

test('the whole update for an installed STET (a new Electron): the new installer runs invisibly once STET has closed, and reopens it', async () => {
  routes['/latest'] = json(release('0.20.0'));
  routes['/setup'] = { body: SETUP };
  const u = new Updater({ current: '0.19.4', fetch, kind: { kind: 'installer' }, dir: path.join(tmp, 'work2'), url: base + '/latest' });
  await u.check();
  await u.download(() => {});
  let call = null;
  const spawn = (file, args, opts) => {
    call = { file, args, opts };
    const child = new EventEmitter();
    child.unref = () => { call.unref = true; };
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  await u.apply({ spawn, pid: 4242, relaunch: () => assert.fail('the installer reopens STET itself') });
  assert.equal(call.file, path.join(tmp, 'work2', ASSETS.installer));
  assert.deepEqual(await fs.readFile(call.file), SETUP);
  assert.deepEqual(call.args, [...INSTALLER_ARGS, '/waitpid=4242']);
  assert.ok(call.args.includes('/relaunch=1') && call.args.includes('/VERYSILENT'), 'no installer window at all');
  assert.ok(!call.args.includes('/SILENT'));
  assert.equal(call.opts.detached, true);
  assert.equal(call.unref, true);

  // An installer that can't start: a clear error, and STET stays open (the caller only quits on success).
  const failing = () => { const c = new EventEmitter(); c.unref = () => {}; setImmediate(() => c.emit('error', new Error('ENOENT'))); return c; };
  await assert.rejects(u.apply({ spawn: failing, relaunch: () => {} }), /installer couldn't be started/);
});

test('a copy that updates from the website is never asked to install, and a missing file is explained', async () => {
  routes['/latest'] = json({ ...release('0.20.0'), assets: [] });
  const u = new Updater({ current: '0.19.4', fetch, kind: { kind: 'portable', target: path.join(tmp, 'x.exe') }, dir: path.join(tmp, 'work3'), url: base + '/latest' });
  await u.check();
  await assert.rejects(u.download(() => {}), /no download for your copy/);
  const m = new Updater({ current: '0.19.4', fetch, kind: { kind: 'manual' }, dir: path.join(tmp, 'work4'), url: base + '/latest' });
  await assert.rejects(m.apply({ spawn: () => {}, relaunch: () => {} }), /Nothing has been downloaded/);
});
