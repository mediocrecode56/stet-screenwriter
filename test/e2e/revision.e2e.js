// English revision in the real app, against a local mock of the Messages API
// (the real API is exercised separately with a real key; see README).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';
import { startMock, elementsOf } from '../helpers/mock-anthropic.js';
import { decode } from '../../src/main/container.js';

let tmp, app, mock, mode = {};
const KEY = 'sk-ant-test-0000000000000000000000000000';

// "Claude": flags known mistakes wherever they appear in a chunk.
const RULES = [
  { find: 'enter in the kitchen', original: 'enter in the kitchen', replacement: 'enters the kitchen', category: 'grammar', confidence: 'high' },
  { find: 'looking to him since five minutes', original: 'looking to him since five minutes', replacement: 'staring at him for five minutes', category: 'non_native', confidence: 'medium' },
  { find: 'made a decision of leaving', original: 'made a decision of leaving', replacement: 'decided to leave', category: 'awkward', confidence: 'medium' },
  { find: 'ITNRO', original: 'ITNRO', replacement: 'INTRO', category: 'awkward', confidence: 'low' },
];

async function handler({ prompt, attempt }) {
  if (mode.status && (!mode.statusTimes || attempt <= mode.statusTimes)) return { status: mode.status, noRetry: mode.noRetry };
  const findings = [];
  for (const el of elementsOf(prompt)) {
    for (const r of RULES) if (el.text.includes(r.find)) findings.push({ element: el.id, category: r.category, original: r.original, replacement: r.replacement, explanation: 'mock: ' + r.category, confidence: r.confidence });
  }
  findings.push({ element: 'e999', category: 'grammar', original: 'nope', replacement: 'x', explanation: 'hallucinated element', confidence: 'high' });
  return { findings, delayMs: mode.delayMs || 0 };
}

const loadScript = () => app.eval(`(async () => {
  const { newDocument, makeBlock } = await import('../core/model.js');
  const d = newDocument('REV'); d.settings.backup.enabled = false;
  d.blocks = [
    makeBlock('scene', 'INT. KITCHEN - NIGHT'),
    makeBlock('action', 'Mara enter in the kitchen and sits.'),
    makeBlock('character', 'TEO'),
    makeBlock('dialogue', "Ain't nobody awake. ITNRO starts soon."),
    makeBlock('action', 'She is looking to him since five minutes.'),
    makeBlock('action', 'Teo made a decision of leaving.'),
  ];
  __stet.session.load(d, null);
})()`);
const texts = () => app.eval('__stet.editor.blocks.map(b => b.text)');
const findings = () => app.eval('__stet.revision.findings.map(f => ({ id: f.id, cat: f.category, status: f.status, o: f.shownOriginal }))');
const waitDone = async () => { for (let i = 0; i < 200; i++) { if (await app.eval('!!(__stet.revision.run && __stet.revision.run.finished)')) return; await sleep(50); } throw new Error('review did not finish'); };

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-rev-'));
  mock = await startMock(handler);
  app = await App.launch({ userData: path.join(tmp, 'ud'), env: { STET_ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: KEY } });
  await app.eval(`window.stet.invoke('settings:set', { reviewConsent: true }).then(s => { const cur = __stet.settings(); Object.assign(cur, s); })`);
});
after(async () => { if (app) await app.close(); if (mock) await mock.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('review sends a structured request and categorises findings', async () => {
  await loadScript();
  await app.eval('__stet.revision.show(true); __stet.revision.start()');
  await waitDone();
  const req = mock.requests.find((r) => r.body && r.body.messages);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.thinking.type, 'adaptive');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(req.headers['x-api-key'], KEY, 'key sent only in the API request, from the main process');
  assert.ok(!/TITLE|Written by/.test(req.body.messages[0].content), 'title page not sent');
  const fs_ = await findings();
  assert.deepEqual(fs_.map((f) => f.cat).sort(), ['awkward', 'awkward', 'grammar', 'non_native']);
  assert.equal(await app.eval('__stet.revision.run.rejected'), 1, 'hallucinated element discarded');
  assert.equal(await app.eval('document.querySelectorAll(".rv-group").length'), 3, 'grouped by category');
  await app.eval('__stet.view.frame()');
  assert.ok(await app.eval('document.querySelectorAll(".revr").length') >= 4, 'flagged passages marked in the script');
  assert.equal(await app.eval('__stet.renderer || __stet.session.dirty'), false, 'reviewing changes nothing');
});

test('accept, undo, redo, reject, dismiss', async () => {
  const g = (await findings()).find((f) => f.cat === 'grammar');
  await app.eval(`__stet.revision.accept(['${g.id}'])`);
  assert.equal((await texts())[1], 'Mara enters the kitchen and sits.');
  assert.equal((await findings()).find((f) => f.id === g.id).status, 'accepted');
  await app.eval('__stet.editor.undo(); __stet.revision.documentChanged()'); await sleep(200);
  assert.equal((await texts())[1], 'Mara enter in the kitchen and sits.');
  assert.equal((await findings()).find((f) => f.id === g.id).status, 'open', 'undo re-offers it');
  await app.eval('__stet.editor.redo(); __stet.revision.documentChanged()'); await sleep(200);
  assert.equal((await texts())[1], 'Mara enters the kitchen and sits.');
  assert.equal((await findings()).find((f) => f.id === g.id).status, 'accepted');
  const nn = (await findings()).find((f) => f.cat === 'non_native');
  await app.eval(`__stet.revision.setStatus('${nn.id}', 'rejected')`);
  assert.equal((await texts())[4], 'She is looking to him since five minutes.', 'reject leaves the text');
  const aw = (await findings()).find((f) => f.o === 'made a decision of leaving');
  await app.eval(`__stet.revision.setStatus('${aw.id}', 'dismissed')`);
  assert.ok(!(await findings()).some((f) => f.id === aw.id));
  assert.equal((await texts())[5], 'Teo made a decision of leaving.');
});

test('accept-all in a category is one undo step', async () => {
  await loadScript();
  await app.eval('__stet.revision.start()'); await waitDone();
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.filter(f => f.category === 'awkward' && f.status === 'open').map(f => f.id)); })()`);
  const t = await texts();
  assert.equal(t[5], 'Teo decided to leave.');
  assert.equal(t[3], "Ain't nobody awake. INTRO starts soon.");
  await app.eval('__stet.editor.undo()');
  const u = await texts();
  assert.equal(u[5], 'Teo made a decision of leaving.');
  assert.equal(u[3], "Ain't nobody awake. ITNRO starts soon.");
});

test('editing during a review never causes a wrong replacement', async () => {
  await loadScript();
  mode = { delayMs: 1200 };
  await app.eval('__stet.revision.start()');
  await sleep(200);
  // While Claude "thinks", rewrite the sentence that will be flagged as non-native and move another.
  await app.eval(`(() => { const ed = __stet.editor;
    ed.setSel({ b: 4, o: 0 }, { b: 4, o: ed.blocks[4].text.length }); ed.backspace(); for (const c of 'She watches him.') ed.insertText(c);
    ed.setSel({ b: 1, o: 0 }); for (const c of 'Tired, ') ed.insertText(c); })()`);
  await waitDone();
  mode = {};
  const f = await findings();
  assert.equal(f.find((x) => x.cat === 'non_native').status, 'outdated');
  assert.equal(f.find((x) => x.cat === 'grammar').status, 'open', 'relocated to the moved text');
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.map(f => f.id)); })()`);
  const t = await texts();
  assert.equal(t[1], 'Tired, Mara enters the kitchen and sits.');
  assert.equal(t[4], 'She watches him.', 'outdated suggestion not applied');
});

