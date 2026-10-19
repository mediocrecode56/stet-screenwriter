// Toolbar latency profile: real mouse clicks (CDP) on each toolbar control of
// a visible window with a 456-page script, measuring mousedown -> next frame
// and the JS time spent in the handler. `node bench/toolbar-latency.js`
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { App, sleep } from '../test/e2e/cdp.js';

const app = await App.launch({ userData: path.join(os.tmpdir(), 'stet-tb-' + process.pid), hidden: false });
await app.eval(`(async () => {
  const { generateScript } = await import('../dev/sample.js');
  const { newDocument } = await import('../core/model.js');
  const d = newDocument('BIG'); d.blocks = generateScript(400, 3);
  __stet.session.load(d, null);
})()`);
await sleep(800);
// In-page probe: timestamp at mousedown (capture), at handler end (bubble, last), and at next frame.
await app.eval(`window.__lat = []; window.__t0 = 0;
  addEventListener('mousedown', (e) => { __t0 = performance.now(); }, true);
  addEventListener('mousedown', () => { const js = performance.now() - __t0; requestAnimationFrame(() => setTimeout(() => __lat.push({ js, frame: performance.now() - __t0 }), 0)); }, false);`);
const targets = ['[data-t="character"]', '[data-t="action"]', '#hlbar .tb:nth-child(2)', '#btn-scenes', '#btn-scenes', '#btn-notes', '#btn-notes', '#th-light', '#th-dark', '#zoom-in', '#zoom-out', '#btn-comment', '#menubar .mb:nth-child(1)'];
const out = {};
for (const sel of targets) {
  const r = await app.eval(`(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  const xs = [];
  for (let i = 0; i < (sel.startsWith('#menubar') || sel === '#btn-comment' ? 1 : 6); i++) {
    await app.eval('__lat.length = 0; __stet.input.focus()');
    for (const type of ['mousePressed', 'mouseReleased']) await app.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 });
    await sleep(120);
    const l = await app.eval('__lat[0]');
    if (l) xs.push(l);
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(40);
  }
  const k = sel + (out[sel] ? ' (again)' : '');
  out[k] = { js: Math.max(...xs.map((x) => x.js)).toFixed(1), frameP50: xs.map((x) => x.frame).sort((a, b) => a - b)[xs.length >> 1].toFixed(1), frameMax: Math.max(...xs.map((x) => x.frame)).toFixed(1) };
}
// Animations / transitions present on toolbar elements
out.animations = await app.eval(`[...document.querySelectorAll('.tb,.mb,aside,.menu')].map(e => getComputedStyle(e)).map(s => s.transitionDuration + '|' + s.animationName + ' ' + s.animationDuration).filter((v, i, a) => a.indexOf(v) === i)`);
console.table(out);
await fs.mkdir('.perf', { recursive: true });
await fs.writeFile(process.argv[2] || '.perf/toolbar-before.json', JSON.stringify(out, null, 1));
await app.close();
