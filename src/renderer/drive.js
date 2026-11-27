// Google Drive in the window: the File menu's section, the cloud in the status bar, the one-line offer
// when the open screenplay changed in Drive on another computer, and Open from Google Drive. The main
// process does the work (main/drive.js); this only shows it and passes the writer's choices on.
//
// Each screenplay can be left out (File > Stop Syncing This Screenplay): `doc.drive === false`, kept in
// the file, so the choice goes wherever the file goes. Everything else is synced once Drive is connected.

import * as dlg from './ui/dialog.js';
import { h } from './ui/dialog.js';
import { arrive, leave, DUR_FAST } from './ui/motion.js';
import { CLOUD } from './ui/icons.js';
import { ago } from '../core/when.js';

const STATE_TEXT = {
  waiting: 'Google Drive: changes go up in a moment',
  syncing: 'Google Drive: sending…',
  synced: 'In Google Drive',
  offline: 'Google Drive can’t be reached: STET keeps trying, and everything is saved on this computer',
  conflict: 'Changed in Google Drive on another computer',
  error: 'Google Drive: not sent',
};

export class DriveUI {
  constructor({ api, session, el, openPath, backup, reload, notify }) {
    Object.assign(this, { api, session, el, openPath, backup, reload, notify });
    this.account = { configured: false, signedIn: false, email: '' };
    this.state = null;  // { path, state, at, message } for the open screenplay
    this.path = null;   // the path the main process was last told is open
    this.offerEl = null;
    api.on('drive:account', (a) => this.onAccount(a));
    api.on('drive:state', (s) => { if (s.path === this.session.path) { this.state = s; this.paint(); } });
    api.on('drive:remote', (m) => this.onRemote(m));
  }

  async init() { this.account = await this.api.invoke('drive:status'); this.paint(); }

  get connected() { return !!this.account.signedIn; }
  /** This screenplay is synced (unless the writer left it out). */
  get syncing() { return !(this.session.doc && this.session.doc.drive === false); }

  // ---- the open screenplay -----------------------------------------------------------------

  /** A screenplay was opened, or saved under a new path: the main process told, the cloud redrawn. */
  async opened() {
    const p = this.session.path;
    this.path = p;
    if (this.offerEl && this.offerEl.dataset.path !== p) this.closeOffer();
    this.state = p ? { path: p, ...(await this.api.invoke('drive:opened', { path: p, sync: this.syncing })) } : null;
    this.paint();
  }

  /** The session's state changed (a save under a new name changes the path). */
  sessionChanged() { if (this.session.path !== this.path) this.opened(); }

  onAccount(a) {
    const was = this.connected;
    this.account = a;
    if (a.lost && was) this.notify('Google Drive is disconnected: its sign-in ended. Connect it again from the File menu; everything stays saved on this computer.');
    if (a.signedIn && !was) this.opened();
    if (!a.signedIn) { this.state = null; this.closeOffer(); }
    this.paint();
  }

  /** The cloud in the status bar: there while Drive is connected and this screenplay is in it (or on its way). */
  paint() {
    const el = this.el, s = this.state;
    const show = this.connected && !!this.session.path && this.syncing && s && s.state !== 'off';
    el.hidden = !show;
    if (!show) return;
    const st = s.state || 'waiting';
    el.className = 'st drive-st d-' + st;
    el.innerHTML = CLOUD + (st === 'offline' || st === 'error' || st === 'conflict' ? '<span class="d-bang">!</span>' : '');
    el.title = (STATE_TEXT[st] || STATE_TEXT.synced) + (st === 'synced' && s.at ? ` · ${ago(s.at)}` : '') + (st === 'error' && s.message ? `: ${s.message}` : '') + (this.account.email ? ` (${this.account.email})` : '');
  }

  // ---- changed in Drive elsewhere: the offer ---------------------------------------------------

  onRemote(m) {
    if (m.path !== this.session.path) return;
    this.closeOffer(false);
    const name = this.session.name;
    const el = this.offerEl = h('div', { class: 'offer drive-offer', role: 'status', 'data-path': m.path },
      h('span', { class: 'offer-t' }, m.conflict ? `“${name}” changed in Google Drive on another computer, and here too.` : `“${name}” changed in Google Drive on another computer.`),
      h('button', { class: 'tb primary', 'data-o': 'pull', title: 'Open the version from Google Drive (this one is kept in Backups first)' }, 'OPEN THAT VERSION'),
      h('button', { class: 'tb', 'data-o': 'keep', title: 'Keep this version: it goes to Google Drive, which keeps the other in its version history' }, 'KEEP THIS ONE'));
    el.addEventListener('mousedown', (e) => e.preventDefault()); // the script keeps the keyboard
    el.addEventListener('click', (e) => {
      const o = e.target.closest('[data-o]')?.dataset.o;
      if (!o) return;
      this.closeOffer();
      if (o === 'pull') this.pull(m.path); else this.keep(m.path);
    });
    document.body.appendChild(el);
    arrive(el, { dist: -3, dur: DUR_FAST * 2 });
  }

  closeOffer(animated = true) {
    const el = this.offerEl;
    if (!el) return;
    this.offerEl = null;
    if (animated) leave(el, () => el.remove(), { dist: -3 }); else el.remove();
  }

