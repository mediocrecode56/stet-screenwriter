// A short notice above the status bar (a dictionary installed, say): it fades in, stays a few seconds
// and fades out; a newer one takes its place. Never takes the keyboard or a click.

import { h } from './dialog.js';
import { arrive, leave, DUR_FAST } from './motion.js';

let current = null;

export function toast(text, ms = 3500) {
  if (current) { const old = current; old.el.remove(); clearTimeout(old.t); }
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.appendChild(el);
  arrive(el, { dist: 3, dur: DUR_FAST * 2 });
  const me = current = { el, t: setTimeout(() => { if (current === me) current = null; leave(el, () => el.remove(), { dist: 3 }); }, ms) };
  return el;
}
