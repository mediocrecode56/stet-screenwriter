// What the build leaves out of the packaged app (scripts/package-tools.js), and the patch it writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pruneModules, trimLocales, writePatch } from '../scripts/package-tools.js';
import { zipEntries } from '../src/main/zip.js';

function tree(root, files) {
  for (const [f, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), data);
  }
}
const all = (root) => fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(root, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/')).sort();

test('node_modules keeps what runs, and loses type declarations, source maps, sources and docs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-prune-'));
  tree(root, {
    'src/main/main.js': 'app', 'src/types.d.ts': 'the app itself is never pruned',
    'node_modules/@scope/sdk/index.mjs': 'x', 'node_modules/@scope/sdk/index.d.mts': 'x', 'node_modules/@scope/sdk/index.mjs.map': 'x',
    'node_modules/@scope/sdk/src/index.ts': 'x', 'node_modules/@scope/sdk/README.md': 'x', 'node_modules/@scope/sdk/package.json': '{}',
    'node_modules/plain/lib/a.js': 'x', 'node_modules/plain/docs/guide.html': 'x', 'node_modules/plain/package.json': '{}',
    'node_modules/plain/node_modules/src/package.json': '{}', 'node_modules/plain/node_modules/src/index.js': 'a package named src stays',
  });
  assert.ok(pruneModules(root) > 0);
  assert.deepEqual(all(root), [
    'node_modules/@scope/sdk/index.mjs', 'node_modules/@scope/sdk/package.json',
    'node_modules/plain/lib/a.js', 'node_modules/plain/node_modules/src/index.js', 'node_modules/plain/node_modules/src/package.json', 'node_modules/plain/package.json',
    'src/main/main.js', 'src/types.d.ts',
  ]);
});

test('only the English Chromium strings are kept; the patch is the app folder, zipped', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-locales-'));
  tree(root, { 'locales/en-US.pak': 'en', 'locales/en-GB.pak': 'gb', 'locales/de.pak': 'de', 'locales/ja.pak': 'ja', 'STET.exe': 'MZ' });
  assert.equal(trimLocales(root), 4);
  assert.deepEqual(all(root), ['STET.exe', 'locales/en-GB.pak', 'locales/en-US.pak']);
  const out = path.join(root, '..', path.basename(root) + '-patch.zip');
  await writePatch(path.join(root, 'locales'), out);
  assert.deepEqual(zipEntries(fs.readFileSync(out)).map((e) => [e.name, e.read().toString()]), [['en-GB.pak', 'gb'], ['en-US.pak', 'en']]);
});
