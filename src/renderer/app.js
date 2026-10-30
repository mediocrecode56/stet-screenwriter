// Composition root: builds the editor, view and session and wires them to
// the UI. Document logic lives in ../core, persistence in ./session.js.

import './ui/wake.js'; // (first: the click that wakes the window reaches nothing else)
import { Editor, pos, cmp } from '../core/editor.js';
import { makeBlock, TYPES, TYPE_LABEL, HIGHLIGHT_COLORS, STYLES, newDocument, uuid } from '../core/model.js';
import { buildPrintPages } from '../core/printmodel.js';
import { printHTML } from '../core/printhtml.js';
import { View } from './view.js';
import { Input } from './input.js';
import { Session } from './session.js';
import { ScenePanel, NotesPanel } from './ui/panels.js';
import { setPanel, isOpen } from './ui/motion.js';
import { started } from './ui/startup.js';
import { FocusMode } from './ui/focus.js';
import { Dino } from './dino.js';
import { WritingStats } from './writing.js';
import { FindBar } from './ui/find.js';
import * as cmd from './ui/commands.js';
import * as dlg from './ui/dialog.js';
import * as dialogs from './ui/dialogs.js';
import { initUpdates } from './ui/update.js';
import { runPerfProbe } from './perf.js';
import { Revision, keyDialog, guidelinesDialog } from './revision.js';
import { Spelling } from './spelling.js';
import { toast } from './ui/toast.js';
import { resizable } from './ui/resize.js';
import { Timeline } from './timeline.js';
import { selectionMenu } from './ui/selmenu.js';
import { launchOrder, rememberPlace, placeFor } from '../core/recent.js';
import { effectiveTheme, label as timeLabel, DEFAULT_SCHEDULE } from '../core/schedule.js';
import { MAC, macKeys } from '../core/keys.js';
import { stepZoom, panelScale } from '../core/wheelzoom.js';
import { castOrder, touchCast } from '../core/cast.js';
import { parseFdx } from '../core/fdx.js';
import { alignOf } from '../core/format.js';
import { restoredName } from '../core/when.js';
import { documentWords } from '../core/text.js';

const api = window.stet;
// On a Mac the window buttons sit at the left of the top bar (style.css), and shortcuts read ⌘.
if (MAC) {
  document.documentElement.classList.add('mac');
  for (const el of document.querySelectorAll('[title]')) el.title = macKeys(el.title);
}
const $ = (id) => document.getElementById(id);

const info = await api.invoke('app:info');
let settings = await api.invoke('settings:get');
$('ver').textContent = `${info.version} β`;
$('brand').title = `STET ${info.version} β — click for the changelog`;

// ---- core objects -------------------------------------------------------------

const editor = new Editor([makeBlock('scene')]);
const placeholderDoc = newDocument();
const view = new View({ scroller: $('scroller'), content: $('content'), editor, doc: placeholderDoc });
const session = new Session({ editor, appVersion: info.version, onState: renderSaveState, onLoaded: onDocLoaded });
// Writing statistics are recorded only for real use, never for probes or screenshots.
const writing = new WritingStats(api, await api.invoke('stats:get'), { enabled: !info.perf && !info.shot && !info.sample });

const input = new Input({
  textarea: $('input'), view, editor,
  onCommandKey: (e) => cmd.handleKey(e),
  onCommentClick: (id) => openNote(id, true),
});
input.onEscape = () => {
  if (find.open) { find.close(); return true; }
  if (focus.on) { focus.exit(); return true; } // Esc leaves focus mode
  return false;
};
input.onZoom = () => { renderZoom(); persistZoom(); };
// Character cues complete from the script's cast, most recently used first (core/cast.js).
input.names = () => castOrder(session.doc.cast, editor.characterNames());
input.onCue = (name) => { session.doc.cast = touchCast(session.doc.cast, name); };

// glide: true glides until the passage is in the middle, 'top' until it is at the top of the view,
// 'key' until its start is 10% of the view above the middle (a note, a highlight, a timecode),
// { y } to the scroll position y() gives (the timeline: the middle of its band).
const jump = (p, center = false, end = null, glide = false) => {
  editor.setSel(p, end || p);
  view.relayout();
  // (the glide under way before the frame: the timeline's band then travels from where it was,
  // rather than first leaping to where the caret is)
  if (glide) view.glideTo(p, end || p, typeof glide === 'object' ? glide : { top: glide === 'top', key: glide === 'key' });
  view.frame();
  if (!glide) view.revealCaret(center);
  input.focus();
  input.placeTextarea();
};

const scenes = new ScenePanel($('left'), $('scenes'), $('scene-count'), {
  editor, view, jump: (p) => jumpScene(p.b),
  times: () => timeline.sceneTimes(), // each scene's time, as the timeline has it
  runtime: () => timeline.runtime(), // and the script's whole length
  editTime: (b, box) => timeline.editScene(b, box),
  focusEditor: () => input.focus(),
});
const notes = new NotesPanel($('right'), $('notes'), $('note-count'), { editor, view, session, jump, onChange: () => session.touch(), onMark: () => { timeline.update(true); view.schedule(); } });
const find = new FindBar({ editor, view, jump, focusEditor: () => input.focus(), onFound: (m) => timeline.markFound(m) });

const revision = new Revision({
  host: $('rev'), editor, view, session, jump,
  getSettings: () => settings,
  setSettings: async (patch) => { settings = await api.invoke('settings:set', patch); },
  onShow: (on) => { $('btn-rev').classList.toggle('on', on); view.layoutDirty = true; view.schedule(); },
});

// Spelling with the dictionaries installed on the computer (the toolbar's SPELLING menu).
const spelling = new Spelling({
  api, editor, view, session,
  getSettings: () => settings,
  setSettings: async (patch) => { settings = await api.invoke('settings:set', patch); },
  after: (reveal) => { input.after(reveal); input.focus(); },
  onState: () => renderSpelling(),
  notify: (text) => toast(text, 5000),
});
input.onSpace = () => spelling.spaced();
// A right-click on a misspelt word: its fixes; on selected text: its element type (those in the Tab
// cycle), style, alignment and a note.
view.scroller.addEventListener('contextmenu', (e) => {
  if (spelling.contextMenu(e) || !e.target.closest || !e.target.closest('.page') || !editor.hasSelection()) return;
  const p = view.posAt(e.clientX, e.clientY), [s, z] = editor.ordered();
  if (!p || cmp(p, s) < 0 || cmp(p, z) > 0) return;
  e.preventDefault();
  selectionMenu(e.clientX, e.clientY, {
    types: () => (editor.tabTypes || TYPES).map((t) => 'type-' + t),
    typeLabel: () => { const ts = new Set(selectedBlocks().map((b) => b.type)); return ts.size === 1 ? TYPE_SHORT[[...ts][0]] : 'MIXED'; },
    styles: styleCmds.map((c) => c.id), aligns: alignCmds.map((c) => c.id), alignIcon: () => alignIcon(alignOf(editor.block)),
    highlights: [...hlCmds.map((c) => c.id), 'hl-none'],
    icon: toolIcon,
  });
});

const timeline = new Timeline($('timeline'), {
  editor, view, session, jump,
  // (the caret at the note's start, as for a scene: its text not selected; the notes panel open on it)
  openNote: (id, b, s) => { jump(pos(b, s), true, null, 'key'); view.activeComment = id; openNote(id); view.invalidate(); },
  onToggle: (on) => api.invoke('settings:set', { timeline: on }),
  lockPointer: () => api.invoke('pointer:lock'),
  onTimecodes: () => scenes.refresh(),
});

view.onTitleInput = () => session.touch();
view.showTitle = settings.showTitlePage !== false;
document.body.classList.toggle('no-note-lines', settings.noteLines === false);

// ---- change propagation ----------------------------------------------------------

let lastRev = -1;
editor.onChange = () => {
  view.schedule();
  if (editor.rev !== lastRev) {
    lastRev = editor.rev;
    session.changed();
    trackWords();
    scenes.refresh();
    notes.refresh();
    if (find.open) find.schedule();
    revision.documentChanged();
    spelling.changed();
  }
  spelling.paint(); // (the word being typed is flagged only once the caret leaves it)
  // Caret inside commented text makes that note current.
  const b = editor.block;
  {
    const o = editor.caret.o;
    const m = b && b.marks.find((x) => x.k === 'cm' && o >= x.s && o <= x.e);
    const id = m ? m.v : null;
    if (id && id !== view.activeComment) { view.activeComment = id; notes.markCurrent(); }
  }
  if (scenes.visible) scenes.refresh();
  keepPlace();
};

