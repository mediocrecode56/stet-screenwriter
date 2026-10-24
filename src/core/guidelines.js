// The Revise guidelines: what the writer has told Claude's revision not to flag, learned from the
// suggestions they set aside. Nothing here touches spelling, which keeps its own dictionary
// (settings.dictionary); the guidelines live in settings.guidelines, for every screenplay.
//
// What is stored is evidence, never rules: each suggestion set aside with +GUIDELINE is kept as a
// flag (its passage, its kind, the edit Claude wanted, who speaks it, an optional note in the
// writer's words), and each suggestion accepted although it looked like a guideline is kept as a
// flag `against` it. What the guidelines are is worked out from that evidence every time, so they
// sharpen as it grows, weaken when the writer contradicts them, and never depend on order.
//
// A new suggestion is weighed against every flag by the closest thing they share (only the
// closest: one flag is one piece of evidence):
//
//   same passage, same kind              1      set aside twice: understood
//   same passage, another kind           0.6
//   same edit (words out → words in)     0.5    the same change four times: understood
//   one passage inside the other         0.4    (two or more words)
//   same words kept, whatever the fix    0.35   "gonna" kept against several fixes
//
// and, apart from those, a character's voice: each flag of the same kind in the same character's
// lines adds 0.25, up to 1.5 (a voice alone never hides a suggestion; with other evidence it can).
// Flags against count the same, the other way (and past that cap: the writer's latest word counts).
//
// How sure the evidence must be follows how sure Claude is: a high-confidence suggestion is held
// back only at 2.5, a medium one at 2, a low one at 1.5. Below that, from 0.4, it still shows,
// marked as close to a guideline, and Claude hears it as a hint. Notes the writer types themselves,
// with no passage, go to Claude as written and never hide anything by themselves.
//
// The list keeps at most MAX flags. When it is full, the evidence a guideline no longer needs goes
// first (the surplus examples of one already understood), so what has been learned is never lost
// to age; only then the oldest.

import { normalize, spaceless } from './revision.js';

export const FIRM = 2;
export const SOFT = 0.4;
const MAX = 400;
const VOICE = 0.25, VOICE_CAP = 1.5;
const NEED = { high: 1.25, medium: 1, low: 0.75 }; // × FIRM, by Claude's confidence

