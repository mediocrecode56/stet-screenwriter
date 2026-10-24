// Spelling (the toolbar's SPELLING menu): obvious slips underlined with a thin pale red line,
// fixed from a right-click (with Add to dictionary and Ignore in this script), and, with Auto on,
// corrected as Space moves on to the next word. The words are checked against a dictionary
// installed on the computer, in the main process (src/main/spell.js); a Mac can use its own checker.
// The dictionary is the one Claude's revision uses (settings.dictionary, every screenplay); words
// ignored are kept with the script (doc.revision.ignored, as "spelling"), so neither comes up again.

import { pos } from '../core/editor.js';
import { SPELLED, wordsToCheck, namesIn, inCaseOf, oneEdit, languageName } from '../core/spell.js';
import { normalize } from '../core/revision.js';
import { h, esc } from './ui/dialog.js';
import { closeMenu } from './ui/commands.js';
import { arrive, leave, DUR_FAST } from './ui/motion.js';

const DEFAULTS = { on: true, lang: null, suggest: true, auto: false };
// The languages Add a Language offers to download (any installed one is simply chosen instead).
export const LANGUAGES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-ZA', 'fr-FR', 'fr-CA', 'de-DE', 'de-AT', 'de-CH', 'es-ES', 'es-MX', 'it-IT', 'pt-BR', 'pt-PT',
  'nl-NL', 'sv-SE', 'da-DK', 'nb-NO', 'fi-FI', 'pl-PL', 'cs-CZ', 'sk-SK', 'hu-HU', 'ro-RO', 'el-GR', 'tr-TR', 'ru-RU', 'uk-UA', 'ca-ES'];
const BOOK = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 3.2C5 2.4 3.6 2 1.5 2v7.4c2.1 0 3.5.4 4.5 1.2 1-.8 2.4-1.2 4.5-1.2V2C8.4 2 7 2.4 6 3.2zm0 0v7.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
const IGNORE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6s1.8-3.4 5-3.4S11 6 11 6 9.2 9.4 6 9.4 1 6 1 6z" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/><path d="M2 10.5l8-9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';

export class Spelling {
  constructor({ api, editor, view, session, getSettings, setSettings, after, onState, notify }) {
    this.notify = notify;
    this.installing = false; // the language of a dictionary on its way (install())
    this.api = api; this.ed = editor; this.view = view; this.session = session;
    this.getSettings = getSettings; this.setSettings = setSettings; this.after = after; this.onState = onState;
    this.list = [];          // the dictionaries installed: [{ id, code, label }]
    this.ready = false;      // the chosen one is loaded
    this.results = new Map(); // word → null (fine) | { fixes, auto }, with the loaded dictionary
    this.asking = null;      // words on their way to the checker
    this.tokens = new WeakMap(); // block → its words to check (blocks are replaced, never changed)
    this.marks = [];         // [{ b, s, e, word, fixes, auto }] in script order
    this.timer = 0;
    this.pop = null;
  }

  get opts() { return { ...DEFAULTS, ...(this.getSettings().spelling || {}) }; }
  get lang() { return this.list.find((d) => d.id === this.opts.lang) || null; }

  /** Find the dictionaries and load the chosen one (or the one for this computer's language). */
  async init() {
    try {
      const { list, pick } = await this.api.invoke('spell:list');
      this.list = list;
      if (!this.lang && pick) await this.setSettings({ spelling: { ...this.opts, lang: pick } });
    } catch { this.list = []; }
    await this.load();
  }

  async load() {
    this.ready = false;
    this.results.clear();
    this.paint();
    const o = this.opts, lang = this.lang;
    if (!o.on || !lang) { this.api.invoke('spell:off').catch(() => {}); this.onState(); return; }
    try { await this.api.invoke('spell:load', lang.id); this.ready = this.lang === lang; } catch { this.ready = false; }
    this.onState();
    this.scan();
  }

  /** Change a setting (on, lang, suggest, auto); the checker follows. */
  async set(patch) {
    const was = this.opts;
    await this.setSettings({ spelling: { ...was, ...patch } });
    if (was.on !== this.opts.on || was.lang !== this.opts.lang) await this.load();
    else { this.paint(); this.onState(); }
  }

  // ---- what is flagged ----------------------------------------------------------------------

  /** The script changed: look again, a moment after the last key. */
  changed() { clearTimeout(this.timer); this.timer = setTimeout(() => this.scan(), 250); }

  /** Words not seen yet go to the checker; then the marks are drawn. */
  async scan() {
    clearTimeout(this.timer);
    if (!this.ready) return;
    const unseen = new Set();
    for (const b of this.ed.blocks) for (const t of this.wordsOf(b)) if (!this.results.has(t.word)) unseen.add(t.word);
    if (unseen.size) {
      const words = [...unseen].slice(0, 4000);
      const ask = this.asking = this.check(words);
      const got = await ask.catch(() => ({}));
      if (ask !== this.asking || !this.ready) return; // the dictionary changed meanwhile
      this.asking = null;
      for (const w of words) this.results.set(w, got[w] ?? null);
      if (unseen.size > words.length) return this.scan();
    }
    this.paint();
  }

