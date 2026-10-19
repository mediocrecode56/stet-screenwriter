// Claude API access for the English revision tool. Runs only in the main
// process: the API key is stored encrypted with the OS keychain/DPAPI
// (Electron safeStorage) and never crosses into the renderer or a .stet file.

import Anthropic from '@anthropic-ai/sdk';
import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './files.js';
import { MODEL, SYSTEM_PROMPT, FINDINGS_SCHEMA } from '../core/revision.js';

const CONCURRENCY = 3;

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

  async keyStatus() {
    const saved = await this.savedKey();
    return {
      source: saved ? 'saved' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none',
      hint: saved ? saved.slice(0, 10) + '…' + saved.slice(-4) : null,
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
    let client;
    try { client = await this.client(); } catch (e) {
      this.send('review:done', { reviewId, error: describeError(e) });
      this.runs.delete(reviewId);
      return;
    }
    const system = [{ type: 'text', text: extra ? `${SYSTEM_PROMPT}\n\n${extra}` : SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
    const queue = [...chunks];
    const worker = async () => {
      while (queue.length && !ac.signal.aborted) {
        const chunk = queue.shift();
        this.send('review:chunk', { reviewId, index: chunk.index, ...(await this.reviewChunk(client, system, chunk, ac.signal)) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
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
  if (e instanceof Anthropic.AuthenticationError) return { code: 'auth', message: 'The API key was rejected. Check it in Preferences.' };
  if (e instanceof Anthropic.PermissionDeniedError) return { code: 'auth', message: 'This API key is not allowed to use ' + MODEL + '.' };
  if (e instanceof Anthropic.RateLimitError) return { code: 'rate_limit', message: 'Rate limited by the API, even after retrying. Try the failed sections again in a minute.' };
  if (e instanceof Anthropic.BadRequestError) return { code: 'bad_request', message: e.message };
  if (e instanceof Anthropic.APIConnectionError) return { code: 'network', message: 'Could not reach the Claude API. Check the connection.' };
  if (e instanceof Anthropic.APIError) return { code: 'api', message: `Claude API error ${e.status ?? ''}: ${e.message}` };
  if (/api.?key|credential|authentication/i.test(e?.message || '')) return { code: 'no_key', message: 'No Claude API key is set. Add one in Preferences.' };
  return { code: 'unknown', message: e?.message || String(e) };
}
