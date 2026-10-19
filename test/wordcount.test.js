// Word counting and TODAY progress across typing, pasting, deleting, replacing,
// undo/redo, document switches and reopening. Regression tests for the bug where
// pasting (then undoing, or pasting over a selection) froze TODAY progress: the
// paste allowance was the pasted text's own word count and was never given back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, pos } from '../src/core/editor.js';
import { makeBlock } from '../src/core/model.js';
import { countWords } from '../src/core/text.js';
import { Tracker } from '../src/core/stats.js';
import { parsePlainText } from '../src/core/plaintext.js';

const DAY = '2026-10-19';
const typeStr = (ed, s) => { for (const ch of s) ed.insertText(ch); };
const recount = (ed) => ed.blocks.reduce((n, b) => n + countWords(b.text), 0);

/** Mirrors the app's wiring: every change is recorded immediately. */
function harness(blocks = [makeBlock('action')], tr = new Tracker({ days: {} }, () => new Date(DAY + 'T10:00:00')), id = 'doc') {
  const ed = new Editor(blocks);
  tr.begin(id, ed.words);
  ed.onChange = () => { const s = ed.wordShift; ed.wordShift = 0; tr.update(id, ed.words, s); };
  return { ed, tr, today: () => tr.wordsOn(DAY) };
}

test('typing counts; the editor total always matches a full recount', () => {
  const { ed, today } = harness();
  typeStr(ed, 'She runs  to the\tdoor.');
  assert.equal(ed.words, 5);
  assert.equal(ed.words, recount(ed));
  assert.equal(today(), 5);
});

test('pasted text is counted in the total immediately but is not writing', () => {
  const { ed, today } = harness();
  typeStr(ed, 'one two ');
  ed.paste([{ type: 'action', text: 'three four five', marks: [] }]);
  assert.equal(ed.words, 5);
  assert.equal(today(), 2);
  typeStr(ed, ' six');
  assert.equal(today(), 3, 'typing after a paste keeps counting');
});

test('undoing a paste does not freeze progress (the reported bug)', () => {
  const { ed, today } = harness();
  typeStr(ed, 'alpha ');
  const big = Array.from({ length: 3000 }, (_, i) => 'w' + i).join(' ');
  ed.paste([{ type: 'action', text: big, marks: [] }]);
  assert.equal(ed.words, 3001);
  ed.undo();
  assert.equal(ed.words, 1);
  typeStr(ed, 'beta gamma');
  assert.equal(today(), 3, 'each typed word counts right away');
  ed.redo?.(); // redo is gone after typing; harmless
  assert.equal(ed.words, recount(ed));
});

test('undo and redo of a paste move the allowance with it', () => {
  const { ed, today } = harness();
  typeStr(ed, 'a b c');
  ed.paste([{ type: 'action', text: ' d e f g', marks: [] }]);
  ed.undo(); ed.redo(); ed.undo(); ed.redo();
  assert.equal(ed.words, 7);
  assert.equal(today(), 3);
  typeStr(ed, ' h');
  assert.equal(today(), 4);
});

test('pasting over a selection or into the middle of a word counts the real change', () => {
  const { ed, today } = harness();
  typeStr(ed, 'one two three four five');
  ed.setSel(pos(0, 4), pos(0, 18)); // "two three four"
  ed.paste([{ type: 'action', text: 'x', marks: [] }]);
  assert.equal(ed.words, 3);
  typeStr(ed, ' new');
  assert.equal(ed.blocks[0].text, 'one x new five');
  assert.equal(today(), 6, 'progress resumes immediately');
  const h2 = harness();
  typeStr(h2.ed, 'abcdef');
  h2.ed.setSel(pos(0, 3));
  h2.ed.paste([{ type: 'action', text: 'XY Z', marks: [] }]); // abcXY Zdef: +1 word, not +2
  assert.equal(h2.ed.words, 2);
  typeStr(h2.ed, ' q');
  assert.equal(h2.today(), 2);
});

test('replace-all and its undo are not writing', () => {
  const { ed, today } = harness();
  typeStr(ed, 'cat cat cat');
  const ms = [0, 4, 8].map((s) => ({ b: 0, s, e: s + 3 }));
  ed.replaceMatches(ms, 'big dog');
  assert.equal(ed.words, 6);
  assert.equal(today(), 3);
  ed.undo();
  typeStr(ed, ' cow');
  assert.equal(today(), 4);
});

test('large structured pastes, repeated pastes and odd whitespace', () => {
  const { ed, today } = harness();
  const text = ['INT. HOUSE - DAY', '', 'Rain   hits\tthe  glass.', 'More rain.', '', 'BOB', '(quietly)', 'Hello  there.', '', '', '   ', ''].join('\r\n');
  const frag = parsePlainText(text.replace(/\r\n?/g, '\n'));
  for (let i = 0; i < 5; i++) ed.paste(frag);
  assert.equal(ed.words, recount(ed));
  assert.equal(today(), 0);
  ed.paste([{ type: 'action', text: '   \n\n\t ', marks: [] }]);
  assert.equal(ed.words, recount(ed));
  typeStr(ed, ' end');
  assert.equal(today(), 1);
});

test('deleting everything, then undo and redo', () => {
  const { ed, today } = harness();
  typeStr(ed, 'one two three');
  ed.enter(); typeStr(ed, 'four five');
  ed.selectAll();
  ed.backspace();
  assert.equal(ed.words, 0);
  assert.equal(recount(ed), 0);
  ed.undo();
  assert.equal(ed.words, 5);
  ed.redo();
  assert.equal(ed.words, 0);
  assert.equal(today(), 5, 'deleting does not take away words already written');
});

test('switching documents and reopening keep counts separate and stable', () => {
  const tr = new Tracker({ days: {} }, () => new Date(DAY + 'T10:00:00'));
  const a = harness([makeBlock('action', 'old text here')], tr, 'A');
  a.ed.setSel(pos(0, 13));
  typeStr(a.ed, ' plus two');
  const b = harness([makeBlock('action')], tr, 'B');
  typeStr(b.ed, 'x y z');
  assert.equal(tr.wordsOn(DAY), 5);
  // Reopen: stats are saved as JSON and loaded into a new tracker.
  const tr2 = new Tracker(JSON.parse(JSON.stringify(tr.data)), () => new Date(DAY + 'T11:00:00'));
  const a2 = harness([makeBlock('action', a.ed.blocks[0].text)], tr2, 'A');
  assert.equal(tr2.wordsOn(DAY), 5, 'reopening adds nothing');
  a2.ed.setSel(pos(0, a2.ed.blocks[0].text.length));
  typeStr(a2.ed, ' more');
  assert.equal(tr2.wordsOn(DAY), 6);
});

test('fuzz: incremental total equals a full recount after random edits', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const { ed } = harness();
  const bits = ['word ', 'it\'s ', '  ', '\t', 'x-y ', '—', '🙂 ', 'naïve ', '\n', '.', '  ', 'ÉTÉ '];
  for (let i = 0; i < 3000; i++) {
    const r = rnd(10);
    if (r < 5) typeStr(ed, bits[rnd(bits.length)].replace('\n', ''));
    else if (r === 5) ed.backspace();
    else if (r === 6) ed.paste([{ type: 'action', text: bits[rnd(bits.length)] + bits[rnd(bits.length)], marks: [] }]);
    else if (r === 7) ed.undo();
    else if (r === 8) ed.redo();
    else ed.enter();
    assert.equal(ed.words, recount(ed), 'step ' + i);
    assert.ok(Number.isFinite(ed.words));
  }
});
