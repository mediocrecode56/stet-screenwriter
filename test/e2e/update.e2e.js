// In-app updates in the real app, against a local stand-in for GitHub: the check on start,
// the UPDATE button and window, the download with its progress, the restart prompt, and
// the portable STET.exe replaced on disk (STET_UPDATE_TARGET; quitting is skipped in tests).
// Also Help → Check for Updates when up to date or when GitHub can't be reached.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { App, sleep } from './cdp.js';
import { makeZip } from '../helpers/zip.js';

const EXE = Buffer.concat([Buffer.from('MZ'), randomBytes(2_000_000)]); // incompressible, so the download has a real size
const ZIP = makeZip([{ name: 'STET.exe', data: EXE }]);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const CURRENT = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8')).version;

let tmp, ud, target, server, base, latest, app;
const release = (version) => ({
  tag_name: 'v' + version, draft: false, prerelease: false, html_url: 'https://example.invalid',
  body: '**To get STET, download STET-Windows.zip below.**\n\n- Something new.\n- Something fixed.',
  assets: [{ name: 'STET-Windows.zip', browser_download_url: base + '/zip', size: ZIP.length, digest: 'sha256:' + sha(ZIP) }],
});

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-upd-e2e-'));
  ud = path.join(tmp, 'ud');
  await fs.mkdir(ud, { recursive: true });
  target = path.join(tmp, 'portable', 'STET.exe');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'the old STET.exe');
  server = http.createServer((req, res) => {
    if (req.url === '/latest') {
      if (latest === 500) { res.writeHead(500); return res.end(); }
      const body = JSON.stringify(latest);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(body);
    }
    if (req.url === '/zip') {
      // Sent in pieces, so the progress window has something to show.
      res.writeHead(200, { 'content-length': ZIP.length });
      let i = 0;
      const t = setInterval(() => {
        res.write(ZIP.subarray(i, i + 200_000));
        i += 200_000;
        if (i >= ZIP.length) { clearInterval(t); res.end(); }
      }, 80);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  latest = release('99.0.0');
  app = await App.launch({ userData: ud, env: { STET_UPDATE_URL: base + '/latest', STET_UPDATE_TARGET: target } });
});
after(async () => {
  if (app) await app.close();
  server?.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

const dialogText = () => app.eval(`document.querySelector('#overlay .dlg')?.innerText || ''`);
const click = (label) => app.eval(`(() => { const b = [...document.querySelectorAll('#overlay .dlg .foot button')].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
async function until(fn, what, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return;
  assert.fail('timed out waiting for ' + what);
}

test('a newer release found on start: the button, the window with its notes, once per version', async () => {
  await until(async () => (await dialogText()).includes('99.0.0 is available'), 'the update window');
  const text = await dialogText();
  assert.match(text, new RegExp(`You have ${CURRENT.replace(/\./g, '\\.')}`));
  assert.match(text, /Something new\.\s+Something fixed\./, 'the release notes, as a list');
  assert.doesNotMatch(text, /To get STET/, 'without the download instructions meant for the release page');
  assert.equal(await app.eval(`document.getElementById('st-update').hidden`), false);
  assert.equal(await app.eval(`document.getElementById('st-update').textContent`), 'UPDATE 99.0.0');
  assert.equal((await app.eval(`__stet.settings()`)).updateNotified, '99.0.0', 'remembered, so it is shown once');
  assert.ok(await click('Later'));
  await sleep(300);
  assert.equal(await app.eval(`!!document.querySelector('#overlay .dlg')`), false);
  assert.equal(await app.eval(`document.getElementById('st-update').hidden`), false, 'the button stays');
  // No rounded corners or soft shadows on the button.
  const look = await app.eval(`(() => { const s = getComputedStyle(document.getElementById('st-update')); return [s.borderRadius, s.boxShadow]; })()`);
  assert.equal(look[0], '0px');
  assert.doesNotMatch(look[1], /\d+px \d+px [1-9]/, 'no blurred shadow');
});

test('update now: progress, then the restart prompt; restarting saves first and swaps STET.exe', async () => {
  await app.eval(`document.getElementById('st-update').click()`);
  await until(async () => (await dialogText()).includes('99.0.0 is available'), 'the update window again');
  assert.ok(await click('Update now'));
  await until(async () => /Downloading…[\s\S]*of 1\.9 MB/.test(await dialogText()), 'the progress window');
  const widths = [], labels = [];
  for (let i = 0; i < 8; i++) {
    widths.push(await app.eval(`parseFloat(document.querySelector('.upd-bar i')?.style.width) || 0`));
    labels.push(await app.eval(`document.getElementById('st-update').textContent`));
    await sleep(60);
  }
  assert.ok(Math.max(...widths) > widths[0], 'the bar moves: ' + widths.join(', '));
  assert.ok(labels.some((l) => /^UPDATING \d+%$/.test(l)), 'the status bar shows the progress: ' + labels.join(', '));
  await until(async () => (await dialogText()).includes('99.0.0 is ready'), 'the restart prompt');
  assert.equal(await app.eval(`document.getElementById('st-update').textContent`), 'RESTART TO UPDATE');
  assert.equal(await fs.readFile(target, 'utf8'), 'the old STET.exe', 'nothing replaced before the restart');
  assert.deepEqual(await fs.readFile(target + '.new'), EXE, 'the new one is unpacked and waiting');

  // Write something, then restart: it is saved first.
  const file = path.join(tmp, 'Draft.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`)).ok, true);
  await app.eval(`(() => { __stet.editor.insertText('Words before the update.'); __stet.input.after(); })()`);
  assert.ok(await click('Restart now'));
  await until(async () => (await dialogText()).includes('Restarting…'), 'restarting');
  await until(async () => { try { return (await fs.readFile(target)).equals(EXE); } catch { return false; } }, 'STET.exe replaced');
  assert.equal(await fs.readFile(target + '.old', 'utf8'), 'the old STET.exe', 'the previous one kept until the next start');
  assert.equal(await app.eval(`__stet.session.dirty`), false, 'the screenplay was saved before restarting');
});

