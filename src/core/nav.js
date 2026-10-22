// Caret navigation over the wrapped layout. Columns are page columns, so
// moving up/down between elements with different indents keeps the caret
// visually aligned (the "goal column").

import { lineX, lineGaps, colIn, offsetAtCol } from './format.js';
import { linesOf } from './layout.js';
import { wordLeft, wordRight } from './text.js';
import { pos } from './editor.js';

/** Visual line index containing offset o. */
export function lineIndexOf(starts, o) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= o) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Last caret offset on visual line i (before a breaking space/newline). */
export function lineEndOffset(text, starts, i) {
  if (i + 1 >= starts.length) return text.length;
  return starts[i + 1] - 1;
}

/** Page column of a caret position. */
export function columnOf(blocks, p) {
  const b = blocks[p.b];
  const starts = linesOf(b);
  const i = lineIndexOf(starts, p.o);
  return lineX(b, starts, i) + colIn(lineGaps(b, starts, i), p.o - starts[i]);
}

/** Offset on line i of block nearest to page column col. */
export function offsetAtColumn(block, i, col) {
  const starts = linesOf(block);
  const x = lineX(block, starts, i);
  const o = starts[i] + offsetAtCol(lineGaps(block, starts, i), col - x, lineEndOffset(block.text, starts, i) - starts[i]);
  return Math.min(o, lineEndOffset(block.text, starts, i));
}

export function left(blocks, p) {
  if (p.o > 0) {
    const t = blocks[p.b].text;
    const step = p.o > 1 && /[\uDC00-\uDFFF]/.test(t[p.o - 1]) && /[\uD800-\uDBFF]/.test(t[p.o - 2]) ? 2 : 1;
    return pos(p.b, p.o - step);
  }
  if (p.b > 0) return pos(p.b - 1, blocks[p.b - 1].text.length);
  return p;
}

export function right(blocks, p) {
  const t = blocks[p.b].text;
  if (p.o < t.length) return pos(p.b, p.o + (/[\uD800-\uDBFF]/.test(t[p.o]) ? 2 : 1));
  if (p.b < blocks.length - 1) return pos(p.b + 1, 0);
  return p;
}

export function wordLeftPos(blocks, p) {
  if (p.o === 0) return left(blocks, p);
  return pos(p.b, wordLeft(blocks[p.b].text, p.o));
}

export function wordRightPos(blocks, p) {
  const t = blocks[p.b].text;
  if (p.o === t.length) return right(blocks, p);
  return pos(p.b, wordRight(t, p.o));
}

/** Move one visual line up (dir -1) or down (dir 1), aiming for goal column. */
export function vertical(blocks, p, dir, goalCol) {
  const b = blocks[p.b];
  const starts = linesOf(b);
  const i = lineIndexOf(starts, p.o);
  if (dir < 0) {
    if (i > 0) return pos(p.b, offsetAtColumn(b, i - 1, goalCol));
    if (p.b === 0) return pos(0, 0);
    const pb = blocks[p.b - 1];
    return pos(p.b - 1, offsetAtColumn(pb, linesOf(pb).length - 1, goalCol));
  }
  if (i < starts.length - 1) return pos(p.b, offsetAtColumn(b, i + 1, goalCol));
  if (p.b === blocks.length - 1) return pos(p.b, b.text.length);
  return pos(p.b + 1, offsetAtColumn(blocks[p.b + 1], 0, goalCol));
}

export function lineHome(blocks, p) {
  const starts = linesOf(blocks[p.b]);
  return pos(p.b, starts[lineIndexOf(starts, p.o)]);
}

export function lineEnd(blocks, p) {
  const b = blocks[p.b];
  const starts = linesOf(b);
  return pos(p.b, lineEndOffset(b.text, starts, lineIndexOf(starts, p.o)));
}
