// Side panels: scene navigator (left) and notes/comments (right).
// Both refresh lazily (on idle after edits) and only while visible.

import { pageOf } from '../../core/layout.js';
import { isOpen, reducedMotion, DUR_PANEL, EASE_IN_OUT, EASE_OUT } from './motion.js';
import { arm } from './arm.js';
import { linesOf } from '../../core/layout.js';
import { lineIndexOf } from '../../core/nav.js';
import { pos } from '../../core/editor.js';
import { esc, h as el } from './dialog.js';
import { keyText, popup } from './commands.js';
import { rulerLabel, formatTime } from '../../core/timeline.js';
import { dialogueWords, wordsPerMinute } from '../../core/text.js';
import { HIGHLIGHT_COLORS } from '../../core/model.js';

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
  constructor(host, list, count, { editor, view, jump, times, runtime, editTime, focusEditor }) {
    this.host = host; this.list = list; this.count = count;
    this.ed = editor; this.view = view; this.jump = jump; this.focusEditor = focusEditor;
    this.times = times; // each scene's time on the timeline: () => (b) => { t, pinned }
    this.runtime = runtime; // the script's length in seconds, by the timecodes
    this.wpmEl = host.querySelector('#scene-wpm');
    this.runEl = host.querySelector('#scene-runtime');
    this.editTime = editTime;
    this.pending = false;
    this.lastKey = '';
    list.addEventListener('mousedown', (e) => {
      const r = e.target.closest('.row');
      if (!r || e.target.closest('.t.editing')) return;
      e.preventDefault();
      if (e.button === 0) this.jump(pos(+r.dataset.b, 0), true); // (a right-click is for its timecode)
    });
    // A double-click on a scene renames it: its heading becomes a field (as the title does).
    list.addEventListener('dblclick', (e) => {
      const r = e.target.closest('.row');
      if (r && !e.target.closest('.t.editing')) this.rename(+r.dataset.b, r.querySelector('.t'));
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

  /** Redraw on idle; `now` (the panel opening) at once, so it never shows the scenes of a screenplay
   *  closed since, even for a moment. */
  refresh(now = false) {
    if (!this.visible) return;
    if (now) return this.render();
    if (this.pending) return;
    this.pending = true;
    idle(() => { this.pending = false; this.render(); });
  }

  /** Rename scene heading b in place: Enter (or clicking away) writes the new heading into the
   *  script as one undoable step; Escape leaves it as it was. */
  rename(b, t) {
    if (!t || this.renaming) return;
    const was = this.ed.blocks[b]?.text ?? '';
    this.renaming = true;
    t.textContent = was;
    t.contentEditable = 'plaintext-only';
    t.classList.add('editing');
    t.focus();
    getSelection().selectAllChildren(t);
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      t.removeEventListener('keydown', onKey);
      t.removeEventListener('blur', onBlur);
      removeEventListener('mousedown', onDown, true);
      t.contentEditable = 'false';
      t.classList.remove('editing');
      getSelection().removeAllRanges();
      this.renaming = false;
      const name = t.textContent.replace(/\s+/g, ' ').trim();
      const blk = this.ed.blocks[b];
      if (keep && name && name !== was && blk && blk.type === 'scene' && blk.text === was) this.ed.replaceRanges([{ b, s: 0, e: was.length }], [name]);
      this.lastKey = '';
      this.render();
      this.focusEditor?.();
    };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    const onDown = (e) => { if (!t.contains(e.target)) finish(true); };
    t.addEventListener('keydown', onKey);
    t.addEventListener('blur', onBlur);
    addEventListener('mousedown', onDown, true);
  }

  render() {
    if (this.renaming) return; // (the field stays as it is until the rename ends)
    const scenes = this.ed.scenes();
    const pages = this.view.pages;
    const cur = this.ed.caret.b;
    let curIdx = -1;
    for (let i = 0; i < scenes.length; i++) if (scenes[i].b <= cur) curIdx = i;
    const at = this.times(), tms = scenes.map((s) => at(s.b));
    this.renderFoot();
    const key = scenes.map((s, i) => s.b + s.text + '@' + tms[i].t + (tms[i].pinned ? '*' : '')).join('|') + '#' + curIdx + '#' + pages.length;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.count.textContent = scenes.length ? `· ${scenes.length}` : '';
    if (!scenes.length) { this.list.innerHTML = `<div class="empty">No scene headings yet. ${keyText('type-scene') || 'Scene Heading in the Element menu'} starts one.</div>`; return; }
    let h = '';
    scenes.forEach((s, i) => {
      const pg = pageOf(pages, s.b, 0) + 1, tm = tms[i];
      h += `<div class="row${i === curIdx ? ' cur' : ''}" data-b="${s.b}" title="Scene ${i + 1}${tm.pinned ? ' · timecode pinned' : ''} (double-click to rename, right-click for its timecode)"><span class="n${tm.pinned ? ' pin' : ''}">${rulerLabel(tm.t)}</span><span class="t">${esc(s.text || '—')}</span><span class="p">${pg}</span></div>`;
    });
    this.list.innerHTML = h;
    const c = this.list.querySelector('.cur');
    if (c) reveal(this.list, c);
  }

  /** The foot: the runtime by the timecodes, and the dialogue's words a minute over it. */
  renderFoot() {
    const sec = Math.round(this.runtime()), words = dialogueWords(this.ed.blocks), wpm = wordsPerMinute(words, sec);
    const run = formatTime(sec), w = wpm == null ? '' : `${wpm} WPM`;
    if (this.runEl.textContent !== run) this.runEl.textContent = run;
    if (this.wpmEl.textContent !== w) this.wpmEl.textContent = w;
    this.wpmEl.title = `Dialogue words a minute: ${words.toLocaleString()} words of dialogue over ${run}`;
  }
}

const TRASH_ICON = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M4.5 3V1.8h3V3M3 3l.6 7.2h4.8L9 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const PIN_ICON = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path class="head" d="M4.2 1.4h3.6l-.5 3.3 1.9 1.8v.9H2.8v-.9l1.9-1.8z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6 7.4v3.4" stroke="currentColor" stroke-width="1.2"/></svg>';
const X_ICON = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const NOTE_COLORS = [...HIGHLIGHT_COLORS, null]; // (as in the toolbar: the colours, then none)

export class NotesPanel {
  constructor(host, list, count, { editor, view, session, jump, onChange, onMark }) {
    this.host = host; this.list = list; this.count = count;
    this.ed = editor; this.view = view; this.session = session; this.jump = jump; this.onChange = onChange;
    this.onMark = onMark; // a note's colour changed, or the filter (the timeline and the script show it)
    this.pending = false;
    this.lastKey = '';
    // The header: a colour filter (the notes of one colour, everywhere: here, the script, the timeline)
    // and CLEAR ALL, which takes a second press (ui/arm.js) and deletes every note listed.
    const head = host.querySelector('.panel-head');
    this.filterBtn = head.querySelector('#notes-filter');
    this.clearBtn = head.querySelector('#notes-clear');
    for (const b of [this.filterBtn, this.clearBtn]) b.addEventListener('mousedown', (e) => e.preventDefault()); // (the script keeps the keyboard)
    this.filterBtn.addEventListener('mousedown', (e) => { if (e.button === 0) popup(this.filterBtn, () => this.filterItems()); });
    this.clearBtn.addEventListener('click', () => arm(this.clearBtn, () => this.clearAll(), { title: 'Press again to delete every note listed' }));
    this.renderFilter();
    list.addEventListener('mousedown', (e) => {
      const note = e.target.closest('.note');
      if (!note || e.button !== 0) return;
      const btn = e.target.closest('button');
      // Anywhere on the card but its buttons and its text (the passage, the header, the margins):
      // the note's page, centred, as for the passage itself. A pinned card can also be dragged among
      // the pinned ones, to put them in another order.
      if (!btn) {
        if (e.target.closest('textarea')) return;
        e.preventDefault();
        if (note.classList.contains('pinned') && !reducedMotion()) return this.press(e, note);
        this.select(note.dataset.id, true); return;
      }
      e.preventDefault(); // (a note being written keeps the focus)
      const id = note.dataset.id;
      // Delete takes a second press (ui/arm.js), shown by an X that waits, with no countdown, until a
      // press lands elsewhere; then the note folds away.
      if (btn.dataset.x === 'del') arm(btn, () => this.fold(id), { icon: X_ICON, title: 'Press again to delete this note' });
      else if (btn.dataset.x === 'pin') this.pin(id);
      else if (btn.dataset.x === 'col') this.pick(btn.closest('.note').classList.contains('picking') ? null : id);
      else if (btn.dataset.sw != null) { this.setColor(id, btn.dataset.sw || null); this.pick(null); }
    });
    // The swatches close on a press anywhere else, or Esc.
    addEventListener('mousedown', (e) => { if (!e.target.closest?.('.nsws, [data-x="col"]')) this.pick(null); }, true);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.list.querySelector('.picking')) { e.stopPropagation(); this.pick(null); } }, true);
    list.addEventListener('input', (e) => {
      const ta = e.target.closest('textarea');
      if (!ta) return;
      const id = ta.closest('.note').dataset.id;
      const c = this.body(id);
      c.text = ta.value;
      c.modified = new Date().toISOString();
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

  comment(id) { return this.session.doc.comments[id] || {}; }

  /** Note `id`'s own record, to change. A note pasted in from another screenplay arrives without
   *  one: it starts empty here. */
  body(id) {
    const now = new Date().toISOString();
    return this.session.doc.comments[id] ||= { text: '', created: now, modified: now };
  }

  /** The notes in the order listed, those the colour filter lets through: the pinned ones first, the
   *  one pinned last at the top (or as dragged), then the rest in script order. */
  listed() {
    const all = this.anchors().filter((a) => this.view.noteShown(a.id)), pinned = all.filter((a) => this.comment(a.id).pinned);
    const rank = (a) => this.comment(a.id).pinOrder || 0;
    return pinned.length ? [...pinned.sort((a, b) => rank(b) - rank(a)), ...all.filter((a) => !this.comment(a.id).pinned)] : all;
  }

  /** The colour filter's menu: every note, each colour, or the notes with none. */
  filterItems() {
    const NAMES = { null: 'All Notes', none: 'No Colour' };
    return [null, ...HIGHLIGHT_COLORS, 'none'].flatMap((f, i) => {
      const label = el('span', { class: 'mi-sw' }, el('span', { class: 'sw ' + (f === null ? 'all' : f) }), NAMES[f] || f[0].toUpperCase() + f.slice(1));
      const item = { label, checked: () => this.view.noteFilter === f, run: () => this.setFilter(f) };
      return i === 1 || f === 'none' ? ['-', item] : [item];
    });
  }

  setFilter(f) {
    if (this.view.noteFilter === f) return;
    this.view.noteFilter = f;
    this.renderFilter();
    this.lastKey = '';
    this.render();
    this.onMark?.();
  }

  renderFilter() {
    const f = this.view.noteFilter;
    this.filterBtn.classList.toggle('on', !!f);
    this.filterBtn.querySelector('i').className = 'sw ' + (f || 'all');
    this.filterBtn.title = f ? `Showing only the notes ${f === 'none' ? 'with no colour' : 'in ' + f} (click to change)` : 'Show only the notes of one colour';
  }

  /** Delete every note listed (the filter's, when there is one), with their colours: one undo brings them back. */
  clearAll() {
    const ids = this.listed().map((a) => a.id);
    if (!ids.length) return;
    this.ed.detachComment(ids);
    if (ids.includes(this.view.activeComment)) this.view.activeComment = null;
    this.lastKey = '';
    this.render();
    this.onChange();
    this.onMark?.();
  }

  /** A press on a pinned card: a click goes to its passage; a drag moves it among the pinned cards,
   *  the others gliding aside to make room, and lets it settle in its new place. */
  press(e, note) {
    const y0 = e.clientY, id = note.dataset.id;
    let drag = null;
    const z = () => parseFloat(getComputedStyle(note).zoom) || 1;
    const glide = (cards, before) => { for (const n of cards) { const dy = (before.get(n) - n.getBoundingClientRect().top) / z(); if (dy) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 160, easing: EASE_OUT }); } };
    const move = (ev) => {
      if (!drag) {
        if (Math.abs(ev.clientY - y0) < 4) return;
        drag = { top: note.getBoundingClientRect().top };
        note.classList.add('lift', 'dragging');
        document.body.classList.add('note-drag');
      }
      // Its place: before the first other pinned card whose middle is below the pointer.
      const others = [...this.list.querySelectorAll('.note.pinned')].filter((n) => n !== note);
      const at = others.find((n) => { const r = n.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      const ref = at || (others.length ? others[others.length - 1].nextElementSibling : null);
      if (ref !== note && ref !== note.nextElementSibling) {
        const before = new Map(others.map((n) => [n, n.getBoundingClientRect().top]));
        this.list.insertBefore(note, ref);
        glide(others, before);
      }
      note.style.transform = 'none';
      const nat = note.getBoundingClientRect().top;
      note.style.transform = `translateY(${(ev.clientY - y0 + drag.top - nat) / z()}px)`;
    };
    const up = () => {
      removeEventListener('mousemove', move, true);
      removeEventListener('mouseup', up, true);
      removeEventListener('blur', up);
      if (!drag) return this.select(id, true);
      document.body.classList.remove('note-drag');
      const off = note.style.transform;
      note.style.transform = '';
      note.classList.remove('dragging');
      const a = note.animate([{ transform: off || 'none' }, { transform: 'none' }], { duration: 160, easing: EASE_OUT });
      a.onfinish = a.oncancel = () => note.classList.remove('lift');
      // The new order, top first: the highest rank at the top.
      const cards = [...this.list.querySelectorAll('.note.pinned')];
      cards.forEach((n, i) => { this.body(n.dataset.id).pinOrder = cards.length - i; });
      this.lastKey = '';
      this.onChange();
    };
    addEventListener('mousemove', move, true);
    addEventListener('mouseup', up, true);
    addEventListener('blur', up);
  }

  /** The scene a block is in: { n: its number, text } (null before the first scene heading). */
  sceneOf(scenes, b) {
    let lo = 0, hi = scenes.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (scenes[m].b <= b) { k = m; lo = m + 1; } else hi = m - 1; }
    return k < 0 ? null : { n: k + 1, text: scenes[k].text };
  }

  render() {
    const anchors = this.listed();
    const scenes = this.ed.scenes();
    const key = anchors.map((a) => a.id + ':' + a.b + (this.comment(a.id).pinned ? '*' + (this.comment(a.id).pinOrder || 0) : '') + (this.ed.noteColors().get(a.id) || '') + '@' + (this.sceneOf(scenes, a.b)?.text ?? '')).join('|') + '#' + this.view.pages.length + '#' + this.view.noteFilter;
    if (key === this.lastKey) return;
    // Don't rebuild while the user types in a note (the textarea would lose focus, and the next keys
    // with it) or a delete waits for its second press: not even for a forced refresh, such as the one
    // that comes a moment after +NOTE, often once the writing has begun. The same notes need no rebuild.
    if ((this.list.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') || this.list.querySelector('.armed')) {
      const ids = [...this.list.querySelectorAll('.note')].map((n) => n.dataset.id).join('|');
      if (ids === anchors.map((a) => a.id).join('|')) return;
    }
    this.lastKey = key;
    this.count.textContent = anchors.length ? `· ${anchors.length}` : '';
    this.clearBtn.disabled = !anchors.length;
    if (!anchors.length) {
      this.list.innerHTML = this.view.noteFilter && this.anchors().length
        ? `<div class="empty">No notes in this colour.<span class="hint">The filter at the top shows them all again.</span></div>`
        : `<div class="empty">No notes yet.<span class="hint">Select a passage and press +NOTE${keyText('note-add') ? ' (' + keyText('note-add') + ')' : ''}.</span></div>`;
      return;
    }
    const blocks = this.ed.blocks;
    let h = '';
    for (const a of anchors) {
      const c = this.session.doc.comments[a.id] || { text: '' }, color = this.ed.noteColors().get(a.id);
      const b = blocks[a.b];
      const quote = b.text.slice(a.s, a.e).replace(/\s+/g, ' ');
      const pg = pageOf(this.view.pages, a.b, lineIndexOf(linesOf(b), a.s)) + 1, sc = this.sceneOf(scenes, a.b);
      const scene = sc ? sc.text.trim() || `Scene ${sc.n}` : 'Before the first scene';
      // When: the time if it was today, else the day (both in full on the pointer).
      const d = c.modified ? new Date(c.modified) : null, today = d && d.toDateString() === new Date().toDateString();
      const when = d ? d.toLocaleString([], today ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }) : '';
      const whenFull = d ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      // A card: the scene it is in and when it was written (and, on the pointer, its colour, pin and
      // bin), the passage it is about, then the note itself.
      const sws = NOTE_COLORS.map((k) => `<button class="nsw" data-sw="${k || ''}" title="${k ? 'Mark ' + k : 'No colour'}" aria-label="${k || 'no colour'}"><span class="sw ${k || 'none'}"></span></button>`).join('');
      h += `<div class="note${a.id === this.view.activeComment ? ' cur' : ''}${color ? ' c-' + color : ''}${c.pinned ? ' pinned' : ''}" data-id="${esc(a.id)}">
        <div class="nh"><span class="sc" title="${esc(scene)} · page ${pg}">${esc(scene)}</span><span class="when" title="${esc(whenFull)}">${esc(when)}</span><span class="nacts"><span class="nsws">${sws}</span><button class="nb ncol" data-x="col" title="Colour" aria-label="Colour"><i></i></button><button class="nb npin" data-x="pin" title="${c.pinned ? 'Unpin' : 'Pin to the top'}" aria-label="${c.pinned ? 'Unpin' : 'Pin'}">${PIN_ICON}</button><button class="nb ndel" data-x="del" title="Delete this note (press twice)" aria-label="Delete">${TRASH_ICON}</button></span></div>
        <div class="q" dir="auto" title="Go to the passage">${esc(quote.slice(0, 160))}</div>
        <textarea spellcheck="true" dir="auto" placeholder="Write a note…">${esc(c.text)}</textarea>
      </div>`;
    }
    // Rebuilt under a note being written (pinned or unpinned, it moved): it keeps the focus and the caret.
    const ta = this.list.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null;
    const typing = ta && { id: ta.closest('.note').dataset.id, s: ta.selectionStart, e: ta.selectionEnd };
    this.list.innerHTML = h;
    if (typing) {
      const t = this.card(typing.id)?.querySelector('textarea');
      if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(typing.s, typing.e); }
    }
  }

  card(id) { return this.list.querySelector(`.note[data-id="${CSS.escape(id)}"]`); }

  /** Show the colour swatches on note `id` (null: on none). */
  pick(id) {
    for (const n of this.list.querySelectorAll('.note.picking')) if (n.dataset.id !== id) n.classList.remove('picking');
    if (id) this.card(id)?.classList.add('picking');
  }

  /** Give note `id` a colour (null: none): its passage is highlighted in it (editor.noteColors()), which
   *  shows on its card, its marker in the script and the timeline. */
  setColor(id, color) {
    const range = this.ed.noteRange(id);
    if (!range || (this.ed.noteColors().get(id) || null) === color) return;
    this.ed.highlight(color, range);
    const n = this.card(id);
    if (n) { for (const k of HIGHLIGHT_COLORS) n.classList.toggle('c-' + k, k === color); }
    this.onChange();
    this.onMark?.();
  }

  /** Pin note `id` to the top of the list, or unpin it back to its place in the script. The cards
   *  glide to their new places: the note moved over the others, the others making room. */
  pin(id) {
    const c = this.body(id);
    if (c.pinned) { delete c.pinned; delete c.pinOrder; } else {
      c.pinned = true; // at the top: above every other pinned one
      c.pinOrder = 1 + Math.max(0, ...Object.values(this.session.doc.comments).map((x) => (x.pinned && x.pinOrder) || 0));
    }
    this.onChange();
    const before = new Map([...this.list.querySelectorAll('.note')].map((n) => [n.dataset.id, n.getBoundingClientRect().top]));
    this.lastKey = '';
    this.render();
    const moved = this.card(id);
    if (!moved) return;
    reveal(this.list, moved);
    if (reducedMotion()) return;
    for (const n of this.list.querySelectorAll('.note')) {
      // (on the screen; the card's own pixels are scaled by the panel's zoom, style.css --pz-notes)
      const dy = (before.get(n.dataset.id) - n.getBoundingClientRect().top) / (parseFloat(getComputedStyle(n).zoom) || 1);
      if (!dy) continue;
      if (n === moved) n.classList.add('lift');
      const a = n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: n === moved ? 240 : 200, easing: EASE_OUT });
      if (n === moved) a.onfinish = a.oncancel = () => n.classList.remove('lift');
    }
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
    if (a && jumpTo) this.jump(pos(a.b, a.s), true, null, 'key'); // a glide to its passage, as for F8: the caret at its start, nothing selected
    const n = this.list.querySelector(`.note[data-id="${CSS.escape(id)}"]`);
    if (n) {
      reveal(this.list, n);
      if (focusText) { const ta = n.querySelector('textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
  }

  /** The note folds shut, then goes (its passage keeps its text; only the note is removed). */
  fold(id) {
    const n = this.list.querySelector(`.note[data-id="${CSS.escape(id)}"]`);
    if (!n || reducedMotion()) return this.remove(id);
    n.style.pointerEvents = 'none';
    const a = n.animate([{ height: n.offsetHeight + 'px', opacity: 1 }, { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }], { duration: DUR_PANEL, easing: EASE_IN_OUT, fill: 'forwards' });
    let done = false;
    const go = () => { if (done) return; done = true; this.remove(id); };
    a.onfinish = go;
    setTimeout(go, DUR_PANEL + 80); // (a background window doesn't run animations)
  }

  remove(id) {
    this.ed.detachComment(id); // (its colour, the highlight on its passage, goes with it)
    if (this.view.activeComment === id) this.view.activeComment = null;
    this.lastKey = '';
    this.render();
  }

  /** Next/previous note relative to the caret. */
  step(dir) {
    const anchors = this.anchors().filter((a) => this.view.noteShown(a.id));
    if (!anchors.length) return null;
    const c = this.ed.caret;
    let target;
    if (dir > 0) target = anchors.find((a) => a.b > c.b || (a.b === c.b && a.s > c.o)) || anchors[0];
    else target = [...anchors].reverse().find((a) => a.b < c.b || (a.b === c.b && a.s < c.o)) || anchors[anchors.length - 1];
    return target;
  }
}
