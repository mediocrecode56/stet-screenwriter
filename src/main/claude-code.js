// The Claude Code CLI for the English revision: finding it, checking its sign-in and
// reviewing one chunk with it. No Electron here (unit-tested on its own); claude.js
// decides when it is used.
//
// Reviews through Claude Code (no API key) run the CLI in print mode on
// the user's existing Claude sign-in. Tools, MCP servers, settings files, skills and session
// history are all switched off, and it runs in an empty temporary folder: it only reads the
// prompt on stdin and answers in the findings schema.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MODEL, FINDINGS_SCHEMA } from '../core/revision.js';

export const NO_CLI = 'Claude Code was not found on this computer. Install the Claude desktop app (or Claude Code) and sign in, then try again.';
const SIGNED_OUT = 'Claude Code is not signed in. Open Claude (or run `claude` in a terminal), sign in, then try again.';

async function exists(p) { try { return (await fs.stat(p)).isFile(); } catch { return false; } }
const verKey = (v) => v.split('.').map((n) => String(parseInt(n, 10) || 0).padStart(6, '0')).join('.');

/** Every claude(.exe) under a `claude-code/<version>/<build>/` folder (desktop app installs). */
async function bundled(root, exe) {
  let versions;
  try { versions = (await fs.readdir(root)).filter((v) => /^\d+\.\d+\.\d+/.test(v)); } catch { return []; }
  const out = [];
  for (const v of versions) {
    let builds = [];
    try { builds = await fs.readdir(path.join(root, v)); } catch { /* skip */ }
    for (const b of builds) { const p = path.join(root, v, b, exe); if (await exists(p)) out.push({ path: p, label: `Claude Code ${v} (from the Claude app)`, v }); }
  }
  return out;
}
/** Sub-folders of `dir` whose names match `re` (a missing folder has none). */
async function subdirs(dir, re) {
  try { return (await fs.readdir(dir)).filter((d) => re.test(d)).map((d) => path.join(dir, d)); } catch { return []; }
}

/** Locate the Claude Code CLI. Returns { path, label, node? } or null. */
export async function findClaudeCode() {
  const forced = process.env.STET_CLAUDE_CODE; // tests: a fake CLI script, or "none"
  if (forced) return forced === 'none' ? null : { path: forced, label: 'Claude Code (test)', node: /\.m?js$/.test(forced) };
  const win = process.platform === 'win32';
  const exe = win ? 'claude.exe' : 'claude';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && await exists(path.join(dir, exe))) return { path: path.join(dir, exe), label: 'Claude Code' };
  }
  const home = os.homedir();
  for (const p of [path.join(home, '.local', 'bin', exe), path.join(home, '.claude', 'local', exe)]) if (await exists(p)) return { path: p, label: 'Claude Code' };
  // The Claude desktop app keeps its own copy of Claude Code, in a folder that has moved between
  // versions: every known place is searched, and the newest copy wins.
  const roots = [];
  if (win) {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    // Current desktop app: %LOCALAPPDATA%\Claude-Data\<install>\claude-code.
    for (const d of await subdirs(path.join(local, 'Claude-Data'), /./)) roots.push(path.join(d, 'claude-code'));
    // Earlier versions: %APPDATA%\Claude\claude-code, which an MSIX install keeps under
    // Packages\Claude_*\LocalCache (only processes the app started see it at its usual path).
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'Claude', 'claude-code'));
    for (const pkg of await subdirs(path.join(local, 'Packages'), /^Claude_/i)) {
      roots.push(path.join(pkg, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
      for (const d of await subdirs(path.join(pkg, 'LocalCache', 'Local', 'Claude-Data'), /./)) roots.push(path.join(d, 'claude-code'));
    }
  } else if (process.platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    roots.push(path.join(support, 'Claude', 'claude-code'));
    for (const d of await subdirs(path.join(support, 'Claude-Data'), /./)) roots.push(path.join(d, 'claude-code'));
  }
  const found = (await Promise.all(roots.map((r) => bundled(r, exe)))).flat();
  found.sort((a, b) => verKey(b.v).localeCompare(verKey(a.v)));
  return found.length ? { path: found[0].path, label: found[0].label } : null;
}

