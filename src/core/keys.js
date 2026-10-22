// Shortcuts on a Mac. Command does what Ctrl does everywhere else (src/renderer/ui/commands.js),
// so shortcuts written in STET as Ctrl+Shift+S are shown the Mac way, ⇧⌘S: ⌘ for Ctrl,
// ⌥ for Alt, ⇧ for Shift, in the order Mac menus use.

export const MAC = typeof navigator !== 'undefined' && /^Mac/.test(navigator.platform || '');

/** Every shortcut in a text, the Mac way on a Mac; unchanged elsewhere. */
export function macKeys(text, mac = MAC) {
  if (!mac) return text;
  return String(text).replace(/\bCtrl\+Y\b/g, 'Ctrl+Shift+Z') // redo
    .replace(/\b((?:(?:Ctrl|Alt|Shift)\+)+)(?=\S)/g, (m) => {
      const mods = m.split('+');
      return (mods.includes('Alt') ? '⌥' : '') + (mods.includes('Shift') ? '⇧' : '') + (mods.includes('Ctrl') ? '⌘' : '');
    });
}

// ---- shortcuts that can be changed ----------------------------------------------
//
// A shortcut is one to three key combinations pressed one after another ("Ctrl+K Ctrl+S"),
// written with spaces between them. A combination is written Ctrl+Alt+Shift+Key, in that
// order; Ctrl is ⌘ on a Mac.

