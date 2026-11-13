// OpenAI Codex as a backup for the revision, used only when Claude has no usage left (or no
// Claude is set up at all). No Electron here; claude.js decides when it is used.
//
// Runs `codex exec` on the user's own Codex sign-in, read-only, ephemeral, without the user's
// config or rules, in an empty temporary folder, answering in the same findings schema.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FINDINGS_SCHEMA } from '../core/revision.js';
import { exists, runCli as run, stopped } from './cli.js';

// Its own newest model (none is named, so it follows Codex as models come and go) with the least
// reasoning: measured, that found every planted mistake. The effort is pinned, because the user's
// own Codex settings are left out and a default may change.
const QUIET = ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '-s', 'read-only', '-c', 'model_reasoning_effort="low"'];
const LIMIT = /usage limit|rate.?limit|quota/i;
const lastLines = (r) => String(r.err || r.out || `Codex exited with code ${r.code}.`).trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);

/** Locate the Codex CLI. Returns { path, label, node? } or null. */
export async function findCodex() {
  const forced = process.env.STET_CODEX; // tests: a fake CLI script, or "none"
  if (forced) return forced === 'none' ? null : { path: forced, label: 'Codex (test)', node: /\.m?js$/.test(forced) };
  const win = process.platform === 'win32';
  const exe = win ? 'codex.exe' : 'codex';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && await exists(path.join(dir, exe))) return { path: path.join(dir, exe), label: 'Codex' };
  }
  const home = os.homedir();
  const cands = [];
  if (win) {
    // The Codex desktop app: %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe (the hash changes on update).
    const bin = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    let dirs = [];
    try { dirs = await fs.readdir(bin); } catch { /* none */ }
    for (const d of dirs) cands.push(path.join(bin, d, exe));
  } else {
    cands.push('/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(home, '.local', 'bin', 'codex'),
      '/Applications/Codex.app/Contents/Resources/codex');
  }
  let best = null;
  for (const p of cands) {
    try { const st = await fs.stat(p); if (st.isFile() && (!best || st.mtimeMs > best.t)) best = { p, t: st.mtimeMs }; } catch { /* skip */ }
  }
  return best ? { path: best.p, label: 'Codex' } : null;
}

/** Is Codex signed in? `codex login status` exits 0 when it is. */
export async function codexSignedIn(cli) {
  if (!cli) return false;
  try { return (await run(cli, ['login', 'status'], { cwd: os.tmpdir(), timeoutMs: 20000 })).code === 0; } catch { return false; }
}

/** Write the schema file a Codex review needs into `dir` (once per review). */
export async function prepareCodex(dir) {
  const schemaFile = path.join(dir, 'codex-schema.json');
  await fs.writeFile(schemaFile, JSON.stringify(FINDINGS_SCHEMA));
  return schemaFile;
}

let seq = 0;
export async function reviewChunkCodex(cli, dir, schemaFile, systemText, chunk, signal) {
  const outFile = path.join(dir, `codex-out-${process.pid}-${++seq}.json`);
  const input = `${systemText}\n\nAnswer only with the JSON object the output schema describes. Do not run any commands.\n\n${chunk.prompt}`;
  let r;
  try { r = await run(cli, [...QUIET, '-C', dir, '--output-schema', schemaFile, '-o', outFile, '-'], { cwd: dir, input, signal }); } catch (e) {
    return { ok: false, error: { code: 'cli', message: `Could not start Codex: ${e.message}` } };
  }
  const halt = stopped(r, 'Codex');
  if (halt) return halt;
  let text = '';
  try { text = await fs.readFile(outFile, 'utf8'); } catch { /* none */ }
  fs.rm(outFile, { force: true }).catch(() => {});
  let parsed = null;
  try { parsed = JSON.parse(text.trim()); } catch { /* not JSON */ }
  if (!parsed || !Array.isArray(parsed.findings)) {
    const t = lastLines(r);
    if (LIMIT.test(t)) return { ok: false, error: { code: 'rate_limit', message: 'Claude and Codex have both reached their usage limits. Try the failed sections again later.' } };
    return { ok: false, error: { code: text ? 'bad_output' : 'cli', message: text ? 'The Codex response had no findings list.' : 'Codex: ' + t } };
  }
  return { ok: true, findings: parsed.findings, usage: { input: 0, output: 0 }, via: 'codex' };
}

/** A short answer in plain words (the guidelines' direction). { ok, text } | { ok: false, error }. */
export async function askCodex(cli, { system, prompt }, signal) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-codex-ask-'));
  try {
    const outFile = path.join(dir, 'answer.txt');
    const r = await run(cli, [...QUIET, '-C', dir, '-o', outFile, '-'], { cwd: dir, input: `${system}\n\nDo not run any commands.\n\n${prompt}`, signal, timeoutMs: 90000 });
    const halt = stopped(r, 'Codex');
    if (halt) return halt;
    const text = await fs.readFile(outFile, 'utf8').catch(() => '');
    if (text.trim()) return { ok: true, text };
    const t = lastLines(r);
    return { ok: false, error: { code: LIMIT.test(t) ? 'rate_limit' : 'cli', message: 'Codex: ' + t } };
  } catch (e) {
    return { ok: false, error: { code: 'cli', message: `Could not start Codex: ${e.message}` } };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
