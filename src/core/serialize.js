// Document <-> JSON payload of the .stet format. See docs/FILE_FORMAT.md.
//
// Serialization is deterministic (fixed key order, sorted comment ids, no
// runtime ids), so save(load(save(doc))) is byte-identical to save(doc).

import { TYPES, HIGHLIGHT_COLORS, STYLES, makeBlock, withAlign, writtenText, defaultDocSettings, emptyTitlePage, uuid, cueName } from './model.js';
import { ALIGNS } from './format.js';
import { reviewToJSON, reviewFromJSON } from './revision.js';
import { readCast } from './cast.js';
import { timecodesToJSON, timecodesFromJSON } from './timeline.js';

export const SCHEMA_VERSION = 1;

export class FormatError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Migrations upgrade a parsed payload from schema N to N+1, in place.
// Add an entry here whenever SCHEMA_VERSION is bumped.
export const MIGRATIONS = {};

const TITLE_KEYS = ['title', 'credit', 'author', 'source', 'contact', 'draftDate', 'revision'];

export function toPayload(doc, appVersion) {
  const s = doc.settings;
  const comments = {};
  const used = referencedComments(doc.blocks);
  for (const id of Object.keys(doc.comments).sort()) {
    if (!used.has(id)) continue;
    const c = doc.comments[id];
    comments[id] = { text: c.text, created: c.created, modified: c.modified };
  }
  const tp = {};
  for (const k of TITLE_KEYS) tp[k] = doc.titlePage[k] || '';
  return {
    format: 'stet',
    schema: SCHEMA_VERSION,
    app: appVersion,
    meta: { id: doc.meta.id, created: doc.meta.created, modified: doc.meta.modified },
    settings: {
      sceneSpacing: s.sceneSpacing,
      autoCapitalize: s.autoCapitalize,
      backup: { enabled: s.backup.enabled, intervalMin: s.backup.intervalMin, retentionDays: s.backup.retentionDays, dir: s.backup.dir },
    },
    titlePage: tp,
    blocks: doc.blocks.map(blockPayload),
    comments,
    // Optional: English-revision passages ignored in this script (v0.4+) and the
    // latest review with its suggestions and decisions (v0.6+).
    ...revisionPayload(doc),
    // Optional (v0.23+): the cast, most recently used first, for completing character cues.
    ...castPayload(doc),
    // Optional (v0.28+): timecodes pinned on the timeline.
    ...timecodesPayload(doc),
  };
}

function timecodesPayload(doc) {
  const tc = timecodesToJSON(doc.timecodes, doc.blocks);
  return tc ? { timecodes: tc } : {};
}

// A block: t type, x text; optional m marks, a alignment (v0.24+), c the text as written when it
// is shown in capitals (v0.24+).
function blockPayload(b) {
  const o = { t: b.type, x: b.text };
  if (b.marks.length) o.m = b.marks.map((m) => [m.s, m.e, m.k, m.v]);
  if (b.align) o.a = b.align;
  const w = writtenText(b);
  if (w !== b.text) o.c = w;
  return o;
}

function castPayload(doc) {
  if (!doc.cast || !doc.cast.length) return {};
  const used = new Set();
  for (const b of doc.blocks) if (b.type === 'character' && b.text) used.add(cueName(b.text));
  const cast = doc.cast.filter((n) => used.has(n));
  return cast.length ? { cast } : {};
}

function revisionPayload(doc) {
  const rv = doc.revision || {};
  const out = {};
  if (rv.ignored && rv.ignored.length) out.ignored = rv.ignored.map((x) => ({ text: x.text, category: x.category }));
  if (rv.review) out.review = reviewToJSON(rv.review, doc.blocks);
  return Object.keys(out).length ? { revision: out } : {};
}

function referencedComments(blocks) {
  const used = new Set();
  for (const b of blocks) for (const m of b.marks) if (m.k === 'cm') used.add(m.v);
  return used;
}

export function serialize(doc, appVersion = '') {
  return JSON.stringify(toPayload(doc, appVersion));
}

const str = (v, d = '') => (typeof v === 'string' ? v : d);
const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/**
 * Parse and validate a payload string. Returns { doc, warnings, migratedFrom }.
 * Throws FormatError for anything that cannot be opened safely.
 */
