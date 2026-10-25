// Files in the real app: saving, autosave and reopening, backups, importing Final Draft, renaming
// from the title, Open Recent (its menu, its window and its three actions), the performance probe
// leaving no trace, and across restarts: reopening the last screenplay edited, and getting back
// unsaved work after a crash.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, scratch, userData, sleep, ROOT } from './harness.js';
import { decode } from '../../src/main/container.js';

const SAMPLE = path.join(ROOT, 'test', 'fixtures', 'sample.fdx');
let tmp, ud, bin, app, longName, deep;
const launch = () => App.launch({ userData: ud, env: { STET_TEST_TRASH_DIR: bin } });

before(async () => {
  tmp = await scratch('stet-files');
  bin = path.join(tmp, 'bin');
  await fs.mkdir(bin);
  // Two screenplays in Open Recent with a very long name and a very long path.
  deep = path.join(tmp, 'OneDrive - Personal', 'Documents', 'Screenwriting', 'Features', 'In Development', 'Second Draft Notes and Revisions', 'Archive');
  await fs.mkdir(deep, { recursive: true });
  longName = 'The Extraordinarily Long Title of a Screenplay That Never Ends, Part Two';
  const recent = [];
  for (const n of [longName, 'Night Ferry']) {
    const f = path.join(deep, n + '.stet');
    await fs.writeFile(f, '{}');
    recent.push({ path: f, name: n, opened: Date.now() - recent.length * 3600e3 });
  }
  ud = await userData({ 'settings.json': { recent } });
  app = await launch();
  await app.until('!!__stet.session.doc');
  await app.eval('__stet.session.autosaveDelay = 40'); // the debounce, shortened: the same path, sooner
});
after(() => app?.close());

