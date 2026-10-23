// Which screenplay STET opens on launch: the last one edited (saved with changes), then the rest
// of Open Recent, newest first.

/** Paths to try in turn: `lastEdited` first when it is still in the recent list. */
export function launchOrder(recent = [], lastEdited = null) {
  const paths = recent.map((r) => r.path);
  return lastEdited && paths.includes(lastEdited) ? [lastEdited, ...paths.filter((p) => p !== lastEdited)] : paths;
}
