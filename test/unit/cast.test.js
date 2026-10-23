import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castOrder, suggestCue, touchCast, readCast, CAST_MAX } from '../../src/core/cast.js';
import { newDocument, makeBlock } from '../../src/core/model.js';
import { serialize, deserialize } from '../../src/core/serialize.js';

test('a cue suggests the most recently used name that starts with what was typed', () => {
  const names = castOrder(['JOANNA', 'JOHN'], ['JOHN', 'JOANNA', 'MARY']);
  assert.deepEqual(names, ['JOANNA', 'JOHN', 'MARY']);
  assert.equal(suggestCue('JO', names), 'ANNA');
  assert.equal(suggestCue('joh', names), 'N');
  assert.equal(suggestCue('M', names), 'ARY');
  assert.equal(suggestCue('JOHN', names), ''); // typed in full
  assert.equal(suggestCue('JOHN (', names), '');
  assert.equal(suggestCue('', names), '');
  assert.equal(suggestCue('X', names), '');
});

test('nothing is suggested until a character is named in the script', () => {
  assert.equal(suggestCue('J', castOrder(['JOHN'], [])), ''); // remembered, but no longer in the script
});

test('using a name moves it to the front', () => {
  let c = touchCast([], 'john');
  c = touchCast(c, 'MARY');
  c = touchCast(c, 'JOHN');
  assert.deepEqual(c, ['JOHN', 'MARY']);
  assert.equal(touchCast(Array.from({ length: CAST_MAX }, (_, i) => 'N' + i), 'NEW').length, CAST_MAX);
});

test('the cast is saved in the file, only for names in the script', () => {
  const d = newDocument();
  d.blocks = [makeBlock('character', 'MARY'), makeBlock('dialogue', 'Hi.'), makeBlock('character', 'JOHN (V.O.)'), makeBlock('dialogue', 'Hey.')];
  d.cast = ['JOHN', 'GONE', 'MARY'];
  const json = serialize(d);
  assert.deepEqual(JSON.parse(json).cast, ['JOHN', 'MARY']);
  const back = deserialize(json).doc;
  assert.deepEqual(back.cast, ['JOHN', 'MARY']);
  assert.equal(serialize(back), json);
  d.cast = [];
  assert.equal('cast' in JSON.parse(serialize(d)), false);
  assert.deepEqual(readCast(['a', 'A', 3, '', ' b ']), ['A', 'B']);
  assert.deepEqual(readCast('JOHN'), []);
});
