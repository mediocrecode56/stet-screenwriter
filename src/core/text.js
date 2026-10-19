// Text utilities shared by the editor, statistics and search.

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const WORD_CHAR = /[\p{L}\p{N}'’_]/u;

export function countWords(text) {
  if (!text) return 0;
  let n = 0;
  WORD_RE.lastIndex = 0;
  while (WORD_RE.exec(text) !== null) n++;
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
