// What keeps STET small (docs/PERFORMANCE.md, "Memory"): a spelling dictionary held once per flag
// combination, suggestions that don't fill the cache, per-paragraph caches that forget the versions
// only undo remembers, and settings and statistics never written twice when nothing changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Speller } from '../../src/core/spell.js';
import { BlockMemo } from '../../src/core/blockmemo.js';
import { makeBlock } from '../../src/core/model.js';
import { JsonStore } from '../../src/main/store.js';
import { StatsStore } from '../../src/main/statsstore.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hunspell');
const read = (f) => fs.readFile(path.join(DIR, f), 'utf8');

test('a dictionary holds one set of flags per combination, shared by every word that has it', async () => {
  const aff = 'SET UTF-8\nSFX S Y 1\nSFX S 0 s .\nSFX D Y 1\nSFX D 0 ed .\n';
  const words = Array.from({ length: 3000 }, (_, i) => 'w' + i.toString(36) + (i % 2 ? '/SD' : '/S'));
  const sp = new Speller(aff, words.length + '\n' + words.join('\n') + '\nwalk/S\nwalk/D\n');
  const sets = new Set([...sp.words.values()]);
  assert.equal(sets.size, 2, 'two combinations, two sets (a word listed twice joins the one it ends up with)');
  assert.ok(sp.has('w1s') && sp.has('w1ed') && sp.has('w2s') && !sp.has('w2ed'), 'each word keeps its own flags');
  assert.ok(sp.has('walks') && sp.has('walked'), 'a word listed twice has both lines\u2019 flags');
});

test('suggesting fixes tries hundreds of made-up words without keeping them', async () => {
  const sp = new Speller(await read('en_US.aff'), await read('en_US.dic'));
  sp.check('wlak'); sp.check('recieve'); sp.check('walk');
  assert.ok(sp.cache.size <= 3, `only the words asked about are remembered (${sp.cache.size})`);
  assert.deepEqual(sp.check('teh'), { fixes: ['the'], auto: 'the' }, 'and the fixes are the same as ever');
});

test('a per-paragraph cache forgets the paragraphs the screenplay no longer holds', () => {
  let made = 0;
  const memo = new BlockMemo((b) => { made++; return b.text.split(' '); });
  let blocks = [makeBlock('action', 'one two'), makeBlock('action', 'three')];
  const first = memo.get(blocks[0]);
  assert.equal(memo.get(blocks[0]), first, 'worked out once per paragraph');
  assert.equal(made, 1);
  for (let i = 0; i < 500; i++) { // typing: each edit replaces the paragraph, undo keeps every version
    blocks = [makeBlock('action', 'one two' + i), blocks[1]];
    for (const b of blocks) memo.get(b);
    memo.keep(blocks);
  }
  assert.ok(memo.size <= blocks.length * 2 + 64, `bounded by the screenplay (${memo.size})`);
  memo.keep([]); // (a pass that finds it already small enough does nothing)
  const kept = memo.size;
  memo.keep(blocks);
  assert.equal(memo.size, kept);
  assert.equal(memo.get(blocks[1]), memo.get(blocks[1]), 'what the screenplay still holds is kept');
});

test('settings and statistics are written only when they changed (quitting flushes twice; the second is cut short)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-mem-'));
  try {
    const store = new JsonStore(path.join(dir, 'settings.json'), { a: 1 });
    store.set({ a: 2 });
    await store.flush();
    const st = await fs.stat(path.join(dir, 'settings.json'));
    await new Promise((r) => setTimeout(r, 30));
    const again = store.flush(); // as before-quit does, with nothing new
    assert.deepEqual(await fs.readdir(dir), ['settings.json'], 'no temporary file started');
    await again;
    assert.equal((await fs.stat(path.join(dir, 'settings.json'))).mtimeMs, st.mtimeMs, 'not written again');
    store.set({ a: 3 });
    await store.flush();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8')).a, 3, 'a change is written');

    const stats = new StatsStore(dir);
    await stats.flush();
    const t = (await fs.stat(path.join(dir, 'stats.json'))).mtimeMs;
    await new Promise((r) => setTimeout(r, 30));
    await stats.flush();
    assert.equal((await fs.stat(path.join(dir, 'stats.json'))).mtimeMs, t, 'statistics not written again either');
    assert.ok(!(await fs.readdir(dir)).some((n) => n.endsWith('.tmp')), 'no temporary files left');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
