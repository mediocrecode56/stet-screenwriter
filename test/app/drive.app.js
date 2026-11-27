// Google Drive sync in the real app, against a stand-in for Google (test/helpers/fake-drive.js): the File
// menu's section, a saved screenplay reaching the STET folder, the cloud in the status bar and in Recent,
// a screenplay left out, and a version saved on another computer offered and opened.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { App, scratch, userData } from './harness.js';
import { decode, encode } from '../../src/main/container.js';
import { fakeDrive } from '../helpers/fake-drive.js';

let g, tmp, ud, app, file;
const cloud = (cls) => `(() => { const el = document.getElementById('st-drive'); return !el.hidden && el.classList.contains('${cls}'); })()`;
const inDrive = () => [...g.files.values()].find((x) => x.name === 'Office.stet');

before(async () => {
  g = await fakeDrive();
  tmp = await scratch('stet-drive');
  ud = await userData({});
  app = await App.launch({ userData: ud, env: { STET_DRIVE_URL: g.base } });
  await app.until('!!__stet.session.doc');
  await app.eval('__stet.session.autosaveDelay = 40');
});
after(async () => { await app?.close(); await g?.close(); });

test('connecting: a saved screenplay goes to the STET folder; the cloud shows in the status bar and in Recent', async () => {
  assert.equal(await app.eval('__stet.drive.connected'), false);
  assert.equal(await app.eval("document.getElementById('st-drive').hidden"), true, 'no cloud before connecting');
  await app.load([['scene', 'INT. OFFICE - DAY'], ['action', 'Phones ring.']]);
  file = path.join(tmp, 'Office.stet');
  assert.equal((await app.saveTo(file)).ok, true);
  assert.equal(g.uploads(), 0, 'nothing sent before connecting');
  await app.eval('void __stet.cmd.run("drive-connect")');
  await app.until('__stet.drive.connected', { what: 'connected' });
  await app.until(cloud('d-synced'), { timeout: 10000, what: 'the cloud: in Google Drive' });
  assert.match(await decode(inDrive().bytes), /Phones ring/, 'the open screenplay went up on connecting');
  // An edit: saved by itself, then in Drive a moment later.
  await app.eval('__stet.input.focus()');
  await app.key('Mod+End');
  await app.type(' A fax whirs.');
  await app.until('!__stet.session.dirty', { what: 'the autosave' });
  await app.until(cloud('d-synced'), { timeout: 10000, what: 'synced again' });
  await app.until(async () => /fax whirs/.test(await decode(inDrive().bytes)), { timeout: 10000, what: 'the edit in Drive' });
  assert.equal([...g.files.values()].filter((x) => x.name === 'Office.stet').length, 1, 'one file, new versions');
  // Open Recent: the cloud before it.
  const recent = await app.eval('__stet.api.invoke("recent:list")');
  assert.equal(recent.find((r) => r.path === file).drive, true);
  await app.eval('void __stet.cmd.run("recent")');
  await app.until(`!!document.querySelector('#overlay .recent-row .rc-cloud')`, { what: 'the cloud in Recent' });
  await app.key('Escape');
  await app.until('!document.querySelector("#overlay .dlg")');
});

test('left out: Stop Syncing keeps the screenplay out of Drive, and says so in the file', async () => {
  const before = g.uploads();
  await app.eval('__stet.cmd.run("drive-sync")');
  assert.equal(await app.eval('__stet.session.doc.drive'), false);
  await app.until('!__stet.session.dirty', { what: 'saved' });
  assert.equal(JSON.parse(await decode(await fs.readFile(file))).drive, false, 'kept in the file');
  await app.until(`__stet.api.invoke('drive:state', ${JSON.stringify(file)}).then((s) => s.state === 'off')`, { what: 'left out' });
  assert.equal(await app.eval("document.getElementById('st-drive').hidden"), true, 'no cloud for it');
  assert.equal(g.uploads(), before, 'nothing more sent');
  await app.eval('__stet.cmd.run("drive-sync")');
  await app.until(cloud('d-synced'), { timeout: 10000, what: 'synced again once turned back on' });
});

test('changed in Drive on another computer: offered in one line, and that version opened (this one backed up)', async () => {
  const f = inDrive();
  const json = JSON.parse(await decode(f.bytes));
  json.blocks.push({ t: 'action', x: 'Written on the laptop.' });
  g.edit(f.id, await encode(JSON.stringify(json)));
  await app.eval('__stet.drive.opened()'); // (as the window coming back to the front would)
  await app.until(`!!document.querySelector('.drive-offer')`, { what: 'the offer' });
  assert.match(await app.eval(`document.querySelector('.drive-offer').textContent`), /changed in Google Drive on another computer/);
  await app.clickOn('.drive-offer [data-o="pull"]');
  await app.until(`__stet.editor.blocks.some((b) => b.text === 'Written on the laptop.') || document.querySelector('#overlay .dlg')?.textContent`, { what: 'the Drive version opened' });
  assert.equal(await app.eval(`document.querySelector('#overlay .dlg')?.textContent || ''`), '', 'no error');
  assert.match(await decode(await fs.readFile(file)), /Written on the laptop/, 'and written to the file here');
  const backups = await fs.readdir(path.join(tmp, 'Office Backups'));
  assert.ok(backups.length >= 1, 'this version kept in Backups first');
  await app.until(cloud('d-synced'), { timeout: 10000, what: 'in step again' });
});
