// Drives the real app over the Chrome DevTools Protocol: one start per test file, real key and
// mouse events (Chromium's own input pipeline, not DOM events made up in the page), and waits that
// end the moment what they wait for is true (never a fixed sleep). Node's WebSocket and fetch only.
//
//   const app = await App.launch({ userData });
//   await app.load([['scene', 'INT. HOUSE']]);   // a fresh screenplay
//   await app.type('Rain.'); await app.key('Ctrl+Z');
//   await app.until('__stet.session.dirty === false');
//
// STET_E2E_EXE runs them against a packaged build instead of the dev tree.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = process.env.STET_E2E_EXE || path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
// Chromium refuses to run as root (a Linux container) without --no-sandbox.
const APP_ARGS = [...(process.env.STET_E2E_EXE ? [] : [ROOT]), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])];
// How long STET may take to start. A Mac checks a newly downloaded app once, on its first start (the release workflow).
const START_MS = Number(process.env.STET_E2E_START_MS) || 15000;
const SEND_MS = 30000;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Ctrl, or Cmd on a Mac: the modifier STET's shortcuts and timeline stepping use. */
export const MAC = process.platform === 'darwin';
export const MOD = MAC ? 'Meta' : 'Ctrl';

// Every app and folder still around when the test process ends goes with it, so a failed test
// can never leave one behind (or keep the run waiting on it).
const live = new Set(), dirs = new Set();
process.on('exit', () => {
  for (const c of live) try { c.kill('SIGKILL'); } catch { /* gone */ }
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
});
/** A fresh temporary folder, removed with the test process. */
export async function scratch(name = 'stet') {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), name + '-'));
  dirs.add(d);
  return d;
}

