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

test('status bar: a plain clock and no save text; the square beside the title is the only save sign', async () => {
  const v = await app.eval(`(() => { const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return { clock: document.getElementById('st-clock').textContent, now: [t(Date.now() - 5000), t(Date.now())], save: !!document.getElementById('st-save'), dot: document.getElementById('docdot').title }; })()`);
  assert.ok(v.now.includes(v.clock), `the time now, in this computer’s format (${v.clock}, ${v.now})`); // the clock may be a moment behind a new minute
  assert.equal(v.save, false);
  assert.match(v.dot, /Saved/);
});

test('goals popup: only the goal numbers take clicks; no dialog text can be selected', async () => {
  await app.eval(`void __stet.cmd.run('stats')`);
  await sleep(300);
  const v = await app.eval(`(() => { const d = document.querySelector('#overlay .dlg'), k = d.querySelector('.wk-goals .wk-k'); return { labels: d.querySelectorAll('label').length, inputs: d.querySelectorAll('.wk-goals input').length, select: getComputedStyle(k).userSelect, cursor: getComputedStyle(k).cursor, inCursor: getComputedStyle(d.querySelector('.wk-in')).cursor }; })()`);
  assert.deepEqual(v, { labels: 0, inputs: 2, select: 'none', cursor: 'default', inCursor: 'text' });
  await app.key('Escape');
  await sleep(200);
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
  const want = path.join(tmp, 'Final Cut.stet');
  for (let i = 0; i < 50 && (await app.eval(`__stet.session.path`)) !== want; i++) await sleep(100); // a busy machine opens it later
  assert.equal(await app.eval(`__stet.session.path`), want, '…so the most recent one opens instead');
});

test('a "$" in a new name is kept in the backups\' names too', async () => {
  const file = path.join(tmp, 'Cost.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`)).ok, true);
  assert.equal((await app.eval(`__stet.api.invoke('backup:create', { path: ${JSON.stringify(file)}, id: 'x', dir: null, json: __stet.session.serialize() })`)).ok, true);
  const r = await app.eval(`__stet.api.invoke('doc:rename', { path: ${JSON.stringify(file)}, name: 'Cost $& More', backupDir: null })`);
  assert.equal(r.ok, true);
  assert.equal(r.path, path.join(tmp, 'Cost $& More.stet'));
  const names = await fs.readdir(path.join(tmp, 'Cost $& More Backups'));
  assert.equal(names.length, 1);
  assert.ok(names[0].startsWith('Cost $& More '), names[0]);
});

test('launching opens the last screenplay edited, not one only looked at since', async () => {
  const edited = path.join(tmp, 'Edited.stet'), looked = path.join(tmp, 'Looked At.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(looked)})`)).ok, true);
  await app.eval(`__stet.session.newUntitled()`);
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(edited)})`)).ok, true);
  assert.equal(await app.eval(`__stet.openPath(${JSON.stringify(looked)})`), true);
  assert.equal((await app.eval(`__stet.api.invoke('recent:list')`))[0].path, looked, 'the one opened last heads Open Recent');
  await app.close();
  app = await App.launch({ userData: ud });
  for (let i = 0; i < 50 && (await app.eval(`__stet.session.path`)) !== edited; i++) await sleep(100);
  assert.equal(await app.eval(`__stet.session.path`), edited);
});
