// Command registry: one definition drives the menu bar, the command palette
// and keyboard shortcuts, so every function is discoverable in the same place.

import { arrive, leave, DUR_FAST } from './motion.js';

const SUB_GRACE = 110; // ms a flyout waits before closing, so the pointer can cross a neighbouring row to reach it
import { h, open } from './dialog.js';

import { Keymap, comboOf, showKeys } from '../../core/keys.js';

const commands = new Map();
const keymap = new Keymap(); // shortcut -> command, with the writer's own changes (Help > Keyboard Shortcuts)
const listeners = [];

export function register(list) {
  for (const c of list) {
    commands.set(c.id, c);
    keymap.define(c.id, c.keys);
  }
}

export function get(id) { return commands.get(id); }
export function all() { return [...commands.values()]; }
export { keymap };

export function run(id, ...args) {
  const c = commands.get(id);
  if (!c || (c.enabled && !c.enabled())) return false;
  c.run(...args);
  return true;
}

/** The writer's changed shortcuts ({ id: [shortcut] }) are in effect from now on. */
export function setShortcuts(over) {
  keymap.setOverrides(over);
  for (const f of listeners) f();
}
/** Called whenever shortcuts change (tooltips, menus). */
export function onShortcuts(f) { listeners.push(f); }
export function changed() { for (const f of listeners) f(); }

/**
 * A key event: { cmd } when it completes a shortcut, { pending: true } when it begins one
 * (the rest of the sequence is still to come), or null.
 */
export function resolve(e) {
  const r = keymap.feed(comboOf(e));
  if (!r) return null;
  if (r.pending) return r;
  return { cmd: commands.get(r.id) };
}

/** Run the command bound to a key event. Returns true if the key was taken. */
export function handleKey(e) {
  const r = resolve(e);
  if (!r) return false;
  return r.cmd ? run(r.cmd.id) : true;
}

export function waiting() { return keymap.waiting; }

/** The shortcut shown for a command (its first), the Mac way on a Mac. */
export function keyLabel(c) {
  if (c.display) return showKeys(c.display);
  const k = keymap.keysOf(c.id)[0];
  return k ? showKeys(k) : '';
}
/** The same, by command id. */
export const keyText = (id) => { const c = commands.get(id); return c ? keyLabel(c) : ''; };


// ---- menu bar ---------------------------------------------------------------

let openMenu = null;

export function buildMenubar(host, menus) {
  host.replaceChildren();
  for (const m of menus) {
    const b = h('button', { class: 'mb' }, m.label);
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (openMenu && openMenu.btn === b) return closeMenu();
      showMenu(b, m.items);
    });
    b.addEventListener('mouseenter', () => { if (openMenu && openMenu.btn !== b) showMenu(b, m.items); });
    host.appendChild(b);
  }
  window.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && !e.target.closest('.mb, .mbtn')) closeMenu(); });
  window.addEventListener('keydown', (e) => { if (openMenu && e.key === 'Escape') closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);
}

/** A small menu under a toolbar button (class mbtn); pressing the button again closes it. */
export function popup(btn, items) {
  if (openMenu && openMenu.btn === btn) return closeMenu();
  showMenu(btn, items);
}

/** A context menu at a point in the window. */
export function menuAt(x, y, items) {
  const at = { getBoundingClientRect: () => ({ left: x, bottom: y }), classList: { add() {}, remove() {} } };
  showMenu(at, items);
  // Kept inside the window.
  const el = openMenu.el;
  el.style.left = Math.max(0, Math.min(x, window.innerWidth - el.offsetWidth)) + 'px';
  el.style.top = Math.max(0, Math.min(y, window.innerHeight - el.offsetHeight)) + 'px';
}

function showMenu(btn, items) {
  const switching = !!openMenu; // moving along the menu bar: the next menu is simply there
  closeMenu(false);
  const el = h('div', { class: 'menu' });
  el.addEventListener('mousedown', (e) => e.preventDefault()); // the script keeps the keyboard
  for (const it of typeof items === 'function' ? items() : items) {
    if (it === '-') { el.appendChild(h('div', { class: 'msep' })); continue; }
    const c = typeof it === 'string' ? commands.get(it) : it;
    if (!c) continue;
    const disabled = c.enabled && !c.enabled();
    const label = typeof c.label === 'function' ? c.label() : c.label;
    const row = h('div', { class: 'mi' + (disabled ? ' disabled' : '') + (c.sub ? ' has-sub' : '') + (c.checked && c.checked() ? ' cur' : '') + (c.highlight ? ' hi' : '') }, h('span', {}, label), h('span', { class: 'k' }, keyLabel(c)));
    row.addEventListener('mouseup', () => { closeMenu(); if (c.run) setTimeout(() => (c.id ? run(c.id) : c.run()), 0); });
    if (c.sub && !disabled) quickSub(el, row, c.sub()); else row.addEventListener('mouseenter', () => hideSub(el, SUB_GRACE));
    el.appendChild(row);
  }
  document.body.appendChild(el);
  const r = btn.getBoundingClientRect();
  el.style.left = Math.max(0, Math.min(r.left, window.innerWidth - el.offsetWidth)) + 'px'; // (a button at the right edge: the menu stays in the window)
  el.style.top = r.bottom + 'px';
  btn.classList.add('open');
  openMenu = { btn, el };
  if (!switching) arrive(el, { dist: 2, dur: DUR_FAST, scale: 0.98 });
}

