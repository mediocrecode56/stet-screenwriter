// Tools > Run Performance Probe: it gives a score and leaves no trace — the open screenplay comes
// back as it was, and Open Recent, recovery copies, backups, statistics and temp files are untouched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, ud, app;
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-perf-'));
  ud = path.join(tmp, 'ud');
  await fs.mkdir(ud, { recursive: true });
  app = await App.launch({ userData: ud, hidden: false }); // a hidden window draws (almost) no frames
  await sleep(500);
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

const probeDirs = async () => (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('stet-probe-'));

test('the probe scores the app and leaves no trace', async () => {
  const file = path.join(tmp, 'Mine.stet');
  await app.eval(`(() => { const e = __stet.editor; e.insertText('INT. HOUSE - DAY'); })()`);
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`)).ok, true);
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  await sleep(300);
  await app.eval(`__stet.editor.setSel({ b: 0, o: 4 })`);
  const before = await app.eval(`(async () => ({ recent: await __stet.api.invoke('recent:list'), rec: (await __stet.api.invoke('recovery:list')).length, stats: (await __stet.api.invoke('stats:get')).data, text: __stet.editor.blocks.map((b) => b.text).join('|') }))()`);
  const dirsBefore = await probeDirs();

  const t0 = Date.now();
  await app.eval(`void __stet.cmd.run('perf')`); // as from the Tools menu
  let shown = null;
  while (!shown && Date.now() - t0 < 60000) { await sleep(250); shown = await app.eval(`document.querySelector('#overlay .pf-score')?.textContent ?? null`); }
  const ms = Date.now() - t0;
  const score = Number(shown);
  assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `score ${shown}`);
  assert.ok(ms < 30000, `took ${ms} ms`);
  const r = { score };
  await app.key('Escape');
  await sleep(200);

  const now = await app.eval(`(async () => ({ recent: await __stet.api.invoke('recent:list'), rec: (await __stet.api.invoke('recovery:list')).length, stats: (await __stet.api.invoke('stats:get')).data, text: __stet.editor.blocks.map((b) => b.text).join('|'), path: __stet.session.path, dirty: __stet.session.dirty, caret: __stet.editor.caret }))()`);
  assert.equal(now.path, file, 'the screenplay is back');
  assert.equal(now.text, before.text);
  assert.equal(now.dirty, false);
  assert.deepEqual(now.caret, { b: 0, o: 4 }, 'the caret where it was');
  assert.deepEqual(now.recent.map((x) => x.path), before.recent.map((x) => x.path), 'Open Recent untouched');
  assert.equal(now.rec, before.rec, 'no recovery copies');
  assert.deepEqual(now.stats, before.stats, 'statistics untouched');
  assert.deepEqual(await probeDirs(), dirsBefore, 'the scratch folder is gone');
  await sleep(1500); // nothing autosaves or backs up afterwards either
  assert.equal(await app.eval(`(async () => (await __stet.api.invoke('recovery:list')).length)()`), before.rec);
  console.log(`probe: score ${r.score}, ${ms} ms`);
});
