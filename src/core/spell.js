// Spelling with the dictionaries installed on the computer (Hunspell .aff/.dic, as LibreOffice,
// Firefox, Linux and the Windows spelling folder install them): a word is checked by taking its
// prefixes and suffixes off by the dictionary's own rules, never by listing every form, so a large
// dictionary stays small in memory. Only obvious slips are flagged: a word the dictionary doesn't
// know that is one edit (a swapped, missing, extra or wrong letter) from words it does. Names,
// all-caps words and anything near a digit are left alone.

/** The rules of an .aff file. */
export function parseAff(text) {
  const aff = { flag: 'char', pfx: new Map(), sfx: new Map(), aliases: null, needaffix: null, forbidden: null, onlyincompound: null, keepcase: null, try: '', rep: [] };
  let alias = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line[0] === '#') continue;
    const f = line.split(/\s+/);
    switch (f[0]) {
      case 'FLAG': aff.flag = f[1] === 'long' ? 'long' : f[1] === 'num' ? 'num' : 'char'; break;
      case 'TRY': aff.try = f[1] || ''; break;
      case 'NEEDAFFIX': case 'PSEUDOROOT': aff.needaffix = f[1]; break;
      case 'FORBIDDENWORD': aff.forbidden = f[1]; break;
      case 'ONLYINCOMPOUND': aff.onlyincompound = f[1]; break;
      case 'KEEPCASE': aff.keepcase = f[1]; break;
      case 'REP': if (f.length >= 3) aff.rep.push([f[1].replace(/_/g, ' '), f[2].replace(/_/g, ' ')]); break;
      case 'AF':
        if (alias == null) { alias = []; aff.aliases = alias; } // the count line
        else alias.push(f[1] || '');
        break;
      case 'PFX': case 'SFX': {
        const map = f[0] === 'PFX' ? aff.pfx : aff.sfx;
        const flag = f[1];
        if (!map.has(flag)) { map.set(flag, { cross: f[2] === 'Y', rules: [] }); break; } // the header
        if (f.length < 4) break;
        const strip = f[2] === '0' ? '' : f[2];
        const add = (f[3] === '0' ? '' : f[3]).split('/')[0].replace(/^0$/, '');
        const cond = f[4] && f[4] !== '.' ? f[4] : '';
        let re = null;
        if (cond) try { re = new RegExp(f[0] === 'PFX' ? '^' + cond : cond + '$', 'u'); } catch { continue; }
        map.get(flag).rules.push({ strip, add, re });
        break;
      }
    }
  }
  if (aff.aliases) aff.aliases = aff.aliases.map((s) => splitFlags(s, aff.flag)); // AF flags are written as the dictionary's
  return aff;
}

/** The flags in a string, as the dictionary writes them. */
export function splitFlags(s, mode) {
  if (!s) return [];
  if (mode === 'long') { const out = []; for (let i = 0; i < s.length; i += 2) out.push(s.slice(i, i + 2)); return out; }
  if (mode === 'num') return s.split(',').filter(Boolean);
  return [...s];
}

