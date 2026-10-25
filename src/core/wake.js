// The click that brings STET back from another application only brings it back: it presses
// nothing, moves no caret and starts no drag. A press counts as that click when it lands while the
// window is still in the background, or within a moment of the window coming forward (the system
// sends the two together); a press after the window came forward some other way (Alt+Tab, the
// taskbar) is an ordinary press.

export const WAKE_MS = 150;

/** Whether a press at `at` is the one that woke the window: it was away, and the press came with
 *  the window's return (`backAt`) or before it (`focused` false). */
export function wakingPress({ away, focused, backAt, at }) {
  return away && (!focused || at - backAt < WAKE_MS);
}
