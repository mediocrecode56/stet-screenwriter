// The timeline (View > Timeline): the script laid out left to right, a page to a unit, with its
// scenes, highlights and notes, over a time ruler. The ruler counts a minute a page until the
// writer pins timecodes to places in the script (doc.timecodes); time between two of them is
// spread evenly, and after the last one the script runs at the pace measured up to it.
//
// Positions are in pages: page 3, row 27 of PAGE.bodyRows is 2 + 27 / bodyRows.

import { PAGE } from './format.js';
import { linesOf, pageOf } from './layout.js';
import { HIGHLIGHT_COLORS } from './model.js';

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

/**
 * Where a view whose top edge is at row `row` (from the top of the body, fractional) of page pi begins
 * in the script: the first printed line at or below it, read the way the marks are (scriptPos). Rows with
 * no line on them (the blank before a heading, a margin, the gap between pages) belong to the line after
 * them, so a heading at the top of the view is where the view begins, exactly on its tick.
 */
export function lineFrom(pages, pi, row) {
  if (!pages.length || pi < 0) return 0;
  for (; pi < pages.length; pi++, row = 0) {
    for (const it of pages[pi].items) if (row < it.y + it.l1 - it.l0) return pi + Math.max(row, it.y) / BODY;
  }
  return pages.length;
}

/** Where a view whose bottom edge is at row `row` of page pi ends: just after the last printed line above it. */
export function lineTo(pages, pi, row) {
  if (!pages.length || pi < 0) return 0;
  for (pi = Math.min(pi, pages.length - 1); pi >= 0; pi--, row = Infinity) {
    let x = null;
    for (const it of pages[pi].items) { if (it.y >= row) break; x = pi + Math.min(row, it.y + it.l1 - it.l0) / BODY; }
    if (x != null) return x;
  }
  return 0;
}

/**
 * Where content row `row` (fractional, from the top of page pi's body; `span` rows from one page's
 * body to the next's) is in the script, with no break anywhere: on a printed line as lineFrom reads
 * it, and across rows with no line on them (blank rows, the margins, the gap between pages) evenly
 * from the end of the line before to the start of the next. The glass band is drawn with it, so
 * scrolling the script moves it smoothly, never waiting at a blank row and then jumping.
 */
export function flowAt(pages, pi, row, span) {
  if (!pages.length || pi < 0) return 0;
  if (pi >= pages.length) return pages.length;
  let end = null, start = null; // the printed line ending before the row, and the one starting after it: [row, pos]
  for (const it of pages[pi].items) {
    const n = it.l1 - it.l0;
    if (row >= it.y && row < it.y + n) return pi + row / BODY;
    if (it.y + n <= row) end = [it.y + n, pi + (it.y + n) / BODY];
    else if (it.y > row) { start = [it.y, pi + it.y / BODY]; break; }
  }
  if (!end && pi > 0) { const last = pages[pi - 1].items.at(-1); if (last) { const e = last.y + last.l1 - last.l0; end = [e - span, pi - 1 + e / BODY]; } }
  if (!start && pi + 1 < pages.length) { const first = pages[pi + 1].items[0]; if (first) start = [first.y + span, pi + 1 + first.y / BODY]; }
  if (!end) return start ? start[1] : pi + Math.max(0, Math.min(BODY, row)) / BODY;
  if (!start) return end[1];
  return end[1] + (start[1] - end[1]) * Math.max(0, Math.min(1, (row - end[0]) / (start[0] - end[0])));
}

/** Line of block b that offset o is on. */
function lineOf(b, o) {
  const starts = linesOf(b);
  let l = 0;
  while (l + 1 < starts.length && starts[l + 1] <= o) l++;
  return l;
}

/**
 * What the timeline shows: the scenes (where each starts), the highlights (from and
 * to, in their colour, a run of the same colour across blocks as one) and the notes. A highlight that
 * is only a note's colour (all of it inside a note given that colour, `colors`: id -> colour) is left
 * out: the note's own square shows it, in that colour.
 */
export function timelineOf(blocks, pages, colors = null) {
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
      const inside = (colors && b.marks.find((c) => c.k === 'cm' && c.s <= m.s && m.e <= c.e && colors.get(c.v) === m.v)?.v) || null;
      // A highlight that carries on from the end of the previous block's is the same stretch.
      if (run && run.color === m.v && m.s === 0) { run.x1 = Math.max(run.x1, x1); if (run.note !== inside) run.note = null; carried = run; }
      else { carried = { x0, x1, color: m.v, note: inside }; highlights.push(carried); }
      if (m.e < b.text.length) carried = null;
    }
    run = carried;
  }
  return { scenes, highlights: highlights.filter((hl) => !hl.note).map(({ note, ...hl }) => hl), notes };
}

/** Position x moved onto the nearest whole second of `time` (never past `len`): where anything on the
 *  bar is drawn (a mark, the playhead, the pointer's line), so nothing is ever between two seconds. */
export function onSecond(time, x, len) {
  return Math.max(0, Math.min(len, time.pos(Math.round(time.at(x)))));
}

/** The timeline with every scene, note and highlight moved onto the nearest whole second of `time`
 *  (never past `len`, the end of the script), so none sits between two; `at` keeps where it really is. */
