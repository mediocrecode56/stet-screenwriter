// Help > Open .stet Files with STET, clicked in the real app. With STET_E2E_LINK=1 (the Mac
// release check, on a throwaway machine) it really links them; otherwise the main process
// answers for it, and this checks the click reaches it and its answer is shown.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';
import { MAC_GET_DEFAULT, BUNDLE_ID } from '../../src/main/assoc.js';

let tmp, app;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-links-'));
  app = await App.launch({ userData: path.join(tmp, 'ud') });
});
after(async () => {
  if (app) await app.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('Help > Open .stet Files with STET answers with a message', async () => {
  const platform = await app.eval('window.stet.platform');
  const help = `[...document.querySelectorAll('#menubar .mb')].find((m) => /^help$/i.test(m.textContent.trim()))`;
  await app.eval(`(() => { const mb = ${help}; mb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); mb.click(); })()`);
  await sleep(200);
  const item = `[...document.querySelectorAll('.mi')].find((m) => /Open \\.stet Files with STET/.test(m.textContent))`;
  const shown = await app.eval(`!!(${item})`);
  if (platform === 'win32' || platform === 'darwin') {
    assert.ok(shown, 'in the Help menu');
    await app.eval(`(${item}).dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))`);
  } else {
    assert.ok(!shown, 'not offered where the desktop decides');
    await app.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await app.eval(`__stet.cmd.run('link-files')`);
  }
  let text = '';
  // For real (STET_E2E_LINK), the system registers STET first: on a fresh Mac that takes a while.
  const wait = process.env.STET_E2E_LINK ? 600 : 100;
  for (let i = 0; i < wait && !text; i++) { await sleep(100); text = await app.eval(`(document.querySelector('.dlg') || {}).textContent || ''`); }
  assert.match(text, /STET FILES/);
  if (process.env.STET_E2E_LINK) {
    assert.match(text, /Done\. Double-clicking a \.stet screenplay now opens it in STET/);
    if (platform === 'darwin') assert.equal(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_GET_DEFAULT], { encoding: 'utf8' }).trim().toLowerCase(), BUNDLE_ID);
  } else assert.match(text, /e2e/);
});
