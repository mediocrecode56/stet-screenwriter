// Command registry: one definition drives the menu bar, the command palette
// and keyboard shortcuts, so every function is discoverable in the same place.

import { h, open } from './dialog.js';

const commands = new Map();
const bindings = new Map(); // normalized key -> command id

export function register(list) {
  for (const c of list) {
    commands.set(c.id, c);
    for (const k of [].concat(c.keys || [])) bindings.set(normalize(k), c.id);
  }
}

export function get(id) { return commands.get(id); }
export function all() { return [...commands.values()]; }

export function run(id, ...args) {
  const c = commands.get(id);
  if (!c || (c.enabled && !c.enabled())) return false;
  c.run(...args);
  return true;
}

function normalize(k) {
  const parts = k.split('+').map((s) => s.trim());
  const key = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return [mods.has('ctrl') ? 'C' : '', mods.has('alt') ? 'A' : '', mods.has('shift') ? 'S' : '', key.length === 1 ? key.toUpperCase() : key].join('-');
}

function eventKey(e) {
  let key = e.key;
  if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === 'Backslash') key = '\\';
  else if (e.code === 'BracketLeft') key = '[';
  else if (e.code === 'BracketRight') key = ']';
  else if (e.code === 'Equal') key = '=';
  else if (e.code === 'Minus') key = '-';
  else if (key.length === 1) key = key.toUpperCase();
  return [(e.ctrlKey || e.metaKey) ? 'C' : '', e.altKey ? 'A' : '', e.shiftKey ? 'S' : '', key].join('-');
}

/** Command bound to a key event, if any. */
export function lookup(e) {
  const id = bindings.get(eventKey(e));
  return id ? commands.get(id) : null;
}

/** Run the command bound to a key event. Returns true if handled. */
export function handleKey(e) {
  const id = bindings.get(eventKey(e));
  if (!id) return false;
  return run(id);
}

export function keyLabel(c) {
  const k = c.display || [].concat(c.keys || [])[0];
  return k ? k.replace(/\bArrow/g, '') : '';
}

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
  window.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && !e.target.classList.contains('mb')) closeMenu(); });
  window.addEventListener('keydown', (e) => { if (openMenu && e.key === 'Escape') closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);
}

function showMenu(btn, items) {
  closeMenu();
  const el = h('div', { class: 'menu' });
  for (const it of typeof items === 'function' ? items() : items) {
    if (it === '-') { el.appendChild(h('div', { class: 'msep' })); continue; }
    const c = typeof it === 'string' ? commands.get(it) : it;
    if (!c) continue;
    const disabled = c.enabled && !c.enabled();
    const label = typeof c.label === 'function' ? c.label() : c.label;
    const row = h('div', { class: 'mi' + (disabled ? ' disabled' : '') }, h('span', {}, label), h('span', { class: 'k' }, keyLabel(c)));
    row.addEventListener('mouseup', () => { closeMenu(); if (c.run) setTimeout(() => (c.id ? run(c.id) : c.run()), 0); });
    el.appendChild(row);
  }
  document.body.appendChild(el);
  const r = btn.getBoundingClientRect();
  el.style.left = r.left + 'px';
  el.style.top = r.bottom + 'px';
  btn.classList.add('open');
  openMenu = { btn, el };
}

export function closeMenu() {
  if (!openMenu) return;
  openMenu.el.remove();
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
