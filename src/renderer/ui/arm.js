// A second press to confirm, for the few buttons whose one press would lose work (deleting a
// note, resetting the guidelines). The first press arms the button: it fills, its label turns to
// CONFIRM (on an icon button, a check) and a thin bar under it runs out; a second press before the bar is gone does the job.
// Otherwise, or on a press anywhere else, it quietly goes back. Nothing modal, nothing to dismiss.

import { reducedMotion, EASE_OUT } from './motion.js';

export const ARM_MS = 2600;

/** Disarm a button (or every armed one): its label back, the bar gone. */
export function disarm(btn) {
  for (const b of btn ? [btn] : [...document.querySelectorAll('.armed')]) {
    clearTimeout(b._arm);
    if (!b.classList.contains('armed')) continue;
    b.classList.remove('armed');
    b.innerHTML = b.dataset.label; // (its icon, if it had one)
    if (b.dataset.title != null) { b.title = b.dataset.title; delete b.dataset.title; }
  }
}

/** Press on an arming button: the first press arms it, the second (while armed) runs `confirm`. Returns whether it ran.
 *  `icon` (an svg) stands in for the label on a small icon button, `title` says what the second press does. */
export function arm(btn, confirm, { label = 'CONFIRM', icon = null, title = null, ms = ARM_MS } = {}) {
  if (btn.classList.contains('armed')) { disarm(btn); confirm(); return true; }
  disarm();
  btn.dataset.label = btn.innerHTML;
  if (icon) btn.innerHTML = icon; else btn.textContent = label;
  if (title) { btn.dataset.title = btn.title; btn.title = title; }
  btn.classList.add('armed');
  btn.style.setProperty('--arm-ms', ms + 'ms');
  btn._arm = setTimeout(() => disarm(btn), ms);
  if (!reducedMotion()) btn.animate([{ opacity: 0.4, transform: 'translateX(3px)' }, { opacity: 1, transform: 'none' }], { duration: 110, easing: EASE_OUT });
  return false;
}

// A press anywhere but on the armed button itself takes it back.
addEventListener('mousedown', (e) => { if (!e.target.closest?.('.armed')) disarm(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') disarm(); }, true);
