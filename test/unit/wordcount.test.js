// Word counting and writing credits, stress-tested at the editor level.
//
// Two separate questions, checked separately:
//  1. Is the screenplay's word count right? After every operation the running
//     count must equal a full recount AND the independent reference
//     implementation (test/helpers/wordref.js).
//  2. Is writing activity right? Credits must count the writer's own new
//     words once — not pastes, not existing text, not undo/redo replays — and
//     deleting must never erase earlier writing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, pos } from '../../src/core/editor.js';
import { makeBlock } from '../../src/core/model.js';
import { countWords, documentWords } from '../../src/core/text.js';
import { parsePlainText } from '../../src/core/plaintext.js';
import { referenceCount, referenceDocCount } from '../helpers/wordref.js';

const typeStr = (ed, s) => { for (const ch of s) { if (ch === '\n') ed.enter(); else ed.insertText(ch); } };
const action = (t) => [{ type: 'action', text: t, marks: [] }];

/** An editor wired like the app: credits drained on every change and summed. */
function harness(blocks = [makeBlock('action')]) {
  const ed = new Editor(blocks);
  let clock = Date.parse('2026-10-19T10:00:00');
  ed.now = () => clock;
  const h = { ed, written: 0, tick: (ms = 50) => { clock += ms; } };
  ed.onChange = () => { for (const c of ed.takeCredits()) h.written += c.n; };
  return h;
}
function check(ed, msg = '') {
  const full = documentWords(ed.blocks);
  assert.equal(ed.words, full, `running count = full recount ${msg}`);
  assert.equal(ed.words, referenceDocCount(ed.blocks), `count = reference implementation ${msg}`);
}

// ---- 1, 7, 15: the rule on known passages ------------------------------------------

test('known passages have the documented counts (and match the reference)', () => {
  const cases = [
    ['', 0], ['   ', 0], ['\t\n \r\n', 0], ['word', 1], ['  word  ', 1],
    ['She runs to the door.', 5], ['She  runs\tto\nthe\r\ndoor.', 5],
    ["Don't stop — it's well-known.", 4], ['wait—what', 2], ['wait--what', 1], ['a – b', 2],
    ['INT. COFFEE SHOP - NIGHT', 4], ['JOHN (V.O.)', 2], ['(beat)', 1], ['3.5 percent of 1,000', 4],
    ['...', 0], ['— — —', 0], ['😀', 0], ['hi 😀 there', 2], ['e.g. this', 2],
    ['café niño Привет мир', 4], ['日本語', 3], ['テキスト です', 6], ['한국어 단어', 2],
    ['non breaking', 2], ['zero​width', 2], ['été', 1], ['𝐀𝐁𝐂 word', 2],
    ['wait…what', 2], ['one/two', 1], ["rock 'n' roll", 3],
  ];
  for (const [text, n] of cases) {
    assert.equal(countWords(text), n, JSON.stringify(text));
    assert.equal(referenceCount(text), n, 'reference: ' + JSON.stringify(text));
  }
});

test('a multi-paragraph screenplay with blank lines, tabs and mixed line endings', () => {
  const src = 'INT. KITCHEN - DAY\r\n\r\nMara\tstirs  the pot.\n\nMARA\nIt\'s burning!\r\n\n\n(beat)\nAgain.\r\rEXT. YARD - NIGHT\n';
  const blocks = parsePlainText(src);
  const ed = new Editor(blocks);
  check(ed);
  assert.equal(ed.words, 3 + 4 + 1 + 2 + 1 + 1 + 3);
});

test('empty and one-word documents', () => {
  const { ed, written } = harness();
  assert.equal(ed.words, 0);
  assert.equal(written, 0);
  typeStr(ed, 'Hello');
  assert.equal(ed.words, 1);
  check(ed);
});

// ---- 2: typing ----------------------------------------------------------------------

test('typing word by word counts each new word once, immediately', () => {
  const h = harness();
  const words = 'The quick brown fox jumps over the lazy dog'.split(' ');
  words.forEach((w, i) => {
    typeStr(h.ed, (i ? ' ' : '') + w);
    assert.equal(h.ed.words, i + 1);
    assert.equal(h.written, i + 1);
  });
  check(h.ed);
});

test('rapid typing (one long burst, merged undo groups) is fully counted', () => {
  const h = harness();
  const text = Array.from({ length: 500 }, (_, i) => 'w' + i).join(' ');
  typeStr(h.ed, text);
  assert.equal(h.ed.words, 500);
  assert.equal(h.written, 500);
  check(h.ed);
});