  async pull(path) {
    if (path !== this.session.path) return;
    await this.backup(); // (this version, kept in Backups before the other replaces it)
    const r = await this.api.invoke('drive:pull', path);
    if (!r.ok) { dlg.alertBox('GOOGLE DRIVE', 'The version in Google Drive could not be opened. This one stays as it is.', r.error); return; }
    await this.reload(path);
  }

  async keep(path) {
    if (this.session.dirty) await this.session.flushAll();
    this.state = { path, ...(await this.api.invoke('drive:keep', path)) };
    this.paint();
  }

  // ---- the File menu ---------------------------------------------------------------------------

  /** File > Connect Google Drive…: the browser sign-in, with a window that waits for it (and can stop it). */
  async connect() {
    if (!this.account.configured) {
      await dlg.alertBox('GOOGLE DRIVE', 'Google Drive is not set up in this copy of STET yet.');
      return;
    }
    let close = null;
    const waiting = dlg.open({
      title: 'GOOGLE DRIVE', sub: 'signing in',
      body: h('div', { class: 'body', style: 'max-width:480px' },
        h('p', {}, 'Sign in to Google in your browser, then come back here.'),
        h('p', { class: 'hint' }, 'STET only sees the screenplays it puts in a STET folder in your Drive, nothing else. Each one stays saved on this computer as well.')),
      buttons: [{ label: 'Cancel', value: 'cancel' }],
      init: (_d, c) => { close = c; },
    }).then((v) => { if (v === 'cancel') this.api.invoke('drive:cancel'); });
    const r = await this.api.invoke('drive:connect');
    if (close) close(null);
    await waiting;
    if (r.ok) {
      this.account = await this.api.invoke('drive:status');
      await this.opened();
      this.notify(`Google Drive connected (${r.email}). Your screenplays are kept in its STET folder as you open and save them.`);
    } else if (!r.cancelled) {
      dlg.alertBox('GOOGLE DRIVE', 'Google Drive was not connected.', r.error);
    }
  }

  async disconnect() {
    if (!(await dlg.confirm('DISCONNECT GOOGLE DRIVE', `Stop syncing with ${this.account.email || 'Google Drive'}? Your screenplays stay on this computer and in Drive.`, 'Disconnect'))) return;
    await this.api.invoke('drive:disconnect');
    this.account = await this.api.invoke('drive:status');
    this.state = null;
    this.paint();
  }

  /** Turn syncing on or off for this screenplay (kept in the file). */
  toggle() {
    const doc = this.session.doc;
    if (!doc) return;
    const on = !this.syncing;
    if (on) delete doc.drive; else doc.drive = false;
    this.session.touch();
    if (this.session.path) this.api.invoke('drive:sync', { path: this.session.path, on }).then(() => this.opened());
    this.paint();
    this.notify(on ? 'This screenplay is synced with Google Drive again.' : 'This screenplay is no longer synced. The copy already in Google Drive stays there.');
  }

  folder() { return this.api.invoke('drive:folder'); }

  /** File > Open from Google Drive…: the screenplays in the STET folder; one picked is downloaded into
   *  the screenplays folder on this computer (or simply opened, if it is already here) and opened. */
  async openFromDrive() {
    const r = await this.api.invoke('drive:list');
    if (!r.ok) { dlg.alertBox('GOOGLE DRIVE', 'The STET folder in Google Drive could not be read.', r.error); return; }
    let chosen = null, openBtn = null;
    const tbody = h('tbody');
    const render = () => {
      tbody.replaceChildren(...r.files.map((f) => {
        const tr = h('tr', { class: 'pick recent-row' + (f.id === chosen ? ' on' : '') },
          h('td', { class: 'rc-name', title: f.name }, f.name),
          h('td', { class: 'hint rc-path' }, f.here ? 'on this computer too' : ''),
          h('td', { class: 'rc-time', title: new Date(f.modified).toLocaleString() }, ago(Date.parse(f.modified))));
        tr.addEventListener('click', () => { chosen = f.id; render(); });
        tr.addEventListener('dblclick', () => { chosen = f.id; openBtn?.click(); });
        return tr;
      }));
      if (openBtn) openBtn.disabled = !chosen;
    };
    render();
    const body = h('div', { class: 'body recent' }, r.files.length
      ? h('table', { class: 't recent-t' }, h('colgroup', {}, h('col', { class: 'c-name' }), h('col', {}), h('col', { class: 'c-time' })), tbody)
      : h('div', { class: 'empty' }, 'No screenplays in Google Drive yet.'));
    const id = await dlg.open({
      title: 'OPEN FROM GOOGLE DRIVE', sub: this.account.email || '', body, cls: 'recent-dlg',
      buttons: [{ label: 'Cancel', value: null }, { label: 'Open', value: () => chosen, primary: true, disabled: true }],
      init: (_d, _c, btns) => { openBtn = btns[1]; },
    });
    if (!id) return;
    const got = await this.api.invoke('drive:download', id);
    if (!got.ok) { dlg.alertBox('GOOGLE DRIVE', 'That screenplay could not be opened from Google Drive.', got.error); return; }
    await this.openPath(got.path);
  }
}
