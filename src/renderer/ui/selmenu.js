// The right-click menu on selected text: five square buttons in a row, the element type, text style,
// alignment, a highlight and a note. The first four open their own dropdown under the bar on a click
// only (hovering just lights the icon); it drops in as the top menu's do, and a click on another
// button swaps it at once. The element's is a list of the types by name; style, alignment and
// highlight show a row of the toolbar's own icons, each named with its shortcut on hover. The note
// adds one on the selection at once and opens the notes panel to write it.

import { h } from './dialog.js';
import * as cmd from './commands.js';
import { arrive, leave, DUR_FAST } from './motion.js';
import { TEXT_STYLE, HIGHLIGHT, NOTE, DROP, alignIcon, toolIcon } from './icons.js';

// Every icon in a slot of one size (style.css .selb .ico).
const ico = (html) => `<span class="ico" aria-hidden="true">${html}</span>`;

let open = null; // { el, off, drop }

/** The menu at (x, y): `types`, `styles`, `aligns` and `highlights` are the command ids of each dropdown
 *  (`types()` read as it opens: the element types in the Tab cycle), `typeLabel()` the selection's element
 *  as it is now, `align()` the paragraph's alignment (its icon on the button). */
export function selectionMenu(x, y, { types, typeLabel, styles, aligns, highlights, align }) {
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
    [btn('type', 'Element', `<span class="tl">${typeLabel()}</span>` + DROP), types],
    [btn('style', 'Text style', ico(TEXT_STYLE) + DROP), () => styles],
    [btn('align', 'Alignment', ico(alignIcon(align())) + DROP), () => aligns],
    [btn('highlight', 'Highlight', ico(HIGHLIGHT) + DROP), () => highlights],
  ];
  const note = btn('note', 'Add a note', ico(NOTE));
  for (const [b, ids] of drops) {
    b.setAttribute('aria-haspopup', 'menu');
    b.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !open) return;
      if (open.drop && open.drop.btn === b) hideDrop(); else showDrop(b, ids(), b.dataset.k !== 'type');
    });
  }
  note.addEventListener('mouseup', (e) => { if (e.button !== 0) return; closeSelectionMenu(); setTimeout(() => cmd.run('note-add'), 0); });
  document.body.appendChild(el);
  // (a step off the pointer, so the button under it doesn't take it for resting there)
  el.style.left = Math.max(0, Math.min(x + 2, innerWidth - el.offsetWidth)) + 'px';
  el.style.top = Math.max(0, Math.min(y + 2, innerHeight - el.offsetHeight)) + 'px';
  arrive(el, { dist: 2, dur: DUR_FAST, scale: 0.98 }); // (as every other menu opens: commands.js)
  const off = new AbortController();
  open = { el, off, drop: null };
  addEventListener('mousedown', (e) => { if (!el.contains(e.target)) closeSelectionMenu(); }, { capture: true, signal: off.signal });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (open.drop) hideDrop(); else closeSelectionMenu(); } }, { capture: true, signal: off.signal });
  addEventListener('blur', () => closeSelectionMenu(), { signal: off.signal });
  return el;
}

/** A button's dropdown, under the bar from the button's left edge (inside the bar, so a click in it
 *  is a click in the menu): each command with its shortcut, the current ones marked; or, given
 *  `icons`, a row of the commands' toolbar icons, each named with its shortcut on hover. It arrives as
 *  every menu does (commands.js), with the same short drop and fade. */
function showDrop(b, ids, icons) {
  const switching = !!open.drop; // from one dropdown to the next: simply there, as along the menu bar
  hideDrop(false);
  const el = open.el, d = h('div', { class: 'menu msub seldrop' + (icons ? ' icons' : ''), role: 'menu', 'data-k': b.dataset.k });
  for (const id of ids) {
    const c = cmd.get(id);
    if (!c) continue;
    const label = typeof c.label === 'function' ? c.label() : c.label, keys = cmd.keyLabel(c);
    const row = icons
      ? h('div', { class: 'mi ic' + (c.checked && c.checked() ? ' cur' : ''), role: 'menuitem', 'data-id': id, title: label + (keys ? ` (${keys})` : ''), 'aria-label': label, html: toolIcon(id) })
      : h('div', { class: 'mi' + (c.checked && c.checked() ? ' cur' : ''), role: 'menuitem', 'data-id': id }, h('span', {}, label), h('span', { class: 'k' }, keys));
    row.addEventListener('mouseup', (e) => { if (e.button !== 0) return; e.stopPropagation(); closeSelectionMenu(); setTimeout(() => cmd.run(id), 0); });
    d.appendChild(row);
  }
  el.appendChild(d);
  const r = el.getBoundingClientRect(), up = r.bottom + d.offsetHeight > innerHeight;
  d.style.left = Math.min(b.offsetLeft - el.clientLeft, innerWidth - r.left - d.offsetWidth) + 'px';
  d.style.top = (up ? -d.offsetHeight : r.height - el.clientTop - 1) + 'px';
  b.classList.add('open');
  open.drop = { btn: b, el: d };
  if (!switching) arrive(d, { dist: up ? -2 : 2, dur: DUR_FAST, scale: 0.98 });
}

function hideDrop(animated = true) {
  if (!open || !open.drop) return;
  const { btn, el } = open.drop;
  open.drop = null;
  btn.classList.remove('open');
  if (animated) leave(el, () => el.remove(), { dist: 2 }); else el.remove();
}

export function closeSelectionMenu(animated = true) {
  if (!open) return;
  const { el, off } = open;
  open = null;
  off.abort();
  if (animated) leave(el, () => el.remove(), { dist: 3 }); else el.remove();
}
