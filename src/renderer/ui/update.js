// In-app updates: the check when STET starts, the UPDATE button in the status bar, and
// the download → restart flow. The work happens in the main process (src/main/update.js);
// this is the interface. One update at a time. Closing the progress window doesn't stop
// the download: the status bar shows how far it has got, and STET asks to restart once
// the new version is ready. Before restarting, everything is saved as when closing.

import { open, h, isOpen } from './dialog.js';
import { mdToHtml } from './dialogs.js';

const mb = (n) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0);
const p = (text, cls) => h('p', { class: cls || null }, text);
const body = (...kids) => h('div', { class: 'body upd' }, ...kids);

/**
 * api: the preload bridge; button: the status-bar button; getSettings / saveSettings(patch);
 * prepareQuit(): saves everything as when closing, resolves false if the person cancelled.
 */
export function initUpdates({ api, button, getSettings, saveSettings, prepareQuit }) {
  let found = null;       // the newest release found: { version, current, notes, kind }
  let state = 'idle';     // idle | available | downloading | ready | installing
  let progress = { received: 0, total: 0 };
  let paint = null;       // redraws the progress window while it is open
  let closeProgress = null;
  let downloading = null;

  api.on('update:progress', (pr) => { progress = pr; renderButton(); if (paint) paint(); });
  button.addEventListener('click', () => show());

  function renderButton() {
    button.hidden = state === 'idle' || !found;
    if (button.hidden) return;
    const pct = progress.total ? Math.floor((progress.received / progress.total) * 100) : 0;
    button.textContent = state === 'downloading' ? `UPDATING ${pct}%` : state === 'available' ? `UPDATE ${found.version}` : 'RESTART TO UPDATE';
    button.title = state === 'downloading' ? `Downloading STET ${found.version}` : state === 'available' ? `STET ${found.version} is available` : `STET ${found.version} is ready to install`;
  }

  function show() {
    if (state === 'available') return offer();
    if (state === 'downloading') return progressWindow();
    if (state === 'ready') return restartPrompt();
  }

  const openPage = () => api.invoke('app:open-url', 'releases');

  /** manual: from Help → Check for Updates (says what it found); otherwise quiet unless there is news. */
  async function check(manual) {
    if (state === 'downloading' || state === 'installing') return show();
    // A version already downloaded doesn't end the search: a newer one may have come out since.
    let closeChecking = null, dismissed = false;
    if (manual) {
      open({
        title: 'UPDATES', body: body(p('Checking for a new version…'), h('div', { class: 'upd-bar indet' }, h('i'))),
        buttons: [{ label: 'Cancel', value: null }], init: (_d, close) => { closeChecking = close; },
      }).then((v) => { if (v !== 'done') dismissed = true; });
    }
    const r = await api.invoke('update:check');
    if (manual) { if (dismissed) return; closeChecking('done'); }
    if (r.status === 'available') {
      if (state === 'ready' && r.version === found.version) return manual ? show() : undefined;
      found = r;
      state = r.ready ? 'ready' : 'available';
      renderButton();
      if (manual) return show();
      // The first time a version is found, say so once; afterwards the status bar button is enough.
      if (getSettings().updateNotified !== r.version && !isOpen()) {
        saveSettings({ updateNotified: r.version });
        return show();
      }
      return;
    }
    if (!manual) return;
    if (state === 'ready') return show();
    if (r.status === 'current') {
      return open({ title: 'UPDATES', body: body(p(`STET ${r.version} is up to date.`)), buttons: [{ label: 'OK', value: null, primary: true }] });
    }
    const v = await open({
      title: 'UPDATES', body: body(p("Couldn't check for updates."), p(r.message, 'hint')),
      buttons: [{ label: 'Close', value: null }, { label: 'Open download page', value: 'page', primary: true }],
    });
    if (v === 'page') openPage();
  }

  async function offer() {
    const r = found, manual = r.kind === 'manual';
    const v = await open({
      title: 'UPDATE', sub: 'v' + r.version,
      body: body(
        p(`STET ${r.version} is available. You have ${r.current}.`),
        r.notes ? h('div', { class: 'md upd-notes', html: mdToHtml(r.notes) }) : null,
        p(manual ? 'This copy of STET updates from the website.' : `${r.size ? `A ${mb(r.size)} MB download. ` : ''}Your screenplays, settings and statistics stay as they are.`, 'hint'),
      ),
      buttons: [{ label: 'Later', value: null }, manual ? { label: 'Open download page', value: 'page', primary: true } : { label: 'Update now', value: 'update', primary: true }],
    });
    if (v === 'page') openPage();
    if (v === 'update') { startDownload(); progressWindow(); }
  }

  function startDownload() {
    if (downloading) return;
    state = 'downloading';
    progress = { received: 0, total: 0 };
    renderButton();
    downloading = api.invoke('update:download').then(async (res) => {
      downloading = null;
      if (closeProgress) closeProgress('done');
      if (res.ok) {
        state = 'ready';
        renderButton();
        if (!isOpen()) restartPrompt();
        return;
      }
      state = 'available';
      renderButton();
      if (res.cancelled) return;
      const v = await open({
        title: 'UPDATE', body: body(p("The update couldn't be downloaded."), p(res.error, 'hint')),
        buttons: [{ label: 'Close', value: null }, { label: 'Try again', value: 'retry', primary: true }],
      });
      if (v === 'retry') { startDownload(); progressWindow(); }
    });
  }

  function progressWindow() {
    const bar = h('i'), amount = h('span', { class: 'upd-amt' }), stage = h('span', {}, 'Downloading…');
    paint = () => {
      const { received, total } = progress;
      bar.style.width = total ? ((received / total) * 100).toFixed(1) + '%' : '0';
      amount.textContent = total ? `${mb(received)} of ${mb(total)} MB` : '';
      if (total && received >= total) stage.textContent = 'Checking the download…';
    };
    open({
      title: 'UPDATE', sub: 'v' + found.version,
      body: body(h('div', { class: 'upd-stage' }, stage, amount), h('div', { class: 'upd-bar' }, bar),
        p('You can keep writing. Hide this and the download carries on.', 'hint')),
      buttons: [{ label: 'Cancel update', value: 'cancel' }, { label: 'Hide', value: null, primary: true }],
      init: (_d, close) => { closeProgress = close; },
    }).then((v) => {
      paint = null;
      closeProgress = null;
      if (v === 'cancel') api.invoke('update:cancel');
    });
    paint();
  }

  async function restartPrompt() {
    const how = found.kind === 'installer' ? 'STET closes, updates and opens again by itself.' : 'STET restarts with the new version.';
    const v = await open({
      title: 'UPDATE', sub: 'v' + found.version,
      body: body(p(`STET ${found.version} is ready.`), p(how + ' Your work is saved first.', 'hint')),
      buttons: [{ label: 'Later', value: null }, { label: 'Restart now', value: 'go', primary: true }],
    });
    if (v !== 'go') return;
    state = 'installing';
    if (!(await prepareQuit())) { state = 'ready'; renderButton(); return; }
    open({ title: 'UPDATE', sub: 'v' + found.version, body: body(p(found.kind === 'installer' ? 'Updating… STET opens again in a moment.' : 'Restarting…')), buttons: [] });
    const res = await api.invoke('update:install');
    if (res.ok) return; // STET quits now
    state = 'ready';
    renderButton();
    const w = await open({
      title: 'UPDATE', body: body(p("The update couldn't be installed."), p(res.error, 'hint')),
      buttons: [{ label: 'Close', value: null }, { label: 'Open download page', value: 'page', primary: true }],
    });
    if (w === 'page') openPage();
  }

  return { check, get state() { return state; } };
}