test('typo fixes are not counted twice', () => {
  const h = harness();
  typeStr(h.ed, 'the cta');
  h.ed.backspace(); h.ed.backspace(); h.ed.backspace();
  typeStr(h.ed, 'cat sat');
  assert.equal(h.ed.words, 3);
  assert.equal(h.written, 3);
  // Delete a whole word just written and write another: one word, not two.
  h.ed.backspace(true);
  typeStr(h.ed, 'ran');
  assert.equal(h.ed.words, 3);
  assert.equal(h.written, 3);
  check(h.ed);
});

// ---- 3, 4: pasting, replacing, deleting ------------------------------------------------

test('pasting small, large and very large blocks is counted in the total but is not writing', () => {
  const h = harness();
  typeStr(h.ed, 'one two ');
  h.ed.paste(action('three four five'));
  assert.equal(h.ed.words, 5);
  assert.equal(h.written, 2);
  const big = Array.from({ length: 5000 }, (_, i) => (i % 50 === 49 ? 'end.' : 'w' + i)).join(' ');
  h.ed.paste(parsePlainText(big.replace(/end\. /g, 'end.\n\n')));
  check(h.ed, 'after a large paste');
  const huge = Array.from({ length: 200000 }, (_, i) => 'x' + (i % 997)).join(' ');
  const t0 = performance.now();
  h.ed.paste(action(huge));
  const ms = performance.now() - t0;
  check(h.ed, 'after a 200,000-word paste');
  assert.ok(h.ed.words > 205000);
  assert.ok(ms < 1500, `200k-word paste took ${ms.toFixed(0)} ms`);
  assert.equal(h.written, 2, 'no paste counted as writing');
  typeStr(h.ed, ' six');
  assert.equal(h.written, 3, 'typing after pastes keeps counting');
});

test('repeated pastes, replacements and deletions of large selections keep the count exact', () => {
  const h = harness();
  const chunk = Array.from({ length: 800 }, (_, i) => 'p' + i).join(' ');
  for (let r = 0; r < 25; r++) {
    h.ed.paste(action(' ' + chunk + ' '));
    check(h.ed, `paste ${r}`);
    // Select a large span and replace it.
    const b = h.ed.caret.b;
    h.ed.setSel(pos(b, 0), pos(b, Math.floor(h.ed.blocks[b].text.length / 2)));
    if (r % 3 === 0) h.ed.paste(action('replacement words here'));
    else if (r % 3 === 1) h.ed.backspace();
    else h.ed.insertText('Z');
    check(h.ed, `replace ${r}`);
  }
  assert.ok(h.written <= 25, 'only the typed letters count');
});

test('deleting existing text never erases earlier writing; new words after it count', () => {
  const blocks = parsePlainText(Array.from({ length: 300 }, (_, i) => 'old' + i).join(' '));
  const h = harness(blocks);
  h.ed.setSel(pos(0, h.ed.blocks[0].text.length));
  typeStr(h.ed, ' brand new words');
  assert.equal(h.written, 3);
  // Edit elsewhere: delete 100 old words.
  h.ed.setSel(pos(0, 0), pos(0, h.ed.blocks[0].text.indexOf('old100')));
  h.ed.backspace();
  assert.equal(h.written, 3, 'deleting old text keeps the 3 written words');
  typeStr(h.ed, 'fresh start ');
  assert.equal(h.written, 5, 'and writing continues to count right away (the old high-water bug)');
  check(h.ed);
});

test('clearing the whole document, then writing, counts the new writing', () => {
  const h = harness(parsePlainText('Some existing screenplay text here.'));
  h.ed.selectAll();
  h.ed.backspace();
  assert.equal(h.ed.words, 0);
  typeStr(h.ed, 'A new beginning');
  assert.equal(h.ed.words, 3);
  assert.equal(h.written, 3);
  check(h.ed);
});

// ---- 5: undo and redo -----------------------------------------------------------------

test('undo/redo of typing, large pastes and full-document replacement never double-counts', () => {
  const h = harness(parsePlainText('Existing words in a script.'));
  h.ed.setSel(pos(0, h.ed.blocks[0].text.length));
  typeStr(h.ed, ' plus five more new words');
  assert.equal(h.written, 5);
  h.ed.paste(action(' ' + Array.from({ length: 3000 }, (_, i) => 'q' + i).join(' ')));
  h.ed.selectAll();
  h.ed.paste(action('Everything replaced.'));
  check(h.ed);
  let n = 0;
  while (h.ed.undo()) check(h.ed, 'undo ' + n++);
  assert.equal(h.written, 0, 'undoing the typing takes its credit back');
  while (h.ed.redo()) check(h.ed, 'redo ' + n--);
  assert.equal(h.written, 5, 'redo gives it back exactly once');
  for (let k = 0; k < 10; k++) { h.ed.undo(); h.ed.undo(); h.ed.redo(); h.ed.redo(); }
  assert.equal(h.written, 5, 'replaying history repeatedly changes nothing');
  check(h.ed);
});

