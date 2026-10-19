// Composition root: builds the editor, view and session and wires them to
// the UI. Document logic lives in ../core, persistence in ./session.js.

import { Editor, pos } from '../core/editor.js';
import { makeBlock, TYPES, TYPE_LABEL, HIGHLIGHT_COLORS, newDocument, uuid } from '../core/model.js';
import { Tracker } from '../core/stats.js';
import { buildPrintPages } from '../core/printmodel.js';
import { printHTML } from '../core/printhtml.js';
import { View } from './view.js';
import { Input } from './input.js';
import { Session } from './session.js';
import { Autocomplete } from './ui/autocomplete.js';
import { ScenePanel, NotesPanel } from './ui/panels.js';
import { FindBar } from './ui/find.js';
import * as cmd from './ui/commands.js';
import * as dlg from './ui/dialog.js';
import * as dialogs from './ui/dialogs.js';
import { runPerfProbe } from './perf.js';
import { Revision, keyDialog, dictionaryDialog } from './revision.js';
import { effectiveTheme, label as timeLabel, DEFAULT_SCHEDULE } from '../core/schedule.js';

const api = window.stet;
const $ = (id) => document.getElementById(id);

const info = await api.invoke('app:info');
let settings = await api.invoke('settings:get');
$('ver').textContent = `${info.version} β`;

// ---- core objects -------------------------------------------------------------

const editor = new Editor([makeBlock('scene')]);
const placeholderDoc = newDocument();
const view = new View({ scroller: $('scroller'), content: $('content'), editor, doc: placeholderDoc });
const ac = new Autocomplete($('ac'), editor, view);
const session = new Session({ editor, appVersion: info.version, onState: renderSaveState, onLoaded: onDocLoaded });
const tracker = new Tracker(await api.invoke('stats:get'));

const input = new Input({
  textarea: $('input'), view, editor, autocomplete: ac,
  onCommandKey: (e) => cmd.handleKey(e),
  onCommentClick: (id) => openNote(id, true),
});
input.onEscape = () => { if (!find.open) return false; find.close(); return true; };
input.onZoom = () => { renderZoom(); persistZoom(); };
ac.onAccepted = () => input.after(false);

const jump = (p, center = false, end = null) => {
  editor.setSel(p, end || p);
  view.relayout();
  view.frame();
  view.revealCaret(center);
  input.focus();
  input.placeTextarea();
};

const scenes = new ScenePanel($('left'), $('scenes'), $('scene-count'), { editor, view, jump });
const notes = new NotesPanel($('right'), $('notes'), $('note-count'), { editor, view, session, jump, onChange: () => session.touch() });
const find = new FindBar({ editor, view, jump, focusEditor: () => input.focus() });

const revision = new Revision({
  host: $('rev'), editor, view, session, jump,
  getSettings: () => settings,
  setSettings: async (patch) => { settings = await api.invoke('settings:set', patch); },
  onShow: (on) => { $('btn-rev').classList.toggle('on', on); view.layoutDirty = true; view.schedule(); },
});

view.onTitleInput = () => session.touch();
view.showTitle = settings.showTitlePage !== false;

// ---- change propagation ----------------------------------------------------------

let lastRev = -1;
editor.onChange = () => {
  view.schedule();
  if (editor.rev !== lastRev) {
    lastRev = editor.rev;
    session.changed();
    scheduleStats();
    scenes.refresh();
    notes.refresh();
    if (find.open) find.schedule();
    revision.documentChanged();
  }
  // Caret inside commented text makes that note current.
  const b = editor.block;
  {
    const o = editor.caret.o;
    const m = b && b.marks.find((x) => x.k === 'cm' && o >= x.s && o <= x.e);
    const id = m ? m.v : null;
    if (id && id !== view.activeComment) { view.activeComment = id; notes.markCurrent(); }
  }
  if (scenes.visible) scenes.refresh();
};

view.onFrame = () => renderStatus();

function onDocLoaded(s) {
  view.doc = s.doc;
  view.pages = [];
  view.relayout();
  view.refreshTitleFields();
  view.activeComment = null;
  view.invalidate();
  view.scroller.scrollTop = 0;
  tracker.begin(s.doc.meta.id, editor.words);
  lastRev = editor.rev;
  editor.pastedWords = 0;
  scenes.lastKey = ''; notes.lastKey = '';
  revision.reset();
  scenes.refresh(); notes.refresh(true);
  renderTitle();
  if (find.open) find.search(true);
  // Start writing on the first script page, not the title page.
  editor.setSel(pos(0, 0));
  requestAnimationFrame(() => { view.scrollToPage(0); view.frame(); input.focus(); input.placeTextarea(); });
}

// ---- statistics --------------------------------------------------------------------

let statsTimer = 0, statsSaveTimer = 0;
function scheduleStats() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = 0;
    if (!session.doc) return;
    tracker.update(session.doc.meta.id, editor.words, editor.pastedWords);
    editor.pastedWords = 0;
    renderGoal();
    if (tracker.changed) {
      clearTimeout(statsSaveTimer);
      statsSaveTimer = setTimeout(() => { tracker.changed = false; api.invoke('stats:set', tracker.data); }, 4000);
    }
  }, 1500);
}

// ---- status & chrome ------------------------------------------------------------------

