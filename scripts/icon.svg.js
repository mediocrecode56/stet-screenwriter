// The STET icon: the writing companion, the little pixel dinosaur, standing
// on a black tile with a light hairline frame so it holds on dark and light
// backgrounds. It is drawn on whole device pixels at every size, so every edge
// is crisp: the sprite itself wherever it fits at a whole scale, and a
// slightly slimmer version of it where that draws it larger (16 px, 32 px…).

import { FRAMES } from '../src/renderer/dino-art.js';

const INK = '#f2f2ee', TILE = '#0b0b0b', FRAME = '#e8e8e4';
const FULL = FRAMES.stand;
// The same dinosaur, 14 × 13: narrower body and tail, the same head.
const MINI = [
  '........######',
  '.......##o####',
  '.......#######',
  '.......####...',
  '.......#####..',
  '#.....#####...',
  '#....######...',
  '##..#########.',
  '###.#######.#.',
  '.#########....',
  '..#######.....',
  '...##..##.....',
  '...###.###....',
];

/** The art and whole-pixel scale that draw it largest inside the margin (the slim one only when clearly larger). */
function sprite(size) {
  const margin = size <= 32 ? 1 : Math.ceil(size * 0.1);
  const fit = (art) => Math.floor((size - 2 * margin) / Math.max(art[0].length, art.length));
  const kf = fit(FULL), km = fit(MINI);
  return kf >= 1 && kf * FULL[0].length * 1.25 > km * MINI[0].length ? { art: FULL, k: kf } : { art: MINI, k: km };
}

// One device pixel of mid-grey around small tiles, so they don't vanish on dark taskbars.
function edge(size) {
  const px = 256 / size;
  return `<rect x="${px / 2}" y="${px / 2}" width="${256 - px}" height="${256 - px}" fill="none" stroke="#5c5c58" stroke-width="${px}"/>`;
}

export function iconSvg(size) {
  const { art, k } = sprite(size);
  const u = 256 / size; // one device pixel in viewBox units
  const x0 = Math.floor((size - art[0].length * k) / 2), y0 = Math.floor((size - art.length * k) / 2);
  let px = '';
  art.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '#') px += `<rect x="${(x0 + c * k) * u}" y="${(y0 + r * k) * u}" width="${k * u}" height="${k * u}" fill="${INK}"/>`;
  }));
  const frame = size <= 32 ? edge(size) : `<rect x="9" y="9" width="238" height="238" fill="none" stroke="${FRAME}" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" shape-rendering="crispEdges">` +
    `<rect width="256" height="256" fill="${TILE}"/>${frame}${px}</svg>`;
}
