import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchOrder } from '../src/core/recent.js';

test('launch opens the last screenplay edited first, then Open Recent newest first', () => {
  const recent = [{ path: 'b.stet' }, { path: 'a.stet' }, { path: 'c.stet' }];
  assert.deepEqual(launchOrder(recent, 'a.stet'), ['a.stet', 'b.stet', 'c.stet'], 'b was only looked at since');
  assert.deepEqual(launchOrder(recent, null), ['b.stet', 'a.stet', 'c.stet']);
  assert.deepEqual(launchOrder(recent, 'gone.stet'), ['b.stet', 'a.stet', 'c.stet'], 'one taken off the list is not reopened');
  assert.deepEqual(launchOrder(undefined, 'a.stet'), []);
});
