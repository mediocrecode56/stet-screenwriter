// Text keeps the case it was written in through every way it can reach a capitalised element
// (scene, character, transition, shot): changed into one, typed, pasted, joined, replaced; so
// changing it back to an element without capitals brings that case back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, pos } from '../../src/core/editor.js';
import { makeBlock } from '../../src/core/model.js';

const sel = (ed, b0, o0, b1, o1) => { ed.sel = { a: pos(b0, o0), f: pos(b1, o1) }; };
const all = (ed, b = 0) => sel(ed, b, 0, b, ed.blocks[b].text.length);
const texts = (ed) => ed.blocks.map((b) => [b.type, b.text]);

test('changing element back and forth: the case as written comes back, whatever the path', () => {
  const ed = new Editor([makeBlock('action', 'Hello there, Bob.')]);
  for (const t of ['scene', 'character', 'transition', 'shot', 'action', 'scene', 'dialogue']) { all(ed); ed.applyType(t); }
  assert.deepEqual(texts(ed), [['dialogue', 'Hello there, Bob.']]);
});

test('pasted into a capitalised element: shown in capitals, back in its own case out of it', () => {
  const ed = new Editor([makeBlock('scene', '')]);
  ed.paste([{ type: 'action', text: 'int. Kitchen - night', marks: [] }]);
  assert.deepEqual(texts(ed), [['scene', 'INT. KITCHEN - NIGHT']]);
  assert.deepEqual(ed.caret, pos(0, 20));
  all(ed); ed.applyType('action');
  assert.deepEqual(texts(ed), [['action', 'int. Kitchen - night']]);
});

test('pasted into the middle of a capitalised line: the line and the piece both keep their case', () => {
  const ed = new Editor([makeBlock('action', 'Big house')]);
  all(ed); ed.applyType('scene');
  sel(ed, 0, 4, 0, 4);
  ed.paste([{ type: 'action', text: 'old ', marks: [] }]);
  assert.deepEqual(texts(ed), [['scene', 'BIG OLD HOUSE']]);
  all(ed); ed.applyType('action');
  assert.deepEqual(texts(ed), [['action', 'Big old house']]);
});

test('copied from a capitalised line and pasted as lines of their own: they keep the case they were written in', () => {
  const src = new Editor([makeBlock('action', 'Jane Doe'), makeBlock('dialogue', 'Hi.')]);
  all(src); src.applyType('character');
  sel(src, 0, 0, 1, 3);
  const frag = src.fragment();
  assert.equal(frag[0].cased, 'Jane Doe');
  const ed = new Editor([makeBlock('action', '')]);
  ed.paste(frag);
  assert.deepEqual(texts(ed), [['character', 'JANE DOE'], ['dialogue', 'Hi.']]);
  all(ed); ed.applyType('action');
  assert.deepEqual(texts(ed)[0], ['action', 'Jane Doe']);
});

test('two lines joined into a capitalised one keep their case for a later change of element', () => {
  const ed = new Editor([makeBlock('action', 'Int. house'), makeBlock('action', ' - Day')]);
  all(ed); ed.applyType('scene');
  sel(ed, 1, 0, 1, 0); ed.backspace();
  assert.deepEqual(texts(ed), [['scene', 'INT. HOUSE - DAY']]);
  all(ed); ed.applyType('action');
  assert.deepEqual(texts(ed), [['action', 'Int. house - Day']]);
});

test('a word replaced in a capitalised line keeps its own case', () => {
  const ed = new Editor([makeBlock('action', 'Old house')]);
  all(ed); ed.applyType('scene');
  ed.replaceRanges([{ b: 0, s: 0, e: 3 }], ['Big']);
  assert.deepEqual(texts(ed), [['scene', 'BIG HOUSE']]);
  all(ed); ed.applyType('action');
  assert.deepEqual(texts(ed), [['action', 'Big house']]);
});

test('undo after a paste into capitals puts the line back exactly', () => {
  const ed = new Editor([makeBlock('action', 'Big house')]);
  all(ed); ed.applyType('scene');
  sel(ed, 0, 4, 0, 4);
  ed.paste([{ type: 'action', text: 'old ', marks: [] }]);
  ed.undo();
  all(ed); ed.applyType('action');
  assert.deepEqual(texts(ed), [['action', 'Big house']]);
});
