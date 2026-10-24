// Side panels: scene navigator (left) and notes/comments (right).
// Both refresh lazily (on idle after edits) and only while visible.

import { pageOf } from '../../core/layout.js';
import { isOpen } from './motion.js';
import { linesOf } from '../../core/layout.js';
import { lineIndexOf } from '../../core/nav.js';
import { pos } from '../../core/editor.js';
import { esc } from './dialog.js';
import { keyText } from './commands.js';
import { rulerLabel } from '../../core/timeline.js';

// Scroll a panel's list (only the list) so a row is in view. scrollIntoView would also scroll the
// panel's own frame, which is offscreen while it slides in, and break the slide.
function reveal(list, row) {
  const l = list.getBoundingClientRect(), r = row.getBoundingClientRect();
  if (r.top < l.top) list.scrollTop += r.top - l.top;
  else if (r.bottom > l.bottom) list.scrollTop += Math.min(r.bottom - l.bottom, r.top - l.top);
}

function idle(fn) {
  return (window.requestIdleCallback || ((f) => setTimeout(f, 50)))(fn, { timeout: 300 });
}

export class ScenePanel {
  constructor(host, list, count, { editor, view, jump, times, editTime }) {
    this.host = host; this.list = list; this.count = count;
    this.ed = editor; this.view = view; this.jump = jump;
    this.times = times; // each scene's time on the timeline: () => (b) => { t, pinned }
    this.editTime = editTime;
    this.pending = false;
    this.lastKey = '';
    list.addEventListener('mousedown', (e) => {
      const r = e.target.closest('.row');
      if (!r) return;
      e.preventDefault();
      if (e.button === 0) this.jump(pos(+r.dataset.b, 0), true); // (a right-click is for its timecode)
    });
    // A right-click on a scene: its own timecode, as on the timeline.
    list.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.row');
      if (!r) return;
      e.preventDefault();
      this.editTime(+r.dataset.b, r.getBoundingClientRect());
    });
  }

  get visible() { return isOpen(this.host); }

  refresh() {
    if (!this.visible || this.pending) return;
    this.pending = true;
    idle(() => { this.pending = false; this.render(); });
  }

  render() {
    const scenes = this.ed.scenes();
    const pages = this.view.pages;
    const cur = this.ed.caret.b;
    let curIdx = -1;
    for (let i = 0; i < scenes.length; i++) if (scenes[i].b <= cur) curIdx = i;
    const at = this.times(), tms = scenes.map((s) => at(s.b));
    const key = scenes.map((s, i) => s.b + s.text + '@' + tms[i].t + (tms[i].pinned ? '*' : '')).join('|') + '#' + curIdx + '#' + pages.length;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.count.textContent = scenes.length ? `· ${scenes.length}` : '';
    if (!scenes.length) { this.list.innerHTML = `<div class="empty">No scene headings yet. ${keyText('type-scene') || 'Scene Heading in the Element menu'} starts one.</div>`; return; }
    let h = '';
    scenes.forEach((s, i) => {
      const pg = pageOf(pages, s.b, 0) + 1, tm = tms[i];
      h += `<div class="row${i === curIdx ? ' cur' : ''}" data-b="${s.b}" title="Scene ${i + 1}${tm.pinned ? ' · timecode pinned' : ''} (right-click for its timecode)"><span class="n${tm.pinned ? ' pin' : ''}">${rulerLabel(tm.t)}</span><span class="t">${esc(s.text || '—')}</span><span class="p">${pg}</span></div>`;
    });
    this.list.innerHTML = h;
    const c = this.list.querySelector('.cur');
    if (c) reveal(this.list, c);
  }
}

