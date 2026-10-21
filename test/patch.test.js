// Patch updates (src/main/patch.js, and the Updater's patch mode in src/main/update.js):
// a small download of STET's code, unpacked into a folder of its own, chosen at start by
// src/main/boot.js. GitHub is replaced by a local HTTP server.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { patchAsset, patchRoot, installPatch, choosePatch, beginLaunch, confirmLaunch, cleanupPatches, listPatches } from '../src/main/patch.js';
import { makeZip, zipEntries, extractZip, folderEntries } from '../src/main/zip.js';
import { Updater, ASSETS } from '../src/main/update.js';

const ELECTRON = '44.5.1';
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** A patch as the release workflow makes it: the app's files, its package.json naming its version and Electron. */
const patchZip = (version, { electron = ELECTRON, main = true } = {}) => makeZip([
  { name: 'package.json', data: Buffer.from(JSON.stringify({ name: 'stet', version, main: 'src/main/boot.js', devDependencies: { electron } })) },
  ...(main ? [{ name: 'src/main/boot.js', data: Buffer.from('// boot') }, { name: 'src/main/main.js', data: Buffer.from(`// STET ${version}`) }] : []),
  { name: 'src/renderer/index.html', data: Buffer.from('<!doctype html>'.repeat(200)) },
]);

let tmp, server, base, routes;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-patch-'));
  routes = {};
  server = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': r.type || 'application/octet-stream', 'content-length': r.body.length });
    res.end(r.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await fs.rm(tmp, { recursive: true, force: true }); });

const zipFile = async (name, buf) => { const f = path.join(tmp, name); await fs.writeFile(f, buf); return f; };

test('zip: written, read back and unpacked, every file checked', async () => {
  const src = path.join(tmp, 'zsrc');
  await fs.mkdir(path.join(src, 'a', 'b'), { recursive: true });
  await fs.writeFile(path.join(src, 'top.txt'), 'top');
  await fs.writeFile(path.join(src, 'a', 'b', 'deep.bin'), Buffer.alloc(5000, 9));
  const zip = makeZip(await folderEntries(src));
  assert.deepEqual(zipEntries(zip).map((e) => e.name), ['a/b/deep.bin', 'top.txt']);
  const out = path.join(tmp, 'zout');
  await extractZip(await zipFile('z.zip', zip), out);
  assert.equal(await fs.readFile(path.join(out, 'top.txt'), 'utf8'), 'top');
  assert.deepEqual(await fs.readFile(path.join(out, 'a', 'b', 'deep.bin')), Buffer.alloc(5000, 9));
  // A damaged one is refused, and nothing escapes the folder.
  const bad = Buffer.from(zip); bad[50] ^= 0xff; // inside the first file's data
  await assert.rejects(extractZip(await zipFile('bad.zip', bad), path.join(tmp, 'zbad')));
  await assert.rejects(extractZip(await zipFile('evil.zip', makeZip([{ name: '../evil.txt', data: Buffer.from('x') }])), path.join(tmp, 'zevil')), /unsafe/);
  await assert.rejects(fs.access(path.join(tmp, 'evil.txt')));
});

