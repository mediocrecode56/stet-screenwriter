// The highlight palette: the light theme, the print preview, the PDF and the print dialog all use
// HIGHLIGHT_PAPER; the stylesheet keeps the same values, and every colour has its theme variables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HIGHLIGHT_COLORS, HIGHLIGHT_PAPER } from '../../src/core/model.js';
import { printHTML } from '../../src/core/printhtml.js';

const css = readFileSync(new URL('../../src/renderer/style.css', import.meta.url), 'utf8');
const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
const value = (src, name) => (src.match(new RegExp(`--${name}: *([^;]+);`)) || [])[1];

test('the stylesheet paper colours are the ones printed', () => {
  assert.deepEqual(Object.keys(HIGHLIGHT_PAPER), HIGHLIGHT_COLORS);
  for (const c of HIGHLIGHT_COLORS) assert.equal(value(css, `paper-hl-${c}`), HIGHLIGHT_PAPER[c], c);
});

test('every colour has a highlight and a mark colour in both themes', () => {
  for (const c of HIGHLIGHT_COLORS) {
    for (const name of [`hl-${c}`, `tl-${c}`]) {
      assert.ok(value(css, name), `${name} (light)`);
      assert.match(value(dark, name) || '', /^#[0-9a-f]{6}$/, `${name} (dark)`);
    }
  }
});

// WCAG contrast of text on a fill.
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the script text stays clearly readable on every highlight', () => {
  for (const c of HIGHLIGHT_COLORS) {
    assert.ok(contrast(HIGHLIGHT_PAPER[c], '#000000') >= 12, `${c} on paper`);
    assert.ok(contrast(value(dark, `hl-${c}`), value(dark, 'ink')) >= 4.5, `${c} in the dark`);
  }
});

test('the print dialog fills highlights with the paper colours', () => {
  const html = printHTML([{ lines: [], rects: [{ col: 15, row: 10, w: 4, color: 'yellow' }], notes: [] }]);
  assert.ok(html.includes(HIGHLIGHT_PAPER.yellow));
});
