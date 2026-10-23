// Page view: virtualised rendering of paginated screenplay pages.
//
// Only pages intersecting the viewport (plus one either side) exist in the
// DOM. A page is repainted only when its content signature changes, so a
// keystroke repaints exactly one page (two if it pushes a line across a break).
// Caret, selection and find results are thin overlay layers positioned with
// grid arithmetic — no text measurement after the initial glyph-width probe.

import { PAGE, ELEMENT, lineText, lineX, lineGaps, colIn, offsetAtCol, setText } from '../core/format.js';
import { ZOOM_MIN, ZOOM_MAX } from '../core/wheelzoom.js';
import { linesOf, paginate, pageOf, rowOf } from '../core/layout.js';
import { lineIndexOf, lineEndOffset } from '../core/nav.js';
import { cmp, pos } from '../core/editor.js';
import { TITLE_FIELDS_SPEC } from '../core/titlepage.js';
import { styleRuns } from '../core/model.js';
import { reducedMotion } from './ui/motion.js';
import { sceneTimecodes, formatTime } from '../core/timeline.js';

const PX_COL = 9.6;   // 0.1in at 96dpi
const PX_ROW = 16;    // 1/6in at 96dpi (Courier 12pt line)
const PAD = 28;
const GAP = 22;
const BUFFER_PAGES = 1;
const NONE = new Map(); // no scene timecodes

const versions = new WeakMap();
let versionSeq = 0;
function ver(block) {
  let v = versions.get(block);
  if (v === undefined) { v = ++versionSeq; versions.set(block, v); }
  return v;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A line's text as it is set (gaps: a justified line's widened spaces), its bold/italic/underline/strikethrough runs as spans. */
function styledLine(b, ls, txt, gaps) {
  if (!b.marks.length) return esc(setText(txt, gaps));
  let h = '';
  for (const r of styleRuns(b.marks, ls, ls + txt.length)) {
    const t = esc(setText(txt, gaps, r.s - ls, r.e - ls));
    h += r.st ? `<span class="${[...r.st].map((k) => 's' + k).join(' ')}">${t}</span>` : t;
  }
  return h;
}

export const TITLE_FIELDS = TITLE_FIELDS_SPEC;

export class View {
  constructor({ scroller, content, editor, doc }) {
    this.scroller = scroller;
    this.content = content;
    this.editor = editor;
    this.doc = doc;
    this.pages = [];
    this.z = 1;
    this.showTitle = true;
    this.els = new Map();   // view index -> page element
    this.find = null;       // { matches, cur }
    this.activeComment = null;
    this.focused = true;
    this.onFrame = null;
    this.onTitleInput = null;
    this.raf = 0;
    this.measure();

    this.selLayer = el('div', 'layer');
    this.findLayer = el('div', 'layer');
    this.revLayer = el('div', 'layer');
    this.revision = null; // { marks: [{b, s, e, cat, cur, hov}] } from the English revision panel
    this.caretEl = el('div', '');
    this.caretEl.id = 'caret';
    this.ghost = null;      // { b, o, text }: the rest of a character name, suggested after the caret
    this.ghostEl = el('div', 'ghost');
    this.ghostEl.setAttribute('aria-hidden', 'true');
    content.append(this.revLayer, this.findLayer, this.selLayer, this.ghostEl, this.caretEl);
    this.titleEl = null;

    // Moving between monitors changes the display scale; web fonts may settle late.
    const watchScale = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { this.remeasure(); watchScale(); }, { once: true });
    watchScale();
    if (document.fonts) document.fonts.ready.then(() => this.remeasure());

    scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => { this.layoutDirty = true; this.schedule(); }).observe(scroller);
    this.layoutDirty = true;
    this.relayout();
  }

  // ---- geometry ----------------------------------------------------------------

  /**
   * Character advance as Chromium actually renders it on a page — measured in
   * the DOM with the page's own CSS, never assumed or taken from a canvas.
   * Whatever affects glyph placement (font fallback, inherited spacing, display
   * scale, zoom) is therefore what the caret, selection, highlights and
   * hit-testing use. Re-measured on zoom, display-scale and font changes.
   */
  measure() {
    if (!this.probe) {
      this.probe = el('div', 'page metric-probe');
      this.probe.setAttribute('aria-hidden', 'true');
      this.probeLine = el('div', 'l');
      this.probeLine.textContent = 'M'.repeat(200);
      this.probe.appendChild(this.probeLine);
      this.content.appendChild(this.probe);
    }
    this.probe.style.fontSize = PX_ROW * this.z + 'px';
    this.cw = this.probeLine.getBoundingClientRect().width / 200 || PX_COL * this.z;
    this.col = PX_COL * this.z;
    this.row = PX_ROW * this.z;
    this.PW = PAGE.cols * this.col;
    this.PH = PAGE.rows * this.row;
    this.gap = GAP * this.z;
  }

  remeasure() {
    const old = this.cw;
    this.measure();
    if (Math.abs(old - this.cw) > 1e-4) this.invalidate();
  }

  get offset() { return this.showTitle ? 1 : 0; }
  get viewCount() { return this.pages.length + this.offset; }
  pageTop(vi) { return PAD + vi * (this.PH + this.gap); }
  get pageLeft() { return Math.max(PAD, (this.scroller.clientWidth - this.PW) / 2); }

  /** Column -> px within a page for line content starting at grid column x0. */
  xAt(x0, chars) { return x0 * this.col + chars * this.cw; }

  // ---- frame loop ----------------------------------------------------------------

  schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.frame(); });
  }

  /** Repaginate (incrementally) if the document changed. */
  relayout() {
    const d = this.editor.takeDirty();
    if (d || !this.pages.length) {
      this.pages = paginate(this.editor.blocks, this.doc.settings, this.pages.length ? this.pages : null, this.pages.length ? d : null);
      this.layoutDirty = true;
    }
  }

  frame() {
    const t0 = performance.now();
    this.relayout();
    if (this.layoutDirty) {
      const h = this.pageTop(this.viewCount) + PAD - this.gap;
      const w = Math.max(this.scroller.clientWidth, this.PW + PAD * 2);
      this.content.style.height = h + 'px';
      this.content.style.width = w + 'px';
      this.layoutDirty = false;
      // Narrower than a page (side panels, high zoom): centre the text column once per width change.
      const cw = this.scroller.clientWidth;
      if (cw !== this._lastWidth) {
        this._lastWidth = cw;
        if (w > cw) this.scroller.scrollLeft = (w - cw) / 2;
      }
    }
    const top = this.scroller.scrollTop, bottom = top + this.scroller.clientHeight;
    const span = this.PH + this.gap;
    const first = Math.max(0, Math.floor((top - PAD) / span) - BUFFER_PAGES);
    const last = Math.min(this.viewCount - 1, Math.floor((bottom - PAD) / span) + BUFFER_PAGES);
    for (const [vi, node] of this.els) {
      if (vi < first || vi > last) { node.remove(); this.els.delete(vi); }
    }
    const left = this.pageLeft;
    for (let vi = first; vi <= last; vi++) this.paintPage(vi, left);
    this.paintOverlays(first, last, left);
    this.lastFrameMs = performance.now() - t0;
    if (this.onFrame) this.onFrame();
  }

  /** Force a full repaint (zoom, theme, settings). */
  invalidate() {
    for (const node of this.els.values()) node.remove();
    this.els.clear();
    if (this.titleEl) { this.titleEl.remove(); this.titleEl = null; }
    this.layoutDirty = true;
    this.schedule();
  }

  paintPage(vi, left) {
    if (this.showTitle && vi === 0) return this.paintTitle(left);
    const pi = vi - this.offset;
    const page = this.pages[pi];
    const blocks = this.editor.blocks;
    let sig = `${pi}|${page.more}|${page.cont}|${this.z}|${left}|`;
    const times = this.sceneTimes();
    for (const it of page.items) {
      sig += `${ver(blocks[it.bi])}.${it.l0}.${it.l1}.${it.y}.${it.bi},`;
      const tc = times.get(blocks[it.bi].id);
      if (tc) sig += `${tc.t}.${tc.tag},`;
    }
    if (this.activeComment) sig += '|' + this.activeComment;
    let node = this.els.get(vi);
    if (node && node._sig === sig) return;
    if (!node) {
      node = el('div', 'page');
      this.content.appendChild(node);
      this.els.set(vi, node);
    }
    node._sig = sig;
    node._vi = vi;
    const s = node.style;
    s.left = left + 'px';
    s.top = this.pageTop(vi) + 'px';
    s.width = this.PW + 'px';
    s.height = this.PH + 'px';
    s.fontSize = this.row + 'px';
    node.innerHTML = this.pageHTML(page, pi, blocks, times);
  }

  /** The scenes' own timecodes (core/timeline.js), shown beside their headings: by block id. */
  sceneTimes() {
    const tcs = this.doc && this.doc.timecodes;
    if (!tcs || !tcs.length) return NONE;
    const c = this._times;
    if (c && c.tcs === tcs && c.rev === this.editor.rev && c.pages === this.pages) return c.map;
    this._times = { tcs, rev: this.editor.rev, pages: this.pages, map: sceneTimecodes(tcs, this.editor.blocks, this.pages) };
    return this._times.map;
  }

  pageHTML(page, pi, blocks, times = NONE) {
    const { row } = this;
    const top = PAGE.topRows;
    let h = '';
    if (pi > 0) {
      const label = `${pi + 1}.`;
      h += `<div class="pn" style="left:${this.xAt(PAGE.numberCol - label.length, 0)}px;top:${PAGE.numberRow * row}px">${label}</div>`;
    }
    if (page.cont) h += `<div class="l" style="left:${this.xAt(ELEMENT.character.left, 0)}px;top:${top * row}px">${esc(page.cont)}</div>`;
    const ticks = new Set();
    for (const it of page.items) {
      const b = blocks[it.bi];
      const starts = linesOf(b);
      for (let l = it.l0; l < it.l1; l++) {
        const y = (top + it.y + l - it.l0) * row;
        const x0 = lineX(b, starts, l);
        const txt = lineText(b.text, starts, l);
        const gaps = lineGaps(b, starts, l);
        if (txt) h += `<div class="l" style="left:${x0 * this.col}px;top:${y}px">${styledLine(b, starts[l], txt, gaps)}</div>`;
        const tc = l === 0 && times.get(b.id);
        if (tc) h += `<div class="sctc" style="left:${this.xAt(x0, colIn(gaps, txt.length) + 2)}px;top:${y}px" title="Scene timecode (right-click the scene on the timeline to change it)">${formatTime(tc.t)}${tc.tag ? ` · ${esc(tc.tag)}` : ''}</div>`;
        if (!b.marks.length) continue;
        const ls = starts[l], le = ls + txt.length;
        for (const m of b.marks) {
          const a = Math.max(m.s, ls), z = Math.min(m.e, le);
          if (z <= a) continue;
          const x = this.xAt(x0, colIn(gaps, a - ls)), w = (colIn(gaps, z - ls) - colIn(gaps, a - ls)) * this.cw;
          if (m.k === 'hl') h += `<div class="mk hl-${m.v}" style="left:${x}px;top:${y}px;width:${w}px;height:${row}px"></div>`;
          else if (m.k === 'cm') {
            h += `<div class="mk cm" style="left:${x}px;top:${y}px;width:${w}px;height:${row}px"></div>`;
            if (!ticks.has(m.v)) {
              ticks.add(m.v);
              const cur = m.v === this.activeComment ? ' cur' : '';
              h += `<div class="mk cmtick${cur}" data-c="${esc(m.v)}" style="left:${this.xAt(PAGE.rightCol + 3, 0)}px;top:${y}px;height:${row}px" title="Note"></div>`;
            }
          }
        }
      }
    }
    if (page.more >= 0) h += `<div class="l" style="left:${this.xAt(ELEMENT.character.left, 0)}px;top:${(top + page.more) * row}px">(MORE)</div>`;
    return h;
  }

  paintTitle(left) {
    let node = this.els.get(0);
    if (node && node._z === this.z && node._left === left) return;
    if (!node) {
      node = this.titleEl || this.buildTitle();
      this.titleEl = node;
      this.content.appendChild(node);
      this.els.set(0, node);
    }
    node._z = this.z; node._left = left;
    Object.assign(node.style, { left: left + 'px', top: this.pageTop(0) + 'px', width: this.PW + 'px', height: this.PH + 'px', fontSize: this.row + 'px' });
    for (const f of node.querySelectorAll('.tp-f')) {
      const spec = TITLE_FIELDS.find((t) => t.key === f.dataset.k);
      Object.assign(f.style, {
        left: spec.col * this.col + 'px', top: spec.row * this.row + 'px', width: spec.w * this.cw + 'px',
        height: (spec.rows || 1) * this.row + 'px', fontSize: this.row + 'px', lineHeight: this.row + 'px',
      });
    }
    const tag = node.querySelector('.tp-tag');
    Object.assign(tag.style, { left: PAGE.leftCol * this.col + 'px', top: 2 * this.row + 'px' });
  }

  buildTitle() {
    const node = el('div', 'page title-page');
    node._vi = 0;
    const tag = el('div', 'tp-tag');
    tag.textContent = 'TITLE PAGE — EMPTY FIELDS ARE NOT PRINTED';
    node.appendChild(tag);
    for (const spec of TITLE_FIELDS) {
      const f = document.createElement(spec.rows ? 'textarea' : 'input');
      f.className = 'tp-f' + (spec.align ? ' ' + spec.align : '');
      f.dataset.k = spec.key;
      f.placeholder = spec.ph;
      f.spellcheck = false;
      if (spec.rows) f.rows = spec.rows;
      f.value = this.doc.titlePage[spec.key] || '';
      f.addEventListener('input', () => {
        if (spec.rows) {
          const lines = f.value.split('\n');
          if (lines.length > spec.rows) f.value = lines.slice(0, spec.rows).join('\n');
        }
        this.doc.titlePage[spec.key] = f.value;
        if (this.onTitleInput) this.onTitleInput(spec.key);
      });
      node.appendChild(f);
    }
    return node;
  }

  refreshTitleFields() {
    if (!this.titleEl) return;
    for (const f of this.titleEl.querySelectorAll('.tp-f')) f.value = this.doc.titlePage[f.dataset.k] || '';
  }

  // ---- overlays ------------------------------------------------------------------

  paintOverlays(first, last, left) {
    const ed = this.editor;
    const blocks = ed.blocks;
    let selHTML = '';
    let findHTML = '';
    let revHTML = '';
    const rm = this.revision && this.revision.marks;
    const [s, e] = ed.ordered();
    const hasSel = cmp(s, e) !== 0;
    const fm = this.find && this.find.matches;
    for (let vi = Math.max(first, this.offset); vi <= last; vi++) {
      const pi = vi - this.offset;
      const page = this.pages[pi];
      const ptop = this.pageTop(vi) + PAGE.topRows * this.row;
      for (const it of page.items) {
        const inSel = hasSel && it.bi >= s.b && it.bi <= e.b;
        let fk = -1;
        if (fm && fm.length) fk = firstMatch(fm, it.bi);
        const hasFind = fk !== -1 && fm[fk].b === it.bi;
        let rk = -1;
        if (rm && rm.length) rk = firstMatch(rm, it.bi);
        const hasRev = rk !== -1 && rm[rk].b === it.bi;
        if (!inSel && !hasFind && !hasRev) continue;
        const b = blocks[it.bi];
        const starts = linesOf(b);
        for (let l = it.l0; l < it.l1; l++) {
          const ls = starts[l];
          const le = lineEndOffset(b.text, starts, l);
          const x0 = lineX(b, starts, l);
          const gaps = lineGaps(b, starts, l);
          const cx = (k) => this.xAt(x0, colIn(gaps, k - ls)); // page x of offset k on this line
          const y = ptop + (it.y + l - it.l0) * this.row;
          if (inSel) {
            const a = it.bi === s.b ? Math.max(ls, s.o) : ls;
            const z = it.bi === e.b ? Math.min(le, e.o) : le;
            const extend = (it.bi < e.b && (l === starts.length - 1 || z === le)) || (it.bi === e.b && e.o > le);
            if (z > a || (extend && a <= le && (it.bi > s.b || s.o <= le))) {
              const w = Math.max(0, cx(z) - cx(a)) + (extend ? this.cw * 0.6 : 0);
              selHTML += `<div class="selr" style="left:${left + cx(a)}px;top:${y}px;width:${w}px;height:${this.row}px"></div>`;
            }
          }
          if (hasFind) {
            for (let k = fk; k < fm.length && fm[k].b === it.bi; k++) {
              const m = fm[k];
              const a = Math.max(m.s, ls), z = Math.min(m.e, le === b.text.length ? le : le + 1);
              if (z <= a) continue;
              const cur = k === this.find.cur ? ' cur' : '';
              findHTML += `<div class="findr${cur}" style="left:${left + cx(a)}px;top:${y}px;width:${cx(z) - cx(a)}px;height:${this.row}px"></div>`;
            }
          }
          if (hasRev) {
            for (let k = rk; k < rm.length && rm[k].b === it.bi; k++) {
              const m = rm[k];
              const a = Math.max(m.s, ls), z = Math.min(m.e, le === b.text.length ? le : le + 1);
              if (z <= a) continue;
              revHTML += `<div class="revr r-${m.cat}${m.cur ? ' cur' : ''}${m.hov ? ' hov' : ''}" style="left:${left + cx(a)}px;top:${y}px;width:${cx(z) - cx(a)}px;height:${this.row}px"></div>`;
            }
          }
        }
      }
    }
    if (this.selLayer._h !== selHTML) { this.selLayer.innerHTML = selHTML; this.selLayer._h = selHTML; }
    if (this.findLayer._h !== findHTML) { this.findLayer.innerHTML = findHTML; this.findLayer._h = findHTML; }
    if (this.revLayer._h !== revHTML) { this.revLayer.innerHTML = revHTML; this.revLayer._h = revHTML; }
    this.paintCaret(left);
  }

  caretRect(p = this.editor.caret) {
    const blocks = this.editor.blocks;
    const b = blocks[p.b];
    if (!b) return null;
    const starts = linesOf(b);
    const li = lineIndexOf(starts, p.o);
    const pi = pageOf(this.pages, p.b, li);
    const page = this.pages[pi];
    if (!page) return null;
    let r = rowOf(page, p.b, li);
    if (r < 0) r = 0;
    const vi = pi + this.offset;
    const x = this.pageLeft + this.xAt(lineX(b, starts, li), colIn(lineGaps(b, starts, li), p.o - starts[li]));
    const y = this.pageTop(vi) + (PAGE.topRows + r) * this.row;
    return { x, y, h: this.row, page: pi };
  }

  paintCaret() {
    const c = this.caretEl;
    const r = this.caretRect();
    this.paintGhost(r);
    if (!r || this.editor.hasSelection() || !this.focused) { c.style.display = 'none'; return; }
    c.style.display = '';
    const key = `${r.x},${r.y},${r.h},${devicePixelRatio}`;
    if (c._k !== key) {
      c._k = key;
      // The caret sits in the gap *after* the glyph boundary, never over the
      // preceding glyph, and is snapped to whole device pixels so it stays crisp.
      const dpr = devicePixelRatio || 1;
      const origin = this.content.getBoundingClientRect().left;
      const devLeft = Math.ceil((origin + r.x) * dpr - 0.01);
      const devWidth = Math.max(1, Math.round(1.5 * dpr * Math.min(1.5, this.z)));
      c.style.left = devLeft / dpr - origin + 'px';
      c.style.width = devWidth / dpr + 'px';
      c.style.top = r.y + 'px';
      c.style.height = r.h + 'px';
      // Restart the blink (solid while typing) by alternating two identical
      // animations — no forced reflow needed.
      c.classList.toggle('blink-a');
      c.classList.toggle('blink-b', !c.classList.contains('blink-a'));
    }
  }

  setGhost(g) {
    this.ghost = g;
    this.paintGhost(this.caretRect());
  }

  paintGhost(r) {
    const g = this.ghost, n = this.ghostEl, p = this.editor.caret;
    const text = g && r && this.focused && !this.editor.hasSelection() && p.b === g.b && p.o === g.o ? g.text : '';
    const key = text && `${text}|${r.x},${r.y},${this.row}`;
    if (n._k === key) return;
    n._k = key;
    n.textContent = text;
    n.style.display = text ? '' : 'none';
    if (text) Object.assign(n.style, { left: r.x + 'px', top: r.y + 'px', fontSize: this.row + 'px', height: this.row + 'px' });
  }

  // ---- hit testing & scrolling ---------------------------------------------------------

  /** Content coordinates for a client point. */
  toContent(clientX, clientY) {
    const r = this.scroller.getBoundingClientRect();
    return { x: clientX - r.left + this.scroller.scrollLeft, y: clientY - r.top + this.scroller.scrollTop };
  }

  /** Document position nearest to a client point (title page maps to document start). */
  posAt(clientX, clientY) {
    const { x, y } = this.toContent(clientX, clientY);
    const span = this.PH + this.gap;
    let vi = Math.floor((y - PAD) / span);
    vi = Math.max(this.offset, Math.min(this.viewCount - 1, vi));
    const pi = vi - this.offset;
    const page = this.pages[pi];
    const row = Math.floor((y - this.pageTop(vi)) / this.row) - PAGE.topRows;
    const px = x - this.pageLeft;
    const blocks = this.editor.blocks;
    if (!page.items.length) return pos(Math.min(page.startBi, blocks.length - 1), 0);
    let best = page.items[0];
    if (row < best.y) return pos(best.bi, linesOf(blocks[best.bi])[best.l0]);
    for (const it of page.items) {
      if (row >= it.y) best = it;
      if (row < it.y + it.l1 - it.l0) break;
    }
    const b = blocks[best.bi];
    const starts = linesOf(b);
    const l = Math.min(best.l1 - 1, best.l0 + Math.max(0, row - best.y));
    if (row >= best.y + best.l1 - best.l0) {
      // Below the item (blank space): end of its last line on this page.
      return pos(best.bi, lineEndOffset(b.text, starts, best.l1 - 1));
    }
    const x0 = lineX(b, starts, l) * this.col;
    const o = starts[l] + offsetAtCol(lineGaps(b, starts, l), (px - x0) / this.cw, lineEndOffset(b.text, starts, l) - starts[l]);
    return pos(best.bi, Math.min(o, lineEndOffset(b.text, starts, l)));
  }

  /** Scroll so the caret is visible with some margin (`center`: in the middle). */
  revealCaret(center = false) {
    const r = this.caretRect();
    if (!r) return;
    this.stopGlide(); // an explicit scroll wins over a glide under way
    const sc = this.scroller;
    const margin = this.row * 4;
    if (center) { sc.scrollTop = r.y - sc.clientHeight / 2; return; }
    if (r.y < sc.scrollTop + margin) sc.scrollTop = r.y - margin;
    else if (r.y + r.h > sc.scrollTop + sc.clientHeight - margin) sc.scrollTop = r.y + r.h - sc.clientHeight + margin;
    const lx = r.x - sc.scrollLeft;
    if (lx < 20 || lx > sc.clientWidth - 20) sc.scrollLeft = r.x - sc.clientWidth / 2;
  }

  /**
   * Glide so the passage from `a` to `b` sits in the middle of the view (as near as the
   * ends of the script allow), whether or not it is already on screen. STET moves the
   * scroll itself, frame by frame, recomputing where the passage is each time (pages
   * drawn as they come into view never knock it off course), and it always ends exactly
   * there: with no frames at all (a hidden window) it is put there when the time is up.
   * A wheel or a press on the script takes over at once; reduced motion goes straight there.
   * With `top`, the passage goes to the top of the view instead (a scene: its heading, with the
   * blank line before it and one more above), as far as the end of the script allows.
   */
  glideTo(a, b = a, { top = false } = {}) {
    const sc = this.scroller;
    this.stopGlide();
    const goal = () => {
      const r0 = this.caretRect(a), r1 = this.caretRect(b);
      if (!r0) return sc.scrollTop;
      const mid = r1 && r1.y >= r0.y ? (r0.y + r1.y + r1.h) / 2 : r0.y + r0.h / 2;
      // At the top: the target with the blank rows above it, and never a line of the text before it.
      const want = top ? r0.y - this.blankAbove(a) * this.row : mid - sc.clientHeight / 2;
      return Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, top ? Math.ceil(want) : Math.round(want)));
    };
    const r = this.caretRect(a);
    if (r) { const lx = r.x - sc.scrollLeft; if (lx < 20 || lx > sc.clientWidth - 20) sc.scrollLeft = r.x - sc.clientWidth / 2; }
    if (reducedMotion()) { sc.scrollTop = goal(); return; }
    const from = sc.scrollTop, t0 = performance.now();
    const dur = Math.min(700, 280 + Math.abs(goal() - from) / 10);
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const g = this.glide = {};
    const step = () => {
      if (this.glide !== g) return;
      const k = Math.min(1, (performance.now() - t0) / dur);
      sc.scrollTop = from + (goal() - from) * ease(k);
      if (k < 1) g.raf = requestAnimationFrame(step); else this.stopGlide();
    };
    const takeOver = () => this.stopGlide();
    sc.addEventListener('wheel', takeOver, { passive: true });
    sc.addEventListener('pointerdown', takeOver);
    g.off = () => { sc.removeEventListener('wheel', takeOver); sc.removeEventListener('pointerdown', takeOver); };
    g.timer = setTimeout(() => { if (this.glide === g) { sc.scrollTop = goal(); this.stopGlide(); } }, dur + 200);
    g.raf = requestAnimationFrame(step);
  }

  /**
   * Empty rows just above position p on its page (at most 2): the space before a scene heading.
   * At the top of a page, one row of the top margin.
   */
  blankAbove(p) {
    const b = this.editor.blocks[p.b];
    if (!b) return 0;
    const li = lineIndexOf(linesOf(b), p.o);
    const page = this.pages[pageOf(this.pages, p.b, li)];
    if (!page) return 0;
    const r = rowOf(page, p.b, li);
    if (r < 0) return 0;
    let above = page.cont ? 1 : 0;
    for (const it of page.items) {
      const end = it.y + it.l1 - it.l0;
      if (end <= r && end > above) above = end;
    }
    return r === 0 ? 1 : Math.min(2, r - above);
  }

  stopGlide() {
    const g = this.glide;
    if (!g) return;
    this.glide = null;
    cancelAnimationFrame(g.raf);
    clearTimeout(g.timer);
    g.off();
  }

  scrollToPage(pi) {
    this.scroller.scrollTop = this.pageTop(pi + this.offset) - 8;
  }

  /** Set zoom, keeping the content point under `anchorClientY` (or the caret) fixed. */
  setZoom(z, anchorClientY) {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
    if (z === this.z) return;
    const sc = this.scroller;
    const rect = sc.getBoundingClientRect();
    const caret = this.caretRect();
    const anchorY = anchorClientY != null ? anchorClientY - rect.top
      : caret && caret.y >= sc.scrollTop && caret.y <= sc.scrollTop + sc.clientHeight ? caret.y - sc.scrollTop : sc.clientHeight / 2;
    const docY = (sc.scrollTop + anchorY - PAD) / this.z;
    this.z = z;
    this.measure();
    this.invalidate();
    const h = this.pageTop(this.viewCount) + PAD;
    this.content.style.height = h + 'px';
    this.content.style.width = Math.max(sc.clientWidth, this.PW + PAD * 2) + 'px';
    sc.scrollTop = docY * z + PAD - anchorY;
    this.frame();
  }

  currentPage() {
    const r = this.caretRect();
    return r ? r.page : 0;
  }
}

function firstMatch(ms, bi) {
  let lo = 0, hi = ms.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ms[mid].b < bi) lo = mid + 1; else hi = mid; }
  return lo < ms.length ? lo : -1;
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}