view.onFrame = () => { renderStatus(); timeline.update(); };

function onDocLoaded(s) {
  view.doc = s.doc;
  view.pages = [];
  view.relayout();
  view.refreshTitleFields();
  view.activeComment = null;
  view.invalidate();
  view.stopGlide(); // (a glide still running in the last script would carry this one off)
  view.scroller.scrollTop = 0;
  describeDoc();
  lastRev = editor.rev;
  scenes.lastKey = ''; notes.lastKey = '';
  revision.reset();
  spelling.changed();
  scenes.refresh(); notes.refresh(true);
  renderTitle();
  if (find.open) find.search(true);
  // Back where it was left (the caret, and the line at the top of the window), or else writing on the
  // first script page, not the title page.
  const place = s.path ? placeFor(settings.places, s.doc.meta.id, editor.blocks) : null;
  placeDoc = s.doc;
  editor.setSel(place ? pos(place.caret.b, place.caret.o) : pos(0, 0));
  // The keyboard goes to the script, unless something else took it meanwhile (a note begun at once):
  // its keys must not end up in the script.
  const had = document.activeElement;
  requestAnimationFrame(() => {
    const r = place && place.top && view.caretRect(pos(place.top.b, place.top.o));
    if (r) view.scroller.scrollTop = r.y + place.dy * view.row;
    else if (place) view.revealCaret(true);
    else view.scrollToPage(0);
    view.frame();
    const now = document.activeElement;
    if (now === had || now === document.body || now === $('input') || !now) input.focus();
    input.placeTextarea();
  });
}

// ---- where each screenplay was left ------------------------------------------------

// Kept a moment after the caret or the window last moved, and at once before another screenplay opens
// or STET closes: the caret, and the line at the top of the window (with how far into it), so the
// screenplay opens again looking just as it did. Only for saved screenplays (by their id).
let placeDoc = null, placeTimer = 0;
function placeNow() {
  const doc = session.doc;
  if (!doc || doc !== placeDoc || !session.path || !view.pages.length) return null;
  const sc = view.scroller, r = sc.getBoundingClientRect(), c = editor.caret;
  const onScript = sc.scrollTop >= view.pageTop(view.offset) - 8; // (the title page at the top: none)
  const top = onScript ? view.posAt(r.left + sc.clientWidth / 2, r.top + 1) : null, tr = top && view.caretRect(top);
  return { id: doc.meta.id, caret: { b: c.b, o: c.o }, top: tr ? { b: top.b, o: top.o } : null, dy: tr ? (sc.scrollTop - tr.y) / view.row : 0 };
}
function keepPlace(now = false) {
  clearTimeout(placeTimer);
  if (!now) { placeTimer = setTimeout(() => keepPlace(true), 800); return; }
  const place = placeNow();
  if (!place) return;
  settings.places = rememberPlace(settings.places, place);
  return api.invoke('settings:set', { places: settings.places });
}
view.scroller.addEventListener('scroll', () => keepPlace(), { passive: true });

// ---- statistics --------------------------------------------------------------------

// The editor turns every edit into word credits (see "writing activity" in
// core/editor.js); they're drained and booked synchronously on every change,
// so a document switch or a quick close can never attribute them to the wrong
// screenplay. Only redrawing is deferred.
let statsTimer = 0, verifyAt = 0, dino = null;
function trackWords() {
  if (!session.doc) return;
  const credits = editor.takeCredits();
  if (!credits.length || session.quiet) return; // the performance probe's typing is never counted
  const net = writing.record(session.doc.meta.id, credits);
  if (net > 0 && dino) dino.wrote(net);
  scheduleStats();
}
function describeDoc() {
  if (!session.doc) return;
  writing.describe(session.doc.meta.id, { title: session.path ? session.name : session.doc.titlePage.title || '', path: session.path || null });
}
function scheduleStats() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = 0;
    if (!session.doc) return;
    renderGoal();
    // Belt and braces: the running count is kept incrementally; now and then
    // check it against a full recount (a few ms even for a feature script).
    if (performance.now() > verifyAt) { verifyAt = performance.now() + 15000; editor.verifyWords(); }
  }, 300);
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
  const styles = STYLES.map((k) => (editor.styleActive(k) ? k : '')).join('');
  const align = alignOf(b);
  const key = `${b.type}|${page}|${view.pages.length}|${scene}|${editor.words}|${styles}|${align}`;
  if (key !== statusKey) {
    statusKey = key;
    $('st-el').textContent = TYPE_LABEL[b.type].toUpperCase();
    $('st-page').textContent = `PAGE ${page} / ${view.pages.length}`;
    $('st-scene').textContent = scene ? `SCENE ${scene}` : 'NO SCENE';
    $('st-words').textContent = `${editor.words.toLocaleString()} WORDS`;
    for (const btn of $('eltypes').querySelectorAll('.tb')) btn.classList.toggle('on', btn.dataset.t === b.type);
    for (const btn of $('stbar').children) btn.classList.toggle('on', styles.includes(btn.dataset.s));
    if (alignBtn.dataset.a !== align) { alignBtn.dataset.a = align; alignBtn.firstChild.outerHTML = alignIcon(align); }
  }
}

let goalState = { today: 0, goal: 0 }, streakShown = null;
// A pixel flame for the writing streak (drawn in the text colour, crisp at any zoom).
const FLAME = '<svg class="flame" viewBox="0 0 6 8" width="6" height="8" aria-hidden="true" shape-rendering="crispEdges">'
  + [[2, 0], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3], [4, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [0, 5], [1, 5], [3, 5], [4, 5], [5, 5], [0, 6], [1, 6], [4, 6], [5, 6], [1, 7], [2, 7], [3, 7], [4, 7]].map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join('') + '</svg>';
