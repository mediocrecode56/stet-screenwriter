// A patch update in the real app, against a local stand-in for GitHub: offered with its small size,
// downloaded and unpacked, run on the next start (src/main/boot.js) and not offered again; one that
// can't start is set aside and the last good version starts instead. The Mac release job runs this
// against the packaged STET.app (STET_E2E_EXE).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { App, scratch, userData, ROOT, sleep } from './harness.js';
import { makeZip, folderEntries } from '../../src/main/zip.js';
import { patchAsset } from '../../src/main/patch.js';

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const CURRENT = pkg.version, ELECTRON = pkg.devDependencies.electron.replace(/^[^\d]*/, '');
const sha = (b) => createHash('sha256').update(b).digest('hex');

let tmp, server, base, latest, app, PATCH, checks = 0;
before(async () => {
  tmp = await scratch('stet-patch');
  // The patch: this very app as 99.0.0 (node_modules is linked in after unpacking, to keep it small).
  const src = path.join(tmp, 'src-99');
  await fs.cp(path.join(ROOT, 'src'), path.join(src, 'src'), { recursive: true });
  await fs.writeFile(path.join(src, 'package.json'), JSON.stringify({ ...pkg, version: '99.0.0' }));
  await fs.writeFile(path.join(src, 'CHANGELOG.md'), '# What\'s new\n');
  PATCH = makeZip(await folderEntries(src));
  latest = { tag_name: 'v99.0.0', draft: false, prerelease: false, html_url: 'https://example.invalid', body: '- A small update.', assets: [{ name: patchAsset(ELECTRON), browser_download_url: '/patch', size: PATCH.length, digest: 'sha256:' + sha(PATCH) }] };
  server = http.createServer((req, res) => {
    if (req.url === '/latest') { checks++; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ...latest, assets: latest.assets.map((a) => ({ ...a, browser_download_url: base + a.browser_download_url })) })); }
    if (req.url === '/patch') { res.writeHead(200, { 'content-length': PATCH.length }); return res.end(PATCH); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await app?.close(); server?.closeAllConnections(); server?.close(); });

const env = (o = {}) => ({ STET_UPDATE_URL: base + '/latest', STET_UPDATE_DELAY_MS: '100', ...o });
const version = () => app.eval(`document.getElementById('ver').textContent`);
const checked = async (n) => { await app.until(() => checks >= n, { what: 'the check on start' }); await sleep(150); };

test('a patch: offered with its small size, unpacked, then run on the next start, kept, and not offered again', async () => {
  const ud = await userData(), patches = path.join(tmp, 'app');
  app = await App.launch({ userData: ud, env: env({ STET_PATCH_DIR: patches }) });
  assert.equal(await version(), `${CURRENT} β`);
  await app.dialogMatching(/99\.0\.0 is available[\s\S]*A \d\.\d MB download\./);
  await app.press('Update now');
  await app.dialogMatching(/99\.0\.0 is ready[\s\S]*STET restarts with the new version/);
  const unpacked = path.join(patches, '99.0.0');
  assert.equal(JSON.parse(await fs.readFile(path.join(unpacked, 'package.json'), 'utf8')).version, '99.0.0');
  await app.press('Restart now');
  await app.dialogMatching(/Restarting…/);
  await app.close();
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(unpacked, 'node_modules'), 'junction');
  const n = checks;
  app = await App.launch({ userData: ud, env: env({ STET_PATCH_DIR: patches }) });
  assert.equal(await version(), '99.0.0 β', 'the new version runs');
  await checked(n + 1);
  assert.equal(await app.dialog(), '', 'no update window');
  assert.equal(await app.eval(`document.getElementById('st-update').hidden`), true, 'no UPDATE button');
  await app.until(() => fs.access(path.join(unpacked, '.ok')).then(() => true, () => false), { what: 'marked as working' });
  await app.close();
  // A patch that cannot start is set aside, and STET starts all the same, from then on with the last good one.
  const broken = path.join(patches, '99.0.1');
  // (its node_modules linked again as a junction: copied, it would become a symlink, which Windows allows only with a privilege)
  await fs.cp(unpacked, broken, { recursive: true, filter: (f) => path.basename(f) !== 'node_modules' });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(broken, 'node_modules'), 'junction');
  await fs.rm(path.join(broken, '.ok'), { force: true });
  await fs.writeFile(path.join(broken, '.stet-patch.json'), JSON.stringify({ version: '99.0.1', electron: ELECTRON }));
  await fs.writeFile(path.join(broken, 'src', 'main', 'main.js'), 'this is not JavaScript (');
  app = await App.launch({ userData: ud, env: env({ STET_PATCH_DIR: patches }) });
  app.expect(/the update could not start/);
  assert.match(await version(), /β$/, 'STET is up');
  await fs.access(path.join(broken, '.failed'));
  await app.close();
  app = await App.launch({ userData: ud, env: env({ STET_PATCH_DIR: patches }) });
  assert.equal(await version(), '99.0.0 β', 'the last good version from then on');
});
