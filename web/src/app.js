// STET in the browser (ALPHA): the composition root, as src/renderer/app.js is on the desktop. The
// editor, page view, keyboard, menus and dialogs are the desktop's own files, imported read-only; what
// is here is what differs: files, cloud, the small screen. Nothing on the desktop depends on this folder.

import './shim.js';
import { Editor, pos } from '../../src/core/editor.js';
import { makeBlock, TYPES, TYPE_LABEL, STYLES, newDocument } from '../../src/core/model.js';
import { buildPrintPages } from '../../src/core/printmodel.js';
import { buildPdf } from '../../src/core/pdf.js';
import { View } from '../../src/renderer/view.js';
import { Input } from '../../src/renderer/input.js';
import * as cmd from '../../src/renderer/ui/commands.js';
import * as dlg from '../../src/renderer/ui/dialog.js';
import { styleIcon } from '../../src/renderer/ui/icons.js';
import { toJson, toBytes, fromBytes, baseName, fileName, keptAside } from './document.js';
import { keepDraft, dropDraft, listDrafts } from './drafts.js';
import { abilities, pickFile, pickSavePlace, handOver, HandlePlace, CopyPlace } from './device.js';
import { DriveClient, DrivePlace } from './drive.js';
import { Saver, stateText } from './saving.js';
import { fit } from './fit.js';
import { VERSION, driveConfigured } from './config.js';

const $ = (id) => document.getElementById(id);
const can = abilities();
const { h } = dlg;

// ---- the document ---------------------------------------------------------------------------------

const editor = new Editor([makeBlock('scene')]);
let doc = newDocument();
let name = 'Untitled';
let metaRev = 0;
const view = new View({ scroller: $('scroller'), content: $('content'), editor, doc });
const input = new Input({ textarea: $('input'), view, editor, onCommandKey: (e) => cmd.handleKey(e), onCommentClick: () => {} });

const saver = new Saver({
  rev: () => editor.rev + metaRev,
  read: () => toBytes(doc, editor.blocks),
  draft: keep,
  saved: () => dropDraft(doc.meta.id),
  onState: renderState,
  ask: async (place) => dlg.choose('CHANGED ELSEWHERE', `${place.name} was changed somewhere else since you opened it. Replace it with this version?`, [
    { label: 'Leave it', value: 'keep' }, { label: 'Replace it', value: 'overwrite' },
  ]),
});

let draftOk = true;
async function keep() {
  draftOk = await keepDraft({ id: doc.meta.id, name, json: toJson(doc, editor.blocks), place: rememberable(saver.place) });
  renderState();
}
// (only a device file's handle can be stored; Drive is found again by its id)
const rememberable = (p) => p?.remember?.() ?? null;

function load(next, title, place, { saved = true } = {}) {
  doc = next;
  name = baseName(title);
  metaRev = 0;
  editor.reset(doc.blocks);
  editor.autoCapitalize = doc.settings.autoCapitalize;
  view.doc = doc;
  view.pages = [];
  view.relayout();
  view.refreshTitleFields();
  view.activeComment = null;
  view.invalidate();
  view.stopGlide();
  view.scroller.scrollTop = 0;
  saver.opened(place, saved);
  placeSheet();
  renderScenes();
  renderTitle();
  input.focus();
}

let lastRev = editor.rev;
editor.onChange = () => {
  view.schedule();
  if (editor.rev !== lastRev) { lastRev = editor.rev; saver.changed(); renderScenes(); }
};
view.onFrame = renderStatus;
view.onTitleInput = () => { metaRev++; saver.changed(); };

/** True when the screenplay on screen may be replaced. */
async function mayLeave() {
  if (!saver.dirty) return true;
  await keep();
  if (saver.place?.inPlace && await saver.save()) return true;
  const v = await dlg.choose('UNSAVED SCREENPLAY', `Your changes to ${name} are kept in this browser only. Save a copy before going on?`, [
    { label: 'Cancel', value: null }, { label: 'Keep in browser', value: 'keep' }, { label: 'Save a copy', value: 'save', primary: true },
  ]);
  if (v === 'save') return saveAs();
  return v === 'keep';
}

async function openBytes(bytes, title, place) {
  try {
    const { doc: next, warnings, imported } = await fromBytes(bytes, title);
    load(next, title, imported ? null : place, { saved: !imported });
    const aside = keptAside(next);
    const said = [...(warnings || []), ...(aside.length ? [`This version keeps ${aside.join(', ')} safe in the file, but cannot show them yet.`] : [])];
    if (said.length) dlg.alertBox('OPENED', said.join(' '));
    return true;
  } catch (e) {
    dlg.alertBox('COULD NOT OPEN', e.message || 'This file could not be opened.');
    return false;
  }
}

