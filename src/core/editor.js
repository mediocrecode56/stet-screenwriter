// Editing engine: owns the block array, selection and undo history.
// Pure logic, no DOM — every operation is unit-testable in Node.
//
// All mutations go through _splice(), which records an invertible step
// {from, removed, added} in the open transaction and widens the dirty range
// used by incremental pagination. Undo/redo replays those steps.

import {
  makeBlock, withText, withType, withTyped, withAlign, sliceBlock, UPPER_TYPES, TYPES, cueName,
  marksAfterInsert, marksAfterDelete, sliceMarks, concatMarks, setHighlight, removeCommentMarks, STYLES, setStyle, hasStyle,
} from './model.js';
import { blockWords, documentWords, isWordChar, wordLeft, wordRight, escapeRegExp } from './text.js';
import { mergeDirty } from './layout.js';
import { ELEMENT, alignOf } from './format.js';

export const NEXT_ON_ENTER = { scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'action', transition: 'scene', shot: 'action' };

const SCENE_PREFIX = /^(int|ext|est|i\/e|int\.?\s?\/\s?ext|ext\.?\s?\/\s?int)\.(\s|$)/i;
const MERGE_WINDOW_MS = 1500;

export const pos = (b, o) => ({ b, o });
export const cmp = (p, q) => (p.b - q.b) || (p.o - q.o);

// ---- writing activity ---------------------------------------------------------
//
// Every committed transaction earns a word credit, which feeds the writing
// statistics (src/core/stats.js). The rule:
//
//  * Words the writer adds by their own editing (typing, Enter, completing a
//    name…) are credited as they appear.
//  * Pasting and replacing (Find & Replace, accepted suggestions) are not the
//    writer's own writing: credit 0, whichever way the count moves.
//  * Deleting words never takes away earlier writing — except deleting inside
//    the stretch of text just written (a typo, a phrase rephrased on the
//    spot), so fixing a typo doesn't count a word twice. That "fresh" stretch
//    is tracked precisely (paragraph and offsets); it ends as soon as the
//    writer writes somewhere else, pastes, undoes, or pauses for FRESH_MS.
//    Deleting older text, anywhere, never reduces anything.
//  * Undo takes back exactly the credit the undone transaction earned, and
//    redo gives it back, so replaying history never counts anything twice.
//  * Loading a document (open, restore, switch) earns nothing.
//
// Credits queue up in this.credits as { n, t } (t = when the credited edit was
// first made, so an undo is charged to the day the words were written) and the
// app drains them with takeCredits() after every change.
const NOT_WRITING = new Set(['paste', 'replace']);
const FRESH_MS = 10 * 60 * 1000;

export class Editor {
  constructor(blocks) {
    this.blocks = blocks.length ? blocks : [makeBlock('action')];
    this.sel = { a: pos(0, 0), f: pos(0, 0) };
    this.undoStack = [];
    this.redoStack = [];
    this.rev = 0;          // increments on every committed change
    this.dirty = null;     // pending dirty range for pagination
    this.txn = null;
    this.tabTypes = null;  // the element types Tab steps through (null: all)
    this.words = 0;
    for (const b of this.blocks) this.words += blockWords(b);
    this.namesRev = -1;
    this._names = null;
    this.credits = [];     // pending writing credits, see takeCredits()
    this.fresh = null;     // { b, s, e, n, t }: the stretch just written (paragraph b, offsets s–e) and its n credited words
    this.retired = 0;      // credit of transactions dropped off the end of the undo history
    this.loads = 0;        // increments on every document load
    this.onChange = null;  // (editor) => void
    this.autoCapitalize = true;
    this.pending = null;   // { at, set: { k: on } }: styles toggled with no selection, for text typed at `at`
    this.now = () => Date.now();
  }

  // ---- transaction core ------------------------------------------------------

  _splice(from, count, added) {
    const removed = this.blocks.slice(from, from + count);
    if (count === 1 && added.length === 1) this.blocks[from] = added[0];
    else this.blocks.splice(from, count, ...added);
    for (const b of removed) this.words -= blockWords(b);
    for (const b of added) this.words += blockWords(b);
    this.dirty = mergeDirty(this.dirty, from, count, added.length);
    if (this.txn) this.txn.steps.push({ from, removed, added });
    return removed;
  }

  _replace(bi, block) { this._splice(bi, 1, [block]); }

  /** Run fn as one undoable transaction. */
  edit(kind, fn, opts = {}) {
    if (this.txn) { fn(); return; } // nested: join the outer transaction
    const now = this.now();
    const txn = { kind, steps: [], selBefore: this.sel, selAfter: null, time: now, at: now, closed: !!opts.close, mid: null, credit: 0 };
    const w0 = this.words, nb0 = this.blocks.length;
    const b0 = this.blocks[Math.min(txn.selBefore.a.b, txn.selBefore.f.b)];
    const len0 = b0 ? b0.text.length : 0;
    this.txn = txn;
    try { fn(); } finally { this.txn = null; }
    if (!txn.steps.length) { this._emit(); return; }
    txn.credit = this._earn(kind, w0, txn.mid ?? w0, txn, now, len0, nb0);
    if (txn.credit) this.credits.push({ n: txn.credit, t: now });
    txn.selAfter = this.sel;
    this.redoStack.length = 0;
    const last = this.undoStack[this.undoStack.length - 1];
    if (kind === 'type' && last && last.kind === 'type' && !last.closed && this._mergeable(last, txn)) {
      last.steps[0].added = txn.steps[0].added;
      last.credit += txn.credit;
      last.selAfter = txn.selAfter;
      last.time = txn.time;
      last.closed = txn.closed;
    } else {
      this.undoStack.push(txn);
      if (this.undoStack.length > 2000) for (const t of this.undoStack.splice(0, this.undoStack.length - 2000)) this.retired += t.credit || 0;
    }
    this.rev++;
    this._emit();
  }