  /** { word: null | { fixes, auto } }: the installed dictionary's answer, or a Mac's own. */
  check(words) {
    if (this.lang?.id !== 'macos') return this.api.invoke('spell:check', words);
    const out = {};
    for (const w of words) {
      if (!window.stet.misspelled(w)) { out[w] = null; continue; }
      const fixes = window.stet.suggestions(w).filter((f) => oneEdit(w.toLowerCase(), f.toLowerCase())).slice(0, 6).map((f) => inCaseOf(w, f));
      out[w] = fixes.length ? { fixes, auto: fixes.length === 1 ? fixes[0] : null } : null;
    }
    return Promise.resolve(out);
  }

  wordsOf(b) {
    if (!SPELLED.has(b.type)) return [];
    let t = this.tokens.get(b);
    if (!t) { t = wordsToCheck(b.text); this.tokens.set(b, t); }
    return t;
  }

  /** Recompute the marks from the answers (no checking): after an edit, a move of the caret, a word added or ignored. */
  paint() {
    const marks = [];
    if (this.ready) {
      const ed = this.ed, c = ed.caret, typing = !ed.hasSelection();
      const skip = this.skipped();
      ed.blocks.forEach((b, bi) => {
        for (const t of this.wordsOf(b)) {
          const r = this.results.get(t.word);
          if (!r || skip.has(t.word.toLowerCase())) continue;
          if (typing && bi === c.b && c.o === t.e) continue; // still being typed
          marks.push({ b: bi, s: t.s, e: t.e, word: t.word, fixes: r.fixes, auto: r.auto });
        }
      });
    }
    this.marks = marks;
    this.view.spelling = this.ready && this.opts.suggest && marks.length ? { marks } : null;
    this.view.schedule();
  }

  /** Words never flagged: in the dictionary, ignored in this script, the cast and the names in it. */
  skipped() {
    const dict = this.getSettings().dictionary || [], ign = (this.session.doc.revision && this.session.doc.revision.ignored) || [];
    const key = `${this.session.doc.meta.id}|${this.ed.rev}|${dict.length}|${ign.length}`; // (looked at on every move of the caret: kept until something changes)
    if (this.skip && this.skip.key === key) return this.skip.set;
    const s = new Set(dict.map(normalize));
    for (const x of ign) if (x.category === 'spelling') s.add(normalize(x.text));
    for (const n of this.ed.characterNames()) for (const w of n.split(/\s+/)) s.add(w.toLowerCase());
    for (const b of this.ed.blocks) if (SPELLED.has(b.type)) namesIn(b.text, s);
    this.skip = { key, set: s };
    return s;
  }

  /** The flagged word at offset o of block b. */
  markAt(b, o) { return (this.view.spelling && this.marks.find((m) => m.b === b && o >= m.s && o <= m.e)) || null; }

  // ---- fixing -------------------------------------------------------------------------------

  /** Put `word` in place of the flagged one (one undo step), the caret where it was. */
  fix(m, word) {
    const ed = this.ed, b = ed.blocks[m.b];
    if (!b || b.text.slice(m.s, m.e) !== m.word) return false;
    const c = ed.caret, d = word.length - (m.e - m.s);
    ed.replaceRanges([{ b: m.b, s: m.s, e: m.e }], [word]);
    ed.setSel(c.b === m.b && c.o >= m.e ? pos(c.b, c.o + d) : c);
    this.after();
    return true;
  }

  async addToDictionary(word) {
    const dict = [...(this.getSettings().dictionary || [])];
    if (!dict.some((d) => normalize(d) === normalize(word))) dict.push(word);
    await this.setSettings({ dictionary: dict });
    this.paint();
  }

  ignore(word) {
    const rv = this.session.doc.revision || (this.session.doc.revision = { ignored: [] });
    if (!rv.ignored.some((x) => x.category === 'spelling' && normalize(x.text) === normalize(word))) rv.ignored.push({ text: word, category: 'spelling' });
    this.session.touch();
    this.paint();
  }

  /** Space after a word (Auto): an obvious slip in it is corrected there and then. */
  async spaced() {
    const o = this.opts;
    if (!o.on || !o.auto || !this.ready) return;
    const ed = this.ed, c = ed.caret, b = ed.blocks[c.b];
    if (ed.hasSelection() || !b || b.text[c.o - 1] !== ' ') return;
    const t = this.wordsOf(b).find((x) => x.e === c.o - 1);
    if (!t || this.skipped().has(t.word.toLowerCase())) return;
    if (!this.results.has(t.word)) {
      const got = await this.check([t.word]).catch(() => ({}));
      this.results.set(t.word, got[t.word] ?? null);
    }
    const r = this.results.get(t.word);
    if (r && r.auto && ed.blocks[c.b]?.text.slice(t.s, t.e) === t.word) this.fix({ b: c.b, ...t }, r.auto);
  }

  // ---- the right-click menu ------------------------------------------------------------------

  /** A right-click at a point in the script: the flagged word's fixes, if it is on one. */
  contextMenu(e) {
    if (!e.target.closest || !e.target.closest('.page')) return false;
    const p = this.view.posAt(e.clientX, e.clientY);
    const m = p && this.markAt(p.b, p.o);
    if (!m) return false;
    e.preventDefault();
    this.openMenu(m, e.clientX, e.clientY);
    return true;
  }

