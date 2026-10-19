// Claude API access for the English revision tool. Runs only in the main
// process: the API key is stored encrypted with the OS keychain/DPAPI
// (Electron safeStorage) and never crosses into the renderer or a .stet file.

import Anthropic from '@anthropic-ai/sdk';
import { safeStorage } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from './files.js';
import { MODEL, SYSTEM_PROMPT, FINDINGS_SCHEMA } from '../core/revision.js';

const CONCURRENCY = 3;
const NO_KEY = 'Claude is not set up. Install Claude (the desktop app or Claude Code) and sign in, or add an Anthropic API key under Tools → Claude Connection….';

export class ClaudeService {
  constructor(userData, send) {
    this.keyFile = path.join(userData, 'claude-key.bin');
    this.send = send; // (channel, payload) -> renderer
    this.runs = new Map(); // reviewId -> AbortController
  }

  async savedKey() {
    try {
      const buf = await fs.readFile(this.keyFile);
      return safeStorage.decryptString(buf);
    } catch { return null; }
  }

  /** Which way a review will reach Claude: a saved key, ANTHROPIC_API_KEY, or the Claude Code sign-in. */
  async keyStatus() {
    const saved = await this.savedKey();
    const cli = saved || process.env.ANTHROPIC_API_KEY ? null : await findClaudeCode();
    return {
      source: saved ? 'saved' : process.env.ANTHROPIC_API_KEY ? 'env' : cli ? 'claude-code' : 'none',
      hint: saved ? saved.slice(0, 10) + '…' + saved.slice(-4) : null,
      cli: cli ? cli.label : null,
      canStore: safeStorage.isEncryptionAvailable(),
    };
  }

  async setKey(key) {
    key = String(key || '').trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) return { ok: false, error: 'That does not look like an Anthropic API key (it starts with "sk-ant-").' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'This system cannot encrypt secrets. Set the ANTHROPIC_API_KEY environment variable instead.' };
    await atomicWrite(this.keyFile, safeStorage.encryptString(key), { verify: null });
    return { ok: true };
  }

  async clearKey() { await fs.rm(this.keyFile, { force: true }); return { ok: true }; }

  async client() {
    const apiKey = (await this.savedKey()) || undefined; // undefined -> SDK's own credential chain (env, profile)
    return new Anthropic({
      apiKey,
      baseURL: process.env.STET_ANTHROPIC_BASE_URL || undefined, // tests only
      maxRetries: 4, // 429 / 5xx / connection errors, with backoff honouring retry-after
      timeout: 10 * 60 * 1000,
    });
  }

  async testKey() {
    if ((await this.keyStatus()).source === 'claude-code') return { ok: true }; // sign-in is checked by the first review
    try {
      const c = await this.client();
      await c.models.retrieve(MODEL);
      return { ok: true };
    } catch (e) { return { ok: false, ...describeError(e) }; }
  }

  /** Review chunks concurrently; streams one 'review:chunk' event per chunk, then 'review:done'. */
  async start({ reviewId, chunks, extra }) {
    const ac = new AbortController();
    this.runs.set(reviewId, ac);
    const systemText = extra ? `${SYSTEM_PROMPT}\n\n${extra}` : SYSTEM_PROMPT;
    let review, cleanup = async () => {};
    try {
      const status = await this.keyStatus();
      if (status.source === 'claude-code') {
        // No API key: run the Claude Code CLI on the user's existing sign-in.
        const cli = await findClaudeCode();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-review-'));
        const spFile = path.join(dir, 'system.txt');
        await fs.writeFile(spFile, systemText);
        cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        review = (chunk) => reviewChunkCli(cli, dir, spFile, chunk, ac.signal);
      } else if (status.source === 'none') {
        throw Object.assign(new Error('no credentials'), { code: 'no_key' });
      } else {
        const client = await this.client();
        const system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
        review = (chunk) => this.reviewChunk(client, system, chunk, ac.signal);
      }
    } catch (e) {
      this.send('review:done', { reviewId, error: e.code === 'no_key' ? { code: 'no_key', message: NO_KEY } : describeError(e) });
      this.runs.delete(reviewId);
      return;
    }
    const queue = [...chunks];
    const worker = async () => {
      while (queue.length && !ac.signal.aborted) {
        const chunk = queue.shift();
        this.send('review:chunk', { reviewId, index: chunk.index, ...(await review(chunk)) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
    await cleanup();
    this.send('review:done', { reviewId, cancelled: ac.signal.aborted });
    this.runs.delete(reviewId);
  }

  async reviewChunk(client, system, chunk, signal) {
    if (process.env.STET_DEBUG_REVIEW) console.log('reviewChunk', chunk.index);
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: FINDINGS_SCHEMA } },
        system,
        messages: [{ role: 'user', content: chunk.prompt }],
      }, { signal });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') return { ok: false, error: { code: 'refusal', message: 'Claude declined to review this section.' } };
      if (msg.stop_reason === 'max_tokens') return { ok: false, error: { code: 'incomplete', message: 'The response was cut off before it was complete.' } };
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      let parsed;
      try { parsed = JSON.parse(text); } catch { return { ok: false, error: { code: 'bad_output', message: 'The response could not be read.' } }; }
      if (!parsed || !Array.isArray(parsed.findings)) return { ok: false, error: { code: 'bad_output', message: 'The response had no findings list.' } };
      return { ok: true, findings: parsed.findings, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
    } catch (e) {
      if (process.env.STET_DEBUG_REVIEW) console.log('chunk error', e);
      return { ok: false, error: describeError(e) };
    }
  }

  cancel(reviewId) {
    const ac = this.runs.get(reviewId);
    if (ac) ac.abort();
    return !!ac;
  }
}