  _mergeable(a, b) {
    return a.steps.length === 1 && b.steps.length === 1 &&
      a.steps[0].from === b.steps[0].from &&
      a.steps[0].added.length === 1 && b.steps[0].removed.length === 1 && b.steps[0].added.length === 1 &&
      b.time - a.time < MERGE_WINDOW_MS;
  }

  /** Close the current typing group (called on cursor movement). */
  breakUndoGroup() {
    const last = this.undoStack[this.undoStack.length - 1];
    if (last) last.closed = true;
  }

  undo() {
    const t = this.undoStack.pop();
    if (!t) return false;
    for (let i = t.steps.length - 1; i >= 0; i--) {
      const s = t.steps[i];
      this._applyRaw(s.from, s.added.length, s.removed);
    }
    this._replay(-(t.credit || 0), t.at);
    this.redoStack.push(t);
    this.sel = t.selBefore;
    this.rev++;
    this._emit();
    return true;
  }

  redo() {
    const t = this.redoStack.pop();
    if (!t) return false;
    for (const s of t.steps) this._applyRaw(s.from, s.removed.length, s.added);
    this._replay(t.credit || 0, t.at);
    t.closed = true;
    this.undoStack.push(t);
    this.sel = t.selAfter;
    this.rev++;
    this._emit();
    return true;
  }

  _applyRaw(from, count, added) {
    const removed = this.blocks.splice(from, count, ...added);
    for (const b of removed) this.words -= blockWords(b);
    for (const b of added) this.words += blockWords(b);
    this.dirty = mergeDirty(this.dirty, from, count, added.length);
  }

  /** Replace the whole document (open/restore). Clears history. */
  reset(blocks) {
    const n = this.blocks.length;
    this.blocks = blocks.length ? blocks : [makeBlock('action')];
    this.words = 0;
    for (const b of this.blocks) this.words += blockWords(b);
    this.credits = [];
    this.fresh = null;
    this.pending = null;
    this.retired = 0;
    this.loads++; // lets listeners tell a document load from an edit
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.sel = { a: pos(0, 0), f: pos(0, 0) };
    this.dirty = { from: 0, to: this.blocks.length, delta: this.blocks.length - n, full: true };
    this.rev++;
    this._emit();
  }

  /**
   * Credit earned by one transaction. w0 → wMid is its deletion phase (a
   * replaced selection), wMid → words the rest; len0/nb0 are the edited
   * paragraph's length and the paragraph count before it.
   */
  _earn(kind, w0, wMid, txn, now, len0, nb0) {
    if (NOT_WRITING.has(kind)) { this.fresh = null; return 0; }
    const sel = txn.selBefore;
    const a = cmp(sel.a, sel.f) <= 0 ? sel.a : sel.f;
    const caret = this.sel.f;
    const single = this.blocks.length === nb0 && caret.b === a.b; // edit within one paragraph
    const start = single ? Math.min(a.o, caret.o) : -1;
    let f = this.fresh;
    if (f && (!single || f.b !== a.b || now - f.t >= FRESH_MS)) f = this.fresh = null;
    const inside = !!f && start >= f.s && start <= f.e;
    let credit = 0;
    for (const d of [wMid - w0, this.words - wMid]) {
      if (d > 0) credit += d;
      else if (d < 0 && inside) { const take = Math.min(-d, f.n); f.n -= take; credit -= take; }
    }
    if (f) {
      // Keep the fresh stretch's offsets in step with the paragraph.
      const d = this.blocks[a.b].text.length - len0;
      if (start < f.s) { f.s = Math.max(start, f.s + d); f.e = Math.max(f.s, f.e + d); }
      else if (start <= f.e) f.e = Math.max(f.s, f.e + d);
      f.t = now;
    }
    if (credit > 0 && !inside) this.fresh = { b: caret.b, s: single ? start : caret.o, e: caret.o, n: credit, t: now };
    else if (credit > 0) f.n += credit;
    return credit;
  }

  _replay(n, at) {
    this.fresh = null;
    if (n) this.credits.push({ n, t: at });
  }

  /** Total credit currently in effect: every credit earned and not undone. */
  get creditInEffect() { return this.retired + this.undoStack.reduce((n, t) => n + (t.credit || 0), 0); }

  /** Check the running word count against a full recount; repairs (and reports) any drift. */
  verifyWords() {
    const n = documentWords(this.blocks);
    if (n !== this.words) {
      console.error(`word count drift: running ${this.words}, recount ${n}`);
      this.words = n;
      this.rev++;
      this._emit();
    }
    return n;
  }

  /** Drain the pending writing credits ({ n, t } each). */
  takeCredits() {
    const c = this.credits;
    this.credits = [];
    return c;
  }

  takeDirty() { const d = this.dirty; this.dirty = null; return d; }

