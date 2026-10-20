// What moves while STET opens: the browser's own layout-shift records (which elements
// moved, by how much, when), plus where the main landmarks sit over the first seconds.
// `node bench/launch-shift.js [userData]` (a throwaway profile by default).
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from '../test/e2e/cdp.js';

const ud = process.argv[2] || path.join(os.tmpdir(), 'stet-launch-shift');
const app = await App.launch({ userData: ud, hidden: false });
const probe = `(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  return { t: Math.round(performance.now()), page: r('.page'), status: r('#status') || r('footer'), goal: r('#st-goal'), toolbar: r('#toolbar') || r('header'), scroll: document.getElementById('scroller')?.scrollTop, zoom: window.__stet?.view?.z };
})()`;
const samples = [];
for (let i = 0; i < 20; i++) { samples.push(await app.eval(probe)); await sleep(100); }
const shifts = await app.eval(`new Promise((done) => {
  const out = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) out.push({ t: Math.round(e.startTime), value: +e.value.toFixed(4), sources: (e.sources || []).map((s) => ({ node: s.node ? (s.node.id ? '#' + s.node.id : s.node.className ? '.' + String(s.node.className).split(' ')[0] : s.node.nodeName) : '?', from: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round), to: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round) })) }); }).observe({ type: 'layout-shift', buffered: true });
  setTimeout(() => done(out), 300);
})`);
const paints = await app.eval(`performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)])`);
console.log(JSON.stringify({ paints, shifts, samples: samples.filter((s, i) => i === 0 || JSON.stringify({ ...s, t: 0 }) !== JSON.stringify({ ...samples[i - 1], t: 0 })) }, null, 1));
await app.close();