// ---- 9, 13: loading ---------------------------------------------------------------------

test('opening an existing large screenplay counts nothing as written', () => {
  const h = harness();
  const script = parsePlainText(Array.from({ length: 10000 }, (_, i) => (i % 12 === 11 ? 'line.\n\n' : 'word' + i)).join(' '));
  h.ed.reset(script);
  assert.equal(h.written, 0);
  check(h.ed);
  assert.ok(h.ed.words >= 10000);
  assert.equal(h.ed.undo(), false, 'no history to replay into credits');
  h.ed.setSel(pos(h.ed.blocks.length - 1, h.ed.blocks.at(-1).text.length));
  typeStr(h.ed, ' and more');
  assert.equal(h.written, 2);
});

// ---- 14, 15: generated operation sequences ------------------------------------------------

test('random edits from three starts: the count always equals a full recount; credits always equal the undo history', () => {
  for (const start of [7, 1234, 98765]) {
  let seed = start;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const h = harness(parsePlainText('INT. ROOM - DAY\n\nA start.\n\nMARA\nHello there.'));
  const snippets = ['hello', 'big world', '—', 'don\'t', '  ', '\t', 'x', 'INT. HALL - DAY', 'é', '日本', 'well-known', '...'];
  for (let k = 0; k < 2000; k++) {
    const ed = h.ed;
    const nb = ed.blocks.length;
    const b = Math.floor(rnd() * nb);
    const len = ed.blocks[b].text.length;
    const op = rnd();
    if (op < 0.35) { ed.setSel(pos(b, Math.floor(rnd() * (len + 1)))); typeStr(ed, pick(snippets) + (rnd() < 0.5 ? ' ' : '')); }
    else if (op < 0.45) { ed.setSel(pos(b, Math.floor(rnd() * (len + 1)))); ed.enter(); }
    else if (op < 0.6) { const s = Math.floor(rnd() * (len + 1)); ed.setSel(pos(b, s), pos(Math.min(nb - 1, b + (rnd() < 0.2 ? 1 : 0)), Math.floor(rnd() * 5))); ed.backspace(); }
    else if (op < 0.68) { ed.setSel(pos(b, Math.floor(rnd() * (len + 1)))); ed.paste(rnd() < 0.5 ? action(pick(snippets) + ' ' + pick(snippets)) : parsePlainText('One.\n\nTwo three.')); }
    else if (op < 0.8) ed.undo();
    else if (op < 0.88) ed.redo();
    else if (op < 0.93) { ed.setSel(pos(b, Math.floor(rnd() * (len + 1)))); ed.deleteForward(); }
    else { const s = Math.floor(rnd() * (len + 1)); ed.setSel(pos(b, s), pos(b, Math.min(len, s + 6))); ed.insertText(pick(['a', ' ', 'Q'])); }
    h.tick(Math.floor(rnd() * 3000));
    if (k % 50 === 0 || k > 1990) check(ed, `after op ${k} (seed ${start})`);
    else assert.equal(ed.words, documentWords(ed.blocks), `after op ${k}`);
    assert.equal(h.written, ed.creditInEffect, `credits = Σ credits of the transactions in effect (op ${k})`);
  }
  }
});

// ---- 18: performance ---------------------------------------------------------------------

test('typing into a 120-page screenplay stays fast and exact', () => {
  const script = parsePlainText(Array.from({ length: 30000 }, (_, i) => (i % 15 === 14 ? 'stop.\n\n' : 'word' + i)).join(' '));
  const h = harness(script);
  const mid = Math.floor(h.ed.blocks.length / 2);
  h.ed.setSel(pos(mid, 0));
  const t0 = performance.now();
  typeStr(h.ed, Array.from({ length: 1500 }, (_, i) => 'n' + i).join(' ') + ' ');
  const per = (performance.now() - t0) / 1500 / 6;
  assert.ok(per < 1, `per keystroke ${per.toFixed(3)} ms`);
  assert.equal(h.written, 1500);
  const t1 = performance.now();
  h.ed.verifyWords();
  assert.ok(performance.now() - t1 < 60, 'a full verification recount is cheap');
  check(h.ed);
});
