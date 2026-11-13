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
// How sure the evidence must be follows how sure Claude is: a medium-confidence suggestion is held
// back at 2, a low one at 1.5. Below that, from 0.4, it still shows, marked as close to a guideline.
//
// The guidelines must never make the review stop finding mistakes, so they are kept narrow:
//
//   * Claude is told to report everything, guidelines or not, and only to say which guideline
//     covers a passage (the finding's "guideline": G1, G2…). What is held back is decided here,
//     where it can be seen, never by Claude leaving something out.
//   * What Claude calls a clear error (high confidence) is held back only by the very passage,
//     set aside again and again (2.5). The same edit elsewhere, a character's voice, a pattern or a
//     note can mark it GUIDELINE?, never hide it.
//   * An edit that only adds words ("→the") says nothing about other passages: it is not a habit
//     of the writer's, it is how that mistake is always fixed. It counts for its own passage only.
//   * Nothing held back is thrown away: it stays in the review as "held" (the panel's HELD BACK
//     list), where REOPEN brings it back, and accepting it then counts against the guideline.
//   * A strict review (the panel's STRICT button) leaves the guidelines out altogether.
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

/** Whether an edit can stand for a habit elsewhere: only one that takes words out. */
const generalizes = (edit) => !!edit && !edit.startsWith('→');

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
  if (a.edit && a.edit === b.edit && generalizes(a.edit)) return 0.5;
  if (a.t && b.t && Math.min(a.n, b.n) >= 2 && (a.t.includes(b.t) || b.t.includes(a.t))) return 0.4;
  if (a.kept && a.kept === b.kept) return 0.35;
  return 0;
}

/** How sure the evidence must be to hold suggestion f back. */
export const firmAt = (f) => FIRM * (NEED[f.confidence] || 1);

const round2 = (n) => Math.round(n * 100) / 100;

/** Suggestion f against the writer's flags: { score, level: 'none' | 'soft' | 'firm', notes, why } (why: the closest passage set aside). */
export function assess(f, flags = []) {
  const a = featuresOf(f);
  let direct = 0, exact = 0, voice = 0, unvoice = 0, best = null, bestW = 0;
  const notes = [];
  for (const g of flags) {
    if (!g.text) continue;
    const b = flagFeatures(g), sign = g.against ? -1 : 1;
    const w = closeness(a, b);
    if (w) {
      direct += sign * w;
      if (a.t && a.t === b.t) exact += sign * w;
      if (g.against) continue;
      if (g.note && !notes.includes(g.note)) notes.push(g.note);
      if (w > bestW) { bestW = w; best = g; }
    } else if (a.speaker && a.speaker === b.speaker && a.category === b.category) {
      if (g.against) unvoice += VOICE; else voice += VOICE;
    }
  }
  const score = round2(direct + Math.min(voice, VOICE_CAP) - unvoice), need = firmAt(f);
  // Held back only on evidence about the passage itself (a voice alone never is); a clear error only
  // on the very passage set aside.
  const firm = direct > 0 && (f.confidence === 'high' ? round2(exact) >= need : score >= need);
  return { score, level: firm ? 'firm' : score >= SOFT ? 'soft' : 'none', notes, why: best ? best.text : '' };
}

/**
 * New suggestions through the guidelines. All of them come back: those the guidelines cover are
 * marked held (decision 'held', heldBy: what covers them), those close to one are marked
 * (f.guide = { score, notes }) so the panel can say so. `held` counts the former.
 * A suggestion is held when the evidence here is firm (assess), or when Claude says a guideline
 * covers it (f.tagged) that is more than a hint, and Claude is not sure it is an error.
 * A strict review skips all of it.
 */
export function applyGuidelines(findings, flags = [], { strict = false } = {}) {
  const tags = strict ? null : new Map(promptEntries(flags).map((e) => [e.id, e]));
  let held = 0;
  for (const f of findings) {
    const tag = tags && f.tagged ? tags.get(f.tagged) : null;
    delete f.tagged;
    if (strict) continue;
    const a = assess(f, flags);
    const notes = a.notes.length ? a.notes : tag ? [tag.label] : [];
    if (a.level === 'firm' || (tag && tag.level !== 'hint' && f.confidence !== 'high')) {
      f.decision = 'held';
      f.heldBy = (a.level === 'firm' ? a.why : tag.label).slice(0, 200);
      f.guide = { score: a.score, notes };
      held++;
    } else if (a.level === 'soft' || tag) f.guide = { score: a.score, notes };
  }
  return { findings, held };
}

