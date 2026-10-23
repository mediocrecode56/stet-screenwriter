// The timeline bar under the toolbar (View > Timeline): the script from left to right, a tick
// for each scene, the highlights in their colours, the notes, and a time ruler that counts a
// minute a page until timecodes are pinned to it (right-click). Clicking goes there; dragging
// sideways zooms, dragging the band moves the window, and moving with Ctrl held steps second by second
// (a right-click then pins a timecode at that second).

import { pos } from '../core/editor.js';
import { linesOf } from '../core/layout.js';
import { timelineOf, anchorsOf, timeScale, scriptPos, placeAt, formatTime, rulerLabel, parseTime, rulerStep, minorStep, snapTo, fineTime, makeTimecode } from '../core/timeline.js';
import { HIGHLIGHT_COLORS } from '../core/model.js';
import { h, esc } from './ui/dialog.js';
import { menuAt } from './ui/commands.js';

const PPP_MAX = 6000; // most pixels a page: about 100 a second at a minute a page
const PADX = 14; // room at either end of the strip (style.css .tl-inner)
const SNAP_PX = 6; // how near a scene, note, highlight or timecode draws the pointer to it
const FINE_PX = 8; // fewest pixels a second with Ctrl held
const RESET_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.6 5.2A5 5 0 1 1 2 7.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.2 1.8v4h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TRASH_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M4.5 3V1.8h3V3M3 3l.6 7.2h4.8L9 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const NOTE_ICON = '<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M0.5 0.5h8v5.5H4L1.8 8.2V6H0.5z" fill="currentColor"/></svg>';

