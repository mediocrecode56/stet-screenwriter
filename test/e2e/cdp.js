// Tiny Chrome DevTools Protocol client used to drive the real app in E2E tests.
// Uses Node's built-in WebSocket and fetch — no dependencies.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// STET_E2E_EXE runs the suite against a packaged build instead of the dev tree.
const ELECTRON = process.env.STET_E2E_EXE || path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const APP_ARGS = process.env.STET_E2E_EXE ? [] : [ROOT];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class App {
  static async launch({ userData, port = 9300 + Math.floor(Math.random() * 500), args = [], hidden = true, env = {} }) {
    // Hidden windows produce no compositor frames, so screenshots need a visible one.
    const child = spawn(ELECTRON, [...APP_ARGS, '--e2e', ...(hidden ? ['--hidden'] : []), `--remote-debugging-port=${port}`, ...args], {
      env: { ...process.env, STET_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    let target = null;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(150);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.url.startsWith('stet://app/'));
      } catch { /* not up yet */ }
    }
    if (!target) { child.kill(); throw new Error('app did not start'); }
    const app = new App(child, target.webSocketDebuggerUrl);
    await app.open();
    await app.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await app.send('Runtime.enable');
    for (let i = 0; i < 100; i++) {
      if (await app.eval('!!window.__stet')) return app;
      await sleep(100);
    }
    throw new Error('app hook not ready');
  }

  constructor(child, wsUrl) { this.child = child; this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }

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
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  async type(text) {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  }

  /** Press a key: "Enter", "Tab", "Ctrl+Z", "Shift+Tab", "Ctrl+1", "Alt+2" … */
  async key(combo) {
    const parts = combo.split('+');
    const key = parts.pop();
    let modifiers = 0;
    for (const m of parts) modifiers |= { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[m];
    const map = {
      Enter: [13, 'Enter'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], Escape: [27, 'Escape'],
      ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
      Home: [36, 'Home'], End: [35, 'End'], PageDown: [34, 'PageDown'], PageUp: [33, 'PageUp'], F3: [114, 'F3'], F8: [119, 'F8'],
      '=': [187, 'Equal'], '-': [189, 'Minus'], '\\': [220, 'Backslash'],
    };
    let vk, code;
    if (map[key]) [vk, code] = map[key];
    else if (/^\d$/.test(key)) { vk = 48 + +key; code = 'Digit' + key; }
    else { vk = key.toUpperCase().charCodeAt(0); code = 'Key' + key.toUpperCase(); }
    const base = { modifiers, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const fs = await import('node:fs/promises');
    await fs.writeFile(file, Buffer.from(r.data, 'base64'));
  }

  async close() {
    try { await Promise.race([this.eval('window.stet.invoke("app:close-ready")'), sleep(3000)]); } catch { /* gone */ }
    await Promise.race([new Promise((r) => this.child.once('exit', r)), sleep(5000)]);
    if (this.child.exitCode === null) this.kill();
  }

  /** Simulate a crash / power loss: no shutdown handlers run. */
  kill() {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { stdio: 'ignore' });
    else this.child.kill('SIGKILL');
    return new Promise((r) => this.child.once('exit', r));
  }
}

export { sleep };
