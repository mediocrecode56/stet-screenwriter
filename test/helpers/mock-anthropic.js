// Minimal local stand-in for the Anthropic Messages API, for reliability tests
// (errors, rate limits, latency, cancellation). It is never used by the app
// unless STET_ANTHROPIC_BASE_URL points at it. Findings are produced by a
// test-supplied function, so tests control exactly what "Claude" says.

import http from 'node:http';

export async function startMock(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : null;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });
    if (req.method === 'GET' && req.url.startsWith('/v1/models/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: req.url.split('/').pop(), type: 'model', display_name: 'mock' }));
      return;
    }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); res.end(); return; }
    const prompt = json.messages[0].content;
    const plan = (await handler({ prompt, body: json, attempt: requests.filter((r) => r.body && r.body.messages && r.body.messages[0].content === prompt).length })) || {};
    if (plan.delayMs) await new Promise((r) => setTimeout(r, plan.delayMs));
    if (res.destroyed || res.writableEnded) return; // client cancelled while we waited
    if (plan.status) {
      res.writeHead(plan.status, { 'content-type': 'application/json', 'retry-after-ms': '30', 'x-should-retry': plan.noRetry ? 'false' : 'true' });
      res.end(JSON.stringify({ type: 'error', error: { type: plan.status === 429 ? 'rate_limit_error' : 'api_error', message: 'mock ' + plan.status } }));
      return;
    }
    const text = plan.raw ?? JSON.stringify({ findings: plan.findings || [] });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: json.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (let i = 0; i < text.length; i += 64) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 64) } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: plan.stop || 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } });
    ev('message_stop', {});
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

/** Parse the element lines of a chunk prompt: [{id, type, text}] (reviewable only). */
export function elementsOf(prompt) {
  const review = prompt.split('<review>')[1].split('</review>')[0];
  const out = [];
  for (const line of review.split('\n')) {
    const m = /^(e\d+) \[([A-Z ]+)(?: — [^\]]+)?\] (".*")$/.exec(line);
    if (m) out.push({ id: m[1], type: m[2], text: JSON.parse(m[3]) });
  }
  return out;
}
