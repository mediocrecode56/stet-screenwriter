// English revision: everything about a Claude review except the network call.
//
//  1. buildChunks()      split the script into review requests (scene-aligned,
//                        with read-only context from the preceding elements)
//  2. SYSTEM_PROMPT /
//     FINDINGS_SCHEMA    instructions + structured-output schema for Claude
//  3. validateFindings() check every answer against the snapshot it was made
//                        from: element exists, `original` is really there,
//                        minimal span, no overlaps
//  4. revalidate()       after edits: keep, relocate or mark findings outdated
//  5. planApply()        turn accepted findings into conflict-free replacements
//
// Findings anchor to block ids (stable across edits) plus the exact original
// text, never to positions alone, so a suggestion is only ever applied to the
// text it was made for.

import { cueName } from './model.js';

export const MODEL = 'claude-opus-5-5';
export const CATEGORIES = ['grammar', 'non_native', 'awkward'];
export const CATEGORY_LABEL = { grammar: 'Grammar Error', non_native: 'Non-Native Construction', awkward: 'Awkward Phrasing' };
export const CONFIDENCE = ['high', 'medium', 'low'];

// Elements Claude may flag. Scene headings, cues, transitions and shots are
// sent as context only: they follow their own all-caps conventions.
export const REVIEWABLE = new Set(['action', 'dialogue', 'paren']);
const LABEL = { scene: 'SCENE HEADING', action: 'ACTION', character: 'CHARACTER', paren: 'PARENTHETICAL', dialogue: 'DIALOGUE', transition: 'TRANSITION', shot: 'SHOT' };

export const SYSTEM_PROMPT = `You are a line editor reviewing a screenplay for English-language problems. The writer may not be a native English speaker. Your job is to find real problems and propose the smallest possible fix — never to restyle the script.

Report three kinds of issues:
- grammar: errors in grammar, verb tense, subject–verb agreement, articles, prepositions, pronouns or word forms, and punctuation that affects grammatical correctness.
- non_native: grammatically possible but unnatural English that a fluent native writer would not produce — non-idiomatic collocations, literal translations, unnatural prepositions or word order.
- awkward: clumsy, unclear or needlessly complicated wording, unidiomatic expressions, or unusual word choices that weaken the intended meaning.

Protect the writer's voice:
- Dialogue is how characters speak. Slang, dialect, contractions, fragments, run-ons, profanity, verbal tics, deliberate errors and informal grammar are usually intentional characterization. Never make dialogue more formal. Flag dialogue only when the wording reads as the writer's English mistake rather than the character's voice, and then usually with low or medium confidence.
- Action lines follow screenplay convention: present tense, terse, sentence fragments are normal ("Rain. Silence."), character names in capitals when introduced, sound cues in capitals. Do not flag these conventions.
- Do not change meaning, tone, emotional intention or a character's personality. Do not flatten distinctive prose into generic English. Unusual is not the same as wrong.
- When a phrase could be a deliberate stylistic choice, either leave it alone or flag it with low confidence and say in the explanation that it may be intentional.
- If a passage is correct and natural, report nothing for it. An empty list is the right answer for clean text.

For each issue give:
- element: the id of the element where it occurs (for example "e7"). Only elements inside <review> may be flagged; <context> is for understanding only.
- original: text copied character for character from that element — the shortest span that contains the problem (usually a few words, not the whole sentence).
- replacement: what should replace original. Change only what is needed and keep the writer's own words everywhere else.
- explanation: one or two plain sentences saying what is wrong and why the replacement is correct or more natural.
- confidence: "high" = clearly an error a careful editor would fix; "medium" = very likely unnatural but could be deliberate; "low" = possibly intentional or a matter of taste.

Never report the same span twice or two overlapping spans — combine them into one finding.`;