// A pixel shield for the week's rest days: an outline with a peaked top, a one-pixel gap and a
// solid shield inside, drawn in the text colour and crisp at any zoom.
const SHIELD_ART = [
  '...###...',
  '#########',
  '#.......#',
  '#.#####.#',
  '#.#####.#',
  '#.#####.#',
  '#.#####.#',
  '.#.###.#.',
  '.#..#..#.',
  '..#...#..',
  '...#.#...',
  '....#....',
];
const SHIELD = `<svg class="shield" viewBox="0 0 9 12" width="9" height="12" aria-hidden="true" shape-rendering="crispEdges">`
  + SHIELD_ART.flatMap((row, y) => [...row.matchAll(/#+/g)].map((m) => `<rect x="${m.index}" y="${y}" width="${m[0].length}" height="1"/>`)).join('') + '</svg>';
function renderGoal() {
  writing.setGoal(settings.goals && settings.goals.daily); // the streak counts the days that reach it
  const s = writing.summary(settings.goals);
  const today = s.today.words, goal = s.goals.daily;
  goalState = { today, goal };
  const pct = goal ? Math.min(100, (today / goal) * 100) : 0;
  const el = $('st-goal');
  const k = s.writing;
  // The streak counts the days that reach the daily goal (any new word, with no goal set).
  const aim = goal ? `reach your daily goal (${goal.toLocaleString()} words)` : 'write at least one new word';
  const missed = goal ? 'misses the daily goal' : 'goes by without writing';
  const streakTip = k.days
    ? `Streak: ${k.days} day${k.days === 1 ? '' : 's'}${k.best > k.days ? ` (best ${k.best})` : ''}${k.today ? '' : ` — ${aim} today to add today`}.`
      + ` The dinosaur has grown ${k.growth} px${k.next ? `; it grows again at ${k.next} days` : ', its full size'}.${k.unlocked ? ` Special routines unlocked: ${k.unlocked} of 3.` : ''}`
    : `Streak: none yet — ${aim} to start one; up to two days a week that miss it don’t break it (the dinosaur grows at 1, 2, 4, 8, 16 and 32 days).`;
  // Beside the flame, a shield with this week's rest days left: two days a week may miss the goal.
  const restTip = `Rest days left this week: ${k.rest.left} of 2. Each day that ${missed} uses one, and the streak carries on; a third in the same week ends it. Today counts once it is over. Two new ones every Monday.`;
  // (written only when it changed: the readout is redrawn after every pause in writing, and once a minute)
  const html = `TODAY ${today.toLocaleString()}${goal ? ' / ' + goal.toLocaleString() : ''} <span class="meter"><i style="width:${pct}%"></i></span>`
    + `<span id="st-streak" class="streak${k.days ? '' : ' none'}${k.today ? ' lit' : ''}" title="${streakTip}">${FLAME}${k.days}</span>`
    + `<span id="st-rest" class="rest${k.rest.left ? '' : ' none'}" title="${restTip}">${SHIELD}${k.rest.left}</span>`;
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  const title = `Today: ${today.toLocaleString()} words written${goal ? (today >= goal ? ' — goal met' : ` — ${(goal - today).toLocaleString()} to go`) : ''}. This week: ${s.week.total.toLocaleString()}${s.goals.weekly ? ' of ' + s.goals.weekly.toLocaleString() : ''}. Click for your week.`;
  if (el.title !== title) el.title = title;
  // The dinosaur's size and special routines follow the streak: restored as they were at
  // start-up, a milestone reached while writing shown with a little ceremony.
  const key = `${k.growth}/${k.unlocked}`;
  if (dino && key !== streakShown) { dino.setStreak({ growth: k.growth, unlocked: k.unlocked }, streakShown != null); streakShown = key; }
}
// The streak ends at midnight after a day without writing: check now and then, not only when writing.
// The theme schedule is checked on a short poll too (refreshTheme). While the app rests (the dinosaur
// dormant, or the window long in the background) they rest too: no goal check, the theme and the
// clock once a minute.
let goalPoll = 0, themePoll = 0;
function polls(resting = false) {
  clearInterval(goalPoll); clearInterval(themePoll);
  goalPoll = resting ? 0 : setInterval(() => { if (!document.hidden) renderGoal(); }, 60000);
  themePoll = setInterval(refreshTheme, resting ? 60000 : 15000);
  clockRest = resting;
  tickClock();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderGoal(); });

// The square beside the title is the one sign of the save state: hollow when saved, filled while
// there are unsaved changes, blinking when saving fails (a click on it then saves again).
function renderSaveState(s) {
  const dot = $('docdot');
  const problem = s.status === 'error' || s.status === 'conflict';
  dot.className = problem ? 'error' : s.status === 'saving' || s.status === 'dirty' ? 'dirty' : '';
  dot.title = s.status === 'error' ? 'Save failed; retrying (a recovery copy is kept). Click to save now.'
    : s.status === 'conflict' ? 'The file changed on disk. Click to resolve.'
    : s.status === 'saved' ? (s.path ? 'Saved' : 'Not saved yet') : 'Unsaved changes';
  renderTitle();
}

// A plain digital clock in the status bar. Checked every second, so it is right again at once
// after sleep or a change of time or time zone; while the app rests, just as each minute turns.
let clockTimer = 0, clockRest = false;
function tickClock() {
  clearTimeout(clockTimer);
  const now = new Date(), t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if ($('st-clock').textContent !== t) $('st-clock').textContent = t;
  clockTimer = setTimeout(tickClock, clockRest ? 60050 - (now.getTime() % 60000) : 1000);
}
tickClock();

function renderTitle() {
  const name = session.path ? session.name : (session.doc && session.doc.titlePage.title) || 'Untitled';
  if (!$('doctitle').isContentEditable) $('doctitle').textContent = name; // (not while it is being renamed)
  fitTitle();
  document.title = `${session.dirty ? '• ' : ''}${name} — STET`;
  describeDoc();
}

// The side panels' text follows the zoom too, but only part of it (style.css --pz-notes, --pz-scenes).
function renderZoom() {
  $('zoom-val').textContent = Math.round(view.z * 100) + '%';
  const root = document.documentElement.style;
  root.setProperty('--pz-notes', panelScale(view.z, 0.5)); // the notes and Revise
  root.setProperty('--pz-scenes', panelScale(view.z, 0.1));
}
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
    if (schedule().enabled && dino) dino.themeChanged(t); // the schedule turned it: a sunset or a sunrise
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

// Re-check on a short poll (polls()) and whenever the window regains attention, so
// sleep/wake, clock changes and time-zone changes take effect promptly.
polls();
window.addEventListener('focus', refreshTheme);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTheme(); });
systemDark.addEventListener('change', refreshTheme);

// element, highlight and text style bars
const STYLE_CMDS = [
  { k: 'b', label: 'Bold', keys: 'Ctrl+B', glyph: 'B' },
  { k: 'i', label: 'Italic', keys: 'Ctrl+I', glyph: 'I' },
  { k: 'u', label: 'Underline', keys: 'Ctrl+U', glyph: 'U' },
  { k: 's', label: 'Strikethrough', keys: 'Ctrl+D', glyph: 'S' },
];
// Alignment: a small menu on the toolbar, its button showing the paragraph's alignment.
const ALIGN_CMDS = [
  { a: 'left', label: 'Align Left', keys: 'Ctrl+L' },
  { a: 'center', label: 'Center', keys: 'Ctrl+E' },
  { a: 'right', label: 'Align Right', keys: 'Ctrl+R' },
  { a: 'justify', label: 'Justify', keys: 'Ctrl+J' },
];
const ALIGN_ICON = { left: [10, 6, 10, 6], center: [10, 6, 10, 6], right: [10, 6, 10, 6], justify: [10, 10, 10, 10] };
// A style, alignment or highlight command's icon, as its toolbar button shows it (the selection menu).
const toolIcon = (id) => {
  const [k, v] = [id.slice(0, id.indexOf('-')), id.slice(id.indexOf('-') + 1)];
  if (k === 'align') return alignIcon(v);
  if (k === 'hl') return `<span class="sw ${v}"></span>`;
  if (v === 'clear') return '<span class="st-ic"><span class="sclr">T</span></span>';
  const s = STYLE_CMDS.find((x) => x.k === v);
  return s ? `<span class="st-ic"><span class="s${s.k}">${s.glyph}</span></span>` : '';
};
const alignIcon = (a) => '<svg viewBox="0 0 10 7" width="10" height="7" aria-hidden="true" shape-rendering="crispEdges" fill="currentColor">'
  + ALIGN_ICON[a].map((w, i) => `<rect x="${a === 'right' ? 10 - w : a === 'center' ? (10 - w) / 2 : 0}" y="${i * 2}" width="${w}" height="1"/>`).join('') + '</svg>';

// Tooltips name each command's shortcut as it is now, so they follow changes made in Help > Keyboard Shortcuts.
const tips = [];
const tip = (el, text, id, after = '') => tips.push({ el, text, id, after });
function renderTips() {
  for (const t of tips) { const k = cmd.keyText(t.id); t.el.title = k ? `${t.text} (${k}${t.after})` : t.text; }
}

// Each element type's name on the toolbar (the part after the bar is left out on the narrowest
// windows: fitToolbar()), and whole (the selection menu).
const TYPE_NAME = { scene: 'SCENE', action: 'ACTION', character: 'CHAR|ACTER', paren: 'PAREN', dialogue: 'DIAL|OGUE', transition: 'TRANS', shot: 'SHOT' };
const TYPE_SHORT = Object.fromEntries(TYPES.map((t) => [t, TYPE_NAME[t].replace('|', '')]));
for (const [i, t] of TYPES.entries()) {
  const [short, more = ''] = TYPE_NAME[t].split('|');
  const b = dlg.h('button', { class: 'tb', 'data-t': t }, short, ...(more ? [dlg.h('span', { class: 'more' }, more)] : []), dlg.h('sup', {}, String(i + 1)));
  tip(b, TYPE_LABEL[t], 'type-' + t, MAC ? ' · ⌘-click: in or out of the Tab cycle' : ' · Ctrl+click: in or out of the Tab cycle');
  b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) toggleTabType(t); else cmd.run('type-' + t);
  });
  $('eltypes').appendChild(b);
}

// ---- the Tab cycle ---------------------------------------------------------------------------
//
// The element types Tab steps through are outlined in the toolbar: one box around each run of
// neighbouring types kept. Ctrl+click (⌘-click) takes a type in or out; dragging either end of
// a box takes in or leaves out the types it passes over. All of them by default; at least one.

const tabTypesEl = dlg.h('div', { id: 'tabcycle', 'aria-hidden': 'true' });
$('eltypes').appendChild(tabTypesEl);
const typeButtons = () => [...$('eltypes').querySelectorAll('.tb')];
let tabDrag = null;

