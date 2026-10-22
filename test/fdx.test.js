import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFdx, FdxError } from '../src/core/fdx.js';
import { newDocument } from '../src/core/model.js';
import { serialize, deserialize } from '../src/core/serialize.js';

const SAMPLE = fs.readFileSync(new URL('./fixtures/sample.fdx', import.meta.url), 'utf8');

test('a Final Draft script comes in with its elements in order', () => {
  const { blocks } = parseFdx(SAMPLE);
  assert.deepEqual(blocks.map((b) => [b.type, b.text]), [
    ['scene', 'INT. HARBOUR OFFICE - NIGHT'],
    ['action', 'Rain on the glass. Somewhere, a radio & a kettle.'],
    ['character', 'MARA (V.O.)'],
    ['paren', '(quietly)'],
    ['dialogue', 'You came.\n\nLate, but you came.\nStill here.\n\nAnd now.'], // more of the same speech joins it, gaps as shown
    ['character', 'TEO'], // dual dialogue: one speech after the other
    ['dialogue', 'Always.'],
    ['character', 'MARA'],
    ['dialogue', 'Never.'],
    ['transition', 'CUT TO:'],
    ['action', 'ACT TWO'],
    ['shot', 'CLOSE ON THE KETTLE'],
  ]);
});

test('bold, italic, underline and strikeout keep their place in the text', () => {
  const { blocks } = parseFdx(SAMPLE);
  assert.deepEqual(blocks[0].marks, [{ s: 0, e: 27, k: 'b', v: 1 }]);
  assert.deepEqual(blocks[1].marks, [{ s: 19, e: 28, k: 'i', v: 1 }]);
  assert.equal(blocks[1].text.slice(19, 28), 'Somewhere');
  assert.deepEqual(blocks[6].marks, [{ s: 0, e: 7, k: 'u', v: 1 }]);
  assert.deepEqual(blocks[8].marks, [{ s: 0, e: 6, k: 's', v: 1 }]);
  const speech = blocks[4];
  assert.deepEqual(speech.marks, [{ s: speech.text.indexOf('Still'), e: speech.text.indexOf('Still') + 5, k: 'b', v: 1 }]);
});

test('the title page, the cast and what STET has no place for', () => {
  const { titlePage, cast, warnings } = parseFdx(SAMPLE);
  assert.deepEqual(titlePage, { title: 'THE HARBOUR', credit: 'Written by', author: 'Ana Ruiz', source: '', contact: 'ana@example.com\n555 0100', draftDate: 'October 2026', revision: 'Blue draft' });
  assert.deepEqual(cast, ['MARA', 'TEO']); // most recently used first
  assert.deepEqual(warnings, ['"New Act" paragraphs came in as Action.']);
});

test('an imported script saves and opens as a .stet file unchanged', () => {
  const fd = parseFdx(SAMPLE);
  const doc = { ...newDocument(), blocks: fd.blocks, titlePage: fd.titlePage, cast: fd.cast };
  const back = deserialize(serialize(doc)).doc;
  assert.deepEqual(back.blocks.map((b) => [b.type, b.text, b.marks]), fd.blocks.map((b) => [b.type, b.text, b.marks]));
  assert.deepEqual(back.titlePage, fd.titlePage);
  assert.deepEqual(back.cast, fd.cast);
});

test('a file that is not a Final Draft script is refused', () => {
  assert.throws(() => parseFdx('<html><body>hi</body></html>'), FdxError);
  assert.throws(() => parseFdx('{"format":"stet"}'), FdxError);
  assert.throws(() => parseFdx('<FinalDraft Version="6"></FinalDraft>'), /no script/);
  assert.deepEqual(parseFdx('<FinalDraft><Content></Content></FinalDraft>').blocks.map((b) => b.type), ['scene']);
});

test('entities, numeric characters and CDATA are read as text', () => {
  const { blocks } = parseFdx('<FinalDraft><Content><Paragraph Type="Action"><Text>caf&#233; &#x2014; &lt;b&gt;<![CDATA[ & more]]></Text></Paragraph></Content></FinalDraft>');
  assert.equal(blocks[0].text, 'café — <b> & more');
});

test('a parenthetical without brackets gets them, its styles staying on their words', () => {
  const { blocks } = parseFdx('<FinalDraft><Content><Paragraph Type="Parenthetical"><Text>quietly, </Text><Text Style="Italic">to Teo</Text></Paragraph></Content></FinalDraft>');
  assert.equal(blocks[0].text, '(quietly, to Teo)');
  const m = blocks[0].marks[0];
  assert.equal(blocks[0].text.slice(m.s, m.e), 'to Teo');
});