test('patches live in Local AppData on Windows only (or where tests say)', () => {
  assert.equal(patchRoot({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32'), path.join('C:\\Users\\a\\AppData\\Local', 'STET', 'app'));
  assert.equal(patchRoot({}, 'linux'), null);
  assert.equal(patchRoot({ STET_PATCH_DIR: '/x' }, 'linux'), '/x');
  assert.equal(patchAsset('44.5.1'), 'STET-Patch-electron-44.5.1.zip');
});

test('a patch is unpacked only if it is the version and Electron it should be', async () => {
  const root = path.join(tmp, 'p1');
  await installPatch({ zipPath: await zipFile('a.zip', patchZip('0.21.0')), root, version: '0.21.0', electron: ELECTRON });
  assert.equal(await fs.readFile(path.join(root, '0.21.0', 'src', 'main', 'main.js'), 'utf8'), '// STET 0.21.0');
  assert.deepEqual(listPatches(root).map((p) => p.version), ['0.21.0']);
  for (const [zip, why] of [[patchZip('0.20.9'), 'another version'], [patchZip('0.21.1', { electron: '45.0.0' }), 'another Electron'], [patchZip('0.21.1', { main: false }), 'incomplete']]) {
    await assert.rejects(installPatch({ zipPath: await zipFile('b.zip', zip), root, version: '0.21.1', electron: ELECTRON }), /isn't the version/, why);
  }
  await assert.rejects(installPatch({ zipPath: await zipFile('c.zip', Buffer.from('not a zip at all, no')), root, version: '0.21.1', electron: ELECTRON }), /damaged/);
  assert.deepEqual((await fs.readdir(root)).sort(), ['0.21.0'], 'nothing half-unpacked left behind');
});

test('at start: the newest patch for this Electron, newer than the shipped version; one that never reached its window is never used again', async () => {
  const root = path.join(tmp, 'p2');
  for (const [v, e] of [['0.20.5', ELECTRON], ['0.21.0', ELECTRON], ['0.22.0', '45.0.0'], ['0.19.0', ELECTRON]]) {
    await installPatch({ zipPath: await zipFile('x.zip', patchZip(v, { electron: e })), root, version: v, electron: e });
  }
  await fs.mkdir(path.join(root, '0.23.0.tmp-123')); // an interrupted download
  assert.equal(choosePatch({ root, base: '0.20.2', electron: ELECTRON }).version, '0.21.0', 'not the one for another Electron');
  assert.equal(choosePatch({ root, base: '0.21.0', electron: ELECTRON }), null, 'the shipped version, when it is as new');
  assert.equal(choosePatch({ root: null, base: '0.20.2', electron: ELECTRON }), null);

  // 0.21.0 starts but never gets as far as its window (a crash): next time 0.20.5 starts instead.
  const p = choosePatch({ root, base: '0.20.2', electron: ELECTRON });
  beginLaunch(p.dir);
  assert.equal(choosePatch({ root, base: '0.20.2', electron: ELECTRON }).version, '0.20.5');
  assert.equal(choosePatch({ root, base: '0.20.2', electron: ELECTRON }).version, '0.20.5', 'and stays skipped');
  // One that worked once is trusted from then on.
  const q = choosePatch({ root, base: '0.20.2', electron: ELECTRON });
  beginLaunch(q.dir);
  await confirmLaunch(q.dir);
  beginLaunch(q.dir);
  assert.equal(choosePatch({ root, base: '0.20.2', electron: ELECTRON }).version, '0.20.5');

  // Cleaning up while 0.20.5 runs: older ones and leftovers go; newer ones (failed or waiting) stay.
  await cleanupPatches({ root, running: '0.20.5', keep: q.dir });
  assert.deepEqual((await fs.readdir(root)).sort(), ['0.20.5', '0.21.0', '0.22.0']);
});

test('the whole update as a patch: a small download, unpacked, then a restart of the same STET; no installer', async () => {
  const root = path.join(tmp, 'p3');
  const patch = patchZip('0.21.0');
  const setup = Buffer.alloc(100000, 1);
  routes['/patch'] = { body: patch };
  routes['/latest'] = { type: 'application/json', body: Buffer.from(JSON.stringify({
    tag_name: 'v0.21.0', draft: false, prerelease: false, body: '- New.', html_url: 'https://example.invalid',
    assets: [
      { name: patchAsset(ELECTRON), browser_download_url: base + '/patch', size: patch.length, digest: 'sha256:' + sha(patch) },
      { name: ASSETS.installer, browser_download_url: base + '/setup', size: setup.length, digest: 'sha256:' + sha(setup) },
    ],
  })) };
  const make = (electron = ELECTRON, patches = root) => new Updater({ current: '0.20.2', fetch, kind: { kind: 'installer' }, patches, electron, dir: path.join(tmp, 'w3'), url: base + '/latest' });
  const u = make();
  const r = await u.check();
  assert.equal(r.kind, 'patch');
  assert.equal(r.size, patch.length, 'the size of the patch, not of the installer');
  assert.equal(r.ready, false);
  const seen = [];
  await u.download((got, total) => seen.push([got, total]));
  assert.equal(seen.at(-1)[0], patch.length);
  assert.ok(listPatches(root).some((p) => p.version === '0.21.0'), 'unpacked, waiting for the restart');
  let relaunched;
  await u.apply({ spawn: () => assert.fail('no installer for a patch'), relaunch: (exe) => { relaunched = exe; } });
  assert.equal(relaunched, null, 'the same STET.exe starts again');
  // Found again before the restart (or after STET was closed instead): ready at once, nothing downloaded twice.
  routes['/patch'] = { body: Buffer.from('gone') };
  const again = await make().check();
  assert.equal(again.ready, true);
  // A different Electron, or no place for patches: the full download.
  assert.equal((await make('45.0.0').check()).kind, 'installer');
  assert.equal((await make(ELECTRON, null).check()).kind, 'installer');
  // A patch that failed to start: never offered again; the full download instead.
  await fs.writeFile(path.join(root, '0.21.0', '.failed'), '');
  assert.equal((await make().check()).kind, 'installer');
});
