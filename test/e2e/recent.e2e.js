// 0.18: renaming in place from the title (the file, Open Recent and the title all follow), the
// folder icon in Open Recent, and reopening the last screenplay on launch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, ud, app;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-rec-'));
  ud = path.join(tmp, 'ud');
  await fs.mkdir(ud, { recursive: true });
  app = await App.launch({ userData: ud });
  await sleep(500);
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('double-clicking the title renames the file in place; Open Recent follows; Escape cancels', async () => {
  const file = path.join(tmp, 'First Draft.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`)).ok, true);
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  await sleep(300);
  // Windows decides where the window can be dragged from the page's drag regions, later ones winning:
  // nothing after the title may be a drag region over it, or a real double-click maximises the
  // window instead of reaching the title (synthetic events here would never notice).
  const covered = await app.eval(`(() => { const t = document.getElementById('doctitle'), r = t.getBoundingClientRect(); return [...document.querySelectorAll('#top *')].filter((e) => t.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING && getComputedStyle(e).webkitAppRegion === 'drag').filter((e) => { const q = e.getBoundingClientRect(); return q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; }).map((e) => e.id || e.className); })()`);
  assert.deepEqual(covered, [], 'no drag region covers the title');
  assert.equal(await app.eval(`getComputedStyle(document.getElementById('doctitle')).webkitAppRegion`), 'no-drag');
  // Escape leaves everything as it was.
  await app.eval(`document.getElementById('doctitle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  assert.equal(await app.eval(`document.getElementById('doctitle').isContentEditable`), true, 'the title becomes a field');
  await app.eval(`(() => { const t = document.getElementById('doctitle'); t.textContent = 'Nope'; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
  await sleep(200);
  assert.equal(await app.eval(`document.getElementById('doctitle').textContent`), 'First Draft');
  // Enter renames.
  await app.eval(`document.getElementById('doctitle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await app.eval(`(() => { const t = document.getElementById('doctitle'); t.textContent = 'Final Cut'; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await sleep(600);
  const target = path.join(tmp, 'Final Cut.stet');
  assert.equal(await app.eval(`__stet.session.path`), target);
  assert.equal(await app.eval(`document.getElementById('doctitle').textContent`), 'Final Cut');
  await fs.access(target);
  await assert.rejects(fs.access(file), 'the old file is gone');
  const recent = await app.eval(`__stet.api.invoke('recent:list')`);
  assert.equal(recent[0].path, target, 'Open Recent has the new name');
  assert.equal(recent[0].name, 'Final Cut');
  assert.ok(!recent.some((r) => r.path === file));
});

test('a click anywhere outside the title ends the rename and its highlight; no focus outline anywhere', async () => {
  await app.eval(`document.getElementById('doctitle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  assert.equal(await app.eval(`String(getSelection())`), 'Final Cut');
  // A toolbar button keeps the focus where it is (no blur), so this is the case that used to stick.
  await app.eval(`document.querySelector('#toolbar .tb, .tb').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await sleep(100);
  assert.equal(await app.eval(`document.getElementById('doctitle').isContentEditable`), false);
  assert.equal(await app.eval(`String(getSelection())`), '', 'nothing is left highlighted');
  const outlines = await app.eval(`[...document.querySelectorAll('button, input, textarea, [tabindex], #doctitle')].filter((e) => { e.focus(); return getComputedStyle(e).outlineStyle !== 'none'; }).map((e) => e.id || e.className)`);
  assert.deepEqual(outlines, [], 'no focus outline');
  await app.key('Escape');
});

test('Open Recent: a folder icon on each row, beside × and the bin', async () => {
  await app.eval(`void __stet.cmd.run('recent')`);
  await sleep(300);
  const v = await app.eval(`[...document.querySelectorAll('#overlay .recent-row')].map((r) => [...r.querySelectorAll('.ra')].map((b) => b.className.split(' ')[1]))`);
  assert.ok(v.length >= 1);
  for (const row of v) assert.deepEqual(row, ['ra-reveal', 'ra-dismiss', 'ra-trash']);
  await app.key('Escape');
  await sleep(200);
});

test('launching opens the last screenplay, even after a new untitled one', async () => {
  await app.eval(`__stet.session.newUntitled()`); // forgets the last one to reopen…
  await sleep(200);
  await app.close();
  app = await App.launch({ userData: ud });
  await sleep(900);
  assert.equal(await app.eval(`__stet.session.path`), path.join(tmp, 'Final Cut.stet'), '…so the most recent one opens instead');
});
