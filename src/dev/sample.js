// Realistic generated screenplays for tests and benchmarks.

import { makeBlock } from '../core/model.js';

const NAMES = ['MARA', 'TEO', 'DETECTIVE OKAFOR', 'LUZ', 'HENRY', 'THE CLERK'];
const PLACES = ['COFFEE SHOP', 'MARA\'S APARTMENT - KITCHEN', 'PRECINCT HOUSE', 'ROOFTOP', 'PARKING GARAGE', 'BUS STATION'];
const TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MORNING'];
const WORDS = ('the a rain light window counter door coffee table hands slowly turns looks away toward city ' +
  'sirens distance her his phone buzzes silence beat waits steps forward back keys drops picks pauses ' +
  'neon flickers above quiet empty street car engine idles glances watch clock ticks').split(' ');

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function sentence(r, min, max) {
  const n = min + Math.floor(r() * (max - min));
  const w = [];
  for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)]);
  const s = w.join(' ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

/** Generate ~`pages` pages of screenplay (about 19 blocks per page, like real scripts). */
export function generateScript(pages, seed = 7) {
  const r = rng(seed);
  const blocks = [];
  let scene = 0;
  while (blocks.length < pages * 19) {
    scene++;
    const pre = r() < 0.7 ? 'INT.' : 'EXT.';
    blocks.push(makeBlock('scene', `${pre} ${PLACES[scene % PLACES.length]} - ${TIMES[scene % TIMES.length]}`));
    blocks.push(makeBlock('action', sentence(r, 8, 40) + ' ' + sentence(r, 5, 20)));
    const exchanges = 3 + Math.floor(r() * 8);
    for (let i = 0; i < exchanges; i++) {
      const name = NAMES[Math.floor(r() * NAMES.length)];
      blocks.push(makeBlock('character', r() < 0.1 ? name + ' (V.O.)' : name));
      if (r() < 0.25) blocks.push(makeBlock('paren', '(' + WORDS[Math.floor(r() * WORDS.length)] + ')'));
      blocks.push(makeBlock('dialogue', sentence(r, 4, 30) + (r() < 0.3 ? ' ' + sentence(r, 6, 40) : '')));
      if (r() < 0.3) blocks.push(makeBlock('action', sentence(r, 6, 30)));
    }
    if (r() < 0.2) blocks.push(makeBlock('transition', 'CUT TO:'));
  }
  return blocks;
}

/** A short, hand-written demo document exercising every element type. */
export function sampleDocument() {
  const B = (t, x, m = []) => makeBlock(t, x, m);
  const doc = {
    meta: { id: 'sample-0000', created: new Date().toISOString(), modified: new Date().toISOString() },
    settings: { sceneSpacing: 1, autoCapitalize: true, backup: { enabled: false, intervalMin: 5, retentionDays: 30, dir: null } },
    titlePage: { title: 'THE LONG NIGHT', credit: 'Written by', author: 'A. Writer', source: '', contact: 'a.writer@example.com\n555-0100', draftDate: 'October 19, 2026', revision: 'First Draft' },
    blocks: [
      B('scene', 'INT. COFFEE SHOP - NIGHT'),
      B('action', 'Rain hammers the windows. MARA (30s, soaked, unbothered) sits alone at the counter, turning an empty cup in her hands.', [{ s: 0, e: 25, k: 'hl', v: 'yellow' }]),
      B('action', 'The door opens. TEO enters, shaking off an umbrella that has clearly lost the fight.'),
      B('character', 'TEO'),
      B('paren', '(breathless)'),
      B('dialogue', 'You said eight. It is ten past eleven.', [{ s: 0, e: 15, k: 'cm', v: 'c1' }]),
      B('character', 'MARA'),
      B('dialogue', 'I said eight. I did not say which day.'),
      B('character', 'MARA (V.O.)'),
      B('dialogue', 'Some nights you wait for the rain to stop. Some nights you learn to like the sound.', [{ s: 41, e: 82, k: 'hl', v: 'pink' }]),
      B('transition', 'CUT TO:'),
      B('scene', 'EXT. ROOFTOP - CONTINUOUS'),
      B('action', 'The city below, blurred and electric.', [{ s: 0, e: 8, k: 'hl', v: 'blue' }]),
      B('shot', 'CLOSE ON MARA'),
      B('action', 'She smiles for the first time.'),
    ],
    comments: { c1: { text: 'Is this line too on the nose?', created: new Date().toISOString(), modified: new Date().toISOString() } },
  };
  return doc;
}
