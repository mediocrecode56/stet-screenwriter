// Application dialogs. Each returns a promise and never blocks typing state.

import { h, open, esc, alertBox } from './dialog.js';
import { buildPrintPages, parseRange, hasTitlePage } from '../../core/printmodel.js';
import { paginate } from '../../core/layout.js';
import { parseTime, formatTime, toAmPm, fromAmPm, label as timeLabel } from '../../core/schedule.js';
import { fmtWords, weekScale } from '../../core/chart.js';

const api = window.stet;
/** When a project was last opened, short enough for its column: today 10:23 · Oct 20, 10:23 · Oct 20, 2025. */
function fmtWhen(t) {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'today ' + time;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
const fmtTime = (t) => new Date(t).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');

function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), h('div', {}, control, hint ? h('div', { class: 'hint' }, hint) : null));
}

/**
 * New document / first save setup. Returns
 * { name, dir, backup: {enabled, intervalMin, retentionDays, dir} , untitled } or null.
 */
export async function setupDialog({ title = 'NEW SCREENPLAY', name = 'Untitled Screenplay', dir, backup, allowUntitled = true }) {
  const nameIn = h('input', { type: 'text', value: name, spellcheck: false });
  const dirIn = h('input', { type: 'text', value: dir, spellcheck: false });
  const browse = h('button', { class: 'btn', onclick: async () => { const d = await api.invoke('dialog:folder', dirIn.value); if (d) { dirIn.value = d; upd(); } } }, 'Browse');
  const bkOn = h('input', { type: 'checkbox', checked: backup.enabled });
  const every = h('input', { type: 'number', min: 1, max: 120, value: backup.intervalMin, style: 'width:70px' });
  const keep = h('input', { type: 'number', min: 1, max: 3650, value: backup.retentionDays, style: 'width:70px' });
  const custom = h('input', { type: 'checkbox', checked: !!backup.dir });
  const bkDir = h('input', { type: 'text', value: backup.dir || '', placeholder: 'folder for backups', spellcheck: false });
  const bkBrowse = h('button', { class: 'btn', onclick: async () => { const d = await api.invoke('dialog:folder', bkDir.value || dirIn.value); if (d) { bkDir.value = d; custom.checked = true; upd(); } } }, 'Browse');
  const where = h('div', { class: 'hint' });
  const upd = () => {
    const n = nameIn.value.trim() || 'Untitled';
    const sep = api.platform === 'win32' ? '\\' : '/';
    where.textContent = custom.checked && bkDir.value ? `Backups → ${bkDir.value}${sep}${n} Backups${sep}` : `Backups → ${dirIn.value}${sep}${n} Backups${sep}  (next to the script)`;
    bkDir.disabled = bkBrowse.disabled = !custom.checked;
  };
  for (const x of [nameIn, dirIn, bkDir]) x.addEventListener('input', upd);
  custom.addEventListener('change', upd);
  upd();
  const body = h('div', { class: 'body' },
    field('Name', nameIn),
    field('Save in', h('div', { class: 'inline' }, dirIn, browse)),
    h('div', { style: 'height:8px' }),
    field('Auto backups', h('div', { class: 'inline' }, h('label', { class: 'chk' }, bkOn, 'on'), h('span', {}, 'every'), every, h('span', {}, 'min · keep'), keep, h('span', {}, 'days'))),
    field('Backup folder', h('div', { class: 'inline' }, h('label', { class: 'chk' }, custom, 'custom'), bkDir, bkBrowse), where),
  );
  const buttons = [{ label: 'Cancel', value: null }];
  if (allowUntitled) buttons.push({ label: 'Not now', value: 'untitled' });
  buttons.push({ label: 'Create', value: 'ok', primary: true });
  const v = await open({ title, sub: 'name · location · backups', body, buttons, foot: allowUntitled ? 'Not now: write without a file — protected by crash recovery' : '' });
  if (!v) return null;
  const cfg = {
    name: (nameIn.value.trim() || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, ''),
    dir: dirIn.value.trim(),
    backup: {
      enabled: bkOn.checked,
      intervalMin: Math.max(1, Math.min(120, +every.value || 5)),
      retentionDays: Math.max(1, Math.min(3650, +keep.value || 30)),
      dir: custom.checked && bkDir.value.trim() ? bkDir.value.trim() : null,
    },
    untitled: v === 'untitled',
  };
  return cfg;
}

