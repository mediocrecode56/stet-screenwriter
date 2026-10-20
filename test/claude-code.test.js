// The Claude Code CLI behind the no-API-key English revision: finding the copy the
// Claude desktop app keeps (wherever its version put it), checking the sign-in without
// using the model, and reading one review's answer — against a fake CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaudeCode, signedIn, reviewChunkCli } from '../src/main/claude-code.js';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'fake-claude-code.mjs');
const fake = { path: FAKE, label: 'fake', node: true };

/** Run `fn` with these environment variables (restored afterwards). */
async function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try { return await fn(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
async function touch(...parts) { const p = path.join(...parts); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, ''); return p; }

test('finds the Claude app\'s own Claude Code in every place it has kept it, the newest copy first', { skip: process.platform !== 'win32' && 'Windows layout' }, async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-find-'));
  const local = path.join(tmp, 'Local'), roaming = path.join(tmp, 'Roaming'), home = path.join(tmp, 'home');
  await fs.mkdir(home, { recursive: true });
  const env = { PATH: '', LOCALAPPDATA: local, APPDATA: roaming, USERPROFILE: home, HOME: home, STET_CLAUDE_CODE: undefined };
  try {
    await withEnv(env, async () => assert.equal(await findClaudeCode(), null, 'nothing installed: none'));
    // Older desktop app versions: %APPDATA%\Claude\claude-code, and inside the MSIX package folder.
    await touch(roaming, 'Claude', 'claude-code', '2.1.200', 'aa11', 'claude.exe');
    const pkg = await touch(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.250', 'bb22', 'claude.exe');
    await withEnv(env, async () => assert.equal((await findClaudeCode()).path, pkg, 'the newer of the two'));
    // The current app: %LOCALAPPDATA%\Claude-Data\<install>\claude-code\<version>\<build>\claude.exe (the place 0.14 missed).
    await touch(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc', 'claude-code', '2.1.295', 'cc33', 'claude.exe');
    const now = await touch(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc', 'claude-code', '2.1.299', 'dd44', 'claude.exe');
    await fs.mkdir(path.join(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc', 'claude-code', '2.1.300', 'ee55'), { recursive: true }); // an unfinished update: no exe yet
    await withEnv(env, async () => {
      const c = await findClaudeCode();
      assert.equal(c.path, now);
      assert.match(c.label, /2\.1\.299/);
    });
    // A claude.exe on PATH (Claude Code installed on its own) is used before any bundled copy.
    const own = await touch(tmp, 'bin', 'claude.exe');
    await withEnv({ ...env, PATH: path.dirname(own) }, async () => assert.equal((await findClaudeCode()).path, own));
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test('the sign-in is checked without the model; signed out is a clear, actionable message', async () => {
  await withEnv({ FAKE_CC_MODE: '' }, async () => assert.deepEqual(await signedIn(fake), { ok: true }));
  await withEnv({ FAKE_CC_MODE: 'auth-out' }, async () => {
    const r = await signedIn(fake);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'auth');
    assert.match(r.message, /not signed in.*sign in/);
    assert.ok(!/example\.com/.test(r.message), 'nothing from the account is passed on');
  });
  // A CLI that doesn't know `auth status` (or prints something else) gets the benefit of the doubt.
  await withEnv({ FAKE_CC_MODE: 'garbage' }, async () => assert.equal((await signedIn({ ...fake, path: FAKE + '.missing' })).ok, true));
  const none = await signedIn(null);
  assert.equal(none.code, 'cli');
  assert.match(none.message, /not found.*Install/);
});

test('a review chunk through the CLI: findings come back as data; failures say what to do', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-cli-'));
  const sp = path.join(tmp, 'system.txt');
  await fs.writeFile(sp, 'screenplay line editor');
  const chunk = { index: 0, prompt: '<review>\ne1 [ACTION] "Mara enter in the kitchen and sits."\n</review>' };
  try {
    const ok = await withEnv({ FAKE_CC_MODE: '' }, () => reviewChunkCli(fake, tmp, sp, chunk));
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.findings.map((f) => [f.element, f.original]), [['e1', 'enter in the kitchen']]);
    const out = await withEnv({ FAKE_CC_MODE: 'logged-out' }, () => reviewChunkCli(fake, tmp, sp, chunk, undefined, ' Or choose the API key.'));
    assert.equal(out.error.code, 'auth');
    assert.match(out.error.message, /not signed in.* Or choose the API key\.$/, 'the other way, when it is set up');
    const bad = await withEnv({ FAKE_CC_MODE: 'garbage' }, () => reviewChunkCli(fake, tmp, sp, chunk));
    assert.equal(bad.ok, false);
    assert.match(bad.error.message, /Claude Code: panic/);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});