  _emit() { if (this.onChange) this.onChange(this); }

  // ---- selection -------------------------------------------------------------

  get caret() { return this.sel.f; }
  get block() { return this.blocks[this.sel.f.b]; }
  hasSelection() { return cmp(this.sel.a, this.sel.f) !== 0; }

  ordered() {
    const { a, f } = this.sel;
    return cmp(a, f) <= 0 ? [a, f] : [f, a];
  }

  clampPos(p) {
    const b = Math.max(0, Math.min(this.blocks.length - 1, p.b));
    return pos(b, Math.max(0, Math.min(this.blocks[b].text.length, p.o)));
  }

  setSel(a, f = a) {
    this.sel = { a: this.clampPos(a), f: this.clampPos(f) };
    if (this.pending && cmp(this.pending.at, this.sel.f) !== 0) this.pending = null; // a toggled style lasts until the caret moves
    this.breakUndoGroup();
    this._emit();
  }

  selectAll() {
    const last = this.blocks.length - 1;
    this.setSel(pos(0, 0), pos(last, this.blocks[last].text.length));
  }

  selectedText() {
    if (!this.hasSelection()) return '';
    return this.fragment().map((b) => b.text).join('\n');
  }

  /** Selected content as an array of {type, text, marks}. */
  fragment() {
    const [s, e] = this.ordered();
    const out = [];
    for (let i = s.b; i <= e.b; i++) {
      const b = this.blocks[i];
      const a = i === s.b ? s.o : 0;
      const z = i === e.b ? e.o : b.text.length;
      const f = { type: b.type, text: b.text.slice(a, z), marks: sliceMarks(b.marks, a, z) };
      if (b.align) f.align = b.align;
      out.push(f);
    }
    return out;
  }

  // ---- primitive edits (must run inside a transaction) ----------------------

  _deleteRange(s, e) {
    if (cmp(s, e) === 0) return s;
    if (s.b === e.b) {
      const b = this.blocks[s.b];
      this._replace(s.b, withText(b, b.text.slice(0, s.o) + b.text.slice(e.o), marksAfterDelete(b.marks, s.o, e.o)));
      return s;
    }
    const first = this.blocks[s.b], last = this.blocks[e.b];
    // Whole lines gone from the start of one (an empty line deleted, a line selected to the start of
    // the next): what is left is the last line's own text, so it keeps its element (and id, for its
    // timecode). Only text that joins a line's written text takes that line's element.
    if (s.o === 0 && e.o < last.text.length) {
      this._splice(s.b, e.b - s.b + 1, [sliceBlock(last, e.o, last.text.length, last.id)]);
      return s;
    }
    const head = first.text.slice(0, s.o);
    let tail = last.text.slice(e.o);
    let tailMarks = sliceMarks(last.marks, e.o, last.text.length);
    if (UPPER_TYPES.has(first.type) && tail !== tail.toUpperCase()) {
      const up = tail.toUpperCase();
      if (up.length !== tail.length) tailMarks = [];
      tail = up;
    }
    const nb = withText(first, head + tail, concatMarks(sliceMarks(first.marks, 0, s.o), head.length, tailMarks));
    this._splice(s.b, e.b - s.b + 1, [nb]);
    return s;
  }

  _deleteSelection() {
    const [s, e] = this.ordered();
    const p = this._deleteRange(s, e);
    this.sel = { a: p, f: p };
    if (this.txn && this.txn.mid === null) this.txn.mid = this.words; // end of a replace-selection's deletion phase
    return p;
  }

  _insertAt(p, str, styles = null) {
    const b = this.blocks[p.b];
    const typed = str;
    if (UPPER_TYPES.has(b.type)) str = str.toUpperCase();
    let marks = marksAfterInsert(b.marks, p.o, str.length);
    if (styles) for (const [k, on] of Object.entries(styles)) marks = setStyle(marks, p.o, p.o + str.length, k, on);
    let nb = withText(b, b.text.slice(0, p.o) + str + b.text.slice(p.o), marks);
    if (UPPER_TYPES.has(b.type)) nb = withTyped(b, nb, p.o, typed);
    this._replace(p.b, nb);
    const np = pos(p.b, p.o + str.length);
    this.sel = { a: np, f: np };
    return np;
  }

  // ---- public editing commands ------------------------------------------------

  /** Insert typed text (no newlines). Applies element-aware smart behaviour. */
  insertText(str) {
    if (!str) return;
    str = str.replace(/\r\n?|\n/g, ' ');
    const b0 = this.block;
    const caret = this.caret;
    // Typing ")" over an existing closing paren just steps over it.
    if (str === ')' && !this.hasSelection() && b0.text[caret.o] === ')') { this.setSel(pos(caret.b, caret.o + 1)); return; }
    const boundary = !isWordChar(str[str.length - 1]);
    this.edit('type', () => {
      if (this.hasSelection()) this._deleteSelection();
      let p = this.caret;
      let b = this.blocks[p.b];
      // "(" at the start of an empty dialogue/character line starts a parenthetical.
      if (str === '(' && b.text === '' && (b.type === 'dialogue' || b.type === 'action')) {
        const prev = this.blocks[p.b - 1];
        if (b.type === 'dialogue' || (prev && prev.type === 'character')) {
          this._replace(p.b, { ...b, type: 'paren', text: '()', marks: [] });
          this.sel = { a: pos(p.b, 1), f: pos(p.b, 1) };
          return;
        }
      }
      const pend = this._pendingAt(p);
      p = this._insertAt(p, str, pend);
      if (pend) this.pending = { at: p, set: pend };
      b = this.blocks[p.b];
      if (b.type === 'action' && boundary && p.o <= 12 && SCENE_PREFIX.test(b.text)) {
        this._replace(p.b, withType(b, 'scene'));
      }
    }, { close: boundary });
    if (boundary && this.autoCapitalize) this._capitalizeFirstAppearance();
  }

