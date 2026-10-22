// Keyboard, mouse, clipboard and IME input for the page view.
// A hidden <textarea> holds focus and receives text; everything else is
// interpreted here and turned into editor commands.

import * as nav from '../core/nav.js';
import { pos, cmp } from '../core/editor.js';
import { wordAt } from '../core/text.js';
import { toPlainText, parsePlainText } from '../core/plaintext.js';
import { WheelZoom, stepZoom } from '../core/wheelzoom.js';
import { MAC } from '../core/keys.js';
import { cueName } from '../core/model.js';
import { suggestCue } from '../core/cast.js';

export class Input {
  constructor({ textarea, view, editor, onCommandKey, onCommentClick }) {
    this.ta = textarea;
    this.view = view;
    this.ed = editor;
    this.onCommandKey = onCommandKey;
    this.onCommentClick = onCommentClick;
    this.goalCol = null;
    this.composing = false;
    this.lastCopy = null;
    this.drag = null;
    this.names = () => [];  // the cast in suggestion order (app.js)
    this.onCue = null;      // a character cue was finished: its name

    const ta = textarea;
    ta.addEventListener('keydown', (e) => this.keydown(e));
    ta.addEventListener('input', (e) => this.input(e));
    ta.addEventListener('compositionstart', () => { this.composing = true; ta.classList.add('composing'); this.placeTextarea(); });
    ta.addEventListener('compositionend', (e) => {
      this.composing = false;
      ta.classList.remove('composing');
      ta.value = '';
      if (e.data) this.typed(e.data);
    });
    ta.addEventListener('copy', (e) => this.copy(e, false));
    ta.addEventListener('cut', (e) => this.copy(e, true));
    ta.addEventListener('paste', (e) => this.paste(e));
    ta.addEventListener('focus', () => { view.focused = true; view.schedule(); });
    ta.addEventListener('blur', () => { view.focused = false; view.schedule(); });

    const sc = view.scroller;
    sc.addEventListener('mousedown', (e) => this.mousedown(e));
    window.addEventListener('mousemove', (e) => this.mousemove(e));
    window.addEventListener('mouseup', () => { if (this.drag) { this.drag = null; clearInterval(this.autoScroll); } });
    const wz = new WheelZoom();
    sc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !(MAC && e.metaKey)) return; // a trackpad pinch arrives with ctrlKey
      e.preventDefault();
      const steps = wz.feed(e.deltaY, e.deltaMode, e.timeStamp);
      if (!steps) return;
      view.setZoom(stepZoom(view.z, steps), e.clientY);
      if (this.onZoom) this.onZoom();
    }, { passive: false });
  }

  focus() { this.ta.focus({ preventScroll: true }); }

  placeTextarea() {
    const r = this.view.caretRect();
    if (!r) return;
    const sc = this.view.scroller.getBoundingClientRect();
    const x = r.x - this.view.scroller.scrollLeft + sc.left;
    const y = r.y - this.view.scroller.scrollTop + sc.top;
    Object.assign(this.ta.style, { left: x + 'px', top: y + 'px', height: r.h + 'px', fontSize: this.view.row + 'px', lineHeight: r.h + 'px' });
  }

  // ---- text ------------------------------------------------------------------

  input() {
    if (this.composing) return;
    const v = this.ta.value;
    this.ta.value = '';
    if (v) this.typed(v);
  }

  typed(text) {
    this.goalCol = null;
    this.ed.insertText(text);
    this.suggest();
    this.after();
  }

  // ---- character cues ------------------------------------------------------------

  /**
   * While a character cue is typed at its end, the rest of the first matching name in
   * the cast shows in grey after the caret (view.ghost). Enter, Tab or Right takes it;
   * any other key or a click leaves it, and Escape just hides it.
   */
  suggest() {
    const ed = this.ed, p = ed.caret, b = ed.block;
    const ok = b.type === 'character' && !ed.hasSelection() && p.o === b.text.length;
    const rest = ok ? suggestCue(b.text, this.names()) : '';
    this.view.setGhost(rest ? { b: p.b, o: p.o, text: rest } : null);
  }

  /** The suggestion, if it is still where it was made. */
  liveGhost() {
    const g = this.view.ghost, ed = this.ed;
    if (!g) return null;
    const p = ed.caret, b = ed.blocks[g.b];
    return !ed.hasSelection() && p.b === g.b && p.o === g.o && b && b.type === 'character' && b.text.length === g.o ? g : null;
  }

  /** A cue is finished (Enter, or a suggestion taken): its name becomes the most recent. */
  cueDone() {
    const b = this.ed.block;
    if (b.type !== 'character' || !this.onCue) return;
    const name = cueName(b.text);
    if (name) this.onCue(name);
  }

  /** Common post-edit work: lay out, repaint and reveal the caret. */
  after() {
    this.view.relayout();
    this.view.frame();
    this.view.revealCaret();
    this.placeTextarea();
  }

  // ---- keyboard --------------------------------------------------------------------

  keydown(e) {
    if (this.composing || e.isComposing) return;
    const ed = this.ed;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return;
    const g = this.view.ghost && this.liveGhost();
    if (this.view.ghost) this.view.setGhost(null);
    if (g && !mod && !e.altKey) {
      if (k === 'Escape') { e.preventDefault(); return; }
      if ((k === 'Tab' || k === 'ArrowRight') && !e.shiftKey) {
        ed.insertText(g.text); this.cueDone(); this.goalCol = null; this.after(); e.preventDefault(); return;
      }
      if (k === 'Enter' && !e.shiftKey) ed.insertText(g.text);
    }

    // Commands (save, element types, find, ...) first.
    if (this.onCommandKey(e)) { e.preventDefault(); return; }

    const ext = e.shiftKey;
    // On a Mac, Option moves and deletes by word, and Command goes to the ends of the line
    // (or of the screenplay, up and down), as in every Mac text field.
    const word = MAC ? e.altKey && !e.metaKey : mod;
    const edge = MAC && e.metaKey;
    let move = null;
    let keepGoal = false;
    const p = ed.caret;
    switch (k) {
      case 'ArrowLeft':
        if (ed.hasSelection() && !ext) move = ed.ordered()[0];
        else move = edge ? nav.lineHome(ed.blocks, p) : word ? nav.wordLeftPos(ed.blocks, p) : nav.left(ed.blocks, p);
        break;
      case 'ArrowRight':
        if (ed.hasSelection() && !ext) move = ed.ordered()[1];
        else move = edge ? nav.lineEnd(ed.blocks, p) : word ? nav.wordRightPos(ed.blocks, p) : nav.right(ed.blocks, p);
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        if (e.altKey) return; // scene navigation is a command
        const dir = k === 'ArrowUp' ? -1 : 1;
        if (edge) { const lb = ed.blocks.length - 1; move = dir < 0 ? pos(0, 0) : pos(lb, ed.blocks[lb].text.length); break; }
        if (word) { move = this.paragraphMove(p, dir); break; }
        if (this.goalCol == null) this.goalCol = nav.columnOf(ed.blocks, p);
        move = nav.vertical(ed.blocks, p, dir, this.goalCol);
        keepGoal = true;
        break;
      }
      case 'Home': move = word ? pos(0, 0) : nav.lineHome(ed.blocks, p); break;
      case 'End': {
        const lb = ed.blocks.length - 1;
        move = word ? pos(lb, ed.blocks[lb].text.length) : nav.lineEnd(ed.blocks, p);
        break;
      }
      case 'PageUp':
      case 'PageDown': move = this.pageMove(k === 'PageUp' ? -1 : 1); keepGoal = true; break;
      case 'Backspace':
        if (edge && !ed.hasSelection()) ed.setSel(nav.lineHome(ed.blocks, p), p);
        ed.backspace(word); this.goalCol = null; this.after(); e.preventDefault(); return;
      case 'Delete':
        if (edge && !ed.hasSelection()) ed.setSel(p, nav.lineEnd(ed.blocks, p));
        ed.deleteForward(word); this.goalCol = null; this.after(); e.preventDefault(); return;
      case 'Enter':
        if (mod) return;
        if (ext) ed.softBreak(); else { this.cueDone(); ed.enter(); }
        this.goalCol = null; this.after(); e.preventDefault(); return;
      case 'Tab':
        if (mod) return;
        ed.tab(ext); this.after(); e.preventDefault(); return;
      case 'Escape':
        if (this.onEscape && this.onEscape()) { e.preventDefault(); return; }
        if (ed.hasSelection()) { ed.setSel(ed.caret); this.after(); }
        return;
      default:
        if (mod && (k === 'a' || k === 'A') && !e.altKey) { ed.selectAll(); this.after(); e.preventDefault(); return; }
        if (mod && !e.altKey && (k === 'z' || k === 'Z')) { if (ext) ed.redo(); else ed.undo(); this.after(); e.preventDefault(); return; }
        if (mod && !e.altKey && (k === 'y' || k === 'Y')) { ed.redo(); this.after(); e.preventDefault(); return; }
        return; // printable keys arrive through the input event
    }
    e.preventDefault();
    if (!keepGoal) this.goalCol = null;
    if (move) {
      ed.setSel(ext ? ed.sel.a : move, move);
      this.after();
    }
  }

  paragraphMove(p, dir) {
    const ed = this.ed;
    if (dir < 0) return p.o > 0 ? pos(p.b, 0) : pos(Math.max(0, p.b - 1), 0);
    return p.b < ed.blocks.length - 1 ? pos(p.b + 1, 0) : pos(p.b, ed.blocks[p.b].text.length);
  }

  pageMove(dir) {
    const v = this.view;
    const r = v.caretRect();
    if (!r) return null;
    const dy = dir * (v.scroller.clientHeight - v.row * 3);
    const sc = v.scroller.getBoundingClientRect();
    const target = v.posAt(r.x - v.scroller.scrollLeft + sc.left + 1, r.y + dy - v.scroller.scrollTop + sc.top + 1);
    v.scroller.scrollTop += dy;
    return target;
  }

  // ---- mouse -----------------------------------------------------------------------

  mousedown(e) {
    if (e.button !== 0) return;
    if (this.view.ghost) this.view.setGhost(null);
    const t = e.target;
    if (t.closest && t.closest('.tp-f')) return; // title page fields handle themselves
    if (t.classList && t.classList.contains('cmtick')) { e.preventDefault(); this.onCommentClick(t.dataset.c); return; }
    if (!t.closest || !t.closest('.page')) {
      // Click on the desk: just focus the editor.
      e.preventDefault(); this.focus(); return;
    }
    e.preventDefault();
    this.focus();
    const ed = this.ed;
    const p = this.view.posAt(e.clientX, e.clientY);
    this.goalCol = null;
    if (e.detail === 2) {
      const [s, z] = wordAt(ed.blocks[p.b].text, p.o);
      ed.setSel(pos(p.b, s), pos(p.b, z));
      this.drag = { mode: 'word', origin: [pos(p.b, s), pos(p.b, z)] };
    } else if (e.detail >= 3) {
      ed.setSel(pos(p.b, 0), pos(p.b, ed.blocks[p.b].text.length));
      this.drag = { mode: 'block', origin: [pos(p.b, 0), pos(p.b, ed.blocks[p.b].text.length)] };
    } else {
      ed.setSel(e.shiftKey ? ed.sel.a : p, p);
      this.drag = { mode: 'char' };
    }
    this.lastMouse = e;
    clearInterval(this.autoScroll);
    this.autoScroll = setInterval(() => this.edgeScroll(), 30);
    this.after();
  }

  mousemove(e) {
    if (!this.drag) return;
    this.lastMouse = e;
    this.extendTo(e.clientX, e.clientY);
  }

  extendTo(cx, cy) {
    const ed = this.ed;
    const p = this.view.posAt(cx, cy);
    if (this.drag.mode === 'char') {
      if (cmp(p, ed.caret) !== 0) { ed.setSel(ed.sel.a, p); this.view.frame(); }
      return;
    }
    const [o0, o1] = this.drag.origin;
    const blocks = ed.blocks;
    let a, f;
    if (cmp(p, o0) < 0) {
      a = o1;
      f = this.drag.mode === 'word' ? pos(p.b, wordAt(blocks[p.b].text, p.o)[0]) : pos(p.b, 0);
    } else {
      a = o0;
      f = this.drag.mode === 'word' ? pos(p.b, wordAt(blocks[p.b].text, p.o)[1]) : pos(p.b, blocks[p.b].text.length);
      if (cmp(f, o1) < 0) f = o1;
    }
    ed.setSel(a, f);
    this.view.frame();
  }

  edgeScroll() {
    if (!this.drag || !this.lastMouse) return;
    const r = this.view.scroller.getBoundingClientRect();
    const y = this.lastMouse.clientY;
    let dy = 0;
    if (y < r.top + 20) dy = -Math.min(40, r.top + 20 - y);
    else if (y > r.bottom - 20) dy = Math.min(40, y - r.bottom + 20);
    if (dy) {
      this.view.scroller.scrollTop += dy;
      this.extendTo(this.lastMouse.clientX, this.lastMouse.clientY);
    }
  }

  // ---- clipboard --------------------------------------------------------------------

  copy(e, cut) {
    const ed = this.ed;
    e.preventDefault();
    if (!ed.hasSelection()) return;
    const frag = ed.fragment();
    const text = toPlainText(frag);
    e.clipboardData.setData('text/plain', text);
    try { e.clipboardData.setData('application/x-stet-fragment', JSON.stringify(frag)); } catch { /* custom formats unsupported */ }
    this.lastCopy = { text, frag };
    if (cut) { ed.backspace(); this.after(); }
  }

  paste(e) {
    e.preventDefault();
    const dt = e.clipboardData;
    let frag = null;
    const custom = dt.getData('application/x-stet-fragment');
    if (custom) { try { frag = JSON.parse(custom); } catch { frag = null; } }
    const text = dt.getData('text/plain');
    if (!frag && this.lastCopy && text === this.lastCopy.text) frag = this.lastCopy.frag;
    if (!frag) {
      if (!text) return;
      const norm = text.replace(/\r\n?/g, '\n');
      if (!norm.includes('\n')) frag = [{ type: this.ed.block.type, text: norm, marks: [] }];
      else frag = parsePlainText(norm);
      // Unstructured single paragraph (no blank lines): keep it in the current element.
      if (frag.length === 1 && !/\n\s*\n/.test(norm)) frag[0].type = this.ed.block.type;
    }
    this.ed.paste(frag);
    this.after();
  }
}

