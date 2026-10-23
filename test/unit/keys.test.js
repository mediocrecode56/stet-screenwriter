// Shortcuts shown the Mac way on a Mac (src/core/keys.js), and unchanged elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macKeys, Keymap, comboOf, normSeq, unusable, showKeys, SEQ_MS } from '../../src/core/keys.js';

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

// Changing shortcuts (Help > Keyboard Shortcuts): sequences of up to three combinations,
// clashes found before anything is replaced.

const ev = (key, mods = {}, code = '') => ({ key, code, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift });
function keymap() {
  const k = new Keymap();
  k.define('save', 'Ctrl+S');
  k.define('palette', ['Ctrl+K', 'Ctrl+Shift+P']);
  k.define('zoom-in', ['Ctrl+=', 'Ctrl+Shift+=']);
  k.define('scene-next', 'Alt+ArrowDown');
  k.define('find-next', 'F3');
  k.define('import', null);
  return k;
}

test('key events become combinations the same way on every keyboard', () => {
  assert.equal(comboOf(ev('s', { ctrl: true }, 'KeyS'), false), 'Ctrl+S');
  assert.equal(comboOf(ev('S', { ctrl: true, shift: true }, 'KeyS'), false), 'Ctrl+Shift+S');
  assert.equal(comboOf(ev('s', { meta: true }, 'KeyS'), true), 'Ctrl+S', 'Command is Ctrl on a Mac');
  assert.equal(comboOf(ev('µ', { alt: true }, 'KeyM'), true), 'Alt+M', 'Option+M on a Mac is M, not µ');
  assert.equal(comboOf(ev('!', { ctrl: true, shift: true }, 'Digit1'), false), 'Ctrl+Shift+1');
  assert.equal(comboOf(ev('+', { ctrl: true, shift: true }, 'Equal'), false), 'Ctrl+Shift+=');
  assert.equal(comboOf(ev(' ', { ctrl: true }, 'Space'), false), 'Ctrl+Space');
  assert.equal(comboOf(ev('Shift', { shift: true }, 'ShiftLeft'), false), null);
  assert.equal(comboOf(ev('Control', { ctrl: true }, 'ControlLeft'), false), null);
  assert.equal(normSeq('ctrl+k  Ctrl+Shift+s'), 'C---K C--S-S');
  assert.equal(showKeys('Ctrl+K Ctrl+Shift+S', true), '⌘K ⇧⌘S');
  assert.equal(showKeys('Alt+ArrowDown', false), 'Alt+Down');
});

test('defaults run as before; a changed shortcut takes over and the old one stops', () => {
  const k = keymap();
  assert.deepEqual(k.feed('Ctrl+S'), { id: 'save' });
  assert.deepEqual(k.feed('Ctrl+Shift+P'), { id: 'palette' });
  assert.deepEqual(k.feed('F3'), { id: 'find-next' });
  assert.equal(k.feed('Ctrl+J'), null);
  assert.deepEqual(k.conflicts('save', 'Ctrl+J'), []);
  k.assign('save', 'Ctrl+J');
  assert.deepEqual(k.feed('Ctrl+J'), { id: 'save' });
  assert.equal(k.feed('Ctrl+S'), null);
  assert.deepEqual(k.keysOf('save'), ['Ctrl+J']);
  assert.equal(k.isDefault('save'), false);
  // A command with no shortcut can be given one.
  k.assign('import', 'Ctrl+Alt+I');
  assert.deepEqual(k.feed('Ctrl+Alt+I'), { id: 'import' });
  // Back to the defaults, one or all.
  k.reset('save');
  assert.deepEqual(k.feed('Ctrl+S'), { id: 'save' });
  k.reset();
  assert.equal(k.feed('Ctrl+Alt+I'), null);
  // A shortcut set back to its default is no longer stored as a change.
  assert.deepEqual(k.assign('find-next', 'F3'), {});
});