  /** Paste: plain text or a structured fragment. One undo step. */
  paste(fragment) {
    if (!fragment || !fragment.length) return;
    this.edit('paste', () => {
      if (this.hasSelection()) this._deleteSelection();
      const p = this.caret;
      const cur = this.blocks[p.b];
      if (fragment.length === 1) {
        let t = fragment[0].text.replace(/\r\n?/g, '\n');
        if (UPPER_TYPES.has(cur.type)) t = t.toUpperCase();
        const ms = fragment[0].marks && t.length === fragment[0].text.length ? fragment[0].marks : [];
        const head = cur.text.slice(0, p.o), tail = cur.text.slice(p.o);
        const marks = concatMarks(concatMarks(sliceMarks(cur.marks, 0, p.o), head.length, ms), head.length + t.length, sliceMarks(cur.marks, p.o, cur.text.length));
        this._replace(p.b, withText(cur, head + t + tail, marks));
        const np = pos(p.b, p.o + t.length);
        this.sel = { a: np, f: np };
        return;
      }
      const head = cur.text.slice(0, p.o), tail = cur.text.slice(p.o);
      const headMarks = sliceMarks(cur.marks, 0, p.o), tailMarks = sliceMarks(cur.marks, p.o, cur.text.length);
      const out = [];
      fragment.forEach((f, i) => {
        let type = f.type;
        let text = f.text;
        let marks = f.marks || [];
        if (i === 0) {
          if (head.length) type = cur.type;
          if (UPPER_TYPES.has(type)) text = text.toUpperCase();
          out.push(withAlign({ id: cur.id, type, text: head + text, marks: concatMarks(headMarks, head.length, text.length === f.text.length ? marks : []) }, head.length ? cur.align : f.align));
        } else {
          if (UPPER_TYPES.has(type)) { const up = text.toUpperCase(); if (up.length !== text.length) marks = []; text = up; }
          out.push(withAlign(makeBlock(type, text, marks), f.align));
        }
      });
      const lastBlock = out[out.length - 1];
      const caretO = lastBlock.text.length;
      const tailText = UPPER_TYPES.has(lastBlock.type) ? tail.toUpperCase() : tail;
      out[out.length - 1] = withText(lastBlock, lastBlock.text + tailText, concatMarks(lastBlock.marks, lastBlock.text.length, tailText.length === tail.length ? tailMarks : []));
      this._splice(p.b, 1, out);
      const np = pos(p.b + out.length - 1, caretO);
      this.sel = { a: np, f: np };
    });
  }

  backspace(byWord = false) {
    if (this.hasSelection()) return this.edit('delete', () => this._deleteSelection());
    const p = this.caret;
    if (p.o > 0) {
      const b = this.block;
      let from = byWord ? wordLeft(b.text, p.o) : p.o - 1;
      // Delete surrogate pairs as a unit.
      if (!byWord && from > 0 && /[\uDC00-\uDFFF]/.test(b.text[from]) && /[\uD800-\uDBFF]/.test(b.text[from - 1])) from--;
      // Backspacing into an empty "()" removes the parenthetical shell.
      if (!byWord && b.type === 'paren' && b.text === '()' && p.o === 1) {
        return this.edit('delete', () => { this._replace(p.b, { ...b, type: 'dialogue', text: '', marks: [] }); this.sel = { a: pos(p.b, 0), f: pos(p.b, 0) }; });
      }
      return this.edit(byWord ? 'delete' : 'type', () => {
        this._deleteRange(pos(p.b, from), p);
        this.sel = { a: pos(p.b, from), f: pos(p.b, from) };
      });
    }
    if (p.b === 0) return;
    // At block start: merge into the previous block.
    const prev = this.blocks[p.b - 1];
    this.edit('delete', () => {
      const cur = this.blocks[p.b];
      if (prev.text === '' && cur.text !== '') {
        this._splice(p.b - 1, 1, []);
        this.sel = { a: pos(p.b - 1, 0), f: pos(p.b - 1, 0) };
      } else {
        const np = pos(p.b - 1, prev.text.length);
        this._deleteRange(np, p);
        this.sel = { a: np, f: np };
      }
    });
  }

  deleteForward(byWord = false) {
    if (this.hasSelection()) return this.edit('delete', () => this._deleteSelection());
    const p = this.caret;
    const b = this.block;
    if (p.o < b.text.length) {
      let to = byWord ? wordRight(b.text, p.o) : p.o + 1;
      if (!byWord && /[\uD800-\uDBFF]/.test(b.text[p.o])) to = Math.min(b.text.length, to + 1);
      return this.edit('delete', () => { this._deleteRange(p, pos(p.b, to)); this.sel = { a: p, f: p }; });
    }
    if (p.b >= this.blocks.length - 1) return;
    this.edit('delete', () => { this._deleteRange(p, pos(p.b + 1, 0)); this.sel = { a: p, f: p }; });
  }