export const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          element: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          original: { type: 'string' },
          replacement: { type: 'string' },
          explanation: { type: 'string' },
          confidence: { type: 'string', enum: CONFIDENCE },
        },
        required: ['element', 'category', 'original', 'replacement', 'explanation', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

function speakerOf(blocks, i) {
  for (let k = i - 1; k >= 0 && k >= i - 8; k--) {
    const t = blocks[k].type;
    if (t === 'character') return cueName(blocks[k].text);
    if (t !== 'paren' && t !== 'dialogue') return '';
  }
  return '';
}

function describe(blocks, i, id) {
  const b = blocks[i];
  let label = LABEL[b.type];
  if (b.type === 'dialogue' || b.type === 'paren') {
    const who = speakerOf(blocks, i);
    if (who) label += ` — ${who}`;
  }
  return `${id} [${label}] ${JSON.stringify(b.text)}`;
}

/**
 * Split blocks into review chunks of roughly `target` characters of reviewable
 * text, breaking at scene headings where possible. Each chunk lists its
 * elements with short ids and carries up to `contextChars` of the preceding
 * text as read-only context.
 */
export function buildChunks(blocks, { target = 6000, contextChars = 1200 } = {}) {
  const chunks = [];
  let start = 0;
  while (start < blocks.length) {
    let end = start, size = 0, lastScene = -1;
    while (end < blocks.length) {
      const b = blocks[end];
      if (b.type === 'scene' && end > start) lastScene = end;
      if (REVIEWABLE.has(b.type)) size += b.text.length;
      end++;
      if (size >= target) {
        // Prefer ending just before a scene heading in the back half of the chunk.
        if (lastScene > start && lastScene - start > (end - start) / 2) end = lastScene;
        break;
      }
    }
    chunks.push(makeChunk(blocks, start, end, contextChars, chunks.length));
    start = end;
  }
  const withText = chunks.filter((c) => c.ids.length);
  withText.forEach((c, i) => { c.index = i; c.total = withText.length; });
  return withText;
}

function makeChunk(blocks, start, end, contextChars) {
  const ids = []; // element id -> block id, only reviewable elements with text
  const lines = [];
  let chars = 0;
  for (let i = start; i < end; i++) {
    const b = blocks[i];
    if (!b.text.trim()) continue;
    if (REVIEWABLE.has(b.type)) {
      const id = 'e' + (ids.length + 1);
      ids.push({ id, blockId: b.id, text: b.text, type: b.type });
      lines.push(describe(blocks, i, id));
      chars += b.text.length;
    } else {
      lines.push(describe(blocks, i, '--'));
    }
  }
  const ctx = [];
  let used = 0;
  for (let i = start - 1; i >= 0 && used < contextChars; i--) {
    if (!blocks[i].text.trim()) continue;
    ctx.unshift(describe(blocks, i, '--'));
    used += blocks[i].text.length;
  }
  return { start, end, ids, chars, contextLines: ctx, lines };
}

/** The user message for one chunk. */
export function chunkPrompt(chunk) {
  return `Screenplay section ${chunk.index + 1} of ${chunk.total}. Each line is: id [ELEMENT TYPE — speaker] "text as a JSON string". Lines with id "--" are not reviewable.

<context>
${chunk.contextLines.join('\n') || '(start of script)'}
</context>

<review>
${chunk.lines.join('\n')}
</review>

Report the English problems in the <review> elements.`;
}

// ---- validation --------------------------------------------------------------------

let seq = 0;
const nextId = () => 'f' + (++seq).toString(36);

/** Shrink (original -> replacement) to the changed words, keeping whole words. */
export function minimalEdit(text, s, e, replacement) {
  const orig = text.slice(s, e);
  let p = 0;
  while (p < orig.length && p < replacement.length && orig[p] === replacement[p]) p++;
  let q = 0;
  while (q < orig.length - p && q < replacement.length - p && orig[orig.length - 1 - q] === replacement[replacement.length - 1 - q]) q++;
  // Widen back to word boundaries so the visible change is a readable phrase.
  const isW = (c) => !!c && /[\p{L}\p{N}'’]/u.test(c);
  while (p > 0 && (isW(orig[p - 1]) || isW(replacement[p - 1]))) p--;
  while (q > 0 && (isW(orig[orig.length - q]) || isW(replacement[replacement.length - q]))) q--;
  return { s: s + p, e: e - q, rep: replacement.slice(p, replacement.length - q) };
}

/**
 * Turn Claude's raw findings for a chunk into validated findings. Anything
 * that does not match the snapshot exactly is discarded (and counted).
 */
export function validateFindings(chunk, raw, blockRefs) {
  const byId = new Map(chunk.ids.map((x) => [x.id, x]));
  const out = [];
  let rejected = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    const el = r && byId.get(String(r.element).trim());
    const ok = el && CATEGORIES.includes(r.category) && CONFIDENCE.includes(r.confidence) &&
      typeof r.original === 'string' && r.original.length > 0 && typeof r.replacement === 'string' &&
      typeof r.explanation === 'string' && r.replacement !== r.original;
    if (!ok) { rejected++; continue; }
    const at = el.text.indexOf(r.original);
    if (at === -1) { rejected++; continue; }
    const m = minimalEdit(el.text, at, at + r.original.length, r.replacement);
    if (m.e - m.s === 0 && m.rep === '') { rejected++; continue; }
    out.push({
      id: nextId(), chunk: chunk.index, blockId: el.blockId, ref: blockRefs ? blockRefs.get(el.blockId) : null,
      s: m.s, e: m.e, original: el.text.slice(m.s, m.e), replacement: m.rep,
      shownOriginal: r.original, shownReplacement: r.replacement,
      // How much of the passage shown to the writer lies around the minimal span (for hover).
      padL: m.s - at, padR: at + r.original.length - m.e,
      contextBefore: el.text.slice(Math.max(0, m.s - 30), m.s), contextAfter: el.text.slice(m.e, m.e + 30),
      category: r.category, confidence: r.confidence, explanation: r.explanation.trim().slice(0, 600),
      decision: null, appliedText: null,
    });
  }
  return { findings: resolveOverlaps(out), rejected };
}

const RANK = { high: 3, medium: 2, low: 1 };

/** Within each element keep non-overlapping findings, higher confidence first. */
export function resolveOverlaps(findings) {
  const keep = [];
  const sorted = [...findings].sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || (a.s - b.s));
  for (const f of sorted) {
    const clash = keep.some((k) => k.blockId === f.blockId && f.s < Math.max(k.e, k.s + 1) && Math.max(f.e, f.s + 1) > k.s);
    if (!clash) keep.push(f);
  }
  return keep.sort((a, b) => (a.chunk - b.chunk) || 0);
}

