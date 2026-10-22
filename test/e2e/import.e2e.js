// File > Import Final Draft in the real app: an .fdx becomes a new .stet screenplay,
// saved where the writer chooses, with its backup settings.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { App, sleep } from './cdp.js';

const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sample.fdx');
let tmp, app;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-e2e-'));
  app = await App.launch({ userData: path.join(tmp, 'ud') });
});
after(async () => {
  if (app) await app.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

const dialog = async (title) => {
  for (let i = 0; i < 50; i++) {
    if (await app.eval(`document.querySelector('#overlay .dlg h2')?.firstChild?.textContent || ''`) === title) return;
    await sleep(100);
  }
  throw new Error('no ' + title + ' dialog');
};
const set = (i, v) => app.eval(`(() => { const x = document.querySelectorAll('#overlay .dlg input')[${i}]; if (x.type === 'checkbox') x.checked = ${JSON.stringify(v)}; else x.value = ${JSON.stringify(v)}; x.dispatchEvent(new Event('input')); x.dispatchEvent(new Event('change')); })()`);
const press = (label) => app.eval(`[...document.querySelectorAll('#overlay .dlg button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);

test('a Final Draft script is imported into a new screenplay, saved where asked, with its backups', async () => {
  const done = app.eval(`__stet.importFdx(${JSON.stringify(SAMPLE)})`);
  await dialog('IMPORT FINAL DRAFT');
  assert.equal(await app.eval(`document.querySelector('#overlay .dlg input').value`), 'sample'); // named after the file
  assert.ok(await app.eval(`![...document.querySelectorAll('#overlay .dlg button')].some((b) => b.textContent === 'Not now')`), 'it is saved, not left untitled');
  const bkDir = path.join(tmp, 'safe');
  await set(0, 'The Harbour');
  await set(1, tmp);
  await set(3, '10'); // every 10 min
  await set(5, true); // custom backup folder
  await set(6, bkDir);
  await press('Import');
  assert.equal(await done, true);
  const file = path.join(tmp, 'The Harbour.stet');
  assert.equal(await app.eval('__stet.session.path'), file);
  const blocks = await app.eval('__stet.editor.blocks.map((b) => [b.type, b.text])');
  assert.deepEqual(blocks.slice(0, 4), [['scene', 'INT. HARBOUR OFFICE - NIGHT'], ['action', 'Rain on the glass. Somewhere, a radio & a kettle.'], ['character', 'MARA (V.O.)'], ['paren', '(quietly)']]);
  // STET has no place for "New Act": it says so once.
  await dialog('IMPORTED WITH CHANGES');
  await press('OK');
  // A real .stet file, that STET reads back the same.
  assert.deepEqual(await app.eval(`window.stet.invoke('doc:read', ${JSON.stringify(file)}).then((r) => r.ok && JSON.parse(r.json).blocks.length)`), blocks.length);
  assert.deepEqual(await app.eval('__stet.session.doc.settings.backup'), { enabled: true, intervalMin: 10, retentionDays: 30, dir: bkDir });
  assert.equal(await app.eval('__stet.session.doc.titlePage.title'), 'THE HARBOUR');
});

test('importing over an existing screenplay asks again instead of overwriting it', async () => {
  const before = await fs.readFile(path.join(tmp, 'The Harbour.stet'));
  const done = app.eval(`__stet.importFdx(${JSON.stringify(SAMPLE)})`);
  await dialog('IMPORT FINAL DRAFT');
  await set(0, 'The Harbour');
  await set(1, tmp);
  await press('Import');
  await dialog('FILE EXISTS');
  await press('OK');
  await dialog('IMPORT FINAL DRAFT');
  assert.equal(await app.eval(`document.querySelector('#overlay .dlg input').value`), 'The Harbour', 'what was typed is kept');
  await press('Cancel');
  assert.equal(await done, false);
  assert.deepEqual(await fs.readFile(path.join(tmp, 'The Harbour.stet')), before);
});

test('a file that is not Final Draft is refused with a message', async () => {
  const bad = path.join(tmp, 'notes.fdx');
  await fs.writeFile(bad, 'just some notes');
  const done = app.eval(`__stet.openPath(${JSON.stringify(bad)})`); // opening an .fdx imports it
  await dialog('CANNOT IMPORT');
  assert.match(await app.eval(`document.querySelector('#overlay .dlg .body').textContent`), /not a Final Draft/);
  await press('OK');
  assert.equal(await done, false);
});

test('Import Final Draft is in the File menu under Open Recent', async () => {
  const items = await app.eval(`(() => { [...document.querySelectorAll('.mb')].find((x) => x.textContent === 'File').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return [...document.querySelectorAll('.menu .mi')].map((x) => x.textContent); })()`);
  const at = items.findIndex((t) => /Import Final Draft/.test(t));
  assert.ok(at > 0 && /Open Recent/.test(items[at - 1]), JSON.stringify(items));
  await app.key('Escape');
});
