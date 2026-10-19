import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, pos } from '../src/core/editor.js';
import { makeBlock } from '../src/core/model.js';
import { countWords } from '../src/core/text.js';
import { suggest } from '../src/core/smart.js';

const types = (ed) => ed.blocks.map((b) => b.type);
const texts = (ed) => ed.blocks.map((b) => b.text);
function typeStr(ed, s) { for (const ch of s) ed.insertText(ch); }

test('typing into a scene heading uppercases it; Enter moves to action', () => {
  const ed = new Editor([makeBlock('scene')]);
  typeStr(ed, 'int. coffee shop - day');
  assert.equal(ed.blocks[0].text, 'INT. COFFEE SHOP - DAY');
  ed.enter();
  assert.deepEqual(types(ed), ['scene', 'action']);
});

test('action starting with "int." becomes a scene heading', () => {
  const ed = new Editor([makeBlock('action')]);
  typeStr(ed, 'ext. roof');
  assert.equal(ed.blocks[0].type, 'scene');
  assert.equal(ed.blocks[0].text, 'EXT. ROOF');
});

test('Enter/Tab element flow: character -> dialogue -> paren', () => {
  const ed = new Editor([makeBlock('action')]);
  ed.tab();
  assert.equal(ed.block.type, 'character');
  typeStr(ed, 'mara');
  assert.equal(ed.block.text, 'MARA');
  ed.enter();
  assert.equal(ed.block.type, 'dialogue');
  ed.tab();
  assert.equal(ed.block.type, 'paren');
  assert.equal(ed.block.text, '()');
  assert.equal(ed.caret.o, 1);
  typeStr(ed, 'quietly');
  ed.insertText(')'); // steps over the closing paren
  assert.equal(ed.block.text, '(quietly)');
  ed.enter();
  assert.equal(ed.block.type, 'dialogue');
  assert.deepEqual(types(ed), ['character', 'paren', 'dialogue']);
});

test('Enter on an empty element converts instead of adding', () => {
  const ed = new Editor([makeBlock('dialogue')]);
  ed.enter();
  assert.deepEqual(types(ed), ['action']);
  ed.enter();
  assert.deepEqual(types(ed), ['scene']);
});

test('Enter in the middle splits the block', () => {
  const ed = new Editor([makeBlock('action', 'Hello world')]);
  ed.setSel(pos(0, 5));
  ed.enter();
  assert.deepEqual(texts(ed), ['Hello', 'world']);
  assert.deepEqual(ed.caret, pos(1, 0));
});

test('backspace at block start merges', () => {
  const ed = new Editor([makeBlock('action', 'One'), makeBlock('action', 'Two')]);
  ed.setSel(pos(1, 0));
  ed.backspace();
  assert.deepEqual(texts(ed), ['OneTwo']);
  assert.deepEqual(ed.caret, pos(0, 3));
});

test('undo/redo restores text, types and selection', () => {
  const ed = new Editor([makeBlock('scene')]);
  typeStr(ed, 'int. house - night');
  ed.enter();
  typeStr(ed, 'She waits.');
  const snapshot = JSON.stringify(ed.blocks.map((b) => [b.type, b.text]));
  ed.setType('character');
  const after = JSON.stringify(ed.blocks.map((b) => [b.type, b.text]));
  ed.undo();
  assert.equal(JSON.stringify(ed.blocks.map((b) => [b.type, b.text])), snapshot);
  while (ed.undo());
  assert.deepEqual(texts(ed), ['']);
  while (ed.redo());
  assert.equal(JSON.stringify(ed.blocks.map((b) => [b.type, b.text])), after);
});

test('typing undo groups by word', () => {
  const ed = new Editor([makeBlock('action')]);
  typeStr(ed, 'one two three');
  ed.undo();
  assert.equal(ed.block.text, 'one two ');
  ed.undo();
  assert.equal(ed.block.text, 'one ');
});

test('multi-block delete and paste of a fragment', () => {
  const ed = new Editor([makeBlock('action', 'Alpha beta'), makeBlock('character', 'MARA'), makeBlock('dialogue', 'Hi there.')]);
  ed.setSel(pos(0, 6), pos(2, 3));
  const frag = ed.fragment();
  assert.equal(frag.length, 3);
  ed.backspace();
  assert.deepEqual(texts(ed), ['Alpha there.']);
  ed.undo();
  assert.deepEqual(texts(ed), ['Alpha beta', 'MARA', 'Hi there.']);
  ed.setSel(pos(2, 9));
  ed.paste(frag);
  assert.equal(ed.blocks.length, 5);
  assert.equal(ed.blocks[2].text, 'Hi there.beta');
  assert.equal(ed.blocks[4].text, 'Hi ');
});

