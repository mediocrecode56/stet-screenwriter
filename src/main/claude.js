// Claude access for the English revision tool. Runs only in the main
// process: the API key is stored encrypted with the OS keychain/DPAPI
// (Electron safeStorage) and never crosses into the renderer or a .stet file.
//
// Two ways to reach Claude, chosen under Tools → Claude Connection… (stored in
// claude-connection.json, never in a script):
//   'auto'  an API key if one is set (saved, else ANTHROPIC_API_KEY), otherwise
//           Claude Code on the user's own Claude sign-in (the default)
//   'cli'   always Claude Code, never a key
//   'api'   always an API key, never Claude Code
// A review never switches between them by itself: when the chosen way fails,
// the error says what to do, and mentions the other way when it is set up.

import Anthropic from '@anthropic-ai/sdk';
import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from './files.js';
import { findClaudeCode, signedIn, reviewChunkCli, NO_CLI } from './claude-code.js';
import { MODEL, SYSTEM_PROMPT, FINDINGS_SCHEMA } from '../core/revision.js';

const CONCURRENCY = 3;
const NO_KEY = 'Claude is not set up. Install Claude (the desktop app or Claude Code) and sign in, or add an Anthropic API key under Tools → Claude Connection….';
const NO_API_KEY = 'No Anthropic API key is set up. Add one under Tools → Claude Connection….';
const USE_KEY = ' Or choose the API key under Tools → Claude Connection….';
const PROVIDERS = ['auto', 'cli', 'api'];

export class ClaudeService {
  constructor(userData, send) {
    this.keyFile = path.join(userData, 'claude-key.bin');
    this.prefFile = path.join(userData, 'claude-connection.json');
    this.send = send; // (channel, payload) -> renderer
    this.runs = new Map(); // reviewId -> AbortController
  }

  async savedKey() {
    try {
      const buf = await fs.readFile(this.keyFile);
      return safeStorage.decryptString(buf);
    } catch { return null; }
  }

  async provider() {
    try { const p = JSON.parse(await fs.readFile(this.prefFile, 'utf8')).provider; return PROVIDERS.includes(p) ? p : 'auto'; } catch { return 'auto'; }
  }

  async setProvider(p) {
    if (!PROVIDERS.includes(p)) return { ok: false, error: 'Unknown connection.' };
    await atomicWrite(this.prefFile, JSON.stringify({ provider: p }), { verify: null });
    return { ok: true };
  }

  /**
   * Which way a review will reach Claude (`source`: 'saved' key, 'env' key,
   * 'claude-code' or 'none') for the chosen `provider`, and what else is set up.
   */
  async keyStatus() {
    const provider = await this.provider();
    const saved = await this.savedKey();
    const key = saved ? 'saved' : process.env.ANTHROPIC_API_KEY ? 'env' : null;
    const cli = await findClaudeCode();
    const source = provider === 'cli' ? (cli ? 'claude-code' : 'none')
      : provider === 'api' ? key || 'none'
      : key || (cli ? 'claude-code' : 'none');
    return {
      provider, source,
      hint: saved ? saved.slice(0, 10) + '…' + saved.slice(-4) : null,
      key, // an API key that is set up, used or not
      cli: cli ? cli.label : null, // Claude Code that was found, used or not
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
    if ((await this.keyStatus()).source === 'claude-code') return signedIn(await findClaudeCode());
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
        // Claude Code on the user's existing sign-in, checked first (a fraction of a second), so a
        // signed-out CLI is one clear message instead of every section failing.
        const cli = await findClaudeCode();
        const alt = status.key ? USE_KEY : '';
        const auth = await signedIn(cli);
        if (!auth.ok) throw Object.assign(new Error(auth.message + (auth.code === 'auth' ? alt : '')), { code: auth.code });
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-review-'));
        const spFile = path.join(dir, 'system.txt');
        await fs.writeFile(spFile, systemText);
        cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        review = (chunk) => reviewChunkCli(cli, dir, spFile, chunk, ac.signal, alt);
      } else if (status.source === 'none') {
        const message = status.provider === 'cli' ? NO_CLI + (status.key ? USE_KEY : '')
          : status.provider === 'api' ? NO_API_KEY + (status.cli ? ' Or choose your Claude sign-in there.' : '')
          : NO_KEY;
        throw Object.assign(new Error(message), { code: 'no_key' });
      } else {
        const client = await this.client();
        const system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
        review = (chunk) => this.reviewChunk(client, system, chunk, ac.signal);
      }
    } catch (e) {
      this.send('review:done', { reviewId, error: ['no_key', 'auth', 'cli'].includes(e.code) ? { code: e.code, message: e.message } : describeError(e) });
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
