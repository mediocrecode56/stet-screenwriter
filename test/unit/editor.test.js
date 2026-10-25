import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, pos } from '../../src/core/editor.js';
import { makeBlock } from '../../src/core/model.js';
import { countWords } from '../../src/core/text.js';

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

test('Tab at the end of written dialogue starts a parenthetical below', () => {
  const ed = new Editor([makeBlock('character', 'MARA'), makeBlock('dialogue', 'You came.')]);
  ed.setSel(pos(1, 9));
  ed.tab();
  assert.deepEqual(types(ed), ['character', 'dialogue', 'paren']);
  assert.deepEqual(ed.caret, pos(2, 1));
  typeStr(ed, 'beat');
  ed.enter();
  assert.deepEqual(texts(ed), ['MARA', 'You came.', '(beat)', '']);
  assert.equal(ed.block.type, 'dialogue');
  ed.setSel(pos(1, 3));
  ed.tab(); // mid-text: an empty parenthetical at the caret; the dialogue around it stays dialogue
  assert.deepEqual(ed.blocks.slice(1, 4).map((b) => [b.type, b.text]), [['dialogue', 'You'], ['paren', '()'], ['dialogue', 'came.']]);
  assert.deepEqual(ed.caret, pos(2, 1));
});

test('Tab never changes text already written: only the selection, or what is typed next', () => {
  // In the middle of a paragraph: a new element at the caret, the text on both sides as it was.
  let ed = new Editor([makeBlock('action', 'She waits. He comes.'), makeBlock('action', 'Below.')]);
  ed.setSel(pos(0, 11));
  ed.tab();
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['action', 'She waits.'], ['character', ''], ['action', 'He comes.'], ['action', 'Below.']]);
  typeStr(ed, 'mara');
  assert.deepEqual(ed.blocks[1], { ...ed.blocks[1], type: 'character', text: 'MARA' });
  assert.equal(ed.blocks[2].type, 'action');
  ed.undo(); ed.undo();
  assert.deepEqual(ed.blocks.map((b) => b.text), ['She waits. He comes.', 'Below.']);

  // At the start of a paragraph: the new element comes before it.
  ed = new Editor([makeBlock('action', 'Rain.')]);
  ed.tab();
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['character', ''], ['action', 'Rain.']]);

  // Shift+Tab at the end of written text starts the previous type below, instead of converting it.
  ed = new Editor([makeBlock('dialogue', 'You came.')]);
  ed.setSel(pos(0, 9));
  ed.tab(true);
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['dialogue', 'You came.'], ['character', '']]);

  // A selection: only the selected words change; the paragraph below doesn't, even when the
  // selection ends at its very start.
  ed = new Editor([makeBlock('action', 'One two three'), makeBlock('action', 'Four')]);
  ed.setSel(pos(0, 4), pos(0, 7));
  ed.tab();
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['action', 'One'], ['character', 'TWO'], ['action', 'three'], ['action', 'Four']]);
  ed = new Editor([makeBlock('action', 'One'), makeBlock('action', 'Four')]);
  ed.setSel(pos(0, 0), pos(1, 0));
  ed.tab();
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['character', 'ONE'], ['action', 'Four']]);
  ed.setSel(pos(0, 0), pos(1, 0));
  ed.setType('scene'); // the element shortcuts follow the same rule
  assert.deepEqual(ed.blocks.map((b) => b.type), ['scene', 'action']);

  // An empty element still cycles its own type, in the toolbar's order (Dialogue, then Parenthetical).
  ed = new Editor([makeBlock('action')]);
  ed.tab(); ed.tab();
  assert.deepEqual(ed.blocks.map((b) => b.type), ['dialogue']);
  ed.tab();
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['paren', '()']]);
  ed.tab(true); ed.tab(true);
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['character', '']]);

  // The element buttons and Ctrl+number work the same way.
  ed = new Editor([makeBlock('action', 'She waits. He comes.')]);
  ed.setSel(pos(0, 11));
  ed.applyType('dialogue');
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text]), [['action', 'She waits.'], ['dialogue', ''], ['action', 'He comes.']]);
  ed.applyType('dialogue'); // empty: already that type
  ed.applyType('scene');
  assert.deepEqual(ed.blocks[1].type, 'scene');
  ed.setSel(pos(0, 4)); ed.applyType('action'); // the type it has: nothing to do
  assert.equal(ed.blocks.length, 3);
});