let statusKey = '';
function renderStatus() {
  const p = editor.caret;
  const b = editor.block;
  const page = view.currentPage() + 1;
  let scene = 0;
  // Scene index of the caret: count scene blocks up to caret (cheap: cached per rev+block).
  if (renderStatus._k !== editor.rev + ':' + p.b) {
    renderStatus._k = editor.rev + ':' + p.b;
    let n = 0;
    for (let i = 0; i <= p.b && i < editor.blocks.length; i++) if (editor.blocks[i].type === 'scene') n++;
    renderStatus._scene = n;
  }
  scene = renderStatus._scene;
  const key = `${b.type}|${page}|${view.pages.length}|${scene}|${editor.words}`;
  if (key !== statusKey) {
    statusKey = key;
    $('st-el').textContent = TYPE_LABEL[b.type].toUpperCase();
    $('st-page').textContent = `PAGE ${page} / ${view.pages.length}`;
    $('st-scene').textContent = scene ? `SCENE ${scene}` : 'NO SCENE';
    $('st-words').textContent = `${editor.words.toLocaleString()} WORDS`;
    for (const btn of $('eltypes').children) btn.classList.toggle('on', btn.dataset.t === b.type);
  }
}

function renderGoal() {
  const s = tracker.summary(settings.goals, 7);
  const pct = s.dailyGoal ? Math.min(100, (s.today / s.dailyGoal) * 100) : 0;
  const el = $('st-goal');
  el.innerHTML = `TODAY ${s.today.toLocaleString()}${s.dailyGoal ? ' / ' + s.dailyGoal.toLocaleString() : ''} <span class="meter"><i style="width:${pct}%"></i></span>`;
  el.title = `Today: ${s.today} words (${s.todayDelta >= 0 ? 'goal met' : -s.todayDelta + ' to go'}). Week: ${s.week}/${s.weeklyGoal} (${s.weekDelta >= 0 ? s.weekDelta + ' ahead' : -s.weekDelta + ' behind'} of pace). Click for statistics.`;
}

function renderSaveState(s) {
  const el = $('st-save');
  const dot = $('docdot');
  el.classList.remove('err');
  dot.className = '';
  let t;
  switch (s.status) {
    case 'saving': t = 'SAVING…'; dot.className = 'dirty'; break;
    case 'dirty': t = s.path ? (settings.autosave ? 'EDITED' : 'UNSAVED · CTRL+S') : 'NOT SAVED · CTRL+S'; dot.className = 'dirty'; break;
    case 'error': t = 'SAVE FAILED · RETRYING · RECOVERY COPY KEPT'; el.classList.add('err'); dot.className = 'error'; el.title = s.error || ''; break;
    case 'conflict': t = 'FILE CHANGED ON DISK · CTRL+S TO RESOLVE'; el.classList.add('err'); dot.className = 'error'; el.title = s.error || ''; break;
    default: t = s.lastSavedAt ? 'SAVED ' + s.lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : (s.path ? 'SAVED' : 'NEW');
  }
  if (!s.path && s.status === 'saved') t = 'NEW · NOT YET SAVED';
  el.textContent = t;
  renderTitle();
}

function renderTitle() {
  const name = session.path ? session.name : (session.doc && session.doc.titlePage.title) || 'Untitled';
  $('doctitle').textContent = session.path ? `${name}  —  ${session.path}` : `${name}  —  not saved`;
  document.title = `${session.dirty ? '• ' : ''}${name} — STET`;
}

function renderZoom() { $('zoom-val').textContent = Math.round(view.z * 100) + '%'; }
let zoomTimer = 0;
function persistZoom() { clearTimeout(zoomTimer); zoomTimer = setTimeout(() => api.invoke('settings:set', { zoom: view.z }), 500); }

// ---- theme: manual choice or AM/PM schedule ----------------------------------------
// The schedule only ever decides while it is enabled; picking LIGHT or DARK
// switches it off, so the clock never overrides a manual choice.

const systemDark = matchMedia('(prefers-color-scheme: dark)');
function schedule() { return { ...DEFAULT_SCHEDULE, ...(settings.schedule || {}) }; }

/** Show whatever theme the settings call for right now (cheap; safe to poll). */
function refreshTheme() {
  const t = effectiveTheme({ ...settings, schedule: schedule() }, new Date(), systemDark.matches);
  if (document.documentElement.dataset.theme !== t) {
    document.documentElement.dataset.theme = t;
    api.invoke('theme:apply', t);
  }
  renderThemeSeg(t);
}

function setManualTheme(theme) {
  settings.theme = theme;
  settings.schedule = { ...schedule(), enabled: false };
  refreshTheme();
  api.invoke('settings:set', { theme, schedule: settings.schedule });
}

function setAutoTheme(on) {
  settings.schedule = { ...schedule(), enabled: on };
  refreshTheme();
  api.invoke('settings:set', { schedule: settings.schedule });
}

function renderThemeSeg(t) {
  const auto = schedule().enabled;
  $('th-light').classList.toggle('on', !auto && t === 'light');
  $('th-dark').classList.toggle('on', !auto && t === 'dark');
  $('th-light').classList.toggle('cur', auto && t === 'light');
  $('th-dark').classList.toggle('cur', auto && t === 'dark');
  $('th-auto').classList.toggle('on', auto);
  const s = schedule();
  $('th-auto').title = `${auto ? 'Automatic: ' : 'Switch automatically — '}dark from ${timeLabel(s.darkAt)}, light from ${timeLabel(s.lightAt)}. Right-click to change the times.`;
}

