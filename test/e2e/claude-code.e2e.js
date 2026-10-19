// English revision through the Claude Code CLI (no API key), against a fake CLI that
// behaves like `claude -p --output-format json`. The real CLI is exercised by
// bench/revision-live.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { App, sleep } from './cdp.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'fake-claude-code.mjs');
let tmp, log, app;

const launch = (mode = '') => App.launch({ userData: path.join(tmp, 'ud'), env: { STET_CLAUDE_CODE: FAKE, FAKE_CC_LOG: log, FAKE_CC_MODE: mode, ANTHROPIC_API_KEY: '' } });
const loadScript = () => app.eval(`(async () => {
  const { newDocument, makeBlock } = await import('../core/model.js');
  const d = newDocument('CLI'); d.settings.backup.enabled = false;
  d.blocks = [
    makeBlock('scene', 'INT. KITCHEN - NIGHT'),
    makeBlock('action', 'Mara enter in the kitchen and sits.'),
    makeBlock('character', 'TEO'),
    makeBlock('dialogue', "Ain't nobody awake."),
    makeBlock('action', 'She is looking to him since five minutes.'),
    makeBlock('action', 'Teo made a decision of leaving.'),
  ];
  __stet.session.load(d, null);
})()`);
const waitDone = async (ms = 20000) => { for (let i = 0; i < ms / 50; i++) { if (await app.eval('!!(__stet.revision.run && __stet.revision.run.finished)')) return; await sleep(50); } throw new Error('review did not finish'); };
const calls = async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const consent = () => app.eval(`window.stet.invoke('settings:set', { reviewConsent: true }).then(s => Object.assign(__stet.settings(), s))`);

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-cc-'));
  log = path.join(tmp, 'calls.jsonl');
  app = await launch();
  await consent();
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('with no API key, the review runs through Claude Code', async () => {
  const st = await app.eval(`window.stet.invoke('claude:key-status')`);
  assert.equal(st.source, 'claude-code');
  await loadScript();
  await app.eval('__stet.revision.show(true); __stet.revision.start()');
  await waitDone();
  const f = await app.eval('__stet.revision.findings.map(f => f.category)');
  assert.deepEqual(f.sort(), ['awkward', 'grammar', 'non_native']);
  const [c] = await calls();
  const arg = (k) => c.args[c.args.indexOf(k) + 1];
  assert.ok(c.args.includes('-p'));
  assert.equal(arg('--output-format'), 'json');
  assert.equal(arg('--model'), 'claude-opus-5-5');
  assert.equal(arg('--tools'), '', 'all tools disabled');
  assert.equal(arg('--setting-sources'), '', 'no user/project settings');
  assert.ok(c.args.includes('--strict-mcp-config') && c.args.includes('--no-session-persistence') && c.args.includes('--disable-slash-commands'));
  assert.equal(JSON.parse(arg('--json-schema')).type, 'object');
  assert.match(c.system, /screenplay/i, 'system prompt passed via file');
  assert.match(c.stdin, /Mara enter in the kitchen/, 'script sent on stdin, not the command line');
  assert.ok(!c.args.join(' ').includes('Mara'), 'script not on the command line');
  assert.match(path.basename(c.cwd), /^stet-review-/, 'runs in an empty temp folder');
  assert.equal(c.apiKey, null, 'no API key passed to the CLI');
  await sleep(300);
  await assert.rejects(fs.stat(c.cwd), 'temp folder removed afterwards');
  // Accepting still works the normal way.
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.filter(f => f.category === 'grammar').map(f => f.id)); })()`);
  assert.equal((await app.eval('__stet.editor.blocks.map(b => b.text)'))[1], 'Mara enters the kitchen and sits.');
});

test('a signed-out Claude Code gives a clear error; cancel kills the CLI', async () => {
  await app.close();
  app = await launch('logged-out'); await consent();
  await loadScript();
  await app.eval('__stet.revision.start()'); await waitDone();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 1);
  assert.match(await app.eval('[...__stet.revision.run.failed.values()][0].message'), /not signed in/);

  await app.close();
  app = await launch('slow'); await consent();
  await loadScript();
  await app.eval('__stet.revision.start()');
  await sleep(800);
  const t0 = Date.now();
  await app.eval('__stet.revision.cancel()');
  await waitDone(5000);
  assert.ok(Date.now() - t0 < 3000, 'cancel is prompt');
  assert.equal(await app.eval('__stet.revision.run.cancelled'), true);
});

test('unreadable CLI output is reported, not trusted', async () => {
  await app.close();
  app = await launch('garbage'); await consent();
  await loadScript();
  await app.eval('__stet.revision.start()'); await waitDone();
  assert.equal(await app.eval('__stet.revision.findings.length'), 0);
  assert.match(await app.eval('[...__stet.revision.run.failed.values()][0].message'), /Claude Code: panic/);
});
