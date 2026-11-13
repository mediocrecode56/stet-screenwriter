// STET stays small (docs/PERFORMANCE.md, "Memory"): no process of its own for the network, the window's
// and the main process's JavaScript well inside a budget with a feature-length script open, and the
// spelling caches holding the paragraphs of the screenplay, not every version the undo history keeps.
// `npm run mem` prints the same figures for each process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { App, scratch } from './harness.js';

let app;
before(async () => { app = await App.launch({ userData: await scratch('stet-memory'), args: ['--sample'] }); });
after(async () => { await app?.close(); });

const MB = 1024 * 1024;

test('the network runs inside the main process, and the JavaScript of both sides stays in budget', async () => {
  const m = await app.eval(`window.stet.invoke('e2e:memory')`);
  assert.ok(m && m.processes.length, 'the figures come back');
  const net = m.processes.filter((p) => /network/i.test(p.service || ''));
  assert.deepEqual(net, [], 'no network service process: ' + JSON.stringify(m.processes.map((p) => p.type + ' ' + (p.service || ''))));
  assert.ok(m.main.heapUsed < 40 * MB, `main process JavaScript ${(m.main.heapUsed / MB).toFixed(1)} MB`);
  const used = await app.eval('performance.memory.usedJSHeapSize');
  assert.ok(used < 40 * MB, `window JavaScript ${(used / MB).toFixed(1)} MB`);
});

test('typing and undoing leaves the spelling caches the size of the screenplay', async () => {
  await app.until('__stet.spelling.ready', { what: 'the dictionary loaded' });
  const b = await app.eval(`__stet.editor.blocks.findIndex((x) => x.type === 'action')`);
  await app.caret(b, 0);
  await app.type('She walsk to the windwo and looks out at the rain. '.repeat(3));
  for (let i = 0; i < 4; i++) await app.key('Mod+Z');
  await app.until(`__stet.spelling.marks.length > 0 || __stet.spelling.tokens.size > 0`, { what: 'spelling looked at the script' });
  await app.eval('__stet.spelling.paint()');
  const { size, blocks } = await app.eval(`({ size: __stet.spelling.tokens.size, blocks: __stet.editor.blocks.length })`);
  assert.ok(size <= blocks * 2 + 64, `${size} cached for ${blocks} paragraphs`);
});
