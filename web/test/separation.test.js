// The desktop app and the browser version stay apart: these fail the moment that stops being true.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from '../build.mjs';
import { APP_IGNORE } from '../../scripts/package-tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('nothing in the desktop app imports the browser version', () => {
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => /\.(c?js|html)$/.test(x))) {
    assert.ok(!/from\s+['"][^'"]*\/web\/|import\(\s*['"][^'"]*\/web\//.test(fs.readFileSync(f, 'utf8')), f);
  }
});

test('the browser version is left out of the packaged desktop app', () => {
  assert.ok(APP_IGNORE.some((re) => re.test('/web/src/app.js')));
  assert.ok(APP_IGNORE.some((re) => re.test('/web')));
});

// The desktop app reaches a cloud service only through its own Google Drive sync, which the writer turns
// on (src/main/drive.js, docs/DRIVE.md; nothing is sent before: test/unit/drive.test.js). Nothing else in
// it names one, and it never uses the browser version's code for it.
test('no cloud service is named anywhere in the desktop app but its opt-in Drive sync', () => {
  const sync = path.join(ROOT, 'src', 'main', 'drive.js');
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => /\.(c?js|html)$/.test(x) && x !== sync)) {
    assert.ok(!/googleapis\.com|accounts\.google\.com|apis\.google\.com|icloud\.com|cloudkit/i.test(fs.readFileSync(f, 'utf8')), f);
  }
  assert.ok(!/icloud\.com|cloudkit|web\/src/i.test(fs.readFileSync(sync, 'utf8')), 'Google Drive only, and its own code');
});

test('the browser version pulls in nothing that needs a computer of its own: no main process, no Node', () => {
  const files = graph('web/src/app.js', ROOT);
  assert.ok(files.includes('src/core/editor.js') && files.includes('src/renderer/view.js'), 'it does reuse the engine');
  assert.ok(!files.some((f) => f.startsWith('src/main/') || /^src\/renderer\/(dino|revision|spelling|perf)/.test(f)), files.join());
  for (const f of files) assert.ok(!/from\s+['"]node:/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
});

test('nothing reaches Google until the writer asks for Drive', () => {
  const app = fs.readFileSync(path.join(ROOT, 'web/src/app.js'), 'utf8');
  assert.ok(!/^import .*google\.js/m.test(app), 'google.js is loaded only on demand');
  assert.ok(!/<script[^>]+src="https?:/.test(fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8')));
});
