// The timeline bar under the toolbar (View > Timeline): the script from left to right, a thin
// line for each scene, the highlights in their colours, the notes, and a time ruler that counts
// a minute a page until timecodes are pinned to it (right-click). Clicking goes there.

import { pos } from '../core/editor.js';
import { linesOf } from '../core/layout.js';
import { timelineOf, anchorsOf, timeScale, scriptPos, placeAt, formatTime, rulerLabel, parseTime, rulerStep, minorStep } from '../core/timeline.js';
import { esc } from './ui/dialog.js';
import * as dlg from './ui/dialog.js';
import { menuAt } from './ui/commands.js';
import { MAC, macKeys } from '../core/keys.js';

const PPP_MAX = 600; // most pixels a page
const PADX = 14; // room at either end of the strip (style.css .tl-inner)
const NOTE_ICON = '<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M0.5 0.5h8v5.5H4L1.8 8.2V6H0.5z" fill="currentColor"/></svg>';

export class Timeline {
  constructor(host, { editor, view, session, jump, openNote, onToggle }) {
    this.host = host;
    this.ed = editor; this.view = view; this.session = session;
    this.jump = jump; this.openNote = openNote; this.onToggle = onToggle;
    this.ppp = 0; // pixels a page; 0 fits the whole script in the bar
    this.drawn = 1; // pixels a page as last painted
    this.key = '';
    host.innerHTML = '<div class="tl-side" title="Estimated length of the script"><span class="tl-len"></span></div>'
      + '<div class="tl-scroll"><div class="tl-inner"><div class="tl-view"></div><div class="tl-grid"></div><div class="tl-marks"></div><div class="tl-ruler"></div>'
      + '<div class="tl-hover" hidden><span></span></div><div class="tl-head"></div></div></div>'
      + '<div class="tl-zoom"><button class="tb" data-z="-1" title="Zoom out (Ctrl+wheel)">−</button><button class="tb" data-z="0" title="Show the whole script">FIT</button><button class="tb" data-z="1" title="Zoom in (Ctrl+wheel)">+</button></div>';
    if (MAC) for (const b of host.querySelectorAll('[title]')) b.title = macKeys(b.title);
    this.scroll = host.querySelector('.tl-scroll');
    this.inner = host.querySelector('.tl-inner');
    this.grid = host.querySelector('.tl-grid');
    this.marks = host.querySelector('.tl-marks');
    this.ruler = host.querySelector('.tl-ruler');
    this.hover = host.querySelector('.tl-hover');
    this.head = host.querySelector('.tl-head');
    this.band = host.querySelector('.tl-view');
    this.len = host.querySelector('.tl-len');

    this.inner.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const note = e.target.closest('.tl-note');
      if (note) return this.openNote(note.dataset.id, +note.dataset.b, +note.dataset.s, +note.dataset.e);
      const scene = e.target.closest('.tl-scene'); // a scene's line goes to its heading, however near the click
      if (scene) return this.jump(pos(+scene.dataset.b, 0), false, null, 'top');
      this.go(this.posAt(e.clientX));
    });
    this.inner.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(e); });
    this.inner.addEventListener('mousemove', (e) => this.showHover(e.clientX));
    this.inner.addEventListener('mouseleave', () => { this.hover.hidden = true; });
    this.scroll.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
      else this.scroll.scrollLeft += e.deltaX || e.deltaY;
    }, { passive: false });
    host.querySelector('.tl-zoom').addEventListener('mousedown', (e) => {
      const b = e.target.closest('[data-z]');
      if (!b) return;
      e.preventDefault();
      const z = +b.dataset.z;
      if (z) this.zoom(z > 0 ? 1.5 : 1 / 1.5); else { this.ppp = 0; this.update(true); }
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
    const at = (this.scroll.scrollLeft + px) / this.drawn;
    const ppp = Math.min(PPP_MAX, this.scale * f);
    this.ppp = ppp <= this.fit ? 0 : ppp;
    this.update(true);
    this.scroll.scrollLeft = at * this.scale - px;
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
      if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = x - sc.clientWidth / 3;
    }
  }

  /** The part of the script in the window, as a soft band. */
  showBand() {
    const v = this.view, sc = v.scroller;
    const top = v.pageTop(0), span = v.pageTop(1) - top;
    const at = (y) => Math.max(0, Math.min(this.length, (y - top) / span - v.offset));
    const a = at(sc.scrollTop), b = at(sc.scrollTop + sc.clientHeight);
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
    const time = this.time = timeScale(anchors);
    const total = time.at(len);
    this.len.textContent = formatTime(total);

    // The ruler: a label every so often, well apart; the grid (a faint line at each, shown while
    // the pointer is on the bar) carries the finer steps.
    const pxPerSec = s / time.pace; // after the last timecode; close enough before it to space the labels
    const step = rulerStep(pxPerSec, 110), minor = minorStep(step, pxPerSec, 18);
    let ruler = '', grid = '';
    for (let t = 0; t <= total + 0.5; t += minor || step) {
      const x = time.pos(t) * s;
      if (x > len * s + 0.5) break;
      const major = Math.round(t) % step === 0;
      if (t) grid += `<i${major ? ' class="mj"' : ''} style="left:${x}px"></i>`;
      // A pinned timecode is labelled in its own place; the regular labels give way around it.
      if (major && x <= len * s - 40 && !anchors.some((a) => x > a.x * s - 52 && x < a.x * s + 64)) ruler += `<span class="tl-lb" style="left:${x}px">${rulerLabel(t)}</span>`;
    }
    for (const a of anchors) ruler += `<span class="tl-lb tl-tc" style="left:${a.x * s}px" title="Timecode, pinned (right-click to change)">${rulerLabel(a.t)}</span>`;
    this.ruler.innerHTML = ruler;
    this.grid.innerHTML = grid;

    // The script as a line, coloured where it is highlighted; a quiet tick for each scene, numbered
    // (while the pointer is on the bar) only when every number fits; the notes under the line.
    let m = `<div class="tl-line" style="width:${len * s}px"></div>`;
    for (const hl of tl.highlights) m += `<div class="tl-hl hl-${hl.color}" style="left:${hl.x0 * s}px;width:${Math.max(3, (hl.x1 - hl.x0) * s)}px"></div>`;
    let room = Infinity;
    for (let i = 1; i < tl.scenes.length; i++) room = Math.min(room, (tl.scenes[i].x - tl.scenes[i - 1].x) * s);
    const numbered = room >= 34;
    tl.scenes.forEach((sc, i) => {
      m += `<div class="tl-scene" data-b="${sc.b}" style="left:${sc.x * s}px">${numbered ? `<span>${i + 1}</span>` : ''}</div>`;
    });
    for (const n of tl.notes) {
      const text = (this.session.doc.comments[n.id] || {}).text || 'Note';
      m += `<div class="tl-note" data-id="${esc(n.id)}" data-b="${n.b}" data-s="${n.s}" data-e="${n.e}" style="left:${n.x * s}px" title="${esc(text.slice(0, 200))}">${NOTE_ICON}</div>`;
    }
    this.marks.innerHTML = m;
  }

  /** The line under the pointer, with its page, time and scene. */
  showHover(clientX) {
    if (!this.time) return;
    const x = this.posAt(clientX);
    let sc = -1;
    for (let i = 0; i < this.tl.scenes.length && this.tl.scenes[i].x <= x + 1e-9; i++) sc = i;
    const scene = sc >= 0 ? `   ${sc + 1}  ${this.tl.scenes[sc].text || 'SCENE'}` : '';
    this.hover.hidden = false;
    this.hover.style.left = x * this.drawn + 'px';
    this.hover.firstChild.textContent = `${formatTime(this.time.at(x))}   P. ${Math.min(this.length, Math.floor(x) + 1)}${scene}`;
    // The readout flips to the left of the line in the right half, so it stays in the bar.
    this.hover.classList.toggle('flip', x * this.drawn > this.inner.offsetWidth / 2);
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
