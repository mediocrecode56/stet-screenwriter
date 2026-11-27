// The print preview's row of pages and its Pages field always say the same (dialogs.js previewDialog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesOf, rangeOf } from '../../src/core/printmodel.js';

test('a set of pages is written the way a writer types it, and read back', () => {
  assert.equal(rangeOf(new Set([1, 2, 3, 4, 5, 9, 12, 13, 14]), 40), '1-5, 9, 12-14');
  assert.equal(rangeOf(new Set([7]), 40), '7');
  assert.equal(rangeOf(new Set(Array.from({ length: 10 }, (_, i) => i + 1)), 10), '', 'every page: all');
  assert.equal(rangeOf(new Set([3, 1, 2, 99]), 10), '1-3', 'in order, pages that exist only');
  for (const spec of ['1-5, 9, 12-14', '7', '2-3, 5-6']) assert.equal(rangeOf(pagesOf(spec, 40), 40), spec);
  assert.deepEqual([...pagesOf('', 4)], [1, 2, 3, 4]);
  assert.deepEqual([...pagesOf('3-', 5)], [3, 4, 5]);
  assert.throws(() => pagesOf('9', 5), /does not exist/);
});
