// Minimal modal dialogs. One at a time; Esc cancels, Enter triggers the primary button.

const overlay = () => document.getElementById('overlay');
let active = null;

export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * open({ title, sub, body: Node, buttons: [{label, value, primary, disabled}], cls, onKey })
 * Resolves with the clicked button's value (or null on cancel).
 */
export function open({ title, sub = '', body, buttons = [{ label: 'Close', value: null }], cls = '', foot = null, init = null }) {
  if (active) active.close(null);
  const ov = overlay();
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const btns = buttons.map((b) => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.cls ? ' ' + b.cls : ''), disabled: b.disabled, onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label));
    const dlg = h('div', { class: 'dlg ' + cls, role: 'dialog' },
      title ? h('h2', {}, title, sub ? h('small', {}, sub) : null) : null,
      body,
      h('div', { class: 'foot' }, h('span', { class: 'grow' }, foot || ''), ...btns));
    ov.replaceChildren(dlg);
    ov.hidden = false;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const i = buttons.findIndex((b) => b.primary);
        if (i >= 0 && !btns[i].disabled) { e.preventDefault(); btns[i].click(); }
      }
    };
    ov.addEventListener('keydown', onKey, true);
    const onDown = (e) => { if (e.target === ov) close(null); };
    ov.addEventListener('mousedown', onDown);
    function close(v) {
      ov.removeEventListener('keydown', onKey, true);
      ov.removeEventListener('mousedown', onDown);
      ov.hidden = true;
      ov.replaceChildren();
      active = null;
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(v);
    }
    active = { close, dlg, buttons: btns };
    if (init) init(dlg, close, btns);
    const first = dlg.querySelector('input, select, textarea') || btns.find((b) => b.classList.contains('primary')) || btns[0];
    if (first) first.focus();
  });
}

export function isOpen() { return !!active; }

export async function confirm(title, message, okLabel = 'OK', cancelLabel = 'Cancel') {
  const v = await open({ title, body: h('div', { class: 'body' }, h('p', {}, message)), buttons: [{ label: cancelLabel, value: false }, { label: okLabel, value: true, primary: true }] });
  return v === true;
}

export function alertBox(title, message, detail) {
  return open({ title, body: h('div', { class: 'body' }, h('p', {}, message), detail ? h('div', { class: 'err-text' }, detail) : null), buttons: [{ label: 'OK', value: true, primary: true }] });
}

/** Three-way choice. Returns the chosen value or null. */
export function choose(title, message, choices) {
  return open({ title, body: h('div', { class: 'body' }, h('p', {}, message)), buttons: choices });
}

export function prompt(title, label, value = '', hint = '') {
  const input = h('input', { type: 'text', value });
  return open({
    title,
    body: h('div', { class: 'body' }, h('div', { class: 'field' }, h('label', {}, label), input), hint ? h('div', { class: 'hint' }, hint) : null),
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: () => input.value, primary: true }],
    init: () => setTimeout(() => input.select(), 0),
  });
}