async function editSchedule() {
  const v = await dialogs.scheduleDialog(schedule());
  if (!v) return;
  settings.schedule = v;
  refreshTheme();
  api.invoke('settings:set', { schedule: v });
}

// Re-check on a short poll and whenever the window regains attention, so
// sleep/wake, clock changes and time-zone changes take effect promptly.
setInterval(refreshTheme, 15000);
window.addEventListener('focus', refreshTheme);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTheme(); });
systemDark.addEventListener('change', refreshTheme);

// element & highlight bars
for (const [i, t] of TYPES.entries()) {
  const short = { scene: 'SCENE', action: 'ACTION', character: 'CHARACTER', paren: 'PAREN', dialogue: 'DIALOGUE', transition: 'TRANS', shot: 'SHOT' }[t];
  const b = dlg.h('button', { class: 'tb', title: `${TYPE_LABEL[t]} (Ctrl+${i + 1})`, 'data-t': t }, short, dlg.h('sup', {}, String(i + 1)));
  b.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run('type-' + t); });
  $('eltypes').appendChild(b);
}
for (const [i, c] of HIGHLIGHT_COLORS.entries()) {
  const b = dlg.h('button', { class: 'tb', title: `Highlight ${c} (Alt+${i + 1})` }, dlg.h('span', { class: 'sw ' + c }));
  b.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run('hl-' + c); });
  $('hlbar').appendChild(b);
}
{
  const b = dlg.h('button', { class: 'tb', title: 'Remove highlight (Alt+0)' }, dlg.h('span', { class: 'sw none' }));
  b.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run('hl-none'); });
  $('hlbar').appendChild(b);
}
const tbClick = (id, c) => $(id).addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run(c); });
tbClick('btn-comment', 'note-add');
tbClick('btn-scenes', 'panel-scenes');
tbClick('btn-notes', 'panel-notes');
tbClick('btn-rev', 'revise-panel');
tbClick('th-light', 'theme-light');
tbClick('th-dark', 'theme-dark');
tbClick('th-auto', 'theme-auto');
$('th-auto').addEventListener('contextmenu', (e) => { e.preventDefault(); editSchedule(); });
tbClick('zoom-in', 'zoom-in');
tbClick('zoom-out', 'zoom-out');
tbClick('zoom-val', 'zoom-reset');
$('st-goal').addEventListener('click', () => cmd.run('stats'));
$('st-save').addEventListener('click', () => { if (session.status === 'conflict' || session.status === 'error') cmd.run('save'); });
$('doctitle').addEventListener('dblclick', () => cmd.run('rename'));

// Immediate pressed state for every control, independent of what the command does.
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('.tb, .mb, .btn');
  if (!b || e.button !== 0) return;
  b.classList.add('pressed');
  const up = () => { b.classList.remove('pressed'); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); };
  addEventListener('pointerup', up, true);
  addEventListener('pointercancel', up, true);
}, true);

// ---- document operations ----------------------------------------------------------------

function hasContent() {
  return editor.blocks.length > 1 || editor.blocks[0].text !== '' || Object.values(session.doc.titlePage).some((v, i) => v && i !== 1);
}

/** Make the current document safe to leave. Returns false if the user cancelled. */
async function releaseCurrent() {
  if (!session.doc) return true;
  const ok = await session.flushAll();
  if (ok || !session.dirty) return true;
  if (!session.path) {
    if (!hasContent()) { api.invoke('recovery:clear', session.doc.meta.id); return true; }
    const v = await dlg.choose('UNSAVED SCREENPLAY', 'This screenplay has never been saved. Save it before continuing?', [
      { label: 'Cancel', value: null }, { label: "Don't save", value: 'discard' }, { label: 'Save…', value: 'save', primary: true },
    ]);
    if (!v) return false;
    if (v === 'discard') { await api.invoke('recovery:clear', session.doc.meta.id); return true; }
    return saveUntitled();
  }
  // Saved document whose write failed: the recovery copy holds the edits.
  const v = await dlg.choose('SAVE FAILED', `The latest changes could not be written to ${session.path}. They are kept in a recovery copy and will be offered next time STET starts.`, [
    { label: 'Cancel', value: null }, { label: 'Continue', value: true, primary: true },
  ]);
  return !!v;
}

async function saveUntitled() {
  const dir = await api.invoke('path:default-dir');
  const cfg = await dialogs.setupDialog({ title: 'SAVE SCREENPLAY', name: (session.doc.titlePage.title || 'Untitled Screenplay').trim(), dir, backup: session.doc.settings.backup, allowUntitled: false });
  if (!cfg) return false;
  const file = await api.invoke('path:join', cfg.dir, cfg.name + '.stet');
  if (await api.invoke('doc:exists', file)) {
    await dlg.alertBox('FILE EXISTS', `${file} already exists. Choose another name or folder — STET never overwrites an existing screenplay from this dialog.`);
    return false;
  }
  session.doc.settings.backup = cfg.backup;
  const r = await session.saveTo(file);
  if (!r.ok) { await dlg.alertBox('SAVE FAILED', 'The screenplay could not be saved.', r.error); return false; }
  await session.clearRecovery();
  return true;
}

