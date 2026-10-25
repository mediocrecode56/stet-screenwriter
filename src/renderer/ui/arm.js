// A second press to confirm, for the few buttons whose one press would lose work (deleting a
// note, resetting the guidelines, restoring a backup). The first press arms the button: it fills and its label
// turns to CONFIRM (on an icon button, an icon of its own); a second press does the job. It never runs out on a
// clock: it waits until a press lands anywhere else (or Esc), and then quietly goes back. Nothing modal, nothing to dismiss.

import { reducedMotion, EASE_OUT } from './motion.js';

/** Disarm a button (or every armed one): its label back. */
export function disarm(btn) {
  for (const b of btn ? [btn] : [...document.querySelectorAll('.armed')]) {
    if (!b.classList.contains('armed')) continue;
    b.classList.remove('armed');
    b.innerHTML = b.dataset.label; // (its icon, if it had one)
    if (b.dataset.title != null) { b.title = b.dataset.title; delete b.dataset.title; }
  }
}

/** Press on an arming button: the first press arms it, the second (while armed) runs `confirm`. Returns whether it ran.
 *  `icon` (an svg) stands in for the label on a small icon button, `title` says what the second press does. */
export function arm(btn, confirm, { label = 'CONFIRM', icon = null, title = null } = {}) {
  if (btn.classList.contains('armed')) { disarm(btn); confirm(); return true; }
  disarm();
  btn.dataset.label = btn.innerHTML;
  if (icon) btn.innerHTML = icon; else btn.textContent = label;
  if (title) { btn.dataset.title = btn.title; btn.title = title; }
  btn.classList.add('armed');
  if (!reducedMotion()) btn.animate([{ opacity: 0.4, transform: 'translateX(3px)' }, { opacity: 1, transform: 'none' }], { duration: 110, easing: EASE_OUT });
  return false;
}

// A press anywhere but on the armed button itself takes it back.
addEventListener('mousedown', (e) => { if (!e.target.closest?.('.armed')) disarm(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') disarm(); }, true);
