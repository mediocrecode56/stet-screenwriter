// Live check of the dormant mode in the real app: how much work the dinosaur's world does
// per minute in the background before and during a deep sleep, and how fast it is back.
// `node bench/dormant-live.js` (about a minute).
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from '../test/e2e/cdp.js';

const app = await App.launch({ userData: path.join(os.tmpdir(), 'stet-dormant-live') });
// Count the engine's ticks and canvas redraws.
await app.eval(`(() => {
  const d = __stet.dino;
  window.__n = { ticks: 0, draws: 0 };
  const tick = d.tick.bind(d); d.tick = () => { __n.ticks++; tick(); };
  const ctx = d.ctx, clear = ctx.clearRect.bind(ctx); ctx.clearRect = (...a) => { __n.draws++; clear(...a); };
  __stet.dino.c.setFocus(false, performance.now()); d.dormancy(); // in the background (another program has the focus)
})()`);
await app.eval('window.__stet.dino.schedule(0)');
const measure = async (ms) => { await app.eval('Object.assign(__n, { ticks: 0, draws: 0 })'); await sleep(ms); return app.eval('({ ...__n })'); };
await sleep(1500);
const awake = await measure(20000);
// Twelve minutes on: straight into the deep sleep it would have reached by then.
await app.eval(`(() => { const c = __stet.dino.c; c.blurAt = performance.now() - c.T.deepSleep - 1000; c.sleepDeeply(); __stet.dino.schedule(0); })()`);
await sleep(4000);
const state = await app.eval(`({ dormant: __stet.dino.c.dormant, cls: document.documentElement.classList.contains('dormant'),
  caretPaused: getComputedStyle(document.getElementById('caret')).animationPlayState })`);
const asleep = await measure(20000);
// Back: how long until the dinosaur breathes again, and the app is out of its rest.
const back = await app.eval(`new Promise((done) => {
  const d = __stet.dino, t0 = performance.now();
  d.c.setFocus(true, t0); d.dormancy(); d.schedule(0);
  const cls = document.documentElement.classList.contains('dormant');
  const check = () => (d.c.step && !d.c.step.dormant ? done({ ms: Math.round(performance.now() - t0), classAfterFocus: cls, frame: d.c.frame }) : setTimeout(check, 5));
  check();
})`);
await sleep(5000);
const woke = await app.eval('({ reaction: __stet.dino.c.inReaction, deep: __stet.dino.c.deep })');
console.log(JSON.stringify({ awake20s: awake, dormant20s: asleep, state, back, woke }, null, 1));
await app.close();
