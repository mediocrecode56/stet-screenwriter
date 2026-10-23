// Every channel the window uses must be let through by the preload bridge (src/preload.cjs):
// a channel left out there fails silently in the app (0.23.0's Help > Open .stet Files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const files = (dir) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
const list = (src, name) => new Set([...new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`).exec(src)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

test('every channel the window invokes or listens to is allowed by the preload bridge', () => {
  const pre = read('src/preload.cjs');
  const invoke = list(pre, 'INVOKE'), events = list(pre, 'EVENTS');
  const used = { invoke: new Set(), on: new Set() };
  for (const f of files('src/renderer')) {
    const src = read(f);
    for (const m of src.matchAll(/\b(?:api|stet)\.(invoke|on)\(\s*'([^']+)'/g)) used[m[1]].add(m[2]);
    for (const m of src.matchAll(/'((?:app|doc|recovery|backup|update|review|claude|stats|recent):[\w-]+)'/g)) if (!events.has(m[1])) used.invoke.add(m[1]);
  }
  assert.ok(used.invoke.size > 40);
  assert.deepEqual([...used.invoke].filter((c) => !invoke.has(c)), [], 'invoked but blocked');
  assert.deepEqual([...used.on].filter((c) => !events.has(c)), [], 'listened to but blocked');
  // and every allowed channel has a handler in the main process
  const main = files('src/main').map(read).join('\n');
  assert.deepEqual([...invoke].filter((c) => !main.includes(`'${c}'`)), [], 'allowed but not handled');
});