  /** Enter: start the next element (or convert an empty one). */
  enter() {
    this.edit('enter', () => {
      if (this.hasSelection()) this._deleteSelection();
      const p = this.caret;
      const b = this.blocks[p.b];
      if (b.text === '' || (b.type === 'paren' && b.text === '()')) {
        // Empty element: Enter steps back to Action, and from Action to Scene Heading.
        const t = b.type === 'action' ? 'scene' : 'action';
        this._replace(p.b, { ...b, type: t, text: '', marks: [] });
        this.sel = { a: pos(p.b, 0), f: pos(p.b, 0) };
        return;
      }
      const atEnd = p.o === b.text.length || (b.type === 'paren' && p.o === b.text.length - 1 && b.text.endsWith(')'));
      if (atEnd) {
        const nb = makeBlock(NEXT_ON_ENTER[b.type], '');
        this._splice(p.b + 1, 0, [nb]);
        this.sel = { a: pos(p.b + 1, 0), f: pos(p.b + 1, 0) };
        return;
      }
      const left = withText(b, b.text.slice(0, p.o).replace(/ +$/, ''), sliceMarks(b.marks, 0, p.o));
      const rightText = b.text.slice(p.o);
      const cut = rightText.length - rightText.replace(/^ +/, '').length;
      const right = sliceBlock(b, p.o + cut, b.text.length);
      this._splice(p.b, 1, [left, right]);
      this.sel = { a: pos(p.b + 1, 0), f: pos(p.b + 1, 0) };
    }, { close: true });
  }

  /** Shift+Enter: line break inside the current element. */
  softBreak() {
    this.edit('type', () => {
      if (this.hasSelection()) this._deleteSelection();
      this._insertAt(this.caret, '\n');
    }, { close: true });
  }

  /**
   * Tab / Shift+Tab step through the element types the writer keeps in the cycle (`tabTypes`,
   * in TYPES order; all of them unless chosen otherwise), the way any change of element works
   * (applyType): only what is selected, or what is written next, takes the new type.
   */
  tab(reverse = false) {
    const from = this.hasSelection() ? this.blocks[this.ordered()[0].b].type : this.block.type;
    const type = this.nextType(from, reverse);
    if (type !== from) this.applyType(type);
  }

  /** The element type after (or before) `type` in the Tab cycle; `type` itself when it is alone there. */
  nextType(type, reverse = false) {
    const keep = TYPES.filter((t) => !this.tabTypes || this.tabTypes.includes(t));
    if (!keep.length) return type;
    const n = TYPES.length, at = TYPES.indexOf(type);
    for (let k = 1; k <= n; k++) {
      const t = TYPES[(at + (reverse ? n - k : k)) % n];
      if (keep.includes(t)) return t;
    }
    return type;
  }

  /**
   * Change of element type (Tab, the toolbar, Ctrl+number). A new type only ever applies to
   * what is selected or to what is written next, never to other text already there:
   *  - with a selection, only the selected text changes type (split off from the rest);
   *  - an empty element (nothing but spaces in it counts as empty) changes type where it is;
   *  - in written text an empty element of the type starts at the caret: after the element
   *    at its end, before it at its start, else between the text before and after the caret.
   */
  applyType(type) {
    if (this.hasSelection()) {
      // Already all of that type: nothing to change, nothing to split.
      if (!this._touched().every((b) => b.type === type)) this.retypeSelection(type);
      return;
    }
    const b = this.block;
    if (/^\(?\s*\)?$/.test(b.text)) return this.setType(type);
    if (b.type !== type) this._startAt(type);
  }

  /** Alignment, the same way as a change of element (applyType): the selected text, or what is written next. */
  applyAlign(align) {
    if (this.hasSelection()) {
      if (this._touched().every((b) => alignOf(b) === align)) return;
      this.edit('mark', () => {
        const [b0, b1] = this._isolate('mark');
        this.setAlign(align);
        this.sel = { a: pos(b0, 0), f: pos(b1, this.blocks[b1].text.length) };
      }, { close: true });
      return;
    }
    const b = this.block;
    if (b.text === '' || b.text === '()') return this.setAlign(align);
    if (alignOf(b) !== align) this._startAt(b.type, align);
  }

  /** Start an empty element of `type` at the caret (see applyType), aligned `align` (null: its own). */
  _startAt(type, align = null) {
    const b = this.block;
    const p = this.caret;
    const atEnd = p.o === b.text.length || (b.type === 'paren' && p.o === b.text.length - 1 && b.text.endsWith(')'));
    this.edit('enter', () => {
      let at = p.b + 1;
      if (!atEnd && p.o === 0) at = p.b;
      else if (!atEnd) this._splitAt(p.b, p.o);
      let nb = type === 'paren' ? makeBlock('paren', '()') : makeBlock(type, '');
      if (align && align !== alignOf(nb)) nb = withAlign(nb, align);
      this._splice(at, 0, [nb]);
      const o = type === 'paren' ? 1 : 0;
      this.sel = { a: pos(at, o), f: pos(at, o) };
    }, { close: true });
  }