/** Hour / minute / AM-PM picker for "HH:MM". Returns { node, value() }. */
function timePicker(hhmm) {
  const t = toAmPm(parseTime(hhmm) ?? 0);
  const hour = h('select', {}, ...Array.from({ length: 12 }, (_, i) => i + 1).map((n) => h('option', { value: n, selected: n === t.hour }, String(n))));
  const minute = h('select', {}, ...Array.from({ length: 12 }, (_, i) => i * 5).concat(t.minute % 5 ? [t.minute] : []).sort((a, b) => a - b)
    .map((n) => h('option', { value: n, selected: n === t.minute }, String(n).padStart(2, '0'))));
  const ampm = h('select', {}, ...['AM', 'PM'].map((x) => h('option', { value: x, selected: x === t.ampm }, x)));
  for (const x of [hour, minute, ampm]) x.style.width = 'auto';
  return { node: h('span', { class: 'inline tp' }, hour, h('span', {}, ':'), minute, ampm), value: () => formatTime(fromAmPm(+hour.value, +minute.value, ampm.value)), els: [hour, minute, ampm] };
}

/** Schedule section shared by Preferences and the quick schedule dialog. */
function scheduleFields(sched) {
  const on = h('input', { type: 'checkbox', checked: !!sched.enabled });
  const dark = timePicker(sched.darkAt), light = timePicker(sched.lightAt);
  const hint = h('div', { class: 'hint' });
  const upd = () => {
    const d = dark.value(), l = light.value();
    hint.textContent = d === l ? 'Both times are the same: the schedule would stay light. Pick different times.'
      : `Dark from ${timeLabel(d)} until ${timeLabel(l)}${parseTime(d) > parseTime(l) ? ' the next morning' : ''}; light the rest of the day. Uses this computer's clock and time zone. Picking LIGHT or DARK by hand turns the schedule off.`;
  };
  for (const x of [...dark.els, ...light.els]) x.addEventListener('change', upd);
  upd();
  return {
    nodes: [
      field('Automatic theme', h('label', { class: 'chk' }, on, 'switch on a schedule')),
      field('Dark mode from', dark.node),
      field('Light mode from', light.node, hint),
    ],
    value: () => ({ enabled: on.checked, darkAt: dark.value(), lightAt: light.value() }),
  };
}