test('rate limits are retried; failing sections can be retried; cancel stops', async () => {
  await loadScript();
  mode = { status: 429, statusTimes: 2 }; // SDK retries with backoff
  await app.eval('__stet.revision.start()'); await waitDone();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 0);
  assert.ok((await findings()).length >= 4);

  mode = { status: 500, noRetry: true };
  await app.eval('__stet.revision.start()'); await waitDone();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 1);
  assert.match(await app.eval('document.querySelector(".rv-fail").textContent'), /failed/);
  mode = {};
  await app.eval('__stet.revision.retryFailed()'); await waitDone();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 0);
  assert.ok((await findings()).length >= 4);

  mode = { delayMs: 8000 };
  await app.eval('__stet.revision.start()');
  await sleep(300);
  const t0 = Date.now();
  await app.eval('__stet.revision.cancel()');
  await waitDone();
  assert.ok(Date.now() - t0 < 3000, 'cancel is prompt');
  assert.equal(await app.eval('__stet.revision.run.cancelled'), true);
  mode = {};
});

test('Ignore is remembered in the screenplay file; dictionary in every project', async () => {
  await loadScript();
  await app.eval('__stet.revision.start()'); await waitDone();
  const nn = (await findings()).find((f) => f.cat === 'non_native');
  await app.eval(`__stet.revision.ignore('${nn.id}')`);
  // Dictionary entry (the prompt dialog is bypassed by calling setSettings directly).
  await app.eval(`__stet.revision.setSettings({ dictionary: ['ITNRO'] })`);
  const file = path.join(tmp, 'Rev.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`)).ok, true);
  const json = await decode(await fs.readFile(file));
  assert.deepEqual(JSON.parse(json).revision.ignored, [{ text: 'looking to him since five minutes', category: 'non_native' }]);
  assert.ok(!json.includes('sk-ant'), 'no key in the screenplay file');
  assert.ok(!json.includes('ITNRO"]'), 'dictionary lives in app settings, not the file');
  await app.close();
  app = await App.launch({ userData: path.join(tmp, 'ud'), env: { STET_ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: KEY } });
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  mock.requests.length = 0;
  await app.eval('__stet.revision.start()'); await waitDone();
  const f = await findings();
  assert.ok(!f.some((x) => x.cat === 'non_native'), 'ignored passage not shown again');
  assert.ok(!f.some((x) => x.o === 'ITNRO'), 'dictionary word not shown again');
  const sys = mock.requests.find((r) => r.body && r.body.system).body.system[0].text;
  assert.match(sys, /dictionary[\s\S]*"ITNRO"/);
  assert.match(sys, /already reviewed[\s\S]*looking to him since five minutes/);
});
