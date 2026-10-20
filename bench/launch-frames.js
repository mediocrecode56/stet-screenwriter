// The first frames STET paints when it opens (a screencast from the first paint), saved
// as PNGs with a per-frame record of the window size, scroll and key landmarks, to see
// anything that jumps. `node bench/launch-frames.js [userData] [outDir]`
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from '../test/e2e/cdp.js';

const ud = process.argv[2] || path.join(os.tmpdir(), 'stet-launch-frames');
const out = process.argv[3] || path.join(os.tmpdir(), 'stet-launch-frames-out');
await fs.mkdir(out, { recursive: true });
const app = await App.launch({ userData: ud, hidden: false });
const frames = [];
app.ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method !== 'Page.screencastFrame') return;
  frames.push({ t: msg.params.metadata.timestamp, w: msg.params.metadata.deviceWidth, h: msg.params.metadata.deviceHeight, data: msg.params.data });
  app.send('Page.screencastFrameAck', { sessionId: msg.params.sessionId }).catch(() => {});
});
await app.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
const log = [];
for (let i = 0; i < 30; i++) {
  log.push(await app.eval(`(() => { const s = document.getElementById('scroller'); const g = document.getElementById('st-goal')?.getBoundingClientRect(); const p = document.querySelector('.page:not(.metric-probe)')?.getBoundingClientRect();
    return { t: Math.round(performance.now()), win: [innerWidth, innerHeight], dpr: devicePixelRatio, scroll: s && s.scrollTop, page: p && [Math.round(p.left), Math.round(p.top)], goal: g && Math.round(g.left), z: __stet.view.z }; })()`));
  await sleep(50);
}
await app.send('Page.stopScreencast');
const t0 = frames[0]?.t ?? 0;
for (const [i, f] of frames.entries()) await fs.writeFile(path.join(out, `f${String(i).padStart(2, '0')}.png`), Buffer.from(f.data, 'base64'));
console.log(JSON.stringify({ frames: frames.map((f) => ({ ms: Math.round((f.t - t0) * 1000), size: [f.w, f.h] })), log: log.filter((s, i) => i === 0 || JSON.stringify({ ...s, t: 0 }) !== JSON.stringify({ ...log[i - 1], t: 0 })), out }, null, 1));
await app.close();