async function save() {
  if (!session.path) return saveUntitled();
  if (session.status === 'conflict') {
    const v = await dlg.choose('FILE CHANGED ON DISK', `${session.path} was modified by another program after STET opened it.`, [
      { label: 'Cancel', value: null }, { label: 'Save as copy…', value: 'as' }, { label: 'Overwrite', value: 'force', primary: true },
    ]);
    if (v === 'as') return saveAs();
    if (v !== 'force') return false;
    const r = await session.writeFile({ force: true });
    return r.ok;
  }
  const r = await session.writeFile();
  if (!r.ok && !r.conflict) await dlg.alertBox('SAVE FAILED', 'The screenplay could not be saved. Your work is kept in a recovery copy; STET will keep retrying.', r.error);
  if (r.conflict) return save();
  return r.ok;
}

async function saveAs() {
  const file = await api.invoke('doc:save-dialog', { name: session.name, dir: null });
  if (!file) return false;
  if (file === session.path) return save();
  const oldId = session.doc.meta.id;
  session.doc.meta.id = uuid(); // a copy is a new document (own recovery & statistics)
  const r = await session.saveTo(file, { force: true });
  if (!r.ok) { session.doc.meta.id = oldId; await dlg.alertBox('SAVE FAILED', 'The copy could not be saved.', r.error); return false; }
  api.invoke('recovery:clear', oldId);
  tracker.begin(session.doc.meta.id, editor.words);
  renderTitle();
  return true;
}

async function openPath(file) {
  if (!(await releaseCurrent())) return;
  const r = await Session.readFile(file);
  if (!r.ok) {
    const v = await dlg.choose('CANNOT OPEN', `${file}\n\n${r.error}`, [{ label: 'Close', value: null }, { label: 'Look for backups…', value: 'backups', primary: true }]);
    if (v === 'backups') await restoreFromBackups({ path: file, id: '', dir: null }, true);
    return;
  }
  if (r.migratedFrom) {
    // Keep the pre-migration original before anything rewrites it.
    await api.invoke('backup:create', { path: file, id: r.doc.meta.id, dir: r.doc.settings.backup.dir, json: r.raw });
  }
  // Unsaved changes to this very script from a session that crashed?
  const pending = (await api.invoke('recovery:list')).find((x) => x.id === r.doc.meta.id);
  if (pending) {
    const v = await dlg.choose('UNSAVED CHANGES FOUND', `"${pending.name}" has changes from ${new Date(pending.time).toLocaleString()} that never reached the file. Restore them? (The file on disk is backed up first.)`, [
      { label: 'Discard them', value: 'discard' }, { label: 'Restore', value: 'restore', primary: true },
    ]);
    if (v === 'restore') {
      const rec = await Session.readFile(pending.file, 'recovery:read');
      if (rec.ok) {
        await api.invoke('backup:create', { path: file, id: r.doc.meta.id, dir: r.doc.settings.backup.dir, json: r.raw });
        session.load(rec.doc, file, { dirty: true });
        api.invoke('settings:set', { lastOpen: file });
        return;
      }
    } else if (v === 'discard') {
      await api.invoke('recovery:clear', pending.id);
    }
  }
  session.load(r.doc, file);
  api.invoke('settings:set', { lastOpen: file });
  if (r.warnings.length) dlg.alertBox('OPENED WITH WARNINGS', 'The document was opened, but some parts needed repair:', [...new Set(r.warnings)].join('\n'));
}

async function newDoc() {
  if (!(await releaseCurrent())) return;
  const dir = await api.invoke('path:default-dir');
  const cfg = await dialogs.setupDialog({ dir, backup: newDocument().settings.backup });
  if (!cfg) return;
  const doc = newDocument(cfg.name === 'Untitled Screenplay' ? '' : cfg.name.toUpperCase());
  doc.settings.backup = cfg.backup;
  if (cfg.untitled) { session.load(doc, null); api.invoke('settings:set', { lastOpen: null }); return; }
  const file = await api.invoke('path:join', cfg.dir, cfg.name + '.stet');
  if (await api.invoke('doc:exists', file)) {
    await dlg.alertBox('FILE EXISTS', `${file} already exists. Pick another name, or open it with Ctrl+O.`);
    session.load(doc, null);
    return;
  }
  session.load(doc, null);
  const r = await session.saveTo(file);
  if (!r.ok) dlg.alertBox('COULD NOT CREATE FILE', 'The screenplay is open but not saved yet.', r.error);
}

