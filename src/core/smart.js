// Autocomplete for scene headings, character cues and transitions.
// Suggestions are computed from the document on demand (only while the caret
// sits at the end of such an element), never on every keystroke elsewhere.

import { cueName } from './model.js';

export const SCENE_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'EXT./INT. ', 'I/E. ', 'EST. '];
export const TIMES = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME TIME'];
export const EXTENSIONS = ['V.O.', 'O.S.', 'O.C.', "CONT'D", 'PRE-LAP', 'FILTERED', 'INTO PHONE'];
export const TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'FADE OUT.', 'FADE TO BLACK.', 'FADE IN:', 'INTERCUT WITH:', 'BACK TO:'];

const PREFIX_RE = /^(INT\.\/EXT\.|EXT\.\/INT\.|INT\.|EXT\.|I\/E\.|EST\.)\s*/;

/** Split a scene heading into {prefix, location, time}. */
export function parseHeading(text) {
  const m = PREFIX_RE.exec(text);
  const prefix = m ? m[1] : '';
  const rest = m ? text.slice(m[0].length) : text;
  const dash = rest.lastIndexOf(' - ');
  if (dash === -1) return { prefix, location: rest.trim(), time: '' };
  return { prefix, location: rest.slice(0, dash).trim(), time: rest.slice(dash + 3).trim() };
}

export function locations(blocks) {
  const freq = new Map();
  for (const b of blocks) {
    if (b.type !== 'scene') continue;
    const { location } = parseHeading(b.text);
    if (location) freq.set(location, (freq.get(location) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}

function filter(list, typed, exclude) {
  const t = typed.toUpperCase();
  const out = [];
  for (const s of list) {
    if (s.startsWith(t) && s !== t && s !== exclude) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Suggestions for the caret at offset o of block bi.
 * Returns { from, items } — accepting item k replaces text [from, o) with items[k].
 */
export function suggest(blocks, bi, o, names) {
  const b = blocks[bi];
  if (!b || o !== b.text.length) return null;
  const text = b.text;
  if (b.type === 'scene') {
    const m = PREFIX_RE.exec(text);
    if (!m) {
      const items = filter(SCENE_PREFIXES, text);
      return items.length ? { from: 0, items } : null;
    }
    const restStart = m[0].length;
    const dash = text.lastIndexOf(' - ');
    if (dash >= restStart - 1 && dash !== -1) {
      const from = dash + 3;
      const items = filter(TIMES, text.slice(from));
      return items.length ? { from, items } : null;
    }
    const typed = text.slice(restStart);
    if (!typed) return null;
    const own = parseHeading(text).location;
    const items = filter(locations(blocks), typed, own).map((s) => s);
    return items.length ? { from: restStart, items } : null;
  }
  if (b.type === 'character') {
    const paren = text.lastIndexOf('(');
    if (paren !== -1 && !text.includes(')', paren)) {
      const from = paren + 1;
      const items = filter(EXTENSIONS, text.slice(from)).map((s) => s + ')');
      return items.length ? { from, items } : null;
    }
    if (!text) return null;
    const self = cueName(text);
    const items = filter(names || [], text, self);
    return items.length ? { from: 0, items } : null;
  }
  if (b.type === 'transition') {
    const items = filter(TRANSITIONS, text);
    return items.length ? { from: 0, items } : null;
  }
  return null;
}
