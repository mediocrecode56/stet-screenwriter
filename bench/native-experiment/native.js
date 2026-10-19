// Bridge to the C text kernel (native/stet_text.c, compiled to WebAssembly).
//
// One call per batch: every element's text is UTF-8-encoded into the module's
// scratch buffer, counted in C, and the per-element results are copied out.
// If the module is not loaded (or reports an error) callers fall back to the
// JavaScript reference, which gives identical results.

let ex = null;
const enc = new TextEncoder();

/** Instantiate from wasm bytes. Safe to call more than once. */
export async function initNative(bytes) {
  try {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    ex = instance.exports;
    return true;
  } catch (e) {
    ex = null;
    console.warn('STET native kernel unavailable, using JavaScript:', e.message);
    return false;
  }
}

export function nativeReady() { return ex !== null; }

/** Word counts for many texts at once (Uint32Array), or null to fall back. */
export function countWordsBatch(texts) {
  if (!ex) return null;
  const count = texts.length;
  let chars = 0;
  for (let i = 0; i < count; i++) chars += texts[i].length;
  const header = count * 8;
  const base = ex.stet_scratch(header + chars * 3); // UTF-8 needs at most 3 bytes per UTF-16 unit
  if (!base) return null;
  const buf = ex.memory.buffer; // read after stet_scratch: memory may have grown
  const u8 = new Uint8Array(buf);
  const lens = new Uint32Array(buf, base, count);
  let pos = base + header;
  for (let i = 0; i < count; i++) {
    const t = texts[i];
    if (t.length === 0) { lens[i] = 0; continue; }
    const r = enc.encodeInto(t, u8.subarray(pos));
    lens[i] = r.written;
    pos += r.written;
  }
  const total = ex.stet_count_words(count, pos - base - header);
  if (total < 0) return null;
  return new Uint32Array(buf, base + count * 4, count).slice();
}