  /**
   * Split block i at offset o into two blocks of its kind. The text on each side loses the
   * spaces and line breaks at the cut, as with Enter: a paragraph of a speech becomes a
   * paragraph of its own.
   */
  _splitAt(i, o) {
    const b = this.blocks[i];
    const head = b.text.slice(0, o).replace(/[ \n]+$/, '').length;
    const rest = b.text.slice(o);
    const from = o + rest.length - rest.replace(/^[ \n]+/, '').length;
    this._splice(i, 1, [sliceBlock(b, 0, head, b.id), sliceBlock(b, from, b.text.length)]);
  }

  /** The selection's ends, leaving out a paragraph it only touches at its very start (or end). */
  _span() {
    let [s, e] = this.ordered();
    if (e.b > s.b && e.o === 0) e = pos(e.b - 1, this.blocks[e.b - 1].text.length);
    if (s.b < e.b && s.o === this.blocks[s.b].text.length) s = pos(s.b + 1, 0);
    return [s, e];
  }

  /** The blocks the selection takes in. */
  _touched() {
    const [s, e] = this._span();
    return this.blocks.slice(s.b, e.b + 1);
  }

  /**
   * Make the selected text whole blocks of its own, splitting a paragraph partly selected where
   * the selection begins or ends (a parenthetical is never split: it goes whole). Returns
   * [first, last] block. Runs inside an edit of `kind`.
   */
  _isolate(kind) {
    const [s, e] = this._span();
    let b0 = s.b, b1 = e.b;
    this.edit(kind, () => {
      const last = this.blocks[e.b];
      if (last.type !== 'paren' && e.o < last.text.length && e.o > (s.b === e.b ? s.o : 0)) this._splitAt(e.b, e.o);
      const first = this.blocks[s.b];
      if (first.type !== 'paren' && s.o > 0 && s.o < first.text.length) { this._splitAt(s.b, s.o); b0++; b1++; }
      this.sel = { a: pos(b0, 0), f: pos(b1, this.blocks[b1].text.length) };
    }, { close: true });
    return [b0, b1];
  }

  /**
   * Change the element type of the selected text only: a paragraph partly selected is split
   * where the selection begins or ends, and only the selected part changes.
   */
  retypeSelection(type) {
    this.edit('type-change', () => {
      const [b0, b1] = this._isolate('type-change');
      this.setType(type);
      this.sel = { a: pos(b0, 0), f: pos(b1, this.blocks[b1].text.length) };
    }, { close: true });
  }

  /** Change the element type of every block touched by the selection. */
  setType(type) {
    let [s, e] = this.ordered();
    if (e.b > s.b && e.o === 0) e = pos(e.b - 1, this.blocks[e.b - 1].text.length); // a selection ending at a paragraph's start doesn't take it in
    this.edit('type-change', () => {
      for (let i = s.b; i <= e.b; i++) {
        const b = this.blocks[i];
        if (b.type === type) continue;
        let nb = withType(b, type);
        if (type === 'paren' && !/^\(.*\)$/s.test(nb.text)) {
          nb = { ...nb, text: '(' + nb.text + ')', marks: marksAfterInsert(nb.marks, 0, 1) };
          if (i === this.sel.f.b) {
            const o = Math.min(nb.text.length - 1, this.sel.f.o + 1);
            this.sel = { a: pos(i, s.b === e.b ? o : this.sel.a.o), f: pos(i, o) };
          }
        } else if (b.type === 'paren' && type !== 'paren' && /^\(.*\)$/s.test(nb.text)) {
          const inner = nb.text.slice(1, -1);
          nb = { ...nb, text: inner, marks: marksAfterDelete(marksAfterDelete(nb.marks, nb.text.length - 1, nb.text.length), 0, 1) };
          // (and from the text as written, or into capitals it would be lost: a lap of Tab would leave it in them)
          if (nb.cased) { const c = nb.cased.slice(1, -1); if (c !== inner && c.toUpperCase() === inner) nb.cased = c; else delete nb.cased; }
        }
        this._replace(i, nb);
      }
      this.sel = { a: this.clampPos(this.sel.a), f: this.clampPos(this.sel.f) };
    }, { close: true });
  }

  /**
   * Align the paragraphs the selection takes in, or the caret's: 'left', 'center', 'right' or
   * 'justify'. The element's own alignment is stored as none, so the paragraph follows its element.
   */
  setAlign(align) {
    let [s, e] = this.ordered();
    if (e.b > s.b && e.o === 0) e = pos(e.b - 1, this.blocks[e.b - 1].text.length);
    this.edit('mark', () => {
      for (let i = s.b; i <= e.b; i++) {
        const b = this.blocks[i];
        const want = align === (ELEMENT[b.type].right ? 'right' : 'left') ? null : align;
        if ((b.align || null) !== want) this._replace(i, withAlign(b, want));
      }
    }, { close: true });
  }

  // ---- marks -------------------------------------------------------------------

  /** Apply (or with null, clear) a highlight across the selection (or the range [s, e]). */
  highlight(color, range = null) {
    if (!range && !this.hasSelection()) return false;
    const [s, e] = range || this.ordered();
    if (cmp(s, e) >= 0) return false;
    this.edit('mark', () => {
      for (let i = s.b; i <= e.b; i++) {
        const b = this.blocks[i];
        const a = i === s.b ? s.o : 0, z = i === e.b ? e.o : b.text.length;
        if (z <= a) continue;
        this._replace(i, withText(b, b.text, setHighlight(b.marks, a, z, color)));
      }
    }, { close: true });
    return true;
  }