function setTabTypes(list, save = true) {
  const keep = TYPES.filter((t) => list.includes(t));
  if (!keep.length) return;
  editor.tabTypes = keep.length === TYPES.length ? null : keep;
  renderTabTypes();
  if (save) api.invoke('settings:set', { tabTypes: editor.tabTypes });
}
function toggleTabType(t) {
  const cur = editor.tabTypes || TYPES;
  setTabTypes(cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
}
function renderTabTypes() {
  const keep = editor.tabTypes || TYPES;
  const btns = typeButtons();
  const runs = [];
  btns.forEach((b, i) => {
    b.classList.toggle('cyc', keep.includes(b.dataset.t));
    if (!keep.includes(b.dataset.t)) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]);
  });
  // Each button is a whole number of pixels wide, so every edge (a fill's, a box's) falls on a pixel
  // and none is drawn soft or a part of a pixel off. Each box is exactly its buttons' edges, its line
  // drawn inwards (style.css .cyc-box), so it never stands outside them.
  for (const b of btns) b.style.width = '';
  const ws = btns.map((b) => Math.ceil(b.getBoundingClientRect().width - 0.01));
  btns.forEach((b, i) => { b.style.width = ws[i] + 'px'; });
  const x0 = $('eltypes').getBoundingClientRect().left;
  tabTypesEl.replaceChildren(...runs.map(([a, z]) => {
    const l = Math.round(btns[a].getBoundingClientRect().left - x0), r = Math.round(btns[z].getBoundingClientRect().right - x0);
    const box = dlg.h('div', { class: 'cyc-box' + (tabDrag ? ' drag' : ''), style: `left:${l}px;width:${r - l}px` },
      dlg.h('i', { class: 'cyc-h l', 'data-a': a, 'data-z': z }), dlg.h('i', { class: 'cyc-h r', 'data-a': a, 'data-z': z }));
    box.title = 'Tab steps through the outlined elements. Drag an end to take more in or leave some out.';
    return box;
  }));
}
tabTypesEl.addEventListener('mousedown', (e) => {
  const h = e.target.closest('.cyc-h');
  if (!h || e.button !== 0) return;
  e.preventDefault();
  const a = +h.dataset.a, z = +h.dataset.z, left = h.classList.contains('l');
  const start = editor.tabTypes || TYPES;
  const outside = start.filter((t) => { const i = TYPES.indexOf(t); return i < a || i > z; });
  tabDrag = { a, z, left };
  document.body.classList.add('cyc-dragging');
  const at = (x) => {
    // The type under the pointer, or the nearest one at either end.
    const btns = typeButtons();
    let best = 0, dist = Infinity;
    btns.forEach((b, i) => { const r = b.getBoundingClientRect(); const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0; if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const move = (ev) => {
    if (!(ev.buttons & 1)) return up(); // (let go where no mouseup reached us)
    const i = at(ev.clientX);
    const [na, nz] = left ? [Math.min(i, z), z] : [a, Math.max(i, a)];
    setTabTypes([...outside, ...TYPES.slice(na, nz + 1)], false);
  };
  const up = () => {
    removeEventListener('mousemove', move, true);
    removeEventListener('mouseup', up, true);
    removeEventListener('blur', up);
    tabDrag = null;
    document.body.classList.remove('cyc-dragging');
    setTabTypes(editor.tabTypes || TYPES);
  };
  addEventListener('mousemove', move, true);
  addEventListener('mouseup', up, true);
  addEventListener('blur', up); // (Alt+Tab mid-drag: no mouseup comes)
});
for (const c of HIGHLIGHT_COLORS) {
  const b = dlg.h('button', { class: 'tb' }, dlg.h('span', { class: 'sw ' + c }));
  tip(b, `Highlight ${c}`, 'hl-' + c);
  b.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run('hl-' + c); });
  $('hlbar').appendChild(b);
}
{
  const b = dlg.h('button', { class: 'tb' }, dlg.h('span', { class: 'sw none' }));
  tip(b, 'Remove highlight', 'hl-none');
  b.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run('hl-none'); });
  $('hlbar').appendChild(b);
}
for (const s of STYLE_CMDS) {
  const b = dlg.h('button', { class: 'tb st', 'data-s': s.k }, dlg.h('span', { class: 's' + s.k }, s.glyph));
  tip(b, s.label, 'style-' + s.k);
  b.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run('style-' + s.k); });
  $('stbar').appendChild(b);
}
{ // Clear Formatting: a T struck through, in the same type and size as the four styles beside it
  const b = dlg.h('button', { class: 'tb st', id: 'btn-unstyle' }, dlg.h('span', { class: 'sclr' }, 'T'));
  tip(b, 'Clear formatting', 'style-clear');
  b.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run('style-clear'); });
  $('stbar').appendChild(b);
}
const alignBtn = dlg.h('button', { class: 'tb mbtn', id: 'btn-align', title: 'Alignment', 'aria-haspopup': 'menu', html: alignIcon('left') + '<span class="dn">▾</span>' });
alignBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.popup(alignBtn, ALIGN_CMDS.map((x) => 'align-' + x.a)); });
$('albar').appendChild(alignBtn);
// Spelling: its switch, Suggestions, Auto and the dictionaries installed, in a small menu.
const spellBtn = dlg.h('button', { class: 'tb mbtn', id: 'btn-spell', title: 'Spelling', 'aria-haspopup': 'menu', html: 'SPELL<span class="more">ING</span><span class="dn">▾</span>' });
spellBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cmd.popup(spellBtn, () => spelling.menuItems()); });
$('btn-comment').after(dlg.h('div', { class: 'sep' }), spellBtn);
// On a narrow window the toolbar tightens a step at a time, only as far as it must for every button,
// NOTES at the right end too, to stay in the window: closer buttons, then without the element
// shortcuts' small numbers, then closer still, twice, then CHAR, DIAL and SPELL, and at the narrowest closer again. (Hidden, it is fitted again when shown.)
const TIGHT = ['tight-1', 'tight-2', 'tight-3', 'tight-4', 'tight-5', 'tight-6'];
function fitToolbar() {
  const bar = $('elbar'), end = $('elright');
  const fits = () => end.getBoundingClientRect().right <= bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight) + 0.5;
  bar.classList.remove(...TIGHT);
  for (const t of TIGHT) { if (fits()) break; bar.classList.add(t); }
  renderTabTypes(); // (the Tab-cycle boxes on the buttons' new edges)
}
addEventListener('resize', fitToolbar);
document.fonts.ready.then(fitToolbar);
fitToolbar();
function renderSpelling() {
  const o = spelling.opts, lang = spelling.lang;
  spellBtn.classList.toggle('off', !o.on || !spelling.ready);
  spellBtn.classList.toggle('need', o.on && !spelling.list.length); // a dot: none installed, one can be
  spellBtn.classList.toggle('busy', spelling.installing);
  spellBtn.title = spelling.installing ? `Spelling: downloading the ${spelling.installing} dictionary…` : !spelling.list.length ? 'Spelling: no dictionary on this computer (click to add a language)'
    : !o.on ? 'Spelling: off' : `Spelling: ${lang ? lang.label : 'no dictionary'}${o.suggest ? '' : ', no suggestions'}${o.auto ? ', corrects as you type' : ''}`;
}
tip($('btn-comment'), 'Comment on selection', 'note-add');
tip($('btn-rev'), 'Revise with Claude', 'revise-next', ' next suggestion');
tip($('btn-scenes'), 'Scene navigator', 'panel-scenes');
tip($('btn-notes'), 'Comments', 'panel-notes');
tip($('th-light'), 'Light mode', 'theme-toggle', ' toggles');
tip($('th-dark'), 'Dark mode', 'theme-toggle', ' toggles');
tip($('zoom-out'), 'Zoom out', 'zoom-out');
tip($('zoom-val'), 'Reset zoom', 'zoom-reset');
tip($('zoom-in'), 'Zoom in', 'zoom-in');
const tbClick = (id, c) => $(id).addEventListener('mousedown', (e) => { e.preventDefault(); cmd.run(c); });
tbClick('btn-comment', 'note-add');
tbClick('btn-scenes', 'panel-scenes');
tbClick('btn-notes', 'panel-notes');
tbClick('btn-rev', 'revise-panel');
tip($('btn-title'), 'Show or hide the title page', 'title-toggle');
tbClick('btn-title', 'title-toggle');
const renderTitleBtn = () => { $('btn-title').classList.toggle('on', view.showTitle); $('btn-title').setAttribute('aria-pressed', String(view.showTitle)); };
renderTitleBtn();

