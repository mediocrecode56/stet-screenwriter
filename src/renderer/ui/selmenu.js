// The right-click menu on selected text: four square buttons in a row, the element type, text style,
// alignment and a note. The first three open their own dropdown under the bar: on a click, or after
// resting on one for 0.3 seconds, or at once when another one is already open. The note adds one on the selection at once and opens the notes panel to write it.

import { h } from './dialog.js';
import * as cmd from './commands.js';
import { arrive, leave, DUR_FAST, DUR_PANEL } from './motion.js';

export const HOVER_MS = 300; // resting on a button this long opens its dropdown
const STYLE = '<span class="gb" aria-hidden="true">B</span>';
const NOTE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><rect x=".5" y=".5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1"/><rect x="4" y="4" width="4" height="4" fill="currentColor"/></svg>';
const DN = '<span class="dn" aria-hidden="true">▾</span>';

let open = null; // { el, off, drop, wait }

/** The menu at (x, y): `types`, `styles` and `aligns` are the command ids of each dropdown (`types()`
 *  read as it opens: the element types in the Tab cycle), `typeLabel()` the selection's element
 *  as it is now, `alignIcon()` the icon for the paragraph's alignment. */
export function selectionMenu(x, y, { types, typeLabel, styles, aligns, alignIcon }) {
  closeSelectionMenu(false);
  cmd.closeMenu(false);
  const el = h('div', { class: 'menu selbar', role: 'toolbar', 'aria-label': 'Selection' });
  el.addEventListener('mousedown', (e) => e.preventDefault()); // the script keeps the keyboard
  const btn = (k, title, html) => {
    const b = h('button', { class: 'selb', 'data-k': k, title, 'aria-label': title, html });
    el.appendChild(b);
    return b;
  };
  const drops = [
    [btn('type', 'Element', `<span class="tl">${typeLabel()}</span>` + DN), types],
    [btn('style', 'Text style', STYLE + DN), () => styles],
    [btn('align', 'Alignment', alignIcon() + DN), () => aligns],
  ];
  const note = btn('note', 'Add a note', NOTE);
  for (const [b, ids] of drops) {
    b.setAttribute('aria-haspopup', 'menu');
    b.addEventListener('mouseenter', () => {
      if (!open || (open.drop && open.drop.btn === b)) return;
      if (open.drop) return showDrop(b, ids()); // (one already open: the next at once)
      wait(b, () => showDrop(b, ids()));
    });
    b.addEventListener('mouseleave', () => wait(null));
    b.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !open) return;
      wait(null);
      if (open.drop && open.drop.btn === b) hideDrop(); else showDrop(b, ids());
    });
  }
  note.addEventListener('mouseenter', () => { wait(null); hideDrop(); });
  note.addEventListener('mouseup', (e) => { if (e.button !== 0) return; closeSelectionMenu(); setTimeout(() => cmd.run('note-add'), 0); });
  document.body.appendChild(el);
  // (a step off the pointer, so the button under it doesn't take it for resting there)
  el.style.left = Math.max(0, Math.min(x + 2, innerWidth - el.offsetWidth)) + 'px';
  el.style.top = Math.max(0, Math.min(y + 2, innerHeight - el.offsetHeight)) + 'px';
  arrive(el, { dist: 2, dur: DUR_FAST, scale: 0.98 }); // (as every other menu opens: commands.js)
  const off = new AbortController();
  open = { el, off, drop: null, wait: null };
  addEventListener('mousedown', (e) => { if (!el.contains(e.target)) closeSelectionMenu(); }, { capture: true, signal: off.signal });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (open.drop) hideDrop(); else closeSelectionMenu(); } }, { capture: true, signal: off.signal });
  addEventListener('blur', () => closeSelectionMenu(), { signal: off.signal });
  return el;
}

/** Wait on button b and then run `then`; none: stop waiting. */
function wait(b, then) {
  if (!open) return;
  if (open.wait) { clearTimeout(open.wait.t); open.wait = null; }
  if (!b) return;
  open.wait = { b, t: setTimeout(() => { if (!open || !open.wait || open.wait.b !== b) return; open.wait = null; then(); }, HOVER_MS) };
}

/** A button's dropdown, under the bar from the button's left edge (inside the bar, so a click in it
 *  is a click in the menu): each command with its shortcut, the current ones marked. It slides out
 *  from under the bar in one decelerating move, as a side panel does from its edge (motion.js). */
function showDrop(b, ids) {
  hideDrop();
  const el = open.el, d = h('div', { class: 'menu msub seldrop', role: 'menu', 'data-k': b.dataset.k });
  for (const id of ids) {
    const c = cmd.get(id);
    if (!c) continue;
    const label = typeof c.label === 'function' ? c.label() : c.label;
    const row = h('div', { class: 'mi' + (c.checked && c.checked() ? ' cur' : ''), role: 'menuitem', 'data-id': id }, h('span', {}, label), h('span', { class: 'k' }, cmd.keyLabel(c)));
    row.addEventListener('mouseup', (e) => { if (e.button !== 0) return; e.stopPropagation(); closeSelectionMenu(); setTimeout(() => cmd.run(id), 0); });
    d.appendChild(row);
  }
  el.appendChild(d);
  const r = el.getBoundingClientRect(), up = r.bottom + d.offsetHeight > innerHeight;
  d.style.left = Math.min(b.offsetLeft - el.clientLeft, innerWidth - r.left - d.offsetWidth) + 'px';
  d.style.top = (up ? -d.offsetHeight : r.height - el.clientTop - 1) + 'px';
  b.classList.add('open');
  open.drop = { btn: b, el: d };
  // (never a clip: a click on it at once must still land in it)
  arrive(d, { dist: up ? -6 : 6, dur: DUR_PANEL });
}

function hideDrop() {
  if (!open || !open.drop) return;
  const { btn, el } = open.drop;
  open.drop = null;
  btn.classList.remove('open');
  leave(el, () => el.remove(), { dist: 0, dur: DUR_FAST });
}

export function closeSelectionMenu(animated = true) {
  if (!open) return;
  const { el, off } = open;
  if (open.wait) clearTimeout(open.wait.t);
  open = null;
  off.abort();
  if (animated) leave(el, () => el.remove(), { dist: 3 }); else el.remove();
}