export async function scheduleDialog(sched) {
  const f = scheduleFields({ ...sched, enabled: true });
  const v = await open({ title: 'THEME SCHEDULE', sub: 'local time', body: h('div', { class: 'body' }, ...f.nodes), buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', value: true, primary: true }] });
  return v ? f.value() : null;
}

export async function preferencesDialog(settings, doc) {
  const sched = scheduleFields({ enabled: false, darkAt: '19:00', lightAt: '07:00', ...(settings.schedule || {}) });
  const theme = h('select', {}, ...['dark', 'light', 'system'].map((t) => h('option', { value: t, selected: settings.theme === t }, t)));
  const dirIn = h('input', { type: 'text', value: settings.defaultDir || '', spellcheck: false });
  const browse = h('button', { class: 'btn', onclick: async () => { const d = await api.invoke('dialog:folder', dirIn.value); if (d) dirIn.value = d; } }, 'Browse');
  const auto = h('input', { type: 'checkbox', checked: settings.autosave });
  const delay = h('input', { type: 'number', min: 300, max: 60000, step: 100, value: settings.autosaveDelayMs, style: 'width:90px' });
  const daily = h('input', { type: 'number', min: 0, max: 100000, value: settings.goals.daily, style: 'width:90px' });
  const weekly = h('input', { type: 'number', min: 0, max: 700000, value: settings.goals.weekly, style: 'width:90px' });
  const cap = h('input', { type: 'checkbox', checked: doc.settings.autoCapitalize });
  const dbl = h('input', { type: 'checkbox', checked: doc.settings.sceneSpacing === 2 });
  const bkOn = h('input', { type: 'checkbox', checked: doc.settings.backup.enabled });
  const every = h('input', { type: 'number', min: 1, max: 120, value: doc.settings.backup.intervalMin, style: 'width:70px' });
  const keep = h('input', { type: 'number', min: 1, max: 3650, value: doc.settings.backup.retentionDays, style: 'width:70px' });
  const body = h('div', { class: 'body' },
    h('div', { class: 'hint', style: 'margin-bottom:6px' }, 'APPLICATION'),
    field('Theme', theme),
    ...sched.nodes,
    field('Default save folder', h('div', { class: 'inline' }, dirIn, browse)),
    field('Autosave', h('div', { class: 'inline' }, h('label', { class: 'chk' }, auto, 'on'), h('span', {}, 'after'), delay, h('span', {}, 'ms idle'))),
    field('Daily goal', h('div', { class: 'inline' }, daily, h('span', {}, 'words'))),
    field('Weekly goal', h('div', { class: 'inline' }, weekly, h('span', {}, 'words'))),
    h('div', { class: 'hint', style: 'margin:12px 0 6px' }, 'THIS SCREENPLAY'),
    field('Character names', h('label', { class: 'chk' }, cap, 'capitalize on first appearance in action')),
    field('Scene headings', h('label', { class: 'chk' }, dbl, 'two blank lines before')),
    field('Auto backups', h('div', { class: 'inline' }, h('label', { class: 'chk' }, bkOn, 'on'), h('span', {}, 'every'), every, h('span', {}, 'min · keep'), keep, h('span', {}, 'days'))),
  );
  const v = await open({ title: 'PREFERENCES', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', value: true, primary: true }] });
  if (!v) return null;
  return {
    app: {
      theme: theme.value,
      schedule: sched.value(),
      defaultDir: dirIn.value.trim() || null,
      autosave: auto.checked,
      autosaveDelayMs: Math.max(300, Math.min(60000, +delay.value || 1200)),
      goals: { daily: Math.max(0, +daily.value || 0), weekly: Math.max(0, +weekly.value || 0) },
    },
    doc: {
      autoCapitalize: cap.checked,
      sceneSpacing: dbl.checked ? 2 : 1,
      backup: { ...doc.settings.backup, enabled: bkOn.checked, intervalMin: Math.max(1, +every.value || 5), retentionDays: Math.max(1, +keep.value || 30) },
    },
  };
}

/** Lists backups; resolves with the chosen backup file or null. */
export async function backupsDialog(ref, currentName) {
  const list = await api.invoke('backup:list', ref);
  const dir = await api.invoke('backup:dir', ref);
  let chosen = list[0] ? list[0].file : null;
  const rows = list.map((b) => {
    const tr = h('tr', { class: 'pick' + (b.file === chosen ? ' on' : '') }, h('td', {}, fmtTime(b.time)), h('td', {}, fmtSize(b.size)), h('td', {}, b.name));
    tr.addEventListener('click', () => { chosen = b.file; for (const r of tbody.children) r.classList.remove('on'); tr.classList.add('on'); });
    tr.addEventListener('dblclick', () => { chosen = b.file; document.querySelector('.dlg .btn.primary').click(); });
    return tr;
  });
  const tbody = h('tbody', {}, ...rows);
  const body = h('div', { class: 'body' },
    h('div', { class: 'hint', style: 'margin-bottom:8px' }, dir),
    list.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'saved'), h('th', {}, 'size'), h('th', {}, 'file'))), tbody)
      : h('div', { class: 'empty' }, 'No backups yet. One is made every few minutes while you write, or use Backup Now.'),
  );
  return open({
    title: 'BACKUPS', sub: currentName, body,
    buttons: [
      { label: 'Open folder', value: 'reveal' },
      { label: 'Backup now', value: 'now' },
      { label: 'Close', value: null },
      { label: 'Restore…', value: () => (chosen ? { file: chosen } : null), primary: true, disabled: !list.length },
    ],
  });
}

/** Startup recovery prompt. Resolves with { action: 'restore'|'discard'|'later', item }. */
export async function recoveryDialog(items) {
  let chosen = items[0];
  const tbody = h('tbody', {}, ...items.map((it) => {
    const tr = h('tr', { class: 'pick' + (it === chosen ? ' on' : '') }, h('td', {}, it.name || 'Untitled'), h('td', {}, it.path || '(never saved)'), h('td', {}, fmtTime(it.time)));
    tr.addEventListener('click', () => { chosen = it; for (const r of tbody.children) r.classList.remove('on'); tr.classList.add('on'); });
    return tr;
  }));
  const body = h('div', { class: 'body' },
    h('p', {}, 'STET did not close cleanly. These documents have changes that were not saved to their files:'),
    h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'document'), h('th', {}, 'file'), h('th', {}, 'last change'))), tbody),
    h('p', { class: 'hint' }, 'Restore opens the recovered text. Nothing is overwritten until it is saved.'));
  const v = await open({
    title: 'RECOVER WORK', body,
    buttons: [{ label: 'Discard', value: 'discard' }, { label: 'Later', value: 'later' }, { label: 'Restore', value: 'restore', primary: true }],
  });
  return { action: v || 'later', item: chosen };
}

