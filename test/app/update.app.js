// Updates in the real app, against a local stand-in for GitHub: the check on start (the UPDATE
// button and its window, once per version), downloading with progress, the restart prompt and the
// portable STET.exe swapped on disk; Help > Check for Updates up to date or unable to reach GitHub;
// and a patch: offered with its small size, unpacked, run on the next start and not offered again,
// and one that can't start set aside. (The check on start comes sooner here: STET_UPDATE_DELAY_MS.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { App, scratch, userData, ROOT, sleep } from './harness.js';
import { makeZip, folderEntries } from '../../src/main/zip.js';
import { patchAsset } from '../../src/main/patch.js';

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const CURRENT = pkg.version, ELECTRON = pkg.devDependencies.electron.replace(/^[^\d]*/, '');
const EXE = Buffer.concat([Buffer.from('MZ'), randomBytes(2_000_000)]); // incompressible, so the download has a real size
const ZIP = makeZip([{ name: 'STET.exe', data: EXE }]);
const sha = (b) => createHash('sha256').update(b).digest('hex');

let tmp, server, base, latest, app, PATCH, checks = 0;
const release = (version, assets) => ({ tag_name: 'v' + version, draft: false, prerelease: false, html_url: 'https://example.invalid', body: '**To get STET, download STET-Windows.zip below.**\n\n- Something new.\n- Something fixed.', assets });
before(async () => {
  tmp = await scratch('stet-update');
  // The patch: this very app as 99.0.0 (node_modules is linked in after unpacking, to keep it small).
  const src = path.join(tmp, 'src-99');
  await fs.cp(path.join(ROOT, 'src'), path.join(src, 'src'), { recursive: true });
  await fs.writeFile(path.join(src, 'package.json'), JSON.stringify({ ...pkg, version: '99.0.0' }));
  await fs.writeFile(path.join(src, 'CHANGELOG.md'), '# What\'s new\n');
  PATCH = makeZip(await folderEntries(src));
  server = http.createServer((req, res) => {
    if (req.url === '/latest') {
      checks++;
      if (latest === 500) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...latest, assets: latest.assets.map((a) => ({ ...a, browser_download_url: base + a.browser_download_url })) }));
    }
    if (req.url === '/zip') { // in pieces, so the progress has something to show
      res.writeHead(200, { 'content-length': ZIP.length });
      let i = 0;
      const t = setInterval(() => { res.write(ZIP.subarray(i, i + 200_000)); i += 200_000; if (i >= ZIP.length) { clearInterval(t); res.end(); } }, 40);
      return;
    }
    if (req.url === '/patch') { res.writeHead(200, { 'content-length': PATCH.length }); return res.end(PATCH); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await app?.close(); server?.closeAllConnections(); server?.close(); });

const env = (o = {}) => ({ STET_UPDATE_URL: base + '/latest', STET_UPDATE_DELAY_MS: '100', ...o });
const version = () => app.eval(`document.getElementById('ver').textContent`);
/** The check on start has been made and answered (whatever it found). */
const checked = async (n) => { await app.until(() => checks >= n, { what: 'the check on start' }); await sleep(150); };