test('word count is maintained incrementally', () => {
  const ed = new Editor([makeBlock('action', 'one two')]);
  assert.equal(ed.words, 2);
  ed.setSel(pos(0, 7));
  typeStr(ed, ' three four');
  assert.equal(ed.words, 4);
  ed.undo(); ed.undo();
  assert.equal(ed.words, countWords(ed.blocks.map((b) => b.text).join(' ')));
});

test('highlights survive edits and can be removed', () => {
  const ed = new Editor([makeBlock('action', 'red green blue')]);
  ed.setSel(pos(0, 4), pos(0, 9));
  ed.highlight('yellow');
  assert.deepEqual(ed.blocks[0].marks, [{ s: 4, e: 9, k: 'hl', v: 'yellow' }]);
  ed.setSel(pos(0, 0));
  typeStr(ed, 'xx');
  assert.deepEqual(ed.blocks[0].marks, [{ s: 6, e: 11, k: 'hl', v: 'yellow' }]);
  assert.equal(ed.blocks[0].text, 'xxred green blue');
  ed.setSel(pos(0, 0), pos(0, 16));
  ed.highlight(null);
  assert.deepEqual(ed.blocks[0].marks, []);
});

test('comments attach, list in order and detach', () => {
  const ed = new Editor([makeBlock('action', 'First.'), makeBlock('action', 'Second.')]);
  ed.setSel(pos(1, 0), pos(1, 6));
  ed.attachComment('c2');
  ed.setSel(pos(0, 2));
  ed.attachComment('c1'); // no selection: whole block
  assert.deepEqual(ed.commentAnchors().map((c) => c.id), ['c1', 'c2']);
  ed.detachComment('c1');
  assert.deepEqual(ed.commentAnchors().map((c) => c.id), ['c2']);
  ed.undo();
  assert.deepEqual(ed.commentAnchors().map((c) => c.id), ['c1', 'c2']);
});

test('find and replace all is one undo step', () => {
  const ed = new Editor([makeBlock('action', 'Mara looks. Mara waits.'), makeBlock('character', 'MARA')]);
  const m = ed.findAll('mara');
  assert.equal(m.length, 3);
  ed.replaceMatches(m, 'Luz');
  assert.deepEqual(texts(ed), ['Luz looks. Luz waits.', 'LUZ']);
  ed.undo();
  assert.deepEqual(texts(ed), ['Mara looks. Mara waits.', 'MARA']);
  assert.equal(ed.findAll('ara', { wholeWord: true }).length, 0);
  assert.equal(ed.findAll('Mara', { caseSensitive: true }).length, 2);
});

test('first appearance of a character name is capitalized once', () => {
  const ed = new Editor([makeBlock('character', 'MARA'), makeBlock('dialogue', 'Hi.'), makeBlock('action', '')]);
  ed.setSel(pos(2, 0));
  typeStr(ed, 'Mara enters. Mara sits. will waits.');
  assert.equal(ed.blocks[2].text, 'MARA enters. Mara sits. will waits.');
  ed.undo(); // capitalization was its own step... after later typing it is buried; check a fresh case
  const ed2 = new Editor([makeBlock('character', 'WILL'), makeBlock('action', '')]);
  ed2.setSel(pos(1, 0));
  typeStr(ed2, 'you will see ');
  assert.equal(ed2.blocks[1].text, 'you will see ', 'lowercase words are never touched');
});

test('autocomplete suggests prefixes, locations, times, names and extensions', () => {
  const blocks = [makeBlock('scene', 'INT. COFFEE SHOP - DAY'), makeBlock('scene', 'I')];
  assert.deepEqual(suggest(blocks, 1, 1).items.slice(0, 3), ['INT. ', 'INT./EXT. ', 'I/E. ']);
  blocks[1] = makeBlock('scene', 'EXT. CO');
  assert.deepEqual(suggest(blocks, 1, 7).items, ['COFFEE SHOP']);
  blocks[1] = makeBlock('scene', 'EXT. COFFEE SHOP - N');
  assert.deepEqual(suggest(blocks, 1, 20).items, ['NIGHT']);
  const c = [makeBlock('character', 'MA')];
  assert.deepEqual(suggest(c, 0, 2, ['MARA', 'TEO']).items, ['MARA']);
  c[0] = makeBlock('character', 'MARA (V');
  assert.deepEqual(suggest(c, 0, 7, []).items, ['V.O.)']);
});
