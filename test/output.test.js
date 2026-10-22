import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildPrintPages, parseRange, hasTitlePage } from '../src/core/printmodel.js';
import { buildPdf, pdfString } from '../src/core/pdf.js';
import { printHTML } from '../src/core/printhtml.js';
import { paginate } from '../src/core/layout.js';
import { sampleDocument, generateScript } from '../src/dev/sample.js';
import { newDocument } from '../src/core/model.js';
import { toPlainText, parsePlainText } from '../src/core/plaintext.js';

test('page ranges', () => {
  const r = parseRange('1-3, 7, 10-', 12);
  assert.deepEqual([1, 2, 3, 4, 7, 9, 10, 12].map(r), [true, true, true, false, true, false, true, true]);
  assert.ok(parseRange('', 5)(5));
  assert.throws(() => parseRange('3-1', 5));
  assert.throws(() => parseRange('9', 5), /does not exist/);
  assert.throws(() => parseRange('a-b', 5));
});

test('title page is included only when filled and never numbered', () => {
  const doc = sampleDocument();
  const { pages } = buildPrintPages(doc, { titlePage: true });
  assert.equal(pages[0].kind, 'title');
  assert.ok(pages[0].lines.some((l) => l.text === 'THE LONG NIGHT'));
  assert.ok(!pages[0].lines.some((l) => /^\d+\.$/.test(l.text)));
  const empty = newDocument();
  empty.titlePage.credit = '';
  assert.equal(hasTitlePage(empty.titlePage), false);
  assert.equal(buildPrintPages(empty, { titlePage: true }).pages[0].kind, 'script');
});

test('page range selects script pages independently of the title page', () => {
  const doc = sampleDocument();
  doc.blocks = generateScript(20);
  const total = paginate(doc.blocks, doc.settings).length;
  const { pages } = buildPrintPages(doc, { titlePage: true, range: '2-3' });
  assert.deepEqual(pages.map((p) => p.kind + p.number), ['title0', 'script2', 'script3']);
  assert.ok(pages[1].lines.some((l) => l.text === '2.'), 'page number printed');
  const { pages: noTitle } = buildPrintPages(doc, { titlePage: false, range: `${total}` });
  assert.deepEqual(noTitle.map((p) => p.number), [total]);
});

test('highlights and notes are only exported when requested', () => {
  const doc = sampleDocument();
  const plain = buildPrintPages(doc, { titlePage: false });
  assert.equal(plain.pages.flatMap((p) => p.rects).length, 0);
  assert.ok(!plain.pages.some((p) => p.kind === 'notes'));
  const rich = buildPrintPages(doc, { titlePage: false, highlights: true, comments: true });
  assert.ok(rich.pages[0].rects.length >= 3);
  assert.ok(rich.pages[0].notes.length >= 1);
  const notes = rich.pages.find((p) => p.kind === 'notes');
  assert.ok(notes.lines.some((l) => l.text.includes('too on the nose')));
});

test('first page carries no number; later pages do, at the right margin', () => {
  const doc = newDocument();
  doc.blocks = generateScript(10);
  const { pages } = buildPrintPages(doc, { titlePage: false });
  assert.ok(!pages[0].lines.some((l) => l.row === 3));
  const n = pages[1].lines.find((l) => l.row === 3);
  assert.equal(n.text, '2.');
  assert.equal(n.col + n.text.length, 72.5, 'ending 7.25in from the left edge, as Final Draft prints it');
});