export function onSeconds({ scenes, highlights, notes }, time, len) {
  const sec = (x) => onSecond(time, x, len);
  const put = (m) => ({ ...m, at: m.x, x: sec(m.x) });
  return {
    scenes: scenes.map(put),
    notes: notes.map(put),
    highlights: highlights.map((hl) => {
      const x0 = sec(hl.x0), x1 = sec(hl.x1);
      return { ...hl, at: hl.x0, x0, x1: x1 > x0 ? x1 : Math.min(len, time.pos(Math.round(time.at(hl.x0)) + 1)) }; // at least a second long
    }),
  };
}

/** The target nearest x within `tol` (all in pages), or null: what the pointer is drawn to. */
export function snapTo(targets, x, tol, lo = -Infinity, hi = Infinity) {
  let best = null;
  for (const t of targets) {
    if (t.x < lo || t.x > hi) continue; // out of sight
    const d = Math.abs(t.x - x);
    if (d <= tol) { tol = d; best = t; }
  }
  return best;
}

/** Whether [x0, x1] keeps `gap` clear of every [a, b] in `placed`. */
export function clearOf(placed, x0, x1, gap = 8) {
  return !placed.some(([a, b]) => x0 < b + gap && x1 > a - gap);
}

/** Which labels fit on one row, the highest `rank` first: each { x0, x1, rank } is shown unless it
 *  would come within `gap` of one already placed (`placed`, [x0, x1] pairs it adds the shown ones to). */
export function placeLabels(labels, placed = [], gap = 8) {
  const shown = labels.map(() => false);
  labels.map((l, i) => i).sort((i, j) => labels[j].rank - labels[i].rank).forEach((i) => {
    const { x0, x1 } = labels[i];
    if (clearOf(placed, x0, x1, gap)) { placed.push([x0, x1]); shown[i] = true; }
  });
  return shown;
}

/** Fine scrubbing: the whole second `dx` pixels on from second t0, a second every `px` pixels, kept within 0..total. */
export function fineTime(t0, dx, px, total) {
  return Math.max(0, Math.min(Math.floor(total), Math.round(t0 + dx / px)));
}

/** Timecodes pinned in the script, as positions: [{ x, t, id }] in script order, unusable ones left out. */
export function anchorsOf(timecodes, blocks, pages) {
  if (!timecodes || !timecodes.length) return [];
  const at = new Map(blocks.map((b, i) => [b.id, i]));
  const out = [];
  for (const tc of timecodes) {
    const bi = at.get(tc.id);
    if (bi == null) continue;
    out.push({ x: scriptPos(pages, bi, Math.min(tc.line || 0, linesOf(blocks[bi]).length - 1)), t: tc.t, id: tc.id, line: tc.line || 0, tag: tc.tag || '', color: tc.color || null });
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

/** Whether a timecode is a scene's own: pinned to the first line of a scene heading. */
export function isSceneTimecode(tc, blocks, at = null) {
  if ((tc.line || 0) !== 0) return false;
  const b = at ? blocks[at.get(tc.id)] : blocks.find((x) => x.id === tc.id);
  return !!b && b.type === 'scene';
}

/** The scenes' own timecodes that hold (see anchorsOf), by block id: what the script shows beside each heading. */
export function sceneTimecodes(timecodes, blocks, pages) {
  const at = new Map(blocks.map((b, i) => [b.id, i]));
  const out = new Map();
  for (const a of anchorsOf(timecodes, blocks, pages)) if (isSceneTimecode(a, blocks, at)) out.set(a.id, a);
  return out;
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

/** The closest the timeline zooms in: two minutes of the script across the bar. */
export const ZOOM_MAX_SEC = 120;

/** The most pixels a page the bar (`width` pixels for the script's `len` pages, `total` seconds long)
 *  is drawn at: two minutes of it across the bar at the script's own pace, never closer than the whole
 *  script (one shorter than two minutes doesn't zoom at all). */
export function maxScale(width, len, total) {
  return (width / len) * Math.max(1, total / ZOOM_MAX_SEC);
}

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

/** A timecode's tag as kept: one line, at most 40 characters ('' for none). */
export function cleanTag(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** A timecode as kept: { id, line, t } and its tag and colour when it has them. */
export function makeTimecode(id, line, t, tag = '', color = null) {
  const tc = { id, line, t };
  if (cleanTag(tag)) tc.tag = cleanTag(tag);
  if (HIGHLIGHT_COLORS.includes(color)) tc.color = color;
  return tc;
}

/** Timecodes as saved: block index, line and seconds (and n: tag, c: colour); ones whose block is gone are dropped. */
export function timecodesToJSON(timecodes, blocks) {
  if (!timecodes || !timecodes.length) return null;
  const at = new Map(blocks.map((b, i) => [b.id, i]));
  const out = [];
  for (const tc of timecodes) {
    if (!at.has(tc.id)) continue;
    const o = { b: at.get(tc.id), l: tc.line || 0, t: tc.t };
    if (tc.tag) o.n = tc.tag;
    if (tc.color) o.c = tc.color;
    out.push(o);
  }
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
    out.push(makeTimecode(blocks[x.b].id, Number.isInteger(x.l) && x.l >= 0 ? x.l : 0, Math.round(x.t), typeof x.n === 'string' ? x.n : '', x.c));
  }
  return out;
}