/** A passage as compared: one Unicode form, lower case, straight quotes, no punctuation at its ends. */
export const canon = (t) => normalize(String(t || '').normalize('NFC')).replace(/[‘’ʼ`]/g, "'").replace(/[“”«»„]/g, '"').replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');

/** Words, in any language; where a script has no spaces (Chinese, Japanese, Thai…) each character is one. */
export function words(t) {
  const out = [];
  for (const w of canon(t).match(/[\p{L}\p{N}\p{M}']+/gu) || []) {
    if (!spaceless(w)) { out.push(w); continue; }
    let run = '';
    for (const ch of w) {
      if (spaceless(ch)) { if (run) out.push(run); run = ''; out.push(ch); } else run += ch;
    }
    if (run) out.push(run);
  }
  return out;
}

/** The edit a suggestion makes, as words out → words in ("gonna→going to"), or '' when there is none. */
export function editOf(original, replacement) {
  const a = words(original), b = words(replacement);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const out = a.slice(p, a.length - q).join(' '), inn = b.slice(p, b.length - q).join(' ');
  return out || inn ? `${out}→${inn}` : '';
}

/** The words an edit takes out ('' when it only adds). Short ones only: a long one is a passage, not a habit. */
const keptOf = (edit) => {
  const out = edit ? edit.slice(0, edit.indexOf('→')) : '';
  return out && out.split(' ').length <= 3 ? out : '';
};

/** A flag from a suggestion set aside (or, `against`, accepted although it matched). */
export function flagOf(f, { note = '', against = false, at = Date.now() } = {}) {
  const text = f.shownOriginal || f.original || '';
  return {
    text, category: f.category, replacement: f.shownReplacement ?? f.replacement ?? '',
    edit: editOf(text, f.shownReplacement ?? f.replacement ?? ''), note: String(note || '').trim().slice(0, 300),
    ...(f.speaker && f.type !== 'action' ? { speaker: String(f.speaker).slice(0, 60) } : {}),
    ...(against ? { against: true } : {}), at,
  };
}

/** A guideline the writer wrote themselves: only a note. */
export const noteFlag = (note, at = Date.now()) => ({ text: '', category: null, replacement: '', edit: '', note: String(note).trim().slice(0, 300), at });

// A suggestion's own features, worked out once however many flags it is weighed against.
const featuresOf = (f) => {
  const text = f.shownOriginal || f.original || '', edit = editOf(text, f.shownReplacement ?? f.replacement ?? '');
  return { t: canon(text), n: words(text).length, category: f.category, edit, kept: keptOf(edit), speaker: f.type === 'action' ? '' : f.speaker || '' };
};
const flagFeatures = (g) => ({ t: canon(g.text), n: words(g.text).length, category: g.category, edit: g.edit, kept: keptOf(g.edit), speaker: g.speaker || '' });

/** How much a flag speaks for leaving a suggestion alone, by the closest thing their features share (0: nothing). */
function closeness(a, b) {
  if (a.t && a.t === b.t) return a.category === b.category ? 1 : 0.6;
  if (a.category !== b.category) return 0;
  if (a.edit && a.edit === b.edit) return 0.5;
  if (a.t && b.t && Math.min(a.n, b.n) >= 2 && (a.t.includes(b.t) || b.t.includes(a.t))) return 0.4;
  if (a.kept && a.kept === b.kept) return 0.35;
  return 0;
}

/** How sure the evidence must be to hold suggestion f back. */
export const firmAt = (f) => FIRM * (NEED[f.confidence] || 1);

/** Suggestion f against the writer's flags: { score, level: 'none' | 'soft' | 'firm', notes }. */
export function assess(f, flags = []) {
  const a = featuresOf(f);
  let score = 0, voice = 0, unvoice = 0;
  const notes = [];
  for (const g of flags) {
    if (!g.text) continue;
    const b = flagFeatures(g), sign = g.against ? -1 : 1;
    const w = closeness(a, b);
    if (w) {
      score += sign * w;
      if (!g.against && g.note && !notes.includes(g.note)) notes.push(g.note);
    } else if (a.speaker && a.speaker === b.speaker && a.category === b.category) {
      if (g.against) unvoice += VOICE; else voice += VOICE;
    }
  }
  score = Math.round((score + Math.min(voice, VOICE_CAP) - unvoice) * 100) / 100;
  return { score, level: score >= firmAt(f) ? 'firm' : score >= SOFT ? 'soft' : 'none', notes };
}

/**
 * New suggestions through the guidelines: the firm matches held back, the soft ones kept and
 * marked (f.guide = { score, notes }) so the panel can say so.
 */
export function applyGuidelines(findings, flags = []) {
  const kept = [];
  let held = 0;
  for (const f of findings) {
    const a = assess(f, flags);
    if (a.level === 'firm') { held++; continue; }
    if (a.level === 'soft') f.guide = { score: a.score, notes: a.notes };
    kept.push(f);
  }
  return { findings: kept, held };
}

/** Each flag's guideline: its passage, or, when no other flag shares the passage, its edit (null for a note). */
function groupKeys(flags) {
  const texts = flags.map((g) => (g.text ? canon(g.text) : null)), seen = new Map();
  for (const t of texts) if (t != null) seen.set(t, (seen.get(t) || 0) + 1);
  return flags.map((g, i) => texts[i] == null ? null : g.edit && seen.get(texts[i]) === 1 ? `edit:${g.category}|${g.edit}` : `text:${g.category}|${texts[i]}`);
}

/**
 * Add a flag to the list (a copy). Evidence a guideline no longer needs is not kept: the same
 * passage set aside again once it is well understood adds only its note. Past MAX, the surplus
 * examples of understood guidelines go first, then the oldest.
 */
export function addFlag(flags = [], flag) {
  if (flag.text && !flag.against) {
    const all = [...flags, flag], key = groupKeys(all).at(-1);
    const g = guidelinesOf(all).find((x) => x.key === key);
    if (g && g.score - 1 >= FIRM + 1) { // (understood well enough without this one)
      if (!flag.note || flags.some((o) => o.note === flag.note)) return flags;
    }
  }
  const out = [...flags, flag];
  while (out.length > MAX) out.splice(spare(out), 1);
  return out;
}

/**
 * Which flag to let go of: a surplus example of an understood guideline (one it stays understood
 * without), else the oldest that no understood guideline rests on, else the oldest.
 */
function spare(flags) {
  const list = guidelinesOf(flags), firm = new Set();
  let best = -1;
  const older = (i) => best === -1 || flags[i].at < flags[best].at;
  for (const g of list) {
    if (g.level !== 'firm') continue;
    for (const i of g.idx) firm.add(i);
    const each = g.key.startsWith('text:') ? 1 : 0.5;
    if (g.score - each >= FIRM) for (const i of g.idx) if (!flags[i].note && !flags[i].against && older(i)) best = i;
  }
  if (best !== -1) return best;
  for (let i = 0; i < flags.length; i++) if (flags[i].text && !firm.has(i) && older(i)) best = i;
  return best === -1 ? 0 : best;
}

/**
 * The guidelines as the writer and Claude see them: the flags grouped by what they are about (the
 * same passage, or else the same edit), with how firm each is. Notes alone are listed last.
 */
export function guidelinesOf(flags = []) {
  const groups = new Map(), keys = groupKeys(flags);
  flags.forEach((g, i) => {
    const key = keys[i] || 'note:' + i;
    if (!groups.has(key)) groups.set(key, { key, category: g.category, text: g.text, edit: g.edit, notes: [], examples: [], score: 0, idx: [] });
    const x = groups.get(key);
    x.idx.push(i);
    if (g.note && !x.notes.includes(g.note)) x.notes.push(g.note);
    if (!g.text) return;
    if (!g.against && !x.examples.includes(g.text)) x.examples.push(g.text);
    x.score += (key.startsWith('text:') ? 1 : 0.5) * (g.against ? -1 : 1);
  });
  return [...groups.values()].map((x) => ({
    ...x, score: Math.round(x.score * 100) / 100,
    level: !x.text ? 'note' : x.score >= FIRM ? 'firm' : x.score > 0 ? 'soft' : 'none',
  })).filter((x) => x.level !== 'none').sort((a, b) => (a.level === 'note') - (b.level === 'note') || b.score - a.score);
}

/**
 * What the flags show beyond single passages and edits: words the writer keeps whatever Claude
 * offers instead (three times or more, two different fixes at least), and a character whose lines
 * the writer keeps setting aside for the same kind of problem (three times or more, net).
 * [{ kind: 'kept' | 'voice', category, what, count, examples }]
 */
export function patternsOf(flags = []) {
  const kept = new Map(), voice = new Map();
  for (const g of flags) {
    if (!g.text) continue;
    const sign = g.against ? -1 : 1, k = keptOf(g.edit);
    if (k) {
      const x = kept.get(g.category + '|' + k) || { kind: 'kept', category: g.category, what: k, count: 0, fixes: new Set(), examples: [] };
      x.count += sign;
      if (!g.against) { x.fixes.add(g.edit); if (!x.examples.includes(g.text)) x.examples.push(g.text); }
      kept.set(g.category + '|' + k, x);
    }
    if (g.speaker) {
      const x = voice.get(g.category + '|' + g.speaker) || { kind: 'voice', category: g.category, what: g.speaker, count: 0, examples: [] };
      x.count += sign;
      if (!g.against && !x.examples.includes(g.text)) x.examples.push(g.text);
      voice.set(g.category + '|' + g.speaker, x);
    }
  }
  return [
    ...[...kept.values()].filter((x) => x.count >= 3 && x.fixes.size >= 2).map(({ fixes, ...x }) => x),
    ...[...voice.values()].filter((x) => x.count >= 3),
  ].sort((a, b) => b.count - a.count);
}

/** The guidelines for Claude, in the review's instructions ('' when there are none). */
export function guidelinesPrompt(flags = []) {
  const list = guidelinesOf(flags).slice(0, 120), patterns = patternsOf(flags).slice(0, 30);
  if (!list.length && !patterns.length) return '';
  const q = (t) => JSON.stringify(t);
  const line = (g) => {
    if (g.level === 'note') return `- (the writer's note) ${q(g.notes[0])}`;
    const what = g.key.startsWith('edit:') && g.edit && g.examples.length > 1 ? `changing ${q(g.edit.replace('→', ' → '))}, as in ${g.examples.slice(0, 3).map(q).join(', ')}` : `${q(g.text)}`;
    return `- [${g.level === 'firm' ? 'firm' : 'hint'}] ${g.category}: ${what}${g.notes.length ? ` (writer's note: ${g.notes.map(q).join('; ')})` : ''}`;
  };
  const pattern = (p) => p.kind === 'kept'
    ? `- [pattern] ${p.category}: the writer keeps ${q(p.what)} whatever the fix (${p.count} times, as in ${p.examples.slice(0, 2).map(q).join(', ')})`
    : `- [pattern] ${p.category} in ${p.what}'s lines: set aside ${p.count} times; treat it as the character's voice, and flag it there only when it is clearly a mistake`;
  return `The writer's guidelines: things they have set aside before and don't want flagged. They are soft. A "firm" one the writer has confirmed more than once: don't flag passages it covers. A "hint" was set aside only once: flag a passage it covers only if it is clearly an error, and say in the explanation that it may be intentional. A "pattern" is what the writer's choices show across many passages: apply it to similar passages too, with the same care. Use the writer's notes to understand what they mean.\n${[...list.map(line), ...patterns.map(pattern)].join('\n')}`;
}

/** Remove a guideline (all its flags) from the list. */
export function removeGuideline(flags = [], g) {
  const drop = new Set(g.idx);
  return flags.filter((_, i) => !drop.has(i));
}

/** Keep only well-formed flags (settings may come from an older or edited file). */
export function cleanFlags(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((g) => g && typeof g === 'object' && typeof g.text === 'string' && (g.text || g.note)).map((g) => ({
    text: g.text, category: typeof g.category === 'string' ? g.category : null, replacement: typeof g.replacement === 'string' ? g.replacement : '',
    // (the edit worked out again, the same way for flags of every version)
    edit: g.text && typeof g.replacement === 'string' ? editOf(g.text, g.replacement) : typeof g.edit === 'string' ? g.edit : '', note: typeof g.note === 'string' ? g.note : '',
    ...(typeof g.speaker === 'string' && g.speaker ? { speaker: g.speaker.slice(0, 60) } : {}),
    ...(g.against ? { against: true } : {}), at: Number(g.at) || 0,
  }));
}