test('Tab steps only through the element types kept in the cycle, in their order', () => {
  const ed = new Editor([makeBlock('action')]);
  ed.tabTypes = ['scene', 'action', 'dialogue', 'shot']; // apart from each other in the toolbar
  const seen = [];
  for (let i = 0; i < 5; i++) { ed.tab(); seen.push(ed.block.type); }
  assert.deepEqual(seen, ['dialogue', 'shot', 'scene', 'action', 'dialogue']);
  ed.tab(true);
  assert.equal(ed.block.type, 'action');
  // From a type outside the cycle, Tab goes to the next one kept.
  ed.setType('character');
  ed.tab();
  assert.equal(ed.block.type, 'dialogue');
  // A cycle of one type has nowhere to go.
  ed.tabTypes = ['dialogue'];
  ed.tab();
  assert.equal(ed.block.type, 'dialogue');
});

test('alignment applies to the selected text, or to what is written next, never to other text', () => {
  // A speech of two paragraphs: aligning the second leaves the first as it was.
  let ed = new Editor([makeBlock('dialogue', 'First paragraph.\n\nSecond one.'), makeBlock('action', 'Below.')]);
  ed.setSel(pos(0, 18), pos(0, 29));
  ed.applyAlign('center');
  assert.deepEqual(ed.blocks.map((b) => [b.type, b.text, b.align]), [['dialogue', 'First paragraph.', undefined], ['dialogue', 'Second one.', 'center'], ['action', 'Below.', undefined]]);
  ed.undo();
  assert.deepEqual(ed.blocks.map((b) => b.text), ['First paragraph.\n\nSecond one.', 'Below.']);
  // The caret in written text: an empty paragraph at the caret takes the alignment.
  ed = new Editor([makeBlock('action', 'Rain hammers.'), makeBlock('action', 'Below.')]);
  ed.setSel(pos(0, 13));
  ed.applyAlign('right');
  assert.deepEqual(ed.blocks.map((b) => [b.text, b.align]), [['Rain hammers.', undefined], ['', 'right'], ['Below.', undefined]]);
  typeStr(ed, 'Thunder.');
  assert.deepEqual(ed.blocks[1], { ...ed.blocks[1], text: 'Thunder.', align: 'right' });
  // An empty paragraph takes it as it is; whole paragraphs selected change without splitting.
  ed.setSel(pos(0, 0), pos(2, 6));
  ed.applyAlign('justify');
  assert.deepEqual(ed.blocks.map((b) => b.align), ['justify', 'justify', 'justify']);
  // Asking for what the selected text already has splits nothing.
  ed = new Editor([makeBlock('action', 'One two three')]);
  ed.setSel(pos(0, 4), pos(0, 7));
  ed.applyType('action'); ed.applyAlign('left');
  assert.deepEqual(ed.blocks.map((b) => b.text), ['One two three']);
  assert.equal(ed.undoStack.length, 0);
  // A parenthetical is never cut in pieces: part of it selected changes all of it.
  ed = new Editor([makeBlock('paren', '(quietly, then not)')]);
  ed.setSel(pos(0, 1), pos(0, 8));
  ed.applyAlign('center');
  assert.deepEqual(ed.blocks.map((b) => [b.text, b.align]), [['(quietly, then not)', 'center']]);
  // A paragraph's own alignment asked for again changes nothing.
  ed = new Editor([makeBlock('transition', 'CUT TO:')]);
  ed.setSel(pos(0, 3));
  ed.applyAlign('right');
  assert.equal(ed.blocks.length, 1);
});

test('changing to and from capitals keeps the text as it was written', () => {
  const ed = new Editor([makeBlock('dialogue', 'Hello there, Mara.')]);
  ed.setType('character');
  assert.equal(ed.block.text, 'HELLO THERE, MARA.');
  ed.setSel(pos(0, ed.block.text.length));
  typeStr(ed, ' Again');
  assert.equal(ed.block.text, 'HELLO THERE, MARA. AGAIN');
  ed.setType('dialogue');
  assert.equal(ed.block.text, 'Hello there, Mara. Again');
  ed.setType('transition'); ed.setType('scene'); ed.setType('action');
  assert.equal(ed.block.text, 'Hello there, Mara. Again');
  // Edited in capitals: the change is taken from the capitals, the rest keeps its case.
  ed.setType('character');
  ed.setSel(pos(0, 0), pos(0, 5));
  typeStr(ed, 'Bye');
  ed.setType('dialogue');
  assert.equal(ed.block.text, 'Bye there, Mara. Again');
  // Undo brings back each step exactly.
  ed.undo();
  assert.equal(ed.block.text, 'BYE THERE, MARA. AGAIN');
  // A cue written in capitals stays in capitals.
  const cue = new Editor([makeBlock('character')]);
  typeStr(cue, 'MARA');
  cue.setType('action');
  assert.equal(cue.block.text, 'MARA');
});

