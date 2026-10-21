// A patch update in the real app, against a local stand-in for GitHub: the offer with its
// small download size, the download and unpacking, the restart; then STET started again
// runs the new version (src/main/boot.js) and doesn't offer the same update again. A
// patch that can't start is set aside and the shipped version starts instead.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { App, sleep } from './cdp.js';
import { makeZip, folderEntries } from '../../src/main/zip.js';
import { patchAsset } from '../../src/main/patch.js';

const ROOT = new URL('../../', import.meta.url);
const pkg = JSON.parse(await fs.readFile(new URL('package.json', ROOT), 'utf8'));
const CURRENT = pkg.version, ELECTRON = pkg.devDependencies.electron.replace(/^[^\d]*/, '');
const sha = (b) => createHash('sha256').update(b).digest('hex');

let tmp, ud, patches, server, base, latest, PATCH, app;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-patch-e2e-'));
  ud = path.join(tmp, 'ud');
  patches = path.join(tmp, 'app');
  // The patch: this very app, as version 99.0.0 (node_modules is linked in after unpacking, to keep it small).
  const src = path.join(tmp, 'src-99');
  await fs.cp(new URL('src', ROOT), path.join(src, 'src'), { recursive: true });
  await fs.writeFile(path.join(src, 'package.json'), JSON.stringify({ ...pkg, version: '99.0.0' }));
  await fs.writeFile(path.join(src, 'CHANGELOG.md'), '# What\'s new\n');
  PATCH = makeZip(await folderEntries(src));
  latest = {
    tag_name: 'v99.0.0', draft: false, prerelease: false, html_url: 'https://example.invalid',
    body: '**To get STET, download STET-Windows.zip below.**\n\n- A small update.',
    assets: [{ name: patchAsset(ELECTRON), browser_download_url: '/patch', size: PATCH.length, digest: 'sha256:' + sha(PATCH) }],
  };
  server = http.createServer((req, res) => {
    if (req.url === '/latest') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ...latest, assets: latest.assets.map((a) => ({ ...a, browser_download_url: base + a.browser_download_url })) })); }
    if (req.url === '/patch') { res.writeHead(200, { 'content-length': PATCH.length }); return res.end(PATCH); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (app) await app.close();
  server?.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

const env = () => ({ STET_UPDATE_URL: base + '/latest', STET_PATCH_DIR: patches });
const dialogText = () => app.eval(`document.querySelector('#overlay .dlg')?.innerText || ''`);
const click = (label) => app.eval(`(() => { const b = [...document.querySelectorAll('#overlay .dlg .foot button')].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
async function until(fn, what, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return;
  assert.fail('timed out waiting for ' + what);
}
const version = () => app.eval(`document.getElementById('ver').textContent`);

test('a small update: offered with its size, downloaded and unpacked, then a restart', async () => {
  app = await App.launch({ userData: ud, env: env() });
  assert.equal(await version(), `${CURRENT} β`);
  await until(async () => (await dialogText()).includes('99.0.0 is available'), 'the update window');
  assert.match(await dialogText(), /A \d\.\d MB download\./, 'the size of the patch');
  assert.ok(await click('Update now'));
  await until(async () => (await dialogText()).includes('99.0.0 is ready'), 'the restart prompt');
  assert.match(await dialogText(), /STET restarts with the new version/);
  const unpacked = path.join(patches, '99.0.0');
  assert.equal(JSON.parse(await fs.readFile(path.join(unpacked, 'package.json'), 'utf8')).version, '99.0.0');
  assert.ok(await click('Restart now'));
  await until(async () => (await dialogText()).includes('Restarting…'), 'restarting');
  await app.close();
  app = null;
  await fs.symlink(new URL('node_modules', ROOT).pathname, path.join(unpacked, 'node_modules'), 'junction');
});

test('started again: the new version runs, is kept, and the update is not offered again', async () => {
  app = await App.launch({ userData: ud, env: env() });
  assert.equal(await version(), '99.0.0 β');
  await sleep(4000); // the check on start
  assert.equal(await app.eval(`!!document.querySelector('#overlay .dlg')`), false, 'no update window');
  assert.equal(await app.eval(`document.getElementById('st-update').hidden`), true, 'no UPDATE button');
  await until(async () => fs.access(path.join(patches, '99.0.0', '.ok')).then(() => true, () => false), 'marked as working');
  await app.close();
  app = null;
});

test('a patch that cannot start is set aside, and STET starts all the same', async () => {
  const broken = path.join(patches, '99.0.1');
  await fs.cp(path.join(patches, '99.0.0'), broken, { recursive: true, verbatimSymlinks: true });
  await fs.rm(path.join(broken, '.ok'), { force: true });
  await fs.writeFile(path.join(broken, '.stet-patch.json'), JSON.stringify({ version: '99.0.1', electron: ELECTRON }));
  await fs.writeFile(path.join(broken, 'src', 'main', 'main.js'), 'this is not JavaScript (');
  app = await App.launch({ userData: ud, env: env() });
  assert.match(await version(), /β$/, 'STET is up');
  await fs.access(path.join(broken, '.failed'));
  await app.close();
  app = await App.launch({ userData: ud, env: env() });
  assert.equal(await version(), '99.0.0 β', 'the last good version from then on');
});