// The side panels widen by dragging their inner edge (up to twice their usual width); the lock beside
// REVISE keeps them as they are. Their widths are kept, and the page re-centres as they change.
const LOCK = (shut) => `<svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><rect x="1" y="5.5" width="8" height="6" rx="1" fill="currentColor"/><path d="M2.8 5.5V3.6a2.2 2.2 0 0 1 4.4 0${shut ? 'V5.5' : 'V3'}" fill="none" stroke="currentColor" stroke-width="1.3" ${shut ? '' : 'transform="translate(2.6 -1)"'}/></svg>`;
function renderLock() {
  const on = !!settings.panelsLocked, b = $('btn-lock');
  b.innerHTML = LOCK(on);
  b.classList.toggle('locked', on);
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Side panel sizes locked (click to unlock)' : 'Lock the side panel sizes (drag a panel\'s edge to widen it)';
  b.setAttribute('aria-label', on ? 'Unlock side panel sizes' : 'Lock side panel sizes');
}
$('btn-lock').addEventListener('mousedown', (e) => e.preventDefault()); // the script keeps the keyboard
$('btn-lock').addEventListener('click', async () => { settings = await api.invoke('settings:set', { panelsLocked: !settings.panelsLocked }); renderLock(); });
renderLock();
for (const [id, edge, base] of [['left', 'right', 260], ['right', 'left', 300], ['rev', 'left', 360]]) {
  const r = resizable($(id), {
    edge, base, locked: () => !!settings.panelsLocked,
    onDone: (w) => { api.invoke('settings:set', { panelWidths: { [id]: Math.round(w) } }).then((s) => { settings = s; }); },
  });
  const w = settings.panelWidths?.[id];
  if (w) r.set(w);
}
tbClick('th-light', 'theme-light');
tbClick('th-dark', 'theme-dark');
tbClick('th-auto', 'theme-auto');
$('th-auto').addEventListener('contextmenu', (e) => { e.preventDefault(); editSchedule(); });
tbClick('zoom-in', 'zoom-in');
tbClick('zoom-out', 'zoom-out');
tbClick('zoom-val', 'zoom-reset');
$('st-goal').addEventListener('click', () => cmd.run('stats'));
$('docdot').addEventListener('click', () => { if (session.status === 'conflict' || session.status === 'error') cmd.run('save'); });
$('doctitle').addEventListener('dblclick', () => (session.path ? renameInPlace() : cmd.run('save-as')));

// Rename in place: the title becomes a field. Enter (or clicking away) renames the file on disk,
// its backups and its place in Open Recent; Escape leaves it as it was.
function renameInPlace() {
  const t = $('doctitle');
  if (!session.path || t.isContentEditable) return;
  const was = session.name;
  t.textContent = was;
  t.contentEditable = 'plaintext-only';
  t.classList.add('editing');
  t.focus();
  getSelection().selectAllChildren(t);
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    $('top').classList.remove('renaming');
    t.removeEventListener('keydown', onKey);
    t.removeEventListener('blur', onBlur);
    removeEventListener('mousedown', onDown, true);
    t.contentEditable = 'false';
    t.classList.remove('editing');
    getSelection().removeAllRanges();
    const name = t.textContent.replace(/\s+/g, ' ').trim();
    renderTitle();
    input.focus();
    if (!keep || !name || name === was) return;
    t.textContent = name; // shown at once; the disk catches up
    const doc = session.doc, from = session.path; // (another screenplay opened meanwhile is left alone)
    await session.flushAll();
    if (session.doc !== doc || session.path !== from) return renderTitle();
    const r = await api.invoke('doc:rename', { path: from, name, backupDir: doc.settings.backup.dir });
    if (!r.ok) { renderTitle(); return dlg.alertBox('RENAME FAILED', r.error); }
    if (session.doc === doc && session.path === from) session.path = r.path;
    renderTitle(); session.emit();
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  // Any click outside ends it, the menus and toolbar too: they keep the focus where it is, so the
  // title would never blur. The title bar stops dragging the window meanwhile, or a click on it
  // would never reach the page.
  const onDown = (e) => {
    if (t.contains(e.target)) return;
    if (e.target.closest('#top')) e.preventDefault(); // the bar takes no focus: typing goes on in the script
    finish(true);
  };
  $('top').classList.add('renaming');
  t.addEventListener('keydown', onKey);
  t.addEventListener('blur', onBlur);
  addEventListener('mousedown', onDown, true);
  fitTitle();
}
$('brand').addEventListener('click', () => cmd.run('changelog'));
// The title is centred on the window; it gets equal room on both sides, up to wherever the menus
// (or the window controls) begin; a long title is shortened with an ellipsis. Only in a window so
// narrow that hardly any centred room is left does it use the space between them instead.
function fitTitle() {
  const menus = $('menubar').getBoundingClientRect().right, controls = $('drag').offsetWidth;
  const top = $('top');
  top.style.setProperty('--title-side', Math.max(menus, controls) + 16 + 'px');
  top.style.setProperty('--title-left', menus + 16 + 'px');
  top.style.setProperty('--title-right', controls + 16 + 'px');
  const need = $('doctitle').scrollWidth + 15; // + the saved/unsaved square
  const centred = window.innerWidth - 2 * (Math.max(menus, controls) + 16);
  top.classList.toggle('narrow', centred < 160 && need > centred);
}
new ResizeObserver(fitTitle).observe($('menubar'));
window.addEventListener('resize', fitTitle);
fitTitle();

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
  keepPlace(true);
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
  writing.describe(session.doc.meta.id, { title: session.name, path: session.path, from: oldId });
  renderTitle();
  return true;
}

/** Opens a screenplay; true once it is open. `quiet`: a file that can't be read is skipped without a word. */
/** Open a screenplay. `quiet`: no message if it can't be read. `onlyOver`: only in place of that
 *  document, untouched (the reopening on launch gives way to anything the writer does meanwhile). */
async function openPath(file, { quiet = false, onlyOver = null } = {}) {
  const movedOn = () => onlyOver && (session.doc !== onlyOver || session.dirty);
  if (/\.fdx$/i.test(file)) return importFdx(file);
  if (onlyOver ? movedOn() : !(await releaseCurrent())) return false; // (in place of an untouched document there is nothing to release)
  const r = await Session.readFile(file);
  if (movedOn()) return false;
  if (!r.ok) {
    if (quiet) return false;
    const v = await dlg.choose('CANNOT OPEN', `${file}\n\n${r.error}`, [{ label: 'Close', value: null }, { label: 'Look for backups…', value: 'backups', primary: true }]);
    if (v === 'backups') await restoreFromBackups({ path: file, id: '', dir: null }, true);
    return false;
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
        return true;
      }
    } else if (v === 'discard') {
      await api.invoke('recovery:clear', pending.id);
    }
  }
  if (movedOn()) return false;
  session.load(r.doc, file);
  if (r.warnings.length) dlg.alertBox('OPENED WITH WARNINGS', 'The document was opened, but some parts needed repair:', [...new Set(r.warnings)].join('\n'));
  return true;
}

