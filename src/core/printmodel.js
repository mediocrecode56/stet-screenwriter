// Print model: the single source for PDF export, printing and print preview.
// It is built from the document structure and the same pagination the editor
// uses — never from the editor's screen, zoom or theme.

import { PAGE, ELEMENT, lineText, lineX } from './format.js';
import { paginate, linesOf } from './layout.js';
import { TITLE_FIELDS_SPEC } from './titlepage.js';
import { styleRuns } from './model.js';

/**
 * Parse a page-range string ("1-3, 7, 10-") into a predicate over script page
 * numbers (1-based; the title page is never numbered). Empty = all pages.
 * Throws on malformed input so the UI can report it.
 */
export function parseRange(spec, max) {
  const s = (spec || '').trim();
  if (!s || /^all$/i.test(s)) return () => true;
  const parts = s.split(/[,;\s]+/).filter(Boolean);
  const ranges = [];
  for (const p of parts) {
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(p);
    if (!m || (!m[1] && !m[3])) throw new Error(`Invalid page range "${p}".`);
    const a = m[1] ? +m[1] : 1;
    const b = m[2] ? (m[3] ? +m[3] : max) : a;
    if (a < 1 || b < a) throw new Error(`Invalid page range "${p}".`);
    if (a > max) throw new Error(`Page ${a} does not exist (the script has ${max} pages).`);
    ranges.push([a, Math.min(b, max)]);
  }
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

export function hasTitlePage(tp) {
  return TITLE_FIELDS_SPEC.some((f) => (tp[f.key] || '').trim());
}

/**
 * Build printable pages.
 * options: { titlePage: bool, highlights: bool, comments: bool, range: string }
 * Returns { pages: [{ kind, number, lines:[{col,row,text,st?}], rects:[{col,row,w,color}], notes:[{col,row,w}] }], total, notes: [...] }
 */
export function buildPrintPages(doc, options = {}) {
  const opt = { titlePage: true, highlights: false, comments: false, range: '', ...options };
  const blocks = doc.blocks;
  const pages = paginate(blocks, doc.settings);
  const total = pages.length;
  const inRange = parseRange(opt.range, total);
  const out = [];

  if (opt.titlePage && hasTitlePage(doc.titlePage)) out.push(titlePage(doc.titlePage));

  const noteIndex = new Map(); // comment id -> number
  const noteList = [];
  pages.forEach((page, pi) => {
    const number = pi + 1;
    if (!inRange(number)) return;
    const lines = [], rects = [], notes = [], markers = [];
    if (pi > 0) { const label = `${number}.`; lines.push({ col: PAGE.rightCol - label.length, row: PAGE.numberRow, text: label }); }
    const top = PAGE.topRows;
    if (page.cont) lines.push({ col: ELEMENT.character.left, row: top, text: page.cont });
    for (const it of page.items) {
      const b = blocks[it.bi];
      const starts = linesOf(b);
      for (let l = it.l0; l < it.l1; l++) {
        const row = top + it.y + l - it.l0;
        const col = lineX(b.type, b.text, starts, l);
        const text = lineText(b.text, starts, l);
        // Text styles always print; a styled line goes out as runs (st: e.g. 'bu').
        if (text) {
          const ls = starts[l];
          for (const r of styleRuns(b.marks, ls, ls + text.length)) {
            const ln = { col: col + r.s - ls, row, text: text.slice(r.s - ls, r.e - ls) };
            if (r.st) ln.st = r.st;
            lines.push(ln);
          }
        }
        if (!b.marks.length || (!opt.highlights && !opt.comments)) continue;
        const ls = starts[l], le = ls + text.length;
        for (const m of b.marks) {
          const a = Math.max(m.s, ls), z = Math.min(m.e, le);
          if (z <= a) continue;
          if (m.k === 'hl' && opt.highlights) rects.push({ col: col + a - ls, row, w: z - a, color: m.v });
          if (m.k === 'cm' && opt.comments) {
            notes.push({ col: col + a - ls, row, w: z - a });
            if (!noteIndex.has(m.v)) {
              noteIndex.set(m.v, noteList.length + 1);
              noteList.push({ n: noteList.length + 1, page: number, text: (doc.comments[m.v] || {}).text || '' });
            }
            if (!markers.some((x) => x.id === m.v)) markers.push({ id: m.v, row });
          }
        }
      }
    }
    for (const mk of markers) lines.push({ col: PAGE.rightCol + 2, row: mk.row, text: `[${noteIndex.get(mk.id)}]` });
    if (page.more >= 0) lines.push({ col: ELEMENT.character.left, row: top + page.more, text: '(MORE)' });
    out.push({ kind: 'script', number, lines, rects, notes });
  });

  if (opt.comments && noteList.length) out.push(...notesPages(noteList));
  return { pages: out, total };
}

function titlePage(tp) {
  const lines = [];
  for (const f of TITLE_FIELDS_SPEC) {
    const v = (tp[f.key] || '').trim();
    if (!v) continue;
    const rows = v.split('\n').slice(0, f.rows || 1);
    rows.forEach((t, i) => {
      t = t.slice(0, f.w);
      const col = f.align === 'c' ? f.col + Math.floor((f.w - t.length) / 2) : f.align === 'r' ? f.col + f.w - t.length : f.col;
      lines.push({ col, row: f.row + i, text: t });
    });
  }
  return { kind: 'title', number: 0, lines, rects: [], notes: [] };
}

function notesPages(list) {
  const pages = [];
  let lines = [], row = PAGE.topRows;
  const flush = () => { pages.push({ kind: 'notes', number: 0, lines, rects: [], notes: [] }); lines = []; row = PAGE.topRows; };
  lines.push({ col: PAGE.leftCol, row: row, text: 'NOTES' }); row += 2;
  for (const n of list) {
    const head = `[${n.n}] page ${n.page}`;
    const body = wrapPlain(n.text || '(empty note)', 56);
    if (row + 1 + body.length > PAGE.topRows + PAGE.bodyRows) flush();
    lines.push({ col: PAGE.leftCol, row: row++, text: head });
    for (const t of body) lines.push({ col: PAGE.leftCol + 4, row: row++, text: t });
    row++;
  }
  flush();
  return pages;
}

function wrapPlain(text, w) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + ' ' + word).trim().length > w) { if (line) out.push(line); line = word.slice(0, w); }
      else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}