test('alignment: left, centre, right and justify, without touching text, type or marks', () => {
  const ed = new Editor([makeBlock('action', 'Rain hammers.', [{ s: 0, e: 4, k: 'b', v: 1 }]), makeBlock('transition', 'CUT TO:')]);
  ed.setAlign('center');
  assert.equal(ed.blocks[0].align, 'center');
  assert.deepEqual(ed.blocks[0].marks, [{ s: 0, e: 4, k: 'b', v: 1 }]);
  assert.equal(ed.blocks[1].align, undefined);
  ed.setSel(pos(0, 2), pos(1, 3));
  ed.setAlign('right');
  assert.equal(ed.blocks[0].align, 'right');
  assert.equal(ed.blocks[1].align, undefined, "a transition's own alignment is stored as none");
  ed.setAlign('left');
  assert.equal(ed.blocks[0].align, undefined);
  assert.equal(ed.blocks[1].align, 'left');
  ed.undo();
  assert.equal(ed.blocks[0].align, 'right');
  // Kept through typing, a change of element, and Enter in the middle.
  ed.setSel(pos(0, 4));
  typeStr(ed, '!');
  ed.setType('dialogue');
  assert.equal(ed.blocks[0].align, 'right');
  ed.enter();
  assert.deepEqual(ed.blocks.slice(0, 2).map((b) => b.align), ['right', 'right']);
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

test('a note and the highlight on its passage are one colour: it takes it, gives it, and loses it with it', () => {
  const ed = new Editor([makeBlock('action', 'Rain on the glass.'), makeBlock('action', 'And more.')]);
  ed.setSel(pos(0, 0), pos(0, 4));
  ed.highlight('pink');
  ed.attachComment('a'); // made on highlighted text: pink
  assert.equal(ed.noteColors().get('a'), 'pink');
  ed.setSel(pos(0, 5), pos(1, 3));
  ed.attachComment('b');
  assert.equal(ed.noteColors().has('b'), false, 'none on text with none');
  ed.highlight('blue', ed.noteRange('b')); // the note given a colour: its whole passage, over both blocks
  assert.deepEqual([ed.noteColors().get('b'), ed.blocks[1].marks.find((m) => m.k === 'hl')?.v], ['blue', 'blue']);
  ed.undo();
  assert.equal(ed.noteColors().has('b'), false, 'one undoable change');
  ed.setSel(pos(0, 0), pos(0, 18));
  ed.highlight(null); // the highlight cleared: the note's colour with it
  assert.equal(ed.noteColors().has('a'), false);
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

test('countWords agrees with the independent reference on random and real-world text', async () => {
  const { referenceCount } = await import('../helpers/wordref.js');
  const alphabet = ['a', 'Z', '7', ' ', '-', "'", '\u2019', '\u2014', '\u2013', '\u2026', '.', ',', '\u00e9', '\u00f1', '\u0436', '\u65e5', '\u30c6', '\u304b', '\uD83D\uDE00', '\uD835\uDC00', '\n', '\t', '\r', '\u00a0', '\u200b', '\uD800', '\uDC00', '_', '(', '\u0663', '\u0301', '\u3000', '\u30fc'];
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < 20000; k++) {
    let s = '';
    const n = Math.floor(rnd() * 40);
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    assert.equal(countWords(s), referenceCount(s), JSON.stringify(s));
  }
});
test('Tab round the cycle and round again changes only the element: the text comes back as written, on the same line', () => {
  for (const [a, z] of [[5, 7], [0, 14]]) for (const reverse of [false, true]) {
    const ed = new Editor([makeBlock('action', 'Rain on glass.'), makeBlock('action', 'After.')]);
    ed.setSel(pos(0, a), pos(0, z));
    for (let i = 0; i < 14; i++) ed.tab(reverse); // twice round all seven
    const b = ed.blocks.find((x) => x.text.toLowerCase() === 'rain on glass.'.slice(a, z).toLowerCase());
    assert.deepEqual([b?.type, b?.text], ['action', 'Rain on glass.'.slice(a, z)], `[${a}, ${z}) ${reverse ? 'backwards' : 'forwards'}`);
  }
  const ed = new Editor([makeBlock('action', 'Rain.'), makeBlock('action', 'After.')]);
  ed.setSel(pos(0, 5));
  for (let i = 0; i < 15; i++) ed.tab();
  assert.deepEqual(ed.blocks.map((x) => [x.type, x.text]), [['action', 'Rain.'], ['character', ''], ['action', 'After.']], 'one new line, whatever the laps');
});
