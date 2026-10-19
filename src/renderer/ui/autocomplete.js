// Inline autocomplete popup for scene headings, cues and transitions.

import { suggest } from '../../core/smart.js';

export class Autocomplete {
  constructor(el, editor, view) {
    this.el = el;
    this.ed = editor;
    this.view = view;
    this.items = [];
    this.sel = 0;
    this.from = 0;
    this.visible = false;
    this.suppressId = null; // element for which Esc dismissed the popup
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const it = e.target.closest('.it');
      if (it) { this.sel = +it.dataset.i; this.accept(); this.onAccepted && this.onAccepted(); }
    });
  }

  update() {
    const ed = this.ed;
    if (ed.hasSelection()) return this.hide();
    const p = ed.caret;
    const b = ed.blocks[p.b];
    // After Esc, stay quiet until the caret moves to another element.
    if (this.suppressId === b.id) return this.hide();
    this.suppressId = null;
    const names = b.type === 'character' ? ed.characterNames() : null;
    const s = suggest(ed.blocks, p.b, p.o, names);
    if (!s || !s.items.length) return this.hide();
    this.items = s.items;
    this.from = s.from;
    this.sel = 0;
    this.render();
  }

  render() {
    const r = this.view.caretRect();
    if (!r) return this.hide();
    const sc = this.view.scroller.getBoundingClientRect();
    const typed = this.ed.caret.o - this.from;
    const x = r.x - this.view.scroller.scrollLeft + sc.left - typed * this.view.cw - 9;
    const y = r.y - this.view.scroller.scrollTop + sc.top + r.h + 2;
    this.el.innerHTML = this.items.map((t, i) => `<div class="it${i === this.sel ? ' on' : ''}" data-i="${i}">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('');
    this.el.style.left = Math.max(4, x) + 'px';
    this.el.style.top = y + 'px';
    this.el.style.fontSize = Math.max(12, this.view.row * 0.85) + 'px';
    this.el.hidden = false;
    this.visible = true;
  }

  move(d) {
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    this.render();
  }

  accept() {
    const t = this.items[this.sel];
    this.hide();
    if (t != null) this.ed.complete(this.from, t);
  }

  hide(dismissed = false) {
    if (dismissed) this.suppressId = this.ed.block.id;
    this.el.hidden = true;
    this.visible = false;
  }
}
