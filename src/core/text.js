// Text utilities shared by the editor, statistics and search.

const WORD_CHAR = /[\p{L}\p{N}'’_]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Reference definition of a word; countWords() must agree with it exactly (tested). */
export const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

// Word counting is a 3-state machine (out / in word / just after a joiner) over
// UTF-16 code units, with each BMP character's class memoised in a 64K table
// (0 unknown, then 1 other, 2 letter/digit, 3 joiner ' ’ -). A character costs
// one regex test the first time it is ever seen, then a table read.
// Measured 2–9× faster than the regex scan (docs/NATIVE.md).
const CLASS = new Uint8Array(65536);
CLASS[39] = CLASS[45] = CLASS[0x2019] = 3;
const NEXT = [0, 1, 0, 0, 1, 2, 0, 1, 0];
const STARTS = [0, 1, 0, 0, 0, 0, 0, 0, 0];

function classOf(c) {
  const k = LETTER_OR_DIGIT.test(String.fromCharCode(c)) ? 2 : 1;
  CLASS[c] = k;
  return k;
}

export function countWords(text) {
  if (!text) return 0;
  let n = 0, st = 0;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    let cls;
    if (c < 0xd800 || c > 0xdfff) cls = (CLASS[c] || classOf(c)) - 1;
    else if (c <= 0xdbff && i + 1 < len && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      cls = LETTER_OR_DIGIT.test(text.slice(i, i + 2)) ? 1 : 0; // astral pair
      i++;
    } else cls = 0; // lone surrogate
    const k = st * 3 + cls;
    n += STARTS[k];
    st = NEXT[k];
  }
  return n;
}

const wordCache = new WeakMap();
export function blockWords(block) {
  let n = wordCache.get(block);
  if (n === undefined) { n = countWords(block.text); wordCache.set(block, n); }
  return n;
}

export function isWordChar(ch) {
  return ch !== undefined && ch !== '' && WORD_CHAR.test(ch);
}

/** Offset of the start of the word at/before `o`. */
export function wordLeft(text, o) {
  let i = o;
  while (i > 0 && !isWordChar(text[i - 1])) i--;
  while (i > 0 && isWordChar(text[i - 1])) i--;
  return i;
}

/** Offset of the end of the word at/after `o`. */
export function wordRight(text, o) {
  let i = o;
  const n = text.length;
  while (i < n && !isWordChar(text[i])) i++;
  while (i < n && isWordChar(text[i])) i++;
  return i;
}

export function wordAt(text, o) {
  let s = o, e = o;
  while (s > 0 && isWordChar(text[s - 1])) s--;
  while (e < text.length && isWordChar(text[e])) e++;
  return [s, e];
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
