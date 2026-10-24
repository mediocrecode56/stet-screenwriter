// Focus mode (View > Focus Mode, F11): the window full screen with nothing but the page, the text
// and what comes up as you write (spelling fixes, completions, find). Everything else slides away
// in one move: the menus and toolbar up, the status bar down, the side panels to their edges.
//   - the pointer at the top edge brings the menus and toolbar back down over the page;
//   - the pointer at the right edge brings a small rail: WINDOW (back to the window, as Esc does)
//     and REVISE, SCENES and NOTES, which open their panels beside the page.
// Leaving puts everything back as it was, the panels open before included.

import { h } from './dialog.js';
import { EASE_OUT, EASE_IN_OUT, reducedMotion } from './motion.js';

const DUR = 220;
const LINGER = 260; // ms the toolbar or rail stays after the pointer leaves it
const EXIT_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 4.5V1.5h3M10.5 4.5V1.5h-3M1.5 7.5v3h3M10.5 7.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

export class FocusMode {
  /** panels: [{ key, label, isOpen(), set(on) }] (REVISE, SCENES, NOTES); onChange(on) after each switch. */
  constructor({ api, panels, onChange = () => {} }) {
    this.api = api; this.panels = panels; this.onChange = onChange;
    this.on = false;
    this.saved = null; // the panels open before
    this.edgeTop = h('div', { id: 'focus-edge-top', 'aria-hidden': 'true' });
    this.edgeRight = h('div', { id: 'focus-edge-right', 'aria-hidden': 'true' });
    this.rail = h('div', { id: 'focus-rail', role: 'toolbar', 'aria-label': 'Focus mode' },
      h('button', { class: 'tb fr-exit', 'data-f': 'exit', title: 'Back to the window (Esc)', html: `${EXIT_ICON}<span>WINDOW</span>` }),
      ...panels.map((p) => h('button', { class: 'tb', 'data-f': p.key, title: p.title || '' }, p.label)));
    for (const el of [this.edgeTop, this.edgeRight, this.rail]) { el.hidden = true; document.body.appendChild(el); }
    this.rail.addEventListener('mousedown', (e) => {
      e.preventDefault(); // the script keeps the keyboard
      const b = e.target.closest('[data-f]');
      if (!b) return;
      if (b.dataset.f === 'exit') return this.exit();
      const p = this.panels.find((x) => x.key === b.dataset.f);
      p.set(!p.isOpen());
      this.renderRail();
    });
    this.edgeTop.addEventListener('mouseenter', () => this.peek('top'));
    this.edgeRight.addEventListener('mouseenter', () => this.peek('rail'));
    this.timers = {};
  }

  toggle() { return this.on ? this.exit() : this.enter(); }

  /** The top bars, as they stand in the window (the toolbar only when it is shown). */
  bars() { return ['top', 'elbar', 'timeline'].map((id) => document.getElementById(id)).filter((el) => el && !el.hidden); }

  enter() {
    if (this.on) return;
    this.on = true;
    this.saved = this.panels.map((p) => p.isOpen());
    this.panels.forEach((p, i) => { if (this.saved[i]) p.set(false); });
    this.api.invoke('win:fullscreen', true);
    const root = document.documentElement, bars = this.bars(), status = document.getElementById('status');
    const up = bars.reduce((n, el) => n + el.offsetHeight, 0), down = status.offsetHeight;
    let anims = [];
    const done = () => {
      root.classList.add('focus');
      for (const a of anims) a.cancel();
      void root.offsetHeight; // (the bars arrive out of sight at once; only peeking slides them)
      root.classList.add('focus-ready');
      for (const el of [this.edgeTop, this.edgeRight]) el.hidden = false;
      this.onChange(true);
    };
    if (reducedMotion()) return done();
    // One move: the bars glide up and out, the status bar down, the page taking the room as they go.
    const opt = { duration: DUR, easing: EASE_IN_OUT, fill: 'forwards' };
    anims = [
      bars[0].animate([{ marginTop: '0px' }, { marginTop: -up + 'px' }], opt),
      ...bars.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], opt)),
      status.animate([{ marginBottom: '0px', opacity: 1 }, { marginBottom: -down + 'px', opacity: 0 }], opt),
    ];
    anims[0].onfinish = done;
    this.settle = setTimeout(() => { if (!root.classList.contains('focus') && this.on) done(); }, DUR + 120); // (a hidden window runs no animations)
  }

  exit() {
    if (!this.on) return;
    this.on = false;
    clearTimeout(this.settle);
    this.unpeek();
    for (const el of [this.edgeTop, this.edgeRight, this.rail]) el.hidden = true;
    this.api.invoke('win:fullscreen', false);
    const root = document.documentElement;
    root.classList.remove('focus', 'focus-ready', 'peek');
    // The bars come back the way they went.
    if (!reducedMotion()) {
      const bars = this.bars(), status = document.getElementById('status');
      const up = bars.reduce((n, el) => n + el.offsetHeight, 0), down = status.offsetHeight;
      const opt = { duration: DUR, easing: EASE_OUT };
      bars[0].animate([{ marginTop: -up + 'px' }, { marginTop: '0px' }], opt);
      for (const el of bars) el.animate([{ opacity: 0 }, { opacity: 1 }], opt);
      status.animate([{ marginBottom: -down + 'px', opacity: 0 }, { marginBottom: '0px', opacity: 1 }], opt);
    }
    // The panels as they were before, whatever was opened meanwhile.
    this.panels.forEach((p, i) => { if (p.isOpen() !== !!this.saved?.[i]) p.set(!!this.saved?.[i]); });
    this.saved = null;
    this.onChange(false);
  }

  /** The window left full screen some other way (a Mac's green button): focus mode ends with it. */
  fullscreenChanged(full) { if (!full && this.on) this.exit(); }

  // ---- what comes back on the pointer ------------------------------------------------------------

  /** The menus and toolbar ('top') or the rail ('rail') shown while the pointer is on them (or a menu of theirs is open). */
  peek(what) {
    if (!this.on) return;
    if (what === 'top') document.documentElement.classList.add('peek');
    else { this.renderRail(); this.rail.hidden = false; requestAnimationFrame(() => this.rail.classList.add('on')); }
    clearInterval(this.timers[what]);
    let away = 0;
    this.timers[what] = setInterval(() => {
      const keep = what === 'top'
        ? document.querySelector('#top:hover, #elbar:hover, #focus-edge-top:hover, .menu') || document.getElementById('doctitle').classList.contains('editing')
        : document.querySelector('#focus-rail:hover, #focus-edge-right:hover');
      away = keep ? 0 : away + 1;
      if (away * 90 >= LINGER) this.unpeek(what);
    }, 90);
  }

  /** Hide what peek() showed (both, when `what` is not given). */
  unpeek(what) {
    for (const w of what ? [what] : ['top', 'rail']) clearInterval(this.timers[w]);
    if (!what || what === 'top') document.documentElement.classList.remove('peek');
    if (!what || what === 'rail') this.rail.classList.remove('on');
  }

  renderRail() {
    for (const p of this.panels) this.rail.querySelector(`[data-f="${p.key}"]`).classList.toggle('on', p.isOpen());
  }
}