  openMenu(m, x, y) {
    closeMenu(false);
    this.closeMenu(false);
    const pop = this.pop = h('div', { class: 'menu sp-menu', role: 'menu' });
    pop.addEventListener('mousedown', (e) => e.preventDefault()); // the script keeps the keyboard
    for (const f of m.fixes) {
      const row = h('div', { class: 'mi sp-fix', role: 'menuitem' }, h('span', {}, f));
      row.addEventListener('mouseup', () => { this.closeMenu(); this.fix(m, f); });
      pop.appendChild(row);
    }
    const acts = h('div', { class: 'sp-acts' });
    acts.innerHTML = `<button class="sp-act sp-dict" title="Add &quot;${esc(m.word)}&quot; to your dictionary (every screenplay)" aria-label="Add to dictionary">${BOOK}<span>DICTIONARY</span></button>`
      + `<button class="sp-act sp-ign" title="Ignore &quot;${esc(m.word)}&quot; in this screenplay" aria-label="Ignore in this screenplay">${IGNORE}<span>IGNORE</span></button>`;
    acts.querySelector('.sp-dict').addEventListener('click', () => { this.closeMenu(); this.addToDictionary(m.word); });
    acts.querySelector('.sp-ign').addEventListener('click', () => { this.closeMenu(); this.ignore(m.word); });
    pop.appendChild(acts);
    document.body.appendChild(pop);
    pop.style.left = Math.max(0, Math.min(x, innerWidth - pop.offsetWidth)) + 'px';
    pop.style.top = Math.max(0, Math.min(y, innerHeight - pop.offsetHeight)) + 'px';
    arrive(pop, { dist: 2, dur: DUR_FAST, scale: 0.98 });
    const off = this.popOff = new AbortController();
    addEventListener('mousedown', (e) => { if (!pop.contains(e.target)) this.closeMenu(); }, { capture: true, signal: off.signal });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeMenu(); } }, { capture: true, signal: off.signal });
    addEventListener('blur', () => this.closeMenu(), { signal: off.signal });
  }

  closeMenu(animated = true) {
    const pop = this.pop;
    if (!pop) return;
    this.pop = null;
    this.popOff.abort();
    if (animated) leave(pop, () => pop.remove(), { dist: 2 }); else pop.remove();
  }

  // ---- installing one ------------------------------------------------------------------------

  /** A dictionary downloaded in the background, for this computer's language when it has none or for
   *  `locale` (Add a Language); a notice says when it is ready (or why not), and spelling uses it. */
  async install(locale) {
    if (this.installing) return;
    const offer = await this.api.invoke('spell:install-offer', locale);
    this.installing = offer.label;
    this.onState();
    const r = await this.api.invoke('spell:install', locale).catch((e) => ({ ok: false, error: e.message }));
    this.installing = false;
    if (!r.ok) { this.onState(); this.notify(`The ${offer.label} dictionary could not be downloaded. Check the connection and try again.`, r.error); return; }
    await this.setSettings({ spelling: { ...this.opts, on: true, lang: r.path } });
    await this.init();
    this.notify(`${offer.label} dictionary installed: spelling is on.`);
  }

  // ---- the toolbar menu -----------------------------------------------------------------------

  /** The SPELLING menu: the switch, Suggestions, Auto, and the dictionaries installed. */
  menuItems() {
    const o = this.opts, off = () => !this.opts.on;
    const langs = this.list.length
      ? this.list.map((d) => ({ label: d.label, checked: () => this.opts.lang === d.id, enabled: () => !off(), run: () => this.set({ lang: d.id }) }))
      : [{ label: 'No dictionary on this computer', enabled: () => false },
        { label: this.installing ? `Downloading ${this.installing}…` : 'Install Dictionary', enabled: () => !this.installing, run: () => this.install() }];
    return [
      { label: 'Spelling', checked: () => o.on, run: () => this.set({ on: !o.on }) },
      { label: 'Suggestions', checked: () => o.suggest, enabled: () => !off(), run: () => this.set({ suggest: !o.suggest }) },
      { label: 'Auto', checked: () => o.auto, enabled: () => !off(), run: () => this.set({ auto: !o.auto }) },
      '-', ...langs,
      { label: this.installing ? `Downloading ${this.installing}…` : 'Add a Language', enabled: () => !this.installing, sub: () => Promise.resolve(this.languageItems()) },
      '-', 'revise-dict',
    ];
  }

  /** Add a Language: the common languages, an installed one chosen at once, any other downloaded. */
  languageItems() {
    return LANGUAGES.map((loc) => {
      const code = loc.replace('-', '_'), have = this.list.find((d) => d.code.toLowerCase() === code.toLowerCase());
      return have
        ? { label: languageName(code), current: this.opts.lang === have.id, title: 'Installed', run: () => this.set({ on: true, lang: have.id }) }
        : { label: languageName(code), title: 'Download this dictionary in the background', run: () => this.install(loc) };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }
}