function describeError(e) {
  if (e instanceof Anthropic.APIUserAbortError) return { code: 'cancelled', message: 'Cancelled.' };
  if (e instanceof Anthropic.AuthenticationError) return { code: 'auth', message: 'The API key was rejected. Check it under Tools → Claude Connection….' };
  if (e instanceof Anthropic.PermissionDeniedError) return { code: 'auth', message: 'This API key is not allowed to use ' + MODEL + '.' };
  if (e instanceof Anthropic.RateLimitError) return { code: 'rate_limit', message: 'Rate limited by the API, even after retrying. Try the failed sections again in a minute.' };
  if (e instanceof Anthropic.BadRequestError) return { code: 'bad_request', message: e.message };
  if (e instanceof Anthropic.APIConnectionError) return { code: 'network', message: 'Could not reach the Claude API. Check the connection.' };
  if (e instanceof Anthropic.APIError) return { code: 'api', message: `Claude API error ${e.status ?? ''}: ${e.message}` };
  if (/api.?key|credential|authentication/i.test(e?.message || '')) return { code: 'no_key', message: NO_KEY };
  return { code: 'unknown', message: e?.message || String(e) };
}

// ---- Claude Code CLI (no API key) ---------------------------------------------------------
// When no API key is configured, reviews run through the Claude Code CLI in print mode on
// the user's existing Claude sign-in. Tools, MCP servers, settings files, skills and session
// history are all switched off, and it runs in an empty temporary folder: it only reads the
// prompt on stdin and answers in the findings schema.

async function exists(p) { try { return (await fs.stat(p)).isFile(); } catch { return false; } }
const verKey = (v) => v.split('.').map((n) => String(parseInt(n, 10) || 0).padStart(6, '0')).join('.');

/** Newest claude.exe under a `claude-code/<version>/<build>/` folder (desktop app installs). */
async function newestBundled(root) {
  let versions;
  try { versions = (await fs.readdir(root)).filter((v) => /^\d+\.\d+\.\d+/.test(v)).sort((a, b) => verKey(b).localeCompare(verKey(a))); } catch { return null; }
  for (const v of versions) {
    let builds = [];
    try { builds = await fs.readdir(path.join(root, v)); } catch { /* skip */ }
    for (const b of builds) { const p = path.join(root, v, b, 'claude.exe'); if (await exists(p)) return { path: p, label: `Claude Code ${v} (from the Claude app)` }; }
  }
  return null;
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
  if (win) {
    // The Claude desktop app keeps its own copy of Claude Code: in a packaged (MSIX) folder
    // when installed from the Store/winget, or under %APPDATA%\Claude otherwise.
    const roots = [];
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'Claude', 'claude-code'));
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
    try { for (const d of await fs.readdir(pkgs)) if (/^Claude_/i.test(d)) roots.push(path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code')); } catch { /* none */ }
    for (const r of roots) { const found = await newestBundled(r); if (found) return found; }
  }
  return null;
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

export async function reviewChunkCli(cli, cwd, systemFile, chunk, signal) {
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
  if (!res || res.type !== 'result') return { ok: false, error: describeCliText(r.err || r.out || `Claude Code exited with code ${r.code}.`) };
  if (res.is_error || res.subtype !== 'success') return { ok: false, error: describeCliText(String(res.result || res.subtype || 'Claude Code reported an error.'), res.api_error_status) };
  const parsed = res.structured_output ?? (() => { try { return JSON.parse(res.result); } catch { return null; } })();
  if (!parsed || !Array.isArray(parsed.findings)) return { ok: false, error: { code: 'bad_output', message: 'The response had no findings list.' } };
  const u = res.usage || {};
  return { ok: true, findings: parsed.findings, usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 } };
}

function describeCliText(text, status) {
  const t = String(text).trim().slice(0, 400);
  if (/not logged in|\/login|please log in|sign in|authenticat|oauth|credential/i.test(t) || status === 401) return { code: 'auth', message: 'Claude Code is not signed in. Open Claude (or run `claude` in a terminal), sign in, then try again.' };
  if (/usage limit|rate.?limit|limit reached|overloaded/i.test(t) || status === 429 || status === 529) return { code: 'rate_limit', message: 'Claude usage limit reached for now. Try the failed sections again later. (' + t + ')' };
  return { code: 'cli', message: 'Claude Code: ' + t };
}
