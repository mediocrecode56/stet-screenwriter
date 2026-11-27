// Revise > SCOPE: the elements a review checks (every screenplay) and the scenes left out (this one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChunks, chunkPrompt, reviewTypes, skippedBlocks, REVIEWABLE, SYSTEM_PROMPT } from '../../src/core/revision.js';
import { makeBlock, newDocument } from '../../src/core/model.js';
import { serialize, deserialize } from '../../src/core/serialize.js';

function script() {
  return [
    makeBlock('scene', 'INT. KITCHEN - NIGHT'),
    makeBlock('action', 'Mara enter in the kitchen.'),
    makeBlock('character', 'TEO'),
    makeBlock('dialogue', 'Nobody is awake.'),
    makeBlock('scene', 'EXT. YARD - DAY'),
    makeBlock('action', 'The dog bark at nobody.'),
    makeBlock('scene', 'INT. HALL - DAY'),
    makeBlock('action', 'Silence.'),
  ];
}

test('the usual elements unless the writer chose others, in the screenplay order', () => {
  assert.deepEqual([...reviewTypes(undefined)], [...REVIEWABLE]);
  assert.deepEqual([...reviewTypes(null)], [...REVIEWABLE]);
  assert.deepEqual([...reviewTypes(['dialogue', 'character', 'bogus'])], ['character', 'dialogue']);
  assert.equal(reviewTypes([]).size, 0);
});

test('only the chosen elements are reviewable; the others stay as context', () => {
  const [c] = buildChunks(script(), { types: new Set(['character', 'dialogue']) });
  assert.deepEqual(c.ids.map((x) => x.type), ['character', 'dialogue']);
  const p = chunkPrompt(c);
  assert.match(p, /e1 \[CHARACTER\] "TEO"/);
  assert.match(p, /-- \[ACTION\] "Mara enter/);
  assert.equal(buildChunks(script(), { types: new Set() }).length, 0, 'nothing chosen, nothing to send');
  assert.match(SYSTEM_PROMPT, /never its capitals/, 'capitals elements: words only');
});

test('a scene left out is not sent at all, not even as context', () => {
  const blocks = script();
  const skip = new Set([blocks[4].id]);
  assert.deepEqual(skippedBlocks(blocks, skip), [false, false, false, false, true, true, false, false]);
  const chunks = buildChunks(blocks, { skip });
  const text = chunks.map(chunkPrompt).join('\n');
  assert.ok(!text.includes('YARD') && !text.includes('dog'), 'the yard scene is left out');
  assert.ok(text.includes('Mara') && text.includes('Silence'));
  // Small chunks: the context of the next chunk skips it too.
  const small = buildChunks(blocks, { skip, target: 10 });
  assert.ok(!small.map(chunkPrompt).join('\n').includes('dog'));
  assert.equal(buildChunks(blocks, { skip: new Set(blocks.filter((b) => b.type === 'scene').map((b) => b.id)) }).length, 0, 'every scene left out: nothing to send');
});

test('the scenes left out are saved in the file by their headings, and come back', () => {
  const d = newDocument();
  d.blocks = script();
  d.revision = { ignored: [], skip: [d.blocks[4].id, d.blocks[6].id, 'gone'] };
  const json = serialize(d);
  assert.deepEqual(JSON.parse(json).revision.skip, [4, 6]);
  const back = deserialize(json).doc;
  assert.deepEqual(back.revision.skip, [back.blocks[4].id, back.blocks[6].id]);
  assert.equal(serialize(back), json);
  // Nothing skipped: nothing written. Indices that aren't scene headings are dropped on load.
  d.revision = { ignored: [] };
  assert.equal('revision' in JSON.parse(serialize(d)), false);
  const odd = JSON.parse(json);
  odd.revision.skip = [1, 4, 99, 'x'];
  assert.deepEqual(deserialize(JSON.stringify(odd)).doc.revision.skip.length, 1);
});