/**
 * The writing week, laid out symmetrically: two equal boxes (the week, today),
 * a centred day-by-day chart with the numbers on the bars, a word scale and the
 * daily goal as a dashed line, and the goals. Reset lives here
 * (and only here), behind its own confirmation.
 * `api` = { summary(offset), notice(), saveGoals(goals), reset() }.
 */
export async function statsDialog(api) {
  let offset = 0, flash = '';
  for (;;) {
    const s = api.summary(offset);
    const goalIn = h('input', { type: 'number', value: s.goals.daily, min: 0, step: 50, class: 'wk-in' });
    const weekIn = h('input', { type: 'number', value: s.goals.weekly, min: 0, step: 250, class: 'wk-in' });
    // The two goals move together, keeping the ratio they have now (5 writing days a week if either is unset).
    const ratio = s.goals.daily > 0 && s.goals.weekly > 0 ? s.goals.weekly / s.goals.daily : 5;
    goalIn.addEventListener('input', () => { weekIn.value = Math.max(0, Math.round((+goalIn.value || 0) * ratio)); });
    weekIn.addEventListener('input', () => { goalIn.value = Math.max(0, Math.round((+weekIn.value || 0) / ratio)); });
    let close = () => {};
    const nav = (d) => h('button', { class: 'tb wk-nav', title: d < 0 ? 'Previous week' : 'Next week', disabled: d < 0 ? !s.hasEarlier : s.week.current, onclick: () => close('nav' + d) }, d < 0 ? '‹' : '›');
    const resetBtn = h('button', { class: 'tb wk-reset', title: 'Clear all recorded writing statistics (asks first)', onclick: () => close('reset') }, 'RESET STATISTICS…');
    const notice = api.notice();
    const body = h('div', { class: 'body wk' },
      notice ? h('div', { class: 'wk-notice' }, notice) : null,
      flash ? h('div', { class: 'wk-flash' }, flash) : null,
      weekHeader(s, nav),
      weekChart(s),
      h('div', { class: 'wk-goals' },
        h('div', { class: 'wk-g' }, h('span', { class: 'wk-k' }, 'DAILY GOAL'), goalIn), h('div', { class: 'wk-g' }, h('span', { class: 'wk-k' }, 'WEEKLY GOAL'), weekIn)),
    );
    flash = '';
    const v = await open({
      // All-time words, small beside the title.
      title: ['WRITING', h('span', { class: 'wk-all', title: `Every word recorded since ${fmtDate(s.since, true)}` }, `all-time ${fmtWords(s.total)}`)], sub: weekLabel(s.week), body, cls: 'wk-dlg', foot: resetBtn,
      buttons: [{ label: 'Close', value: null }, { label: 'Save goals', primary: true, value: () => ({ goals: { daily: Math.max(0, Math.round(+goalIn.value) || 0), weekly: Math.max(0, Math.round(+weekIn.value) || 0) } }) }],
      init: (_dlg, c) => { close = c; },
    });
    if (v === 'nav-1') { offset--; continue; }
    if (v === 'nav1') { offset = Math.min(0, offset + 1); continue; }
    if (v && v.goals) { await api.saveGoals(v.goals); return; } // saved: done
    if (v === 'reset') {
      if (await confirmReset(s)) {
        const r = await api.reset();
        if (r.ok) { offset = 0; flash = 'Statistics reset. Recording starts again from now.'; }
        else await alertBox('RESET FAILED', 'Nothing was cleared — your writing statistics are exactly as they were.', r.error);
      }
      continue;
    }
    return;
  }
}

