// The page as Final Draft prints it: A4, Courier 10 Pitch with characters 7pt apart, lines
// broken after hyphens, and speeches broken between their paragraphs. The numbers come from a
// Final Draft PDF (positions in points from the page's top-left corner). Bold and blank lines
// are the writer's own: STET adds none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { wrap, lineText, PAGE, PITCH } from '../src/core/format.js';
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

test('the page: A4, the script font embedded, characters 7pt apart, the number 7.25in from the left, the baseline where Final Draft has it', () => {
  const blocks = [makeBlock('scene', '1. INTRO')];
  for (let i = 0; i < 60; i++) blocks.push(makeBlock('action', `Line ${i}.`));
  const { pages } = buildPrintPages(doc(blocks), {});
  const pdf = Buffer.from(buildPdf(pages, { fonts: FONTS })).toString('latin1');
  assert.match(pdf, /\/MediaBox \[0 0 595\.32 841\.92\]/);
  assert.match(pdf, /\/BaseFont \/STETCourier-Regular .*\/Subtype \/TrueType|\/Subtype \/TrueType \/BaseFont \/STETCourier-Regular/);
  assert.match(pdf, /\/FontFile2 \d+ 0 R/);
  // First line: 1.5in from the left, its baseline 80.52pt from the top (Final Draft: 108, 80.52).
  assert.match(pdf, new RegExp(`BT\\n-0\\.2 Tc\\n/F1 12 Tf\\n108 ${Math.round((PAPER.h - 80.52) * 100) / 100} Td \\(1\\. INTRO\\) Tj`));
  const n = pages[1].lines.find((l) => l.text === '2.');
  assert.ok(Math.abs(n.col * 7.2 + 2 * 7 - 522) < 1e-9, 'the page number ends at 522pt');
  assert.equal(n.row, PAGE.numberRow);
  // Without the font files it still makes a PDF, in the standard Courier.
  assert.match(Buffer.from(buildPdf(pages)).toString('latin1'), /\/BaseFont \/Courier-Bold/);
});

test('STET adds no bold and no blank lines of its own', () => {
  const d = doc([makeBlock('action', 'A.'), makeBlock('scene', 'INT. B'), makeBlock('shot', '- TITLE'),
    makeBlock('dialogue', 'Narration.'), makeBlock('character', 'ME'), makeBlock('dialogue', 'Hi.')]);
  assert.equal(newDocument().settings.sceneSpacing, 1);
  assert.deepEqual(paginate(d.blocks, d.settings)[0].items.map((it) => it.y), [0, 2, 4, 5, 7, 8]);
  assert.ok(buildPrintPages(d, {}).pages[0].lines.every((l) => !l.st), 'nothing bold');
});

test('characters follow 7pt apart in the PDF, the print and on the editor\'s grid', async () => {
  assert.equal(PITCH * 7.2, 7);
  const { printHTML } = await import('../src/core/printhtml.js');
  assert.match(printHTML([]), /letter-spacing: -0\.2pt/);
  const css = fs.readFileSync(new URL('../src/renderer/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.page, \.tp-f, #input, \.sheet, \.metric-probe, \.ghost \{\n  letter-spacing: -0\.016667em;/);
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

test('Final Draft import keeps the writer\'s empty lines, and changes no settings', () => {
  const xml = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content>
    <Paragraph Type="Scene Heading"><Text>1. INTRO</Text></Paragraph>
    <Paragraph Type="Character"><Text>ME</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>One.</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>
Two.
</Text></Paragraph>
    <Paragraph Type="Action"><Text>Rain.   </Text></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
    <Paragraph Type="Shot"><Text>- TITLE</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>  
Narration.</Text></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
  </Content><ElementSettings Type="Scene Heading"><FontSpec Style="Bold"/><ParagraphSpec SpaceBefore="12"/></ElementSettings></FinalDraft>`;
  const r = parseFdx(xml);
  assert.equal(r.settings, undefined);
  // An empty line a paragraph opens or ends on, and an empty paragraph, stay as Final Draft shows them;
  // empty paragraphs at the end of the script go.
  assert.deepEqual(r.blocks.map((b) => b.text), ['1. INTRO', 'ME', 'One.\n\nTwo.\n', 'Rain.', '', '- TITLE', '\nNarration.']);
  assert.deepEqual(parseFdx(xml.replace('<Text>ME</Text>', '<Text>ME\n</Text>')).blocks[1].text, 'ME', 'a cue stays one line');
});

test('printing from the OS uses the same font and paper', async () => {
  const { printHTML } = await import('../src/core/printhtml.js');
  const html = printHTML(buildPrintPages(doc([makeBlock('scene', 'INT. A')]), {}).pages);
  assert.match(html, /@page \{ size: 210mm 297mm; margin: 0; \}/);
  for (const f of ['Regular', 'Bold', 'Italic', 'BoldItalic']) assert.ok(html.includes(`url("STETCourier-${f}.ttf")`), f);
  assert.match(html, /<b style="left:1\.5in;top:1in">INT\. A</);
});

test('"Written by" alone makes no title page', () => {
  const d = newDocument();
  d.blocks = [makeBlock('action', 'A.')];
  assert.equal(buildPrintPages(d, { titlePage: true }).pages[0].kind, 'script');
  d.titlePage.title = 'T';
  assert.equal(buildPrintPages(d, { titlePage: true }).pages[0].kind, 'title');
});