test('sequences of two and three combinations, and a combination that breaks one off', () => {
  const k = keymap();
  k.assign('save', 'Ctrl+M Ctrl+S');
  k.assign('import', 'Ctrl+M I F');
  let t = 1000;
  assert.deepEqual(k.feed('Ctrl+M', t), { pending: true });
  assert.deepEqual(k.feed(null, t + 10), { pending: true }, 'modifiers alone keep it waiting');
  assert.deepEqual(k.feed('Ctrl+S', t + 20), { id: 'save' });
  assert.deepEqual(k.feed('Ctrl+M', t += 100), { pending: true });
  assert.deepEqual(k.feed('I', t + 1), { pending: true });
  assert.deepEqual(k.feed('F', t + 2), { id: 'import' });
  // Something else pressed midway counts on its own.
  assert.deepEqual(k.feed('Ctrl+M', t += 100), { pending: true });
  assert.deepEqual(k.feed('F3', t + 1), { id: 'find-next' });
  assert.equal(k.feed('S', t + 2), null, 'and the sequence is over');
  // A sequence left too long starts again.
  assert.deepEqual(k.feed('Ctrl+M', t += 100), { pending: true });
  assert.equal(k.feed('Ctrl+S', t + SEQ_MS + 1), null, 'too late: Ctrl+S counts on its own, and runs nothing');
});

test('a clash is found before anything is replaced, and replacing takes the shortcut from the other command', () => {
  const k = keymap();
  assert.deepEqual(k.conflicts('save', 'Ctrl+K'), [{ id: 'palette', keys: 'Ctrl+K' }]);
  assert.deepEqual(k.conflicts('save', 'Ctrl+K Ctrl+S'), [{ id: 'palette', keys: 'Ctrl+K' }], 'Ctrl+K would never get to wait for Ctrl+S');
  k.assign('import', 'Ctrl+M I');
  assert.deepEqual(k.conflicts('save', 'Ctrl+M'), [{ id: 'import', keys: 'Ctrl+M I' }], 'Ctrl+M would cut the sequence short');
  assert.deepEqual(k.conflicts('palette', 'Ctrl+K'), [], 'its own shortcut is no clash');
  // Nothing changed by asking.
  assert.deepEqual(k.feed('Ctrl+K'), { id: 'palette' });
  k.assign('save', 'Ctrl+K');
  assert.deepEqual(k.feed('Ctrl+K'), { id: 'save' });
  assert.deepEqual(k.keysOf('palette'), ['Ctrl+Shift+P'], 'the other keeps its other shortcut');
  assert.deepEqual(k.feed('Ctrl+Shift+P'), { id: 'palette' });
  // The same shortcut never runs two commands.
  const seen = new Map();
  for (const id of k.defaults.keys()) for (const s of k.keysOf(id)) { assert.ok(!seen.has(normSeq(s)), s); seen.set(normSeq(s), id); }
});

test("shortcuts that would get in the way of writing can't be set", () => {
  assert.match(unusable('Ctrl+Q', true), /Quit on a Mac/);
  assert.equal(unusable('Ctrl+Q', false), '');
  for (const s of ['K', 'Shift+K', 'Tab', 'Enter', 'Space']) assert.match(unusable(s, false), /starts with Ctrl, Alt or a function key/, s);
  for (const s of ['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Y', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+K Ctrl+C']) assert.match(unusable(s, false), /can't be changed/, s);
  for (const s of ['Ctrl+ArrowLeft', 'Alt+ArrowRight', 'Ctrl+Shift+End', 'Alt+Backspace']) assert.match(unusable(s, false), /moves or deletes/, s);
  assert.match(unusable('Ctrl+A Ctrl+B Ctrl+C Ctrl+D'), /at most 3/);
  for (const s of ['Ctrl+S', 'F5', 'Shift+F5', 'Alt+ArrowUp', 'Ctrl+K S', 'Ctrl+M I F', 'Ctrl+Alt+Z']) assert.equal(unusable(s, false), '', s);
  // Stored shortcuts that are no longer allowed are ignored.
  const k = keymap();
  k.setOverrides({ save: ['K'], palette: ['Ctrl+J'], gone: ['Ctrl+Q'] });
  assert.deepEqual(k.keysOf('save'), []);
  assert.deepEqual(k.feed('Ctrl+J'), { id: 'palette' });
  assert.equal(k.feed('Ctrl+Q'), null);
});
