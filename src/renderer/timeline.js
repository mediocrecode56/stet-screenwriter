// The timeline bar under the toolbar (View > Timeline): the script from left to right, a tick
// for each scene, the highlights in their colours, the notes, and a time ruler that counts a
// minute a page until timecodes are pinned to it. Clicking goes there; dragging sideways zooms,
// dragging the band moves the window, and holding Ctrl (Cmd) steps second by second (a right-click
// then pins a timecode at that second). A click on a timecode edits it; a right-click on a scene
// gives it its own timecode (kept once confirmed with the check), which the script shows beside the heading.

import { pos } from '../core/editor.js';
import { linesOf } from '../core/layout.js';
import { timelineOf, anchorsOf, timeScale, scriptPos, placeAt, flowAt, formatTime, rulerLabel, parseTime, rulerStep, minorStep, snapTo, fineTime, makeTimecode, placeLabels, clearOf, isSceneTimecode, onSeconds, onSecond, maxScale } from '../core/timeline.js';
import { HIGHLIGHT_COLORS } from '../core/model.js';
import { h, esc } from './ui/dialog.js';
import { menuAt } from './ui/commands.js';
import { MAC } from '../core/keys.js';

const PADX = 14; // room at either end of the strip (style.css .tl-inner)
const COVER = 0.62; // the part of the fade at the right end (zoomed in) dense enough that nothing under it is in play
const SNAP_PX = 10; // how near a scene, note, highlight or timecode draws the pointer to it (none while stepping)
const PULL_PX = 24; // the band's start is drawn softly to a mark whose line is within this many pixels of it
const PIN_ROWS = 4; // how many rows of scrolling a mark clicked from outside the band lets go of it over
const FINE_PX = 12; // fewest pixels of mouse travel a second while stepping
const END_PX = 24; // how far before the fade the pointer has brought it all the way up
const END_RAMP = 56; // over how many pixels before that it comes up, with the pointer
// The glass's edges bend what is under them a little, like the rim of a lens: a displacement map
// across each edge's LENS_PX (style.css .tl-lens), the most a pixel's worth part way in, none at either side.
const LENS_PX = 10;
const lensMap = (r) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${LENS_PX}" height="10" preserveAspectRatio="none"><linearGradient id="g"><stop offset="0" stop-color="rgb(128,128,128)"/><stop offset=".4" stop-color="rgb(${r},128,128)"/><stop offset="1" stop-color="rgb(128,128,128)"/></linearGradient><rect width="100%" height="100%" fill="url(#g)"/></svg>`)}`;
const LENS = '<svg class="tl-defs" width="0" height="0" aria-hidden="true">' + [['l', 200], ['r', 56]].map(([k, r]) => `<filter id="tl-bend-${k}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feImage href="${lensMap(r).replace(/"/g, '&quot;')}" preserveAspectRatio="none" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>`).join('') + '</svg>';
const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }; // 0 to 1, easing in and out

/** Bring host's children to `items` ({ k, x, cls, html, tag }: x in pages, drawn at s pixels a page),
 *  keeping each one that stays, so nothing blinks as the scale or the ruler's steps change: a new one
 *  fades in (style.css), one no longer listed fades out where it is, at the scale (unless not `prune`). */
function sync(host, items, s, prune = true) {
  const was = host.keyed || (host.keyed = new Map()), seen = new Set();
  for (const it of items) {
    let el = was.get(it.k);
    if (!el) { el = host.appendChild(document.createElement(it.tag || 'span')); was.set(it.k, el); }
    else if (el.gone) { clearTimeout(el.gone); el.gone = 0; el.classList.remove('gone'); }
    seen.add(it.k);
    if (el.cls !== it.cls) el.className = el.cls = it.cls;
    if (it.html != null && el.html !== it.html) { el.innerHTML = el.html = it.html; el.w = null; }
    el.x = it.x;
    el.style.left = it.x * s + 'px';
  }
  for (const [k, el] of was) {
    if (!prune || seen.has(k)) continue;
    el.style.left = el.x * s + 'px';
    if (!el.gone) { el.classList.add('gone'); el.gone = setTimeout(() => { el.remove(); if (was.get(k) === el) was.delete(k); }, 220); }
  }
}
/** An element's width, measured once for what it says (muted, a label has none). */
const widthOf = (el) => { if (el.w == null) { const m = el.classList.contains('mute'); el.classList.remove('mute'); el.w = el.offsetWidth; if (m) el.classList.add('mute'); } return el.w; };
const RESET_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 3v8M12.5 3v8M4 7h6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.6 5.2L3.8 7l1.8 1.8M8.4 5.2L10.2 7 8.4 8.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"/></svg>'; // the whole script: out to both ends
const TRASH_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M4.5 3V1.8h3V3M3 3l.6 7.2h4.8L9 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const CHECK_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.4l2.6 2.6L10 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Stepping is held with Ctrl, or Cmd on a Mac (where Ctrl + click is a right-click).
const mod = (e) => (MAC ? e.metaKey : e.ctrlKey);
const isMod = (key) => key === (MAC ? 'Meta' : 'Control');