export class Timeline {
  constructor(host, { editor, view, session, jump, openNote, onToggle }) {
    this.host = host;
    this.ed = editor; this.view = view; this.session = session;
    this.jump = jump; this.openNote = openNote; this.onToggle = onToggle;
    this.ppp = 0; // pixels a page; 0 fits the whole script in the bar
    this.drawn = 1; // pixels a page as last painted
    this.bandA = this.bandB = 0; // the part of the script in the window
    this.key = '';
    host.innerHTML = '<div class="tl-scroll"><div class="tl-inner"><div class="tl-view"></div><div class="tl-grid"></div><div class="tl-marks"></div><div class="tl-ruler"></div>'
      + '<div class="tl-hover" hidden><span></span></div><div class="tl-head"></div></div></div>'
      + `<button class="tl-reset" hidden title="Whole script (double-click the ruler)" aria-label="Whole script">${RESET_ICON}</button>`;
    this.scroll = host.querySelector('.tl-scroll');
    this.inner = host.querySelector('.tl-inner');
    this.grid = host.querySelector('.tl-grid');
    this.marks = host.querySelector('.tl-marks');
    this.ruler = host.querySelector('.tl-ruler');
    this.hover = host.querySelector('.tl-hover');
    this.head = host.querySelector('.tl-head');
    this.band = host.querySelector('.tl-view');
    this.reset = host.querySelector('.tl-reset');
    this.reset.addEventListener('click', () => { this.ppp = 0; this.update(true); });
    this.targets = []; // what the pointer is drawn to: { x, kind, el, ... }

    // One gesture: a click goes there (drawn to a scene, note or highlight close by); a drag
    // sideways zooms around the point pressed (right to zoom in); a drag of the band (the part of
    // the script in the window) moves the window over the script. With Ctrl held, see fine().
    this.inner.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return this.fine(e);
      const x0 = e.clientX, y0 = e.clientY;
      const where = this.zone(e);
      const at0 = this.posAt(x0), ppp0 = this.drawn, top0 = this.view.scroller.scrollTop;
      const px0 = x0 - this.scroll.getBoundingClientRect().left;
      const near = this.snap(at0);
      let mode = null; // set by the first real movement
      const move = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!mode) {
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          mode = where;
          document.body.classList.add('tl-dragging', 'tl-drag-' + mode);
          this.hover.hidden = true;
        }
        if (mode === 'zoom') this.setScale(ppp0 * 2 ** (dx / 50), at0, px0);
        else { const v = this.view; v.scroller.scrollTop = top0 + (dx / ppp0) * (v.pageTop(1) - v.pageTop(0)); }
      };
      const up = () => {
        removeEventListener('mousemove', move, true);
        removeEventListener('mouseup', up, true);
        document.body.classList.remove('tl-dragging', 'tl-drag-zoom', 'tl-drag-band');
        if (mode) return;
        const note = e.target.closest('.tl-note') ? this.tl.notes[+e.target.closest('.tl-note').dataset.i] : near && near.kind === 'note' ? near : null;
        if (note) return this.openNote(note.id, note.b, note.s, note.e);
        if (near && near.kind === 'scene') return this.jump(pos(near.b, 0), false, null, 'top'); // to its heading
        this.go(near ? near.x : at0);
      };
      addEventListener('mousemove', move, true);
      addEventListener('mouseup', up, true);
    });
    // Double-click on the ruler or the band: the whole script, as in Ableton.
    this.inner.addEventListener('dblclick', (e) => { if (this.zone(e) !== 'zoom' || e.clientY >= this.inner.getBoundingClientRect().bottom - 15) { this.ppp = 0; this.update(true); } });
    this.inner.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(e); });
    this.inner.addEventListener('mousemove', (e) => {
      if (document.body.classList.contains('tl-dragging')) return;
      if (e.ctrlKey || e.metaKey) return this.fine(e);
      this.endFine();
      this.showHover(e);
    });
    this.inner.addEventListener('mouseleave', () => { this.endFine(); this.hover.hidden = true; this.band.classList.remove('hot'); this.mark(null); });
    addEventListener('keyup', (e) => { if (e.key === 'Control' || e.key === 'Meta') this.endFine(); });
    addEventListener('blur', () => this.endFine());
    this.scroll.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoom(2 ** (-Math.max(-200, Math.min(200, e.deltaY)) / 200), e.clientX); // in step with the wheel or a pinch
      else this.scroll.scrollLeft += e.deltaX || e.deltaY;
    }, { passive: false });
    // The ruler and grid are drawn around the part in view; scrolling far draws the next part.
    this.scroll.addEventListener('scroll', () => {
      if (!this.time) return;
      const l = this.scroll.scrollLeft - PADX, w = this.scroll.clientWidth;
      if ((l < this.rulerA && this.rulerA > 0) || (l + w > this.rulerB && this.rulerB < this.length * this.drawn)) this.paintRuler();
    });
    new ResizeObserver(() => { if (this.visible) this.update(true); }).observe(host);
  }

  get visible() { return !this.host.hidden; }

  show(on = !this.visible) {
    if (!on) { this.endFine(); this.closeEditor(); }
    this.host.hidden = !on;
    if (on) this.update(true);
    this.onToggle(on);
  }

  get length() { return Math.max(1, this.view.pages.length); }
  get fit() { return Math.max(1, this.scroll.clientWidth - PADX * 2) / this.length; }
  get scale() { return this.ppp || this.fit; }

  posAt(clientX) {
    return Math.max(0, Math.min(this.length, (clientX - this.inner.getBoundingClientRect().left) / this.drawn));
  }

  /** Go to the line at position x. */
  go(x) {
    const { bi, line } = placeAt(this.view.pages, x);
    const b = this.ed.blocks[bi];
    if (!b) return;
    this.jump(pos(bi, linesOf(b)[line] || 0), false, null, 'top');
  }

  /** Zoom by factor f, keeping the point under clientX where it is. */
  zoom(f, clientX) {
    const r = this.scroll.getBoundingClientRect();
    const px = clientX == null ? r.width / 2 : clientX - r.left;
    this.setScale(this.drawn * f, (this.scroll.scrollLeft + px - PADX) / this.drawn, px);
  }

  /** Draw at `ppp` pixels a page (down to fitting the script), with position `at` at `px` in the bar. */
  setScale(ppp, at, px) {
    ppp = Math.min(PPP_MAX, ppp);
    this.ppp = ppp <= this.fit ? 0 : ppp;
    this.update(true);
    this.scroll.scrollLeft = at * this.drawn + PADX - px;
  }

  /** What a drag from a pointer event does: move the band (above the ruler, on it) or zoom. */
  zone(e) {
    const r = this.inner.getBoundingClientRect();
    if (e.clientY >= r.bottom - 15) return 'zoom';
    const x = this.posAt(e.clientX);
    return x >= this.bandA && x <= this.bandB && this.bandB - this.bandA < this.length * 0.98 ? 'band' : 'zoom';
  }

  /** The scene, note, highlight or timecode close enough to x to draw the pointer to it. */
  snap(x) { return snapTo(this.targets, x, SNAP_PX / this.drawn); }

  /** Light up the mark the pointer is drawn to (null: none). */
  mark(t) {
    const el = t && t.el;
    if (el === this.marked) return;
    if (this.marked) this.marked.classList.remove('near');
    if (el) el.classList.add('near');
    this.marked = el;
  }

  /** Moving over the bar with Ctrl (Cmd) held steps through the script a whole second at a time,
   *  at least FINE_PX pixels a second from where it started, whatever the zoom; the caret and the
   *  window follow, and a right-click pins a timecode at that second. Letting go of Ctrl leaves the
   *  caret there. */
  fine(e) {
    if (!this.time) return;
    let f = this.stepping;
    if (!f) {
      const at = this.posAt(e.clientX), near = this.snap(at);
      const t0 = Math.round(this.time.at(near ? near.x : at));
      const px = Math.max(FINE_PX, (this.time.pos(t0 + 1) - this.time.pos(t0)) * this.drawn);
      f = this.stepping = { x0: e.clientX, t0, px, t: null, x: 0 };
      document.body.classList.add('tl-fine');
      this.hover.classList.add('fine');
      this.band.classList.remove('hot');
      this.mark(null);
    }
    const t = fineTime(f.t0, e.clientX - f.x0, f.px, this.time.at(this.length));
    if (t === f.t) return;
    f.t = t;
    f.x = Math.min(this.length, this.time.pos(t));
    this.scrub(f.x);
    this.readout(f.x, t);
  }

  endFine() {
    if (!this.stepping) return;
    this.stepping = null;
    document.body.classList.remove('tl-fine');
    this.hover.classList.remove('fine');
    this.scrub(null);
  }

  /** Scrubbing: the caret and the window follow at once; null when it lets go. */
  scrub(x) {
    if (x == null) { const c = this.ed.caret; return this.jump(pos(c.b, c.o)); }
    const { bi, line } = placeAt(this.view.pages, x);
    const b = this.ed.blocks[bi];
    if (!b) return;
    const p = pos(bi, linesOf(b)[line] || 0);
    const v = this.view;
    this.ed.setSel(p, p);
    v.stopGlide();
    v.relayout();
    const r = v.caretRect(p);
    if (r) v.scroller.scrollTop = r.y - v.scroller.clientHeight / 3;
    v.frame();
  }

  anchors() { return anchorsOf(this.session.doc.timecodes, this.ed.blocks, this.view.pages); }

  /** Repaint what changed: everything when the script, its timecodes or the zoom did, else just the playhead. */
  update(force = false) {
    if (!this.visible) return;
    const pages = this.view.pages;
    const tcs = this.session.doc.timecodes || [];
    const key = `${this.ed.rev}|${pages.length}|${this.scale}|${tcs.map((t) => t.id + ':' + t.line + ':' + t.t).join(',')}`;
    // Another script, or one laid out to more or fewer pages: at once.
    if (this.session.doc !== this.docSeen) this.closeEditor();
    if (force || this.drawn !== this.scale || this.session.doc !== this.docSeen || pages.length !== this.drawnPages) this.repaint(key);
    else if (key !== this.key || pages !== this.pagesSeen) {
      // While typing, the bar catches up a moment after the last key rather than on every one.
      clearTimeout(this.later);
      this.later = setTimeout(() => { if (this.visible) this.repaint(this.key); }, 150);
      this.key = key;
    }
    const c = this.ed.caret;
    const lines = linesOf(this.ed.blocks[c.b] || { text: '', type: 'action' });
    let l = 0;
    while (l + 1 < lines.length && lines[l + 1] <= c.o) l++;
    const x = scriptPos(pages, c.b, l) * this.drawn;
    this.head.style.left = x + 'px';
    this.showBand();
    // Zoomed in, the bar follows the caret when it leaves the part in view.
    const at = c.b + ':' + l;
    if (at !== this.caretSeen) {
      this.caretSeen = at;
      const sc = this.scroll;
      const cx = x + PADX; // in the strip's scrolled content
      if (cx < sc.scrollLeft || cx > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = cx - sc.clientWidth / 3;
    }
  }

  /** The part of the script in the window, as a soft band. */
  showBand() {
    const v = this.view, sc = v.scroller;
    const top = v.pageTop(0), span = v.pageTop(1) - top;
    const at = (y) => Math.max(0, Math.min(this.length, (y - top) / span - v.offset));
    const a = at(sc.scrollTop), b = at(sc.scrollTop + sc.clientHeight);
    this.bandA = a; this.bandB = b;
    this.band.style.left = a * this.drawn + 'px';
    this.band.style.width = Math.max(2, (b - a) * this.drawn) + 'px';
  }

  repaint(key) {
    clearTimeout(this.later);
    this.key = key;
    this.pagesSeen = this.view.pages;
    this.docSeen = this.session.doc;
    this.drawnPages = this.view.pages.length;
    this.paint();
  }

  paint() {
    const s = this.drawn = this.scale, len = this.length; // positions are read back at the scale they were drawn
    const w = Math.max(this.scroll.clientWidth - PADX * 2, len * s);
    this.inner.style.width = w + 'px';
    const tl = this.tl = timelineOf(this.ed.blocks, this.view.pages);
    const anchors = this.anchors();
    this.time = timeScale(anchors);

    this.anchorsDrawn = anchors;
    this.paintRuler();
    this.reset.hidden = !this.ppp;

    // The script as a line, coloured where it is highlighted; a quiet tick for each scene; the notes under the line.
    let m = `<div class="tl-line" style="width:${len * s}px"></div>`;
    for (const hl of tl.highlights) m += `<div class="tl-hl hl-${hl.color}" style="left:${hl.x0 * s}px;width:${Math.max(3, (hl.x1 - hl.x0) * s)}px"></div>`;
    for (const sc of tl.scenes) m += `<div class="tl-scene" data-b="${sc.b}" style="left:${sc.x * s}px"></div>`;
    tl.notes.forEach((n, i) => { m += `<div class="tl-note" data-i="${i}" style="left:${n.x * s}px">${NOTE_ICON}</div>`; });
    for (const a of anchors) m += `<div class="tl-tcm${a.color ? ' c-' + a.color : ''}" style="left:${a.x * s}px"></div>`;
    this.marks.innerHTML = m;
    const els = this.marks.children; // in the order drawn: the line, the highlights, the scenes, the notes, the timecodes
    const nh = tl.highlights.length, ns = tl.scenes.length, nn = tl.notes.length;
    this.targets = [
      ...tl.highlights.map((h, i) => ({ x: h.x0, kind: 'hl', el: els[1 + i] })),
      ...tl.scenes.map((sc, i) => ({ ...sc, kind: 'scene', el: els[1 + nh + i] })),
      ...tl.notes.map((n, i) => ({ ...n, kind: 'note', el: els[1 + nh + ns + i] })),
      ...anchors.map((a, i) => ({ ...a, kind: 'tc', el: els[1 + nh + ns + nn + i] })),
    ];
    this.marked = null;
    this.showEditing();
  }

  /** The ruler and the grid, for the part of the bar in view and a screen either side. */
  paintRuler() {
    const s = this.drawn, len = this.length, time = this.time, anchors = this.anchorsDrawn, total = time.at(len);
    const w = this.scroll.clientWidth, l = this.scroll.scrollLeft - PADX;
    const a = this.rulerA = Math.max(0, l - w), b = this.rulerB = Math.min(len * s, l + 2 * w);
    // A label every so often, well apart; the grid (a faint line at each, shown while the pointer
    // is on the bar) carries the finer steps.
    const pxPerSec = s / time.pace; // after the last timecode; close enough before it to space the labels
    const step = rulerStep(pxPerSec, 110), minor = minorStep(step, pxPerSec, 18), inc = minor || step;
    let ruler = '', grid = '';
    for (let t = Math.floor(time.at(a / s) / inc) * inc; t <= total + 0.5; t += inc) {
      const x = time.pos(t) * s;
      if (x > b + 0.5) break;
      const major = Math.round(t) % step === 0;
      if (t) grid += `<i${major ? ' class="mj"' : ''} style="left:${x}px"></i>`;
      // A pinned timecode is labelled in its own place; the regular labels give way around it.
      if (major && x <= len * s - 70 && !anchors.some((p) => x > p.x * s - 52 && x < p.x * s + 64 + p.tag.length * 5.5)) ruler += `<span class="tl-lb" style="left:${x}px">${rulerLabel(t)}</span>`;
    }
    // The end of the script: its estimated length.
    ruler += `<span class="tl-lb tl-end" style="left:${len * s}px">${rulerLabel(total)}</span>`;
    for (const p of anchors) ruler += `<span class="tl-lb tl-tc${p.color ? ' c-' + p.color : ''}" style="left:${p.x * s}px">${rulerLabel(p.t)}${p.tag ? `<b>${esc(p.tag)}</b>` : ''}</span>`;
    this.ruler.innerHTML = ruler;
    this.grid.innerHTML = grid;
  }

  /** The time and scene under the pointer, drawn to a mark close by. */
  showHover(e) {
    if (!this.time) return;
    const where = this.zone(e);
    this.band.classList.toggle('hot', where === 'band');
    this.inner.dataset.zone = e.clientY >= this.inner.getBoundingClientRect().bottom - 15 ? 'ruler' : where;
    const at = this.posAt(e.clientX), near = this.snap(at);
    this.mark(near);
    this.readout(near ? near.x : at, null, near);
  }

  /** The line and readout at x: the time (t, or the time there), and the note or scene. */
  readout(x, t = null, near = null) {
    let text = formatTime(t ?? this.time.at(x));
    if (near && near.kind === 'tc' && near.tag) text += '   ' + near.tag;
    else if (near && near.kind === 'note') text += '   ' + ((this.session.doc.comments[near.id] || {}).text || 'Note').replace(/\s+/g, ' ').slice(0, 60);
    else {
      let sc = -1;
      for (let i = 0; i < this.tl.scenes.length && this.tl.scenes[i].x <= x + 1e-9; i++) sc = i;
      if (sc >= 0) text += '   ' + (this.tl.scenes[sc].text || 'SCENE');
    }
    this.hover.hidden = false;
    this.hover.classList.toggle('snap', !!near);
    this.hover.style.left = x * this.drawn + 'px';
    this.hover.firstChild.textContent = text;
    // The readout flips to the left of the line in the right half, so it stays in the bar.
    this.hover.classList.toggle('flip', x * this.drawn - this.scroll.scrollLeft + PADX > this.scroll.clientWidth / 2);
  }

  // ---- timecodes ------------------------------------------------------------------------

  /** A right-click: with Ctrl held, pins a timecode at the second stepped to; on a timecode, edits
   *  it; elsewhere, offers to add one there. */
  menu(e) {
    const f = this.stepping && this.stepping.t != null ? this.stepping : null;
    if (f) return this.pin(f.x, f.t);
    const x = this.posAt(e.clientX);
    const near = this.anchors().find((a) => Math.abs(a.x - x) * this.drawn < SNAP_PX);
    if (near) return this.editTimecode(near.x, near);
    const items = [{ label: 'Add Timecode Here…', run: () => this.editTimecode(x) }];
    if (this.tcs().length) items.push('-', { label: 'Remove All Timecodes', run: () => this.setTimecodes([]) });
    menuAt(e.clientX, e.clientY, items);
  }

  tcs() { return this.session.doc.timecodes || []; }

  setTimecodes(list) {
    this.session.doc.timecodes = list;
    this.session.touch();
    this.update(true);
  }

  /** The line a timecode at x (or an existing one) is pinned to: { b, bi, line, here }. */
  lineAt(x, existing) {
    const { bi, line } = existing ? { bi: this.ed.blocks.findIndex((b) => b.id === existing.id), line: existing.line } : placeAt(this.view.pages, x);
    const b = this.ed.blocks[bi];
    return b ? { b, bi, line, here: scriptPos(this.view.pages, bi, line) } : null;
  }

  /** The timecodes with one at { b, line } set to t (keeping its tag and colour unless given),
   *  or why it doesn't fit there: { list } or { why }. */
  withTimecode({ b, line, here }, t, tag, color) {
    const old = this.tcs().find((tc) => tc.id === b.id && tc.line === line);
    const rest = this.tcs().filter((tc) => tc !== old);
    const tc = makeTimecode(b.id, line, t, tag ?? (old && old.tag), color === undefined ? old && old.color : color);
    const list = [...rest, tc];
    // It has to fall between the timecodes before and after it (and leave them standing).
    const others = anchorsOf(rest, this.ed.blocks, this.view.pages), kept = anchorsOf(list, this.ed.blocks, this.view.pages);
    if (kept.length === others.length + 1 && kept.some((a) => a.id === b.id && a.line === line)) return { list };
    if (here <= 0) return { why: 'The start of the script is always 00:00:00.' };
    const before = [...others].reverse().find((a) => a.x < here), after = others.find((a) => a.x > here);
    return { why: `Has to be after ${before ? formatTime(before.t) : '00:00:00'}${after ? ` and before ${formatTime(after.t)}` : ''}.` };
  }

  /** Pin second t at position x at once (Ctrl + right-click); the editor opens if it doesn't fit. */
  pin(x, t) {
    const at = this.lineAt(x);
    if (!at) return;
    const r = this.withTimecode(at, t);
    if (!r.list) return this.editTimecode(x, null, t, r.why);
    this.setTimecodes(r.list);
    const i = anchorsOf(r.list, this.ed.blocks, this.view.pages).findIndex((a) => a.id === at.b.id && a.line === at.line);
    const el = this.targets.filter((m) => m.kind === 'tc')[i]?.el;
    if (el) el.classList.add('new');
  }

  /** A small editor under the timecode at x (or a new one there): its exact time (Up and Down
   *  nudge it a second, ten with Shift), an optional tag and a colour. Enter or a click away keeps
   *  it, Esc leaves it as it was. Offers t0, or the time there now; shows `err` at once. */
  editTimecode(x, existing = null, t0 = null, err = '') {
    this.closeEditor();
    const at = this.lineAt(x, existing);
    if (!at) return;
    const old = existing && this.tcs().find((tc) => tc.id === existing.id && tc.line === existing.line);
    let color = old ? old.color || null : null;
    const time = h('input', { class: 'tc-time', value: formatTime(t0 ?? (old ? old.t : this.time ? this.time.at(at.here) : at.here * 60)), spellcheck: false, 'aria-label': 'Time (HH:MM:SS)' });
    const tag = h('input', { class: 'tc-tag', value: old && old.tag || '', placeholder: 'Tag', maxlength: 40, spellcheck: false, 'aria-label': 'Tag (optional)' });
    const sws = [null, ...HIGHLIGHT_COLORS].map((c) => h('button', { class: 'tc-sw' + (c === color ? ' on' : ''), title: c ? `Mark ${c}` : 'No colour', 'aria-label': c || 'none', onmousedown: (e) => e.preventDefault(), onclick: () => { color = c; sws.forEach((b, i) => b.classList.toggle('on', i === [null, ...HIGHLIGHT_COLORS].indexOf(c))); } }, h('span', { class: 'sw ' + (c || 'none') })));
    const msg = h('div', { class: 'tc-err' });
    const del = old ? h('button', { class: 'tc-del', title: 'Remove timecode', 'aria-label': 'Remove timecode', html: TRASH_ICON, onmousedown: (e) => e.preventDefault(), onclick: () => { this.closeEditor(); this.setTimecodes(this.tcs().filter((tc) => tc !== old)); } }) : null;
    const pop = h('div', { class: 'tc-pop', role: 'dialog', 'aria-label': 'Timecode' }, h('div', { class: 'tc-row' }, time, tag, h('div', { class: 'tc-sws' }, sws), del), msg);
    const fail = (why) => { msg.textContent = why; pop.classList.add('bad'); time.focus(); };
    const doc = this.session.doc; // another script opened meanwhile: nothing is kept
    const commit = () => {
      if (this.session.doc !== doc) return this.closeEditor();
      const t = parseTime(time.value);
      if (t == null) return fail('Write the time as HH:MM:SS, for example 00:12:30.');
      const r = this.withTimecode(at, t, tag.value, color);
      if (!r.list) return fail(r.why);
      this.closeEditor();
      this.setTimecodes(r.list);
    };
    time.addEventListener('input', () => pop.classList.remove('bad'));
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeEditor(); }
      else if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target === time) {
        e.preventDefault();
        const t = parseTime(time.value);
        if (t != null) time.value = formatTime(Math.max(0, t + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)));
        pop.classList.remove('bad');
      }
    });
    // A click elsewhere keeps it (when it can be kept).
    const away = (e) => {
      if (pop.contains(e.target)) return;
      const t = parseTime(time.value), r = t != null && this.session.doc === doc && this.withTimecode(at, t, tag.value, color);
      this.closeEditor();
      if (r && r.list) this.setTimecodes(r.list);
    };
    document.body.appendChild(pop);
    // Under the bar, its notch on the timecode, kept inside the window.
    const hr = this.host.getBoundingClientRect(), ax = this.inner.getBoundingClientRect().left + at.here * this.drawn;
    const left = Math.max(6, Math.min(ax - 18, innerWidth - pop.offsetWidth - 6));
    pop.style.left = left + 'px';
    pop.style.top = hr.bottom + 6 + 'px';
    pop.style.setProperty('--notch', Math.max(8, Math.min(pop.offsetWidth - 8, ax - left)) + 'px');
    this.editing = { pop, away, x: at.here };
    this.showEditing();
    setTimeout(() => addEventListener('mousedown', away, true), 0);
    time.focus();
    time.select();
    if (err) fail(err);
  }

  /** Where the timecode being edited is, as a line on the bar. */
  showEditing() {
    if (!this.editing) return;
    this.head.classList.add('dim');
    this.inner.style.setProperty('--edit-x', this.editing.x * this.drawn + 'px');
    this.inner.classList.add('editing');
  }

  closeEditor() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    removeEventListener('mousedown', ed.away, true);
    ed.pop.remove();
    this.head.classList.remove('dim');
    this.inner.classList.remove('editing');
    if (!document.activeElement || document.activeElement === document.body) document.getElementById('input')?.focus({ preventScroll: true }); // back to the script
  }
}
