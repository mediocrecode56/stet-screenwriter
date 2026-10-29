import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../../src/core/editor.js';
import { makeBlock, newDocument } from '../../src/core/model.js';
import { serialize, deserialize } from '../../src/core/serialize.js';
import { dialogueWords, wordsPerMinute } from '../../src/core/text.js';
import { anchorsOf, timeScale } from '../../src/core/timeline.js';
import { paginate } from '../../src/core/layout.js';

test('a note deleted takes its colour (the highlight on its passage) with it; one undo brings both back', () => {
  const ed = new Editor([makeBlock('action', 'One two three.', [{ s: 0, e: 3, k: 'cm', v: 'a' }, { s: 0, e: 3, k: 'hl', v: 'pink' }, { s: 8, e: 13, k: 'cm', v: 'b' }, { s: 4, e: 7, k: 'hl', v: 'blue' }])]);
  ed.detachComment('a');
  assert.deepEqual(ed.blocks[0].marks.map((m) => m.k + (m.v || '')), ['hlblue', 'cmb'], 'its pink gone, the other highlight kept');
  ed.undo();
  assert.equal(ed.blocks[0].marks.length, 4);
  // Several at once (CLEAR ALL): one step.
  ed.detachComment(['a', 'b']);
  assert.deepEqual(ed.blocks[0].marks.map((m) => m.k + m.v), ['hlblue']);
  ed.undo();
  assert.equal(ed.blocks[0].marks.length, 4);
});

test('a pinned note keeps its place among the pinned in the file; a pin order without a pin is dropped', () => {
  const doc = newDocument();
  doc.blocks = [makeBlock('action', 'One two.', [{ s: 0, e: 3, k: 'cm', v: 'a' }, { s: 4, e: 7, k: 'cm', v: 'b' }])];
  doc.comments.a = { text: 'x', created: '', modified: '', pinned: true, pinOrder: 2 };
  doc.comments.b = { text: 'y', created: '', modified: '', pinOrder: 5 };
  const back = deserialize(serialize(doc)).doc;
  assert.equal(back.comments.a.pinOrder, 2);
  assert.ok(!('pinOrder' in back.comments.b));
});

test('words a minute count only dialogue, over the time given', () => {
  const blocks = [makeBlock('scene', 'INT. ROOM - DAY'), makeBlock('action', 'Many words of action here.'), makeBlock('character', 'BOB'), makeBlock('dialogue', 'One two three four.'), makeBlock('paren', '(quietly)'), makeBlock('dialogue', 'Five six.')];
  assert.equal(dialogueWords(blocks), 6);
  assert.equal(dialogueWords(blocks, 0, 4), 4);
  assert.equal(wordsPerMinute(6, 30), 12);
  assert.equal(wordsPerMinute(6, 0), null);
});

test('a timecode may mark the start itself at 00:00:00, at the very start or on a later first scene', () => {
  const blocks = [makeBlock('action', 'Opening.'), makeBlock('scene', 'INT. ROOM - DAY'), makeBlock('action', 'More.')];
  for (let i = 0; i < 80; i++) blocks.push(makeBlock('action', 'Line ' + i + '.'));
  const pages = paginate(blocks);
  const start = anchorsOf([{ id: blocks[0].id, line: 0, t: 0 }], blocks, pages);
  assert.equal(start.length, 1, 'at the very start');
  assert.equal(timeScale(start).at(1), 60, 'the pace unchanged: a minute a page');
  const first = anchorsOf([{ id: blocks[1].id, line: 0, t: 0 }, { id: blocks[40].id, line: 0, t: 90 }], blocks, pages);
  assert.equal(first.length, 2, 'on the first scene, and a later one still counts');
  assert.equal(anchorsOf([{ id: blocks[0].id, line: 0, t: 5 }], blocks, pages).length, 0, 'the start is never anything but 00:00:00');
  assert.equal(anchorsOf([{ id: blocks[1].id, line: 0, t: 0 }, { id: blocks[2].id, line: 0, t: 0 }], blocks, pages).length, 1, 'only the first may be 00:00:00');
});
