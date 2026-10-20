// Text utilities shared by the editor, statistics and search.

const WORD_CHAR = /[\p{L}\p{N}'’_]/u;

// ---- word counting -------------------------------------------------------------
//
// THE RULE (documented in README "Word count"; reference implementation in
// test/helpers/wordref.js, which every count is checked against):
//
//   A word is a run of characters between separators that contains at least
//   one letter or digit. Separators are whitespace of any kind (spaces, tabs,
//   line breaks, non-breaking and zero-width spaces), the em dash, the en dash
//   and the ellipsis character. Chinese and Japanese characters, which are
//   written without spaces, count one word each.
//
// So "don't", "well-known", "3.5", "1,000", "INT./EXT." and "(V.O.)" are one
// word each; "—", "--", "..." and "😀" on their own are none; "wait—what" is
// two. Title-page fields are not part of the screenplay's count.
//
// Implementation: one pass over UTF-16 code units with each BMP character's
// class memoised in a 64K table (0 unknown, 1 separator, 2 letter/digit,
// 3 other, 4 CJK). A character costs one regex test the first time it is
// ever seen, then a table read.
const SEPARATOR = /[\s​–—…]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CLASS = new Uint8Array(65536);

function classify(ch) {
  return SEPARATOR.test(ch) ? 1 : CJK.test(ch) ? 4 : LETTER_OR_DIGIT.test(ch) ? 2 : 3;
}

export function countWords(text) {
  if (!text) return 0;
  let n = 0, has = 0;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    let k;
    if (c < 0xd800 || c > 0xdfff) { k = CLASS[c]; if (!k) k = CLASS[c] = classify(String.fromCharCode(c)); }
    else if (c <= 0xdbff && i + 1 < len && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { k = classify(text.slice(i, i + 2)); i++; }
    else k = 3; // lone surrogate
    if (k === 2) has = 1;
    else if (k === 1) { n += has; has = 0; }
    else if (k === 4) { n += has + 1; has = 0; }
  }
  return n + has;
}

// Blocks are immutable (every edit replaces the block object), so a block's
// count can be cached by identity.
const wordCache = new WeakMap();
export function blockWords(block) {
  let n = wordCache.get(block);
  if (n === undefined) { n = countWords(block.text); wordCache.set(block, n); }
  return n;
}

/** Full recount of a list of blocks (the authoritative definition of a document's count). */
export function documentWords(blocks) {
  let n = 0;
  for (const b of blocks) n += countWords(b.text);
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