test('a newer release found on start: the UPDATE button and its window with the notes, shown once per version', async () => {
  const target = path.join(tmp, 'portable', 'STET.exe');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'the old STET.exe');
  latest = release('99.0.0', [{ name: 'STET-Windows.zip', browser_download_url: '/zip', size: ZIP.length, digest: 'sha256:' + sha(ZIP) }]);
  app = await App.launch({ userData: await userData(), env: env({ STET_UPDATE_TARGET: target }) });
  await app.dialogMatching(/99\.0\.0 is available/);
  const text = await app.dialog();
  assert.match(text, new RegExp(`You have ${CURRENT.replace(/\./g, '\\.')}`));
  assert.match(text, /Something new\.\s+Something fixed\./, 'the release notes, as a list');
  assert.doesNotMatch(text, /To get STET/, 'without the instructions meant for the release page');
  assert.equal(await app.eval(`document.getElementById('st-update').textContent`), 'UPDATE 99.0.0');
  assert.equal((await app.eval(`__stet.settings()`)).updateNotified, '99.0.0', 'remembered, so it is shown once');
  await app.press('Later');
  await app.noDialog();
  assert.equal(await app.eval(`document.getElementById('st-update').hidden`), false, 'the button stays');
  const look = await app.eval(`(() => { const s = getComputedStyle(document.getElementById('st-update')); return [s.borderRadius, s.boxShadow]; })()`);
  assert.equal(look[0], '0px', 'square');
  assert.doesNotMatch(look[1], /\d+px \d+px [1-9]/, 'no blurred shadow');
  // Update now: the progress, the restart prompt; restarting saves first and swaps STET.exe.
  await app.clickOn('#st-update');
  await app.dialogMatching(/99\.0\.0 is available/);
  await app.press('Update now');
  await app.dialogMatching(/Downloading…[\s\S]*of 1\.9 MB/);
  const widths = [], labels = [];
  await app.until(async () => {
    widths.push(await app.eval(`parseFloat(document.querySelector('.upd-bar i')?.style.width) || 0`));
    labels.push(await app.eval(`document.getElementById('st-update').textContent`));
    return /99\.0\.0 is ready/.test(await app.dialog());
  }, { what: 'the restart prompt', every: 30 });
  assert.ok(new Set(widths).size > 2, 'the bar moves: ' + [...new Set(widths)].join(', '));
  assert.ok(labels.some((l) => /^UPDATING \d+%$/.test(l)), 'the status bar shows the progress');
  assert.equal(await app.eval(`document.getElementById('st-update').textContent`), 'RESTART TO UPDATE');
  assert.equal(await fs.readFile(target, 'utf8'), 'the old STET.exe', 'nothing replaced before the restart');
  assert.deepEqual(await fs.readFile(target + '.new'), EXE, 'the new one unpacked and waiting');
  assert.equal((await app.saveTo(path.join(tmp, 'Draft.stet'))).ok, true);
  await app.eval(`(() => { __stet.editor.insertText('Words before the update.'); __stet.input.after(); })()`);
  await app.press('Restart now');
  await app.dialogMatching(/Restarting…/);
  await app.until(() => fs.readFile(target).then((b) => b.equals(EXE), () => false), { what: 'STET.exe replaced' });
  assert.equal(await fs.readFile(target + '.old', 'utf8'), 'the old STET.exe', 'the previous one kept until the next start');
  assert.equal(await app.eval(`__stet.session.dirty`), false, 'the screenplay saved before restarting');
  await app.close(); app = null;
});

test('Help > Check for Updates: up to date, or GitHub unreachable; the quiet check on start says nothing', async () => {
  latest = release(CURRENT, []);
  const n = checks;
  app = await App.launch({ userData: await userData(), env: env() });
  await checked(n + 1);
  assert.equal(await app.dialog(), '', 'nothing to say');
  assert.equal(await app.eval(`document.getElementById('st-update').hidden`), true);
  const help = await app.eval(`(() => { const r = [...document.querySelectorAll('#menubar .mb')].find((m) => /^help$/i.test(m.textContent.trim())).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await app.click(help.x, help.y);
  const items = await app.until(`(() => { const t = [...document.querySelectorAll('.menu .mi')].map((m) => m.textContent); return t.length && t; })()`);
  assert.ok(items.some((t) => t.startsWith('Check for Updates…')) && items.some((t) => t.startsWith('STET on GitHub')), 'both in Help: ' + items.join(' | '));
  await app.key('Escape');
  await app.until('document.querySelectorAll(".menu").length === 0');
  await app.eval(`void __stet.cmd.run('check-updates')`);
  await app.dialogMatching(new RegExp(`STET ${CURRENT.replace(/\./g, '\\.')} is up to date\\.`));
  await app.press('OK');
  latest = 500;
  await app.eval(`void __stet.cmd.run('check-updates')`);
  await app.dialogMatching(/Couldn't check for updates\.[\s\S]*error \(500\)/);
  await app.press('Close');
  await app.close(); app = null;
});

test('a patch: offered with its small size, unpacked, then run on the next start, kept, and not offered again', async () => {
  const ud = await userData(), patches = path.join(tmp, 'app');
  latest = release('99.0.0', [{ name: patchAsset(ELECTRON), browser_download_url: '/patch', size: PATCH.length, digest: 'sha256:' + sha(PATCH) }]);
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
  await fs.cp(unpacked, broken, { recursive: true, verbatimSymlinks: true });
  await fs.rm(path.join(broken, '.ok'), { force: true });
  await fs.writeFile(path.join(broken, '.stet-patch.json'), JSON.stringify({ version: '99.0.1', electron: ELECTRON }));
  await fs.writeFile(path.join(broken, 'src', 'main', 'main.js'), 'this is not JavaScript (');
  app = await App.launch({ userData: ud, env: env({ STET_PATCH_DIR: patches }) });
  assert.match(await version(), /β$/, 'STET is up');
  await fs.access(path.join(broken, '.failed'));
  await app.close();
  app = await App.launch({ userData: ud, env: env({ STET_PATCH_DIR: patches }) });
  assert.equal(await version(), '99.0.0 β', 'the last good version from then on');
});
