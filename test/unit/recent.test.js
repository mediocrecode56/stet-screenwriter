import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchOrder, rememberPlace, placeFor, PLACES } from '../../src/core/recent.js';

test('launch opens the last screenplay edited first, then Open Recent newest first', () => {
  const recent = [{ path: 'b.stet' }, { path: 'a.stet' }, { path: 'c.stet' }];
  assert.deepEqual(launchOrder(recent, 'a.stet'), ['a.stet', 'b.stet', 'c.stet'], 'b was only looked at since');
  assert.deepEqual(launchOrder(recent, null), ['b.stet', 'a.stet', 'c.stet']);
  assert.deepEqual(launchOrder(recent, 'gone.stet'), ['b.stet', 'a.stet', 'c.stet'], 'one taken off the list is not reopened');
  assert.deepEqual(launchOrder(undefined, 'a.stet'), []);
});

test('where each screenplay was left: one place each, the latest first, only so many, fitted to the script as it is now', () => {
  let list = [];
  for (let i = 0; i < PLACES + 5; i++) list = rememberPlace(list, { id: 'd' + i, caret: { b: i, o: 0 }, top: null, dy: 0 });
  assert.equal(list.length, PLACES);
  assert.equal(list[0].id, 'd' + (PLACES + 4));
  list = rememberPlace(list, { id: 'd10', caret: { b: 3, o: 4 }, top: { b: 2, o: 0 }, dy: -1.5 });
  assert.equal(list.filter((p) => p.id === 'd10').length, 1, 'one place a screenplay');
  const blocks = [{ text: 'INT. ROOM - DAY' }, { text: 'Hello.' }, { text: 'A line.' }, { text: 'Four' }];
  assert.deepEqual(placeFor(list, 'd10', blocks), { caret: { b: 3, o: 4 }, top: { b: 2, o: 0 }, dy: -1.5 });
  // Shorter now than when it was left: the last block, its start.
  assert.deepEqual(placeFor([{ id: 'x', caret: { b: 9, o: 30 }, top: { b: 1, o: 99 }, dy: 0 }], 'x', blocks), { caret: { b: 3, o: 0 }, top: { b: 1, o: 6 }, dy: 0 });
  assert.equal(placeFor(list, 'never', blocks), null);
  assert.equal(placeFor(undefined, 'd10', blocks), null);
  assert.equal(placeFor([{ id: 'bad', caret: 'x' }], 'bad', blocks), null);
});
