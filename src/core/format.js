// Screenplay page geometry (Courier 12pt, laid out as Final Draft does).
//
// Courier 12pt is exactly 10 characters per inch and 6 lines per inch, so the
// whole layout is expressed on a character grid: 1 column = 0.1in, 1 row = 1/6in.
// Because the font is monospaced, wrapping is pure arithmetic and never needs
// DOM measurement — this is the main reason layout is cheap.

export const PAGE = {
  cols: 82.68,       // A4: 210mm wide
  rows: 70.16,       // 297mm tall
  topRows: 6,        // 1in top margin
  bodyRows: 54,      // 9in of body text, as Final Draft sets an A4 page
  numberRow: 3,      // page number sits 0.5in from the top
  numberCol: 72.5,   // and ends 7.25in from the left edge
  rightCol: 75,      // 7.5in: right margin edge
  leftCol: 15,       // 1.5in: binding margin
};

// The industry-standard element margins (Final Draft's screenplay defaults), in inches from the
// page's left edge: [left, right]. Everything else is derived from these.
const MARGINS = {
  scene:      [1.5, 7.5],
  action:     [1.5, 7.5],
  character:  [3.5, 7.25],
  paren:      [3.0, 5.5],
  dialogue:   [2.5, 6.0],
  transition: [5.5, 7.1],
  shot:       [1.5, 7.5],
};
// bold: the element is set in bold, as Final Draft prints scene headings, cues and shots.
const STYLE = {
  scene:      { before: 1, upper: true, bold: true },
  action:     { before: 1 },
  character:  { before: 1, upper: true, bold: true },
  paren:      { before: 0 },
  dialogue:   { before: 0 },
  transition: { before: 1, upper: true, right: true },
  shot:       { before: 1, upper: true, bold: true },
};
// left: first column, width: whole characters that fit between the margins, before: blank rows above.
export const ELEMENT = Object.fromEntries(Object.entries(MARGINS).map(([type, [l, r]]) =>
  [type, { left: Math.round(l * 10), width: Math.floor((r - l) * 10 + 1e-9), ...STYLE[type] }]));

/** Blank rows above an element of `type` that follows one of `prevType`. */
export function spaceBefore(type, settings, prevType) {
  if (type === 'scene' && settings && settings.sceneSpacing) return settings.sceneSpacing;
  // Dialogue that isn't under a cue or a parenthetical starts a paragraph of its own.
  if (type === 'dialogue' && prevType && prevType !== 'character' && prevType !== 'paren') return 1;
  return ELEMENT[type].before;
}

/**
 * Word-wrap `text` to `width` columns. Returns the start offset of each visual
 * line. A line spans [starts[i], starts[i+1]); a breaking space stays at the end
 * of the line it ends, and "\n" (soft line break) belongs to the line it ends.
 */
export function wrap(text, width) {
  const starts = [0];
  const n = text.length;
  let lineStart = 0;
  while (lineStart < n) {
    const nl = text.indexOf('\n', lineStart);
    const hardEnd = nl === -1 ? n : nl;
    if (hardEnd - lineStart <= width) {
      if (nl === -1) break;
      lineStart = nl + 1;
      starts.push(lineStart);
      continue;
    }
    // Find the last space at or before lineStart + width, or a hyphen inside a word that ends
    // a line which fits (as Final Draft breaks "twenty-year-" / "old.").
    let brk = -1;
    for (let i = lineStart + width; i > lineStart; i--) {
      const c = text.charCodeAt(i);
      if (c === 32) { brk = i; break; }
      if (HYPHENS.has(c) && i < lineStart + width && i + 1 < hardEnd && isWordBreak(text, i)) { brk = i + 1; break; }
    }
    if (brk === -1) {
      lineStart += width; // a word longer than the line: hard break
    } else if (text.charCodeAt(brk) !== 32) {
      lineStart = brk; // after a hyphen: it stays on the line it ends
    } else {
      lineStart = brk + 1;
      // Absorb runs of spaces so a line never starts with one.
      while (lineStart < hardEnd && text.charCodeAt(lineStart) === 32) lineStart++;
    }
    starts.push(lineStart);
  }
  return starts;
}

