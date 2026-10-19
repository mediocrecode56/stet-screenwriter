import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap, lineText, PAGE } from '../src/core/format.js';
import { paginate, linesOf, mergeDirty, pageOf } from '../src/core/layout.js';
import { makeBlock, withText, defaultDocSettings } from '../src/core/model.js';
import { generateScript } from './fixtures.js';

const settings = defaultDocSettings();

test('wrap breaks at spaces within width', () => {
  const t = 'aaaa bbbb cccc dddd';
  const s = wrap(t, 10);
  assert.deepEqual(s, [0, 10]);
  assert.equal(lineText(t, s, 0), 'aaaa bbbb');
  assert.equal(lineText(t, s, 1), 'cccc dddd');
});

test('wrap hard-breaks long words and honours soft line breaks', () => {
  assert.deepEqual(wrap('x'.repeat(25), 10), [0, 10, 20]);
  assert.deepEqual(wrap('ab\ncd', 10), [0, 3]);
  assert.deepEqual(wrap('', 10), [0]);
});

test('every line fits its element width', () => {
  for (const b of generateScript(20)) {
    const s = linesOf(b);
    for (let i = 0; i < s.length; i++) {
      const w = { scene: 60, action: 60, character: 38, paren: 25, dialogue: 35, transition: 20, shot: 60 }[b.type];
      assert.ok(lineText(b.text, s, i).length <= w, `${b.type} line too long`);
    }
  }
});

function validate(blocks, pages) {
  // Every line of every block appears exactly once, in order, within the body.
  let bi = 0, line = 0;
  for (const p of pages) {
    let lastRow = -1;
    for (const it of p.items) {
      assert.equal(it.bi, bi, 'block order');
      assert.equal(it.l0, line, 'line order');
      assert.ok(it.y > lastRow, 'rows increase');
      assert.ok(it.y + (it.l1 - it.l0) <= PAGE.bodyRows, 'fits on page');
      lastRow = it.y + (it.l1 - it.l0) - 1;
      line = it.l1;
      if (line === linesOf(blocks[bi]).length) { bi++; line = 0; }
    }
  }
  assert.equal(bi, blocks.length, 'all blocks paginated');
}

test('pagination covers the document in order', () => {
  const blocks = generateScript(120);
  const pages = paginate(blocks, settings);
  validate(blocks, pages);
  assert.ok(pages.length > 80 && pages.length < 200, `plausible page count: ${pages.length}`);
});

test('character cues never end a page; split speeches get MORE/CONT\'D', () => {
  const blocks = generateScript(60);
  const pages = paginate(blocks, settings);
  for (const p of pages) {
    const last = p.items[p.items.length - 1];
    if (!last) continue;
    assert.notEqual(blocks[last.bi].type, 'character', 'character cue orphaned at page bottom');
    assert.notEqual(blocks[last.bi].type, 'scene', 'scene heading orphaned at page bottom');
  }
  // Force a long speech across a page break.
  const long = [makeBlock('character', 'MARA')];
  long.push(makeBlock('dialogue', 'word '.repeat(700).trim()));
  const pp = paginate(long, settings);
  assert.ok(pp.length >= 2);
  assert.ok(pp[0].more >= 0, 'MORE on first page');
  assert.equal(pp[1].cont, "MARA (CONT'D)");
});

test('incremental pagination equals full pagination', () => {
  const blocks = generateScript(80, 3);
  let pages = paginate(blocks, settings);
  const rnd = (n) => Math.floor(Math.random() * n);
  for (let k = 0; k < 300; k++) {
    let dirty = null;
    const op = rnd(3);
    const i = rnd(blocks.length);
    if (op === 0) { // edit text
      const b = blocks[i];
      blocks[i] = withText(b, b.text + ' extra words here and there'.repeat(rnd(4)));
      dirty = mergeDirty(dirty, i, 1, 1);
    } else if (op === 1 && blocks.length > 10) { // delete blocks
      const c = 1 + rnd(3);
      blocks.splice(i, c);
      dirty = mergeDirty(dirty, i, c, 0);
    } else { // insert
      blocks.splice(i, 0, makeBlock('action', 'Inserted line of action.'), makeBlock('character', 'TEO'), makeBlock('dialogue', 'Hey.'));
      dirty = mergeDirty(dirty, i, 0, 3);
    }
    pages = paginate(blocks, settings, pages, dirty);
    const full = paginate(blocks, settings);
    assert.deepEqual(strip(pages), strip(full), `mismatch after op ${k}`);
  }
});

function strip(pages) {
  return pages.map((p) => ({ s: p.startBi, l: p.startLine, i: p.items, m: p.more, c: p.cont }));
}

test('pageOf finds the page containing a block', () => {
  const blocks = generateScript(30);
  const pages = paginate(blocks, settings);
  for (let p = 0; p < pages.length; p++) {
    for (const it of pages[p].items) assert.equal(pageOf(pages, it.bi, it.l0), p);
  }
});
