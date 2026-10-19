// Application dialogs. Each returns a promise and never blocks typing state.

import { h, open, esc } from './dialog.js';
import { buildPrintPages, parseRange, hasTitlePage } from '../../core/printmodel.js';
import { paginate } from '../../core/layout.js';

const api = window.stet;
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

export async function preferencesDialog(settings, doc) {
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

export function statsDialog(summary, words, onGoals) {
  const s = summary;
  const goalIn = h('input', { type: 'number', value: s.dailyGoal, min: 0, style: 'width:80px' });
  const weekIn = h('input', { type: 'number', value: s.weeklyGoal, min: 0, style: 'width:80px' });
  const ahead = (d) => (d >= 0 ? `${d.toLocaleString()} ahead` : `${(-d).toLocaleString()} behind`);
  const todayLine = s.dailyGoal ? (s.todayDelta >= 0 ? `Daily goal met — ${s.todayDelta.toLocaleString()} over.` : `${(-s.todayDelta).toLocaleString()} words to today's goal.`) : 'No daily goal set.';
  const weekLine = s.weeklyGoal ? `Week: ${s.week.toLocaleString()} of ${s.weeklyGoal.toLocaleString()} — ${ahead(s.weekDelta)} of pace (${s.weekExpected.toLocaleString()} expected by today).` : 'No weekly goal set.';
  const body = h('div', { class: 'body', style: 'width:640px' },
    h('div', { class: 'stats-grid' },
      h('div', {}, h('span', {}, 'today'), h('b', {}, s.today.toLocaleString()), h('span', {}, `goal ${s.dailyGoal.toLocaleString()}`)),
      h('div', {}, h('span', {}, 'this week'), h('b', {}, s.week.toLocaleString()), h('span', {}, `goal ${s.weeklyGoal.toLocaleString()}`)),
      h('div', {}, h('span', {}, 'daily avg'), h('b', {}, s.dailyAvg.toLocaleString()), h('span', {}, `weekly avg ${s.weeklyAvg.toLocaleString()}`)),
      h('div', {}, h('span', {}, 'streak'), h('b', {}, `${s.streak}d`), h('span', {}, `best ${s.bestStreak}d`)),
    ),
    h('div', { class: 'verdict' }, todayLine, h('br'), weekLine),
    chart(s.series, s.dailyGoal),
    h('div', { class: 'hint', style: 'margin:10px 0' }, `Script total: ${words.toLocaleString()} words. Progress counts net new words (high-water mark per day); undo, autosave, pasting and formatting are not counted as writing.`),
    field('Daily goal', h('div', { class: 'inline' }, goalIn, h('span', {}, 'words'))),
    field('Weekly goal', h('div', { class: 'inline' }, weekIn, h('span', {}, 'words'))),
  );
  return open({ title: 'WRITING', sub: 'last 28 days', body, buttons: [{ label: 'Close', value: null }, { label: 'Save goals', primary: true, value: () => onGoals({ daily: Math.max(0, +goalIn.value || 0), weekly: Math.max(0, +weekIn.value || 0) }) }] });
}

function chart(series, goal) {
  const W = 620, H = 140, pad = 18;
  const max = Math.max(goal || 0, ...series.map((d) => d.words), 1);
  const bw = (W - pad) / series.length;
  let svg = `<svg class="stats-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  series.forEach((d, i) => {
    const bh = (d.words / max) * (H - pad - 4);
    const cls = goal && d.words < goal ? 'bar under' : 'bar';
    svg += `<rect class="${cls}" x="${pad + i * bw + 1}" y="${H - pad - bh}" width="${Math.max(1, bw - 3)}" height="${bh}"><title>${d.day}: ${d.words} words</title></rect>`;
    if (i % 7 === 0 || i === series.length - 1) svg += `<text x="${pad + i * bw}" y="${H - 4}">${d.day.slice(5)}</text>`;
  });
  if (goal) { const gy = H - pad - (goal / max) * (H - pad - 4); svg += `<line class="goal" x1="${pad}" x2="${W}" y1="${gy}" y2="${gy}"/><text x="0" y="${gy + 3}">goal</text>`; }
  svg += '</svg>';
  return h('div', { html: svg });
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
      for (const l of p.lines) s += `<div class="l" style="left:${l.col * col}px;top:${l.row * row}px">${esc(l.text)}</div>`;
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

export async function changelogDialog(md, version) {
  const html = md.split('\n').map((line) => {
    if (/^##\s/.test(line)) return `<h3>${esc(line.replace(/^##\s*/, ''))}</h3>`;
    if (/^###\s/.test(line)) return `<p><b>${esc(line.replace(/^###\s*/, ''))}</b></p>`;
    if (/^\s*[-*]\s/.test(line)) return `<li>${esc(line.replace(/^\s*[-*]\s*/, '')).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`;
    if (/^#\s/.test(line) || !line.trim()) return '';
    return `<p>${esc(line)}</p>`;
  }).join('').replace(/(<li>.*?<\/li>)+/gs, (m) => `<ul>${m}</ul>`);
  return open({ title: 'CHANGELOG', sub: 'v' + version, body: h('div', { class: 'body md', style: 'width:640px', html }), buttons: [{ label: 'Close', value: null, primary: true }] });
}

export async function shortcutsDialog(cmds) {
  const rows = cmds.filter((c) => c.keys && c.label).map((c) => h('tr', {}, h('td', {}, c.cat || ''), h('td', {}, typeof c.label === 'function' ? c.label() : c.label), h('td', {}, [].concat(c.keys).join('  ·  '))));
  const extra = [
    ['Write', 'Next element / convert empty element', 'Enter'], ['Write', 'Line break inside element', 'Shift+Enter'],
    ['Write', 'Cycle element type', 'Tab / Shift+Tab'], ['Write', 'Start parenthetical in dialogue', '('],
    ['Write', 'Accept suggestion', 'Enter / Tab'], ['Move', 'Word / paragraph', 'Ctrl+Arrows'], ['Move', 'Page', 'PageUp / PageDown'],
    ['View', 'Zoom', 'Ctrl+Mouse wheel'],
  ].map(([a, b, c]) => h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', {}, c)));
  return open({ title: 'KEYS', body: h('div', { class: 'body', style: 'width:640px' }, h('table', { class: 't' }, h('tbody', {}, ...extra, ...rows))), buttons: [{ label: 'Close', value: null, primary: true }] });
}

export function recentDialog(recent) {
  let chosen = null;
  const tbody = h('tbody', {}, ...recent.map((r) => {
    const tr = h('tr', { class: 'pick' }, h('td', {}, r.name), h('td', { class: 'hint' }, r.path), h('td', {}, fmtTime(r.opened)));
    tr.addEventListener('click', () => { chosen = r.path; for (const x of tbody.children) x.classList.remove('on'); tr.classList.add('on'); });
    tr.addEventListener('dblclick', () => { chosen = r.path; document.querySelector('.dlg .btn.primary').click(); });
    return tr;
  }));
  const body = h('div', { class: 'body', style: 'width:700px' }, recent.length ? h('table', { class: 't' }, tbody) : h('div', { class: 'empty' }, 'No recent documents.'));
  return open({ title: 'RECENT', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Open', value: () => chosen, primary: true, disabled: !recent.length }] });
}