/**
 * Is Claude Code signed in? `claude auth status` answers in a fraction of a second without
 * using the model; only `loggedIn` is read from it. A CLI too old for it gets the benefit of
 * the doubt (the review itself then reports a sign-in problem).
 */
export async function signedIn(cli) {
  if (!cli) return { ok: false, code: 'cli', message: NO_CLI };
  let r;
  try { r = await runCli(cli, ['auth', 'status'], { cwd: os.tmpdir(), timeoutMs: 20000 }); } catch (e) { return { ok: false, code: 'cli', message: `Could not start Claude Code: ${e.message}` }; }
  let st = null;
  try { st = JSON.parse(r.out); } catch { /* an older CLI, or not JSON */ }
  if (!st || typeof st.loggedIn !== 'boolean') return { ok: true };
  return st.loggedIn ? { ok: true } : { ok: false, code: 'auth', message: SIGNED_OUT };
}

function runCli(cli, args, { cwd, input, signal, timeoutMs = 10 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // never relevant here; the CLI uses its own sign-in
    const [cmd, argv] = cli.node ? [process.execPath, [cli.path, ...args]] : [cli.path, args];
    if (cli.node) env.ELECTRON_RUN_AS_NODE = '1';
    let child;
    try { child = spawn(cmd, argv, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { reject(e); return; }
    let out = '', err = '', killedBy = null;
    const kill = (why) => { if (killedBy) return; killedBy = why; try { child.kill(); } catch { /* gone */ } };
    const onAbort = () => kill('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.on('error', (e) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, out, err, killedBy });
    });
  });
}

export async function reviewChunkCli(cli, cwd, systemFile, chunk, signal, alt = '') {
  const args = [
    '-p', '--output-format', 'json',
    '--model', MODEL, '--effort', 'high',
    '--system-prompt-file', systemFile,
    '--json-schema', JSON.stringify(FINDINGS_SCHEMA),
    '--tools', '', '--strict-mcp-config', '--setting-sources', '',
    '--disable-slash-commands', '--no-session-persistence',
  ];
  let r;
  try { r = await runCli(cli, args, { cwd, input: chunk.prompt, signal }); } catch (e) {
    return { ok: false, error: { code: 'cli', message: `Could not start Claude Code: ${e.message}` } };
  }
  if (r.killedBy === 'cancelled') return { ok: false, error: { code: 'cancelled', message: 'Cancelled.' } };
  if (r.killedBy === 'timeout') return { ok: false, error: { code: 'network', message: 'Claude Code did not answer within 10 minutes.' } };
  let res = null;
  try { res = JSON.parse(r.out.trim().split('\n').filter(Boolean).pop() || ''); } catch { /* not JSON */ }
  if (!res || res.type !== 'result') return { ok: false, error: describeCliText(r.err || r.out || `Claude Code exited with code ${r.code}.`, null, alt) };
  if (res.is_error || res.subtype !== 'success') return { ok: false, error: describeCliText(String(res.result || res.subtype || 'Claude Code reported an error.'), res.api_error_status, alt) };
  const parsed = res.structured_output ?? (() => { try { return JSON.parse(res.result); } catch { return null; } })();
  if (!parsed || !Array.isArray(parsed.findings)) return { ok: false, error: { code: 'bad_output', message: 'The response had no findings list.' } };
  const u = res.usage || {};
  return { ok: true, findings: parsed.findings, usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 } };
}

function describeCliText(text, status, alt = '') {
  const t = String(text).trim().slice(0, 400);
  if (/not logged in|\/login|please log in|sign in|authenticat|oauth|credential/i.test(t) || status === 401) return { code: 'auth', message: SIGNED_OUT + alt };
  if (/usage limit|rate.?limit|limit reached|overloaded/i.test(t) || status === 429 || status === 529) return { code: 'rate_limit', message: 'Claude usage limit reached for now. Try the failed sections again later. (' + t + ')' + alt };
  return { code: 'cli', message: 'Claude Code: ' + t };
}
