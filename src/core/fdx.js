// Final Draft (.fdx) import. An .fdx file is XML: <Content> holds the script as
// <Paragraph Type="..."> elements whose <Text> runs carry the words and their
// styles, and <TitlePage> holds the cover page as plain centred / left / right
// paragraphs. This reads both into STET's model; anything STET has no place for
// (notes, scene properties, page layout, revision colours) is left behind.
//
// The XML reader is a small one of its own so the same code runs in the window
// and in the unit tests.

import { makeBlock, emptyTitlePage, normalizeMarks, concatMarks, cueName, UPPER_TYPES } from './model.js';
import { CAST_MAX } from './cast.js';

export class FdxError extends Error {}

const TYPE_MAP = {
  'scene heading': 'scene',
  action: 'action',
  general: 'action',
  character: 'character',
  parenthetical: 'paren',
  dialogue: 'dialogue',
  lyrics: 'dialogue',
  transition: 'transition',
  shot: 'shot',
};

const STYLE_MAP = { bold: 'b', italic: 'i', underline: 'u', strikeout: 's', strikethrough: 's' };

// ---- XML ----------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[3] ?? m[4]);
  return out;
}

/** XML text -> element tree: { name, attrs, children } with strings for text. */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) {
      // Close the matching element (and anything left open inside it).
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[2]) { stack.length = i; break; }
    } else if (m[3]) {
      const el = { name: m[3], attrs: attrs(m[4] || ''), children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push(decode(m[6]));
  }
  return root;
}

const kids = (el, name) => el.children.filter((c) => typeof c !== 'string' && (!name || c.name === name));
const child = (el, name) => el && el.children.find((c) => typeof c !== 'string' && c.name === name);

// ---- paragraphs -----------------------------------------------------------------------

/** A paragraph's text and style marks, from its <Text> runs. */
function readRuns(p) {
  let text = '';
  const marks = [];
  for (const t of kids(p, 'Text')) {
    let s = t.children.filter((c) => typeof c === 'string').join('');
    const styles = (t.attrs.Style || '').split('+').map((x) => x.trim().toLowerCase());
    if (styles.includes('allcaps')) s = s.toUpperCase();
    const a = text.length;
    text += s;
    for (const st of styles) if (STYLE_MAP[st] && s) marks.push({ s: a, e: text.length, k: STYLE_MAP[st], v: 1 });
  }
  return { text, marks };
}

/**
 * Tidy the text the way STET keeps it: no tabs, no stray line ends before the paragraph. With
 * `keepEnd`, line ends after the text stay: Final Draft shows them as empty lines, and they move
 * its page breaks.
 */
function tidy(text, marks, keepEnd = false) {
  let t = text.replace(/\r\n?/g, '\n').replace(/[\t\u000b]/g, ' ');
  let cut = t.length - t.replace(/^[\s\n]+/, '').length;
  t = t.slice(cut).replace(keepEnd ? /[ \u00a0]+$/ : /[\s\n]+$/, '');
  if (keepEnd && !t.trim()) t = '';
  marks = marks.map((m) => ({ ...m, s: Math.max(0, m.s - cut), e: Math.min(t.length, m.e - cut) })).filter((m) => m.e > m.s);
  // More than one empty line in a row inside a paragraph reads as a gap Final Draft never shows.
  for (let i; (i = t.indexOf('\n\n\n')) >= 0;) {
    t = t.slice(0, i) + t.slice(i + 1);
    marks = marks.map((m) => ({ ...m, s: m.s > i ? m.s - 1 : m.s, e: m.e > i ? m.e - 1 : m.e })).filter((m) => m.e > m.s);
  }
  return { text: t, marks: normalizeMarks(marks) };
}

function toBlock(p, warnings) {
  const raw = (p.attrs.Type || '').trim();
  let type = TYPE_MAP[raw.toLowerCase()];
  if (!type) {
    type = 'action';
    if (raw) warnings.add(`"${raw}" paragraphs came in as Action.`);
  }
  const runs = readRuns(p);
  // Action and dialogue keep the empty lines that end them (Final Draft shows them); cues, headings
  // and parentheticals are one line of their own.
  let { text, marks } = tidy(runs.text, runs.marks, type === 'action' || type === 'dialogue');
  if (!text) return null;
  if (UPPER_TYPES.has(type)) {
    const up = text.toUpperCase();
    // Uppercasing can change length (e.g. "ß" -> "SS"); drop marks rather than misplace them.
    if (up.length !== text.length) marks = [];
    text = up;
  }
  if (type === 'paren' && !/^\(.*\)$/s.test(text)) {
    // Wrapped in brackets as STET writes it; an added "(" moves the styles along by one.
    if (!text.startsWith('(')) marks = marks.map((m) => ({ ...m, s: m.s + 1, e: m.e + 1 }));
    text = '(' + text.replace(/^\(|\)$/g, '') + ')';
  }
  const b = makeBlock(type, text, marks);
  // A paragraph that opens on an empty line shows that line in Final Draft.
  b.gap = /^[ \t]*\r?\n/.test(runs.text);
  return b;
}

