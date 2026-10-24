// Ctrl+wheel zoom in fixed 5-percentage-point steps.
//
// Wheel hardware reports very different deltas: a classic notch is ~100 px,
// high-resolution wheels and trackpad pinches send many small deltas, and
// line/page modes exist. Deltas are normalised to pixels and accumulated; every
// STEP_PX of travel is one step, at most one step per event (so a fast spin or a
// 300 px event can never jump; less than a step is carried over), and leftover
// travel is dropped after a pause or a change of direction.

export const ZOOM_STEP = 0.05;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2; // (beyond twice the size the layout around the pages breaks)
const STEP_PX = 50;
const IDLE_MS = 400;

export class WheelZoom {
  constructor() { this.acc = 0; this.last = -Infinity; }

  /** Feed one wheel event; returns -1, 0 or +1 zoom steps (+1 = zoom in). */
  feed(deltaY, deltaMode = 0, now = performance.now()) {
    const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
    if (!px) return 0;
    if (now - this.last > IDLE_MS || Math.sign(px) !== Math.sign(this.acc)) this.acc = 0;
    this.last = now;
    this.acc += px;
    if (Math.abs(this.acc) < STEP_PX) return 0;
    const dir = this.acc < 0 ? 1 : -1; // wheel up (negative delta) zooms in
    // Carry the remainder (so small deltas add up evenly) but never a whole step.
    this.acc += dir * STEP_PX;
    this.acc = Math.max(-(STEP_PX - 1), Math.min(STEP_PX - 1, this.acc));
    return dir;
  }
}

/** Next zoom level `steps` away, exactly 5 points on, within the limits. */
export function stepZoom(z, steps) {
  const next = Math.round((z + steps * ZOOM_STEP) * 100) / 100;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
}

/** The scale of a side panel's text at script zoom `z`, following only a `share` of it (the notes
 *  and Revise half, the scenes a tenth): at 200% the notes are 150%, the scenes 110%. */
export function panelScale(z, share) {
  return Math.round((1 + (z - 1) * share) * 1000) / 1000;
}