  /** Styles toggled at `p` with no selection and not yet typed, or null. */
  _pendingAt(p) {
    const q = this.pending;
    return q && q.at.b === p.b && q.at.o === p.o && this.blocks[p.b] ? q.set : null;
  }

  /**
   * Whether style `k` is in effect: across the whole selection, or for text
   * typed at the caret (what the toolbar buttons show as pressed).
   */
  styleActive(k) {
    if (!this.hasSelection()) {
      const p = this.caret;
      const pend = this._pendingAt(p);
      if (pend && k in pend) return pend[k];
      return this.blocks[p.b].marks.some((m) => m.k === k && m.s < p.o && m.e >= p.o);
    }
    const [s, e] = this.ordered();
    let any = false;
    for (let i = s.b; i <= e.b; i++) {
      const b = this.blocks[i];
      const a = i === s.b ? s.o : 0, z = i === e.b ? e.o : b.text.length;
      if (z <= a) continue;
      if (!hasStyle(b.marks, a, z, k)) return false;
      any = true;
    }
    return any;
  }

  /**
   * Toggle style `k` (one of STYLES) on the selection, as one undoable step —
   * or, with no selection, for the text typed next at the caret.
   */
  toggleStyle(k) {
    if (!STYLES.includes(k)) return false;
    const on = !this.styleActive(k);
    if (!this.hasSelection()) {
      const p = this.caret;
      this.pending = { at: p, set: { ...this._pendingAt(p), [k]: on } };
      this._emit();
      return true;
    }
    const [s, e] = this.ordered();
    this.edit('mark', () => {
      for (let i = s.b; i <= e.b; i++) {
        const b = this.blocks[i];
        const a = i === s.b ? s.o : 0, z = i === e.b ? e.o : b.text.length;
        if (z <= a) continue;
        this._replace(i, withText(b, b.text, setStyle(b.marks, a, z, k, on)));
      }
    }, { close: true });
    return true;
  }

  /** Clear every text style (bold, italic, underline, strikethrough) from the selection, or from
   *  what is typed next with none; highlights and notes stay. */
  clearStyles() {
    if (!this.hasSelection()) {
      const p = this.caret;
      this.pending = { at: p, set: Object.fromEntries(STYLES.map((k) => [k, false])) };
      this._emit();
      return true;
    }
    const [s, e] = this.ordered();
    this.edit('mark', () => {
      for (let i = s.b; i <= e.b; i++) {
        const b = this.blocks[i];
        const a = i === s.b ? s.o : 0, z = i === e.b ? e.o : b.text.length;
        if (z <= a) continue;
        let marks = b.marks;
        for (const k of STYLES) marks = setStyle(marks, a, z, k, false);
        if (marks !== b.marks) this._replace(i, withText(b, b.text, marks));
      }
    }, { close: true });
    return true;
  }

  /** Attach comment `id` to the selection (or the whole current block). */
  attachComment(id) {
    let [s, e] = this.ordered();
    if (cmp(s, e) === 0) { s = pos(s.b, 0); e = pos(s.b, this.blocks[s.b].text.length); }
    if (s.b === e.b && s.o === e.o) return false; // empty block: nothing to anchor to
    this.edit('mark', () => {
      for (let i = s.b; i <= e.b; i++) {
        const b = this.blocks[i];
        const a = i === s.b ? s.o : 0, z = i === e.b ? e.o : b.text.length;
        if (z <= a) continue;
        this._replace(i, withText(b, b.text, b.marks.concat([{ s: a, e: z, k: 'cm', v: id }])));
      }
    }, { close: true });
    return true;
  }

  /** Remove notes (an id, or several) from the script; their passages keep their text. A note's
   *  colour is the highlight on its passage, so it goes with the note: one step, one undo brings both back. */
  detachComment(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const colored = list.filter((id) => this.noteColors().has(id)).map((id) => this.noteRange(id)).filter(Boolean);
    this.edit('mark', () => {
      for (const [s, e] of colored) {
        for (let i = s.b; i <= e.b; i++) {
          const b = this.blocks[i];
          const a = i === s.b ? s.o : 0, z = i === e.b ? e.o : b.text.length;
          if (z > a) this._replace(i, withText(b, b.text, setHighlight(b.marks, a, z, null)));
        }
      }
      for (let i = 0; i < this.blocks.length; i++) {
        const b = this.blocks[i];
        let m = b.marks;
        for (const id of list) m = removeCommentMarks(m, id);
        if (m !== b.marks) this._replace(i, withText(b, b.text, m));
      }
    }, { close: true });
  }

  /** The passage note `id` is on, from its first anchor to its last: [start, end] (null: none). */
  noteRange(id) {
    let s = null, e = null;
    this.blocks.forEach((b, i) => { for (const m of b.marks) if (m.k === 'cm' && m.v === id) { if (!s) s = pos(i, m.s); e = pos(i, m.e); } });
    return s && [s, e];
  }

