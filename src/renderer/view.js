// Page view: virtualised rendering of paginated screenplay pages.
//
// Only pages intersecting the viewport (plus one either side) exist in the
// DOM. A page is repainted only when its content signature changes, so a
// keystroke repaints exactly one page (two if it pushes a line across a break).
// Caret, selection and find results are thin overlay layers positioned with
// grid arithmetic — no text measurement after the initial glyph-width probe.

import { PAGE, ELEMENT, lineText, lineX } from '../core/format.js';
import { linesOf, paginate, pageOf, rowOf } from '../core/layout.js';
import { lineIndexOf, lineEndOffset } from '../core/nav.js';
import { cmp, pos } from '../core/editor.js';
import { TITLE_FIELDS_SPEC } from '../core/titlepage.js';

const PX_COL = 9.6;   // 0.1in at 96dpi
const PX_ROW = 16;    // 1/6in at 96dpi (Courier 12pt line)
const PAD = 28;
const GAP = 22;
const BUFFER_PAGES = 1;

const versions = new WeakMap();
let versionSeq = 0;
function ver(block) {
  let v = versions.get(block);
  if (v === undefined) { v = ++versionSeq; versions.set(block, v); }
  return v;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    this.caretEl = el('div', '');
    this.caretEl.id = 'caret';
    content.append(this.findLayer, this.selLayer, this.caretEl);
    this.titleEl = null;

    scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => { this.layoutDirty = true; this.schedule(); }).observe(scroller);
    this.layoutDirty = true;
    this.relayout();
  }

  // ---- geometry ----------------------------------------------------------------

  measure() {
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${PX_ROW * this.z}px "Courier New", Courier, monospace`;
    this.cw = c.measureText('M'.repeat(100)).width / 100;
    this.col = PX_COL * this.z;
    this.row = PX_ROW * this.z;
    this.PW = PAGE.cols * this.col;
    this.PH = PAGE.rows * this.row;
    this.gap = GAP * this.z;
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
    for (const it of page.items) sig += `${ver(blocks[it.bi])}.${it.l0}.${it.l1}.${it.y}.${it.bi},`;
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
    node.innerHTML = this.pageHTML(page, pi, blocks);
  }

  pageHTML(page, pi, blocks) {
    const { row } = this;
    const top = PAGE.topRows;
    let h = '';
    if (pi > 0) {
      const label = `${pi + 1}.`;
      h += `<div class="pn" style="left:${this.xAt(PAGE.rightCol - label.length, 0)}px;top:${PAGE.numberRow * row}px">${label}</div>`;
    }
    if (page.cont) h += `<div class="l" style="left:${this.xAt(ELEMENT.character.left, 0)}px;top:${top * row}px">${esc(page.cont)}</div>`;
    const ticks = new Set();
    for (const it of page.items) {
      const b = blocks[it.bi];
      const starts = linesOf(b);
      for (let l = it.l0; l < it.l1; l++) {
        const y = (top + it.y + l - it.l0) * row;
        const x0 = lineX(b.type, b.text, starts, l);
        const txt = lineText(b.text, starts, l);
        if (txt) h += `<div class="l" style="left:${x0 * this.col}px;top:${y}px">${esc(txt)}</div>`;
        if (!b.marks.length) continue;
        const ls = starts[l], le = ls + txt.length;
        for (const m of b.marks) {
          const a = Math.max(m.s, ls), z = Math.min(m.e, le);
          if (z <= a) continue;
          const x = this.xAt(x0, a - ls), w = (z - a) * this.cw;
          if (m.k === 'hl') h += `<div class="mk hl-${m.v}" style="left:${x}px;top:${y}px;width:${w}px;height:${row}px"></div>`;
          else {
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
        left: spec.col * this.col + 'px', top: spec.row * this.row + 'px', width: spec.w * this.col + 'px',
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
        if (!inSel && !hasFind) continue;
        const b = blocks[it.bi];
        const starts = linesOf(b);
        for (let l = it.l0; l < it.l1; l++) {
          const ls = starts[l];
          const le = lineEndOffset(b.text, starts, l);
          const x0 = lineX(b.type, b.text, starts, l);
          const y = ptop + (it.y + l - it.l0) * this.row;
          if (inSel) {
            const a = it.bi === s.b ? Math.max(ls, s.o) : ls;
            const z = it.bi === e.b ? Math.min(le, e.o) : le;
            const extend = (it.bi < e.b && (l === starts.length - 1 || z === le)) || (it.bi === e.b && e.o > le);
            if (z > a || (extend && a <= le && (it.bi > s.b || s.o <= le))) {
              const w = Math.max(0, z - a) * this.cw + (extend ? this.cw * 0.6 : 0);
              selHTML += `<div class="selr" style="left:${left + this.xAt(x0, a - ls)}px;top:${y}px;width:${w}px;height:${this.row}px"></div>`;
            }
          }
          if (hasFind) {
            for (let k = fk; k < fm.length && fm[k].b === it.bi; k++) {
              const m = fm[k];
              const a = Math.max(m.s, ls), z = Math.min(m.e, le === b.text.length ? le : le + 1);
              if (z <= a) continue;
              const cur = k === this.find.cur ? ' cur' : '';
              findHTML += `<div class="findr${cur}" style="left:${left + this.xAt(x0, a - ls)}px;top:${y}px;width:${(z - a) * this.cw}px;height:${this.row}px"></div>`;
            }
          }
        }
      }
    }
    if (this.selLayer._h !== selHTML) { this.selLayer.innerHTML = selHTML; this.selLayer._h = selHTML; }
    if (this.findLayer._h !== findHTML) { this.findLayer.innerHTML = findHTML; this.findLayer._h = findHTML; }
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
    const x = this.pageLeft + this.xAt(lineX(b.type, b.text, starts, li), p.o - starts[li]);
    const y = this.pageTop(vi) + (PAGE.topRows + r) * this.row;
    return { x, y, h: this.row, page: pi };
  }

  paintCaret() {
    const c = this.caretEl;
    const r = this.caretRect();
    if (!r || this.editor.hasSelection() || !this.focused) { c.style.display = 'none'; return; }
    c.style.display = '';
    const key = `${r.x},${r.y},${r.h}`;
    if (c._k !== key) {
      c._k = key;
      c.style.left = r.x - 1 + 'px';
      c.style.top = r.y + 'px';
      c.style.height = r.h + 'px';
      // Restart the blink so the caret is solid while typing.
      c.classList.remove('blink');
      void c.offsetWidth;
      c.classList.add('blink');
    }
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
    const x0 = lineX(b.type, b.text, starts, l) * this.col;
    const o = starts[l] + Math.max(0, Math.round((px - x0) / this.cw));
    return pos(best.bi, Math.min(o, lineEndOffset(b.text, starts, l)));
  }

  /** Scroll so the caret is visible with some margin. */
  revealCaret(center = false) {
    const r = this.caretRect();
    if (!r) return;
    const sc = this.scroller;
    const margin = this.row * 4;
    if (center) { sc.scrollTop = r.y - sc.clientHeight / 2; return; }
    if (r.y < sc.scrollTop + margin) sc.scrollTop = r.y - margin;
    else if (r.y + r.h > sc.scrollTop + sc.clientHeight - margin) sc.scrollTop = r.y + r.h - sc.clientHeight + margin;
    const lx = r.x - sc.scrollLeft;
    if (lx < 20 || lx > sc.clientWidth - 20) sc.scrollLeft = r.x - sc.clientWidth / 2;
  }

  scrollToPage(pi) {
    this.scroller.scrollTop = this.pageTop(pi + this.offset) - 8;
  }

  /** Set zoom, keeping the content point under `anchorClientY` (or the caret) fixed. */
  setZoom(z, anchorClientY) {
    z = Math.max(0.5, Math.min(3, Math.round(z * 100) / 100));
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