// On Linux each app gets a virtual display of its own (Xvfb), so files running side by side never
// share a screen: each window has the focus as a writer's would, the pointer can be locked, and no
// window pops up on a desktop.
const XVFB = process.platform === 'linux' && spawnSync('which', ['Xvfb']).status === 0;
async function display() {
  for (let tries = 0; tries < 20; tries++) {
    const n = 200 + Math.floor(Math.random() * 3000);
    if (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`)) continue;
    const x = spawn('Xvfb', [`:${n}`, '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    live.add(x);
    x.once('exit', () => live.delete(x));
    for (let i = 0; i < 100 && x.exitCode === null; i++) { if (existsSync(`/tmp/.X11-unix/X${n}`)) return { name: `:${n}`, x }; await sleep(20); }
    x.kill();
  }
  throw new Error('no virtual display');
}

const KEYS = {
  Enter: [13, 'Enter'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], Escape: [27, 'Escape'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
  Home: [36, 'Home'], End: [35, 'End'], PageDown: [34, 'PageDown'], PageUp: [33, 'PageUp'], F3: [114, 'F3'], F8: [119, 'F8'], F9: [120, 'F9'],
  '=': [187, 'Equal'], '-': [189, 'Minus'], '\\': [220, 'Backslash'],
  Control: [17, 'ControlLeft'], Meta: [91, 'MetaLeft'], Shift: [16, 'ShiftLeft'], Alt: [18, 'AltLeft'],
};
const BIT = { Alt: 1, Ctrl: 2, Control: 2, Meta: 4, Cmd: 4, Shift: 8 };

export class App {
  static async launch({ userData, port = 9300 + Math.floor(Math.random() * 600), args = [], hidden = false, env = {} }) {
    const screen = XVFB ? await display() : null;
    const child = spawn(ELECTRON, [...APP_ARGS, '--e2e', ...(hidden ? ['--hidden'] : []), `--remote-debugging-port=${port}`, ...args], {
      env: { ...process.env, STET_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '0', ...(screen ? { DISPLAY: screen.name } : {}), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    live.add(child);
    child.once('exit', () => { live.delete(child); screen?.x.kill(); });
    child.stdout.on('data', () => {});
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    let target = null;
    for (const end = Date.now() + START_MS; Date.now() < end && !target && child.exitCode === null;) {
      await sleep(100);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.url.startsWith('stet://app/'));
      } catch { /* not up yet */ }
    }
    if (!target) { child.kill(); throw new Error('app did not start' + (err ? ':\n' + err : '')); }
    const app = new App(child, target.webSocketDebuggerUrl, userData);
    await app.open();
    await app.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // keys reach it like the focused window it would be
    await app.send('Runtime.enable');
    // Started: the screenplay to reopen is open, or STET is asking about unsaved work from a crash.
    await app.until(`!!window.__stet && (__stet.started || !!document.querySelector('#overlay:not([hidden]) .dlg'))`, { what: 'STET to finish starting', timeout: START_MS });
    return app;
  }

  constructor(child, wsUrl, userData) { this.child = child; this.wsUrl = wsUrl; this.userData = userData; this.id = 0; this.pending = new Map(); this.mods = 0; }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      // The app going away answers nothing more: fail what is still waiting rather than hang.
      this.ws.onclose = () => { for (const { rej } of this.pending.values()) rej(new Error('connection closed')); this.pending.clear(); };
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method}: no answer from the app in ${SEND_MS / 1000} s`)); }, SEND_MS);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    });
  }

  /** Evaluate in the page (awaiting a promise), returning the value. */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200));
    return r.result.value;
  }

  /** Wait until `cond` (an expression evaluated in the page, or an async function here) is truthy;
   *  returns its value. Fails after `timeout` ms with `what` and the last value seen. */
  async until(cond, { timeout = 8000, every = 20, what = String(cond).slice(0, 120) } = {}) {
    const end = Date.now() + timeout;
    let v;
    for (;;) {
      v = typeof cond === 'function' ? await cond() : await this.eval(cond);
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out after ${timeout} ms waiting for ${what} (last: ${JSON.stringify(v)})`);
      await sleep(every);
    }
  }

  // ---- the keyboard ----

  async type(text) {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, modifiers: this.mods });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, modifiers: this.mods });
    }
  }

  /** Press a key: "Enter", "Tab", "Ctrl+Z", "Shift+Tab", "Ctrl+1", "Alt+ArrowDown", "Mod+S" (Ctrl, or Cmd on a Mac) … */
  async key(combo) {
    const { base, modifiers } = keyOf(combo, this.mods);
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, modifiers });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, modifiers });
  }

  /** Hold a modifier down ("Control", "Meta", "Shift", "Alt"; "Mod" for Ctrl or Cmd) until up(). */
  async down(name) {
    name = name === 'Mod' ? (MAC ? 'Meta' : 'Control') : name;
    this.mods |= BIT[name];
    const [vk, code] = KEYS[name];
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: this.mods });
  }
  async up(name) {
    name = name === 'Mod' ? (MAC ? 'Meta' : 'Control') : name;
    this.mods &= ~BIT[name];
    const [vk, code] = KEYS[name];
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: this.mods });
  }

  // ---- the mouse (with whatever modifiers are held) ----

  mouse(type, x, y, { button = 'none', buttons = 0, clickCount = 0, ...rest } = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount, modifiers: this.mods, ...rest });
  }
  move(x, y, o = {}) { return this.mouse('mouseMoved', x, y, o); }
  async click(x, y, { button = 'left', count = 1 } = {}) {
    const b = { left: 1, right: 2, middle: 4 }[button];
    await this.mouse('mousePressed', x, y, { button, buttons: b, clickCount: count });
    await this.mouse('mouseReleased', x, y, { button, buttons: 0, clickCount: count });
  }
  /** Press at (x0, y0), move in `steps` to (x1, y1), let go. */
  async drag(x0, y0, x1, y1, steps = 6) {
    await this.mouse('mousePressed', x0, y0, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) await this.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { button: 'left', buttons: 1 });
    await this.mouse('mouseReleased', x1, y1, { button: 'left', clickCount: 1 });
  }
  wheel(x, y, deltaY, deltaX = 0) { return this.mouse('mouseWheel', x, y, { deltaX, deltaY }); }
  /** The box of the first element matching `sel` (or the i-th), in window coordinates, with its middle. */
  async rect(sel, i = 0) {
    const r = await this.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; })()`);
    if (!r) throw new Error('no element ' + sel);
    return { ...r, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** Click the middle of the element matching `sel`, for real. */
  async clickOn(sel, o) { const r = await this.rect(sel); await this.click(r.x, r.y, o); }

  // ---- STET ----

  /** Open a new screenplay of [type, text] blocks (no backups), the caret at the start, ready to type into. */
  load(list, settings = {}, title = 'T') {
    return this.eval(`(async () => {
      const { newDocument, makeBlock } = await import('../core/model.js');
      const d = newDocument(${JSON.stringify(title)}); d.settings.backup.enabled = false; Object.assign(d.settings, ${JSON.stringify(settings)});
      d.blocks = ${JSON.stringify(list.length ? list : [['action', '']])}.map(([t, x]) => makeBlock(t, x));
      __stet.session.load(d, null);
      await new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 100); }); // drawn (or, with no frames coming, a moment later)
      __stet.input.focus();
    })()`);
  }
  blocks() { return this.eval('__stet.editor.blocks.map((b) => [b.type, b.text])'); }
  /** Put the caret (or a selection from o to f) in block b. */
  caret(b, o, f = o) { return this.eval(`(() => { __stet.editor.setSel({ b: ${b}, o: ${o} }, { b: ${b}, o: ${f} }); __stet.input.after(); })()`); }
  /** Paste plain text into the script, as the clipboard would. */
  paste(text) {
    return this.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); const ta = document.getElementById('input'); ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  }
  saveTo(file) { return this.eval(`__stet.session.saveTo(${JSON.stringify(file)})`); }
  /** The open dialog's title and text ('' when none). */
  dialog() { return this.eval(`(() => { const d = document.querySelector('#overlay:not([hidden]) .dlg'); return d ? d.innerText : ''; })()`); }
  /** Wait for a dialog whose text matches `re`. */
  dialogMatching(re, timeout) { return this.until(async () => re.test(await this.dialog()), { what: 'a dialog matching ' + re, timeout }); }
  /** Click the dialog button labelled `label`. */
  async press(label) {
    const ok = await this.eval(`(() => { const b = [...document.querySelectorAll('#overlay .dlg button')].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    if (!ok) throw new Error('no button ' + label + ' in: ' + await this.dialog());
  }
  /** Wait for no dialog to be showing. */
  noDialog() { return this.until(`document.getElementById('overlay').hidden`, { what: 'the dialog to close' }); }
  /** A frame drawn: what the last change shows is on screen. */
  frame() { return this.eval('new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(() => r(true))); setTimeout(() => r(true), 150); })'); }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(file, Buffer.from(r.data, 'base64'));
  }

  get exited() { return this.child.exitCode !== null || this.child.signalCode !== null; }

  /** Quit the way STET does on closing its window (statistics flushed, nothing asked). */
  async close() {
    if (!this.exited) {
      const gone = new Promise((r) => this.child.once('exit', r));
      try { await Promise.race([this.eval('window.stet.invoke("app:close-ready")'), sleep(3000)]); } catch { /* gone */ }
      await Promise.race([gone, sleep(5000)]);
      if (!this.exited) await this.kill();
    }
    try { this.ws.close(); } catch { /* closed */ }
  }

  /** A crash or a power cut: no shutdown handlers run. */
  kill() {
    if (this.exited) return Promise.resolve();
    const gone = new Promise((r) => this.child.once('exit', r));
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { stdio: 'ignore' });
    else this.child.kill('SIGKILL');
    return gone;
  }
}

function keyOf(combo, held = 0) {
  const parts = combo.split('+');
  let key = parts.pop();
  if (key === '' && combo.endsWith('+')) key = '+';
  let modifiers = held;
  for (const m of parts) modifiers |= m === 'Mod' ? (MAC ? 4 : 2) : BIT[m];
  let vk, code;
  if (KEYS[key]) [vk, code] = KEYS[key];
  else if (/^\d$/.test(key)) { vk = 48 + +key; code = 'Digit' + key; }
  else { vk = key.toUpperCase().charCodeAt(0); code = 'Key' + key.toUpperCase(); }
  return { base: { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, modifiers };
}

/** A user-data folder with these files written into it first ({ 'settings.json': {...}, … }). */
export async function userData(files = {}) {
  const d = path.join(await scratch('stet-ud'), 'ud');
  await fs.mkdir(d, { recursive: true });
  for (const [name, v] of Object.entries(files)) await fs.writeFile(path.join(d, name), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
}

/** A date as the statistics key it (yyyy-mm-dd, local), `n` days ago. */
export function dayAgo(n = 0) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
