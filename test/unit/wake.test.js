// The click that brings the window back does nothing else (core/wake.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wakingPress, WAKE_MS } from '../../src/core/wake.js';

test('a press that brings the window back is only that', () => {
  assert.equal(wakingPress({ away: true, focused: false, backAt: -Infinity, at: 1000 }), true, 'still in the background');
  assert.equal(wakingPress({ away: true, focused: true, backAt: 1000, at: 1004 }), true, 'with the window coming forward');
});

test('every other press is an ordinary one', () => {
  assert.equal(wakingPress({ away: false, focused: true, backAt: 0, at: 5 }), false, 'the window had the focus');
  assert.equal(wakingPress({ away: true, focused: true, backAt: 1000, at: 1000 + WAKE_MS + 400 }), false, 'back by Alt+Tab, then a press');
});