async function newDoc() {
  if (!(await releaseCurrent())) return;
  const dir = await api.invoke('path:default-dir');
  const cfg = await dialogs.setupDialog({ dir, backup: newDocument().settings.backup });
  if (!cfg) return;
  const doc = newDocument(cfg.name === 'Untitled Screenplay' ? '' : cfg.name.toUpperCase());
  doc.settings.backup = cfg.backup;
  if (cfg.untitled) { session.load(doc, null); return; }
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

/** File > Import Final Draft: converts an .fdx into a new screenplay, saved where the writer says, with its backups. */
async function importFdx(file = null) {
  const r = await api.invoke('doc:import-fdx', file);
  if (!r) return false;
  let fd;
  try {
    if (!r.ok) throw new Error(r.error);
    fd = parseFdx(r.xml);
  } catch (e) {
    await dlg.alertBox('CANNOT IMPORT', `${r.file}\n\n${e.message}`);
    return false;
  }
  if (!(await releaseCurrent())) return false;
  let dir = await api.invoke('path:default-dir');
  let name = r.name;
  const doc = newDocument();
  for (;;) {
    const cfg = await dialogs.setupDialog({ title: 'IMPORT FINAL DRAFT', name, dir, backup: doc.settings.backup, allowUntitled: false, ok: 'Import' });
    if (!cfg) return false;
    ({ name, dir } = cfg);
    doc.settings.backup = cfg.backup;
    const target = await api.invoke('path:join', cfg.dir, cfg.name + '.stet');
    if (await api.invoke('doc:exists', target)) {
      await dlg.alertBox('FILE EXISTS', `${target} already exists. Choose another name or folder.`);
      continue;
    }
    doc.blocks = fd.blocks;
    doc.titlePage = fd.titlePage;
    if (!doc.titlePage.title) doc.titlePage.title = cfg.name.toUpperCase();
    doc.cast = fd.cast;
    session.load(doc, null);
    const w = await session.saveTo(target);
    if (!w.ok) { await dlg.alertBox('COULD NOT CREATE FILE', 'The screenplay is imported and open but not saved yet.', w.error); return true; }
    if (fd.warnings.length) dlg.alertBox('IMPORTED WITH CHANGES', 'The screenplay was imported. STET has no place for some parts of it:', fd.warnings.join('\n'));
    return true;
  }
}

/** File > Restore Backup: the open screenplay's backups (or, `asNew`, those of one that can't be opened).
 *  A backup chosen comes back as a new screenplay of its own, named after the one it came from and when
 *  it was made, saved by default in the same folder (with its own backups beside it): the one open now is
 *  left as it is, never replaced. */
async function restoreFromBackups(ref, asNew = false) {
  const name = asNew ? (ref.path || 'Untitled').split(/[\\/]/).pop().replace(/\.stet$/i, '') : session.name;
  const v = await dialogs.backupsDialog(ref, asNew ? (ref.path || 'untitled').split(/[\\/]/).pop() : session.name, {
    words: asNew ? null : editor.words,
    readWords: async (file) => { const r = await Session.readFile(file, 'backup:read'); return r.ok ? documentWords(r.doc.blocks) : null; },
    backupNow: () => (asNew ? Promise.resolve({ ok: false, error: 'This screenplay is not open.' }) : session.maybeBackup(true)),
    remove: (file) => api.invoke('backup:delete', { ref, file }),
    reveal: () => api.invoke('backup:reveal', ref),
  });
  if (!v || !v.file) return;
  const r = await Session.readFile(v.file, 'backup:read');
  if (!r.ok) { dlg.alertBox('BACKUP DAMAGED', 'This backup cannot be read. Try an older one.', r.error); return; }
  if (!asNew && !(await releaseCurrent())) return;
  let dir = ref.path ? ref.path.replace(/[\\/][^\\/]*$/, '') : await api.invoke('path:default-dir');
  let as = restoredName(name, v.time);
  const doc = r.doc;
  for (;;) {
    const cfg = await dialogs.setupDialog({ title: 'RESTORE AS NEW SCREENPLAY', name: as, dir, backup: doc.settings.backup, allowUntitled: false, ok: 'Restore' });
    if (!cfg) return;
    ({ name: as, dir } = cfg);
    const target = await api.invoke('path:join', cfg.dir, cfg.name + '.stet');
    if (await api.invoke('doc:exists', target)) {
      await dlg.alertBox('FILE EXISTS', `${target} already exists. Choose another name or folder: a restored backup never replaces a screenplay.`);
      continue;
    }
    doc.meta.id = uuid(); // (a screenplay of its own: its own recovery, statistics and backups)
    doc.settings.backup = cfg.backup;
    session.load(doc, null);
    const w = await session.saveTo(target);
    if (!w.ok) dlg.alertBox('COULD NOT CREATE FILE', 'The backup is open as a new screenplay but not saved yet.', w.error);
    return;
  }
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

// The note +NOTE made last, and the selection and script it was made for: pressed again before
// either changes, +NOTE goes back to that note instead of making a second one.
let lastNote = null;
function addNote() {
  const [s, e] = editor.ordered(), at = `${s.b}:${s.o}-${e.b}:${e.o}`;
  if (lastNote && lastNote.at === at && lastNote.rev === editor.rev && editor.commentAnchors().some((a) => a.id === lastNote.id)) { openNote(lastNote.id, true); return; }
  const id = uuid().slice(0, 8);
  const now = new Date().toISOString();
  session.doc.comments[id] = { text: '', created: now, modified: now };
  if (!editor.attachComment(id)) { delete session.doc.comments[id]; return; }
  lastNote = { id, at, rev: editor.rev };
  showPanel('notes', true);
  notes.lastKey = '';
  notes.render();
  notes.select(id, false, true);
}

function stepNote(dir) {
  const a = notes.step(dir);
  if (!a) return;
  jump(pos(a.b, a.s), true, null, 'key');
  view.activeComment = a.id;
  if (notes.visible) notes.select(a.id);
  view.invalidate();
}

function showPanel(which, on, keep = !focus.on) { // (what focus mode opens or closes is not remembered)
  const host = which === 'scenes' ? $('left') : $('right');
  const want = on ?? !isOpen(host);
  setPanel(host, want);
  $(which === 'scenes' ? 'btn-scenes' : 'btn-notes').classList.toggle('on', want);
  if (keep) api.invoke('settings:set', { panels: { [which]: want } });
  // The view's ResizeObserver re-centres and repaints only what moved; no full teardown.
  view.layoutDirty = true;
  view.schedule();
  if (want) (which === 'scenes' ? scenes : notes).refresh(true);
}

// Scenes are reached with the same glide as suggestions and notes, their heading at the top of the view.
const jumpScene = (b) => jump(pos(b, 0), false, null, 'top');
// The toolbar (View > Hide Toolbar) slides up out of the way, and back; the choice is kept.
function showToolbar(on) {
  setPanel($('elbar'), on);
  if (on) fitToolbar();
  view.layoutDirty = true;
  view.schedule();
  api.invoke('settings:set', { toolbar: on });
}

// Focus mode: full screen, the page alone (ui/focus.js).
const focus = new FocusMode({
  api,
  panels: [
    { key: 'rev', label: 'REVISE', title: 'Revise with Claude', isOpen: () => revision.visible, set: (on) => revision.show(on) },
    { key: 'scenes', label: 'SCENES', title: 'Scene navigator', isOpen: () => isOpen($('left')), set: (on) => showPanel('scenes', on) },
    { key: 'notes', label: 'NOTES', title: 'Comments', isOpen: () => isOpen($('right')), set: (on) => showPanel('notes', on) },
  ],
  onChange: () => { view.layoutDirty = true; view.schedule(); fitTitle(); input.focus(); },
});

function sceneStep(dir) {
  const s = editor.scenes();
  const c = editor.caret.b;
  const t = dir > 0 ? s.find((x) => x.b > c) : [...s].reverse().find((x) => x.b < c);
  if (t) jumpScene(t.b);
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
}

// ---- commands -----------------------------------------------------------------------------------

// The paragraphs a selection touches (or the caret's).
const selectedBlocks = () => (editor.hasSelection() ? editor._touched() : [editor.block]);
const typeCmds = TYPES.map((t, i) => ({ id: 'type-' + t, cat: 'Element', label: TYPE_LABEL[t], keys: `Ctrl+${i + 1}`, checked: () => selectedBlocks().every((b) => b.type === t), run: () => { editor.applyType(t); input.after(); input.focus(); } }));
// A highlight with no selection covers the whole paragraph.
function highlight(color) {
  if (!editor.hasSelection()) editor.setSel(pos(editor.caret.b, 0), pos(editor.caret.b, editor.block.text.length));
  editor.highlight(color); input.after(); input.focus();
}
const alignCmds = ALIGN_CMDS.map((x) => ({
  id: 'align-' + x.a, cat: 'Format', label: x.label, keys: x.keys, checked: () => alignOf(editor.block) === x.a,
  run: () => { editor.applyAlign(x.a); input.after(); input.focus(); },
}));
const hlCmds = HIGHLIGHT_COLORS.map((c, i) => ({ id: 'hl-' + c, cat: 'Format', label: `Highlight ${c}`, keys: `Alt+${i + 1}`, run: () => highlight(c) }));
// With a selection a style toggles across it; without one it applies to what is typed next.
const styleCmds = STYLE_CMDS.map((s) => ({
  id: 'style-' + s.k, cat: 'Format', label: s.label, keys: s.keys, checked: () => editor.styleActive(s.k),
  run: () => { editor.toggleStyle(s.k); input.after(); input.focus(); },
}));
styleCmds.push({ id: 'style-clear', cat: 'Format', label: 'Clear Formatting', keys: 'Ctrl+Shift+Space', run: () => { editor.clearStyles(); input.after(); input.focus(); } });

// The File menu's hover list of recent screenplays: one click opens one; the full Open Recent
// window (dismiss, move to bin, details) is still the row itself.
async function quickRecent() {
  const list = await api.invoke('recent:list');
  return list.slice(0, 10).map((r) => ({
    label: r.name, title: r.exists ? r.path : r.path + ' (not found)', disabled: !r.exists, current: r.path === session.path,
    run: () => { if (r.path !== session.path) openPath(r.path); },
  }));
}

cmd.register([
  { id: 'new', cat: 'File', label: 'New Screenplay…', keys: 'Ctrl+N', global: true, run: newDoc },
  { id: 'open', cat: 'File', label: 'Open…', keys: 'Ctrl+O', global: true, run: async () => { const f = await api.invoke('doc:open-dialog'); if (f) openPath(f); } },
  { id: 'recent', cat: 'File', label: 'Open Recent…', keys: 'Ctrl+Shift+O', global: true, sub: quickRecent, run: async () => {
    const f = await dialogs.recentDialog({
      list: () => api.invoke('recent:list'),
      dismiss: (p) => api.invoke('recent:dismiss', p),
      trash: (p) => api.invoke('recent:trash', p),
      reveal: (p) => api.invoke('shell:reveal', p),
      confirm: dlg.confirm, alert: dlg.alertBox, currentPath: session.path,
    });
    settings = await api.invoke('settings:get');
    if (f) openPath(f);
  } },
  { id: 'import-fdx', cat: 'File', label: 'Import Final Draft…', run: () => importFdx() },
  { id: 'save', cat: 'File', label: 'Save', keys: 'Ctrl+S', global: true, run: save },
  { id: 'save-as', cat: 'File', label: 'Save As…', keys: 'Ctrl+Shift+S', global: true, run: saveAs },
  { id: 'rename', cat: 'File', label: 'Rename…', enabled: () => !!session.path, run: () => renameInPlace() },
  { id: 'reveal', cat: 'File', label: 'Show in Folder', enabled: () => !!session.path, run: () => api.invoke('shell:reveal', session.path) },
  { id: 'backups', cat: 'File', label: 'Restore Backup…', keys: 'Ctrl+Shift+B', global: true, run: () => restoreFromBackups(session.ref()) },
  { id: 'backup-now', cat: 'File', label: 'Backup Now', run: async () => { const r = await session.maybeBackup(true); if (r && !r.ok) dlg.alertBox('BACKUP FAILED', 'The backup could not be written.', r.error); } },
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

  ...styleCmds,
  ...alignCmds,
  ...hlCmds,
  { id: 'hl-none', cat: 'Format', label: 'Remove Highlight', keys: 'Alt+0', run: () => highlight(null) },
  { id: 'note-add', cat: 'Format', label: 'Add Note', keys: 'Ctrl+Alt+M', global: true, run: addNote },
  { id: 'note-next', cat: 'Format', label: 'Next Note', keys: 'F8', global: true, run: () => stepNote(1) },
  { id: 'note-prev', cat: 'Format', label: 'Previous Note', keys: 'Shift+F8', global: true, run: () => stepNote(-1) },

  { id: 'palette', cat: 'View', label: 'Command Palette…', keys: ['Ctrl+K', 'Ctrl+Shift+P'], global: true, run: () => cmd.palette() },
  { id: 'theme-toggle', cat: 'View', label: () => (document.documentElement.dataset.theme === 'dark' ? 'Light Mode' : 'Dark Mode'), keys: 'Ctrl+Shift+L', global: true, run: () => setManualTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
  { id: 'theme-light', cat: 'View', label: 'Light Mode (manual)', run: () => setManualTheme('light') },
  { id: 'theme-dark', cat: 'View', label: 'Dark Mode (manual)', run: () => setManualTheme('dark') },
  { id: 'theme-auto', cat: 'View', label: () => (schedule().enabled ? 'Turn Off Automatic Theme' : 'Automatic Theme (Schedule)'), run: () => setAutoTheme(!schedule().enabled) },
  { id: 'theme-schedule', cat: 'View', label: 'Theme Schedule…', run: editSchedule },
  { id: 'zoom-in', cat: 'View', label: 'Zoom In', keys: ['Ctrl+=', 'Ctrl+Shift+='], global: true, run: () => { view.setZoom(stepZoom(view.z, 1)); renderZoom(); persistZoom(); } },
  { id: 'zoom-out', cat: 'View', label: 'Zoom Out', keys: 'Ctrl+-', global: true, run: () => { view.setZoom(stepZoom(view.z, -1)); renderZoom(); persistZoom(); } },
  { id: 'zoom-reset', cat: 'View', label: 'Actual Size (100%)', keys: 'Ctrl+0', global: true, run: () => { view.setZoom(1); renderZoom(); persistZoom(); } },
  { id: 'panel-scenes', cat: 'View', label: 'Scene Navigator', keys: 'Ctrl+\\', global: true, run: () => showPanel('scenes') },
  { id: 'panel-notes', cat: 'View', label: 'Notes Panel', keys: 'Ctrl+Shift+\\', global: true, run: () => showPanel('notes') },
  { id: 'toolbar', cat: 'View', label: () => (isOpen($('elbar')) ? 'Hide Toolbar' : 'Show Toolbar'), run: () => showToolbar(!isOpen($('elbar'))) },
  { id: 'focus', cat: 'View', label: () => (focus.on ? 'Leave Focus Mode' : 'Focus Mode'), keys: 'F11', global: true, run: () => focus.toggle() },
  { id: 'timeline', cat: 'View', label: () => (timeline.visible ? 'Hide Timeline' : 'Timeline'), keys: 'Ctrl+Shift+T', global: true, run: () => timeline.show() },
  { id: 'companion', cat: 'View', label: () => (dino && dino.enabled ? 'Hide Writing Companion' : 'Show Writing Companion'), run: () => { dino.setEnabled(!dino.enabled); api.invoke('settings:set', { companion: dino.enabled }); } },
  { id: 'note-lines', cat: 'View', label: () => (document.body.classList.contains('no-note-lines') ? 'Show Note Underlines' : 'Hide Note Underlines'), run: async () => { const on = document.body.classList.toggle('no-note-lines'); settings = await api.invoke('settings:set', { noteLines: !on }); } },
  { id: 'title-toggle', cat: 'View', label: () => (view.showTitle ? 'Hide Title Page' : 'Show Title Page'), run: () => { view.showTitle = !view.showTitle; api.invoke('settings:set', { showTitlePage: view.showTitle }); renderTitleBtn(); view.invalidate(); view.revealCaret(); } },
  { id: 'title-edit', cat: 'View', label: 'Edit Title Page', run: () => { if (!view.showTitle) { view.showTitle = true; renderTitleBtn(); view.invalidate(); } view.scroller.scrollTop = 0; view.frame(); setTimeout(() => { const f = document.querySelector('.tp-f'); if (f) f.focus(); }, 30); } },
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
    trackWords();
    await dialogs.statsDialog({
      summary: (offset) => writing.summary(settings.goals, offset),
      words: () => editor.words,
      notice: () => writing.notice || (writing.readOnly ? 'Statistics are read-only in this version.' : null),
      saveGoals: async (goals) => { settings = await api.invoke('settings:set', { goals }); renderGoal(); },
      reset: async () => { const r = await writing.reset(); renderGoal(); return r; },
    });
  } },
  { id: 'revise-panel', cat: 'Tools', label: () => (revision.visible ? 'Hide Revise' : 'Revise'), keys: 'Ctrl+Shift+R', global: true, run: () => revision.show() },
  { id: 'revise-run', cat: 'Tools', label: 'Review the Script with Claude…', run: () => { revision.show(true); revision.start(); } },
  { id: 'revise-next', cat: 'Tools', label: 'Next Suggestion', keys: 'F7', global: true, run: () => revision.step(1) },
  { id: 'revise-prev', cat: 'Tools', label: 'Previous Suggestion', keys: 'Shift+F7', global: true, run: () => revision.step(-1) },
  { id: 'spell-toggle', cat: 'Tools', label: 'Spelling', checked: () => spelling.opts.on, run: () => spelling.set({ on: !spelling.opts.on }) },
  { id: 'spell-suggest', cat: 'Tools', label: 'Spelling Suggestions', checked: () => spelling.opts.suggest, enabled: () => spelling.opts.on, run: () => spelling.set({ suggest: !spelling.opts.suggest }) },
  { id: 'spell-auto', cat: 'Tools', label: 'Correct Spelling as You Type', checked: () => spelling.opts.auto, enabled: () => spelling.opts.on, run: () => spelling.set({ auto: !spelling.opts.auto }) },
  { id: 'revise-guides', cat: 'Tools', label: 'Revise Guidelines…', run: () => guidelinesDialog(revision) },
  { id: 'spell-dict', cat: 'Tools', label: 'Spelling Dictionary…', run: () => spelling.listsDialog() },
  { id: 'claude-key', cat: 'Tools', label: 'Claude Connection…', run: () => keyDialog() },
  { id: 'perf', cat: 'Tools', label: 'Run Performance Probe', run: () => runPerfProbe({ editor, view, input, session, writing, api, report: false, ...(info.e2e && window.__stetPerfSizes ? { sizes: window.__stetPerfSizes } : {}) }) },

  { id: 'keys', cat: 'Help', label: 'Keyboard Shortcuts', keys: 'F1', global: true, run: () => dialogs.shortcutsDialog({
    cmds: cmd.all(), keymap: cmd.keymap,
    save: (shortcuts) => { cmd.changed(); api.invoke('settings:set', { shortcuts: null }).then(() => api.invoke('settings:set', { shortcuts })).then((v) => { settings = v; }); },
  }) },
  { id: 'changelog', cat: 'Help', label: 'Changelog', run: async () => dialogs.changelogDialog(await api.invoke('app:changelog'), info.version) },
  { id: 'check-updates', cat: 'Help', label: 'Check for Updates…', run: () => updates.check(true) },
  { id: 'link-files', cat: 'Help', label: 'Open .stet Files with STET', run: async () => {
    let r;
    try { r = await api.invoke('app:link-files', session.path); } catch { r = { ok: false, error: 'STET could not link .stet files.' }; }
    dlg.alertBox('STET FILES', r.ok ? r.message : r.error);
  } },
  { id: 'github', cat: 'Help', label: 'STET on GitHub', run: () => api.invoke('app:open-url', 'repo') },
  { id: 'about', cat: 'Help', label: 'About STET', run: () => dlg.alertBox('STET ' + info.version + ' β', 'A fast, minimal, dependable screenwriting instrument. Built on Electron ' + info.electron + '.', `Settings & recovery: ${info.userData}`) },
]);

cmd.setShortcuts(settings.shortcuts);
cmd.onShortcuts(renderTips);
renderTips();

cmd.buildMenubar($('menubar'), [
  { label: 'File', items: () => ['new', 'open', 'recent', 'import-fdx', '-', 'save', 'save-as', 'rename', 'reveal', '-', 'backups', 'backup-now', 'recover', '-', 'print', 'export-pdf', '-', 'prefs'] },
  { label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'select-all', '-', 'find', 'replace', 'find-next', 'find-prev'] },
  { label: 'Element', items: [...typeCmds.map((c) => c.id), '-', 'type-cycle'] },
  { label: 'Format', items: [...styleCmds.map((c) => c.id), '-', ...alignCmds.map((c) => c.id), '-', ...hlCmds.map((c) => c.id), 'hl-none', '-', 'note-add', 'note-next', 'note-prev'] },
  { label: 'View', items: () => ['palette', '-', 'theme-toggle', 'theme-auto', 'theme-schedule', 'zoom-in', 'zoom-out', 'zoom-reset', '-', 'focus', 'toolbar', 'panel-scenes', 'panel-notes', 'timeline', 'note-lines', 'title-toggle', 'title-edit', 'companion', '-', 'goto-page', 'scene-next', 'scene-prev'] },
  { label: 'Tools', items: () => ['stats', '-', 'revise-panel', 'revise-run', 'revise-next', 'revise-prev', 'revise-guides', 'claude-key', '-', 'spell-toggle', 'spell-suggest', 'spell-auto', 'spell-dict', '-', 'perf'] },
  { label: 'Help', items: ['keys', 'changelog', '-', 'check-updates', ...(info.platform === 'win32' || info.platform === 'darwin' ? ['link-files'] : []), 'github', '-', 'about'] },
]);

