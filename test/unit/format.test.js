import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize, SCHEMA_VERSION } from '../../src/core/serialize.js';
import { encode, decode, check } from '../../src/main/container.js';
import { newDocument, makeBlock } from '../../src/core/model.js';
import { sampleDocument, generateScript } from '../../src/dev/sample.js';

test('serialize -> deserialize -> serialize is byte-identical', () => {
  const doc = sampleDocument();
  const a = serialize(doc, '0.1.0');
  const { doc: back, warnings } = deserialize(a);
  assert.deepEqual(warnings, []);
  const b = serialize(back, '0.1.0');
  assert.equal(a, b);
  // Repeated cycles never drift.
  let cur = b;
  for (let i = 0; i < 5; i++) cur = serialize(deserialize(cur).doc, '0.1.0');
  assert.equal(cur, a);
});

test('round trip preserves types, text, marks, title page, comments and settings', () => {
  const doc = sampleDocument();
  doc.settings.sceneSpacing = 2;
  doc.settings.backup.dir = 'D:\\Backups';
  const { doc: back } = deserialize(serialize(doc));
  assert.deepEqual(back.blocks.map((b) => [b.type, b.text, b.marks]), doc.blocks.map((b) => [b.type, b.text, b.marks]));
  assert.deepEqual(back.titlePage, doc.titlePage);
  assert.deepEqual(back.comments, doc.comments);
  assert.deepEqual(back.settings, doc.settings);
  assert.equal(back.meta.id, doc.meta.id);
});

test('unreferenced comments are not written', () => {
  const doc = newDocument();
  doc.comments.orphan = { text: 'x', created: '', modified: '' };
  assert.deepEqual(JSON.parse(serialize(doc)).comments, {});
});

test('newer schema, foreign and malformed payloads are rejected with codes', () => {
  const p = JSON.parse(serialize(newDocument()));
  p.schema = SCHEMA_VERSION + 1;
  assert.throws(() => deserialize(JSON.stringify(p)), { code: 'too-new' });
  assert.throws(() => deserialize('{"format":"other"}'), { code: 'not-stet' });
  assert.throws(() => deserialize('{nope'), { code: 'bad-json' });
  assert.throws(() => deserialize('{"format":"stet","schema":1}'), { code: 'bad-blocks' });
});

test('damaged content is repaired with warnings, not silently dropped', () => {
  const p = JSON.parse(serialize(newDocument()));
  p.blocks = [{ t: 'weird', x: 'Hello' }, { t: 'action', x: 'abc', m: [[0, 99, 'hl', 'blue'], [2, 1, 'hl', 'blue'], [0, 2, 'cm', 'lost']] }];
  const { doc, warnings } = deserialize(JSON.stringify(p));
  assert.equal(doc.blocks[0].type, 'action');
  assert.deepEqual(doc.blocks[1].marks, [{ s: 0, e: 3, k: 'hl', v: 'blue' }, { s: 0, e: 2, k: 'cm', v: 'lost' }]);
  assert.ok(doc.comments.lost, 'anchor keeps an (empty) comment');
  assert.ok(warnings.length >= 2);
});

test('container round trip and corruption detection', async () => {
  const doc = newDocument();
  doc.blocks = generateScript(30);
  const json = serialize(doc);
  const buf = await encode(json);
  assert.equal(await decode(buf), json);
  assert.ok(buf.length < json.length / 3, 'compressed');

  assert.throws(() => check(buf.subarray(0, buf.length - 10)), { code: 'truncated' });
  assert.throws(() => check(buf.subarray(0, 10)), { code: 'truncated' });
  const flipped = Buffer.from(buf); flipped[flipped.length - 20] ^= 0x40;
  assert.throws(() => check(flipped), { code: 'checksum' });
  const padded = Buffer.concat([buf, Buffer.from([0])]);
  assert.throws(() => check(padded), { code: 'trailing' });
  const mangled = Buffer.concat([Buffer.from('STET\n'), buf.subarray(6)]);
  assert.throws(() => check(mangled), { code: 'mangled' });
  assert.throws(() => check(Buffer.from('%PDF-1.4 hello world nothing to see')), { code: 'not-stet' });
});

test('empty documents still round-trip with one block', () => {
  const doc = newDocument();
  doc.blocks = [];
  const { doc: back } = deserialize(serialize(doc));
  assert.equal(back.blocks.length, 1);
  assert.deepEqual(deserialize(serialize({ ...doc, blocks: [makeBlock('action', 'é ✓ 😀 “quotes”')] })).doc.blocks[0].text, 'é ✓ 😀 “quotes”');
});

test('alignment and the written case of a capitalised element are saved, and old files still open', () => {
  const doc = newDocument('T');
  doc.blocks = [
    { ...makeBlock('character', 'MARA'), cased: 'Mara', align: 'center' },
    { ...makeBlock('action', 'Rain.'), align: 'justify' },
    { ...makeBlock('scene', 'INT. HOUSE'), cased: 'not this' }, // no longer matches its text: dropped
  ];
  const json = serialize(doc, 't');
  const p = JSON.parse(json);
  assert.deepEqual(p.blocks, [{ t: 'character', x: 'MARA', a: 'center', c: 'Mara' }, { t: 'action', x: 'Rain.', a: 'justify' }, { t: 'scene', x: 'INT. HOUSE' }]);
  const back = deserialize(json).doc.blocks;
  assert.deepEqual(back.map((b) => [b.align, b.cased]), [['center', 'Mara'], ['justify', undefined], [undefined, undefined]]);
  assert.equal(serialize({ ...doc, blocks: back }, 't'), json);
  // Unknown alignments and a written case that doesn't match are ignored.
  p.blocks = [{ t: 'action', x: 'A', a: 'diagonal' }, { t: 'character', x: 'BOB', c: 'Rob' }];
  assert.deepEqual(deserialize(JSON.stringify(p)).doc.blocks.map((b) => [b.align, b.cased]), [[undefined, undefined], [undefined, undefined]]);
});