export class Timeline {
  constructor(host, { editor, view, session, jump, openNote, onToggle, lockPointer, onTimecodes }) {
    this.host = host;
    this.onTimecodes = onTimecodes; // the scene list shows them too
    this.ed = editor; this.view = view; this.session = session;
    this.jump = jump; this.openNote = openNote; this.onToggle = onToggle; this.lockPointer = lockPointer;
    this.ppp = 0; // pixels a page; 0 fits the whole script in the bar
    this.drawn = 1; // pixels a page as last painted
    this.bandA = this.bandB = 0; // the part of the script in the window
    this.key = '';
    this.targets = []; // what the pointer is drawn to: { x, kind, el, ... }
    this.pointer = null; // clientX of the pointer while it is over the bar
    this.pointerY = null; // (and its clientY)
    this.dragging = false; // a press on the bar, until it lets go
    this.stepping = null; // see startStep()
    this.cancelled = false; // Esc pressed while stepping, Ctrl still held
    this.editing = null; // see editTimecode()
    this.unlocked = false; // stepping just ended with the pointer locked, and it hasn't moved since
    this.shift = 0; // px the strip is slid past where it scrolls to, to keep a stepped line under the pointer
    this.pinned = null; // a mark clicked from outside the band: { p, x }, the band begins on it once the script is there
    this.bandDrag = null; // the band being dragged: { x, top, k }, see showBand()
    // (the grid under the band, whose glass softens it: the marks over the band read clearly)
    host.innerHTML = '<div class="tl-scroll"><div class="tl-inner"><div class="tl-grid"></div><div class="tl-view"></div><div class="tl-cur" hidden></div><div class="tl-marks"></div><div class="tl-lens l"></div><div class="tl-lens r"></div><div class="tl-ruler"></div>'
      + '<div class="tl-hover" hidden><span></span></div><div class="tl-head"></div></div></div>'
      + LENS + '<div class="tl-fade" hidden></div>' // (under the reset button: the strip fades out softly behind it while the pointer is on the bar)
      + `<button class="tl-reset" hidden title="Whole script (double-click the ruler)" aria-label="Whole script">${RESET_ICON}</button>`;
    this.scroll = host.querySelector('.tl-scroll');
    this.inner = host.querySelector('.tl-inner');
    this.grid = host.querySelector('.tl-grid');
    this.marks = host.querySelector('.tl-marks');
    this.ruler = host.querySelector('.tl-ruler');
    this.hover = host.querySelector('.tl-hover');
    this.head = host.querySelector('.tl-head');
    this.cur = host.querySelector('.tl-cur');
    this.band = host.querySelector('.tl-view');
    this.lens = host.querySelectorAll('.tl-lens');
    this.reset = host.querySelector('.tl-reset');
    this.fade = host.querySelector('.tl-fade');
    this.reset.addEventListener('click', () => this.whole());
    // The fade and the reset button come up only as the pointer nears the right end (the button included).
    host.addEventListener('mousemove', (e) => this.nearEnd(this.endX = e.clientX));
    host.addEventListener('mouseleave', () => this.nearEnd(this.endX = null));

    this.inner.addEventListener('mousedown', (e) => this.down(e));
    this.inner.addEventListener('mousemove', (e) => this.over(e));
    this.inner.addEventListener('mouseleave', () => this.leave());
    this.inner.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(e); });
    // Double-click on the ruler or the band: the whole script, as in Ableton.
    this.inner.addEventListener('dblclick', (e) => {
      if (this.stepping || this.covered(e.clientX) || this.snapAt(e.clientX)?.kind === 'tc') return;
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
      if (mine) f.locked = f.fresh = true;
      else if (f.locked) document.hasFocus() ? this.cancelStep() : this.endStep();
    });
    this.scroll.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // The ruler and grid are drawn around the part in view; scrolling far draws the next part.
    this.scroll.addEventListener('scroll', () => {
      if (this.inner.style.translate && this.scroll.scrollLeft !== this.subAt) this.inner.style.translate = ''; // (scrolled by other means: no part of a pixel to make up)
      if (!this.time) return;
      const l = this.scroll.scrollLeft - PADX, w = this.scroll.clientWidth;
      if ((l < this.rulerA && this.rulerA > 0) || (l + w > this.rulerB && this.rulerB < this.length * this.drawn)) this.paintRuler();
      this.refreshHover(); // the strip moved under a pointer that didn't
    });
    // A wider window may hold the whole script at the zoom it had: then it is simply the whole script;
    // a narrower one, less than two minutes: then it is two minutes.
    new ResizeObserver(() => {
      if (!this.visible) return;
      this.ppp = this.zoomed ? Math.min(this.ppp, this.maxPpp) : 0;
      this.slide(0);
      this.update(true);
      this.editing?.place();
    }).observe(host);
  }

  get visible() { return !this.host.hidden; }

  show(on = !this.visible) {
    if (!on) { this.stopZoom(); this.endStep(); this.closeEditor(); this.leave(); this.slide(0); this.pinned = null; }
    this.host.hidden = !on;
    if (on) this.update(true);
    this.onToggle(on);
  }

  get length() { return Math.max(1, this.view.pages.length); }
  get fit() { return Math.max(1, this.scroll.clientWidth - PADX * 2) / this.length; }
  get scale() { return this.zoomed ? this.ppp : this.fit; }
  /** The closest it zooms in: two minutes across the bar (core/timeline.js maxScale()). */
  get maxPpp() { return this.time ? maxScale(Math.max(1, this.scroll.clientWidth - PADX * 2), this.length, this.time.at(this.length)) : this.fit; }
  /** Zoomed in past fitting the whole script in the bar. */
  get zoomed() { return this.ppp > this.fit; }

  posAt(clientX) {
    return Math.max(0, Math.min(this.length, (clientX - this.inner.getBoundingClientRect().left) / this.drawn));
  }

  /** The start of the line at position x in the script (null past its end). */
  lineStart(x) {
    const { bi, line } = placeAt(this.view.pages, x);
    const b = this.ed.blocks[bi];
    return b ? pos(bi, linesOf(b)[line] || 0) : null;
  }

  /** Go to the line at position x: it glides to 10% of the window above its middle, wherever it is. */
  go(x) {
    const p = this.lineStart(x);
    this.pinned = null;
    if (p) this.jump(p, false, null, 'key');
  }

  /** How the script glides to a scene at position x (view.glideTo): to the middle of the band when x is
   *  in the window already (the middle of the window too, but where a page break is in view), else to the
   *  top, where the band then begins exactly on `pin` ({ p: where the script goes, x: the mark drawn there }). */
  glideFor(x, pin = null) {
    this.pinned = null;
    if (x >= this.bandA - 1e-6 && x <= this.bandB + 1e-6) return { y: () => this.centreTop(x) };
    this.pinned = pin && { ...pin, rev: this.ed.rev };
    return 'top';
  }

  /** Where the script is at content y, as the band reads it (core/timeline.js flowAt()). */
  flow(y) {
    const v = this.view, r = v.rowAt(y);
    return Math.min(this.length, flowAt(v.pages, r.pi, r.row, (v.pageTop(1) - v.pageTop(0)) / v.row));
  }

  /** The scroll position that puts position x in the middle of the band, as near as the ends allow. */
  centreTop(x) {
    const v = this.view, sc = v.scroller, h = sc.clientHeight;
    const mid = (y) => (this.flow(y) + this.flow(y + h)) / 2;
    let lo = 0, hi = Math.max(0, sc.scrollHeight - h);
    for (let i = 0; i < 32 && hi - lo > 0.5; i++) { const m = (lo + hi) / 2; if (mid(m) < x) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  /** Scroll the bar to `left`, gliding there unless a zoom is under way. */
  glideBar(left) {
    const sc = this.scroll;
    if (this.zoomRaf || matchMedia('(prefers-reduced-motion: reduce)').matches) sc.scrollLeft = left;
    else sc.scrollTo({ left, behavior: 'smooth' });
  }

  /** Scroll the bar so that cx (in the strip) is in view, a third of the way in, unless it is. */
  reveal(cx) {
    const sc = this.scroll;
    if (cx < sc.scrollLeft || cx > sc.scrollLeft + sc.clientWidth) this.glideBar(cx - sc.clientWidth / 3);
  }

  /** Zoom by factor f, keeping the point under clientX where it is (or the mark the pointer is drawn
   *  to, so the line stays on it). Wheel turns in a row add up toward one goal, on the same point
   *  while the pointer stays put. */
  zoom(f, clientX) {
    const r = this.scroll.getBoundingClientRect();
    clientX ??= r.left + r.width / 2;
    const g = this.zoomGoal, ptr = clientX - r.left;
    if (g && g.ptr != null && Math.abs(g.ptr - ptr) < 1) return this.zoomTo(g.ppp * f, g.at, g.px, { ptr });
    const { at, px } = this.anchor(clientX);
    this.zoomTo((g ? g.ppp : this.drawn) * f, at, px, { ptr });
  }

  /** What a zoom around clientX holds still: the mark the pointer is drawn to, else the point under it
   *  ({ at: position, px: from the bar's left }). */
  anchor(clientX) {
    const near = this.snapAt(clientX), left = this.scroll.getBoundingClientRect().left;
    const at = near ? near.x : this.posAt(clientX);
    return { at, px: near ? this.inner.getBoundingClientRect().left + at * this.drawn - left : clientX - left };
  }

  /**
   * Zoom smoothly to `ppp` pixels a page with position `at` ending `px` from the bar's left. The
   * scale eases there on a log scale (so zooming in and out feel the same) and the strip is
   * redrawn at its true scale on every frame: the marks, ticks and labels stay crisp and never
   * stretch. A new goal mid-way carries on from where it is, without a restart.
   */
  zoomTo(ppp, at, px, { tau = 70, ptr = null } = {}) {
    ppp = Math.max(this.fit, Math.min(this.maxPpp, ppp));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.stopZoom(); return this.setScale(ppp, at, px); }
    const from = { s: this.drawn, px: this.inner.getBoundingClientRect().left + at * this.drawn - this.scroll.getBoundingClientRect().left }; // where `at` is now, to the part of a pixel
    this.zoomGoal = { ppp, at, px, tau, from, ptr };
    if (this.zoomRaf) return;
    let last = performance.now();
    const step = (now) => {
      const g = this.zoomGoal, k = 1 - Math.exp(-Math.min(64, now - last) / g.tau);
      last = now;
      const f = g.from, ls = Math.log(f.s) + (Math.log(g.ppp) - Math.log(f.s)) * k;
      f.s = Math.exp(ls); f.px += (g.px - f.px) * k;
      const done = Math.abs(ls - Math.log(g.ppp)) < 0.003 && Math.abs(g.px - f.px) < 0.5;
      if (done) { this.stopZoom(); return this.setScale(g.ppp, g.at, g.px); } // (the last frame drawn in full)
      this.setScale(f.s, g.at, f.px);
      this.zoomRaf = requestAnimationFrame(step);
    };
    this.zoomRaf = requestAnimationFrame(step);
  }

  /** Stop a zoom on its way, where it is. */
  stopZoom() { cancelAnimationFrame(this.zoomRaf); this.zoomRaf = 0; this.zoomGoal = null; }

  /** Draw at `ppp` pixels a page (down to fitting the script), with position `at` at `px` in the bar. */
  setScale(ppp, at, px) {
    ppp = Math.min(this.maxPpp, ppp);
    this.ppp = ppp <= this.fit ? 0 : ppp;
    this.slide(0);
    this.update(true);
    // The bar scrolls by whole pixels; the part of one left over moves the strip itself, so what the
    // zoom holds still never shivers by half a pixel from one frame to the next.
    const want = at * this.drawn + PADX - px, sc = this.scroll;
    sc.scrollLeft = want;
    const d = sc.scrollLeft - want;
    this.subAt = sc.scrollLeft;
    this.inner.style.translate = Math.abs(d) < 1 && Math.abs(d) > 0.01 ? `${d.toFixed(3)}px` : '';
    this.refreshHover();
  }

  /** The whole script in the bar again (double-click, or the button): one smooth zoom out, the
   *  middle of what is in view gliding to its own place in the whole. */
  whole() {
    if (!this.zoomed && !this.zoomRaf) return;
    const r = this.scroll.getBoundingClientRect(), at = this.posAt(r.left + r.width / 2);
    this.zoomTo(this.fit, at, PADX + at * this.fit, { tau: 80 });
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
  snapAt(clientX) {
    if (this.covered(clientX)) return null;
    const r = this.scroll.getBoundingClientRect(), left = this.inner.getBoundingClientRect().left;
    const at = (cx) => (cx - left) / this.drawn; // only marks in view, clear of the fade
    return snapTo(this.targets, this.posAt(clientX), SNAP_PX / this.drawn, at(r.left), at(Math.min(r.right, this.coveredFrom)));
  }

  /** The clientX past which the strip is under the fade, zoomed in (Infinity otherwise): nothing there
   *  lights up, shows its time or takes a click. The reset button above it is the one thing in play. */
  get coveredFrom() { return this.zoomed ? this.scroll.getBoundingClientRect().right - this.fade.offsetWidth * COVER : Infinity; }
  covered(clientX) { return clientX >= this.coveredFrom; }

  /** Bring up the fade with the pointer at clientX, zoomed in: it comes up gradually as the pointer
   *  nears the right end (over END_RAMP pixels), all the way within END_PX of the fade, and goes the
   *  same way, so there is no edge where it switches on. Fully up, the reset button sharpens
   *  (tl-end-near). Never while stepping: the strip under the pointer is what is in play then. */
  nearEnd(clientX) {
    const full = this.host.getBoundingClientRect().right - this.fade.offsetWidth - END_PX;
    const p = clientX != null && this.zoomed && !this.stepping ? Math.max(0, Math.min(1, (clientX - full + END_RAMP) / END_RAMP)) : 0;
    if (p === this.endP) return;
    this.endP = p;
    this.host.style.setProperty('--tl-end', p.toFixed(3));
    this.host.classList.toggle('tl-end-near', p === 1);
  }

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
    if (mod(e)) { this.stopZoom(); return this.startStep(e.clientX); }
    if (this.covered(e.clientX)) return;
    const x0 = e.clientX, y0 = e.clientY;
    const where = this.zone(e);
    const at0 = this.posAt(x0), ppp0 = this.drawn, top0 = this.view.scroller.scrollTop;
    const hold = this.anchor(x0); // (a drag zooms around the mark the pointer is drawn to, or the point pressed)
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
        if (mode === 'band') {
          // The band goes with the pointer just as it is, the script following it: no waiting on the
          // script's next frame, and no stretching where page breaks pass the window's edges.
          const v = this.view;
          this.view.stopGlide();
          this.pinned = null;
          this.bandDrag = { x: parseFloat(this.band.style.left) / ppp0, w: parseFloat(this.band.style.width) / ppp0, top: top0, k: 1 / (v.pageTop(1) - v.pageTop(0)) };
        }
      }
      if (mode === 'zoom') this.zoomTo(ppp0 * 2 ** (dx / 50), hold.at, hold.px, { tau: 40 });
      else { const v = this.view; v.scroller.scrollTop = top0 + (dx / ppp0) * (v.pageTop(1) - v.pageTop(0)); this.showBand(); }
    };
    const up = (ev) => {
      removeEventListener('mousemove', move, true);
      removeEventListener('mouseup', up, true);
      removeEventListener('blur', up);
      this.dragging = false;
      document.body.classList.remove('tl-dragging', 'tl-drag-zoom', 'tl-drag-band');
      if (this.bandDrag) {
        // Let go: the band eases from where the pointer had it to the window as it is (a page break may be at an edge).
        this.bandDrag = null;
        this.inner.classList.add('settle');
        this.showBand();
        clearTimeout(this.settling);
        this.settling = setTimeout(() => this.inner.classList.remove('settle'), 260);
      }
      if (ev && ev.clientX != null) this.settle(ev); // the cursor and readout for where the pointer is now
      if (mode || !this.visible) return;
      // A scene: inside the band, to the middle of the window (and of the band); outside it, to the top,
      // where the band then begins, exactly on its tick. Anything else: 10% of the window above its middle.
      if (note) { this.pinned = null; return this.openNote(note.id, note.b, note.s, note.e); }
      if (near && near.kind === 'scene') return this.jump(pos(near.b, 0), false, null, this.glideFor(near.at ?? near.x, { p: pos(near.b, 0), x: near.x })); // to its heading
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
    this.pointerY = e.clientY;
    if (mod(e)) return this.cancelled ? undefined : this.startStep(e.clientX); // (only Ctrl's own key events clear `cancelled`: letting go of the lock sends a move without it)
    this.showHover(e);
  }

  /** After a press: the cursor and the readout as they are for the pointer where it is now (off the bar: none). */
  settle(e) {
    const r = this.inner.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { this.inner.dataset.zone = ''; return this.leave(); }
    this.pointer = e.clientX; this.pointerY = e.clientY;
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
    else { this.stopZoom(); this.scroll.scrollLeft += e.deltaX || e.deltaY; } // (a zoom on its way would pull it back)
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
    if (!this.time || !this.visible || this.stepping || this.editing || this.dragging || this.covered(clientX)) return; // (not from under the fade)
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
    this.nearEnd(null);
    this.lockPointer?.();
  }

  /** Lock the pointer to the bar while stepping (called back from the main process). */
  lock() {
    if (!this.stepping || document.pointerLockElement === this.inner) return;
    // Refused (Chromium does, for a moment after the lock was let go): the cover stands in, and it
    // asks again until it has it, so the pointer never wanders off the window while stepping.
    return this.inner.requestPointerLock()?.catch(() => { if (this.stepping) setTimeout(() => this.stepping && this.lockPointer?.(), 150); });
  }

  /** The mouse moving while stepping: by how much when the pointer is locked, else to where. */
  move(e) {
    const f = this.stepping;
    // Ctrl let go where its key up didn't reach us; only without the lock, as letting go of the
    // lock (Esc) can send a move without Ctrl before it says the lock is gone.
    if (!mod(e)) return f.locked ? undefined : this.endStep();
    if (document.pointerLockElement === this.inner) {
      // On Windows the first move after the lock is measured from where the system put the cursor
      // to lock it, a jump of hundreds of pixels that was never made: that one is left out. (Chromium
      // may send a move of nothing first, as the lock takes hold: the first that moves is the one.)
      const jump = f.fresh && Math.abs(e.movementX) > 64;
      if (e.movementX) f.fresh = false;
      if (!jump) f.at += e.movementX;
    } else { f.at = f.ax = e.clientX; f.ay = e.clientY; }
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
    this.inner.dataset.zone = ''; // (and the cursor it shows then)
    this.nearEnd(this.endX);
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
    if (this.session.doc !== this.docSeen) { this.endStep(); this.closeEditor(); this.pinned = null; }
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
    // On the caret's line's own second, as the marks are: on a mark clicked, exactly over it.
    const line = scriptPos(pages, c.b, l), x = (this.time ? onSecond(this.time, line, this.length) : line) * this.drawn;
    this.head.classList.toggle('glide', !redraw && !this.dragging); // a jump glides; a zoom or a new script doesn't
    this.head.style.left = x + 'px';
    this.showScene(c.b, !redraw && !this.dragging);
    this.showBand();
    // Zoomed in, the bar follows the caret when it leaves the part in view.
    const at = c.b + ':' + l;
    if (at !== this.caretSeen) {
      this.caretSeen = at;
      this.reveal(x + PADX);
    }
  }

  /** The caret's scene, drawn as a thicker stretch of the line from its tick to the next. */
  showScene(b, glide) {
    const sc = this.tl?.scenes || [];
    let i = -1;
    while (i + 1 < sc.length && sc[i + 1].b <= b) i++;
    this.cur.hidden = i < 0;
    if (i < 0) return;
    const s = this.drawn, a = sc[i].x * s, z = (i + 1 < sc.length ? sc[i + 1].x : this.length) * s;
    this.cur.classList.toggle('glide', glide);
    this.cur.style.left = a + 'px';
    this.cur.style.width = Math.max(1, z - a) + 'px';
  }

  /** The part of the script in the window, as a pane of glass: from the top of the window to its bottom,
   *  read the way the marks are and flowing on through blank rows and page breaks (flow()), so it moves
   *  with the script without stopping or jumping. Its start is drawn softly to a mark whose line it is
   *  near (a mark sits on its whole second, a little off its line), the way the pointer is; and once
   *  the script is where a click on a mark outside the band sent it, it begins exactly on that mark,
   *  letting go of it again over a few rows of scrolling. Dragged, it simply goes with the pointer. */
  showBand() {
    const v = this.view, sc = v.scroller, top = sc.scrollTop, s = this.drawn;
    const a = this.flow(top), b = Math.max(a, this.flow(top + sc.clientHeight));
    this.bandA = a; this.bandB = b;
    const d = this.bandDrag;
    if (d) {
      const x = d.x + (top - d.top) * d.k;
      return this.place(x * s, Math.max(2, d.w * s));
    }
    let x0 = a, near = null, dist = Infinity;
    for (const m of this.targets) if (m.kind !== 'tc' && m.at != null && Math.abs(m.at - a) < dist) { dist = Math.abs(m.at - a); near = m; }
    if (near) x0 += (near.x - near.at) * (1 - smooth(dist * s / Math.max(PULL_PX, 1.6 * Math.abs(near.x - near.at) * s)));
    const pin = this.pinned;
    if (pin && pin.rev !== this.ed.rev) this.pinned = null; // (the script changed since: where it went is no longer where it is)
    else if (pin) {
      const goal = v.topOf(pin.p, true), max = sc.scrollHeight - sc.clientHeight;
      const w = goal != null && goal >= 0 && goal <= max ? 1 - smooth(Math.abs(top - goal) / (PIN_ROWS * v.row)) : 0;
      if (w > 0) x0 += (a + pin.x - this.flow(goal) - x0) * w; // (none on the way there, nor once scrolled on from it, nor if it can't reach the top: the end of the script)
    }
    this.place(x0 * s, Math.max(2, (b - x0) * s));
  }

  /** The band at `left` for `width` pixels, with the lens over each of its edges. */
  place(left, width) {
    const [l, r] = this.lens, w = Math.min(LENS_PX, width / 2);
    this.band.style.left = l.style.left = left + 'px';
    this.band.style.width = width + 'px';
    l.style.width = r.style.width = w + 'px';
    r.style.left = left + width - w + 'px';
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
    const again = this.zoomRaf && this.tl && this.docSeen === this.session.doc; // mid-zoom: the same marks, drawn at the new scale
    const anchors = again ? this.anchorsDrawn : (this.anchorsDrawn = this.anchors());
    if (!again) this.time = timeScale(anchors);
    const colors = this.ed.noteColors();
    const tl = again ? this.tl : (this.tl = onSeconds(timelineOf(this.ed.blocks, this.view.pages, colors), this.time, len)); // each on its second, never between two
    this.paintRuler();
    this.reset.hidden = this.fade.hidden = !this.zoomed;
    this.nearEnd(this.endX); // (zoomed in or out under a pointer at the end)

    // Mid-zoom the marks are the same ones, just moved to the new scale: nothing is made again, so
    // nothing under the pointer blinks.
    if (again) {
      this.marks.firstChild.style.width = len * s + 'px';
      for (const t of this.targets) {
        t.el.style.left = t.x * s + 'px';
        if (t.kind === 'hl') t.el.style.width = Math.max(3, (t.x1 - t.x) * s) + 'px';
      }
      this.showScene(this.ed.caret.b, false);
      return this.showEditing();
    }
    // The script as a line, coloured where it is highlighted; a tick across it for each scene; the
    // notes under it; a line down the bar for each timecode, fainter for one outside a scene heading.
    let m = `<div class="tl-line" style="width:${len * s}px"></div>`;
    for (const hl of tl.highlights) m += `<div class="tl-hl hl-${hl.color}" style="left:${hl.x0 * s}px;width:${Math.max(3, (hl.x1 - hl.x0) * s)}px"></div>`;
    for (const sc of tl.scenes) m += `<div class="tl-scene" data-b="${sc.b}" style="left:${sc.x * s}px"></div>`;
    tl.notes.forEach((n, i) => { const c = colors.get(n.id); m += `<div class="tl-note${c ? ' c-' + c : ''}" data-i="${i}" style="left:${n.x * s}px"></div>`; }); // a square hung from the line, as on the page; in the note's colour, if it has one
    for (const a of anchors) m += `<div class="tl-tcm ${a.scene ? 'sc' : 'loose'}${a.color ? ' c-' + a.color : ''}" style="left:${a.x * s}px"></div>`;
    this.marks.innerHTML = m;
    const els = this.marks.children; // in the order drawn: the line, the highlights, the scenes, the notes, the timecodes
    const nh = tl.highlights.length, ns = tl.scenes.length, nn = tl.notes.length;
    this.targets = [
      ...tl.highlights.map((hl, i) => ({ x: hl.x0, x1: hl.x1, at: hl.at, color: hl.color, kind: 'hl', el: els[1 + i] })),
      ...tl.scenes.map((sc, i) => ({ ...sc, kind: 'scene', el: els[1 + nh + i] })),
      ...tl.notes.map((n, i) => ({ ...n, kind: 'note', el: els[1 + nh + ns + i] })),
      ...anchors.map((a, i) => ({ ...a, kind: 'tc', el: els[1 + nh + ns + nn + i] })), // last: on a scene, its timecode wins
    ];
    this.marked = null;
    this.showScene(this.ed.caret.b, false);
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
    // Every label and grid line is kept from one drawing to the next (sync()): zooming moves them, and
    // the ones that come or go as the steps change fade rather than blink.
    const order = this.tcs().map((tc) => tc.id + ':' + tc.line);
    const fixed = [{ k: 'end', x: len, cls: 'tl-lb tl-end', html: rulerLabel(total) }, ...anchors.map((p) => ({ k: 'tc' + p.id + ':' + p.line, x: p.x, cls: `tl-lb tl-tc ${p.scene ? 'sc' : 'loose'}${p.color ? ' c-' + p.color : ''}`, html: rulerLabel(p.t) + (p.tag ? `<b>${esc(p.tag)}</b>` : '') }))];
    const items = [], grid = [];
    const lw = (t) => 10 + rulerLabel(t).length * 5.5; // (a regular label's width, near enough)
    const ticks = [];
    for (let t = Math.floor(time.at(a / s) / inc) * inc; t <= total + 0.5; t += inc) {
      const x = time.pos(t);
      if (x * s > b + 0.5) break;
      const major = Math.round(t) % step === 0;
      if (t) grid.push({ k: t, x, cls: major ? 'mj' : '', tag: 'i' });
      if (major) ticks.push({ t, x });
    }
    sync(this.ruler, fixed, s, false); // (first, to be measured)
    const els = fixed.map((f) => this.ruler.keyed.get(f.k)), [end, ...labels] = els;
    const placed = [[len * s - widthOf(end), len * s]];
    const shown = placeLabels(anchors.map((p, i) => ({ x0: p.x * s, x1: p.x * s + widthOf(labels[i]), rank: (p.scene ? order.length : 0) + order.indexOf(p.id + ':' + p.line) })), placed);
    labels.forEach((el, i) => el.classList.toggle('mute', !shown[i]));
    for (const { t, x } of ticks) if (clearOf(placed, x * s, x * s + lw(t))) items.push({ k: 'r' + t, x, cls: 'tl-lb', html: rulerLabel(t) });
    sync(this.ruler, [...fixed, ...items], s);
    sync(this.grid, grid, s);
  }

  /** The time and scene under the pointer, drawn to a mark close by. */
  showHover(e) {
    if (!this.time) return;
    if (this.covered(e.clientX)) {
      this.hover.hidden = true;
      this.band.classList.remove('hot');
      this.inner.dataset.zone = 'covered';
      return this.mark(null);
    }
    const where = this.zone(e);
    const near = this.snapAt(e.clientX);
    this.band.classList.toggle('hot', where === 'band');
    // The cursor says what a press does: on a timecode it edits it; drawn to a scene, a note or a highlight
    // it goes there (whatever row it is on); else a drag zooms (on the ruler) or moves the band (on it).
    this.inner.dataset.zone = near ? (near.kind === 'tc' ? 'tc' : 'mark') : this.onRuler(e) ? 'ruler' : where;
    this.mark(near);
    this.readout(near ? near.x : onSecond(this.time, this.posAt(e.clientX), this.length), null, near); // (on a whole second, like everything on the bar)
  }

  /** The readout again where the pointer rests, after the strip moved or was redrawn under it. */
  refreshHover() {
    if (this.pointer == null || this.pointerY == null || this.stepping || this.dragging || this.hover.hidden) return;
    this.showHover({ clientX: this.pointer, clientY: this.pointerY });
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
    if (this.covered(e.clientX)) return;
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
    this.onTimecodes?.();
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
   *  Offers t0, or the whole second there now; shows `err` at once. Opens under the bar, or under
   *  `under` (a box: the scene list's row) with the same logic. */
  editTimecode(x, existing = null, t0 = null, err = '', under = null) {
    this.closeEditor();
    this.endStep();
    const at = this.lineAt(x, existing);
    if (!at) return;
    const old = this.tcs().find((tc) => tc.id === at.b.id && tc.line === at.line);
    let color = old ? old.color || null : null;
    const time = h('input', { class: 'tc-time', value: formatTime(t0 ?? (old ? old.t : Math.round(this.timeAt(at.here)))), spellcheck: false, 'aria-label': 'Time (HH:MM:SS)' });
    const tag = h('input', { class: 'tc-tag', value: old && old.tag || '', placeholder: 'Tag', maxlength: 40, spellcheck: false, 'aria-label': 'Tag (optional)' });
    const SWS = [...HIGHLIGHT_COLORS, null]; // (in the toolbar's order: the colours, then none)
    const sws = SWS.map((c) => h('button', { class: 'tc-sw' + (c === color ? ' on' : ''), title: c ? `Mark ${c}` : 'No colour', 'aria-label': c || 'none', onmousedown: (e) => e.preventDefault(), onclick: () => { color = c; sws.forEach((b, i) => b.classList.toggle('on', i === SWS.indexOf(c))); } }, h('span', { class: 'sw ' + (c || 'none') })));
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
    if (this.visible) this.reveal(at.here * this.drawn + PADX);
    // Under the bar (or the row), its notch on the timecode, kept inside the window (again when the bar changes size).
    const place = () => {
      const hr = under || this.host.getBoundingClientRect(), ax = under ? under.left + 24 : this.inner.getBoundingClientRect().left + at.here * this.drawn;
      const left = Math.max(6, Math.min(ax - 18, innerWidth - pop.offsetWidth - 6));
      pop.style.left = left + 'px';
      pop.style.top = Math.min(hr.bottom + 6, innerHeight - pop.offsetHeight - 6) + 'px';
      pop.style.setProperty('--notch', Math.max(8, Math.min(pop.offsetWidth - 8, ax - left)) + 'px');
    };
    place();
    this.editing = { pop, away, place, x: old || !this.time ? at.here : Math.min(this.length, this.time.pos(Math.round(this.time.at(at.here)))) }; // on the second it offers
    this.showEditing();
    addEventListener('mousedown', away, true); // (at once: whatever opened it is past its press, and a listener added while a press is dispatched doesn't hear that one)
    time.focus();
    time.select();
    if (err) fail(err);
  }

  /** The scene at block b's own timecode, edited under `box` (the scene list's row). */
  editScene(b, box) { const blk = this.ed.blocks[b]; if (blk) this.editTimecode(null, { id: blk.id, line: 0 }, null, '', box); }

  /** The time at position x of the script, by the timecodes (a minute a page until there are some). */
  timeAt(x) { return (this.visible && this.time ? this.time : timeScale(this.anchors())).at(x); }

  /** The time each scene starts at, and whether it is pinned: (b) => { t, pinned }. */
  sceneTimes() {
    const scale = this.visible && this.time ? this.time : timeScale(this.anchors());
    const pinned = new Set(this.tcs().map((tc) => tc.id + ':' + tc.line));
    return (b) => ({ t: Math.round(scale.at(scriptPos(this.view.pages, b))), pinned: pinned.has(this.ed.blocks[b]?.id + ':0') });
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
