// Document model. Blocks are treated as immutable values: every edit
// replaces the block object, which lets layout caches key on identity and
// lets undo history keep references instead of copies.
//
// Block  = { id, type, text, marks }
// Mark   = { s, e, k, v }   k: 'hl' (v = color) | 'cm' (v = comment id)

export const TYPES = ['scene', 'action', 'character', 'paren', 'dialogue', 'transition', 'shot'];

export const TYPE_LABEL = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  paren: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
};

export const UPPER_TYPES = new Set(['scene', 'character', 'transition', 'shot']);
export const SPEECH_TYPES = new Set(['paren', 'dialogue']);
export const HIGHLIGHT_COLORS = ['blue', 'yellow', 'pink'];

let idSeq = 0;
const idPrefix = Math.random().toString(36).slice(2, 7);
export function newId() {
  idSeq++;
  return idPrefix + idSeq.toString(36);
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

const EMPTY = Object.freeze([]);

export function makeBlock(type, text = '', marks = EMPTY, id = newId()) {
  return { id, type, text, marks };
}

export function withText(block, text, marks = block.marks) {
  return { id: block.id, type: block.type, text, marks };
}

export function withType(block, type) {
  const text = UPPER_TYPES.has(type) ? block.text.toUpperCase() : block.text;
  // Uppercasing can change length (e.g. "ß" -> "SS"); drop marks rather than misplace them.
  const marks = text.length === block.text.length ? block.marks : EMPTY;
  return { id: block.id, type, text, marks };
}

export function emptyTitlePage(title = '') {
  return { title, credit: 'Written by', author: '', source: '', contact: '', draftDate: '', revision: '' };
}

export function defaultDocSettings() {
  return {
    sceneSpacing: 1, // blank lines before scene headings
    autoCapitalize: true,
    backup: { enabled: true, intervalMin: 5, retentionDays: 30, dir: null },
  };
}

export function newDocument(title = '') {
  const now = new Date().toISOString();
  return {
    meta: { id: uuid(), created: now, modified: now },
    settings: defaultDocSettings(),
    titlePage: emptyTitlePage(title),
    blocks: [makeBlock('scene', '')],
    comments: {},
    revision: { ignored: [] },
  };
}

// ---- marks -----------------------------------------------------------------

/** Shift marks for an insertion of `len` chars at offset `at`. */
export function marksAfterInsert(marks, at, len) {
  if (!marks.length) return marks;
  return marks.map((m) => ({
    s: m.s >= at ? m.s + len : m.s,
    e: m.e > at ? m.e + len : m.e,
    k: m.k,
    v: m.v,
  }));
}

/** Shift/trim marks for a deletion of [a, b). Marks that collapse are removed. */
export function marksAfterDelete(marks, a, b) {
  if (!marks.length || a === b) return marks;
  const d = b - a;
  const out = [];
  for (const m of marks) {
    const s = m.s < a ? m.s : m.s < b ? a : m.s - d;
    const e = m.e < a ? m.e : m.e < b ? a : m.e - d;
    if (e > s) out.push({ s, e, k: m.k, v: m.v });
  }
  return out;
}

/** Marks restricted to [a, b) and rebased to start at 0. */
export function sliceMarks(marks, a, b) {
  const out = [];
  for (const m of marks) {
    const s = Math.max(m.s, a), e = Math.min(m.e, b);
    if (e > s) out.push({ s: s - a, e: e - a, k: m.k, v: m.v });
  }
  return out;
}

export function concatMarks(left, leftLen, right) {
  if (!right.length) return left;
  return normalizeMarks(left.concat(right.map((m) => ({ s: m.s + leftLen, e: m.e + leftLen, k: m.k, v: m.v }))));
}

/** Sort and merge touching/overlapping marks with identical kind and value. */
export function normalizeMarks(marks) {
  if (marks.length < 2) return marks;
  const sorted = marks.slice().sort((x, y) => x.s - y.s || x.e - y.e);
  const out = [];
  for (const m of sorted) {
    let merged = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i];
      if (o.k === m.k && o.v === m.v && m.s <= o.e) {
        o.e = Math.max(o.e, m.e);
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...m });
  }
  return out;
}

/** Apply highlight `color` (or null to clear) on [a, b), replacing other highlights there. */
export function setHighlight(marks, a, b, color) {
  const out = [];
  for (const m of marks) {
    if (m.k !== 'hl' || m.e <= a || m.s >= b) { out.push(m); continue; }
    if (m.s < a) out.push({ s: m.s, e: a, k: 'hl', v: m.v });
    if (m.e > b) out.push({ s: b, e: m.e, k: 'hl', v: m.v });
  }
  if (color) out.push({ s: a, e: b, k: 'hl', v: color });
  return normalizeMarks(out);
}

export function removeCommentMarks(marks, commentId) {
  return marks.some((m) => m.k === 'cm' && m.v === commentId) ? marks.filter((m) => !(m.k === 'cm' && m.v === commentId)) : marks;
}

export function cueName(text) {
  return text.replace(/\s*\(.*$/, '').replace(/\s+\^?$/, '').trim();
}