  /**
   * A note's colour is its passage's highlight: the one over most of it. So a note made on highlighted
   * text takes its colour, clearing the highlight clears the note's colour, and giving the note a colour
   * highlights its passage (one undoable change, like any other highlight). By note id, kept until the
   * script changes.
   */
  noteColors() {
    if (this._noteColors && this._noteColors.rev === this.rev) return this._noteColors.map;
    const cover = new Map(); // id -> { colour: characters }
    for (const b of this.blocks) {
      const hls = b.marks.filter((m) => m.k === 'hl');
      if (hls.length) for (const m of b.marks) {
        if (m.k !== 'cm') continue;
        for (const h of hls) {
          const n = Math.min(m.e, h.e) - Math.max(m.s, h.s);
          if (n > 0) { const c = cover.get(m.v) || {}; c[h.v] = (c[h.v] || 0) + n; cover.set(m.v, c); }
        }
      }
    }
    const map = new Map([...cover].map(([id, c]) => [id, Object.keys(c).reduce((a, k) => (c[k] > c[a] ? k : a))]));
    this._noteColors = { rev: this.rev, map };
    return map;
  }

  /** Positions of every comment anchor in document order: [{id, b, s, e}]. */
  commentAnchors() {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < this.blocks.length; i++) {
      for (const m of this.blocks[i].marks) {
        if (m.k === 'cm' && !seen.has(m.v)) { seen.add(m.v); out.push({ id: m.v, b: i, s: m.s, e: m.e }); }
      }
    }
    return out;
  }

  // ---- find / replace ------------------------------------------------------------

  findAll(query, { caseSensitive = false, wholeWord = false } = {}) {
    if (!query) return [];
    let src = escapeRegExp(query);
    if (wholeWord) src = '(?<![\\p{L}\\p{N}_])' + src + '(?![\\p{L}\\p{N}_])';
    const re = new RegExp(src, (caseSensitive ? 'g' : 'gi') + 'u');
    const out = [];
    for (let i = 0; i < this.blocks.length; i++) {
      const t = this.blocks[i].text;
      if (!t) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        out.push({ b: i, s: m.index, e: m.index + m[0].length });
      }
    }
    return out;
  }

  /** Replace the given matches (from findAll) in one undoable step. */
  replaceMatches(matches, replacement) {
    return this.replaceRanges(matches, matches.map(() => replacement));
  }

  /**
   * Replace ranges [{b, s, e}] (document order, non-overlapping) with the
   * corresponding strings, as one undoable step. Marks are kept and shifted.
   */
  replaceRanges(matches, replacements) {
    if (!matches.length) return 0;
    this.edit('replace', () => {
      // Back to front so earlier offsets stay valid.
      for (let k = matches.length - 1; k >= 0; k--) {
        const m = matches[k];
        const b = this.blocks[m.b];
        const replacement = replacements[k];
        const r = UPPER_TYPES.has(b.type) ? replacement.toUpperCase() : replacement;
        let marks = marksAfterInsert(marksAfterDelete(b.marks, m.s, m.e), m.s, r.length);
        // A replaced word keeps the styles it had throughout.
        for (const k of STYLES) if (m.e > m.s && hasStyle(b.marks, m.s, m.e, k)) marks = setStyle(marks, m.s, m.s + r.length, k, true);
        this._replace(m.b, withText(b, b.text.slice(0, m.s) + r + b.text.slice(m.e), marks));
      }
      const first = matches[0];
      this.sel = { a: pos(first.b, first.s), f: pos(first.b, first.s) };
    }, { close: true });
    return matches.length;
  }

  // ---- recognition -------------------------------------------------------------

  /** Character names used in cues, most frequent first. Cached per revision. */
  characterNames() {
    if (this.namesRev === this.rev && this._names) return this._names;
    const freq = new Map();
    for (const b of this.blocks) {
      if (b.type !== 'character' || !b.text) continue;
      const n = cueName(b.text);
      if (n) freq.set(n, (freq.get(n) || 0) + 1);
    }
    this._names = [...freq.entries()].sort((x, y) => y[1] - x[1]).map((x) => x[0]);
    this.namesRev = this.rev;
    return this._names;
  }

  /**
   * After a word boundary in Action, uppercase a known character's name on its
   * first appearance in action text. Only Capitalized words are touched (so
   * "will" never becomes "WILL"), and it is its own undo step.
   */
  _capitalizeFirstAppearance() {
    const p = this.caret;
    const b = this.blocks[p.b];
    if (b.type !== 'action') return;
    const before = b.text.slice(0, p.o - 1);
    const names = this.characterNames();
    if (!names.length) return;
    for (const name of names) {
      if (name.length < 2 || before.length < name.length) continue;
      const start = before.length - name.length;
      const typed = before.slice(start);
      if (typed.toUpperCase() !== name || typed === name) continue;
      if (typed[0] !== typed[0].toUpperCase()) continue;
      if (start > 0 && isWordChar(before[start - 1])) continue;
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegExp(name) + '(?![\\p{L}\\p{N}])', 'iu');
      if (re.test(b.text.slice(0, start))) return;
      for (let i = 0; i < p.b; i++) {
        const o = this.blocks[i];
        if (o.type === 'action' && re.test(o.text)) return;
      }
      this.edit('autocap', () => {
        const cur = this.blocks[p.b];
        this._replace(p.b, withText(cur, cur.text.slice(0, start) + name + cur.text.slice(start + name.length)));
      }, { close: true });
      return;
    }
  }

  /** Scene headings in order: [{b, text}]. */
  scenes() {
    const out = [];
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (b.type === 'scene') out.push({ b: i, text: b.text });
    }
    return out;
  }
}

