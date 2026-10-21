// Screenplay page geometry (US Letter, Courier 12pt).
//
// Courier 12pt is exactly 10 characters per inch and 6 lines per inch, so the
// whole layout is expressed on a character grid: 1 column = 0.1in, 1 row = 1/6in.
// Because the font is monospaced, wrapping is pure arithmetic and never needs
// DOM measurement — this is the main reason layout is cheap.

export const PAGE = {
  cols: 85,          // 8.5in
  rows: 66,          // 11in
  topRows: 6,        // 1in top margin
  bodyRows: 54,      // 9in of body text
  numberRow: 3,      // page number sits 0.5in from the top
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
const STYLE = {
  scene:      { before: 1, upper: true },
  action:     { before: 1 },
  character:  { before: 1, upper: true },
  paren:      { before: 0 },
  dialogue:   { before: 0 },
  transition: { before: 1, upper: true, right: true },
  shot:       { before: 1, upper: true },
};
// left: first column, width: whole characters that fit between the margins, before: blank rows above.
export const ELEMENT = Object.fromEntries(Object.entries(MARGINS).map(([type, [l, r]]) =>
  [type, { left: Math.round(l * 10), width: Math.floor((r - l) * 10 + 1e-9), ...STYLE[type] }]));

export function spaceBefore(type, settings) {
  if (type === 'scene' && settings && settings.sceneSpacing) return settings.sceneSpacing;
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
    // Find the last space at or before lineStart + width.
    let brk = -1;
    for (let i = lineStart + width; i > lineStart; i--) {
      if (text.charCodeAt(i) === 32) { brk = i; break; }
    }
    if (brk === -1) {
      lineStart += width; // a word longer than the line: hard break
    } else {
      lineStart = brk + 1;
      // Absorb runs of spaces so a line never starts with one.
      while (lineStart < hardEnd && text.charCodeAt(lineStart) === 32) lineStart++;
    }
    starts.push(lineStart);
  }
  return starts;
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

/** Column (relative to the page) where line i of a block starts. */
export function lineX(type, text, starts, i) {
  const el = ELEMENT[type];
  if (!el.right) return el.left;
  const len = lineText(text, starts, i).length;
  return el.left + Math.max(0, el.width - len);
}
