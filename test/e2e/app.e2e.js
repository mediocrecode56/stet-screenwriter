// End-to-end tests: drive the real Electron app with real key events.
// Run with `npm run e2e`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';
import { decode } from '../../src/main/container.js';

let tmp, app;
const blocks = () => app.eval('__stet.editor.blocks.map(b => [b.type, b.text])');
const SHOTS = process.env.STET_E2E_SHOTS;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-e2e-'));
  app = await App.launch({ userData: path.join(tmp, 'ud'), hidden: !SHOTS });
  await app.eval('__stet.input.focus()');
});
after(async () => {
  if (app) await app.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('typing a scene with keyboard-driven element flow', async () => {
  await app.type('int. coffee shop - night');
  await app.key('Escape'); // dismiss any suggestion
  await app.key('Enter');
  await app.type('Rain on the glass. Mara waits.');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('mara');
  await app.key('Enter');
  await app.type('You came.');
  await app.key('Tab');
  await app.type('softly');
  await app.key('Enter');
  await app.type('I always do.');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('teo');
  await app.key('Enter');
  await app.type('Not always.');
  assert.deepEqual(await blocks(), [
    ['scene', 'INT. COFFEE SHOP - NIGHT'],
    ['action', 'Rain on the glass. Mara waits.'],
    ['character', 'MARA'],
    ['dialogue', 'You came.'],
    ['paren', '(softly)'],
    ['dialogue', 'I always do.'],
    ['character', 'TEO'],
    ['dialogue', 'Not always.'],
  ]);
});

test('Ctrl+number changes element type; undo/redo via keyboard', async () => {
  await app.key('Ctrl+6');
  assert.equal(await app.eval('__stet.editor.block.type'), 'transition');
  assert.equal(await app.eval('__stet.editor.block.text'), 'NOT ALWAYS.');
  await app.key('Ctrl+Z');
  assert.equal(await app.eval('__stet.editor.block.type'), 'dialogue');
  assert.equal(await app.eval('__stet.editor.block.text'), 'Not always.');
  await app.key('Ctrl+Y');
  assert.equal(await app.eval('__stet.editor.block.type'), 'transition');
  await app.key('Ctrl+Z');
});

test('character autocomplete accepts with Enter', async () => {
  await app.key('End');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('ma');
  assert.equal(await app.eval('!document.getElementById("ac").hidden'), true);
  await app.key('Enter');
  assert.equal(await app.eval('__stet.editor.block.text'), 'MARA');
  await app.key('Enter');
  await app.type('Mara looks at Teo.');
  assert.equal(await app.eval('__stet.editor.block.type'), 'dialogue');
});

test('first appearance capitalisation in action', async () => {
  await app.key('Enter'); // dialogue -> action
  await app.type('Teo sits. ');
  assert.equal(await app.eval('__stet.editor.block.text'), 'TEO sits. ');
  await app.type('Teo smiles.');
  assert.equal(await app.eval('__stet.editor.block.text'), 'TEO sits. Teo smiles.');
});

test('selection + highlight + note', async () => {
  await app.key('Ctrl+Shift+ArrowLeft');
  await app.key('Alt+2');
  const marks = await app.eval('__stet.editor.block.marks');
  assert.deepEqual(marks.map((m) => [m.k, m.v]), [['hl', 'yellow']]);
  await app.key('Ctrl+Alt+M');
  await sleep(100);
  assert.equal(await app.eval('!document.getElementById("right").hidden'), true);
  await app.type('Check this beat.');
  await app.eval('__stet.input.focus()');
  const id = await app.eval('__stet.editor.commentAnchors()[0].id');
  assert.equal(await app.eval(`__stet.session.doc.comments["${id}"].text`), 'Check this beat.');
});

test('find bar counts matches', async () => {
  await app.key('Ctrl+F');
  await app.type('mara');
  await sleep(250);
  assert.match(await app.eval('document.getElementById("find-count").textContent'), /\/ 4$/);
  await app.key('Escape');
  assert.equal(await app.eval('document.getElementById("findbar").dataset.open'), '0', 'closing at once');
  await sleep(300);
  assert.equal(await app.eval('document.getElementById("findbar").hidden'), true, 'gone after sliding away');
});

test('zoom and theme', async () => {
  await app.key('Ctrl+=');
  assert.equal(await app.eval('document.getElementById("zoom-val").textContent'), '110%');
  await app.key('Ctrl+0');
  assert.equal(await app.eval('document.getElementById("zoom-val").textContent'), '100%');
  if (SHOTS) await app.screenshot(path.join(SHOTS, 'e2e-dark.png'));
  await app.key('Ctrl+Shift+L');
  assert.equal(await app.eval('document.documentElement.dataset.theme'), 'light');
  if (SHOTS) await app.screenshot(path.join(SHOTS, 'e2e-light.png'));
  await app.key('Ctrl+Shift+L');
  assert.equal(await app.eval('document.documentElement.dataset.theme'), 'dark');
});

test('save, autosave, reopen round trip', async () => {
  const file = path.join(tmp, 'Night.stet');
  const r = await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`);
  assert.equal(r.ok, true);
  assert.equal(await app.eval('__stet.session.dirty'), false);
  const before = JSON.stringify(await blocks());
  // Autosave: edit, wait past the debounce, the file must contain the edit.
  await app.key('End'); // collapse the selection (typing over it would replace the noted text)
  await app.type(' Thunder.');
  assert.equal(await app.eval('__stet.session.dirty'), true);
  await sleep(2200);
  assert.equal(await app.eval('__stet.session.dirty'), false);
  const json = await decode(await fs.readFile(file));
  assert.match(json, /Thunder\./);
  // Reopen from disk.
  const now = JSON.stringify(await blocks());
  assert.notEqual(now, before);
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  assert.equal(JSON.stringify(await blocks()), now);
  const notes = await app.eval('Object.values(__stet.session.doc.comments).map(c => c.text)');
  assert.deepEqual(notes, ['Check this beat.']);
});

test('backup now writes into "<name> Backups"', async () => {
  const r = await app.eval('__stet.session.maybeBackup(true)');
  assert.equal(r.ok, true);
  const dir = path.join(tmp, 'Night Backups');
  const files = await fs.readdir(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^Night \d{4}-\d{2}-\d{2} \d{6}\.stet$/);
});

test('PDF export from the document structure', async () => {
  const out = path.join(tmp, 'Night.pdf');
  const r = await app.eval(`__stet.api.invoke('export:pdf', { json: __stet.session.serialize(), options: { titlePage: true, highlights: true, comments: true, range: '' }, name: 'Night', file: ${JSON.stringify(out)} })`);
  assert.equal(r.ok, true, r.error);
  const head = (await fs.readFile(out)).subarray(0, 8).toString('latin1');
  assert.equal(head.slice(0, 5), '%PDF-');
});

test('crash recovery after forced termination', async () => {
  // A fresh untitled document with unsaved text, then a hard kill.
  await app.eval('__stet.session.newUntitled()');
  await app.eval('__stet.input.focus()');
  await app.type('ext. harbor - dawn');
  await app.key('Escape');
  await app.key('Enter');
  await app.type('Gulls. Nothing else survives.');
  await sleep(2000); // past the autosave debounce -> recovery snapshot
  await app.kill();
  app = await App.launch({ userData: path.join(tmp, 'ud') });
  // Startup shows the recovery prompt.
  let txt = '';
  for (let i = 0; i < 40 && !txt.includes('RECOVER WORK'); i++) { await sleep(100); txt = await app.eval('document.getElementById("overlay").innerText'); }
  assert.match(txt, /RECOVER WORK/);
  await app.eval('[...document.querySelectorAll("#overlay .btn")].find(b => b.textContent === "Restore").click()');
  await sleep(300);
  assert.deepEqual(await blocks(), [['scene', 'EXT. HARBOR - DAWN'], ['action', 'Gulls. Nothing else survives.']]);
  assert.equal(await app.eval('__stet.session.dirty'), true);
});