// Global shortcuts when focus is outside the editor (title page fields, notes, panels).
window.addEventListener('keydown', (e) => {
  if (e.target === $('input') || dlg.isOpen()) return;
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!cmd.waiting() && !e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) return;
  // Inside text fields only application-level commands run; editing keys stay with the field.
  const r = cmd.resolve(e);
  if (!r) return;
  if (r.pending) { e.preventDefault(); return; } // the first keys of a longer shortcut
  const c = r.cmd;
  if (inField && (!c.global || !isGlobalKey(e))) return;
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

// Everything STET does before it closes: statistics written, the screenplay saved (or a
// never-saved one asked about). false if the person cancelled.
async function prepareQuit() {
  trackWords();
  await keepPlace(true);
  await writing.flush();
  await api.invoke('stats:flush');
  if (!(await releaseCurrent())) return false;
  if (!session.dirty) await session.clearRecovery();
  return true;
}
api.on('app:before-close', async () => {
  api.invoke((await prepareQuit()) ? 'app:close-ready' : 'app:close-cancel');
});

const updates = initUpdates({
  api, button: $('st-update'), prepareQuit,
  getSettings: () => settings,
  saveSettings: async (patch) => { settings = await api.invoke('settings:set', patch); },
});
api.on('app:open-file', (file) => openPath(file));
api.on('app:fullscreen', (on) => { document.documentElement.classList.toggle('fullscreen', on); fitTitle(); focus.fullscreenChanged(on); }); // a Mac hides its window buttons
api.on('perf:start', () => runPerfProbe({ editor, view, input, session, writing, api, report: true }));

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.(stet|fdx)$/i.test(f.name)) openPath(api.pathForFile(f));
});

