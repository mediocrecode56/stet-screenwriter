// Shared motion for every surface that opens: side panels, the find bar,
// dialogs and menus. The same curves and durations are defined as CSS
// variables (--ease-out, --ease-in-out, --dur-fast, --dur-panel) in style.css,
// so CSS and script motion feel identical.
//
// One principle everywhere: a surface arrives with a single decelerating move
// from the direction it belongs to (a side panel from its edge, the find bar
// from under the toolbar, a dialog or menu dropping a few pixels into place)
// and leaves the same way, accelerating out. Nothing overshoots or bounces.
// Motion never holds anything up: focus, typing and the command's own effect
// happen at once, and a surface reopened while it is still leaving reverses
// from where it is.

export const EASE_OUT = 'cubic-bezier(.2, 0, 0, 1)';
export const EASE_IN_OUT = 'cubic-bezier(.4, 0, .2, 1)';
export const DUR_FAST = 90;
export const DUR_PANEL = 140;

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => reduced.matches;

/** Is a panel open (or opening)? Closing panels already count as closed. */
export const isOpen = (el) => el.dataset.open === '1';

const EDGE = { left: ['marginLeft', 'offsetWidth'], right: ['marginRight', 'offsetWidth'], top: ['marginTop', 'offsetHeight'] };

/**
 * Open or close a docked panel (data-side = left | right | top; right by
 * default). The panel keeps its size and slides in from (or out to) its edge
 * by animating its outer margin, so whatever sits beside it glides to its new
 * position instead of jumping, and the panel's own contents never re-wrap
 * mid-animation. A toggle during an animation reverses smoothly from where it is.
 */
export function setPanel(el, want) {
  if (isOpen(el) === want && !(want && el.hidden)) return;
  el.dataset.open = want ? '1' : '0';
  const [prop, size] = EDGE[el.dataset.side] || EDGE.right;
  const from = el._anim ? parseFloat(getComputedStyle(el)[prop]) || 0 : null;
  if (el._anim) { el._anim.cancel(); el._anim = null; }
  if (want) el.hidden = false;
  const w = el[size];
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

/** A floating surface (dialog, menu) arrives: a short drop into place while it fades in. */
export function arrive(el, { dist = 6, dur = DUR_PANEL } = {}) {
  if (reduced.matches) return;
  el.animate([{ opacity: 0, transform: `translateY(${-dist}px)` }, { opacity: 1, transform: 'none' }], { duration: dur, easing: EASE_OUT });
}

/**
 * A floating surface leaves: it stops taking input at once and fades out
 * while drifting back up, then `done` runs. Returns a cancel function (for a
 * surface reopened before it finished leaving).
 */
export function leave(el, done, { dist = 4, dur = DUR_FAST } = {}) {
  if (reduced.matches) { done(); return () => {}; }
  el.style.pointerEvents = 'none';
  let over = false;
  const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-dist}px)` }], { duration: dur, easing: EASE_IN_OUT, fill: 'forwards' });
  const finish = () => { if (over) return; over = true; a.cancel(); el.style.pointerEvents = ''; done(); };
  a.onfinish = finish;
  const t = setTimeout(finish, dur + 80);
  return () => { if (over) return; over = true; clearTimeout(t); a.cancel(); el.style.pointerEvents = ''; };
}
