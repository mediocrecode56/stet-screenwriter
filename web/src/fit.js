// How the page sits on a screen narrower than a sheet of paper. A whole page on a phone is too small
// to write on, so the margins go first: the zoom fits the text column, and the sheet is moved left so
// the column is what shows. Wider screens get the plain sheet, as on the desktop.

import { ZOOM_MIN } from '../../src/core/wheelzoom.js';

const INCH = 96;
const PAPER = 8.27 * INCH;     // an A4 sheet at zoom 1
const TEXT_LEFT = 1.5 * INCH;  // where the text column starts on it
const TEXT_W = 5.77 * INCH;    // and how wide it is (to the 1in right margin)
const GUTTER = 12;

/** { z, left }: the zoom for a screen `width` wide, and how far to scroll the sheet left (px at that zoom). */
export function fit(width) {
  if (width >= PAPER + 56) return { z: 1, left: 0 };
  const whole = (width - 24) / PAPER;
  if (whole >= 0.8) return { z: +whole.toFixed(3), left: 0 };
  const z = Math.max(ZOOM_MIN, (width - 2 * GUTTER) / TEXT_W);
  return { z: +z.toFixed(3), left: Math.round(TEXT_LEFT * z - GUTTER) };
}
