// The promise that matters most: a file written by either side opens on the other, exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { encode as webEncode, decode as webDecode, crc32, ContainerError } from '../src/container.js';
import { encode as deskEncode, decode as deskDecode, crc32 as deskCrc } from '../../src/main/container.js';
import { serialize, deserialize } from '../../src/core/serialize.js';
import { newDocument, makeBlock } from '../../src/core/model.js';
import { toBytes, fromBytes, keptAside, fileName, baseName } from '../src/document.js';

const script = () => {
  const doc = newDocument('A TITLE');
  doc.blocks = [makeBlock('scene', 'INT. HOUSE - NIGHT'), makeBlock('action', 'Rain — and a café. 雨'), makeBlock('character', 'MARY'), makeBlock('dialogue', 'You said eight.')];
  return doc;
};
const flip = (bytes, at) => { const b = Uint8Array.from(bytes); b[at] ^= 0xff; return b; };
const codeOf = async (p) => { try { await p; return 'none'; } catch (e) { assert.ok(e instanceof ContainerError, String(e)); return e.code; } };

test('the checksum is the desktop checksum', () => {
  const b = new TextEncoder().encode('The quick brown fox — ☕');
  assert.equal(crc32(b), deskCrc(Buffer.from(b)));
});

test('a file written in the browser opens on the desktop', async () => {
  const doc = script();
  const bytes = await toBytes(doc, doc.blocks);
  const back = deserialize(await deskDecode(Buffer.from(bytes))).doc;
  assert.deepEqual(back.blocks.map((b) => [b.type, b.text]), doc.blocks.map((b) => [b.type, b.text]));
  assert.equal(back.titlePage.title, doc.titlePage.title);
  assert.equal(back.meta.id, doc.meta.id);
});

test('a file written on the desktop opens in the browser', async () => {
  const doc = script();
  const file = await deskEncode(serialize(doc, '0.56.0'));
  const { doc: back, warnings } = await fromBytes(new Uint8Array(file));
  assert.deepEqual(back.blocks.map((b) => b.text), doc.blocks.map((b) => b.text));
  assert.deepEqual(warnings, []);
});

test('what the browser cannot show survives a save, an edit included', async () => {
  const doc = script();
  doc.blocks[1] = { ...doc.blocks[1], marks: [{ s: 0, e: 4, k: 'cm', v: 'c1' }, { s: 0, e: 4, k: 'hl', v: 'blue' }] };
  doc.comments = { c1: { text: 'Too on the nose?', created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' } };
  doc.timecodes = [{ id: doc.blocks[2].id, line: 0, t: 1500 }];
  doc.revision = { ignored: [{ text: 'cafe', category: 'spelling' }] };
  doc.cast = ['MARY'];
  const before = deserialize(serialize(doc, 'x')).doc;
  const { doc: opened } = await fromBytes(await toBytes(doc, doc.blocks));
  assert.deepEqual(keptAside(opened).sort(), ['notes', 'timecodes']);
  const edited = [makeBlock('action', 'A new first line.'), ...opened.blocks];
  const { doc: again } = await fromBytes(await toBytes(opened, edited));
  assert.equal(again.comments.c1.text, 'Too on the nose?');
  assert.equal(again.timecodes[0].t, 1500);
  assert.equal(again.blocks[again.timecodes.length ? 3 : 0].text, 'MARY', 'the timecode follows its line');
  assert.deepEqual(again.cast, before.cast);
  assert.deepEqual(again.revision.ignored, before.revision.ignored);
});

test('unicode, an empty document and a long script all come back', async () => {
  for (const json of ['{"a":"雨 ☕ é"}', '', 'x'.repeat(2_000_000)]) assert.equal(await webDecode(await webEncode(json)), json);
});

test('a damaged file is refused for the same reasons as on the desktop', async () => {
  const good = await webEncode('{"hello":"world"}');
  assert.equal(await codeOf(webDecode(good.subarray(0, 10))), 'truncated');
  assert.equal(await codeOf(webDecode(good.subarray(0, good.length - 1))), 'truncated');
  assert.equal(await codeOf(webDecode(Uint8Array.of(...good, 0))), 'trailing');
  assert.equal(await codeOf(webDecode(flip(good, good.length - 2))), 'checksum');
  assert.equal(await codeOf(webDecode(flip(good, 5))), 'mangled');
  assert.equal(await codeOf(webDecode(new TextEncoder().encode('This is just a text file, not STET.'))), 'not-stet');
  const newer = Uint8Array.from(good); newer[8] = 9;
  assert.equal(await codeOf(webDecode(newer)), 'too-new');
  for (const [bytes] of [[good.subarray(0, 10)], [Uint8Array.of(...good, 0)], [flip(good, good.length - 2)]]) {
    const web = await codeOf(webDecode(bytes));
    let desk; try { await deskDecode(Buffer.from(bytes)); desk = 'none'; } catch (e) { desk = e.code; }
    assert.equal(web, desk);
  }
});

test('a file from a newer STET is refused, not opened and overwritten', async () => {
  const json = serialize(script(), 'x').replace('"schema":1', '"schema":99');
  await assert.rejects(fromBytes(await webEncode(json)), (e) => e.code === 'too-new');
});

test('names', () => {
  assert.equal(fileName('My Script'), 'My Script.stet');
  assert.equal(fileName('My Script.stet'), 'My Script.stet');
  assert.equal(baseName('Draft.FDX'), 'Draft');
  assert.equal(baseName(''), 'Untitled');
});
