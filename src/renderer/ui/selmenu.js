// The right-click menu on selected text: three square icons in a row, text style, alignment and
// a note. The first two open their own dropdown under the bar (on hover, or a click); the note
// adds one on the selection at once and opens the notes panel to write it.

import { h } from './dialog.js';
import * as cmd from './commands.js';
import { arrive, leave, DUR_FAST } from './motion.js';

const STYLE = '<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" shape-rendering="crispEdges" fill="currentColor"><path d="M1 1h4.2c1.6 0 2.5.8 2.5 2.1 0 .9-.5 1.5-1.2 1.8.9.2 1.6.9 1.6 2 0 1.5-1 2.4-2.8 2.4H1zm1.8 1.5v2.3h2.2c.8 0 1.1-.4 1.1-1.1s-.4-1.2-1.1-1.2zm0 3.7v2.5h2.4c.8 0 1.3-.4 1.3-1.3 0-.8-.5-1.2-1.3-1.2z"/><path d="M10.2 1h3l-.3 1.2h-.8L10.6 8.1h.8l-.3 1.2h-3l.3-1.2h.8l1.5-5.9h-.8z"/><rect x="0" y="11" width="14" height="1"/></svg>';
const NOTE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path d="M1.5 1.5h9v7h-5l-2.5 2.2V8.5H1.5z" fill="none" stroke="currentColor" stroke-width="1"/><rect x="5.5" y="3" width="1" height="4" fill="currentColor"/><rect x="4" y="4.5" width="4" height="1" fill="currentColor"/></svg>';

let open = null; // { el, off, drop }

/** The menu at (x, y): `styles` and `aligns` are the command ids of each dropdown, `alignIcon()`
 *  the icon for the paragraph's alignment as it is now. */
export function selectionMenu(x, y, { styles, aligns, alignIcon }) {
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
    [btn('style', 'Text style', STYLE + '<span class="dn">▾</span>'), styles],
    [btn('align', 'Alignment', alignIcon() + '<span class="dn">▾</span>'), aligns],
  ];
  const note = btn('note', 'Add a note', NOTE);
  for (const [b, ids] of drops) {
    b.addEventListener('mouseenter', () => { if (open && open.drop && open.drop.btn !== b) showDrop(b, ids); });
    b.addEventListener('mouseup', (e) => { if (e.button !== 0 || !open) return; if (open.drop && open.drop.btn === b) hideDrop(); else showDrop(b, ids); });
  }
  note.addEventListener('mouseenter', hideDrop);
  note.addEventListener('mouseup', (e) => { if (e.button !== 0) return; closeSelectionMenu(); setTimeout(() => cmd.run('note-add'), 0); });
  document.body.appendChild(el);
  el.style.left = Math.max(0, Math.min(x, innerWidth - el.offsetWidth)) + 'px';
  el.style.top = Math.max(0, Math.min(y, innerHeight - el.offsetHeight)) + 'px';
  arrive(el, { dist: 2, dur: DUR_FAST, scale: 0.98 });
  const off = new AbortController();
  open = { el, off, drop: null };
  addEventListener('mousedown', (e) => { if (!el.contains(e.target)) closeSelectionMenu(); }, { capture: true, signal: off.signal });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSelectionMenu(); } }, { capture: true, signal: off.signal });
  addEventListener('blur', () => closeSelectionMenu(), { signal: off.signal });
  return el;
}

/** A button's dropdown, under the bar from the button's left edge (inside the bar, so a click in it
 *  is a click in the menu): each command with its shortcut, the current ones marked. */
function showDrop(b, ids) {
  hideDrop();
  const el = open.el, d = h('div', { class: 'menu msub seldrop', role: 'menu' });
  for (const id of ids) {
    const c = cmd.get(id);
    if (!c) continue;
    const row = h('div', { class: 'mi' + (c.checked && c.checked() ? ' cur' : ''), role: 'menuitem', 'data-id': id }, h('span', {}, c.label), h('span', { class: 'k' }, cmd.keyLabel(c)));
    row.addEventListener('mouseup', (e) => { if (e.button !== 0) return; e.stopPropagation(); closeSelectionMenu(); setTimeout(() => cmd.run(id), 0); });
    d.appendChild(row);
  }
  el.appendChild(d);
  const r = el.getBoundingClientRect();
  d.style.left = Math.min(b.offsetLeft - el.clientLeft, innerWidth - r.left - d.offsetWidth) + 'px';
  d.style.top = (r.bottom + d.offsetHeight > innerHeight ? -d.offsetHeight : r.height - el.clientTop - 1) + 'px';
  b.classList.add('open');
  open.drop = { btn: b, el: d };
  arrive(d, { dist: 0, dur: DUR_FAST });
}

function hideDrop() {
  if (!open || !open.drop) return;
  open.drop.el.remove();
  open.drop.btn.classList.remove('open');
  open.drop = null;
}

export function closeSelectionMenu(animated = true) {
  if (!open) return;
  const { el, off } = open;
  open = null;
  off.abort();
  if (animated) leave(el, () => el.remove(), { dist: 2 }); else el.remove();
}
