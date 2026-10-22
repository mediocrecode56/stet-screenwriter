// Document model. Blocks are treated as immutable values: every edit
// replaces the block object, which lets layout caches key on identity and
// lets undo history keep references instead of copies.
//
// Block  = { id, type, text, marks, align?, cased? }
//          align: 'left' | 'center' | 'right' | 'justify', when not its element's own (format.js)
//          cased: the text as it was written, in an element shown in capitals (UPPER_TYPES),
//                 when that differs from `text`; it comes back if the element changes to one
//                 that isn't (a Character turned back into Dialogue keeps its capitalisation)
// Mark   = { s, e, k, v }   k: 'hl' (v = color) | 'cm' (v = comment id)
//                           | a text style in STYLES (v = 1)

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
export const HIGHLIGHT_COLORS = ['blue', 'yellow', 'pink'];

/** Text styles, printed with the script: bold, italic, underline, strikethrough. */
export const STYLES = ['b', 'i', 'u', 's'];
const STYLE = new Set(STYLES);

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
  return extras({ id: block.id, type: block.type, text, marks }, block.align, recase(block, text));
}

/** Change a block's type. Into capitals, the text as written is kept (cased); out of them, it comes back. */
export function withType(block, type) {
  const written = writtenText(block);
  const text = UPPER_TYPES.has(type) ? written.toUpperCase() : written;
  // Changing case can change length (e.g. "ß" -> "SS"); drop marks rather than misplace them.
  const marks = text.length === block.text.length ? block.marks : EMPTY;
  return extras({ id: block.id, type, text, marks }, block.align, UPPER_TYPES.has(type) ? written : undefined);
}

/** A block aligned `align` (null: its element's own alignment). */
export function withAlign(block, align) {
  return extras({ id: block.id, type: block.type, text: block.text, marks: block.marks }, align || undefined, block.cased);
}

/** The text as it was written: `cased`, if it still matches the capitals shown, else the text. */
export function writtenText(block) {
  const c = block.cased;
  return typeof c === 'string' && c.toUpperCase() === block.text ? c : block.text;
}

/** Text [a, z) of a block as a block of its own, keeping its element, alignment and written case (a new id unless given). */
export function sliceBlock(block, a, z, id = newId()) {
  const w = writtenText(block);
  return extras({ id, type: block.type, text: block.text.slice(a, z), marks: sliceMarks(block.marks, a, z) }, block.align, w.length === block.text.length ? w.slice(a, z) : undefined);
}

function extras(b, align, cased) {
  if (align) b.align = align;
  if (cased !== undefined && cased !== b.text && cased.toUpperCase() === b.text) b.cased = cased;
  return b;
}

/**
 * The written text of `block` after its text becomes `text`: what changed is taken from
 * `text` (in capitals), the rest keeps its written case.
 */
function recase(block, text) {
  if (!UPPER_TYPES.has(block.type)) return undefined;
  const c = writtenText(block), old = block.text;
  if (c === old || c.length !== old.length) return undefined;
  let a = 0;
  while (a < old.length && a < text.length && old[a] === text[a]) a++;
  let z = 0;
  while (z < old.length - a && z < text.length - a && old[old.length - 1 - z] === text[text.length - 1 - z]) z++;
  return c.slice(0, a) + text.slice(a, text.length - z) + c.slice(c.length - z);
}

/**
 * `next` is `block` with `typed` inserted at offset o, in capitals: it keeps what was typed as
 * it was written, so the capitals can be undone by a change of element later.
 */
export function withTyped(block, next, o, typed) {
  const c = writtenText(block);
  const cased = c.length === block.text.length ? c.slice(0, o) + typed + c.slice(o) : undefined;
  return extras({ id: next.id, type: next.type, text: next.text, marks: next.marks }, next.align, cased);
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
    cast: [], // character names, most recently used first (core/cast.js)
  };
}

// ---- marks -----------------------------------------------------------------

/**
 * Shift marks for an insertion of `len` chars at offset `at`. Text typed at the
 * end of a styled run carries the style on, as in any word processor; highlights
 * and notes stay where they were put.
 */
export function marksAfterInsert(marks, at, len) {
  if (!marks.length) return marks;
  return marks.map((m) => ({
    s: m.s >= at ? m.s + len : m.s,
    e: m.e > at || (m.e === at && m.s < at && STYLE.has(m.k)) ? m.e + len : m.e,
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

/** Turn style `k` on or off across [a, b). */
export function setStyle(marks, a, b, k, on) {
  const out = [];
  for (const m of marks) {
    if (m.k !== k || m.e <= a || m.s >= b) { out.push(m); continue; }
    if (m.s < a) out.push({ s: m.s, e: a, k, v: 1 });
    if (m.e > b) out.push({ s: b, e: m.e, k, v: 1 });
  }
  if (on && b > a) out.push({ s: a, e: b, k, v: 1 });
  return normalizeMarks(out);
}

/** Whether style `k` covers all of [a, b) (b > a). */
export function hasStyle(marks, a, b, k) {
  let at = a;
  for (const m of marks.filter((x) => x.k === k).sort((x, y) => x.s - y.s)) {
    if (m.s > at) break;
    if (m.e > at) at = m.e;
    if (at >= b) return true;
  }
  return false;
}

/**
 * Split [a, b) of a block into runs of constant style: [{ s, e, st }] where st
 * is the set of styles in effect, as a string in STYLES order ('' = plain).
 */
export function styleRuns(marks, a, b) {
  const cuts = new Set([a, b]);
  const styled = marks.filter((m) => STYLE.has(m.k) && m.e > a && m.s < b);
  if (!styled.length) return [{ s: a, e: b, st: '' }];
  for (const m of styled) { if (m.s > a) cuts.add(m.s); if (m.e < b) cuts.add(m.e); }
  const xs = [...cuts].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const s = xs[i], e = xs[i + 1];
    const st = STYLES.filter((k) => styled.some((m) => m.k === k && m.s <= s && m.e >= e)).join('');
    const last = out[out.length - 1];
    if (last && last.st === st) last.e = e; else out.push({ s, e, st });
  }
  return out;
}

export function removeCommentMarks(marks, commentId) {
  return marks.some((m) => m.k === 'cm' && m.v === commentId) ? marks.filter((m) => !(m.k === 'cm' && m.v === commentId)) : marks;
}

export function cueName(text) {
  return text.replace(/\s*\(.*$/, '').replace(/\s+\^?$/, '').trim();
}