async function restoreFromBackups(ref, asNew = false) {
  const v = await dialogs.backupsDialog(ref, ref.path ? ref.path : 'untitled');
  if (v === 'reveal') { api.invoke('backup:reveal', ref); return; }
  if (v === 'now') {
    const r = await session.maybeBackup(true);
    if (r && !r.ok) dlg.alertBox('BACKUP FAILED', 'The backup could not be written.', r.error);
    return restoreFromBackups(ref, asNew);
  }
  if (!v || !v.file) return;
  const r = await Session.readFile(v.file, 'backup:read');
  if (!r.ok) { dlg.alertBox('BACKUP DAMAGED', 'This backup cannot be read. Try an older one.', r.error); return; }
  if (asNew) {
    r.doc.meta.id = uuid();
    session.load(r.doc, null, { dirty: true });
    dlg.alertBox('RESTORED', 'The backup is open as a new, unsaved screenplay. Save it (Ctrl+S) to keep it.');
    return;
  }
  const ok = await dlg.confirm('RESTORE BACKUP', 'Replace the current text with this backup? The current version is backed up first, but undo history will be cleared.', 'Restore');
  if (!ok) return;
  await session.maybeBackup(true);
  r.doc.meta.id = session.doc.meta.id;
  const path = session.path;
  session.load(r.doc, path, { dirty: true });
  tracker.rebase(r.doc.meta.id, editor.words);
}

async function checkRecovery(auto = true) {
  const items = await api.invoke('recovery:list');
  const live = session.doc ? items.filter((i) => i.id !== session.doc.meta.id) : items;
  if (!live.length) { if (!auto) dlg.alertBox('RECOVERY', 'There is no unsaved work to recover.'); return false; }
  const { action, item } = await dialogs.recoveryDialog(live);
  if (action === 'discard') {
    if (await dlg.confirm('DISCARD RECOVERED WORK', `Permanently discard the unsaved changes to "${item.name}"?`, 'Discard')) await api.invoke('recovery:clear', item.id);
    return false;
  }
  if (action !== 'restore') return false;
  const r = await Session.readFile(item.file, 'recovery:read');
  if (!r.ok) { dlg.alertBox('RECOVERY FAILED', 'The recovery copy could not be read.', r.error); return false; }
  if (item.path && (await api.invoke('doc:exists', item.path))) {
    // Back up what is on disk before the recovered text replaces it.
    const disk = await api.invoke('doc:read', item.path);
    if (disk.ok) await api.invoke('backup:create', { path: item.path, id: r.doc.meta.id, dir: r.doc.settings.backup.dir, json: disk.json });
  }
  session.load(r.doc, item.path || null, { dirty: true });
  return true;
}

// ---- notes ----------------------------------------------------------------------------------

function openNote(id, focusText = false) {
  showPanel('notes', true);
  notes.refresh(true);
  requestAnimationFrame(() => notes.select(id, false, focusText));
}

function addNote() {
  const id = uuid().slice(0, 8);
  const now = new Date().toISOString();
  session.doc.comments[id] = { text: '', created: now, modified: now };
  if (!editor.attachComment(id)) { delete session.doc.comments[id]; return; }
  showPanel('notes', true);
  notes.lastKey = '';
  notes.render();
  notes.select(id, false, true);
}

function stepNote(dir) {
  const a = notes.step(dir);
  if (!a) return;
  jump(pos(a.b, a.s), true, pos(a.b, a.e));
  view.activeComment = a.id;
  if (notes.visible) notes.select(a.id);
  view.invalidate();
}

function showPanel(which, on) {
  const host = which === 'scenes' ? $('left') : $('right');
  const want = on ?? host.hidden;
  host.hidden = !want;
  $(which === 'scenes' ? 'btn-scenes' : 'btn-notes').classList.toggle('on', want);
  api.invoke('settings:set', { panels: { [which]: want } });
  // The view's ResizeObserver re-centres and repaints only what moved; no full teardown.
  view.layoutDirty = true;
  view.schedule();
  if (want) (which === 'scenes' ? scenes : notes).refresh(true);
}

function sceneStep(dir) {
  const s = editor.scenes();
  const c = editor.caret.b;
  const t = dir > 0 ? s.find((x) => x.b > c) : [...s].reverse().find((x) => x.b < c);
  if (t) jump(pos(t.b, 0), true);
}

// ---- export / print ----------------------------------------------------------------------------

let lastPrintOpts = { titlePage: true, highlights: false, comments: false, range: '' };
async function preview() {
  const snapshot = { ...session.doc, blocks: editor.blocks };
  const v = await dialogs.previewDialog(snapshot, lastPrintOpts);
  if (!v) return;
  lastPrintOpts = v.options;
  if (v.action === 'pdf') return exportPdf(v.options);
  const { pages } = buildPrintPages(snapshot, v.options);
  const r = await api.invoke('print:html', { html: printHTML(pages, session.name) });
  if (!r.ok && r.error && r.error !== 'cancelled') dlg.alertBox('PRINT FAILED', 'The document could not be printed.', r.error);
}

async function exportPdf(options = lastPrintOpts) {
  const r = await api.invoke('export:pdf', { json: session.serialize(), options: { ...options, appVersion: info.version }, name: session.name });
  if (r.canceled) return;
  if (!r.ok) return dlg.alertBox('EXPORT FAILED', 'The PDF could not be written.', r.error);
  $('st-save').textContent = `PDF → ${r.file.split(/[\\/]/).pop()} (${Math.round(r.ms)} ms)`;
}

// ---- commands -----------------------------------------------------------------------------------

