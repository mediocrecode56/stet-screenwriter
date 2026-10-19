// The STET mark: a line of text with the typing caret at its end, and the
// proofreader's stet dots beneath it — the editor's sign for "let it stand".
// Black tile with a light hairline frame so it holds on dark and light
// backgrounds. Sizes ≤ 32 px use a 16-unit pixel grid so every edge is crisp.

const INK = '#f2f2ee', TILE = '#0b0b0b', FRAME = '#e8e8e4';

function small(size) {
  const u = 256 / 16; // one 16-grid unit in viewBox units
  const r = (x, y, w, h) => `<rect x="${x * u}" y="${y * u}" width="${w * u}" height="${h * u}" fill="${INK}"/>`;
  return [
    r(2, 6, 7, 2),               // the line of text
    r(11, 3, 2, 8),              // caret
    r(2, 12, 2, 2), r(5, 12, 2, 2), r(8, 12, 2, 2), // stet dots
  ].join('');
}

// One device pixel of mid-grey around small tiles, so they don't vanish on dark taskbars.
function edge(size) {
  const px = 256 / size;
  return `<rect x="${px / 2}" y="${px / 2}" width="${256 - px}" height="${256 - px}" fill="none" stroke="#5c5c58" stroke-width="${px}"/>`;
}

function large() {
  const r = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${INK}"/>`;
  return [
    `<rect x="9" y="9" width="238" height="238" fill="none" stroke="${FRAME}" stroke-width="3"/>`,
    r(44, 102, 112, 22),
    r(172, 58, 16, 108),
    r(44, 182, 22, 22), r(89, 182, 22, 22), r(134, 182, 22, 22),
  ].join('');
}

export function iconSvg(size) {
  const isSmall = size <= 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" shape-rendering="${isSmall ? 'crispEdges' : 'geometricPrecision'}">` +
    `<rect width="256" height="256" fill="${TILE}"/>${isSmall ? edge(size) + small(size) : large()}</svg>`;
}
