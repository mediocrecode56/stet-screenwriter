// Text styles (bold, italic, underline, strikethrough): toggling, typing on in
// a style, undo, saving, and that every output prints them on the same grid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, pos } from '../src/core/editor.js';
import { makeBlock, newDocument, styleRuns, setStyle, hasStyle, marksAfterInsert } from '../src/core/model.js';
import { serialize, deserialize } from '../src/core/serialize.js';
import { buildPrintPages } from '../src/core/printmodel.js';
import { buildPdf } from '../src/core/pdf.js';
import { printHTML } from '../src/core/printhtml.js';

const styles = (b) => b.marks.filter((m) => 'bius'.includes(m.k)).map((m) => `${m.k}${m.s}-${m.e}`).sort();
function typeStr(ed, s) { for (const ch of s) ed.insertText(ch); }

test('a selection toggles on, then off, and each toggle is one undo step', () => {
  const ed = new Editor([makeBlock('action', 'She runs fast.')]);
  ed.setSel(pos(0, 4), pos(0, 8));
  assert.equal(ed.styleActive('b'), false);
  ed.toggleStyle('b');
  assert.deepEqual(styles(ed.block), ['b4-8']);
  assert.equal(ed.styleActive('b'), true);
  ed.toggleStyle('u');
  assert.deepEqual(styles(ed.block), ['b4-8', 'u4-8']);
  ed.toggleStyle('b'); // fully bold: off again
  assert.deepEqual(styles(ed.block), ['u4-8']);
  ed.undo();
  assert.deepEqual(styles(ed.block), ['b4-8', 'u4-8']);
  ed.undo(); ed.undo();
  assert.deepEqual(styles(ed.block), []);
  assert.equal(ed.block.text, 'She runs fast.', 'the text is never touched');
  // Partly bold: the toggle makes all of it bold first.
  ed.setSel(pos(0, 6), pos(0, 8)); ed.toggleStyle('b');
  ed.setSel(pos(0, 4), pos(0, 13)); ed.toggleStyle('b');
  assert.deepEqual(styles(ed.block), ['b4-13']);
  // No words are credited for styling.
  assert.equal(ed.takeCredits().length, 0);
});

test('across paragraphs, and with no selection for the text typed next', () => {
  const ed = new Editor([makeBlock('action', 'One two'), makeBlock('action', 'three four')]);
  ed.setSel(pos(0, 4), pos(1, 5));
  ed.toggleStyle('i');
  assert.deepEqual(styles(ed.blocks[0]), ['i4-7']);
  assert.deepEqual(styles(ed.blocks[1]), ['i0-5']);

  const ty = new Editor([makeBlock('action', 'Hello ')]);
  ty.setSel(pos(0, 6));
  ty.toggleStyle('b');
  assert.equal(ty.styleActive('b'), true, 'the button shows it pressed');
  typeStr(ty, 'world');
  ty.toggleStyle('b');
  typeStr(ty, ' again');
  assert.equal(ty.block.text, 'Hello world again');
  assert.deepEqual(styles(ty.block), ['b6-11']);
  ty.undo();
  assert.equal(ty.block.text, 'Hello world ');
  ty.undo();
  assert.equal(ty.block.text, 'Hello ', 'styled typing still undoes word by word');
  // A toggled style is forgotten when the caret moves away without typing.
  ty.setSel(pos(0, 6)); ty.toggleStyle('s'); ty.setSel(pos(0, 0)); ty.setSel(pos(0, 6));
  typeStr(ty, 'x');
  assert.deepEqual(styles(ty.block), []);
});

