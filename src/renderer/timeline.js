// The timeline bar under the toolbar (View > Timeline): the script from left to right, a tick
// for each scene, the highlights in their colours, the notes, and a time ruler that counts a
// minute a page until timecodes are pinned to it. Clicking goes there; dragging sideways zooms,
// dragging the band moves the window, and holding Ctrl (Cmd) steps second by second (a right-click
// then pins a timecode at that second). A click on a timecode edits it; a right-click on a scene
// gives it its own timecode (kept once confirmed with the check), which the script shows beside the heading.

import { pos } from '../core/editor.js';
import { linesOf } from '../core/layout.js';
import { timelineOf, anchorsOf, timeScale, scriptPos, placeAt, formatTime, rulerLabel, parseTime, rulerStep, minorStep, snapTo, fineTime, makeTimecode, placeLabels, clearOf, isSceneTimecode, onSeconds } from '../core/timeline.js';
import { HIGHLIGHT_COLORS } from '../core/model.js';
import { h, esc } from './ui/dialog.js';
import { menuAt } from './ui/commands.js';
import { MAC } from '../core/keys.js';

const PPP_MAX = 6000; // most pixels a page: about 100 a second at a minute a page
const PADX = 14; // room at either end of the strip (style.css .tl-inner)
const SNAP_PX = 10; // how near a scene, note, highlight or timecode draws the pointer to it (none while stepping)
const FINE_PX = 12; // fewest pixels of mouse travel a second while stepping
const RESET_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.6 5.2A5 5 0 1 1 2 7.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.2 1.8v4h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TRASH_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M4.5 3V1.8h3V3M3 3l.6 7.2h4.8L9 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const CHECK_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.4l2.6 2.6L10 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const NOTE_ICON = '<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M0.5 0.5h8v5.5H4L1.8 8.2V6H0.5z" fill="currentColor"/></svg>';
// Stepping is held with Ctrl, or Cmd on a Mac (where Ctrl + click is a right-click).
const mod = (e) => (MAC ? e.metaKey : e.ctrlKey);
const isMod = (key) => key === (MAC ? 'Meta' : 'Control');

