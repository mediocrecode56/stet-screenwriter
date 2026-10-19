// Shared motion settings for scripted animation. The same curves and durations
// are defined as CSS variables (--ease-out, --ease-in-out, --dur-fast,
// --dur-panel) in style.css, so CSS and script motion feel identical.

export const EASE_OUT = 'cubic-bezier(.2, 0, 0, 1)';
export const EASE_IN_OUT = 'cubic-bezier(.4, 0, .2, 1)';
export const DUR_FAST = 90;
export const DUR_PANEL = 140;

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/** Is a side panel open (or opening)? Closing panels already count as closed. */
export const isOpen = (el) => el.dataset.open === '1';

/**
 * Open or close a side panel. The panel keeps its width and slides in from (or
 * out to) its edge by animating its outer margin, so the page beside it glides
 * to its new position instead of jumping, and the panel's own text never
 * re-wraps mid-animation. One decelerating move, no overshoot. A toggle during
 * an animation reverses smoothly from where it is.
 */
export function setPanel(el, want) {
  if (isOpen(el) === want && !(want && el.hidden)) return;
  el.dataset.open = want ? '1' : '0';
  const prop = el.dataset.side === 'left' ? 'marginLeft' : 'marginRight';
  const from = el._anim ? parseFloat(getComputedStyle(el)[prop]) || 0 : null;
  if (el._anim) { el._anim.cancel(); el._anim = null; }
  if (want) el.hidden = false;
  const w = el.offsetWidth;
  if (reduced.matches || !w) { el.hidden = !want; return; }
  const start = from ?? (want ? -w : 0);
  const end = want ? 0 : -w;
  const dur = DUR_PANEL * Math.min(1, Math.abs(end - start) / w);
  const a = el.animate([{ [prop]: start + 'px' }, { [prop]: end + 'px' }], { duration: Math.max(dur, 1), easing: want ? EASE_OUT : EASE_IN_OUT });
  el._anim = a;
  const done = () => {
    if (el._anim !== a) return;
    el._anim = null;
    if (!want) el.hidden = true;
  };
  a.onfinish = done;
  // Animations don't advance in a minimised/background window: settle anyway.
  setTimeout(() => { if (el._anim === a) { a.cancel(); done(); } }, dur + 80);
}