// ---- decisions and locating suggestions ------------------------------------------------
//
// A suggestion never changes by itself: its original text, replacement,
// explanation, category, confidence and decision stay exactly as reviewed until
// the writer decides. Only *where* it is gets recomputed after edits, and only
// when that is certain; otherwise it is reported as not locatable, never
// pointed at a different passage.

export const DECISIONS = ['accepted', 'discarded', 'ignored', 'dictionary'];
export const DECISION_LABEL = { accepted: 'Accepted', discarded: 'Discarded', ignored: 'Ignored', dictionary: 'In dictionary' };

export function indexById(blocks) {
  const m = new Map();
  for (let i = 0; i < blocks.length; i++) m.set(blocks[i].id, i);
  return m;
}

/** The text a suggestion is anchored to: the original, or what accepting it put in. */
export const anchorText = (f) => (f.decision === 'accepted' && f.appliedText != null ? f.appliedText : f.original);

function occurrences(text, needle) {
  let n = 0, i = -1, at = -1;
  while ((i = text.indexOf(needle, i + 1)) !== -1) { n++; at = i; if (n > 1) break; }
  return { n, at };
}

/** Changed region between two versions of a text: [p, oldEnd) became [p, newEnd). */
function diffRegion(a, b) {
  let p = 0;
  const n = Math.min(a.length, b.length);
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let q = 0;
  while (q < n - p && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++;
  return { p, oldEnd: a.length - q, newEnd: b.length - q };
}

/**
 * Find a suggestion's passage in the current blocks. Returns {b, s, e} (and
 * updates the suggestion's stored position) or null. In order:
 *  1. its element is unchanged;
 *  2. its element changed elsewhere (exact diff against the last version seen);
 *  3. reopened from disk and the stored position still holds;
 *  4. the same text with the same surrounding context, once in its element;
 *  5. the same text alone, once in its element, if distinctive (2+ words or 8+ characters);
 *  6. the same text with its surrounding context, once in the whole script.
 */
export function locate(f, blocks, idx = indexById(blocks)) {
  const anchor = anchorText(f);
  if (!anchor) return null;
  const found = (i, s) => {
    f.blockId = blocks[i].id; f.s = s; f.e = s + anchor.length; f.ref = blocks[i];
    return { b: i, s, e: f.e };
  };
  const i = f.blockId == null ? undefined : idx.get(f.blockId);
  const b = i === undefined ? null : blocks[i];
  const cb = f.contextBefore.slice(-12), ca = f.contextAfter.slice(0, 12);
  if (b) {
    if (b === f.ref) return { b: i, s: f.s, e: f.e };
    if (f.ref && f.ref.id === b.id) {
      const d = diffRegion(f.ref.text, b.text);
      if (d.oldEnd <= f.s) {
        const s = f.s + (d.newEnd - d.oldEnd);
        if (b.text.substr(s, anchor.length) === anchor) return found(i, s);
      } else if (d.p >= f.e) {
        if (b.text.substr(f.s, anchor.length) === anchor) return found(i, f.s);
      }
    } else if (!f.ref && b.text.substr(f.s, anchor.length) === anchor && b.text.slice(Math.max(0, f.s - f.contextBefore.length), f.s) === f.contextBefore) {
      return found(i, f.s);
    }
    const withCtx = occurrences(b.text, cb + anchor + ca);
    if (withCtx.n === 1) return found(i, withCtx.at + cb.length);
    if (/\S\s+\S/.test(anchor.trim()) || anchor.trim().length >= 8) {
      const alone = occurrences(b.text, anchor);
      if (alone.n === 1) return found(i, alone.at);
    }
  }
  if ((cb + ca).trim().length >= 6) {
    let hit = -1, at = -1;
    for (let k = 0; k < blocks.length; k++) {
      const o = occurrences(blocks[k].text, cb + anchor + ca);
      if (!o.n) continue;
      if (o.n > 1 || hit !== -1) { hit = -2; break; }
      hit = k; at = o.at + cb.length;
    }
    if (hit >= 0) return found(hit, at);
  }
  return null;
}

/** The full passage shown in the panel, if it is still intact around the located span. */
export function shownRange(f, at, blocks) {
  if (!at || f.decision === 'accepted') return at;
  const t = blocks[at.b].text, s = at.s - (f.padL || 0), e = at.e + (f.padR || 0);
  return s >= 0 && t.slice(s, e) === f.shownOriginal ? { b: at.b, s, e } : at;
}

/** Locate every suggestion; returns Map(id -> {b, s, e} | null). */
export function locateAll(findings, blocks) {
  const idx = indexById(blocks);
  const out = new Map();
  for (const f of findings) out.set(f.id, locate(f, blocks, idx));
  return out;
}

/**
 * Plan replacements for undecided suggestions whose original text is exactly
 * where they say. Returns { matches: [{b, s, e}], replacements, applied } with
 * non-overlapping ranges in document order, ready for Editor.replaceRanges().
 */
export function planApply(findings, blocks) {
  const idx = indexById(blocks);
  const items = [];
  for (const f of findings) {
    if (f.decision) continue;
    const at = locate(f, blocks, idx);
    if (!at || blocks[at.b].text.slice(at.s, at.e) !== f.original) continue;
    items.push({ ...at, f });
  }
  items.sort((x, y) => (x.b - y.b) || (x.s - y.s));
  const out = { matches: [], replacements: [], applied: [] };
  let last = null;
  for (const it of items) {
    if (last && last.b === it.b && it.s < last.e) continue; // never apply overlapping edits
    out.matches.push({ b: it.b, s: it.s, e: it.e });
    out.replacements.push(it.f.replacement);
    out.applied.push(it.f);
    last = it;
  }
  return out;
}

/**
 * After a plan was applied (one edit): record the accepted suggestions and move
 * every other suggestion in the touched elements exactly past the edits. One an
 * edit overlapped keeps its last position and is left to locate().
 */
export function afterApply(findings, plan, blocks) {
  const edits = new Map(); // block index -> [{s, e, d, f}]
  plan.matches.forEach((m, k) => {
    const list = edits.get(m.b) || [];
    list.push({ s: m.s, e: m.e, f: plan.applied[k], d: plan.replacements[k].length - (m.e - m.s) });
    edits.set(m.b, list);
  });
  for (const [bi, list] of edits) {
    const block = blocks[bi];
    for (const f of findings) {
      if (f.blockId !== block.id) continue;
      const own = list.find((ed) => ed.f === f);
      let shift = 0, broken = false;
      for (const ed of list) {
        if (ed === own) continue;
        if (ed.e <= f.s) shift += ed.d;
        else if (ed.s < f.e) broken = true;
      }
      if (own) {
        f.decision = 'accepted';
        f.s += shift;
        f.e = f.s + f.replacement.length;
        f.appliedText = block.text.slice(f.s, f.e);
        f.ref = block;
      } else if (!broken) {
        f.s += shift; f.e += shift;
        if (block.text.substr(f.s, anchorText(f).length) === anchorText(f)) f.ref = block;
      }
    }
  }
}

// ---- storing a review in the .stet file -------------------------------------------------

const KEEP = ['id', 's', 'e', 'padL', 'padR', 'original', 'replacement', 'shownOriginal', 'shownReplacement', 'contextBefore', 'contextAfter', 'category', 'confidence', 'explanation', 'decision', 'appliedText'];

/** Plain-JSON form of a review. Block ids aren't stored in files, so positions use element numbers. */
export function reviewToJSON(review, blocks) {
  if (!review) return null;
  const idx = indexById(blocks);
  return {
    id: review.id, at: review.at, model: review.model, state: review.state,
    findings: review.findings.map((f) => {
      const o = {};
      for (const k of KEEP) if (f[k] !== undefined && f[k] !== null) o[k] = f[k];
      o.el = f.blockId != null && idx.has(f.blockId) ? idx.get(f.blockId) : -1;
      return o;
    }),
  };
}

const isStr = (v) => typeof v === 'string';
/** Rebuild a stored review against freshly loaded blocks; invalid entries are dropped. */
export function reviewFromJSON(r, blocks) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.findings)) return null;
  const findings = [];
  for (const x of r.findings) {
    if (!x || !isStr(x.id) || !isStr(x.original) || !isStr(x.replacement) || !CATEGORIES.includes(x.category)) continue;
    const el = Number.isInteger(x.el) && x.el >= 0 && x.el < blocks.length ? x.el : -1;
    findings.push({
      id: x.id, blockId: el === -1 ? null : blocks[el].id, ref: null,
      s: Number.isInteger(x.s) ? x.s : 0, e: Number.isInteger(x.e) ? x.e : 0,
      padL: Number.isInteger(x.padL) && x.padL >= 0 ? x.padL : 0, padR: Number.isInteger(x.padR) && x.padR >= 0 ? x.padR : 0,
      original: x.original, replacement: x.replacement,
      shownOriginal: isStr(x.shownOriginal) ? x.shownOriginal : x.original,
      shownReplacement: isStr(x.shownReplacement) ? x.shownReplacement : x.replacement,
      contextBefore: isStr(x.contextBefore) ? x.contextBefore : '', contextAfter: isStr(x.contextAfter) ? x.contextAfter : '',
      category: x.category, confidence: CONFIDENCE.includes(x.confidence) ? x.confidence : 'medium',
      explanation: isStr(x.explanation) ? x.explanation : '',
      decision: DECISIONS.includes(x.decision) ? x.decision : null,
      appliedText: isStr(x.appliedText) ? x.appliedText : null,
    });
  }
  return { id: isStr(r.id) ? r.id : 'r0', at: isStr(r.at) ? r.at : null, model: isStr(r.model) ? r.model : MODEL, state: isStr(r.state) ? r.state : 'complete', findings };
}

