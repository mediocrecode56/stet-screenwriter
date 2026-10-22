// Character name completion. A screenplay remembers its cast (doc.cast, saved in the
// .stet file): the names of its character cues, most recently used first. Typing a cue
// suggests the first of them that starts with what was typed, as grey text after the
// caret; only names that appear in the script are suggested, so a new script suggests
// nothing until a character has been named in it.

export const CAST_MAX = 200;

/** Every name the script uses, in suggestion order: the remembered order first, then the rest. */
export function castOrder(cast, present) {
  const here = new Set(present);
  const out = (cast || []).filter((n) => here.has(n));
  const seen = new Set(out);
  for (const n of present) if (!seen.has(n)) out.push(n);
  return out;
}

/** The rest of the name to suggest after `typed` in a cue, or '' for none. */
export function suggestCue(typed, names) {
  const t = typed.trimStart().toUpperCase();
  if (!t || t.includes('(')) return '';
  for (const n of names) if (n.length > t.length && n.startsWith(t)) return n.slice(t.length);
  return '';
}

/** `cast` with `name` moved to the front (the most recently used). */
export function touchCast(cast, name) {
  name = (name || '').trim().toUpperCase();
  if (!name) return cast || [];
  return [name, ...(cast || []).filter((n) => n !== name)].slice(0, CAST_MAX);
}

/** The cast as read from a file: unique non-empty upper-case names. */
export function readCast(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const n of raw) {
    if (typeof n !== 'string') continue;
    const name = n.trim().toUpperCase();
    if (name && !out.includes(name)) out.push(name);
    if (out.length === CAST_MAX) break;
  }
  return out;
}