export const MAX_STEPS = 3;
export const SEQ_MS = 2500; // how long a started sequence waits for its next combination

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Dead', 'Process', 'Unidentified', 'OS', 'Fn']);
const CODE_KEYS = { Backslash: '\\', BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-' };

/** The key of a key event as STET names it ('K', '1', '=', 'F5', 'ArrowUp', 'Space'), or null for a modifier alone. */
export function keyName(e, mac = MAC) {
  let key = e.key;
  if (!key || MODIFIER_KEYS.has(key)) return null;
  if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  // On a Mac, Option with a letter types a symbol (Option+M is µ): the key itself counts.
  else if (mac && e.altKey && e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (key === ' ') key = 'Space';
  else if (key === '+') key = 'Plus';
  else if (key.length === 1) key = key.toUpperCase();
  return key;
}

/** A key event as a combination ('Ctrl+Shift+K'), or null for a modifier alone. */
export function comboOf(e, mac = MAC) {
  const k = keyName(e, mac);
  if (!k) return null;
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}

/** One combination in a fixed form for comparing: 'C-A-S-K'. */
export function normCombo(k) {
  const parts = k.split('+').map((s) => s.trim());
  const key = parts.pop() || '+';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return [mods.has('ctrl') ? 'C' : '', mods.has('alt') ? 'A' : '', mods.has('shift') ? 'S' : '', key.length === 1 ? key.toUpperCase() : key].join('-');
}

export const steps = (seq) => String(seq).trim().split(/\s+/).filter(Boolean);
export const normSeq = (seq) => steps(seq).map(normCombo).join(' ');

/** A shortcut as it is shown: the Mac way on a Mac, arrows by their direction. */
export function showKeys(seq, mac = MAC) {
  return steps(seq).map((k) => macKeys(k.replace(/\bArrow/g, ''), mac)).join(' ');
}

// Keys the editor itself uses, which no command may take.
const EDIT_KEYS = { Z: 'Undo', Y: 'Redo', X: 'Cut', C: 'Copy', V: 'Paste', A: 'Select All' };
const MAC_MENU = { Q: 'Quit', W: 'Close Window', M: 'Minimize' }; // the Mac's own menu takes these first
const MOVE_KEYS = /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Backspace|Delete)$/;

/**
 * Why a shortcut can't be used, or '' if it can. Its first combination needs Ctrl or Alt,
 * or a function key, so typing never runs a command; the editor's own keys stay its own.
 */
export function unusable(seq, mac = MAC) {
  const s = steps(seq);
  if (!s.length) return 'No keys were pressed.';
  if (s.length > MAX_STEPS) return `A shortcut has at most ${MAX_STEPS} combinations.`;
  const [first] = s;
  const [c, a, sh, key] = normCombo(first).split('-');
  if (!c && !a && !/^F\d+$/.test(key)) return 'A shortcut starts with Ctrl, Alt or a function key, so typing never runs it.';
  for (const k of s) {
    const [kc, ka, ks, kk] = normCombo(k).split('-');
    if (kc && !ka && EDIT_KEYS[kk] && (!ks || kk === 'Z')) return `${showKeys(k, mac)} is ${ks ? 'Redo' : EDIT_KEYS[kk]}, which can't be changed.`;
    if (mac && kc && !ka && !ks && MAC_MENU[kk]) return `${showKeys(k, mac)} is ${MAC_MENU[kk]} on a Mac, which can't be changed.`;
    if ((kc || ka) && MOVE_KEYS.test(kk) && !(ka && !kc && (kk === 'ArrowUp' || kk === 'ArrowDown'))) return `${showKeys(k, mac)} moves or deletes in the text, which can't be changed.`;
  }
  return '';
}

/**
 * Which command each shortcut runs. Every command has its default shortcuts; `over` holds the
 * ones the writer changed ({ id: [shortcut, ...] }, [] for none). feed() follows a sequence
 * as its combinations are pressed.
 */
export class Keymap {
  constructor() {
    this.defaults = new Map(); // id -> [shortcut]
    this.over = {};
    this.map = new Map();      // normalized shortcut -> id
    this.prefix = new Set();   // normalized beginnings of longer shortcuts
    this.pending = null;       // { seq, t }: a sequence under way
  }

  define(id, keys) { this.defaults.set(id, [].concat(keys || [])); this.rebuild(); }

  setOverrides(over) {
    this.over = {};
    for (const [id, v] of Object.entries(over || {})) if (Array.isArray(v) && this.defaults.has(id)) this.over[id] = v.filter((k) => typeof k === 'string' && !unusable(k));
    this.rebuild();
  }

  keysOf(id) { return this.over[id] || this.defaults.get(id) || []; }
  isDefault(id) { return !this.over[id]; }

  rebuild() {
    this.map.clear();
    this.prefix.clear();
    this.pending = null;
    for (const id of this.defaults.keys()) {
      for (const k of this.keysOf(id)) {
        const n = normSeq(k);
        if (this.map.has(n)) continue; // the first command keeps a shortcut given twice
        this.map.set(n, id);
        const s = n.split(' ');
        for (let i = 1; i < s.length; i++) this.prefix.add(s.slice(0, i).join(' '));
      }
    }
  }

  /** Commands (other than `id`) whose shortcuts clash with `seq`: the same keys, or one beginning the other. */
  conflicts(id, seq) {
    const n = normSeq(seq);
    const out = [];
    for (const other of this.defaults.keys()) {
      if (other === id) continue;
      for (const k of this.keysOf(other)) {
        const m = normSeq(k);
        if (m === n || m.startsWith(n + ' ') || n.startsWith(m + ' ')) { out.push({ id: other, keys: k }); break; }
      }
    }
    return out;
  }

  /** Give command `id` the shortcut `seq` (null: none), taking it from any command it clashes with. */
  assign(id, seq) {
    const over = { ...this.over };
    if (seq) {
      for (const c of this.conflicts(id, seq)) {
        const n = normSeq(seq);
        over[c.id] = this.keysOf(c.id).filter((k) => { const m = normSeq(k); return !(m === n || m.startsWith(n + ' ') || n.startsWith(m + ' ')); });
      }
    }
    over[id] = seq ? [seq] : [];
    this.over = {};
    for (const [k, v] of Object.entries(over)) if (!sameKeys(v, this.defaults.get(k) || [])) this.over[k] = v;
    this.rebuild();
    return this.over;
  }

  /** Back to the default shortcuts, for one command or (no id) all of them. */
  reset(id) {
    if (id) delete this.over[id]; else this.over = {};
    this.setOverrides({ ...this.over });
    return this.over;
  }

  /**
   * A combination was pressed: { id } when it completes a shortcut, { pending: true } when it
   * begins (or continues) one, null otherwise. A combination that doesn't continue the
   * sequence under way counts on its own.
   */
  feed(combo, now = Date.now()) {
    if (!combo) return this.pending ? { pending: true } : null;
    const n = normCombo(combo);
    const p = this.pending;
    this.pending = null;
    if (p && now - p.t < SEQ_MS) {
      const seq = p.seq + ' ' + n;
      if (this.map.has(seq)) return { id: this.map.get(seq) };
      if (this.prefix.has(seq)) { this.pending = { seq, t: now }; return { pending: true }; }
    }
    if (this.map.has(n)) return { id: this.map.get(n) };
    if (this.prefix.has(n)) { this.pending = { seq: n, t: now }; return { pending: true }; }
    return null;
  }

  /** The id a single combination runs, without starting anything (for tooltips and tests). */
  peek(combo) { return this.map.get(normCombo(combo)) || null; }

  get waiting() { return !!this.pending && Date.now() - this.pending.t < SEQ_MS; }
}

function sameKeys(a, b) {
  return a.length === b.length && a.every((k, i) => normSeq(k) === normSeq(b[i]));
}