/** Paragraphs in reading order; dual dialogue comes in as one speech after the other. */
function paragraphs(el, out = []) {
  for (const c of kids(el)) {
    if (c.name === 'Paragraph') out.push(c);
    else if (c.name === 'DualDialogue') paragraphs(c, out);
  }
  return out;
}

// ---- title page -----------------------------------------------------------------------

const CREDIT_RE = /^(written|screenplay|teleplay|story|script|adapted|created|directed)?\s*(and\s+)?by\b|^by$/i;

function readTitlePage(tp) {
  const out = emptyTitlePage();
  const content = child(tp, 'Content');
  if (!content) return out;
  const lines = [];
  for (const p of kids(content, 'Paragraph')) {
    const r = readRuns(p);
    const { text } = tidy(r.text, r.marks);
    lines.push({ text, align: (p.attrs.Alignment || 'Left').toLowerCase() });
  }
  const centred = lines.filter((l) => l.align === 'center' && l.text);
  let i = 0;
  if (centred[i] && !CREDIT_RE.test(centred[i].text)) out.title = centred[i++].text.toUpperCase();
  if (centred[i] && CREDIT_RE.test(centred[i].text)) out.credit = centred[i++].text;
  if (centred[i]) out.author = centred[i++].text;
  if (i < centred.length) out.source = centred.slice(i).map((l) => l.text).join(' ');
  // The corner blocks: contact details on the left, draft date / revision on the right.
  const left = [];
  for (const l of lines) if (l.align === 'left' && l.text) left.push(l.text);
  out.contact = left.join('\n');
  const right = lines.filter((l) => l.align === 'right' && l.text).map((l) => l.text);
  const dateAt = right.findIndex((t) => /\d/.test(t));
  if (dateAt >= 0) out.draftDate = right.splice(dateAt, 1)[0];
  out.revision = right.join(' ');
  return out;
}

// ---- document ---------------------------------------------------------------------------

/**
 * Final Draft XML -> { blocks, titlePage, cast, settings, warnings }.
 * Throws FdxError when the file is not a Final Draft script.
 */
export function parseFdx(xml) {
  if (typeof xml !== 'string' || !/<FinalDraft[\s>]/.test(xml)) throw new FdxError('This is not a Final Draft (.fdx) file.');
  const fd = child(parseXml(xml), 'FinalDraft');
  const content = child(fd, 'Content');
  if (!content) throw new FdxError('This Final Draft file has no script in it.');
  const warnings = new Set();
  const blocks = [];
  for (const p of paragraphs(content)) {
    const b = toBlock(p, warnings);
    if (!b) continue;
    const prev = blocks[blocks.length - 1];
    const { gap, ...block } = b;
    if (prev && prev.type === 'dialogue' && block.type === 'dialogue') {
      // More of the same speech: one dialogue, as STET writes it, with the gap Final Draft showed.
      const join = gap ? '\n\n' : '\n';
      blocks[blocks.length - 1] = makeBlock('dialogue', prev.text + join + block.text, concatMarks(prev.marks, prev.text.length + join.length, block.marks));
    } else blocks.push(block);
  }
  if (!blocks.length) blocks.push(makeBlock('scene', ''));
  const tp = child(fd, 'TitlePage');
  const titlePage = tp ? readTitlePage(tp) : emptyTitlePage();
  // The cast, most recently used first, as STET keeps it.
  const cast = [];
  for (let i = blocks.length - 1; i >= 0 && cast.length < CAST_MAX; i--) {
    const n = blocks[i].type === 'character' ? cueName(blocks[i].text) : '';
    if (n && !cast.includes(n)) cast.push(n);
  }
  return { blocks, titlePage, cast, settings: readSettings(fd), warnings: [...warnings] };
}

/** The layout settings STET shares with the file: the blank lines before scene headings. */
function readSettings(fd) {
  const out = {};
  for (const es of kids(fd, 'ElementSettings')) {
    if ((es.attrs.Type || '').trim().toLowerCase() !== 'scene heading') continue;
    const before = parseFloat((child(es, 'ParagraphSpec') || { attrs: {} }).attrs.SpaceBefore);
    // Final Draft counts the space in points: 12 is one blank line.
    if (before >= 0) out.sceneSpacing = Math.min(2, Math.max(1, Math.round(before / 12)));
  }
  return out;
}