// A quick flyout beside a menu row (Open Recent): its items load as the menu opens and show
// while the row is hovered. Clicking the row itself still runs its command.
function quickSub(menu, row, load) {
  let items = null;
  load.then((list) => { items = list; if (row.matches(':hover')) showSub(menu, row, items); }, () => {});
  row.addEventListener('mouseenter', () => { if (items) showSub(menu, row, items); });
}

function showSub(menu, row, items) {
  clearTimeout(menu._hide);
  if (menu.querySelector('.msub')) return; // already showing
  if (!items.length) return;
  const sub = h('div', { class: 'menu msub' });
  sub.addEventListener('mouseenter', () => clearTimeout(menu._hide));
  row.classList.add('sub-open');
  for (const it of items) {
    const r = h('div', { class: 'mi' + (it.disabled ? ' disabled' : '') + (it.current ? ' cur' : ''), title: it.title || '' }, h('span', { class: 'mi-t' }, it.label));
    r.addEventListener('mouseup', (e) => { e.stopPropagation(); closeMenu(); setTimeout(it.run, 0); });
    sub.appendChild(r);
  }
  menu.appendChild(sub);
  // Inside the menu (so a click in it is a click in the menu), placed beside it level with the
  // row; on the left instead if it would leave the window.
  const m = menu.getBoundingClientRect();
  sub.style.left = (m.right + sub.offsetWidth > window.innerWidth ? -sub.offsetWidth : m.width - 1) + 'px';
  const inset = sub.clientTop + parseFloat(getComputedStyle(sub).paddingTop); // its first row level with this one
  sub.style.top = Math.min(row.offsetTop - inset, window.innerHeight - m.top - sub.offsetHeight) + 'px';
  arrive(sub, { dist: 0, dur: DUR_FAST });
}

// Hidden after a short grace, so the pointer can cross a neighbouring row on its way into the flyout.
function hideSub(menu, delay = 0) {
  clearTimeout(menu._hide);
  const go = () => { const s = menu.querySelector('.msub'); if (s) s.remove(); for (const r of menu.querySelectorAll('.sub-open')) r.classList.remove('sub-open'); };
  if (delay) menu._hide = setTimeout(go, delay); else go();
}

export function closeMenu(animated = true) {
  if (!openMenu) return;
  const el = openMenu.el;
  if (animated) leave(el, () => el.remove(), { dist: 2 }); else el.remove();
  openMenu.btn.classList.remove('open');
  openMenu = null;
}

// ---- command palette -------------------------------------------------------------

export function palette() {
  const input = h('input', { placeholder: 'type a command…', spellcheck: false });
  const list = h('div', { class: 'list' });
  let items = [];
  let sel = 0;
  const visible = () => all().filter((c) => c.label && !c.hidden && (!c.enabled || c.enabled()));
  const render = () => {
    const q = input.value.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    items = visible().filter((c) => {
      const label = (typeof c.label === 'function' ? c.label() : c.label).toLowerCase() + ' ' + (c.cat || '').toLowerCase();
      return words.every((w) => label.includes(w));
    });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...items.slice(0, 60).map((c, i) => {
      const row = h('div', { class: 'mi' + (i === sel ? ' active' : '') },
        h('span', {}, h('span', { style: 'color:var(--ink-3)' }, (c.cat || '') + ' / '), typeof c.label === 'function' ? c.label() : c.label),
        h('span', { class: 'k' }, keyLabel(c)));
      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      return row;
    }));
    const a = list.querySelector('.active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  };
  let closeFn = null;
  const pick = (i) => { const c = items[i]; if (!c) return; closeFn(null); setTimeout(() => run(c.id), 0); };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(sel); }
  });
  render();
  return open({ cls: 'palette', body: h('div', {}, input, list), buttons: [], init: (d, close) => { closeFn = close; d.querySelector('.foot').remove(); } });
}
