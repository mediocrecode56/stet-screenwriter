// The page as Final Draft prints it: A4, Courier 10 Pitch, bold headings, cues and shots,
// lines broken after hyphens, and speeches broken between their paragraphs. The numbers come
// from a Final Draft PDF (positions in points from the page's top-left corner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { wrap, lineText, PAGE } from '../src/core/format.js';
import { paginate } from '../src/core/layout.js';
import { buildPrintPages } from '../src/core/printmodel.js';
import { buildPdf, PAPER } from '../src/core/pdf.js';
import { parseFdx } from '../src/core/fdx.js';
import { makeBlock, newDocument } from '../src/core/model.js';

const lines = (text, w) => { const s = wrap(text, w); return s.map((_, i) => lineText(text, s, i)); };
const doc = (blocks, settings = {}) => { const d = newDocument(); d.titlePage.credit = ''; d.blocks = blocks; Object.assign(d.settings, settings); return d; };
const FONTS = ['Regular', 'Bold', 'Italic', 'BoldItalic'].map((f) => new Uint8Array(fs.readFileSync(new URL(`../src/fonts/STETCourier-${f}.ttf`, import.meta.url))));

test('a line breaks after a hyphen inside a word, as Final Draft breaks it', () => {
  assert.deepEqual(lines('And instead of a Watson he always has with him a cute twenty-year-old.', 35),
    ['And instead of a Watson he always', 'has with him a cute twenty-year-', 'old.']);
  assert.deepEqual(lines('They put a Canadian in charge who was known for his more down-to-earth style of television.', 35),
    ['They put a Canadian in charge who', 'was known for his more down-to-', 'earth style of television.']);
  // Never a hyphen that starts or ends a word, or one of a pair.
  assert.deepEqual(lines('- Images of the place in a map through different eras, while the war/oil is in the background.', 60),
    ['- Images of the place in a map through different eras, while', 'the war/oil is in the background.']);
  assert.deepEqual(lines('aaaa bbbbbbb--cc', 12), ['aaaa', 'bbbbbbb--cc']);
  assert.deepEqual(lines('aaaa pre- and post-war', 9), ['aaaa pre-', 'and post-', 'war']);
});

