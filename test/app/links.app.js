// Help > Open .stet Files with STET, clicked in the real app. With STET_E2E_LINK=1 (the Mac release
// check, on a throwaway machine) it really links them; otherwise the main process answers for it,
// and this checks the click reaches it and its answer is shown.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { App, scratch } from './harness.js';
import { MAC_GET_DEFAULT, BUNDLE_ID } from '../../src/main/assoc.js';

let app;
before(async () => { app = await App.launch({ userData: path.join(await scratch('stet-links'), 'ud') }); });
after(() => app?.close());

test('Help > Open .stet Files with STET answers with a message', async () => {
  const platform = await app.eval('window.stet.platform');
  const help = await app.eval(`(() => { const r = [...document.querySelectorAll('#menubar .mb')].find((m) => /^help$/i.test(m.textContent.trim())).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await app.click(help.x, help.y);
  await app.until(`document.querySelectorAll('.menu .mi').length > 0`);
  const item = await app.eval(`(() => { const m = [...document.querySelectorAll('.mi')].find((m) => /Open \\.stet Files with STET/.test(m.textContent)); if (!m) return null; const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (platform === 'win32' || platform === 'darwin') {
    assert.ok(item, 'in the Help menu');
    await app.click(item.x, item.y);
  } else {
    assert.equal(item, null, 'not offered where the desktop decides');
    await app.key('Escape');
    await app.eval(`__stet.cmd.run('link-files')`);
  }
  // For real (STET_E2E_LINK), the system registers STET first: on a fresh Mac that takes a while.
  await app.dialogMatching(/STET FILES/, process.env.STET_E2E_LINK ? 60000 : 8000);
  const text = await app.dialog();
  if (process.env.STET_E2E_LINK) {
    assert.match(text, /Done\. Double-clicking a \.stet screenplay now opens it in STET/);
    if (platform === 'darwin') assert.equal(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_GET_DEFAULT], { encoding: 'utf8' }).trim().toLowerCase(), BUNDLE_ID);
  } else assert.match(text, /e2e/);
});