/** Second, explicit step of Reset. Only the Reset button confirms; Cancel, Escape and clicking outside don't. */
function confirmReset(s) {
  const body = h('div', { class: 'body', style: 'max-width:520px' },
    h('p', { class: 'wk-q' }, 'Reset all writing statistics?'),
    h('p', {}, `This clears every word recorded as written — each day and week, the totals for each screenplay, and the all-time total of ${s.total.toLocaleString()} words since ${fmtDate(s.since, true)}. Recording starts again from zero.`),
    h('p', {}, h('b', {}, 'Not affected: '), 'your screenplays and their word counts, your daily and weekly goals, and your writing streak.'),
    h('p', { class: 'hint' }, 'A copy of the cleared statistics is kept in STET’s data folder, but STET will not show them again.'));
  return open({ title: 'RESET STATISTICS', body, cls: 'wk-confirm', buttons: [{ label: 'Cancel', value: false }, { label: 'Reset statistics', value: true, cls: 'danger' }] }).then((v) => v === true);
}

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(k, year = false) { const [y, m, d] = k.split('-').map(Number); return `${d} ${MONTHS[m - 1]}${year ? ' ' + y : ''}`; }
function weekLabel(w) { return `${fmtDate(w.start)} – ${fmtDate(w.end, true)}`; }

/** The count and its target: the count large, the target small and quieter. */
function figure(value, target, none) {
  return h('div', { class: 'wk-n' }, value, target ? h('small', {}, ` / ${target}`) : h('small', { class: 'wk-none' }, none));
}

// The two boxes at the top show just three things: which day or week, the
// words written, and the target. Everything else lives further down.
function weekHeader(s, nav) {
  const w = s.week, wg = s.goals.weekly, dg = s.goals.daily;
  const left = h('div', { class: 'wk-big', title: wg ? `${w.total.toLocaleString()} of ${wg.toLocaleString()} words this week` : 'No weekly goal set' },
    h('div', { class: 'wk-k' }, nav(-1), h('span', {}, w.current ? 'THIS WEEK' : weekLabel(w).toUpperCase()), nav(1)),
    figure(fmtWords(w.total), wg && fmtWords(wg), 'no goal'));
  // Right: today in the current week; the daily average in a past one (same shape, so nothing jumps).
  let right;
  if (w.current) {
    const t = s.today.words, i = w.days.findIndex((d) => d.today);
    right = h('div', { class: 'wk-big wk-today', title: dg ? `${t.toLocaleString()} of ${dg.toLocaleString()} words today` : 'No daily goal set' },
      h('div', { class: 'wk-k' }, h('span', {}, `TODAY · ${DOW[i]} ${+s.today.day.slice(8)}`)),
      figure(fmtWords(t), dg && fmtWords(dg), 'no goal'));
  } else {
    const known = w.days.filter((d) => d.known && !d.future);
    const avg = known.length ? Math.round(w.total / known.length) : 0;
    right = h('div', { class: 'wk-big', title: known.length ? `Average over ${known.length} recorded day${known.length === 1 ? '' : 's'}` : 'No record for this week' },
      h('div', { class: 'wk-k' }, h('span', {}, 'DAILY AVERAGE')),
      figure(known.length ? fmtWords(avg) : '—', known.length && dg && fmtWords(dg), known.length ? 'no goal' : ''));
  }
  return h('div', { class: 'wk-head' }, left, right);
}

// Chart geometry (px). Bars are sized in pixels, not percentages, so a label
// can never squeeze a bar: every bar has the full BAR_H to scale against and
// its number sits in the band above it.
const BAR_H = 88, BAND = 16;

