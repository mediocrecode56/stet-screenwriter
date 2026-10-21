// Shortcuts shown the Mac way on a Mac (src/core/keys.js), and unchanged elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macKeys } from '../src/core/keys.js';

test('on a Mac: ⌘ for Ctrl, ⌥ for Alt, ⇧ for Shift, in the order Mac menus use; redo is ⇧⌘Z', () => {
  const mac = (s) => macKeys(s, true);
  assert.equal(mac('Ctrl+S'), '⌘S');
  assert.equal(mac('Ctrl+Shift+S'), '⇧⌘S');
  assert.equal(mac('Ctrl+Alt+M'), '⌥⌘M');
  assert.equal(mac('Ctrl+Shift+\\'), '⇧⌘\\');
  assert.equal(mac('Alt+1'), '⌥1');
  assert.equal(mac('Tab / Shift+Tab'), 'Tab / ⇧Tab');
  assert.equal(mac('Ctrl+Y'), '⇧⌘Z');
  assert.equal(mac('Save it (Ctrl+S) to keep it.'), 'Save it (⌘S) to keep it.');
  assert.equal(mac('F7 next suggestion'), 'F7 next suggestion');
});

test('elsewhere, unchanged', () => {
  for (const s of ['Ctrl+Shift+S', 'Ctrl+Y', 'Comments (Ctrl+Shift+\\)']) assert.equal(macKeys(s, false), s);
});