const HYPHENS = new Set([0x2d, 0x2014]); // hyphen, em dash

// A hyphen breaks a line only between two characters of text: never one that starts a word
// ("- note", "-5"), ends one ("pre- and post-") or is part of a run ("--").
function isWordBreak(text, i) {
  const a = text.charCodeAt(i - 1), z = text.charCodeAt(i + 1);
  return a !== 32 && a !== 10 && !HYPHENS.has(a) && z !== 32 && z !== 10 && !HYPHENS.has(z);
}

/** Visible text of a line: excludes the trailing break space / newline. */
export function lineText(text, starts, i) {
  const s = starts[i];
  let e = i + 1 < starts.length ? starts[i + 1] : text.length;
  while (e > s && (text.charCodeAt(e - 1) === 32 || text.charCodeAt(e - 1) === 10)) {
    if (i + 1 >= starts.length && text.charCodeAt(e - 1) === 32) break; // keep typed trailing spaces on the last line
    e--;
  }
  return text.slice(s, e);
}

// ---- alignment ----------------------------------------------------------------------
//
// A paragraph can be aligned left, centred, right or justified between its element's margins.
// Without one of its own it takes its element's (a Transition is right-aligned, the rest left).
// Wrapping never changes with alignment: only where each line starts, and for a justified
// line, how many columns each space between its words takes. Every column stays a whole
// character, so the caret, selection and printing keep using plain grid arithmetic.

export const ALIGNS = ['left', 'center', 'right', 'justify'];

/** The alignment a block's lines take. */
export function alignOf(b) {
  return b.align || (ELEMENT[b.type].right ? 'right' : 'left');
}

/** Column (relative to the page) where line i of block b starts. */
export function lineX(b, starts, i) {
  const el = ELEMENT[b.type];
  const a = alignOf(b);
  if (a === 'left' || a === 'justify') return el.left;
  const free = Math.max(0, el.width - lineText(b.text, starts, i).length);
  return el.left + (a === 'right' ? free : Math.floor(free / 2));
}

/**
 * The spaces a justified line stretches to fill its width: [[offset of a space within the
 * line, extra columns after it], ...], or null when the line is set as written (any other
 * alignment, a paragraph's last line, or a line ended by a line break).
 */
export function lineGaps(b, starts, i) {
  if (alignOf(b) !== 'justify' || i + 1 >= starts.length) return null;
  if (b.text.charCodeAt(starts[i + 1] - 1) === 10) return null;
  const t = lineText(b.text, starts, i);
  const free = ELEMENT[b.type].width - t.length;
  if (free <= 0) return null;
  const at = [];
  for (let j = 1; j < t.length - 1; j++) if (t.charCodeAt(j) === 32 && t.charCodeAt(j + 1) !== 32) at.push(j);
  if (!at.length) return null;
  const each = Math.floor(free / at.length), rest = free % at.length;
  return at.map((j, k) => [j, each + (k < rest ? 1 : 0)]);
}

/** Column within its line of offset k (counted from the line's start). */
export function colIn(gaps, k) {
  if (!gaps) return k;
  let c = k;
  for (const [at, n] of gaps) if (at < k) c += n;
  return c;
}

/** Offset within a line of `len` characters (counted from its start) nearest to column `col`. */
export function offsetAtCol(gaps, col, len) {
  if (!gaps) return Math.max(0, Math.round(col));
  let best = 0;
  for (let k = 1; k <= len; k++) if (Math.abs(colIn(gaps, k) - col) < Math.abs(colIn(gaps, best) - col)) best = k;
  return best;
}

/** Text [s, e) of a line (offsets from its start) as it is set: a justified line's spaces widened. */
export function setText(t, gaps, s = 0, e = t.length) {
  if (!gaps) return t.slice(s, e);
  let out = '', from = s;
  for (const [at, n] of gaps) {
    if (at < s || at >= e) continue;
    out += t.slice(from, at + 1) + ' '.repeat(n);
    from = at + 1;
  }
  return out + t.slice(from, e);
}
