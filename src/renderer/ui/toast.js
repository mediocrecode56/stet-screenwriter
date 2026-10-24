// A short notice above the status bar (a dictionary installed, say): it rises in, stays a few seconds
// and sinks out; a newer one takes its place in the same box, without leaving and arriving again.
// Never takes the keyboard or a click.

import { h } from './dialog.js';
import { arrive, leave, DUR_FAST } from './motion.js';

let current = null;

export function toast(text, ms = 3500) {
  const me = current || { el: h('div', { class: 'toast', role: 'status' }) };
  me.el.textContent = text;
  if (!current) { document.body.appendChild(me.el); arrive(me.el, { dist: -3, dur: DUR_FAST * 2 }); }
  current = me;
  clearTimeout(me.t);
  me.t = setTimeout(() => { if (current === me) current = null; leave(me.el, () => me.el.remove(), { dist: -3 }); }, ms);
  return me.el;
}
