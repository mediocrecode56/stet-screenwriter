// Which screenplay STET opens on launch: the last one edited (saved with changes), then the rest
// of Open Recent, newest first.

/** Paths to try in turn: `lastEdited` first when it is still in the recent list. */
export function launchOrder(recent = [], lastEdited = null) {
  const paths = recent.map((r) => r.path);
  return lastEdited && paths.includes(lastEdited) ? [lastEdited, ...paths.filter((p) => p !== lastEdited)] : paths;
}

// Where each screenplay was left, to open it there again: [{ id, caret: { b, o }, top: { b, o } | null, dy }],
// the most recent first, kept to the last PLACES (an array, so a saved list replaces the old one whole).
export const PLACES = 40;

/** The list with `place` (for screenplay place.id) first, any older one for it dropped. */
export function rememberPlace(list = [], place) {
  return [place, ...(Array.isArray(list) ? list : []).filter((p) => p && p.id !== place.id)].slice(0, PLACES);
}

/** Where screenplay `id` was left, fitted to its `blocks` as they are now (null: never, or nothing fits). */
export function placeFor(list, id, blocks) {
  const p = Array.isArray(list) && list.find((x) => x && x.id === id);
  if (!p || !blocks.length) return null;
  const fit = (q) => {
    if (!q || !Number.isInteger(q.b) || !Number.isInteger(q.o)) return null;
    const b = Math.max(0, Math.min(blocks.length - 1, q.b));
    return { b, o: Math.max(0, Math.min(blocks[b].text.length, b === q.b ? q.o : 0)) };
  };
  const caret = fit(p.caret);
  return caret ? { caret, top: fit(p.top), dy: Number.isFinite(p.dy) ? p.dy : 0 } : null;
}