test('Help → Check for Updates: up to date, and GitHub unreachable', async () => {
  await app.close();
  await fs.rm(ud, { recursive: true, force: true });
  await fs.mkdir(ud, { recursive: true });
  latest = release(CURRENT);
  app = await App.launch({ userData: ud, env: { STET_UPDATE_URL: base + '/latest', STET_UPDATE_TARGET: target } });
  await sleep(3500); // the quiet check on start finds nothing and says nothing
  assert.equal(await app.eval(`!!document.querySelector('#overlay .dlg')`), false);
  assert.equal(await app.eval(`document.getElementById('st-update').hidden`), true);
  // The Help menu has both new items.
  const items = await app.eval(`(async () => { const mb = [...document.querySelectorAll('.mb')].find((m) => /^help$/i.test(m.textContent.trim())); mb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); mb.click(); await new Promise((r) => setTimeout(r, 200)); const t = [...document.querySelectorAll('.mi')].map((m) => m.textContent); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return t; })()`);
  assert.ok(items.some((t) => t.startsWith('Check for Updates…')), 'Check for Updates in Help: ' + items.join(' | '));
  assert.ok(items.some((t) => t.startsWith('STET on GitHub')), 'STET on GitHub in Help');
  await sleep(200);
  await app.eval(`void __stet.cmd.run('check-updates')`);
  await until(async () => (await dialogText()).includes(`STET ${CURRENT} is up to date.`), 'up to date');
  assert.ok(await click('OK'));
  latest = 500;
  await app.eval(`void __stet.cmd.run('check-updates')`);
  await until(async () => (await dialogText()).includes("Couldn't check for updates."), 'the error');
  assert.match(await dialogText(), /error \(500\)/);
  assert.ok(await click('Close'));
});