const typeCmds = TYPES.map((t, i) => ({ id: 'type-' + t, cat: 'Element', label: TYPE_LABEL[t], keys: `Ctrl+${i + 1}`, run: () => { editor.setType(t); input.after(false); input.focus(); } }));
const hlCmds = HIGHLIGHT_COLORS.map((c, i) => ({
  id: 'hl-' + c, cat: 'Format', label: `Highlight ${c}`, keys: `Alt+${i + 1}`,
  run: () => { if (!editor.hasSelection()) editor.setSel(pos(editor.caret.b, 0), pos(editor.caret.b, editor.block.text.length)); editor.highlight(c); input.after(false); input.focus(); },
}));

cmd.register([
  { id: 'new', cat: 'File', label: 'New Screenplay…', keys: 'Ctrl+N', global: true, run: newDoc },
  { id: 'open', cat: 'File', label: 'Open…', keys: 'Ctrl+O', global: true, run: async () => { const f = await api.invoke('doc:open-dialog'); if (f) openPath(f); } },
  { id: 'recent', cat: 'File', label: 'Open Recent…', keys: 'Ctrl+Shift+O', global: true, run: async () => { settings = await api.invoke('settings:get'); const f = await dialogs.recentDialog(settings.recent || []); if (f) openPath(f); } },
  { id: 'save', cat: 'File', label: 'Save', keys: 'Ctrl+S', global: true, run: save },
  { id: 'save-as', cat: 'File', label: 'Save As…', keys: 'Ctrl+Shift+S', global: true, run: saveAs },
  { id: 'rename', cat: 'File', label: 'Rename…', enabled: () => !!session.path, run: async () => {
    const name = await dlg.prompt('RENAME', 'New name', session.name, 'Renames the file (and its backup folder) on disk.');
    if (!name || name === session.name) return;
    await session.flushAll();
    const r = await api.invoke('doc:rename', { path: session.path, name, backupDir: session.doc.settings.backup.dir });
    if (!r.ok) return dlg.alertBox('RENAME FAILED', r.error);
    session.path = r.path;
    api.invoke('settings:set', { lastOpen: r.path });
    renderTitle(); session.emit();
  } },
  { id: 'reveal', cat: 'File', label: 'Show in Folder', enabled: () => !!session.path, run: () => api.invoke('shell:reveal', session.path) },
  { id: 'backups', cat: 'File', label: 'Backups & Restore…', keys: 'Ctrl+Shift+B', global: true, run: () => restoreFromBackups(session.ref()) },
  { id: 'backup-now', cat: 'File', label: 'Backup Now', run: async () => { const r = await session.maybeBackup(true); $('st-save').textContent = r && r.ok ? 'BACKUP WRITTEN' : 'BACKUP FAILED'; } },
  { id: 'recover', cat: 'File', label: 'Recover Unsaved Work…', run: () => checkRecovery(false) },
  { id: 'print', cat: 'File', label: 'Print / Export Preview…', keys: 'Ctrl+P', global: true, run: preview },
  { id: 'export-pdf', cat: 'File', label: 'Export PDF…', keys: 'Ctrl+Shift+E', global: true, run: () => exportPdf() },
  { id: 'prefs', cat: 'File', label: 'Preferences…', keys: 'Ctrl+,', global: true, run: async () => {
    const v = await dialogs.preferencesDialog(settings, session.doc);
    if (!v) return;
    settings = await api.invoke('settings:set', v.app);
    refreshTheme();
    session.autosave = settings.autosave; session.autosaveDelay = settings.autosaveDelayMs;
    const spacingChanged = v.doc.sceneSpacing !== session.doc.settings.sceneSpacing;
    Object.assign(session.doc.settings, v.doc);
    editor.autoCapitalize = v.doc.autoCapitalize;
    session.touch();
    if (spacingChanged) { view.pages = []; view.relayout(); view.invalidate(); }
    renderGoal(); renderSaveState(session);
  } },

  { id: 'undo', cat: 'Edit', label: 'Undo', display: 'Ctrl+Z', run: () => { editor.undo(); input.after(); input.focus(); } },
  { id: 'redo', cat: 'Edit', label: 'Redo', display: 'Ctrl+Y', run: () => { editor.redo(); input.after(); input.focus(); } },
  { id: 'cut', cat: 'Edit', label: 'Cut', display: 'Ctrl+X', run: () => { input.focus(); document.execCommand('cut'); } },
  { id: 'copy', cat: 'Edit', label: 'Copy', display: 'Ctrl+C', run: () => { input.focus(); document.execCommand('copy'); } },
  { id: 'paste', cat: 'Edit', label: 'Paste', display: 'Ctrl+V', run: () => { input.focus(); document.execCommand('paste'); } },
  { id: 'select-all', cat: 'Edit', label: 'Select All', display: 'Ctrl+A', run: () => { editor.selectAll(); input.after(); input.focus(); } },
  { id: 'find', cat: 'Edit', label: () => (find.open ? 'Close Find' : 'Find…'), keys: 'Ctrl+F', global: true, run: () => (find.open ? find.close() : find.show(false)) },
  { id: 'replace', cat: 'Edit', label: 'Find & Replace…', keys: 'Ctrl+H', global: true, run: () => find.show(true) },
  { id: 'find-next', cat: 'Edit', label: 'Find Next', keys: 'F3', global: true, run: () => { if (!find.open) find.show(); else find.next(1); } },
  { id: 'find-prev', cat: 'Edit', label: 'Find Previous', keys: 'Shift+F3', global: true, run: () => { if (!find.open) find.show(); else find.next(-1); } },

  ...typeCmds,
  { id: 'type-cycle', cat: 'Element', label: 'Next Element Type', display: 'Tab', run: () => { editor.tab(false); input.after(); input.focus(); } },

  ...hlCmds,
  { id: 'hl-none', cat: 'Format', label: 'Remove Highlight', keys: 'Alt+0', run: () => { if (!editor.hasSelection()) editor.setSel(pos(editor.caret.b, 0), pos(editor.caret.b, editor.block.text.length)); editor.highlight(null); input.after(false); input.focus(); } },
  { id: 'note-add', cat: 'Format', label: 'Add Note', keys: 'Ctrl+Alt+M', global: true, run: addNote },
  { id: 'note-next', cat: 'Format', label: 'Next Note', keys: 'F8', global: true, run: () => stepNote(1) },
  { id: 'note-prev', cat: 'Format', label: 'Previous Note', keys: 'Shift+F8', global: true, run: () => stepNote(-1) },

  { id: 'palette', cat: 'View', label: 'Command Palette…', keys: ['Ctrl+K', 'Ctrl+Shift+P'], global: true, run: () => cmd.palette() },
  { id: 'theme-toggle', cat: 'View', label: () => (document.documentElement.dataset.theme === 'dark' ? 'Light Mode' : 'Dark Mode'), keys: 'Ctrl+Shift+L', global: true, run: () => setManualTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
  { id: 'theme-light', cat: 'View', label: 'Light Mode (manual)', run: () => setManualTheme('light') },
  { id: 'theme-dark', cat: 'View', label: 'Dark Mode (manual)', run: () => setManualTheme('dark') },
  { id: 'theme-auto', cat: 'View', label: () => (schedule().enabled ? 'Turn Off Automatic Theme' : 'Automatic Theme (Schedule)'), run: () => setAutoTheme(!schedule().enabled) },
  { id: 'theme-schedule', cat: 'View', label: 'Theme Schedule…', run: editSchedule },
  { id: 'zoom-in', cat: 'View', label: 'Zoom In', keys: ['Ctrl+=', 'Ctrl+Shift+='], global: true, run: () => { view.setZoom(view.z + 0.1); renderZoom(); persistZoom(); } },
  { id: 'zoom-out', cat: 'View', label: 'Zoom Out', keys: 'Ctrl+-', global: true, run: () => { view.setZoom(view.z - 0.1); renderZoom(); persistZoom(); } },
  { id: 'zoom-reset', cat: 'View', label: 'Actual Size (100%)', keys: 'Ctrl+0', global: true, run: () => { view.setZoom(1); renderZoom(); persistZoom(); } },
  { id: 'panel-scenes', cat: 'View', label: 'Scene Navigator', keys: 'Ctrl+\\', global: true, run: () => showPanel('scenes') },
  { id: 'panel-notes', cat: 'View', label: 'Notes Panel', keys: 'Ctrl+Shift+\\', global: true, run: () => showPanel('notes') },
  { id: 'title-toggle', cat: 'View', label: () => (view.showTitle ? 'Hide Title Page' : 'Show Title Page'), run: () => { view.showTitle = !view.showTitle; api.invoke('settings:set', { showTitlePage: view.showTitle }); view.invalidate(); view.revealCaret(); } },
  { id: 'title-edit', cat: 'View', label: 'Edit Title Page', run: () => { if (!view.showTitle) { view.showTitle = true; view.invalidate(); } view.scroller.scrollTop = 0; view.frame(); setTimeout(() => { const f = document.querySelector('.tp-f'); if (f) f.focus(); }, 30); } },
  { id: 'goto-page', cat: 'View', label: 'Go to Page…', keys: 'Ctrl+G', global: true, run: async () => {
    const v = await dlg.prompt('GO TO PAGE', `Page (1–${view.pages.length})`, String(view.currentPage() + 1));
    const n = parseInt(v, 10);
    if (!n) return;
    const p = view.pages[Math.max(0, Math.min(view.pages.length - 1, n - 1))];
    const it = p.items[0];
    jump(it ? pos(it.bi, 0) : pos(p.startBi, 0));
    view.scrollToPage(Math.max(0, Math.min(view.pages.length - 1, n - 1)));
  } },
  { id: 'scene-next', cat: 'View', label: 'Next Scene', keys: 'Alt+ArrowDown', run: () => sceneStep(1) },
  { id: 'scene-prev', cat: 'View', label: 'Previous Scene', keys: 'Alt+ArrowUp', run: () => sceneStep(-1) },

  { id: 'stats', cat: 'Tools', label: 'Writing Goals & Statistics…', keys: 'F9', global: true, run: async () => {
    tracker.update(session.doc.meta.id, editor.words, editor.pastedWords); editor.pastedWords = 0;
    await dialogs.statsDialog(tracker.summary(settings.goals), editor.words, async (goals) => { settings = await api.invoke('settings:set', { goals }); renderGoal(); });
  } },
  { id: 'revise-panel', cat: 'Tools', label: () => (revision.visible ? 'Hide English Revision' : 'English Revision'), keys: 'Ctrl+Shift+R', global: true, run: () => revision.show() },
  { id: 'revise-run', cat: 'Tools', label: 'Review English with Claude…', run: () => { revision.show(true); revision.start(); } },
  { id: 'revise-next', cat: 'Tools', label: 'Next Suggestion', keys: 'F7', global: true, run: () => revision.step(1) },
  { id: 'revise-prev', cat: 'Tools', label: 'Previous Suggestion', keys: 'Shift+F7', global: true, run: () => revision.step(-1) },
  { id: 'revise-dict', cat: 'Tools', label: 'Dictionary & Ignored…', run: () => dictionaryDialog(revision) },
  { id: 'claude-key', cat: 'Tools', label: 'Claude Connection…', run: () => keyDialog() },
  { id: 'perf', cat: 'Tools', label: 'Run Performance Probe', run: () => runPerfProbe({ editor, view, input, session, api, report: false }) },

  { id: 'keys', cat: 'Help', label: 'Keyboard Shortcuts', keys: 'F1', global: true, run: () => dialogs.shortcutsDialog(cmd.all()) },
  { id: 'changelog', cat: 'Help', label: 'Changelog', run: async () => dialogs.changelogDialog(await api.invoke('app:changelog'), info.version) },
  { id: 'about', cat: 'Help', label: 'About STET', run: () => dlg.alertBox('STET ' + info.version + ' β', 'A fast, minimal, dependable screenwriting instrument. Built on Electron ' + info.electron + '.', `Settings & recovery: ${info.userData}`) },
]);

cmd.buildMenubar($('menubar'), [
  { label: 'File', items: () => ['new', 'open', 'recent', '-', 'save', 'save-as', 'rename', 'reveal', '-', 'backups', 'backup-now', 'recover', '-', 'print', 'export-pdf', '-', 'prefs'] },
  { label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'select-all', '-', 'find', 'replace', 'find-next', 'find-prev'] },
  { label: 'Element', items: [...typeCmds.map((c) => c.id), '-', 'type-cycle'] },
  { label: 'Format', items: [...hlCmds.map((c) => c.id), 'hl-none', '-', 'note-add', 'note-next', 'note-prev'] },
  { label: 'View', items: () => ['palette', '-', 'theme-toggle', 'theme-auto', 'theme-schedule', 'zoom-in', 'zoom-out', 'zoom-reset', '-', 'panel-scenes', 'panel-notes', 'title-toggle', 'title-edit', '-', 'goto-page', 'scene-next', 'scene-prev'] },
  { label: 'Tools', items: () => ['stats', '-', 'revise-panel', 'revise-run', 'revise-next', 'revise-prev', 'revise-dict', 'claude-key', '-', 'perf'] },
  { label: 'Help', items: ['keys', 'changelog', 'about'] },
]);

