// Word count and writing statistics in the real app: every editing route,
// document switching, saving and reopening, restarts, an upgrade from 0.6's
// statistics file, the weekly view and the confirmed Reset.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';
import { referenceDocCount } from '../helpers/wordref.js';

let tmp, ud, app;
const launch = () => App.launch({ userData: ud });
const newDoc = () => app.eval(`(async () => { const { newDocument, makeBlock } = await import('../core/model.js'); const d = newDocument(''); d.settings.backup.enabled = false; d.blocks = [makeBlock('action')]; __stet.session.load(d, null); })()`);
const paste = (t) => app.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(t)}); const ta = document.getElementById('input'); ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
const state = async () => {
  await app.eval('__stet.view.frame()');
  const s = await app.eval(`({ words: __stet.editor.words, shown: document.getElementById('st-words').textContent, texts: __stet.editor.blocks.map((b) => ({ text: b.text })) })`);
  return { words: s.words, shown: +s.shown.replace(/\D/g, ''), ref: referenceDocCount(s.texts) };
};
const exact = async (msg) => { const s = await state(); assert.equal(s.words, s.ref, 'count = reference ' + msg); assert.equal(s.shown, s.ref, 'status bar shows it ' + msg); return s.words; };
const today = async () => { await sleep(400); return app.eval(`+document.getElementById('st-goal').textContent.match(/TODAY ([\\d,]+)/)[1].replace(/,/g, '')`); };
const total = () => app.eval('__stet.writing.book.data.total');
const saveTo = async (name) => { const f = path.join(tmp, name); assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(f)})`)).ok, true); return f; };
/** Close the way a user does (window close → statistics flushed → exit). The document must be saved. */
const closeApp = async () => {
  const exited = new Promise((r) => app.child.once('exit', r));
  await app.eval('window.stet.invoke("e2e:close-window")').catch(() => {});
  await Promise.race([exited, sleep(8000)]);
  if (app.child.exitCode === null) { await app.kill(); throw new Error('app did not close'); }
};

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-stats-e2e-'));
  ud = path.join(tmp, 'ud');
  await fs.mkdir(ud, { recursive: true });
  // Statistics left by STET 0.6 (format 1): must survive the upgrade.
  const y = new Date(Date.now() - 86400000);
  const k = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await fs.writeFile(path.join(ud, 'stats.json'), JSON.stringify({ days: { [k]: { w: 321, docs: { old: { base: 1000, peak: 1321 } } } } }));
  app = await launch();
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('0.6 statistics are carried over on upgrade', async () => {
  assert.equal(await total(), 321);
  const files = await fs.readdir(ud);
  assert.ok(files.includes('stats-v1.json'), 'the old file is kept');
});

test('count is exact after typing, pastes, replacing, deleting, undo and redo', async () => {
  await newDoc();
  assert.equal(await exact('empty'), 0);
  const t0 = await today();
  await app.type('one two three ');
  assert.equal(await exact('typed'), 3);
  assert.equal(await today(), t0 + 3);
  const big = Array.from({ length: 6000 }, (_, i) => (i % 30 === 29 ? 'end.\n\n' : 'w' + i)).join(' ');
  await paste(big); await exact('large paste');
  await paste(big); await exact('second large paste');
  await paste('  tabs\t\tand   spaces \r\n\r\n — dash… don\'t 日本 '); await exact('mixed paste');
  assert.equal(await today(), t0 + 3, 'pasting is not writing');
  await app.key('Ctrl+A'); await paste('Replaced everything.'); await exact('replace all');
  for (let i = 0; i < 4; i++) { await app.key('Ctrl+Z'); await exact('undo ' + i); }
  for (let i = 0; i < 4; i++) { await app.key('Ctrl+Y'); await exact('redo ' + i); }
  await app.key('Ctrl+A'); await app.key('Backspace');
  assert.equal(await exact('cleared'), 0);
  await app.type('fresh words now ');
  assert.equal(await exact('after clearing'), 3);
  assert.equal(await today(), t0 + 6, 'writing after clearing counts straight away');
  await app.key('Backspace'); await app.key('Backspace'); await app.key('Backspace'); await app.key('Backspace');
  await app.type('wow ');
  assert.equal(await today(), t0 + 6, 'a fixed typo is not counted twice');
});

test('switching rapidly between documents and reopening them counts nothing new', async () => {
  const sizes = [0, 50, 2000];
  const files = [];
  for (const n of sizes) {
    await newDoc();
    if (n) await paste(Array.from({ length: n }, (_, i) => 'z' + i).join(' '));
    files.push(await saveTo(`Switch${n}.stet`));
  }
  const t0 = await today();
  for (let r = 0; r < 12; r++) {
    const i = r % files.length;
    await app.eval(`__stet.openPath(${JSON.stringify(files[i])})`);
    assert.equal(await exact(`open ${i}`), sizes[i]);
  }
  assert.equal(await today(), t0, 'no words from opening and switching');
  // Write in one, switch, write in another: both count once.
  await app.eval(`__stet.openPath(${JSON.stringify(files[1])})`);
  await app.key('Ctrl+End'); await app.type(' extra words');
  await app.eval('__stet.save()');
  await app.eval(`__stet.openPath(${JSON.stringify(files[2])})`);
  await app.key('Ctrl+End'); await app.type(' more');
  await app.eval('__stet.save()');
  assert.equal(await today(), t0 + 3);
  await app.eval(`__stet.openPath(${JSON.stringify(files[1])})`);
  assert.equal(await exact('reopened after editing'), 52);
});

test('statistics survive a restart; nothing is counted again on reopening', async () => {
  await newDoc();
  await app.type('before the restart ');
  await saveTo('Restart.stet');
  const t = await total();
  const td = await today();
  await closeApp();
  app = await launch();
  assert.equal(await total(), t, 'all-time total intact');
  assert.equal(await today(), td, 'today intact');
  await app.eval(`__stet.openPath(${JSON.stringify(path.join(tmp, 'Restart.stet'))})`);
  assert.equal(await exact('reopened'), 3);
  assert.equal(await today(), td);
  const saved = JSON.parse(await fs.readFile(path.join(ud, 'stats.json'), 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.total, t);
});

test('weekly view: numbers on the bars, goals, and Reset only after explicit confirmation', async () => {
  await app.eval('void __stet.cmd.run("stats")');
  await sleep(300);
  const view = await app.eval(`(() => { const q = (s) => [...document.querySelectorAll('#overlay ' + s)]; return { cols: q('.wk-col').length, vals: q('.wk-val').map((v) => v.textContent), days: q('.wk-days > div').map((d) => d.textContent.slice(0, 3)), head: document.querySelector('#overlay .wk-head').textContent, reset: !!document.querySelector('#overlay .wk-reset') }; })()`);
  assert.equal(view.cols, 7);
  assert.deepEqual(view.days, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  const td = await app.eval('__stet.writing.summary({}).today.words');
  assert.ok(view.vals.includes(td.toLocaleString()), 'today’s number is printed on its bar');
  assert.match(view.head, /THIS WEEK/);
  assert.ok(view.reset);
  const before = await total();
  assert.ok(before > 0);
  const openConfirm = async () => {
    await app.eval(`document.querySelector('#overlay .wk-reset').click()`);
    await sleep(200);
    return app.eval(`document.querySelector('#overlay .dlg h2')?.textContent`);
  };
  // Escape cancels.
  assert.match(await openConfirm(), /RESET STATISTICS/);
  assert.match(await app.eval(`document.querySelector('#overlay').textContent`), /Not affected/);
  await app.key('Escape'); await sleep(200);
  assert.equal(await total(), before, 'Escape is not confirmation');
  // Clicking outside cancels.
  assert.match(await openConfirm(), /RESET STATISTICS/);
  await app.eval(`document.getElementById('overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(200);
  assert.equal(await total(), before, 'clicking outside is not confirmation');
  // Enter on the focused Cancel cancels.
  assert.match(await openConfirm(), /RESET STATISTICS/);
  assert.equal(await app.eval('document.activeElement.textContent'), 'Cancel', 'Cancel has the focus, not Reset');
  await app.eval(`[...document.querySelectorAll('#overlay .btn')].find((b) => b.textContent === 'Cancel').click()`); await sleep(200);
  assert.equal(await total(), before, 'Cancel changes nothing');
  assert.match(await app.eval(`document.querySelector('#overlay .dlg h2').textContent`), /WRITING/, 'back to the week');
  // Confirm.
  await openConfirm();
  await app.eval(`[...document.querySelectorAll('#overlay .btn')].find((b) => b.textContent === 'Reset statistics').click()`); await sleep(500);
  assert.equal(await total(), 0);
  const after = await app.eval(`({ flash: document.querySelector('#overlay .wk-flash')?.textContent, n: document.querySelector('#overlay .wk-head .wk-n').textContent })`);
  assert.match(after.flash, /reset/i);
  assert.match(after.n, /^0/);
  await app.key('Escape');
  assert.equal(await today(), 0, 'status bar updated too');
  assert.equal(JSON.parse(await fs.readFile(path.join(ud, 'stats.json'), 'utf8')).total, 0, 'saved');
  assert.ok((await fs.readdir(ud)).some((f) => f.startsWith('stats-before-reset-')), 'archived');
  // Counting continues normally; the word count itself is unaffected.
  const w = await exact('after reset');
  await app.key('Ctrl+End'); await app.type(' new');
  assert.equal(await exact('typing after reset'), w + 1);
  assert.equal(await today(), 1);
});

test('a crash loses at most the last moment of writing', async () => {
  await newDoc();
  const t = await total();
  await app.type('written just before a crash ');
  await sleep(1200);
  await app.kill(); // no shutdown handlers run
  app = await launch();
  await sleep(300);
  await app.key('Escape'); // the recovery offer for the unsaved screenplay
  assert.equal(await total(), t + 5, 'every word written more than a second ago was saved');
});
