// A screenplay to and from the bytes of a file, on the desktop's own engine: serialize.js decides
// what a document is, container.js how it is packed. Nothing in a file is lost on the way through,
// including what this version cannot edit yet (notes, reviews, timecodes): they stay in the document.

import { serialize, deserialize } from '../../src/core/serialize.js';
import { parseFdx } from '../../src/core/fdx.js';
import { newDocument } from '../../src/core/model.js';
import { encode, decode } from './container.js';
import { VERSION } from './config.js';

export const baseName = (name) => String(name || '').replace(/\.(stet|fdx)$/i, '') || 'Untitled';
export const fileName = (name) => `${baseName(name)}.stet`;

export const toJson = (doc, blocks) => serialize({ ...doc, blocks }, `web-${VERSION}`);

/** The bytes of a .stet file. */
export const toBytes = (doc, blocks) => encode(toJson(doc, blocks));

/** A .stet or .fdx file's bytes as a document, with what was repaired on the way in. */
export async function fromBytes(bytes, name = '') {
  if (/\.fdx$/i.test(name)) {
    const parsed = parseFdx(new TextDecoder().decode(bytes));
    const doc = newDocument('');
    doc.blocks = parsed.blocks;
    if (parsed.titlePage) Object.assign(doc.titlePage, parsed.titlePage);
    return { doc, warnings: parsed.warnings || [], imported: true };
  }
  const { doc, warnings } = deserialize(await decode(bytes));
  return { doc, warnings, imported: false };
}

/** Which parts of a document this version keeps safe but does not show. */
export function keptAside(doc) {
  const out = [];
  if (Object.keys(doc.comments || {}).length) out.push('notes');
  if (doc.revision?.review) out.push('the Revise review');
  if (doc.timecodes?.length) out.push('timecodes');
  return out;
}