export class Timeline {
  constructor(host, { editor, view, session, jump, openNote, onToggle, lockPointer }) {
    this.host = host;
    this.ed = editor; this.view = view; this.session = session;
    this.jump = jump; this.openNote = openNote; this.onToggle = onToggle; this.lockPointer = lockPointer;
    this.ppp = 0; // pixels a page; 0 fits the whole script in the bar
    this.drawn = 1; // pixels a page as last painted
    this.bandA = this.bandB = 0; // the part of the script in the window
    this.key = '';
    this.targets = []; // what the pointer is drawn to: { x, kind, el, ... }
    this.pointer = null; // clientX of the pointer while it is over the bar
    this.dragging = false; // a press on the bar, until it lets go
    this.stepping = null; // see startStep()
    this.cancelled = false; // Esc pressed while stepping, Ctrl still held
    this.editing = null; // see editTimecode()
    this.unlocked = false; // stepping just ended with the pointer locked, and it hasn't moved since
    this.shift = 0; // px the strip is slid past where it scrolls to, to keep a stepped line under the pointer
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
    this.reset.addEventListener('click', () => this.whole());

    this.inner.addEventListener('mousedown', (e) => this.down(e));
    this.inner.addEventListener('mousemove', (e) => this.over(e));
    this.inner.addEventListener('mouseleave', () => this.leave());
    this.inner.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(e); });
    // Double-click on the ruler or the band: the whole script, as in Ableton.
    this.inner.addEventListener('dblclick', (e) => {
      if (this.stepping || this.snapAt(e.clientX)?.kind === 'tc') return;
      if (this.zone(e) !== 'zoom' || this.onRuler(e)) this.whole();
    });
    // Ctrl pressed with the pointer on the bar starts stepping right there; letting go ends it,
    // and Esc puts the script back where it was (and no more stepping until Ctrl is pressed again).
    addEventListener('keydown', (e) => {
      if (this.stepping && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return this.cancelStep(); }
      if (isMod(e.key) && !e.repeat && this.pointer != null) { this.cancelled = false; this.startStep(this.pointer); }
    }, true);
    addEventListener('keyup', (e) => { if (isMod(e.key)) { this.cancelled = false; this.endStep(); } });
    addEventListener('blur', () => { this.cancelled = false; this.endStep(); });
    // The pointer is locked while stepping (see startStep()); the main process asks for it, as a
    // modifier key alone is no user gesture. Chromium lets go of it itself on Esc (and the page never
    // sees that key), so losing it while the window has the focus is an Esc; without the focus, the
    // writer switched windows, which leaves the script where it stepped to.
    window.__stetPointerLock = () => this.lock();
    document.addEventListener('pointerlockchange', () => {
      const f = this.stepping, mine = document.pointerLockElement === this.inner;
      if (!mine) this.unlocked = true; // (and back on the bar where it was locked)
      if (!f) { if (mine) document.exitPointerLock(); return; } // granted only after a quick tap of Ctrl ended
      if (mine) f.locked = true;
      else if (f.locked) document.hasFocus() ? this.cancelStep() : this.endStep();
    });
    this.scroll.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // The ruler and grid are drawn around the part in view; scrolling far draws the next part.
    this.scroll.addEventListener('scroll', () => {
      if (!this.time) return;
      const l = this.scroll.scrollLeft - PADX, w = this.scroll.clientWidth;
      if ((l < this.rulerA && this.rulerA > 0) || (l + w > this.rulerB && this.rulerB < this.length * this.drawn)) this.paintRuler();
    });
    new ResizeObserver(() => { if (this.visible) { this.slide(0); this.update(true); } }).observe(host);
  }

  get visible() { return !this.host.hidden; }

  show(on = !this.visible) {
    if (!on) { this.endStep(); this.closeEditor(); this.leave(); this.slide(0); }
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

  /** The start of the line at position x in the script (null past its end). */
  lineStart(x) {
    const { bi, line } = placeAt(this.view.pages, x);
    const b = this.ed.blocks[bi];
    return b ? pos(bi, linesOf(b)[line] || 0) : null;
  }

  /** Go to the line at position x. */
  go(x) {
    const p = this.lineStart(x);
    if (p) this.jump(p, false, null, 'top');
  }

  /** Scroll the bar so that cx (in the strip) is in view, a third of the way in, unless it is. */
  reveal(cx) {
    const sc = this.scroll;
    if (cx < sc.scrollLeft || cx > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = cx - sc.clientWidth / 3;
  }

  /** Zoom by factor f, keeping the point under clientX where it is. */
  zoom(f, clientX) {
    const r = this.scroll.getBoundingClientRect();
    clientX ??= r.left + r.width / 2;
    this.setScale(this.drawn * f, this.posAt(clientX), clientX - r.left);
  }

  /** Draw at `ppp` pixels a page (down to fitting the script), with position `at` at `px` in the bar. */
  setScale(ppp, at, px) {
    ppp = Math.min(PPP_MAX, ppp);
    this.ppp = ppp <= this.fit ? 0 : ppp;
    this.slide(0);
    this.update(true);
    this.scroll.scrollLeft = at * this.drawn + PADX - px;
  }

  /** The whole script in the bar again (double-click, or the button), settling in with a slight zoom out. */
  whole() {
    const was = this.ppp;
    this.ppp = 0;
    this.slide(0);
    this.update(true);
    if (was) this.ease([{ transform: 'scaleX(1.06)', opacity: 0.4 }, { opacity: 1 }], 240);
  }

  /** Play the strip in from `frames` to as it is now, briefly, on the compositor (none with reduced motion). */
  ease(frames, ms = 200) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = this.inner.style.transform || 'none';
    this.inner.animate(frames.map((f) => ({ transform: now, ...f })), { duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }

  /** Slide the strip `px` past where it scrolls to (0: back, gently when `soft`). */
  slide(px, soft = false) {
    if (px === this.shift) return;
    const from = this.inner.style.transform;
    for (const a of this.inner.getAnimations()) a.cancel(); // (an easing back to 0 overtaken)
    this.shift = px;
    this.inner.style.transform = px ? `translateX(${px}px)` : '';
    if (soft && from) this.ease([{ transform: from }, {}], 180);
  }

  /** Keep the strip's position x under the pointer at clientX: scrolled there, and slid past the ends. */
  hold(x, clientX) {
    const sc = this.scroll, want = sc.getBoundingClientRect().left + PADX + x * this.drawn - clientX;
    sc.scrollLeft = want;
    this.slide(sc.scrollLeft - want);
  }

  onRuler(e) { return e.clientY >= this.inner.getBoundingClientRect().bottom - 15; }

  /** What a drag from a pointer event does: move the band (above the ruler, on it) or zoom. */
  zone(e) {
    if (this.onRuler(e)) return 'zoom';
    const x = this.posAt(e.clientX);
    return x >= this.bandA && x <= this.bandB && this.bandB - this.bandA < this.length * 0.98 ? 'band' : 'zoom';
  }

  /** The scene, note, highlight or timecode close enough to clientX to draw the pointer to it. */
  snapAt(clientX) { return snapTo(this.targets, this.posAt(clientX), SNAP_PX / this.drawn); }

  /** Light up the mark the pointer is drawn to (null: none). */
  mark(t) {
    const el = t && t.el;
    if (el === this.marked) return;
    if (this.marked) this.marked.classList.remove('near');
    if (el) el.classList.add('near');
    this.marked = el;
  }

  // ---- the pointer ------------------------------------------------------------------------

  /** A press: a click goes there (drawn to a mark close by); a drag sideways zooms around the
   *  point pressed (right to zoom in); a drag of the band moves the window over the script. With
   *  Ctrl held it starts stepping instead. */
  down(e) {
    if (e.button !== 0) return;
    e.preventDefault(); // the script keeps the focus, and nothing is selected
    if (this.stepping) return;
    if (mod(e)) return this.startStep(e.clientX);
    const x0 = e.clientX, y0 = e.clientY;
    const where = this.zone(e);
    const at0 = this.posAt(x0), ppp0 = this.drawn, top0 = this.view.scroller.scrollTop;
    const px0 = x0 - this.scroll.getBoundingClientRect().left;
    const near = this.snapAt(x0);
    const note = e.target.closest('.tl-note') ? this.tl.notes[+e.target.closest('.tl-note').dataset.i] : near && near.kind === 'note' ? near : null;
    let mode = null; // set by the first real movement
    this.dragging = true;
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
      removeEventListener('blur', up);
      this.dragging = false;
      document.body.classList.remove('tl-dragging', 'tl-drag-zoom', 'tl-drag-band');
      if (mode || !this.visible) return;
      if (note) return this.openNote(note.id, note.b, note.s, note.e);
      if (near && near.kind === 'scene') return this.jump(pos(near.b, 0), false, null, 'top'); // to its heading
      if (near && near.kind === 'tc') { this.go(near.x); return this.editTimecode(near.x, near); }
      this.go(near ? near.at ?? near.x : at0); // (a highlight: its first line, though drawn on its second)
    };
    addEventListener('mousemove', move, true);
    addEventListener('mouseup', up, true);
    addEventListener('blur', up);
  }

  /** The pointer moving over the bar: the time and scene under it, or a step with Ctrl held. */
  over(e) {
    if (this.dragging || this.stepping) return;
    this.unlocked = false;
    this.pointer = e.clientX;
    if (mod(e)) return this.cancelled ? undefined : this.startStep(e.clientX); // (only Ctrl's own key events clear `cancelled`: letting go of the lock sends a move without it)
    this.showHover(e);
  }

  leave() {
    if (this.unlocked) return; // (letting go of the pointer lock sends a leave, though it is back on the bar)
    this.pointer = null;
    if (this.stepping) return; // the cover has the pointer now
    this.slide(0, true); // (kept under the pointer after stepping until now)
    this.hover.hidden = true;
    this.band.classList.remove('hot');
    this.mark(null);
  }

  wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) this.zoom(2 ** (-Math.max(-200, Math.min(200, e.deltaY)) / 200), e.clientX); // in step with the wheel or a pinch
    else this.scroll.scrollLeft += e.deltaX || e.deltaY;
  }

  // ---- stepping ---------------------------------------------------------------------------

  /** Holding Ctrl (Cmd) over the bar steps through the script a whole second at a time, at least
   *  FINE_PX pixels of mouse travel a second from where it started, whatever the zoom, drawn to
   *  nothing. A second is less than a pixel of the bar, so the pointer is locked where stepping began
   *  and only its movement counts: it can't wander off over the toolbar or the script, nothing there
   *  lights up or takes a click. The line stays under the pointer and the strip slides beneath it,
   *  so when Ctrl is let go the pointer is on the bar, on the second stepped to. (Should the lock be
   *  refused, a cover over the window takes the pointer, and the line follows it.) The script follows the
   *  line, with the caret drawn where it is, but the caret itself stays put: nothing that shows where
   *  it is (the element in the toolbar, the status bar, the scene list, the notes) changes, then or
   *  after. A click puts the caret there; a right-click pins a timecode at that second; letting go
   *  of Ctrl leaves the script there, Esc puts it back. */
  startStep(clientX) {
    if (!this.time || !this.visible || this.stepping || this.editing || this.dragging) return;
    const t0 = Math.round(this.time.at(this.posAt(clientX)));
    // The line shows at once; the script moves only once the line does, so a shortcut pressed with
    // the pointer resting on the bar leaves it where it is.
    this.stepping = { top: this.view.scroller.scrollTop, t: t0, x: Math.min(this.length, this.time.pos(t0)), at: clientX, ax: clientX, moved: false, locked: false };
    this.rebase(clientX, t0);
    // Every pointer event is the stepping's until it ends, wherever it lands.
    const off = this.stepOff = new AbortController(), opts = { capture: true, signal: off.signal };
    const take = (e) => { e.preventDefault(); e.stopPropagation(); };
    addEventListener('mousemove', (e) => { e.stopPropagation(); this.move(e); }, opts);
    for (const type of ['mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) addEventListener(type, take, opts);
    // A right-click pins on the press: with the pointer locked there is no context menu event.
    addEventListener('mousedown', (e) => { take(e); if (e.button === 2) this.pinStep(); else if (e.button === 0) this.placeStep(); }, opts);
    addEventListener('wheel', (e) => {
      take(e); this.wheel(e);
      const f = this.stepping;
      if (f) { this.rebase(f.at, f.t); if (f.moved) this.hold(f.x, f.ax); this.readout(f.x, f.t); }
    }, { ...opts, passive: false });
    this.cover = document.body.appendChild(h('div', { class: 'tl-cover' }));
    document.body.classList.add('tl-fine');
    this.hover.classList.add('fine');
    this.band.classList.remove('hot');
    this.mark(null);
    this.readout(this.stepping.x, t0);
    this.lockPointer?.();
  }

  /** Lock the pointer to the bar while stepping (called back from the main process). */
  lock() {
    if (!this.stepping || document.pointerLockElement === this.inner) return;
    return this.inner.requestPointerLock()?.catch(() => {}); // refused: the cover stands in
  }

  /** The mouse moving while stepping: by how much when the pointer is locked, else to where. */
  move(e) {
    const f = this.stepping;
    // Ctrl let go where its key up didn't reach us; only without the lock, as letting go of the
    // lock (Esc) can send a move without Ctrl before it says the lock is gone.
    if (!mod(e)) return f.locked ? undefined : this.endStep();
    if (document.pointerLockElement === this.inner) f.at += e.movementX;
    else { f.at = f.ax = e.clientX; f.ay = e.clientY; }
    this.step(f.at);
  }

  /** Step from second t0 with the pointer at clientX (at the start, and after a zoom). */
  rebase(clientX, t0) {
    const f = this.stepping;
    f.x0 = clientX; f.t0 = t0;
    f.px = Math.max(FINE_PX, (this.time.pos(t0 + 1) - this.time.pos(t0)) * this.drawn);
  }

  step(clientX) {
    const f = this.stepping;
    if (!f || !this.time) return;
    // Past either end the line stops, and coming back moves it again at once.
    const total = Math.floor(this.time.at(this.length)), raw = f.t0 + (clientX - f.x0) / f.px;
    if (raw < 0) f.x0 = clientX + f.t0 * f.px;
    else if (raw > total) f.x0 = clientX - (total - f.t0) * f.px;
    const t = fineTime(f.t0, clientX - f.x0, f.px, total);
    if (t === f.t) return;
    f.t = t;
    f.x = Math.min(this.length, this.time.pos(t));
    f.moved = true;
    this.scrub(f.x);
    this.hold(f.x, f.ax);
    this.readout(f.x, t);
  }

  /** Stop stepping: the script stays where it stepped to (`keep`), or goes back to where it was. */
  endStep(keep = true) {
    const f = this.stepping;
    if (!f) return;
    this.stepping = null;
    this.stepOff.abort();
    if (document.pointerLockElement) document.exitPointerLock();
    this.cover.remove();
    this.cover = null;
    document.body.classList.remove('tl-fine');
    this.hover.classList.remove('fine');
    this.hover.hidden = true; // until the pointer moves over the bar again
    // The pointer is back on the bar where it was locked, on the line; without the lock it may be anywhere.
    this.unlocked = f.locked || f.ay == null; // (the lock, or one on its way: a leave that follows is no leave)
    const r = this.inner.getBoundingClientRect();
    if (f.ay != null && (f.ay < r.top || f.ay > r.bottom)) this.slide(0, true);
    const v = this.view;
    v.scrubAt = null;
    if (!f.moved) return;
    if (!keep) v.scroller.scrollTop = f.top;
    v.frame();
  }

  /** Esc: stop stepping and put the script (and the bar) back; Ctrl has to be let go and pressed again to step on. */
  cancelStep() {
    this.cancelled = true;
    this.endStep(false);
    this.slide(0, true);
  }

  /** The script follows the line at once, with the caret drawn there (the editor's stays put). */
  scrub(x) {
    const p = this.lineStart(x);
    if (!p) return;
    const v = this.view;
    this.stepping.p = v.scrubAt = p;
    v.stopGlide();
    v.relayout();
    const r = v.caretRect(p);
    if (r) v.scroller.scrollTop = r.y - v.scroller.clientHeight / 3;
    v.frame();
  }

  /** A click while stepping: the caret goes to the line, to write there. */
  placeStep() {
    const p = this.stepping?.p;
    if (p) this.jump(p);
  }

  /** A right-click while stepping: a timecode at that second, at once. */
  pinStep() {
    const f = this.stepping;
    if (f) this.pin(f.x, f.t);
  }

  anchors() {
    const blocks = this.ed.blocks, at = new Map(blocks.map((b, i) => [b.id, i]));
    return anchorsOf(this.session.doc.timecodes, blocks, this.view.pages).map((a) => ({ ...a, b: at.get(a.id), scene: isSceneTimecode(a, blocks, at) }));
  }

  // ---- painting ---------------------------------------------------------------------------

  /** Repaint what changed: everything when the script, its timecodes or the zoom did, else just the playhead. */
  update(force = false) {
    if (!this.visible || !this.session.doc) return; // nothing open yet (starting up)
    const pages = this.view.pages;
    const tcs = this.tcs();
    const key = `${this.ed.rev}|${pages.length}|${this.scale}|${tcs.map((t) => t.id + ':' + t.line + ':' + t.t).join(',')}`;
    // Another script: nothing carries over. One laid out to more or fewer pages: at once.
    if (this.session.doc !== this.docSeen) { this.endStep(); this.closeEditor(); }
    const redraw = force || this.drawn !== this.scale || this.session.doc !== this.docSeen || pages.length !== this.drawnPages;
    if (redraw) this.repaint(key);
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
    this.head.classList.toggle('glide', !redraw && !this.dragging); // a jump glides; a zoom or a new script doesn't
    this.head.style.left = x + 'px';
    this.showBand();
    // Zoomed in, the bar follows the caret when it leaves the part in view.
    const at = c.b + ':' + l;
    if (at !== this.caretSeen) {
      this.caretSeen = at;
      this.reveal(x + PADX);
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
    const anchors = this.anchorsDrawn = this.anchors();
    this.time = timeScale(anchors);
    const tl = this.tl = onSeconds(timelineOf(this.ed.blocks, this.view.pages), this.time, len); // each on its second, never between two
    this.paintRuler();
    this.reset.hidden = !this.ppp;

    // The script as a line, coloured where it is highlighted; a tick across it for each scene; the
    // notes under it; a line down the bar for each timecode, fainter for one outside a scene heading.
    let m = `<div class="tl-line" style="width:${len * s}px"></div>`;
    for (const hl of tl.highlights) m += `<div class="tl-hl hl-${hl.color}" style="left:${hl.x0 * s}px;width:${Math.max(3, (hl.x1 - hl.x0) * s)}px"></div>`;
    for (const sc of tl.scenes) m += `<div class="tl-scene" data-b="${sc.b}" style="left:${sc.x * s}px"></div>`;
    tl.notes.forEach((n, i) => { m += `<div class="tl-note" data-i="${i}" style="left:${n.x * s}px">${NOTE_ICON}</div>`; });
    for (const a of anchors) m += `<div class="tl-tcm ${a.scene ? 'sc' : 'loose'}${a.color ? ' c-' + a.color : ''}" style="left:${a.x * s}px"></div>`;
    this.marks.innerHTML = m;
    const els = this.marks.children; // in the order drawn: the line, the highlights, the scenes, the notes, the timecodes
    const nh = tl.highlights.length, ns = tl.scenes.length, nn = tl.notes.length;
    this.targets = [
      ...tl.highlights.map((hl, i) => ({ x: hl.x0, at: hl.at, color: hl.color, kind: 'hl', el: els[1 + i] })),
      ...tl.scenes.map((sc, i) => ({ ...sc, kind: 'scene', el: els[1 + nh + i] })),
      ...tl.notes.map((n, i) => ({ ...n, kind: 'note', el: els[1 + nh + ns + i] })),
      ...anchors.map((a, i) => ({ ...a, kind: 'tc', el: els[1 + nh + ns + nn + i] })), // last: on a scene, its timecode wins
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
    // The end of the script (its estimated length) and the pinned timecodes are labelled in their
    // own places: the scenes' timecodes first, then the others, the newest first; one that would
    // run into a label already placed keeps just its line. The regular labels give way around them.
    const order = this.tcs().map((tc) => tc.id + ':' + tc.line);
    this.ruler.innerHTML = `<span class="tl-lb tl-end" style="left:${len * s}px">${rulerLabel(total)}</span>`
      + anchors.map((p) => `<span class="tl-lb tl-tc ${p.scene ? 'sc' : 'loose'}${p.color ? ' c-' + p.color : ''}" style="left:${p.x * s}px">${rulerLabel(p.t)}${p.tag ? `<b>${esc(p.tag)}</b>` : ''}</span>`).join('');
    const [end, ...labels] = this.ruler.children;
    const placed = [[len * s - end.offsetWidth, len * s]];
    const shown = placeLabels(anchors.map((p, i) => ({ x0: p.x * s, x1: p.x * s + labels[i].offsetWidth, rank: (p.scene ? order.length : 0) + order.indexOf(p.id + ':' + p.line) })), placed);
    labels.forEach((el, i) => { if (!shown[i]) el.classList.add('mute'); });
    let ruler = '', grid = '';
    for (let t = Math.floor(time.at(a / s) / inc) * inc; t <= total + 0.5; t += inc) {
      const x = time.pos(t) * s;
      if (x > b + 0.5) break;
      const major = Math.round(t) % step === 0;
      if (t) grid += `<i${major ? ' class="mj"' : ''} style="left:${x}px"></i>`;
      if (major && clearOf(placed, x, x + 10 + rulerLabel(t).length * 5.5)) ruler += `<span class="tl-lb" style="left:${x}px">${rulerLabel(t)}</span>`;
    }
    this.ruler.insertAdjacentHTML('afterbegin', ruler);
    this.grid.innerHTML = grid;
  }

  /** The time and scene under the pointer, drawn to a mark close by. */
  showHover(e) {
    if (!this.time) return;
    const where = this.zone(e);
    const near = this.snapAt(e.clientX);
    this.band.classList.toggle('hot', where === 'band');
    this.inner.dataset.zone = near && near.kind === 'tc' ? 'tc' : this.onRuler(e) ? 'ruler' : where; // on a timecode a click edits it
    this.mark(near);
    this.readout(near ? near.x : this.posAt(e.clientX), null, near);
  }

  /** The line and readout at x: the time (t, or the time there), and the timecode's tag, the note or the scene. */
  readout(x, t = null, near = null) {
    let text = formatTime(t ?? this.time.at(x));
    const sceneAt = () => {
      let sc = -1;
      for (let i = 0; i < this.tl.scenes.length && this.tl.scenes[i].x <= x + 1e-6; i++) sc = i;
      return sc >= 0 ? this.tl.scenes[sc].text || 'SCENE' : '';
    };
    let more;
    if (near && near.kind === 'tc') more = [near.scene ? sceneAt() : '', near.tag].filter(Boolean).join(' · ') || sceneAt();
    else if (near && near.kind === 'note') more = ((this.session.doc.comments[near.id] || {}).text || 'Note').replace(/\s+/g, ' ').slice(0, 60);
    else if (near && near.kind === 'hl') more = [sceneAt(), `${near.color} highlight`].filter(Boolean).join(' · ');
    else more = sceneAt();
    if (more) text += '   ' + more;
    this.hover.hidden = false;
    this.hover.classList.toggle('snap', !!near);
    this.hover.style.left = x * this.drawn + 'px';
    this.hover.firstChild.textContent = text;
    // The readout flips to the left of the line in the right half, so it stays in the bar.
    this.hover.classList.toggle('flip', x * this.drawn - this.scroll.scrollLeft + this.shift + PADX > this.scroll.clientWidth / 2);
  }

  // ---- timecodes ------------------------------------------------------------------------

  /** A right-click: while stepping, pins a timecode at the second stepped to; on a timecode, edits
   *  it; on a scene, gives it its own timecode; elsewhere, offers to add one there. */
  menu(e) {
    if (mod(e) && !this.stepping) this.startStep(e.clientX); // Ctrl held without moving yet
    if (this.stepping) return this.pinStep();
    const near = this.snapAt(e.clientX);
    if (near && near.kind === 'tc') return this.editTimecode(near.x, near);
    if (near && near.kind === 'scene') return this.editTimecode(near.x, { id: this.ed.blocks[near.b].id, line: 0 });
    const x = this.posAt(e.clientX);
    const items = [{ label: 'Add Timecode Here…', run: () => this.editTimecode(x) }];
    if (this.tcs().length) items.push('-', { label: 'Remove All Timecodes', run: () => this.setTimecodes([]) });
    menuAt(e.clientX, e.clientY, items);
  }

  tcs() { return this.session.doc.timecodes || []; }

  setTimecodes(list) {
    this.session.doc.timecodes = list;
    this.session.touch();
    this.update(true);
    this.view.schedule(); // the scenes' timecodes beside their headings
  }

  /** The line a timecode at x (or at { id, line }) is pinned to: { b, bi, line, here }. */
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

  /** Pin second t at position x at once (a right-click while stepping); the editor opens if it doesn't fit. */
  pin(x, t) {
    const at = this.lineAt(x);
    if (!at) return;
    const r = this.withTimecode(at, t);
    if (!r.list) { this.endStep(); return this.editTimecode(x, null, t, r.why); }
    this.setTimecodes(r.list);
    this.flash(at);
  }

  /** A moment's flash on the timecode at { b, line }, just pinned or kept. */
  flash(at) {
    const el = this.targets.find((m) => m.kind === 'tc' && m.id === at.b.id && m.line === at.line)?.el;
    if (el) el.classList.add('new');
  }

  /** A small editor under the timecode at x (or at { id, line }, or a new one at x): its exact
   *  time (Up and Down nudge it a second, ten with Shift), an optional tag and a colour; a scene's
   *  own names the scene. Only the check (or Enter) keeps it; the bin removes it, or drops a new one;
   *  Esc or a click away leaves everything as it was, so a new one not confirmed is never made.
   *  Offers t0, or the whole second there now; shows `err` at once. */
  editTimecode(x, existing = null, t0 = null, err = '') {
    this.closeEditor();
    this.endStep();
    const at = this.lineAt(x, existing);
    if (!at) return;
    const old = this.tcs().find((tc) => tc.id === at.b.id && tc.line === at.line);
    let color = old ? old.color || null : null;
    const time = h('input', { class: 'tc-time', value: formatTime(t0 ?? (old ? old.t : this.time ? Math.round(this.time.at(at.here)) : at.here * 60)), spellcheck: false, 'aria-label': 'Time (HH:MM:SS)' });
    const tag = h('input', { class: 'tc-tag', value: old && old.tag || '', placeholder: 'Tag', maxlength: 40, spellcheck: false, 'aria-label': 'Tag (optional)' });
    const sws = [null, ...HIGHLIGHT_COLORS].map((c) => h('button', { class: 'tc-sw' + (c === color ? ' on' : ''), title: c ? `Mark ${c}` : 'No colour', 'aria-label': c || 'none', onmousedown: (e) => e.preventDefault(), onclick: () => { color = c; sws.forEach((b, i) => b.classList.toggle('on', i === [null, ...HIGHLIGHT_COLORS].indexOf(c))); } }, h('span', { class: 'sw ' + (c || 'none') })));
    const msg = h('div', { class: 'tc-err' });
    const doc = this.session.doc; // another script opened meanwhile: nothing is kept
    const button = (cls, label, html, run) => h('button', { class: cls, title: label, 'aria-label': label, html, onmousedown: (e) => e.preventDefault(), onclick: run });
    const ok = button('tc-ok', old ? 'Keep (Enter)' : 'Add timecode (Enter)', CHECK_ICON, () => commit());
    const del = button('tc-del', old ? 'Remove timecode' : 'Discard (Esc)', TRASH_ICON, () => {
      this.closeEditor();
      if (old && this.session.doc === doc) this.setTimecodes(this.tcs().filter((tc) => tc !== old));
    });
    const scene = isSceneTimecode({ id: at.b.id, line: at.line }, [at.b]) ? h('div', { class: 'tc-head', title: at.b.text }, at.b.text || 'SCENE') : null;
    const pop = h('div', { class: 'tc-pop', role: 'dialog', 'aria-label': scene ? 'Scene timecode' : 'Timecode' }, scene, h('div', { class: 'tc-row' }, time, tag, h('div', { class: 'tc-sws' }, sws), ok, del), msg);
    const fail = (why) => { msg.textContent = why; pop.classList.add('bad'); time.focus(); };
    const commit = () => {
      if (this.session.doc !== doc) return this.closeEditor();
      const t = parseTime(time.value);
      if (t == null) return fail('Write the time as HH:MM:SS, for example 00:12:30.');
      const r = this.withTimecode(at, t, tag.value, color);
      if (!r.list) return fail(r.why);
      this.closeEditor();
      this.setTimecodes(r.list);
      this.flash(at);
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
    // A click elsewhere changes nothing (only the check keeps it).
    const away = (e) => { if (!pop.contains(e.target)) this.closeEditor(); };
    document.body.appendChild(pop);
    // Zoomed in, the bar brings the timecode into view first.
    this.reveal(at.here * this.drawn + PADX);
    // Under the bar, its notch on the timecode, kept inside the window.
    const hr = this.host.getBoundingClientRect(), ax = this.inner.getBoundingClientRect().left + at.here * this.drawn;
    const left = Math.max(6, Math.min(ax - 18, innerWidth - pop.offsetWidth - 6));
    pop.style.left = left + 'px';
    pop.style.top = hr.bottom + 6 + 'px';
    pop.style.setProperty('--notch', Math.max(8, Math.min(pop.offsetWidth - 8, ax - left)) + 'px');
    this.editing = { pop, away, x: old || !this.time ? at.here : Math.min(this.length, this.time.pos(Math.round(this.time.at(at.here)))) }; // on the second it offers
    this.showEditing();
    addEventListener('mousedown', away, true); // (at once: whatever opened it is past its press, and a listener added while a press is dispatched doesn't hear that one)
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
