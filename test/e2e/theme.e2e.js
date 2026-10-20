// Theme toggle and AM/PM scheduler in the real app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';

let tmp, app, ud;
const theme = () => app.eval('document.documentElement.dataset.theme');
const settings = () => app.eval('window.stet.invoke("settings:get")');
const click = (id) => app.eval(`(() => { const b = document.getElementById('${id}'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); })()`);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const refocus = () => app.eval('window.dispatchEvent(new Event("focus"))');

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-theme-'));
  ud = path.join(tmp, 'ud');
  app = await App.launch({ userData: ud });
});
after(async () => { if (app) await app.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('toggle lives in the status bar and shows the active theme', async () => {
  assert.equal(await app.eval('!!document.querySelector("#status #theme-seg")'), true);
  await click('th-light');
  assert.equal(await theme(), 'light');
  assert.equal(await app.eval('document.getElementById("th-light").classList.contains("on")'), true);
  await click('th-dark');
  assert.equal(await theme(), 'dark');
  assert.equal(await app.eval('document.getElementById("th-dark").classList.contains("on")'), true);
  await sleep(600);
  assert.equal((await settings()).theme, 'dark');
});

test('toolbar controls show pressed feedback synchronously at pointerdown', async () => {
  const pressed = await app.eval(`(() => { const b = document.querySelector('[data-t="action"]');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    const p = b.classList.contains('pressed'); dispatchEvent(new PointerEvent('pointerup')); return [p, b.classList.contains('pressed')]; })()`);
  assert.deepEqual(pressed, [true, false]);
});

test('AUTO applies the scheduled theme immediately; a manual pick turns it off', async () => {
  const now = new Date();
  // Dark window spans "now": dark from 1h ago until 1h from now.
  const sched = { enabled: false, darkAt: hhmm(new Date(+now - 3600e3)), lightAt: hhmm(new Date(+now + 3600e3)) };
  await click('th-light');
  await app.eval(`(async () => { const s = await window.stet.invoke('settings:set', { schedule: ${JSON.stringify(sched)} }); })()`);
  await app.eval(`__stet.settings().schedule = ${JSON.stringify(sched)}`);
  await click('th-auto');
  assert.equal(await theme(), 'dark', 'scheduled theme applied at once');
  assert.equal(await app.eval('document.getElementById("th-auto").classList.contains("on")'), true);
  await click('th-light');
  assert.equal(await theme(), 'light');
  await sleep(600);
  assert.equal((await settings()).schedule.enabled, false);
  // The poll / focus check must not undo the manual choice.
  await refocus();
  await sleep(50);
  assert.equal(await theme(), 'light');
});

test('a time-zone change moves the theme on the next check', async () => {
  const now = new Date();
  const sched = { enabled: true, darkAt: hhmm(new Date(+now + 5 * 3600e3)), lightAt: hhmm(new Date(+now + 9 * 3600e3)) };
  await app.eval(`__stet.settings().schedule = ${JSON.stringify(sched)}`);
  await app.eval(`window.stet.invoke('settings:set', { schedule: ${JSON.stringify(sched)} })`);
  await refocus();
  assert.equal(await theme(), 'light', 'outside the dark window locally');
  // Jump the local clock ~6h ahead via a different zone: now inside the window.
  const offsetZone = 'Etc/GMT' + (() => { const h = -Math.round((-now.getTimezoneOffset()) / 60 + 6); return h >= 0 ? '+' + h : String(h); })();
  await app.send('Emulation.setTimezoneOverride', { timezoneId: offsetZone });
  await refocus();
  assert.equal(await theme(), 'dark', 'switched after the zone change');
  await app.send('Emulation.setTimezoneOverride', { timezoneId: '' });
  await refocus();
  assert.equal(await theme(), 'light');
});

test('when AUTO turns the theme, the dinosaur sees the sun set or rise; a manual switch leaves it be', async () => {
  const now = new Date();
  const scene = () => app.eval('[__stet.dino.c.activity, __stet.dino.c.pending]');
  const fresh = () => app.eval(`(() => { const c = __stet.dino.c; c.queue = []; c.envDue = null; c.inReaction = null; c.paused = null; c.held = []; c.gen = null; c.pending = 'look'; })()`);
  await sleep(Math.max(0, 3200 - await app.eval('performance.now() - __stet.dino.born'))); // not in the first moments after launch
  await click('th-light');
  await fresh();
  await click('th-dark');
  await sleep(300);
  assert.ok(!(await scene()).includes('nightfall'), 'a manual switch: no sunset');
  await click('th-light');
  await fresh();
  const night = { enabled: true, darkAt: hhmm(new Date(+now - 60e3)), lightAt: hhmm(new Date(+now + 3600e3)) };
  await app.eval(`__stet.settings().schedule = ${JSON.stringify(night)}`);
  await refocus();
  assert.equal(await theme(), 'dark');
  let seen = false;
  for (let i = 0; i < 30 && !seen; i++) { await sleep(100); seen = await app.eval(`__stet.dino.c.activity === 'nightfall' && !!__stet.dino.c.find('sun')`); }
  assert.ok(seen, 'the sun goes down: ' + await scene());
  const day = { enabled: true, darkAt: hhmm(new Date(+now + 3600e3)), lightAt: hhmm(new Date(+now - 60e3)) };
  await app.eval(`__stet.settings().schedule = ${JSON.stringify(day)}`);
  await refocus();
  assert.equal(await theme(), 'light');
  seen = false;
  for (let i = 0; i < 30 && !seen; i++) { await sleep(100); seen = await app.eval(`__stet.dino.c.activity === 'daybreak'`); }
  assert.ok(seen, 'and comes up again: ' + await scene());
  await app.eval(`__stet.settings().schedule = { ...__stet.settings().schedule, enabled: false }`);
});

test('schedule persists across restarts and applies at launch', async () => {
  const now = new Date();
  const sched = { enabled: true, darkAt: hhmm(new Date(+now - 3600e3)), lightAt: hhmm(new Date(+now + 3600e3)) };
  await app.eval(`window.stet.invoke('settings:set', { theme: 'light', schedule: ${JSON.stringify(sched)} })`);
  await sleep(700);
  await app.close();
  app = await App.launch({ userData: ud });
  assert.equal(await theme(), 'dark');
  assert.equal(await app.eval('document.getElementById("th-auto").classList.contains("on")'), true);
  assert.equal((await settings()).theme, 'light', 'manual preference is kept for when AUTO is turned off');
  await click('th-auto'); // off -> manual preference returns
  assert.equal(await theme(), 'light');
});