test('save, autosave and reopen: the file follows every change, notes included', async () => {
  await app.load([['scene', 'INT. HOUSE - NIGHT'], ['action', 'Rain.']]);
  await app.caret(1, 5);
  await app.key('Mod+Alt+M');
  await app.until('document.activeElement.tagName === "TEXTAREA"');
  await app.type('Check this beat.');
  const file = path.join(tmp, 'Night.stet');
  assert.equal((await app.saveTo(file)).ok, true);
  assert.equal(await app.eval('__stet.session.dirty'), false);
  await app.eval('__stet.input.focus()');
  await app.key('Mod+End');
  await app.type(' Thunder.');
  assert.equal(await app.eval('__stet.session.dirty'), true);
  await app.until('!__stet.session.dirty', { what: 'the autosave' });
  assert.match(await decode(await fs.readFile(file)), /Thunder\./, 'saved by itself');
  const now = await app.blocks();
  await app.load([]);
  assert.equal(await app.eval(`__stet.openPath(${JSON.stringify(file)})`), true);
  assert.deepEqual(await app.blocks(), now);
  assert.deepEqual(await app.eval('Object.values(__stet.session.doc.comments).map((c) => c.text)'), ['Check this beat.']);
  // Saved under a new name while an autosave is still writing the old file: the new file is written too.
  await app.key('Mod+End');
  await app.type(' Wind.');
  const copy = path.join(tmp, 'Night Copy.stet');
  assert.equal((await app.eval(`(() => { const s = __stet.session; s.autosaveDelay = 60000; void s.flushQuiet(); return s.saveTo(${JSON.stringify(copy)}); })()`)).ok, true); // the autosave under way as it is saved elsewhere
  assert.match(await decode(await fs.readFile(copy)), /Wind\./, 'the new file exists, with everything in it');
  await app.eval('__stet.session.autosaveDelay = 40');
  assert.equal(await app.eval(`__stet.openPath(${JSON.stringify(file)})`), true);
  // Back Up Now: into "<name> Backups", named with the date and time.
  assert.equal((await app.eval('__stet.session.maybeBackup(true)')).ok, true);
  const files = await fs.readdir(path.join(tmp, 'Night Backups'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^Night \d{4}-\d{2}-\d{2} \d{6}\.stet$/);
});

// ---- Final Draft ----

const set = (i, v) => app.eval(`(() => { const x = document.querySelectorAll('#overlay .dlg input')[${i}]; if (x.type === 'checkbox') x.checked = ${JSON.stringify(v)}; else x.value = ${JSON.stringify(v)}; x.dispatchEvent(new Event('input')); x.dispatchEvent(new Event('change')); })()`);

test('a Final Draft script becomes a new screenplay, saved where asked, with its backups; never over an existing one', async () => {
  const done = app.eval(`__stet.importFdx(${JSON.stringify(SAMPLE)})`);
  await app.dialogMatching(/^IMPORT FINAL DRAFT/);
  assert.equal(await app.eval(`document.querySelector('#overlay .dlg input').value`), 'sample', 'named after the file');
  assert.ok(!(await app.dialog()).includes('Not now'), 'it is saved, not left untitled');
  const bkDir = path.join(tmp, 'safe');
  await set(0, 'The Harbour'); await set(1, tmp); await set(3, '10'); await set(5, true); await set(6, bkDir);
  await app.press('Import');
  assert.equal(await done, true);
  const file = path.join(tmp, 'The Harbour.stet');
  assert.equal(await app.eval('__stet.session.path'), file);
  const blocks = await app.blocks();
  assert.deepEqual(blocks.slice(0, 4), [['scene', 'INT. HARBOUR OFFICE - NIGHT'], ['action', 'Rain on the glass. Somewhere, a radio & a kettle.'], ['character', 'MARA (V.O.)'], ['paren', '(quietly)']]);
  await app.dialogMatching(/^IMPORTED WITH CHANGES/); // STET has no "New Act": it says so once
  await app.press('OK');
  assert.equal(await app.eval(`window.stet.invoke('doc:read', ${JSON.stringify(file)}).then((r) => r.ok && JSON.parse(r.json).blocks.length)`), blocks.length, 'a real .stet file, read back the same');
  assert.deepEqual(await app.eval('__stet.session.doc.settings.backup'), { enabled: true, intervalMin: 10, retentionDays: 30, dir: bkDir });
  assert.equal(await app.eval('__stet.session.doc.titlePage.title'), 'THE HARBOUR');
  // Again under the same name: it asks again instead of overwriting.
  const kept = await fs.readFile(file);
  const again = app.eval(`__stet.importFdx(${JSON.stringify(SAMPLE)})`);
  await app.dialogMatching(/^IMPORT FINAL DRAFT/);
  await set(0, 'The Harbour'); await set(1, tmp);
  await app.press('Import');
  await app.dialogMatching(/^FILE EXISTS/);
  await app.press('OK');
  await app.dialogMatching(/^IMPORT FINAL DRAFT/);
  assert.equal(await app.eval(`document.querySelector('#overlay .dlg input').value`), 'The Harbour', 'what was typed is kept');
  await app.press('Cancel');
  assert.equal(await again, false);
  assert.deepEqual(await fs.readFile(file), kept);
  // Not Final Draft at all: refused with a message.
  const bad = path.join(tmp, 'notes.fdx');
  await fs.writeFile(bad, 'just some notes');
  const refused = app.eval(`__stet.openPath(${JSON.stringify(bad)})`); // opening an .fdx imports it
  await app.dialogMatching(/^CANNOT IMPORT[\s\S]*not a Final Draft/);
  await app.press('OK');
  assert.equal(await refused, false);
});

// ---- renaming from the title ----

test('double-clicking the title renames the file in place; Open Recent follows; Escape or a click away cancels', async () => {
  const file = path.join(tmp, 'First Draft.stet');
  assert.equal((await app.saveTo(file)).ok, true);
  // Windows decides where the window can be dragged from the page's drag regions, later ones winning:
  // nothing after the title may be a drag region over it, or a real double-click maximises the window.
  const covered = await app.eval(`(() => { const t = document.getElementById('doctitle'), r = t.getBoundingClientRect(); return [...document.querySelectorAll('#top *')].filter((e) => t.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING && getComputedStyle(e).webkitAppRegion === 'drag').filter((e) => { const q = e.getBoundingClientRect(); return q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; }).map((e) => e.id || e.className); })()`);
  assert.deepEqual(covered, [], 'no drag region covers the title');
  assert.equal(await app.eval(`getComputedStyle(document.getElementById('doctitle')).webkitAppRegion`), 'no-drag');
  const title = await app.rect('#doctitle');
  await app.click(title.x, title.y); await app.click(title.x, title.y, { count: 2 });
  assert.equal(await app.eval(`document.getElementById('doctitle').isContentEditable`), true, 'the title becomes a field');
  assert.equal(await app.eval(`String(getSelection())`), 'First Draft', 'all of it selected');
  await app.type('Nope');
  await app.key('Escape');
  await app.until(`document.getElementById('doctitle').textContent === 'First Draft'`, { what: 'Escape to leave it as it was' });
  await app.click(title.x, title.y); await app.click(title.x, title.y, { count: 2 });
  await app.type('Final Cut');
  await app.key('Enter');
  const target = path.join(tmp, 'Final Cut.stet');
  await app.until(`__stet.session.path === ${JSON.stringify(target)}`, { what: 'the rename' });
  assert.equal(await app.eval(`document.getElementById('doctitle').textContent`), 'Final Cut');
  await fs.access(target);
  await assert.rejects(fs.access(file), 'the old file is gone');
  const recent = await app.eval(`__stet.api.invoke('recent:list')`);
  assert.deepEqual([recent[0].path, recent[0].name], [target, 'Final Cut'], 'Open Recent has the new name');
  assert.ok(!recent.some((r) => r.path === file));
  // A click on a toolbar button (which keeps the focus where it is) also ends it, highlight and all.
  await app.click(title.x, title.y); await app.click(title.x, title.y, { count: 2 });
  await app.clickOn('.tb[data-t="action"]');
  assert.equal(await app.eval(`document.getElementById('doctitle').isContentEditable`), false);
  assert.equal(await app.eval(`String(getSelection())`), '', 'nothing left highlighted');
  const outlines = await app.eval(`[...document.querySelectorAll('button, input, textarea, [tabindex], #doctitle')].filter((e) => { e.focus(); return getComputedStyle(e).outlineStyle !== 'none'; }).map((e) => e.id || e.className)`);
  assert.deepEqual(outlines, [], 'no focus outline anywhere');
  await app.eval('__stet.input.focus()');
  // A "$" in a new name is kept in the backups' names too.
  const cost = path.join(tmp, 'Cost.stet');
  assert.equal((await app.saveTo(cost)).ok, true);
  assert.equal((await app.eval(`__stet.api.invoke('backup:create', { path: ${JSON.stringify(cost)}, id: 'x', dir: null, json: __stet.session.serialize() })`)).ok, true);
  await app.load([]); // (renamed here behind STET's back: it mustn't still have the file open)
  const r = await app.eval(`__stet.api.invoke('doc:rename', { path: ${JSON.stringify(cost)}, name: 'Cost $& More', backupDir: null })`);
  assert.deepEqual([r.ok, r.path], [true, path.join(tmp, 'Cost $& More.stet')], r.error + ' ' + JSON.stringify((await fs.readdir(tmp)).filter((f) => /stet$/.test(f))) + ' ' + await app.eval('JSON.stringify(__stet.api.invoke("recent:list").then((l) => l.slice(0, 3).map((x) => x.name)))'));
  const names = await fs.readdir(path.join(tmp, 'Cost $& More Backups'));
  assert.ok(names.length === 1 && names[0].startsWith('Cost $& More '), names[0]);
});

// ---- Open Recent ----

const openRecent = async () => { await app.eval(`void __stet.cmd.run('recent')`); await app.until(`!!document.querySelector('#overlay .recent-row')`); };
const rows = () => app.eval(`[...document.querySelectorAll('#overlay .recent-row')].map((r) => ({ name: r.cells[0].textContent, missing: r.classList.contains('missing') }))`);
const rowAction = (name, cls) => app.eval(`[...document.querySelectorAll('#overlay .recent-row')].find((r) => r.cells[0].textContent === ${JSON.stringify(name)}).querySelector('${cls}').click()`);

test('the File menu: Open Recent shows the recent screenplays, compact, long names shortened; Import Final Draft under it', async () => {
  await app.clickOn('#menubar .mb');
  const items = await app.until(`(() => { const t = [...document.querySelectorAll('.menu .mi')].map((x) => x.textContent); return t.length && t; })()`);
  const at = items.findIndex((t) => /Import Final Draft/.test(t));
  assert.ok(at > 0 && /Open Recent/.test(items[at - 1]), JSON.stringify(items));
  const sub = await app.rect('.menu .mi.has-sub');
  await app.move(sub.x, sub.y);
  const v = await app.until(`(() => { const s = document.querySelector('.msub'); if (!s) return null; const r = s.getBoundingClientRect(), t = [...s.querySelectorAll('.mi-t')], long = t.find((x) => x.textContent.startsWith('The Extraordinarily')); return long && { names: t.map((x) => x.textContent), clipped: long.scrollWidth > long.clientWidth, width: r.width, inside: r.right <= innerWidth && r.left >= 0 }; })()`, { what: 'the flyout' });
  assert.ok(v.names.includes('Night Ferry'), v.names.join(', '));
  assert.ok(v.clipped && v.width <= 260, `a long name ends in … and the list stays narrow (${v.width}px)`);
  assert.ok(v.inside, 'within the window');
  await app.key('Escape');
  await app.until('document.querySelectorAll(".menu").length === 0');
});

test('the Open Recent window: a folder, × and bin on each row, all visible on hover; long paths cut at the end, never scrolling sideways', async () => {
  // A hidden test window doesn't run CSS transitions, so read the hovered state with motion reduced (no fade).
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const w of [1280, 760]) {
    await app.send('Emulation.setDeviceMetricsOverride', { width: w, height: 700, deviceScaleFactor: 1, mobile: false });
    await openRecent();
    const row = await app.until(`(() => { const r = [...document.querySelectorAll('#overlay .recent-row')].find((r) => r.cells[0].textContent.startsWith('The Extraordinarily'))?.getBoundingClientRect(); return r && { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
    await app.move(row.x, row.y);
    await app.until(`[...document.querySelectorAll('#overlay .recent-row')].some((r) => r.matches(':hover'))`, { what: 'the row hovered' });
    const r = await app.eval(`(() => {
      const dlg = document.querySelector('#overlay .dlg').getBoundingClientRect(), body = document.querySelector('#overlay .body');
      const row = [...document.querySelectorAll('#overlay .recent-row')].find((r) => r.matches(':hover'));
      const icons = [...row.querySelectorAll('.ra')].map((e) => { const q = e.getBoundingClientRect(), at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { cls: e.className.split(' ')[1], title: e.title, op: getComputedStyle(e).opacity, inside: q.left >= dlg.left && q.right <= dlg.right, onTop: e === at || e.contains(at) }; });
      const p = row.querySelector('.rc-path');
      return { scroll: body.scrollWidth - body.clientWidth, icons, path: p.textContent, full: p.title, ellipsis: getComputedStyle(p).textOverflow === 'ellipsis', pathRight: p.getBoundingClientRect().right, iconLeft: Math.min(...[...row.querySelectorAll('.ra')].map((e) => e.getBoundingClientRect().left)) };
    })()`);
    assert.equal(r.scroll, 0, `no sideways scrolling at ${w} px`);
    assert.deepEqual(r.icons.map((i) => i.cls), ['ra-reveal', 'ra-dismiss', 'ra-trash']);
    for (const i of r.icons) { assert.equal(i.op, '1', `${i.title} visible on hover`); assert.ok(i.inside && i.onTop, `${i.title} inside the window and not covered`); }
    assert.match(r.icons[0].title, /Show in Folder/);
    assert.match(r.icons[1].title, /Remove from Recent.*file is kept/s);
    assert.match(r.icons[2].title, /Move to Recycle Bin/);
    assert.equal(r.path, r.full, 'the whole path, from its beginning');
    assert.ok(r.ellipsis && r.pathRight <= r.iconLeft, 'cut at the end, never under the icons');
    await app.key('Escape');
    await app.noDialog();
  }
  await app.send('Emulation.clearDeviceMetricsOverride');
  await app.send('Emulation.setEmulatedMedia', { features: [] });
  // Not hovered, the icons stay out of sight; × and the bin are kept well apart.
  await openRecent();
  const ui = await app.eval(`(() => { const row = document.querySelector('#overlay .recent-row:not(:hover)'), d = row.querySelector('.ra-dismiss'), t = row.querySelector('.ra-trash'); return { op: getComputedStyle(d).opacity, gap: t.getBoundingClientRect().left - d.getBoundingClientRect().right }; })()`);
  assert.equal(ui.op, '0');
  assert.ok(ui.gap >= 6, `× and the bin ${ui.gap}px apart`);
  await app.key('Escape');
  await app.noDialog();
});

test('Open Recent: × removes an entry and keeps the file; the bin asks, then moves the file to the bin; a missing one is marked and can go', async () => {
  const files = ['Keep.stet', 'Hide.stet', 'Bin.stet', 'Gone.stet'].map((f) => path.join(tmp, f));
  for (const f of files) { await app.load([['action', 'x']]); assert.equal((await app.saveTo(f)).ok, true); }
  await app.load([]); // none of them is the open screenplay
  await fs.rm(files[3]); // one that no longer exists
  await openRecent();
  let r = await rows();
  for (const n of ['Keep', 'Hide', 'Bin', 'Gone']) assert.ok(r.some((x) => x.name === n), n);
  assert.equal(r.find((x) => x.name === 'Gone').missing, true, 'a missing file is marked');
  await rowAction('Hide', '.ra-dismiss');
  assert.ok(!(await rows()).some((x) => x.name === 'Hide'), 'the list updates at once');
  await fs.access(files[1]);
  assert.ok(!(await app.eval(`window.stet.invoke('settings:get')`)).recent.some((x) => x.path === files[1]), 'and forgets it');
  await rowAction('Bin', '.ra-trash');
  await app.dialogMatching(/RECYCLE BIN/);
  await app.press('Cancel'); // first: nothing happens, the list comes back
  await app.until(`!!document.querySelector('#overlay .recent-row')`);
  await fs.access(files[2]);
  assert.ok((await rows()).some((x) => x.name === 'Bin'));
  await rowAction('Bin', '.ra-trash');
  await app.dialogMatching(/RECYCLE BIN/);
  await app.press('Move to Bin');
  await app.until(async () => !(await rows()).some((x) => x.name === 'Bin'), { what: 'the list without it' });
  await app.until(() => fs.access(files[2]).then(() => false, () => true), { what: 'moved out of its folder' }); // (Windows may show it there a moment longer)
  await fs.access(path.join(bin, 'Bin.stet')); // into the (test) bin, not deleted
  await rowAction('Gone', '.ra-trash');
  await app.dialogMatching(/RECYCLE BIN/);
  await app.press('Move to Bin');
  await app.dialogMatching(/no longer exists/);
  await app.eval(`document.querySelector('#overlay .btn.primary').click()`);
  await app.until(async () => !(await rows()).some((x) => x.name === 'Gone'), { what: 'the missing entry removed' });
  await fs.access(files[0]);
  await app.key('Escape');
  await app.noDialog();
});

test('File > Restore Backup: this screenplay\'s backups by day, with their words; delete and restore each take a second press', async () => {
  const file = path.join(tmp, 'Backed Up.stet');
  const json = async (text) => { await app.load([['action', text]]); return app.eval('__stet.session.serialize()'); };
  const alpha = await json('Alpha one two.'), beta = await json('Beta words here now.');
  await app.load([['action', 'Gamma.']]);
  assert.equal((await app.saveTo(file)).ok, true);
  const ref = await app.eval('JSON.stringify(__stet.session.ref())');
  for (const j of [alpha, beta]) assert.equal((await app.eval(`__stet.api.invoke('backup:create', { ...${ref}, json: ${JSON.stringify(j)} })`)).ok, true);
  const dir = await app.eval(`__stet.api.invoke('backup:dir', ${ref})`);
  const onDisk = async () => (await fs.readdir(dir)).filter((n) => n.endsWith('.stet')).length;
  assert.equal(await onDisk(), 2);
  assert.ok(await app.eval(`__stet.cmd.all().some((c) => c.id === 'backups' && c.label === 'Restore Backup…')`), 'in the File menu as Restore Backup');
  await app.eval(`__stet.cmd.run('backups')`);
  await app.until(`document.querySelectorAll('.bk-row').length === 2 && ![...document.querySelectorAll('.bk-words')].some((w) => w.textContent.startsWith('…'))`, { what: 'the backups with their words' });
  const rows = await app.eval(`[...document.querySelectorAll('.bk-list > *')].map((n) => n.classList.contains('bk-day') ? 'day ' + n.textContent : n.querySelector('.bk-words').textContent)`);
  assert.equal(rows[0], 'day Today');
  assert.deepEqual(rows.slice(1).sort(), ['3 words+2 vs now', '4 words+3 vs now'], 'each with its words, against the script now');
  const row = (w) => `[...document.querySelectorAll('.bk-row')].find((r) => r.querySelector('.bk-words').textContent.startsWith('${w}'))`;
  const press = async (w, which) => { const r = await app.eval(`(() => { const b = ${row(w)}.querySelector('${which}').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); await app.click(r.x, r.y); };
  // DELETE: the first press only asks; the second removes the backup from the disk, and its row folds away.
  await press('3 words', '.bk-del');
  assert.equal(await app.eval(`${row('3 words')}.querySelector('.bk-del').textContent`), 'CONFIRM');
  assert.equal(await onDisk(), 2, 'one press deletes nothing');
  await press('3 words', '.bk-del');
  await app.until(`document.querySelectorAll('.bk-row').length === 1`, { what: 'the row gone' });
  assert.equal(await onDisk(), 1);
  // RESTORE: the second press asks for a new screenplay, named after this one and the backup's time, in the same folder.
  await press('4 words', '.bk-restore');
  assert.equal(await app.eval(`!!document.querySelector('.bk-dlg')`), true, 'one press restores nothing');
  await press('4 words', '.bk-restore');
  await app.until(`document.querySelector('#overlay .dlg')?.textContent.includes('RESTORE AS NEW SCREENPLAY')`, { what: 'the new screenplay asked for' });
  const [name, where] = await app.eval(`[...document.querySelectorAll('#overlay .dlg input[type=text]')].slice(0, 2).map((i) => i.value)`);
  assert.match(name, /^Backed Up \d{4}-\d{2}-\d{2} \d{4}$/, 'the screenplay and the time of its backup');
  assert.equal(where, tmp, 'in the folder of the one it came from');
  await app.press('Restore');
  await app.until(`__stet.editor.blocks[0].text === 'Beta words here now.' && __stet.session.path && !__stet.session.dirty`, { what: 'the backup restored and saved' });
  assert.equal(await app.eval('__stet.session.path'), path.join(tmp, name + '.stet'), 'a screenplay of its own');
  assert.match((await app.eval(`__stet.api.invoke('doc:read', ${JSON.stringify(file)})`)).json, /Gamma\./, 'the one that was open left as it was');
  assert.equal(await onDisk(), 1, 'nothing taken from its backups');
});

test('Tools > Run Performance Probe gives a score and leaves no trace', async () => {
  const file = path.join(tmp, 'Mine.stet');
  await app.load([['scene', 'INT. HOUSE - DAY']]);
  assert.equal((await app.saveTo(file)).ok, true);
  await app.caret(0, 4);
  const state = `(async () => ({ recent: (await __stet.api.invoke('recent:list')).map((x) => x.path), rec: (await __stet.api.invoke('recovery:list')).length, stats: (await __stet.api.invoke('stats:get')).data, text: __stet.editor.blocks.map((b) => b.text).join('|'), path: __stet.session.path, dirty: __stet.session.dirty, caret: __stet.editor.caret }))()`;
  const probes = async () => (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('stet-probe-'));
  const before = await app.eval(state), dirs = await probes();
  await app.eval('window.__stetPerfSizes = [6]'); // the probe's own steps on one small script (it measures 120 and 400 pages)
  await app.eval(`void __stet.cmd.run('perf')`); // as from the Tools menu
  const score = Number(await app.until(`document.querySelector('#overlay .pf-score')?.textContent`, { timeout: 30000, what: 'the score' }));
  assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `score ${score}`);
  await app.key('Escape');
  await app.noDialog();
  await sleep(200); // (anything that would autosave or back up would do so now)
  assert.deepEqual(await app.eval(state), before, 'the screenplay back as it was, caret and all; Open Recent, recovery copies and statistics untouched');
  assert.deepEqual(await probes(), dirs, 'the scratch folder is gone');
});

// ---- across restarts ----

test('launching opens the last screenplay edited: not one only looked at since, and not lost to a new untitled one', async () => {
  const edited = path.join(tmp, 'Edited.stet'), looked = path.join(tmp, 'Looked At.stet');
  await app.load([['action', 'Only looked at.']]);
  assert.equal((await app.saveTo(looked)).ok, true);
  await app.load([['action', 'Written in.']]);
  assert.equal((await app.saveTo(edited)).ok, true);
  assert.equal(await app.eval(`__stet.openPath(${JSON.stringify(looked)})`), true);
  assert.equal((await app.eval(`__stet.api.invoke('recent:list')`))[0].path, looked, 'the one opened last heads Open Recent');
  await app.eval(`__stet.session.newUntitled()`);
  await app.close();
  app = await launch();
  await app.until(`__stet.session.path === ${JSON.stringify(edited)}`, { what: 'the last one edited to open', timeout: 10000 });
});

test('a screenplay opens again where it was left, at launch and from Open Recent: the caret and the window as they were', async () => {
  const far = path.join(tmp, 'Long Way.stet'), other = path.join(tmp, 'Other.stet');
  const list = [];
  for (let s = 0; s < 30; s++) { list.push(['scene', `INT. ROOM ${s} - DAY`]); for (let a = 0; a < 6; a++) list.push(['action', `Line ${a} of scene ${s}.`]); }
  await app.load([['action', 'Another one.']]);
  assert.equal((await app.saveTo(other)).ok, true);
  await app.load(list);
  assert.equal((await app.saveTo(far)).ok, true);
  await app.caret(150, 4);
  await app.frame();
  const top = await app.eval('__stet.view.scroller.scrollTop');
  assert.ok(top > 2000, 'well into the script');
  await app.until('(__stet.settings().places || []).some((p) => p.id === __stet.session.doc.meta.id && p.caret.b === 150)', { what: 'the place kept' });
  await app.close();
  app = await launch();
  await app.until(`__stet.session.path === ${JSON.stringify(far)} && __stet.editor.caret.b === 150 && __stet.editor.caret.o === 4`, { what: 'back at the caret', timeout: 10000 });
  await app.frame();
  assert.ok(Math.abs(await app.eval('__stet.view.scroller.scrollTop') - top) <= 2, 'the window where it was');
  // Another screenplay and back: each opens where it was left.
  assert.equal(await app.eval(`__stet.openPath(${JSON.stringify(other)})`), true);
  await app.until(`__stet.session.path === ${JSON.stringify(other)} && __stet.editor.caret.b === 0`, { what: 'the other at its start' });
  assert.equal(await app.eval(`__stet.openPath(${JSON.stringify(far)})`), true);
  await app.until('__stet.editor.caret.b === 150', { what: 'back where it was' });
  await app.frame();
  assert.ok(Math.abs(await app.eval('__stet.view.scroller.scrollTop') - top) <= 2, 'and the window too');
});

test('a crash: the unsaved work comes back on the next start', async () => {
  await app.eval('__stet.session.autosaveDelay = 40');
  await app.eval('__stet.session.newUntitled()');
  await app.eval('__stet.input.focus()');
  await app.type('ext. harbor - dawn');
  await app.key('Escape');
  await app.key('Enter');
  await app.type('Gulls. Nothing else survives.');
  assert.deepEqual(await app.blocks(), [['scene', 'EXT. HARBOR - DAWN'], ['action', 'Gulls. Nothing else survives.']], 'typed into the new screenplay ' + await app.eval('JSON.stringify({ active: document.activeElement.id || document.activeElement.className, dlg: document.querySelector("#overlay:not([hidden]) .dlg")?.innerText, dirty: __stet.session.dirty, quiet: __stet.session.quiet })'));
  await app.until(`__stet.api.invoke('recovery:list').then(async (l) => l.length && (await __stet.api.invoke('recovery:read', l[0].file)).json?.includes('survives.'))`, { what: 'a recovery copy with the last words' });
  await app.kill();
  app = await launch();
  await app.dialogMatching(/RECOVER WORK/, 10000);
  await app.press('Restore');
  await app.until(`__stet.editor.blocks.length === 2`);
  assert.deepEqual(await app.blocks(), [['scene', 'EXT. HARBOR - DAWN'], ['action', 'Gulls. Nothing else survives.']]);
  assert.equal(await app.eval('__stet.session.dirty'), true, 'restored, not yet saved');
});
