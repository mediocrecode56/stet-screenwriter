// Character cues complete from the script's cast (src/core/cast.js), in the real app.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App } from './cdp.js';

let tmp, app;
const blocks = () => app.eval('__stet.editor.blocks.map(b => [b.type, b.text])');

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-e2e-'));
  app = await App.launch({ userData: path.join(tmp, 'ud') });
  await app.eval('__stet.input.focus()');
});
after(async () => {
  if (app) await app.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('a cue completes from the cast, most recently used first, and the cast is kept in the document', async () => {
  const ghost = () => app.eval("document.querySelector('.ghost').style.display === 'none' ? '' : document.querySelector('.ghost').textContent");
  await app.type('int. dock - day');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('MARA');
  await app.key('Enter');
  await app.type('Here.');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('TEO');
  await app.key('Enter');
  await app.type('There.');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('Ma');
  assert.equal(await ghost(), 'RA'); // the rest of MARA, in grey
  assert.equal(await app.eval('__stet.editor.block.text'), 'MA'); // nothing typed for you
  await app.key('Enter');
  assert.deepEqual((await blocks()).slice(-2), [['character', 'MARA'], ['dialogue', '']]);
  await app.type('Again.');
  await app.key('Enter');
  await app.key('Tab');
  await app.type('T');
  assert.equal(await ghost(), 'EO');
  await app.key('Escape'); // hides it
  assert.equal(await ghost(), '');
  await app.type('E');
  await app.key('Tab'); // Tab takes it too
  assert.equal(await app.eval('__stet.editor.block.text'), 'TEO');
  await app.key('Enter');
  assert.deepEqual(await app.eval('__stet.session.doc.cast'), ['TEO', 'MARA']);
  await app.type('Fine.');
});