async function openDevice() {
  if (!(await mayLeave())) return;
  try {
    const f = await pickFile();
    if (f) await openBytes(f.bytes, f.name, f.place);
  } catch (e) { dlg.alertBox('COULD NOT OPEN', e.message); }
}

async function save() {
  if (saver.place?.inPlace) {
    if (await saver.save({ force: false })) return true;
    if (saver.status === 'offline') { dlg.alertBox('NOT SAVED', `${saver.error?.message || 'It could not be saved.'} Your work is kept in this browser.`); }
    return false;
  }
  return saveAs();
}

async function saveAs() {
  const rev = saver.rev(), bytes = await toBytes(doc, editor.blocks), file = fileName(name);
  if (can.inPlace) {
    const place = await pickSavePlace(file);
    if (!place) return false;
    await place.write(bytes);
    name = baseName(place.name);
    saver.savedAs(place, rev);
  } else {
    const done = await handOver(bytes, file);
    if (!done) return false;
    saver.savedAs(new CopyPlace(file), rev);
  }
  await dropDraft(doc.meta.id);
  renderTitle();
  return true;
}

async function exportPdf() {
  try {
    const snapshot = { ...doc, blocks: editor.blocks };
    const { pages } = buildPrintPages(snapshot, {});
    const fonts = await Promise.all(['Regular', 'Bold', 'Italic', 'BoldItalic'].map(async (f) => new Uint8Array(await (await fetch(new URL(`../../src/fonts/STETCourier-${f}.ttf`, import.meta.url))).arrayBuffer())));
    const bytes = buildPdf(pages, { title: doc.titlePage.title || '', author: doc.titlePage.author || '', creator: `STET ${VERSION}`, fonts });
    await handOver(bytes, `${name}.pdf`, { type: 'application/pdf' });
  } catch (e) { dlg.alertBox('EXPORT FAILED', 'The PDF could not be made.', e.message); }
}

// ---- Google Drive ---------------------------------------------------------------------------------

/** Loaded on first use, so a writer who never asks for Drive never reaches Google. */
const google = () => import('./google.js');
let client = null;
async function driveClient() {
  if (!driveConfigured()) {
    dlg.alertBox('GOOGLE DRIVE', 'Google Drive is not connected on this site yet. Open and save through your device for now.');
    return null;
  }
  const g = await google();
  client ||= new DriveClient({ token: g.currentToken });
  return { client, g };
}

async function openDrive() {
  const d = await driveClient();
  if (!d || !(await mayLeave())) return;
  try {
    const picked = await d.g.pickDriveFile();
    if (!picked) return;
    const [bytes, meta] = await Promise.all([d.client.download(picked.id), d.client.meta(picked.id)]);
    await openBytes(bytes, meta.name, new DrivePlace(d.client, meta));
  } catch (e) { dlg.alertBox('GOOGLE DRIVE', e.message); }
}

async function saveToDrive() {
  const d = await driveClient();
  if (!d) return;
  try {
    await d.g.signIn();
    const rev = saver.rev(), made = await d.client.create(fileName(name), await toBytes(doc, editor.blocks));
    saver.savedAs(new DrivePlace(d.client, made), rev);
    await dropDraft(doc.meta.id);
    renderTitle();
  } catch (e) { dlg.alertBox('GOOGLE DRIVE', `${e.message} Your work is kept in this browser.`); }
}

/** After an hour Google's sign-in ends: the status button brings it back, and saving goes on. */
async function reconnect() {
  if (saver.status !== 'offline') return;
  if (saver.place?.kind === 'drive') { const g = await google(); await g.signIn(); }
  else if (saver.place?.kind === 'handle') await saver.place.allowed(true);
  saver.save();
}

// ---- commands -------------------------------------------------------------------------------------

const after = () => { input.after(); input.focus(); };
const typeCmds = TYPES.map((t, i) => ({ id: `type-${t}`, label: TYPE_LABEL[t], keys: `Ctrl+${i + 1}`, run: () => { editor.applyType(t); after(); } }));
const STYLE_LABEL = { b: 'Bold', i: 'Italic', u: 'Underline', s: 'Strikethrough' };
const styleCmds = STYLES.map((k) => ({ id: `style-${k}`, label: STYLE_LABEL[k], keys: { b: 'Ctrl+B', i: 'Ctrl+I', u: 'Ctrl+U' }[k], run: () => { editor.toggleStyle(k); after(); } }));

