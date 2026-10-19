// Find & replace bar. Searching is debounced and only reruns when the query,
// options or document revision change.

import { pos, cmp } from '../../core/editor.js';

export class FindBar {
  constructor({ editor, view, jump, focusEditor }) {
    this.ed = editor; this.view = view; this.jump = jump; this.focusEditor = focusEditor;
    const $ = (id) => document.getElementById(id);
    this.bar = $('findbar'); this.q = $('find-q'); this.r = $('find-r');
    this.cs = $('find-case'); this.ww = $('find-word'); this.countEl = $('find-count');
    this.matches = []; this.cur = -1; this.key = ''; this.timer = 0;
    this.q.addEventListener('input', () => this.schedule());
    this.cs.addEventListener('change', () => this.search(true));
    this.ww.addEventListener('change', () => this.search(true));
    $('find-next').addEventListener('click', () => this.next(1));
    $('find-prev').addEventListener('click', () => this.next(-1));
    $('find-one').addEventListener('click', () => this.replaceOne());
    $('find-all').addEventListener('click', () => this.replaceAll());
    $('find-close').addEventListener('click', () => this.close());
    this.bar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.target === this.r) { if (e.ctrlKey) this.replaceAll(); else this.replaceOne(); }
        else this.next(e.shiftKey ? -1 : 1);
      }
    });
  }

  get open() { return !this.bar.hidden; }

  show(replace = false) {
    this.bar.hidden = false;
    const sel = this.ed.hasSelection() ? this.ed.selectedText() : '';
    if (sel && !sel.includes('\n') && sel.length < 80) this.q.value = sel;
    (replace && this.q.value ? this.r : this.q).focus();
    this.q.select();
    this.search(true);
  }

  close() {
    this.bar.hidden = true;
    this.view.find = null;
    this.view.schedule();
    this.focusEditor();
  }

  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.search(), 90); }

  /** Re-run the search if anything relevant changed (called after edits too). */
  search(force = false) {
    if (!this.open) return;
    const key = `${this.q.value}\u0000${this.cs.checked}${this.ww.checked}\u0000${this.ed.rev}`;
    if (!force && key === this.key) return;
    this.key = key;
    this.matches = this.ed.findAll(this.q.value, { caseSensitive: this.cs.checked, wholeWord: this.ww.checked });
    // Current match = first one at/after the caret.
    const c = this.ed.ordered()[0];
    this.cur = this.matches.length ? Math.max(0, this.matches.findIndex((m) => cmp(pos(m.b, m.s), c) >= 0)) : -1;
    if (this.cur === -1 && this.matches.length) this.cur = 0;
    this.update();
  }

  update() {
    this.view.find = { matches: this.matches, cur: this.cur };
    this.countEl.textContent = this.q.value ? (this.matches.length ? `${this.cur + 1} / ${this.matches.length}` : 'no matches') : '';
    this.view.schedule();
  }

  next(dir) {
    this.search();
    if (!this.matches.length) return;
    const sel = this.ed.ordered();
    const onMatch = this.cur >= 0 && this.matches[this.cur] && cmp(sel[0], pos(this.matches[this.cur].b, this.matches[this.cur].s)) === 0 && cmp(sel[1], pos(this.matches[this.cur].b, this.matches[this.cur].e)) === 0;
    if (onMatch || dir < 0) this.cur = (this.cur + dir + this.matches.length) % this.matches.length;
    const m = this.matches[this.cur];
    this.jump(pos(m.b, m.s), false, pos(m.b, m.e));
    this.update();
  }

  replaceOne() {
    this.search();
    const m = this.matches[this.cur];
    if (!m) return;
    const sel = this.ed.ordered();
    if (cmp(sel[0], pos(m.b, m.s)) !== 0 || cmp(sel[1], pos(m.b, m.e)) !== 0) { this.next(1); return; }
    this.ed.replaceMatches([m], this.r.value);
    this.search(true);
    if (this.matches.length) { this.cur = Math.min(this.cur, this.matches.length - 1); this.next(0); }
  }

  replaceAll() {
    this.search(true);
    const n = this.ed.replaceMatches(this.matches, this.r.value);
    this.search(true);
    this.countEl.textContent = `replaced ${n}`;
  }
}