function weekChart(s) {
  const goal = s.goals.daily;
  const { top, px, over } = weekScale(s.week.days, goal, BAR_H);
  const plot = h('div', { class: 'wk-plot', style: `height:${BAR_H + BAND}px` });
  // Equal gutters either side keep the chart centred: the word scale on the left (gridlines at
  // half and full scale, the scale following the week), the daily goal's label on the right.
  const scale = h('div', { class: 'wk-axis wk-axis-l', style: `height:${BAR_H + BAND}px` });
  const marks = h('div', { class: 'wk-axis wk-axis-r', style: `height:${BAR_H + BAND}px` });
  for (const v of [0, top / 2, top]) {
    const y = px(v);
    if (v) plot.append(h('div', { class: 'wk-grid', style: `bottom:${y}px` }));
    scale.append(h('span', { class: 'wk-tick', style: `bottom:${y - 5}px` }, fmtWords(v, true)));
  }
  if (goal) {
    plot.append(h('div', { class: 'wk-goal', style: `bottom:${px(goal)}px`, title: `Daily goal: ${goal.toLocaleString()} words` }));
    marks.append(h('span', { class: 'wk-tick wk-goal-t', style: `bottom:${px(goal) - 5}px` }, 'goal'));
  }
  s.week.days.forEach((d, i) => {
    const state = d.future ? 'future' : !d.known ? 'na' : d.words === 0 ? 'zero' : goal && d.words >= goal ? 'met' : 'under';
    const label = d.future ? '' : !d.known ? '—' : fmtWords(d.words);
    const tip = d.future ? 'still to come' : !d.known ? 'no record (before statistics began)' : `${d.words.toLocaleString()} words${goal ? (d.words >= goal ? ` · goal met${d.words >= 2 * goal ? ` ${(Math.floor((d.words / goal) * 10) / 10).toLocaleString()}× over` : ''}` : ` · ${(goal - d.words).toLocaleString()} short of the goal`) : ''}`;
    const bh = d.known && !d.future ? px(d.words) : 0;
    plot.append(h('div', { class: `wk-col ${state}${d.today ? ' today' : ''}${d.known && !d.future && over(d.words) ? ' over' : ''}`, title: `${DOW[i]} ${fmtDate(d.day)}: ${tip}` },
      h('div', { class: 'wk-val', style: `bottom:${bh + 2}px` }, label),
      h('div', { class: 'wk-bar', style: `height:${bh}px` })));
  });
  const days = h('div', { class: 'wk-days' }, ...s.week.days.map((d, i) => h('div', { class: d.today ? 'today' : '' }, DOW[i], h('small', {}, ' ' + d.day.slice(8).replace(/^0/, '')))));
  return h('div', { class: 'wk-chart' }, h('div', { class: 'wk-frame' }, scale, plot, marks), days);
}

/**
 * Print preview with export options. `doc` is a live document snapshot.
 * Resolves with { action: 'pdf'|'print', options } or null.
 */
export async function previewDialog(doc, initial) {
  const opts = { titlePage: true, highlights: false, comments: false, range: '', ...initial };
  const total = paginate(doc.blocks, doc.settings).length;
  const tp = h('input', { type: 'checkbox', checked: opts.titlePage && hasTitlePage(doc.titlePage), disabled: !hasTitlePage(doc.titlePage) });
  const hl = h('input', { type: 'checkbox', checked: opts.highlights });
  const cm = h('input', { type: 'checkbox', checked: opts.comments });
  const range = h('input', { type: 'text', value: opts.range, placeholder: `all (1–${total})`, spellcheck: false });
  const msg = h('div', { class: 'hint' });
  const sheets = h('div', { class: 'sheets' });
  const scale = 0.42;
  let ok = true;
  const render = () => {
    try {
      parseRange(range.value, total);
      ok = true;
      msg.textContent = '';
    } catch (e) { ok = false; msg.textContent = e.message; sheets.replaceChildren(); updateButtons(); return; }
    const o = { titlePage: tp.checked, highlights: hl.checked, comments: cm.checked, range: range.value };
    const { pages } = buildPrintPages(doc, o);
    const frag = document.createDocumentFragment();
    const col = 9.6 * scale, row = 16 * scale;
    // Previewing hundreds of pages is wasteful; show the first 40 of the selection.
    for (const p of pages.slice(0, 40)) {
      let s = '';
      for (const r of p.rects) s += `<div class="mk hl-${r.color}" style="left:${r.col * col}px;top:${r.row * row}px;width:${r.w * col}px;height:${row}px"></div>`;
      for (const u of p.notes) s += `<div class="mk" style="left:${u.col * col}px;top:${u.row * row}px;width:${u.w * col}px;height:${row}px;border-bottom:1px dashed #000"></div>`;
      for (const l of p.lines) s += `<div class="l${l.st ? [...l.st].map((k) => ' s' + k).join('') : ''}" style="left:${l.col * col}px;top:${l.row * row}px">${esc(l.text)}</div>`;
      const cap = p.kind === 'title' ? 'title' : p.kind === 'notes' ? 'notes' : 'p.' + p.number;
      const sheet = h('div', { class: 'sheet', style: `width:${85 * col}px;height:${66 * row}px;font-size:${row}px`, html: s + `<div class="cap">${cap}</div>` });
      frag.appendChild(sheet);
    }
    sheets.replaceChildren(frag);
    msg.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'}${pages.length > 40 ? ' (showing first 40)' : ''}`;
    updateButtons();
  };
  let btns = [];
  const updateButtons = () => { for (const b of btns) b.disabled = !ok; };
  for (const x of [tp, hl, cm]) x.addEventListener('change', render);
  range.addEventListener('input', render);
  const body = h('div', { class: 'body' },
    h('div', { class: 'opts' },
      h('div', { class: 'field' }, h('label', {}, 'Pages'), range, h('div', { class: 'hint' }, 'e.g. 1-5, 9, 12-  · title page is not numbered')),
      h('label', { class: 'chk' }, tp, 'title page'),
      h('label', { class: 'chk' }, hl, 'highlights'),
      h('label', { class: 'chk' }, cm, 'notes (marked + listed at end)'),
      h('div', { style: 'height:10px' }), msg),
    sheets);
  const v = await open({
    title: 'PRINT / EXPORT', sub: `${total} script pages · US Letter · Courier 12`, cls: 'preview', body,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Print…', value: 'print' }, { label: 'Export PDF…', value: 'pdf', primary: true }],
    init: (d, close, b) => { btns = b.slice(1); setTimeout(render, 0); },
  });
  if (!v) return null;
  return { action: v, options: { titlePage: tp.checked, highlights: hl.checked, comments: cm.checked, range: range.value } };
}