export function deserialize(json) {
  let p;
  try { p = JSON.parse(json); } catch (e) { throw new FormatError('bad-json', 'The document payload is not valid JSON: ' + e.message); }
  if (!p || typeof p !== 'object' || p.format !== 'stet') throw new FormatError('not-stet', 'This is not a STET document.');
  if (!Number.isInteger(p.schema) || p.schema < 1) throw new FormatError('bad-schema', 'The document has no valid schema version.');
  if (p.schema > SCHEMA_VERSION) {
    throw new FormatError('too-new', `This document was written by a newer version of STET (schema ${p.schema}; this build reads up to ${SCHEMA_VERSION}). It was not modified.`);
  }
  const migratedFrom = p.schema < SCHEMA_VERSION ? p.schema : null;
  while (p.schema < SCHEMA_VERSION) {
    const m = MIGRATIONS[p.schema];
    if (!m) throw new FormatError('no-migration', `No migration from schema ${p.schema}.`);
    m(p);
    p.schema++;
  }
  if (!Array.isArray(p.blocks)) throw new FormatError('bad-blocks', 'The document has no screenplay content.');

  const warnings = [];
  const blocks = [];
  for (const raw of p.blocks) {
    if (!raw || typeof raw !== 'object') { warnings.push('Skipped an unreadable element.'); continue; }
    let type = raw.t;
    if (!TYPES.includes(type)) { warnings.push(`Unknown element type "${type}" opened as Action.`); type = 'action'; }
    const text = str(raw.x).replace(/\r\n?/g, '\n');
    const marks = [];
    if (Array.isArray(raw.m)) {
      for (const m of raw.m) {
        if (!Array.isArray(m) || m.length !== 4) continue;
        let [s, e, k, v] = m;
        if (!Number.isInteger(s) || !Number.isInteger(e)) continue;
        s = Math.max(0, Math.min(text.length, s));
        e = Math.max(0, Math.min(text.length, e));
        if (e <= s) continue;
        if (k === 'hl' && HIGHLIGHT_COLORS.includes(v)) marks.push({ s, e, k, v });
        else if (k === 'cm' && typeof v === 'string') marks.push({ s, e, k, v });
        else if (STYLES.includes(k)) marks.push({ s, e, k, v: 1 });
      }
    }
    let b = makeBlock(type, text, marks);
    if (typeof raw.c === 'string' && raw.c !== text && raw.c.toUpperCase() === text) b.cased = raw.c;
    if (ALIGNS.includes(raw.a)) b = withAlign(b, raw.a);
    blocks.push(b);
  }
  if (!blocks.length) blocks.push(makeBlock('scene', ''));

  const comments = {};
  if (p.comments && typeof p.comments === 'object') {
    for (const [id, c] of Object.entries(p.comments)) {
      if (!c || typeof c !== 'object') continue;
      comments[id] = { text: str(c.text), created: str(c.created), modified: str(c.modified) };
    }
  }
  // Comment anchors without a body keep their anchor and get an empty note.
  for (const b of blocks) for (const m of b.marks) {
    if (m.k === 'cm' && !comments[m.v]) { comments[m.v] = { text: '', created: '', modified: '' }; warnings.push('A comment had lost its text.'); }
  }

  const ds = defaultDocSettings();
  const s = p.settings || {};
  const bk = s.backup || {};
  const settings = {
    sceneSpacing: num(s.sceneSpacing, ds.sceneSpacing, 1, 2),
    autoCapitalize: typeof s.autoCapitalize === 'boolean' ? s.autoCapitalize : ds.autoCapitalize,
    backup: {
      enabled: typeof bk.enabled === 'boolean' ? bk.enabled : ds.backup.enabled,
      intervalMin: num(bk.intervalMin, ds.backup.intervalMin, 1, 120),
      retentionDays: num(bk.retentionDays, ds.backup.retentionDays, 1, 3650),
      dir: typeof bk.dir === 'string' && bk.dir ? bk.dir : null,
    },
  };
  const titlePage = emptyTitlePage();
  const tp = p.titlePage || {};
  for (const k of TITLE_KEYS) titlePage[k] = str(tp[k]);

  const meta = p.meta || {};
  const now = new Date().toISOString();
  const doc = {
    meta: { id: str(meta.id) || uuid(), created: str(meta.created) || now, modified: str(meta.modified) || now },
    settings, titlePage, blocks, comments,
    revision: { ignored: [] },
    cast: readCast(p.cast),
    timecodes: timecodesFromJSON(p.timecodes, blocks),
  };
  const rv = p.revision;
  if (rv && Array.isArray(rv.ignored)) {
    for (const x of rv.ignored) {
      if (x && typeof x.text === 'string' && x.text && typeof x.category === 'string') doc.revision.ignored.push({ text: x.text, category: x.category });
    }
  }
  if (rv && rv.review) {
    const review = reviewFromJSON(rv.review, doc.blocks);
    if (review) doc.revision.review = review;
  }
  return { doc, warnings, migratedFrom };
}