test('typing at the end of a styled word carries the style on; highlights do not', () => {
  assert.deepEqual(marksAfterInsert([{ s: 0, e: 4, k: 'b', v: 1 }], 4, 2), [{ s: 0, e: 6, k: 'b', v: 1 }]);
  assert.deepEqual(marksAfterInsert([{ s: 0, e: 4, k: 'hl', v: 'blue' }], 4, 2), [{ s: 0, e: 4, k: 'hl', v: 'blue' }]);
  assert.deepEqual(marksAfterInsert([{ s: 2, e: 4, k: 'u', v: 1 }], 2, 1), [{ s: 3, e: 5, k: 'u', v: 1 }], 'typing before it does not');
  const ed = new Editor([makeBlock('action', 'Bold')]);
  ed.setSel(pos(0, 0), pos(0, 4)); ed.toggleStyle('b');
  ed.setSel(pos(0, 4));
  assert.equal(ed.styleActive('b'), true);
  typeStr(ed, 'er');
  assert.deepEqual(styles(ed.block), ['b0-6']);
  // Scene headings are uppercased; the style follows the typed text.
  const sc = new Editor([makeBlock('scene', '')]);
  sc.toggleStyle('u');
  typeStr(sc, 'int. house');
  assert.equal(sc.block.text, 'INT. HOUSE');
  assert.deepEqual(styles(sc.block), ['u0-10']);
  // A replaced word keeps its styles.
  const rp = new Editor([makeBlock('action', 'a big dog')]);
  rp.setSel(pos(0, 2), pos(0, 5)); rp.toggleStyle('i');
  rp.replaceRanges([{ b: 0, s: 2, e: 5 }], ['huge']);
  assert.equal(rp.block.text, 'a huge dog');
  assert.deepEqual(styles(rp.block), ['i2-6']);
});

test('style helpers: runs, coverage, overlap', () => {
  let m = setStyle([], 0, 5, 'b', true);
  m = setStyle(m, 3, 8, 'i', true);
  m = setStyle(m, 4, 6, 'b', true);
  assert.deepEqual(m.filter((x) => x.k === 'b'), [{ s: 0, e: 6, k: 'b', v: 1 }], 'merged');
  assert.deepEqual(styleRuns(m, 0, 10), [{ s: 0, e: 3, st: 'b' }, { s: 3, e: 6, st: 'bi' }, { s: 6, e: 8, st: 'i' }, { s: 8, e: 10, st: '' }]);
  assert.deepEqual(styleRuns([{ s: 0, e: 4, k: 'hl', v: 'blue' }], 0, 4), [{ s: 0, e: 4, st: '' }], 'highlights are not styles');
  assert.equal(hasStyle(m, 1, 6, 'b'), true);
  assert.equal(hasStyle(m, 1, 7, 'b'), false);
  assert.equal(hasStyle(m, 3, 8, 'i'), true);
});

test('styles are saved, reopened and printed in the PDF, print and preview', () => {
  const doc = newDocument();
  doc.blocks = [makeBlock('action', 'Plain BOLD slanted under struck', [
    { s: 6, e: 10, k: 'b', v: 1 }, { s: 11, e: 18, k: 'i', v: 1 }, { s: 19, e: 24, k: 'u', v: 1 }, { s: 25, e: 31, k: 's', v: 1 }, { s: 6, e: 10, k: 'hl', v: 'blue' },
  ])];
  const back = deserialize(serialize(doc)).doc;
  assert.deepEqual(back.blocks[0].marks, doc.blocks[0].marks);

  const { pages } = buildPrintPages(back, { titlePage: false });
  const runs = pages[0].lines.filter((l) => l.row > 3);
  assert.deepEqual(runs.map((l) => [l.text, l.st || '']), [['Plain ', ''], ['BOLD', 'b'], [' ', ''], ['slanted', 'i'], [' ', ''], ['under', 'u'], [' ', ''], ['struck', 's']]);
  for (let i = 1; i < runs.length; i++) assert.equal(runs[i].col, runs[i - 1].col + runs[i - 1].text.length, 'one character grid');
  assert.equal(pages[0].rects.length, 0, 'highlights still print only when asked');

  const pdf = Buffer.from(buildPdf(pages)).toString('latin1');
  for (const f of ['/Courier ', '/Courier-Bold ', '/Courier-Oblique ']) assert.ok(pdf.includes('/BaseFont ' + f.trim()), f);
  assert.match(pdf, /\/F2 12 Tf\n[\d.-]+ [\d.-]+ Td \(BOLD\) Tj/);
  assert.match(pdf, /\/F3 12 Tf\n[\d.-]+ [\d.-]+ Td \(slanted\) Tj/);
  assert.equal((pdf.match(/ m [\d.]+ [\d.]+ l S/g) || []).length, 2, 'an underline and a strike line');

  const html = printHTML(pages);
  assert.ok(html.includes('class="sb"') && html.includes('class="si"') && html.includes('class="su"') && html.includes('class="ss"'));
});