export class NotesPanel {
  constructor(host, list, count, { editor, view, session, jump, onChange }) {
    this.host = host; this.list = list; this.count = count;
    this.ed = editor; this.view = view; this.session = session; this.jump = jump; this.onChange = onChange;
    this.pending = false;
    this.lastKey = '';
    list.addEventListener('mousedown', (e) => {
      const q = e.target.closest('.q');
      if (q) { e.preventDefault(); this.select(q.closest('.note').dataset.id, true); return; }
      const del = e.target.closest('[data-del]');
      if (del) { e.preventDefault(); this.remove(del.dataset.del); }
    });
    list.addEventListener('input', (e) => {
      const ta = e.target.closest('textarea');
      if (!ta) return;
      const id = ta.closest('.note').dataset.id;
      // A note pasted in from another screenplay arrives without its text: it starts empty here.
      const now = new Date().toISOString();
      const c = this.session.doc.comments[id] ||= { text: '', created: now, modified: now };
      c.text = ta.value;
      c.modified = now;
      this.onChange();
    });
    list.addEventListener('focusin', (e) => {
      const n = e.target.closest('.note');
      if (n && this.view.activeComment !== n.dataset.id) { this.view.activeComment = n.dataset.id; this.view.schedule(); this.markCurrent(); }
    });
  }

  get visible() { return isOpen(this.host); }

  refresh(force = false) {
    if (!this.visible || this.pending) return;
    if (force) this.lastKey = '';
    this.pending = true;
    idle(() => { this.pending = false; this.render(); });
  }

  anchors() { return this.ed.commentAnchors(); }

  render() {
    const anchors = this.anchors();
    const key = anchors.map((a) => a.id + ':' + a.b).join('|') + '#' + this.view.pages.length;
    if (key === this.lastKey) return;
    // Don't rebuild while the user types in a note: the textarea would lose focus.
    if (this.list.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA' && this.lastKey) {
      const ids = [...this.list.querySelectorAll('.note')].map((n) => n.dataset.id).join('|');
      if (ids === anchors.map((a) => a.id).join('|')) return;
    }
    this.lastKey = key;
    this.count.textContent = anchors.length ? `· ${anchors.length}` : '';
    if (!anchors.length) {
      this.list.innerHTML = `<div class="empty">No notes. Select text and press ${keyText('note-add') || '+NOTE'}.</div>`;
      return;
    }
    const blocks = this.ed.blocks;
    let h = '';
    for (const a of anchors) {
      const c = this.session.doc.comments[a.id] || { text: '' };
      const b = blocks[a.b];
      const quote = b.text.slice(a.s, a.e).replace(/\s+/g, ' ');
      const pg = pageOf(this.view.pages, a.b, lineIndexOf(linesOf(b), a.s)) + 1;
      const when = c.modified ? new Date(c.modified).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      h += `<div class="note${a.id === this.view.activeComment ? ' cur' : ''}" data-id="${esc(a.id)}">
        <div class="q" title="Jump to text">p.${pg} — “${esc(quote.slice(0, 80))}”</div>
        <textarea spellcheck="true" placeholder="write a note…">${esc(c.text)}</textarea>
        <div class="meta"><span>${esc(when)}</span><button data-del="${esc(a.id)}">delete</button></div>
      </div>`;
    }
    this.list.innerHTML = h;
  }

  markCurrent() {
    for (const n of this.list.querySelectorAll('.note')) n.classList.toggle('cur', n.dataset.id === this.view.activeComment);
  }

  /** Make a note current, optionally jumping to its text and focusing its editor. */
  select(id, jumpTo = false, focusText = false) {
    this.view.activeComment = id;
    this.view.schedule();
    this.render();
    this.markCurrent();
    const a = this.anchors().find((x) => x.id === id);
    if (a && jumpTo) this.jump(pos(a.b, a.s), true, pos(a.b, a.e), true); // a glide to its passage, as for F8
    const n = this.list.querySelector(`.note[data-id="${CSS.escape(id)}"]`);
    if (n) {
      reveal(this.list, n);
      if (focusText) { const ta = n.querySelector('textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
  }

  remove(id) {
    this.ed.detachComment(id);
    if (this.view.activeComment === id) this.view.activeComment = null;
    this.lastKey = '';
    this.render();
  }

  /** Next/previous note relative to the caret. */
  step(dir) {
    const anchors = this.anchors();
    if (!anchors.length) return null;
    const c = this.ed.caret;
    let target;
    if (dir > 0) target = anchors.find((a) => a.b > c.b || (a.b === c.b && a.s > c.o)) || anchors[0];
    else target = [...anchors].reverse().find((a) => a.b < c.b || (a.b === c.b && a.s < c.o)) || anchors[anchors.length - 1];
    return target;
  }
}