// Global shortcuts when focus is outside the editor (title page fields, notes, panels).
window.addEventListener('keydown', (e) => {
  if (e.target === $('input') || dlg.isOpen()) return;
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) return;
  // Inside text fields only application-level commands run; editing keys stay with the field.
  const c = cmd.lookup(e);
  if (!c || (inField && (!c.global || !isGlobalKey(e)))) return;
  e.preventDefault();
  cmd.run(c.id);
});
function isGlobalKey(e) {
  const mods = e.ctrlKey || e.metaKey;
  if (mods && ['z', 'y', 'a', 'c', 'v', 'x'].includes(e.key.toLowerCase()) && !e.shiftKey) return false;
  if (e.altKey && !mods) return false; // Alt+n highlight shortcuts belong to the editor
  return true;
}

// ---- lifecycle ------------------------------------------------------------------------------------

api.on('app:before-close', async () => {
  tracker.update(session.doc.meta.id, editor.words, editor.pastedWords);
  await api.invoke('stats:set', tracker.data);
  if (await releaseCurrent()) {
    if (!session.dirty) await session.clearRecovery();
    api.invoke('app:close-ready');
  } else {
    api.invoke('app:close-cancel');
  }
});
api.on('app:open-file', (file) => openPath(file));
api.on('perf:start', () => runPerfProbe({ editor, view, input, session, api, report: true }));

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.stet$/i.test(f.name)) openPath(api.pathForFile(f));
});

// Test hook for the end-to-end driver (only with --e2e).
if (info.e2e) window.__stet = { editor, view, session, input, tracker, cmd, revision, openPath, save, exportPdf, checkRecovery, api, settings: () => settings };

// ---- startup -----------------------------------------------------------------------------------------

refreshTheme();
session.autosave = settings.autosave;
session.autosaveDelay = settings.autosaveDelayMs;
if (settings.zoom && settings.zoom !== 1) view.setZoom(settings.zoom);
renderZoom();
if (settings.panels?.scenes) showPanel('scenes', true);
if (settings.panels?.notes) showPanel('notes', true);

session.newUntitled();
renderGoal();
input.focus();

if (info.sample) {
  const { sampleDocument } = await import('../dev/sample.js');
  session.load(sampleDocument(), null);
} else if (!info.perf && !info.shot) {
  const recovered = await checkRecovery(true);
  if (!recovered) {
    const pending = await api.invoke('app:pending-open');
    const target = pending || settings.lastOpen;
    if (target && (await api.invoke('doc:exists', target))) await openPath(target);
  }
}
tracker.compact();
if (info.run) setTimeout(() => cmd.run(info.run), 300);