/** Rough size of a review for the consent dialog. */
export function estimate(chunks) {
  const chars = chunks.reduce((n, c) => n + c.lines.join('\n').length + c.contextLines.join('\n').length, 0);
  return { requests: chunks.length, inputTokens: Math.round(chars / 3.6 + chunks.length * (SYSTEM_PROMPT.length / 3.6 + 120)) };
}

// ---- writer's lists: per-script ignores, global dictionary ---------------------------

export const normalize = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Entry stored in the .stet file when a finding is ignored. */
export function ignoreEntry(f) {
  return { text: f.shownOriginal, category: f.category };
}

/**
 * Drop findings the writer has ignored in this script (same passage, same
 * category) or whose flagged words are in the global dictionary.
 */
export function applyUserLists(findings, { ignored = [], dictionary = [] } = {}) {
  const ign = new Set(ignored.map((x) => x.category + '\u0000' + normalize(x.text)));
  const dict = new Set(dictionary.map(normalize));
  const kept = [];
  let suppressed = 0;
  for (const f of findings) {
    const hit = ign.has(f.category + '\u0000' + normalize(f.shownOriginal)) || dict.has(normalize(f.original)) || dict.has(normalize(f.shownOriginal));
    if (hit) suppressed++; else kept.push(f);
  }
  return { findings: kept, suppressed };
}

/** Extra instructions so Claude doesn't spend effort on what the writer accepted. */
export function listsPrompt({ ignored = [], dictionary = [] } = {}) {
  const parts = [];
  const dict = [...new Set(dictionary.map((d) => d.trim()).filter(Boolean))].slice(0, 300);
  const ign = [...new Set(ignored.map((x) => x.text.trim()).filter(Boolean))].slice(0, 200);
  if (dict.length) parts.push(`The writer's dictionary — words and phrases the writer has confirmed are correct. Never flag them:\n${dict.map((d) => JSON.stringify(d)).join('\n')}`);
  if (ign.length) parts.push(`Passages the writer has already reviewed and chosen to keep. Do not flag them again:\n${ign.map((d) => JSON.stringify(d)).join('\n')}`);
  return parts.join('\n\n');
}
