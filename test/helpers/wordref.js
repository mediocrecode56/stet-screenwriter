// Independent reference implementation of STET's word-count rule (see
// src/core/text.js), written differently on purpose: regex tokenising instead
// of a state machine. Every count in the tests is checked against it.
export function referenceCount(text) {
  if (!text) return 0;
  const spaced = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' $& ');
  return spaced.split(/[\s​–—…]+/u).filter((t) => /[\p{L}\p{N}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t)).length;
}
export const referenceDocCount = (blocks) => blocks.reduce((n, b) => n + referenceCount(b.text), 0);