export class Speller {
  /** A dictionary from the text of its .aff and .dic files. */
  constructor(affText, dicText) {
    const aff = this.aff = parseAff(affText);
    this.words = new Map(); // word → its flags (a Set), or null for none
    const lines = dicText.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) { // (the first line is the count)
      const line = lines[i].trim();
      if (!line || line[0] === '#') continue;
      const tok = line.split(/[\t ]/)[0];
      const k = tok.search(/(?<!\\)\//);
      const word = (k < 0 ? tok : tok.slice(0, k)).replace(/\\\//g, '/');
      let flags = k < 0 ? [] : tok.slice(k + 1);
      flags = typeof flags === 'string' ? (aff.aliases && /^\d+$/.test(flags) ? aff.aliases[+flags - 1] || [] : splitFlags(flags, aff.flag)) : flags;
      if (!word) continue;
      const had = this.words.get(word);
      const set = had ? new Set([...had, ...flags]) : flags.length ? new Set(flags) : null;
      this.words.set(word, set);
    }
    // The affix rules by what they add, for taking an ending (or a beginning) off a word.
    this.byEnd = new Map(); this.byStart = new Map(); this.longest = 0;
    for (const [map, index] of [[aff.sfx, this.byEnd], [aff.pfx, this.byStart]]) {
      for (const [flag, { cross, rules }] of map) for (const r of rules) {
        if (!index.has(r.add)) index.set(r.add, []);
        index.get(r.add).push({ flag, cross, ...r });
        this.longest = Math.max(this.longest, r.add.length);
      }
    }
    this.alphabet = [...new Set([...(aff.try || '').toLowerCase(), ...'esianrtolcdugmphbyfvkwzxjq'])].filter((ch) => /\p{L}/u.test(ch)).join('');
    this.cache = new Map();
  }

  /** A stem the dictionary has, with this flag (or with none needed). */
  stem(w, flag, affixed) {
    if (!this.words.has(w)) return false;
    const f = this.words.get(w);
    const a = this.aff;
    if (f && (f.has(a.forbidden) || f.has(a.onlyincompound))) return false;
    if (flag == null) return affixed || !(f && f.has(a.needaffix));
    return !!f && f.has(flag);
  }

  /** The word as written (exact case), by its stem and at most one prefix and one suffix. */
  form(w) {
    if (this.stem(w)) return true;
    const L = w.length;
    // A suffix off, then maybe a prefix off what is left (when both allow it).
    for (let n = 0; n <= Math.min(this.longest, L - 1); n++) {
      const rules = this.byEnd.get(n ? w.slice(L - n) : '');
      if (!rules) continue;
      for (const r of rules) {
        const base = w.slice(0, L - n) + r.strip;
        if (!base || (r.re && !r.re.test(base))) continue;
        if (this.stem(base, r.flag)) return true;
        if (r.cross && this.prefixed(base, r.flag)) return true;
      }
    }
    return this.prefixed(w, null);
  }

  /** w with a prefix taken off is a stem (with the suffix flag `sfx`, crossing, when given). */
  prefixed(w, sfx) {
    const L = w.length;
    for (let n = 1; n <= Math.min(this.longest, L - 1); n++) {
      const rules = this.byStart.get(w.slice(0, n));
      if (!rules) continue;
      for (const r of rules) {
        if (sfx != null && !r.cross) continue;
        const base = r.strip + w.slice(n);
        if (r.re && !r.re.test(base)) continue;
        if (sfx == null ? this.stem(base, r.flag) : this.stem(base, sfx) && this.stem(base, r.flag)) return true;
      }
    }
    return false;
  }

  /** Whether the dictionary knows the word: as written, in lower case, or capitalised as it has it. */
  has(word) {
    word = word.replace(/’/g, "'");
    let v = this.cache.get(word);
    if (v !== undefined) return v;
    const lower = word.toLowerCase(), cap = lower[0].toUpperCase() + lower.slice(1);
    v = this.form(word) || (word !== lower && (word === cap || word === word.toUpperCase()) && this.form(lower)) || (word === word.toUpperCase() && this.form(cap));
    if (!v && /'s$/i.test(word)) v = this.has(word.slice(0, -2)); // a possessive
    if (this.cache.size > 50000) this.cache.clear();
    this.cache.set(word, v);
    return v;
  }

  /** Words the dictionary knows one edit away, the likeliest first: a swapped pair, a known slip (REP),
   *  a doubled letter missing or extra, a wrong letter, a missing one, an extra one. Same case as the word. */
  suggest(word, max = 6) { return this.ranked(word).slice(0, max).map(([c]) => inCaseOf(word, c)); }

  /** [fix, rank] one edit away, best first (rank 0 a swap, 1 a known slip, 2 a doubled letter, 3–4 the rest). */
  ranked(word) {
    const w = word.replace(/’/g, "'").toLowerCase(), found = new Map();
    const add = (c, rank) => { if (c && c !== w && !found.has(c) && this.has(c)) found.set(c, rank); };
    for (let i = 0; i + 1 < w.length; i++) add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), 0);
    for (const [from, to] of this.aff.rep) for (let i = w.indexOf(from); i >= 0; i = w.indexOf(from, i + 1)) add(w.slice(0, i) + to + w.slice(i + from.length), 1);
    for (let i = 0; i < w.length; i++) { add(w.slice(0, i) + w[i] + w.slice(i), 2); if (w[i] === w[i + 1]) add(w.slice(0, i) + w.slice(i + 1), 2); }
    for (let i = 0; i < w.length; i++) for (const ch of this.alphabet) add(w.slice(0, i) + ch + w.slice(i + 1), 3);
    for (let i = 0; i < w.length; i++) add(w.slice(0, i) + w.slice(i + 1), 4);
    for (let i = 0; i <= w.length; i++) for (const ch of this.alphabet) add(w.slice(0, i) + ch + w.slice(i), 4);
    return [...found].filter(([c]) => !c.includes(' ')).sort((a, b) => a[1] - b[1]);
  }