/** Each flag's guideline: its passage, or, when no other flag shares the passage, its edit (null for a note). */
function groupKeys(flags) {
  const texts = flags.map((g) => (g.text ? canon(g.text) : null)), seen = new Map();
  for (const t of texts) if (t != null) seen.set(t, (seen.get(t) || 0) + 1);
  return flags.map((g, i) => texts[i] == null ? null : generalizes(g.edit) && seen.get(texts[i]) === 1 ? `edit:${g.category}|${g.edit}` : `text:${g.category}|${texts[i]}`);
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
    if (!groups.has(key)) groups.set(key, { key, category: g.category, text: g.text, edit: g.edit, notes: [], examples: [], score: 0, idx: [], times: 0, against: 0, last: 0 });
    const x = groups.get(key);
    x.idx.push(i);
    if (g.against) x.against++; else x.times++; // (how often set aside, and how often accepted after all)
    x.last = Math.max(x.last, g.at || 0);
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

const q = (t) => JSON.stringify(t);
const arrow = (edit) => edit.replace('→', ' → ');

/**
 * The guidelines as Claude is given them, numbered: [{ id: 'G1', level: 'firm' | 'hint' | 'pattern' | 'note',
 * text (the line Claude reads), label (the same in a few words, for the writer) }].
 */
export function promptEntries(flags = []) {
  const out = [];
  const add = (level, text, label) => out.push({ id: 'G' + (out.length + 1), level, text, label });
  for (const g of guidelinesOf(flags).slice(0, 120)) {
    if (g.level === 'note') { add('note', q(g.notes[0]), g.notes[0]); continue; }
    const habit = g.key.startsWith('edit:') && g.examples.length > 1;
    const what = habit ? `changing ${q(arrow(g.edit))}, as in ${g.examples.slice(0, 3).map(q).join(', ')}` : q(g.text);
    add(g.level === 'firm' ? 'firm' : 'hint', `${g.category}: ${what}${g.notes.length ? ` (writer's note: ${g.notes.map(q).join('; ')})` : ''}`, habit ? arrow(g.edit) : g.text);
  }
  for (const p of patternsOf(flags).slice(0, 30)) {
    if (p.kind === 'kept') add('pattern', `${p.category}: the writer keeps ${q(p.what)} whatever the fix (${p.count} times, as in ${p.examples.slice(0, 2).map(q).join(', ')})`, `keeps “${p.what}”`);
    else add('pattern', `${p.category} in ${p.what}'s lines: set aside ${p.count} times; it is how the character speaks`, `${p.what}’s lines`);
  }
  return out;
}

/** The guidelines for Claude, in the review's instructions ('' when there are none). */
export function guidelinesPrompt(flags = []) {
  const list = promptEntries(flags);
  if (!list.length) return '';
  return `The writer's guidelines: what they have set aside in earlier reviews, numbered. They never make you leave a problem out: report everything you would report without them, with the confidence you would give it without them. For each issue, if one of them clearly covers its passage, put its number in "guideline"; otherwise leave "guideline" empty. Do not stretch a guideline to passages it does not clearly cover. A "firm" one the writer has confirmed more than once. A "hint" was set aside only once. A "pattern" is what the writer's choices show across many passages: it covers similar passages too. A "note" is in the writer's own words: use it, and the notes on the others, to understand what they mean.\n${list.map((e) => `${e.id} [${e.level}] ${e.text}`).join('\n')}`;
}

// ---- the direction: one sentence about where the guidelines are taking the review ------------
//
// Written by Claude (or Codex) each time a guideline is added or removed, and kept in the settings
// with the key of the flags it was written for (settings.guidelineDirection = { text, key, via }).
// With no guidelines, or when neither can be reached, the plain sentence below stands in.

/** What the direction was written for: changes whenever a flag is added, removed or changed. */
export function flagsKey(flags = []) {
  let h = 5381;
  for (const g of flags) for (const ch of `${g.text}|${g.category}|${g.edit}|${g.note}|${g.against ? 1 : 0};`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return `${flags.length}:${(h >>> 0).toString(36)}`;
}

export const NO_GUIDELINES = 'No guidelines yet: Revise flags everything it finds.';

/** The direction in plain counts: what stands in until Claude has written one. */
export function localDirection(flags = []) {
  const list = guidelinesOf(flags), n = (k) => list.filter((g) => g.level === k).length, pats = patternsOf(flags).length;
  if (!list.length) return NO_GUIDELINES;
  const s = (k, one, many) => (k === 1 ? `1 ${one}` : `${k} ${many}`);
  const parts = [
    n('firm') && `holds back ${s(n('firm'), 'thing', 'things')} you set aside more than once`,
    n('soft') && `marks ${s(n('soft'), 'thing', 'things')} you set aside once`,
    pats && `has noticed ${s(pats, 'habit', 'habits')} of yours`,
    n('note') && `reads ${s(n('note'), 'note', 'notes')} you wrote`,
  ].filter(Boolean);
  return `Revise ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]}. Clear errors are always shown.`;
}

/** What to ask Claude for the direction: { system, prompt }, or null with no guidelines. */
export function directionRequest(flags = []) {
  const list = promptEntries(flags);
  if (!list.length) return null;
  return {
    system: 'You describe, for the writer of a screenplay, where their guidelines are taking the language review of their scripts. The review flags grammar errors, non-native constructions and awkward phrasing; each guideline is something the writer set aside ("firm": more than once, so the review now holds it back; "hint": once, so it is still shown, marked; "pattern": a habit the review has noticed; "note": the writer\'s own words). Answer with one sentence of at most 28 words, in plain English, addressed to the writer as "you", that says what kind of thing the review now leaves alone and what it is still learning. Name the kinds of thing (a character\'s dialect, dropped articles, a word you keep), not a list of passages. No preamble, no quotation marks around the sentence, no second sentence.',
    prompt: `The guidelines:\n${list.map((e) => `[${e.level}] ${e.text}`).join('\n')}`,
  };
}

/** Claude's answer as the one sentence asked for ('' when it is not usable). */
export function cleanDirection(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["“'‘](.*)["”'’]$/, '$1'); // (quotation marks around the whole of it only)
  return t.length >= 12 && t.length <= 320 ? t : '';
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