test('the page: A4, the script font embedded, the number 7.25in from the left, the baseline where Final Draft has it', () => {
  const blocks = [makeBlock('scene', '1. INTRO')];
  for (let i = 0; i < 60; i++) blocks.push(makeBlock('action', `Line ${i}.`));
  const { pages } = buildPrintPages(doc(blocks), {});
  const pdf = Buffer.from(buildPdf(pages, { fonts: FONTS })).toString('latin1');
  assert.match(pdf, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(pdf, /\/BaseFont \/STETCourier-Regular .*\/Subtype \/TrueType|\/Subtype \/TrueType \/BaseFont \/STETCourier-Regular/);
  assert.match(pdf, /\/BaseFont \/STETCourier-Bold/);
  assert.match(pdf, /\/FontFile2 \d+ 0 R/);
  // First line: 1.5in from the left, its baseline 80.52pt from the top (Final Draft: 108, 80.52).
  assert.match(pdf, new RegExp(`BT\\n/F2 12 Tf\\n108 ${(PAPER.h - 80.52).toFixed(2)} Td \\(1\\. INTRO\\) Tj`));
  const n = pages[1].lines.find((l) => l.text === '2.');
  assert.equal(n.col * 7.2 + 2 * 7.2, 522, 'the page number ends at 522pt');
  assert.equal(n.row, PAGE.numberRow);
  // Without the font files it still makes a PDF, in the standard Courier.
  assert.match(Buffer.from(buildPdf(pages)).toString('latin1'), /\/BaseFont \/Courier-Bold/);
});

test('scene headings, cues and shots print bold; the rest keeps its own styles', () => {
  const d = doc([makeBlock('scene', 'INT. ROOM - DAY'), makeBlock('action', 'Rain.'), makeBlock('character', 'ME (CLOSE-UP)'),
    makeBlock('dialogue', 'Hello.'), makeBlock('shot', 'CLOSE ON THE DOOR'), makeBlock('transition', 'CUT TO:')]);
  const { pages } = buildPrintPages(d, {});
  const st = (t) => pages[0].lines.find((l) => l.text === t).st || '';
  assert.deepEqual(['INT. ROOM - DAY', 'Rain.', 'ME (CLOSE-UP)', 'Hello.', 'CLOSE ON THE DOOR', 'CUT TO:'].map(st), ['b', '', 'b', '', 'b', '']);
  const pdf = zlib.inflateSync(Buffer.from(Buffer.from(buildPdf(pages, { fonts: FONTS, deflate: (b) => zlib.deflateSync(b) })).toString('latin1').match(/stream\n([\s\S]*?)\nendstream/)[1], 'latin1')).toString('latin1');
  assert.match(pdf, /\/F2 12 Tf\n[\d.-]+ [\d.-]+ Td \(INT\. ROOM - DAY\) Tj/);
});

test('spacing: two blank lines before a scene heading; dialogue under no cue starts a paragraph', () => {
  assert.equal(newDocument().settings.sceneSpacing, 2);
  const d = doc([makeBlock('action', 'A.'), makeBlock('scene', 'INT. B'), makeBlock('shot', '- TITLE'),
    makeBlock('dialogue', 'Narration.'), makeBlock('character', 'ME'), makeBlock('dialogue', 'Hi.')]);
  const p = paginate(d.blocks, d.settings)[0];
  assert.deepEqual(p.items.map((it) => it.y), [0, 3, 5, 7, 9, 10]);
});

test("a speech breaks between its paragraphs with no (MORE) or (CONT'D), as Final Draft does", () => {
  const para = 'Word '.repeat(20).trim(); // 3 lines of dialogue
  // 49 rows of action, then a speech of four paragraphs of 3 lines.
  const fill = [makeBlock('action', 'Top.')];
  for (let i = 0; i < 12; i++) fill.push(makeBlock('action', 'Line one\nline two\nline three'));
  const speech = [para, para, para, para].join('\n\n');
  const d = doc([...fill, makeBlock('character', 'ME'), makeBlock('dialogue', speech)]);
  const pages = paginate(d.blocks, d.settings);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].more, -1, 'no (MORE)');
  assert.equal(pages[1].cont, null, "no (CONT'D)");
  const startLine = pages[1].startLine;
  assert.ok(startLine > 0 && lineText(speech, wrap(speech, 35), startLine - 1) === '', 'the page starts with a paragraph');
  // The empty line between the paragraphs stays at the foot of the first page, the rest go on whole.
  const last = pages[0].items[pages[0].items.length - 1];
  assert.equal(last.l1, startLine);
  // A paragraph long enough to split still splits, with (MORE) and (CONT'D).
  const long = 'Word '.repeat(70).trim(); // 10 lines
  const d2 = doc([...fill.slice(0, 11), makeBlock('character', 'ME'), makeBlock('dialogue', para + '\n\n' + long)]);
  const p2 = paginate(d2.blocks, d2.settings);
  assert.ok(p2[0].more >= 0 && p2[1].cont === "ME (CONT'D)");
});

test('Final Draft import: the scene spacing it uses, and the empty lines that end a paragraph', () => {
  const xml = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content>
    <Paragraph Type="Scene Heading"><Text>1. INTRO</Text></Paragraph>
    <Paragraph Type="Character"><Text>ME</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>One.</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>
Two.
</Text></Paragraph>
    <Paragraph Type="Action"><Text>Rain.   </Text></Paragraph>
  </Content><ElementSettings Type="Scene Heading"><FontSpec Style="Bold"/><ParagraphSpec SpaceBefore="12"/></ElementSettings></FinalDraft>`;
  const r = parseFdx(xml);
  assert.deepEqual(r.settings, { sceneSpacing: 1 });
  assert.deepEqual(r.blocks.map((b) => b.text), ['1. INTRO', 'ME', 'One.\n\nTwo.\n', 'Rain.']);
  assert.deepEqual(parseFdx(xml.replace(/<ElementSettings[\s\S]*<\/ElementSettings>/, '')).settings, {});
  assert.deepEqual(parseFdx(xml.replace('<Text>ME</Text>', '<Text>ME\n</Text>')).blocks[1].text, 'ME', 'a cue stays one line');
});

test('printing from the OS uses the same font and paper', async () => {
  const { printHTML } = await import('../src/core/printhtml.js');
  const html = printHTML(buildPrintPages(doc([makeBlock('scene', 'INT. A')]), {}).pages);
  assert.match(html, /@page \{ size: 210mm 297mm; margin: 0; \}/);
  for (const f of ['Regular', 'Bold', 'Italic', 'BoldItalic']) assert.ok(html.includes(`url("STETCourier-${f}.ttf")`), f);
  assert.match(html, /class="sb" style="left:1\.5in;top:1in">INT\. A</);
});

test('"Written by" alone makes no title page', () => {
  const d = newDocument();
  d.blocks = [makeBlock('action', 'A.')];
  assert.equal(buildPrintPages(d, { titlePage: true }).pages[0].kind, 'script');
  d.titlePage.title = 'T';
  assert.equal(buildPrintPages(d, { titlePage: true }).pages[0].kind, 'title');
});
