// The timeline bar under the toolbar (View > Timeline): the script from left to right, a tick
// for each scene, the highlights in their colours, the notes, and a time ruler that counts a
// minute a page until timecodes are pinned to it (right-click). Clicking goes there; dragging
// sideways zooms, dragging the band moves the window, and Ctrl+dragging scrubs second by second.

import { pos } from '../core/editor.js';
import { linesOf } from '../core/layout.js';
import { timelineOf, anchorsOf, timeScale, scriptPos, placeAt, formatTime, rulerLabel, parseTime, rulerStep, minorStep, snapTo } from '../core/timeline.js';
import * as dlg from './ui/dialog.js';
import { menuAt } from './ui/commands.js';

const PPP_MAX = 6000; // most pixels a page: about 100 a second at a minute a page
const PADX = 14; // room at either end of the strip (style.css .tl-inner)
const SNAP_PX = 6; // how near a scene, note, highlight or timecode draws the pointer to it
const FINE_PX = 8; // pixels a second when Ctrl+dragging
const RESET_ICON = '<svg width="11" height="9" viewBox="0 0 11 9" aria-hidden="true"><path d="M0.5 4.5h3.5M2.5 2.5l2 2-2 2M10.5 4.5H7M8.5 2.5l-2 2 2 2M5.5 0.5v8" fill="none" stroke="currentColor"/></svg>';
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
      + `<button class="tl-reset" hidden title="Whole script">${RESET_ICON}</button>`;
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
    // the script in the window) moves the window over the script; Ctrl+drag scrubs second by second.
    this.inner.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY;
      const where = e.ctrlKey || e.metaKey ? 'fine' : this.zone(e);
      const at0 = this.posAt(x0), ppp0 = this.drawn, top0 = this.view.scroller.scrollTop;
      const px0 = x0 - this.scroll.getBoundingClientRect().left;
      const near = this.snap(at0);
      const t0 = this.time ? Math.round(this.time.at(near ? near.x : at0)) : 0;
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
        else if (mode === 'band') { const v = this.view; v.scroller.scrollTop = top0 + (dx / ppp0) * (v.pageTop(1) - v.pageTop(0)); }
        else {
          const t = Math.max(0, Math.min(this.time.at(this.length), t0 + Math.round(dx / FINE_PX)));
          const x = Math.min(this.length, this.time.pos(t));
          this.scrub(x);
          this.readout(x, t);
        }
      };
      const up = () => {
        removeEventListener('mousemove', move, true);
        removeEventListener('mouseup', up, true);
        document.body.classList.remove('tl-dragging', 'tl-drag-zoom', 'tl-drag-band', 'tl-drag-fine');
        if (mode === 'fine') { this.scrub(null); this.hover.hidden = true; }
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
    this.inner.addEventListener('mousemove', (e) => { if (!document.body.classList.contains('tl-dragging')) this.showHover(e); });
    this.inner.addEventListener('mouseleave', () => { this.hover.hidden = true; this.band.classList.remove('hot'); this.mark(null); });
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
    if (force || this.drawn !== this.scale) this.repaint(key);
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
    this.marks.innerHTML = m;
    const els = this.marks.children; // in the order drawn: the line, the highlights, the scenes, the notes
    const nh = tl.highlights.length, ns = tl.scenes.length;
    this.targets = [
      ...tl.highlights.map((h, i) => ({ x: h.x0, kind: 'hl', el: els[1 + i] })),
      ...tl.scenes.map((sc, i) => ({ ...sc, kind: 'scene', el: els[1 + nh + i] })),
      ...tl.notes.map((n, i) => ({ ...n, kind: 'note', el: els[1 + nh + ns + i] })),
      ...anchors.map((a) => ({ x: a.x, kind: 'tc', el: null })),
    ];
    this.marked = null;
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
      if (major && x <= len * s - 70 && !anchors.some((p) => x > p.x * s - 52 && x < p.x * s + 64)) ruler += `<span class="tl-lb" style="left:${x}px">${rulerLabel(t)}</span>`;
    }
    // The end of the script: its estimated length.
    ruler += `<span class="tl-lb tl-end" style="left:${len * s}px">${rulerLabel(total)}</span>`;
    for (const p of anchors) ruler += `<span class="tl-lb tl-tc" style="left:${p.x * s}px">${rulerLabel(p.t)}</span>`;
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
    if (near && near.kind === 'note') text += '   ' + ((this.session.doc.comments[near.id] || {}).text || 'Note').replace(/\s+/g, ' ').slice(0, 60);
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

  menu(e) {
    const x = this.posAt(e.clientX);
    const near = this.anchors().find((a) => Math.abs(a.x - x) * this.drawn < 6);
    const items = [{ label: near ? 'Change Timecode…' : 'Add Timecode Here…', run: () => this.addTimecode(near ? near.x : x, near) }];
    if (near) items.push({ label: 'Remove Timecode', run: () => this.setTimecodes(this.tcs().filter((t) => !(t.id === near.id && t.line === near.line))) });
    if (this.tcs().length) items.push('-', { label: 'Remove All Timecodes', run: () => this.setTimecodes([]) });
    menuAt(e.clientX, e.clientY, items);
  }

  tcs() { return this.session.doc.timecodes || []; }

  setTimecodes(list) {
    this.session.doc.timecodes = list;
    this.session.touch();
    this.update(true);
  }

  /** Pin the time at position x (the start of the line there), asking for it as HH:MM:SS. */
  async addTimecode(x, existing) {
    const { bi, line } = existing ? { bi: this.ed.blocks.findIndex((b) => b.id === existing.id), line: existing.line } : placeAt(this.view.pages, x);
    const b = this.ed.blocks[bi];
    if (!b) return;
    const here = scriptPos(this.view.pages, bi, line);
    const v = await dlg.prompt('TIMECODE', 'Time at this point (HH:MM:SS)', formatTime(this.time ? this.time.at(here) : here * 60),
      'The rest of the timeline is estimated from it: evenly between timecodes, and at the pace so far after the last one.');
    if (v == null) return;
    const t = parseTime(v);
    if (t == null) return dlg.alertBox('TIMECODE', `"${v}" is not a time. Write it as HH:MM:SS, for example 00:12:30.`);
    const rest = this.tcs().filter((tc) => !(tc.id === b.id && tc.line === line));
    const next = [...rest, { id: b.id, line, t }];
    // It has to fall between the timecodes before and after it.
    if (!anchorsOf(next, this.ed.blocks, this.view.pages).some((a) => a.id === b.id && a.line === line)) {
      const others = anchorsOf(rest, this.ed.blocks, this.view.pages);
      const before = [...others].reverse().find((a) => a.x < here), after = others.find((a) => a.x > here);
      const why = here <= 0 ? 'The very start of the script is always 00:00:00.'
        : `It has to be later than ${before ? formatTime(before.t) : '00:00:00'}${after ? ` and earlier than ${formatTime(after.t)}` : ''}.`;
      return dlg.alertBox('TIMECODE', `${formatTime(t)} doesn't fit here.`, why);
    }
    this.setTimecodes(next);
  }
}
