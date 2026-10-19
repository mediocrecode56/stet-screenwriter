// Plain-text interchange (clipboard, import). The text form is Fountain-like:
// elements separated by blank lines, dialogue directly under its cue, so a
// copy from STET pastes as a readable screenplay elsewhere and pastes back
// into STET with its element types recovered.

const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 .'’\-]+(TO:|OUT\.|IN:)$/;

/** Fragment (array of {type, text}) -> text. */
export function toPlainText(fragment) {
  let out = '';
  for (let i = 0; i < fragment.length; i++) {
    const f = fragment[i];
    if (i > 0) {
      const tight = f.type === 'dialogue' || f.type === 'paren';
      out += tight ? '\n' : '\n\n';
    }
    out += f.text;
  }
  return out;
}

const isUpperLine = (s) => s === s.toUpperCase() && /[A-Z]/.test(s);

/** Text -> fragment, recovering element types heuristically. */
export function parsePlainText(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [];
  let inSpeech = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { inSpeech = false; continue; }
    const next = (lines[i + 1] || '').trim();
    if (inSpeech) {
      if (/^\(.*\)$/.test(line)) out.push({ type: 'paren', text: line });
      else out.push({ type: 'dialogue', text: line });
      continue;
    }
    if (SCENE_RE.test(line) || line.startsWith('.') && line.length > 1 && line[1] !== '.') {
      out.push({ type: 'scene', text: (line.startsWith('.') ? line.slice(1) : line).toUpperCase() });
    } else if (TRANSITION_RE.test(line) && !next) {
      out.push({ type: 'transition', text: line });
    } else if (isUpperLine(line) && line.length <= 40 && next && !SCENE_RE.test(next)) {
      out.push({ type: 'character', text: line });
      inSpeech = true;
    } else {
      // Consecutive non-blank action lines form one paragraph with soft breaks.
      const prev = out[out.length - 1];
      if (prev && prev.type === 'action' && i > 0 && lines[i - 1].trim()) prev.text += '\n' + line;
      else out.push({ type: 'action', text: line });
    }
  }
  return out.map((f) => ({ ...f, marks: [] }));
}