// Renders the changelog's small Markdown subset: headings, paragraphs, lists
// (one nesting level), **bold**, *italics* and `code`.
export async function changelogDialog(md, version) {
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  let html = '', list = 0;
  const setList = (n) => { while (list < n) { html += '<ul>'; list++; } while (list > n) { html += '</ul>'; list--; } };
  for (const line of md.split('\n')) {
    const li = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (li) { setList(li[1].length >= 2 ? 2 : 1); html += `<li>${inline(li[2])}</li>`; continue; }
    if (!line.trim()) continue; // blank lines don't end a list item's group
    if (/^\s{2,}\S/.test(line) && list) { html += `<p class="li-p">${inline(line.trim())}</p>`; continue; }
    setList(0);
    if (/^#\s/.test(line)) continue;
    if (/^##\s/.test(line)) html += `<h3>${inline(line.replace(/^##\s*/, ''))}</h3>`;
    else if (/^###\s/.test(line)) html += `<h4>${inline(line.replace(/^###\s*/, ''))}</h4>`;
    else html += `<p>${inline(line)}</p>`;
  }
  setList(0);
  return open({ title: 'CHANGELOG', sub: 'v' + version, body: h('div', { class: 'body md', style: 'width:680px', html }), buttons: [{ label: 'Close', value: null, primary: true }] });
}

export async function shortcutsDialog(cmds) {
  const rows = cmds.filter((c) => c.keys && c.label).map((c) => h('tr', {}, h('td', {}, c.cat || ''), h('td', {}, typeof c.label === 'function' ? c.label() : c.label), h('td', {}, [].concat(c.keys).join('  ·  '))));
  const extra = [
    ['Write', 'Next element / convert empty element', 'Enter'], ['Write', 'Line break inside element', 'Shift+Enter'],
    ['Write', 'Cycle element type', 'Tab / Shift+Tab'], ['Write', 'Start parenthetical in dialogue', '('],
    ['Move', 'Word / paragraph', 'Ctrl+Arrows'], ['Move', 'Page', 'PageUp / PageDown'],
    ['View', 'Zoom', 'Ctrl+Mouse wheel'],
  ].map(([a, b, c]) => h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', {}, c)));
  return open({ title: 'KEYS', body: h('div', { class: 'body', style: 'width:640px' }, h('table', { class: 't' }, h('tbody', {}, ...extra, ...rows))), buttons: [{ label: 'Close', value: null, primary: true }] });
}

/**
 * Open Recent. Each row has three actions, shown while the row is hovered,
 * focused or selected, and kept visually apart:
 *  folder icon (reveal): shows the file in its folder.
 *  × (dismiss): removes the entry from this list only; the file is untouched.
 *  bin icon (trash): after a confirmation, moves the file to the Recycle Bin.
 * The table has a fixed layout that never grows past the dialog: the name
 * keeps priority, a long path keeps its beginning and is cut at the end ("C:\Users\…",
 * the full path in its tooltip), and the actions always keep their column.
 * `api` = { list, dismiss, trash, reveal, confirm, alert, currentPath }.
 */
export async function recentDialog(api) {
  let recent = await api.list();
  let chosen = null, openBtn = null, inSub = false, done;
  const result = new Promise((r) => { done = r; });
  const tbody = h('tbody');
  const body = h('div', { class: 'body recent' });
  // Only one modal exists at a time: a confirmation replaces this dialog, which reopens afterwards.
  const sub = async (fn) => { inSub = true; try { await fn(); } finally { inSub = false; show(); } };
  const render = () => {
    tbody.replaceChildren(...recent.map((r) => {
      const reveal = h('button', { class: 'ra ra-reveal', title: 'Show in Folder', 'aria-label': `Show ${r.name} in its folder`, html: FOLDER_SVG, disabled: !r.exists });
      reveal.addEventListener('click', (e) => { e.stopPropagation(); api.reveal(r.path); });
      const dismiss = h('button', { class: 'ra ra-dismiss', title: 'Remove from Recent (the file is kept)', 'aria-label': `Remove ${r.name} from Recent`, html: DISMISS_SVG });
      const trash = h('button', { class: 'ra ra-trash', title: 'Move to Recycle Bin…', 'aria-label': `Move ${r.name} to the Recycle Bin`, html: TRASH_SVG });
      dismiss.addEventListener('click', async (e) => {
        e.stopPropagation();
        recent = withExists(recent, (await api.dismiss(r.path)).recent);
        if (chosen === r.path) chosen = null;
        render();
      });
      trash.addEventListener('click', (e) => {
        e.stopPropagation();
        sub(async () => {
          if (api.currentPath && api.currentPath === r.path) { await api.alert('MOVE TO BIN', `"${r.name}" is open right now. Open or create another screenplay first, then move this one to the bin.`); return; }
          if (!(await api.confirm('MOVE TO RECYCLE BIN', `Move "${r.name}" to the Recycle Bin? (${r.path}) You can restore it from the Recycle Bin; its backups are kept.`, 'Move to Bin'))) return;
          const res = await api.trash(r.path);
          if (res.recent) recent = withExists(recent, res.recent);
          if (chosen === r.path) chosen = null;
          if (!res.ok) await api.alert(res.missing ? 'FILE NOT FOUND' : 'COULD NOT MOVE TO BIN', res.error);
        });
      });
      const tr = h('tr', { class: 'pick recent-row' + (r.path === chosen ? ' on' : '') + (r.exists ? '' : ' missing') },
        h('td', { class: 'rc-name', title: r.name }, r.name),
        h('td', { class: 'hint rc-path', title: r.path }, r.path),
        h('td', { class: 'rc-time', title: r.exists ? fmtTime(r.opened) : 'The file is no longer there' }, r.exists ? fmtWhen(r.opened) : 'missing'),
        h('td', { class: 'ra-cell' }, reveal, dismiss, trash));
      tr.addEventListener('click', () => { chosen = r.exists ? r.path : null; render(); });
      tr.addEventListener('dblclick', () => { if (r.exists) { chosen = r.path; if (openBtn) openBtn.click(); } });
      return tr;
    }));
    const table = h('table', { class: 't recent-t' },
      h('colgroup', {}, h('col', { class: 'c-name' }), h('col', {}), h('col', { class: 'c-time' }), h('col', { class: 'c-act' })), tbody);
    body.replaceChildren(recent.length ? table : h('div', { class: 'empty' }, 'No recent documents.'));
    if (openBtn) openBtn.disabled = !chosen;
  };
  const show = () => {
    render();
    open({ title: 'RECENT', body, cls: 'recent-dlg', buttons: [{ label: 'Cancel', value: null }, { label: 'Open', value: () => chosen, primary: true, disabled: !chosen }], init: (_d, _c, btns) => { openBtn = btns[1]; } })
      .then((v) => { if (!inSub) done(v); });
  };
  show();
  return result;
}
const withExists = (old, list) => (list || []).map((r) => ({ ...r, exists: (old.find((o) => o.path === r.path) || { exists: true }).exists }));
const DISMISS_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
const FOLDER_SVG = '<svg width="13" height="11" viewBox="0 0 13 11" aria-hidden="true"><path d="M1 2.2V9.5h11V3.4H6.2L5 2H1z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
const TRASH_SVG = '<svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true"><path d="M1 3h9M4 3V1.5h3V3M2.2 3l.6 8h5.4l.6-8M4.5 5v4.5M6.5 5v4.5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