cmd.register([
  { id: 'new', label: 'New', run: async () => { if (await mayLeave()) load(newDocument(), 'Untitled', null); } },
  { id: 'open', label: can.apple ? 'Open from Files or iCloud Drive…' : 'Open…', keys: 'Ctrl+O', run: openDevice },
  { id: 'open-drive', label: 'Open from Google Drive…', run: openDrive },
  { id: 'save', label: 'Save', keys: 'Ctrl+S', run: save },
  { id: 'save-as', label: can.inPlace ? 'Save As…' : can.apple ? 'Save to Files or iCloud Drive…' : 'Download a Copy', keys: 'Ctrl+Shift+S', run: saveAs },
  { id: 'save-drive', label: 'Save to Google Drive', run: saveToDrive },
  { id: 'rename', label: 'Rename…', run: rename },
  { id: 'export-pdf', label: 'Export PDF', run: exportPdf },
  { id: 'undo', label: 'Undo', display: 'Ctrl+Z', run: () => { editor.undo(); after(); } },
  { id: 'redo', label: 'Redo', display: 'Ctrl+Y', run: () => { editor.redo(); after(); } },
  { id: 'select-all', label: 'Select All', display: 'Ctrl+A', run: () => { editor.selectAll(); after(); } },
  { id: 'next-type', label: 'Next Element', display: 'Tab', run: () => { editor.tab(false); after(); } },
  ...typeCmds, ...styleCmds,
  { id: 'scenes', label: () => ($('left').hidden ? 'Show Scenes' : 'Hide Scenes'), keys: 'Ctrl+\\', run: () => { $('left').hidden = !$('left').hidden; renderScenes(); placeSheet(); } },
  { id: 'theme', label: () => (theme() === 'dark' ? 'Light Mode' : 'Dark Mode'), run: () => setTheme(theme() === 'dark' ? 'light' : 'dark') },
  { id: 'about', label: 'About This Alpha', run: about },
  { id: 'desktop', label: 'Get the Desktop App', run: () => window.open('https://github.com/mediocrecode56/stet-screenwriter/releases/latest', '_blank', 'noopener') },
]);
cmd.buildMenubar($('menubar'), [
  { label: 'File', items: ['new', 'open', 'open-drive', '-', 'save', 'save-as', 'save-drive', 'rename', '-', 'export-pdf'] },
  { label: 'Edit', items: ['undo', 'redo', '-', 'select-all'] },
  { label: 'View', items: () => ['scenes', 'theme'] },
  { label: 'Help', items: ['about', 'desktop'] },
]);

// Global shortcuts when the keyboard is somewhere else (a title page field).
window.addEventListener('keydown', (e) => {
  if (e.target === $('input') || dlg.isOpen() || (!e.ctrlKey && !e.metaKey)) return;
  const r = cmd.resolve(e);
  if (r?.cmd && ['save', 'save-as', 'open'].includes(r.cmd.id)) { e.preventDefault(); cmd.run(r.cmd.id); }
});

async function rename() {
  const v = await dlg.prompt('RENAME', 'Name', name);
  if (!v || !v.trim()) return;
  name = baseName(v.trim());
  if (!saver.place?.inPlace) saver.place = saver.place && new CopyPlace(fileName(name));
  renderTitle();
}

function about() {
  dlg.open({
    title: `STET ${VERSION}`,
    body: h('div', { class: 'body' },
      h('p', {}, 'An early browser version of STET, for writing away from your own computer. Keep backups of your work.'),
      h('p', { class: 'hint' }, 'Your screenplay stays in your browser and the place you save it. Notes, Revise, spelling, the timeline and statistics are in the desktop app only for now.')),
    buttons: [{ label: 'Close', value: null, primary: true }],
  });
}

// ---- the bars -------------------------------------------------------------------------------------

const press = (el, fn) => el.addEventListener('mousedown', (e) => { e.preventDefault(); if (e.button === 0) fn(); });
for (const [i, t] of TYPES.entries()) {
  const b = h('button', { class: 'tb', 'data-t': t, title: `${TYPE_LABEL[t]} (Ctrl+${i + 1})` }, t === 'character' ? 'CHARACTER' : t === 'dialogue' ? 'DIALOGUE' : t === 'transition' ? 'TRANS' : t.toUpperCase());
  press(b, () => cmd.run(`type-${t}`));
  $('eltypes').appendChild(b);
}
for (const k of STYLES) {
  const b = h('button', { class: 'tb sq st', 'data-s': k, title: STYLE_LABEL[k], html: styleIcon(k) });
  press(b, () => cmd.run(`style-${k}`));
  $('stbar').appendChild(b);
}
for (const [id, c] of [['w-tab', 'next-type'], ['w-undo', 'undo'], ['w-redo', 'redo']]) press($(id), () => cmd.run(c));
$('st-save').addEventListener('click', reconnect);

function renderTitle() {
  $('doctitle').textContent = name;
  document.title = `${name} · STET`;
}

function renderState() {
  const el = $('st-save');
  el.textContent = !draftOk && saver.dirty ? 'NOT PROTECTED: SAVE A COPY' : stateText(saver);
  el.classList.toggle('warn', saver.status === 'offline' || saver.status === 'conflict' || !draftOk);
  el.title = saver.status === 'offline' ? 'Click to try again' : '';
  $('docdot').classList.toggle('dirty', saver.dirty);
}