// Test hook for the end-to-end driver (only with --e2e).
if (info.e2e) window.__stet = { editor, view, session, input, writing, notes, cmd, revision, timeline, spelling, focus, openPath, importFdx, save, exportPdf, checkRecovery, api, renderGoal, settings: () => settings, get dino() { return dino; } };

// ---- startup -----------------------------------------------------------------------------------------

refreshTheme();
session.autosave = settings.autosave;
session.autosaveDelay = settings.autosaveDelayMs;
if (settings.zoom && settings.zoom !== 1) view.setZoom(settings.zoom);
renderZoom();
if (settings.toolbar === false) { $('elbar').hidden = true; $('elbar').dataset.open = '0'; }
if (settings.panels?.scenes) showPanel('scenes', true);
setTabTypes(Array.isArray(settings.tabTypes) ? settings.tabTypes : TYPES, false);
if (document.fonts) document.fonts.ready.then(renderTabTypes);
// The writing companion above TODAY: fed by trackWords() and the TODAY numbers.
dino = new Dino({ anchor: $('st-goal'), area: $('scroller'), getProgress: () => goalState });
// Dormant (deep asleep, the app long in the background, or just long minimised): the app rests with
// it. CSS animations pause and the polls and the clock slow down; focus brings everything back at
// once (Dino tells us first).
dino.onDormant = (on) => {
  document.documentElement.classList.toggle('dormant', on);
  polls(on);
  if (!on) { renderGoal(); refreshTheme(); }
};
dino.setEnabled(settings.companion !== false);
if (settings.panels?.notes) showPanel('notes', true);
if (settings.timeline) timeline.show(true);

session.newUntitled();
spelling.init();
renderGoal();
input.focus();

if (info.sample) {
  const { sampleDocument } = await import('../dev/sample.js');
  session.load(sampleDocument(), null);
} else if (!info.perf && !info.shot) {
  const recovered = await checkRecovery(true);
  if (!recovered) {
    // A file STET was launched with, or else the last screenplay edited (then the newest entry in
    // Open Recent) that can still be opened.
    const pending = await api.invoke('app:pending-open');
    const blank = session.doc;
    if (pending) await openPath(pending);
    else for (const p of launchOrder(settings.recent, settings.lastEdited)) if (session.doc !== blank || await openPath(p, { quiet: true, onlyOver: blank })) break;
  }
}
// Shown once it is all in place and painted, the fonts in (main.js keeps the window hidden till then).
await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 400))]);
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
started();
if (info.e2e) window.__stet.started = true; // the tests begin once STET has finished starting
// The first start of each version: a short word that STET is a free beta, written with AI, used at one's own risk.
if (!info.e2e && !info.perf && !info.shot && settings.betaNotice !== info.version) {
  setTimeout(async () => {
    await dlg.open({
      title: `STET ${info.version} β`,
      cls: 'beta-note',
      body: dlg.h('div', { class: 'body' },
        dlg.h('p', {}, 'STET is a free beta, written largely with AI tools. It may have bugs, so keep backups of your work.'),
        dlg.h('p', { class: 'fine' }, 'It is provided "as is", without warranty of any kind. You use it at your own risk: its author is not liable for any loss of work, data or any other damage arising from its use.')),
      buttons: [{ label: 'I understand', value: true, primary: true }],
    });
    settings = await api.invoke('settings:set', { betaNotice: info.version });
  }, 450);
}
if (info.run) setTimeout(() => cmd.run(info.run), 300);
if (info.updateCheck && settings.updateCheck !== false) setTimeout(() => updates.check(false), info.updateDelay);

