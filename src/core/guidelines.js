// The Revise guidelines: what the writer has told Claude's English revision not to flag, learned
// from the suggestions they set aside. Nothing here touches spelling, which keeps its own
// dictionary (settings.dictionary); the guidelines live in settings.guidelines, for every screenplay.
//
// Guidelines are soft. Each time the writer sets a suggestion aside with +GUIDELINE, that
// suggestion is kept as a flag: its passage, its kind, the edit Claude wanted and an optional
// note in the writer's words. A new suggestion is weighed against every flag:
//
//   same passage, same kind              1     (set aside twice: it is understood)
//   same passage, another kind           0.6
//   same edit (words out → words in)     0.5   (the same pattern four times: understood)
//   one passage inside the other         0.4   (two or more words)
//
// and a suggestion the writer accepted although it looked like a guideline counts against it
// (`against` flags, by the same weights). Below FIRM a matching suggestion still shows, marked as
// close to a guideline, and Claude is only told about it as a hint; at FIRM and above it is held
// back, and Claude is told it is a firm preference. Notes the writer types themselves, with no
// passage, go to Claude as written and never hide anything by themselves.

import { normalize } from './revision.js';

export const FIRM = 2;
const MAX = 400; // flags kept: the oldest go first

const words = (t) => normalize(t).match(/[\p{L}\p{N}'’]+/gu) || [];

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

/** A flag from a suggestion set aside (or, `against`, accepted although it matched). */
export function flagOf(f, { note = '', against = false, at = Date.now() } = {}) {
  const text = f.shownOriginal || f.original || '';
  return {
    text, category: f.category, replacement: f.shownReplacement ?? f.replacement ?? '',
    edit: editOf(text, f.shownReplacement ?? f.replacement ?? ''), note: String(note || '').trim().slice(0, 300),
    ...(against ? { against: true } : {}), at,
  };
}

/** A guideline the writer wrote themselves: only a note. */
export const noteFlag = (note, at = Date.now()) => ({ text: '', category: null, replacement: '', edit: '', note: String(note).trim().slice(0, 300), at });

/** How much a flag speaks for leaving suggestion f alone (0: not at all). */
export function weigh(f, flag) {
  if (!flag.text) return 0;
  const t = normalize(f.shownOriginal || f.original), k = normalize(flag.text);
  if (t && t === k) return f.category === flag.category ? 1 : 0.6;
  if (f.category !== flag.category) return 0;
  const e = editOf(f.shownOriginal || f.original, f.shownReplacement ?? f.replacement);
  if (e && e === flag.edit) return 0.5;
  if (t && k && (t.includes(k) || k.includes(t)) && Math.min(words(t).length, words(k).length) >= 2) return 0.4;
  return 0;
}

/** Suggestion f against the writer's flags: { score, level: 'none' | 'soft' | 'firm', notes }. */
export function assess(f, flags = []) {
  let score = 0;
  const notes = [];
  for (const g of flags) {
    const w = weigh(f, g);
    if (!w) continue;
    score += g.against ? -w : w;
    if (!g.against && g.note && !notes.includes(g.note)) notes.push(g.note);
  }
  score = Math.round(score * 100) / 100;
  return { score, level: score >= FIRM ? 'firm' : score > 0 ? 'soft' : 'none', notes };
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

/** Add a flag to the list (a copy, the oldest dropped past MAX). */
export function addFlag(flags = [], flag) {
  return [...flags, flag].slice(-MAX);
}

/**
 * The guidelines as the writer and Claude see them: the flags grouped by what they are about (the
 * same passage, or else the same edit), with how firm each is. Notes alone are listed last.
 */
export function guidelinesOf(flags = []) {
  const groups = new Map();
  flags.forEach((g, i) => {
    const key = !g.text ? 'note:' + i : g.edit && !flags.some((o) => o !== g && o.text && normalize(o.text) === normalize(g.text)) ? `edit:${g.category}|${g.edit}` : `text:${g.category}|${normalize(g.text)}`;
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

/** The guidelines for Claude, in the review's instructions ('' when there are none). */
export function guidelinesPrompt(flags = []) {
  const list = guidelinesOf(flags).slice(0, 120);
  if (!list.length) return '';
  const line = (g) => {
    if (g.level === 'note') return `- (the writer's note) ${JSON.stringify(g.notes[0])}`;
    const what = g.key.startsWith('edit:') && g.edit && g.examples.length > 1 ? `changing ${JSON.stringify(g.edit.replace('→', ' → '))}, as in ${g.examples.slice(0, 3).map((e) => JSON.stringify(e)).join(', ')}` : `${JSON.stringify(g.text)}`;
    return `- [${g.level === 'firm' ? 'firm' : 'hint'}] ${g.category}: ${what}${g.notes.length ? ` (writer's note: ${g.notes.map((n) => JSON.stringify(n)).join('; ')})` : ''}`;
  };
  return `The writer's guidelines: things they have set aside before and don't want flagged. They are soft. A "firm" one the writer has confirmed more than once: don't flag passages it covers. A "hint" was set aside only once: flag a passage it covers only if it is clearly an error, and say in the explanation that it may be intentional. Use the writer's notes to understand what they mean.\n${list.map(line).join('\n')}`;
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
    edit: typeof g.edit === 'string' ? g.edit : '', note: typeof g.note === 'string' ? g.note : '', ...(g.against ? { against: true } : {}), at: Number(g.at) || 0,
  }));
}