let statusKey = '';
function renderStatus() {
  const b = editor.block;
  if (!b) return;
  const page = (view.caretPage?.() ?? 0) + 1;
  const styles = STYLES.filter((k) => editor.styleActive(k)).join('');
  const key = `${b.type}|${page}|${view.pages.length}|${editor.words}|${styles}`;
  if (key === statusKey) return;
  statusKey = key;
  $('st-el').textContent = TYPE_LABEL[b.type].toUpperCase();
  $('st-page').textContent = `${view.pages.length} PAGES`;
  $('st-words').textContent = `${editor.words.toLocaleString()} WORDS`;
  for (const btn of $('eltypes').children) btn.classList.toggle('on', btn.dataset.t === b.type);
  for (const btn of $('stbar').children) btn.classList.toggle('on', styles.includes(btn.dataset.s));
}

function renderScenes() {
  if ($('left').hidden) return;
  $('scenes').replaceChildren(...editor.scenes().map((s, i) => {
    const row = h('div', { class: 'w-scene' }, h('span', { class: 'w-n' }, String(i + 1)), s.text || 'UNTITLED SCENE');
    press(row, () => {
      editor.setSel(pos(s.b, 0));
      view.revealCaret(true);
      after();
      if (innerWidth < 760) { $('left').hidden = true; placeSheet(); }
    });
    return row;
  }));
}

// ---- the screen -----------------------------------------------------------------------------------

const theme = () => document.documentElement.dataset.theme;
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('stet-theme', t); } catch { /* a remembered choice is only a convenience */ }
}
{
  let t = null;
  try { t = localStorage.getItem('stet-theme'); } catch { /* as above */ }
  setTheme(t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
}

/** The sheet fitted to the screen, and the page kept above an on-screen keyboard. */
function placeSheet() {
  const vv = window.visualViewport;
  document.documentElement.style.setProperty('--app-h', `${Math.round(vv ? vv.height : innerHeight)}px`);
  const { z, left } = fit(view.scroller.clientWidth);
  if (Math.abs(view.z - z) > 0.001) view.setZoom(z);
  view.layoutDirty = true;
  view.frame();
  view.scroller.scrollLeft = left;
  input.after(!!vv && vv.height < innerHeight - 100); // (the caret kept in view above an on-screen keyboard)
}
addEventListener('resize', placeSheet);
window.visualViewport?.addEventListener('resize', placeSheet);

// On-screen keyboards send no usable key codes: Enter and Backspace arrive as what they would do.
$('input').addEventListener('beforeinput', (e) => {
  const ta = e.target;
  if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); editor.enter(); input.after(); }
  else if (e.inputType === 'deleteContentBackward' && !ta.value) { e.preventDefault(); editor.backspace(); input.after(); }
});

// A file dropped on the window.
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f || !(await mayLeave())) return;
  const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
  const handle = await item?.getAsFileSystemHandle?.().catch(() => null);
  await openBytes(new Uint8Array(await f.arrayBuffer()), f.name, handle?.kind === 'file' && /\.stet$/i.test(f.name) ? new HandlePlace(handle, f.lastModified) : new CopyPlace(f.name));
});

addEventListener('beforeunload', (e) => { if (saver.dirty) { keep(); e.preventDefault(); } });
// A phone gives no warning before it closes a tab: leaving the page is the last moment to keep a draft.
document.addEventListener('visibilitychange', () => { if (document.hidden && saver.dirty) keep(); });

// ---- starting -------------------------------------------------------------------------------------

/** A draft left unsaved by the last visit: offered back, never thrown away unasked. */
async function offerDraft() {
  const [draft] = await listDrafts();
  if (!draft) return;
  const when = new Date(draft.when).toLocaleString();
  const v = await dlg.choose('UNSAVED WORK FOUND', `${draft.name}, from ${when}, was not saved to its file. Bring it back?`, [
    { label: 'Discard', value: 'discard' }, { label: 'Bring it back', value: 'restore', primary: true },
  ]);
  if (v === 'discard') return dropDraft(draft.id);
  if (v !== 'restore') return;
  const { deserialize } = await import('../../src/core/serialize.js');
  const place = draft.place?.kind === 'handle' ? new HandlePlace(draft.place.handle) : null;
  load(deserialize(draft.json).doc, draft.name, place, { saved: false });
}

load(doc, 'Untitled', null);
await document.fonts?.ready;
placeSheet();
if (location.hash === '#test') window.__stet = { editor, view, input, saver, cmd, dlg, openBytes, toBytes: () => toBytes(doc, editor.blocks), get doc() { return doc; } };
await offerDraft();