test('PDF is structurally valid: header, page count, xref offsets', () => {
  const doc = sampleDocument();
  doc.blocks = generateScript(15);
  const { pages } = buildPrintPages(doc, { titlePage: true, highlights: true });
  for (const deflate of [null, (b) => zlib.deflateSync(b)]) {
    const bytes = buildPdf(pages, { title: 'T', author: 'A', deflate });
    const s = Buffer.from(bytes).toString('latin1');
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
    assert.equal(+/\/Count (\d+)/.exec(s)[1], pages.length);
    const xrefAt = +/startxref\n(\d+)/.exec(s)[1];
    assert.ok(s.slice(xrefAt).startsWith('xref'));
    const entries = s.slice(xrefAt).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((e, i) => {
      const off = +e.slice(0, 10);
      assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`);
    });
    for (const m of s.matchAll(/<< \/Length (\d+)( \/Filter \/FlateDecode)? >>\nstream\n/g)) {
      const start = m.index + m[0].length;
      assert.equal(s.slice(start + +m[1], start + +m[1] + 10), '\nendstream');
    }
  }
});

test('PDF strings escape parens/backslashes and map cp1252', () => {
  assert.equal(pdfString('(a)\\'), '\\(a\\)\\\\');
  assert.equal(pdfString('“hi”—…'), '\x93hi\x94\x97\x85');
  assert.equal(pdfString('日本'), '??');
});

test('print HTML positions by inches, not screen pixels', () => {
  const { pages } = buildPrintPages(sampleDocument(), { titlePage: false });
  const html = printHTML(pages);
  assert.match(html, /@page \{ size: 210mm 297mm; margin: 0; \}/);
  assert.match(html, /left:1.5in;top:1in">INT. COFFEE SHOP - NIGHT/);
});

test('plain text interchange recovers element types', () => {
  const frag = sampleDocument().blocks.map((b) => ({ type: b.type, text: b.text }));
  const text = toPlainText(frag);
  const back = parsePlainText(text);
  const want = frag.map((f) => (f.type === 'shot' ? 'character' : f.type));
  // A shot line ("CLOSE ON MARA") followed by action is indistinguishable from a cue in plain text.
  assert.deepEqual(back.map((b) => b.type).filter((t, i) => want[i] !== 'character' || t === 'character'), want.filter((t, i) => want[i] !== 'character' || back[i].type === 'character'));
  assert.equal(back[0].type, 'scene');
  assert.equal(back[3].type, 'character');
  assert.equal(back[4].type, 'paren');
  assert.equal(back[5].type, 'dialogue');
  assert.equal(back[10].type, 'transition');
});

test('aligned paragraphs print where the editor shows them; a justified line fills its width', async () => {
  const { ELEMENT, lineGaps, colIn, offsetAtCol, setText } = await import('../src/core/format.js');
  const { linesOf } = await import('../src/core/layout.js');
  const { makeBlock } = await import('../src/core/model.js');
  const doc = newDocument('');
  const long = 'The rain does not stop. It runs down the glass in long grey lines and nobody in the diner looks up from their plates.';
  doc.blocks = [
    { ...makeBlock('action', 'Centred.'), align: 'center' },
    { ...makeBlock('action', 'Right.'), align: 'right' },
    { ...makeBlock('action', long), align: 'justify' },
  ];
  const { pages } = buildPrintPages(doc, { titlePage: false });
  const at = (text) => pages[0].lines.find((l) => l.text === text);
  const w = ELEMENT.action.width, left = ELEMENT.action.left;
  assert.equal(at('Centred.').col, left + Math.floor((w - 8) / 2));
  assert.equal(at('Right.').col, left + w - 6);
  const b = doc.blocks[2], starts = linesOf(b);
  assert.ok(starts.length >= 2);
  const first = pages[0].lines.find((l) => /^The +rain/.test(l.text));
  assert.equal(first.col, left);
  assert.equal(first.text.length, w, 'a justified line reaches the right margin');
  assert.equal(first.text.replace(/ +/g, ' '), long.slice(0, starts[1]).trim());
  const lastLine = pages[0].lines.find((l) => l.row === first.row + starts.length - 1);
  assert.ok(!/ {2}/.test(lastLine.text), 'the last line is set as written');
  // Columns and offsets map both ways over the widened spaces.
  const gaps = lineGaps(b, starts, 0);
  const t = setText(long.slice(0, starts[1] - 1), gaps);
  for (let k = 0; k < starts[1] - 1; k++) {
    assert.equal(t[colIn(gaps, k)], long[k]);
    assert.equal(offsetAtCol(gaps, colIn(gaps, k), starts[1] - 1), k);
  }
});
