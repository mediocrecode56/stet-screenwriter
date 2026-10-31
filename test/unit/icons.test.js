// The toolbar's and menus' icons (renderer/ui/icons.js): every style, alignment and highlight command
// has its toolbar icon for the selection menu, and none has a rounded corner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolIcon, alignIcon, styleIcon, lockIcon, swatch, TEXT_STYLE, HIGHLIGHT, NOTE } from '../../src/renderer/ui/icons.js';
import { HIGHLIGHT_COLORS, STYLES } from '../../src/core/model.js';

test('each command in the selection menu dropdowns has the toolbar icon', () => {
  for (const k of STYLES) assert.equal(toolIcon('style-' + k), `<span class="st-ic">${styleIcon(k)}</span>`, k);
  assert.match(toolIcon('style-clear'), /class="sclr">T</);
  for (const a of ['left', 'center', 'right', 'justify']) assert.equal(toolIcon('align-' + a), alignIcon(a), a);
  for (const c of [...HIGHLIGHT_COLORS, 'none']) assert.equal(toolIcon('hl-' + c), swatch(c), c);
  assert.equal(toolIcon('note-add'), '', 'anything else has none');
});

test('alignment icons: four 10px lines, the short ones placed by the alignment', () => {
  const xs = (a) => [...alignIcon(a).matchAll(/x="([\d.]+)" y="(\d+)" width="(\d+)"/g)].map((m) => [+m[1], +m[3]]);
  assert.deepEqual(xs('left')[1], [0, 6]);
  assert.deepEqual(xs('center')[1], [2, 6]);
  assert.deepEqual(xs('right')[1], [4, 6]);
  assert.ok(xs('justify').every(([x, w]) => x === 0 && w === 10));
});

test('square corners everywhere', () => {
  for (const s of [lockIcon(true), lockIcon(false), HIGHLIGHT, NOTE, TEXT_STYLE, alignIcon('left')]) assert.doesNotMatch(s, /\brx=|\bry=/);
});
