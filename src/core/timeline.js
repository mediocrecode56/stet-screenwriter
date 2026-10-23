// The timeline (View > Timeline): the script laid out left to right, a page to a unit, with its
// scenes, highlights and notes, over a time ruler. The ruler counts a minute a page until the
// writer pins timecodes to places in the script (doc.timecodes); time between two of them is
// spread evenly, and after the last one the script runs at the pace measured up to it.
//
// Positions are in pages: page 3, row 27 of PAGE.bodyRows is 2 + 27 / bodyRows.

import { PAGE } from './format.js';
import { linesOf, pageOf } from './layout.js';

export const SEC_PER_PAGE = 60;
const BODY = PAGE.bodyRows;

/** Position of line `line` of block bi. */
export function scriptPos(pages, bi, line = 0) {
  if (!pages.length) return 0;
  const pi = pageOf(pages, bi, line);
  const page = pages[pi];
  for (const it of page.items) {
    if (it.bi === bi && line >= it.l0 && line < it.l1) return pi + (it.y + line - it.l0) / BODY;
  }
  // A line no page shows (an empty block at a page break): where its page starts.
  return pi;
}

/** The block and line at position x: the line printed there, or the last one above it. */
export function placeAt(pages, x) {
  if (!pages.length) return { bi: 0, line: 0 };
  const pi = Math.max(0, Math.min(pages.length - 1, Math.floor(x)));
  const page = pages[pi];
  const row = (x - pi) * BODY + 1e-6; // a line's own position, despite rounding
  let best = null;
  for (const it of page.items) {
    if (it.y > row) break;
    best = it;
  }
  if (!best) return page.items.length ? { bi: page.items[0].bi, line: page.items[0].l0 } : { bi: page.startBi, line: page.startLine };
  return { bi: best.bi, line: Math.min(best.l1 - 1, best.l0 + Math.floor(row - best.y)) };
}

/** Line of block b that offset o is on. */
function lineOf(b, o) {
  const starts = linesOf(b);
  let l = 0;
  while (l + 1 < starts.length && starts[l + 1] <= o) l++;
  return l;
}

/**
 * What the timeline shows: its length, the scenes (where each starts), the highlights (from and
 * to, in their colour, a run of the same colour across blocks as one) and the notes.
 */
export function timelineOf(blocks, pages) {
  const scenes = [], highlights = [], notes = [];
  let run = null; // the highlight still open at the end of the previous block
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.type === 'scene') scenes.push({ x: scriptPos(pages, bi), b: bi, text: b.text });
    const lineEnd = (o) => { const l = lineOf(b, o); return scriptPos(pages, bi, l) + 1 / BODY; };
    let carried = null;
    for (const m of b.marks) {
      if (m.k === 'cm') { notes.push({ x: scriptPos(pages, bi, lineOf(b, m.s)), id: m.v, b: bi, s: m.s, e: m.e }); continue; }
      if (m.k !== 'hl') continue;
      const x0 = scriptPos(pages, bi, lineOf(b, m.s)), x1 = lineEnd(Math.max(m.s, m.e - 1));
      // A highlight that carries on from the end of the previous block's is the same stretch.
      if (run && run.color === m.v && m.s === 0) { run.x1 = Math.max(run.x1, x1); carried = run; }
      else { carried = { x0, x1, color: m.v }; highlights.push(carried); }
      if (m.e < b.text.length) carried = null;
    }
    run = carried;
  }
  return { length: Math.max(1, pages.length), scenes, highlights, notes };
}

/** Timecodes pinned in the script, as positions: [{ x, t, id }] in script order, unusable ones left out. */
export function anchorsOf(timecodes, blocks, pages) {
  if (!timecodes || !timecodes.length) return [];
  const at = new Map(blocks.map((b, i) => [b.id, i]));
  const out = [];
  for (const tc of timecodes) {
    const bi = at.get(tc.id);
    if (bi == null) continue;
    out.push({ x: scriptPos(pages, bi, Math.min(tc.line || 0, linesOf(blocks[bi]).length - 1)), t: tc.t, id: tc.id, line: tc.line || 0 });
  }
  out.sort((a, b) => a.x - b.x);
  // Each must come later in the script and later in time than the one before (and the start, 0:00).
  const ok = [];
  for (const a of out) {
    const p = ok[ok.length - 1] || { x: 0, t: 0 };
    if (a.x > p.x && a.t > p.t) ok.push(a);
  }
  return ok;
}

/** Time at position x and position at time t, through the anchors. */
export function timeScale(anchors) {
  const pts = [{ x: 0, t: 0 }, ...anchors];
  const last = pts[pts.length - 1];
  const pace = last.x > 0 ? last.t / last.x : SEC_PER_PAGE; // seconds a page after the last timecode
  const seg = (v, k) => { // the segment a value of key k falls in
    let i = 0;
    while (i + 1 < pts.length && pts[i + 1][k] <= v) i++;
    return i;
  };
  return {
    pace,
    at(x) {
      const i = seg(x, 'x'), a = pts[i], b = pts[i + 1];
      return b ? a.t + (x - a.x) * (b.t - a.t) / (b.x - a.x) : a.t + (x - a.x) * pace;
    },
    pos(t) {
      const i = seg(t, 't'), a = pts[i], b = pts[i + 1];
      return b ? a.x + (t - a.t) * (b.x - a.x) / (b.t - a.t) : a.x + (t - a.t) / pace;
    },
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** HH:MM:SS. */
export function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** A ruler label: M:SS under an hour, H:MM:SS from there. */
export function rulerLabel(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Seconds in HH:MM:SS (or MM:SS), or null if it isn't one. */
export function parseTime(str) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})\s*$/.exec(str || '');
  if (!m) return null;
  const h = +(m[1] || 0), min = +m[2], s = +m[3];
  if (min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** The ruler's step in seconds: the smallest that leaves at least `minPx` between ticks. */
export function rulerStep(pxPerSec, minPx = 56) {
  for (const s of STEPS) if (s * pxPerSec >= minPx) return s;
  return STEPS[STEPS.length - 1];
}

/** Unlabelled ticks between the ruler's labelled ones: the finest round step dividing it, at least `minPx` apart, or none (0). */
export function minorStep(step, pxPerSec, minPx = 10) {
  for (const m of STEPS) if (m < step && step % m === 0 && m * pxPerSec >= minPx) return m;
  return 0;
}

/** Timecodes as saved: block index, line and seconds; ones whose block is gone are dropped. */
export function timecodesToJSON(timecodes, blocks) {
  if (!timecodes || !timecodes.length) return null;
  const at = new Map(blocks.map((b, i) => [b.id, i]));
  const out = [];
  for (const tc of timecodes) if (at.has(tc.id)) out.push({ b: at.get(tc.id), l: tc.line || 0, t: tc.t });
  out.sort((a, b) => a.b - b.b || a.l - b.l);
  return out.length ? out : null;
}

/** Timecodes as read from a file. */
export function timecodesFromJSON(raw, blocks) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (!x || !Number.isInteger(x.b) || x.b < 0 || x.b >= blocks.length) continue;
    if (typeof x.t !== 'number' || !(x.t >= 0) || !Number.isFinite(x.t)) continue;
    out.push({ id: blocks[x.b].id, line: Number.isInteger(x.l) && x.l >= 0 ? x.l : 0, t: Math.round(x.t) });
  }
  return out;
}