  /** An obvious slip: { fixes, auto } (auto: the one fix to make on Space, if there is one), or null. */
  check(word) {
    if (this.has(word)) return null;
    const r = this.ranked(word);
    if (!r.length) return null;
    // Sure enough to correct as you type: a single fix in all, or a single swapped pair, known slip or
    // doubled letter that beats the rest.
    const best = r.filter(([, k]) => k === r[0][1]);
    const auto = r.length === 1 || (r[0][1] <= 2 && best.length === 1) ? inCaseOf(word, r[0][0]) : null;
    return { fixes: r.slice(0, 6).map(([c]) => inCaseOf(word, c)), auto };
  }
}

// ---- the words of a script ------------------------------------------------------------------------

/** The elements spelling looks at: what is written in sentences (headings, cues, transitions are all caps). */
export const SPELLED = new Set(['action', 'dialogue', 'paren']);
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

/**
 * The words of a line of text worth checking: { s, e, word }. Left alone: words under three letters,
 * all caps, with a capital inside, capitalised but not starting a sentence (a name), or touching a
 * digit, a slash, an @ or a dot inside (a URL, an abbreviation, "e.g.").
 */
export function wordsToCheck(text) {
  const out = [];
  for (const m of text.matchAll(WORD)) {
    const word = m[0], s = m.index, e = s + word.length;
    if (word.length < 3) continue;
    const before = text[s - 1] || '', after = text[e] || '';
    if (/[\d/@\\_]/.test(before + after) || (after === '.' && /\p{L}/u.test(text[e + 1] || '')) || (before === '.' && /\p{L}/u.test(text[s - 2] || ''))) continue;
    const letters = word.replace(/['’]/g, '');
    if (letters === letters.toUpperCase()) continue;
    if (/\p{Lu}/u.test(letters.slice(1))) continue;
    if (letters[0] !== letters[0].toLowerCase() && !startsSentence(text, s)) continue;
    out.push({ s, e, word });
  }
  return out;
}

const startsSentence = (text, s) => {
  let j = s - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j < 0 || /[.!?…:"“”(\[—–-]/.test(text[j]);
};

/** Names in a line of text: words capitalised where no sentence starts ("she sees Mara"), in lower case. */
export function namesIn(text, into = new Set()) {
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    if (w[0] !== w[0].toLowerCase() && w.slice(1) === w.slice(1).toLowerCase() && !startsSentence(text, m.index)) into.add(w.toLowerCase());
  }
  return into;
}

/** A fix in the case of the word it replaces (Capitalised for Capitalised). */
export function inCaseOf(word, fix) {
  return word[0] !== word[0].toLowerCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
}

/** "en_US" → "English (United States)"; the code as it is when the name isn't known. */
export function languageName(code) {
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(code.replace(/_/g, '-'));
    return n && n !== code ? n : code;
  } catch { return code; }
}

/** a and b are one edit apart: a letter swapped with the next, changed, missing or extra. */
export function oneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
