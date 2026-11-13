// The Revise guidelines window. From the top, none of it scrolling but the list:
//
//   the direction    one sentence, written by Claude (or Codex), about where the guidelines are
//                    taking the review; written again whenever one is added or removed
//   two tabs         EVERY SCREENPLAY (the guidelines) and THIS SCREENPLAY (the passages ignored in
//                    it), each with its count, and one RESET (pressed twice) for the tab shown
//   the kinds        how many guidelines are firm, still being learned, habits noticed, notes: a
//                    press on one shows only those; a field beside them finds a passage by its words
//   the list         plain rows: a small tag, the passage, one quiet line of detail, an × to remove
//   a field          to write a guideline by hand (every screenplay only)
//
// The list is the only part that scrolls, in a box of its own under the fixed parts, so nothing
// ever slides over or under a header.

import { CATEGORY_LABEL } from '../../core/revision.js';
import { guidelinesOf, patternsOf, noteFlag, addFlag, removeGuideline } from '../../core/guidelines.js';
import { arm } from './arm.js';
import * as dlg from './dialog.js';

const esc = dlg.esc;
const X = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
// The kinds of entry: the tag on its row, and what it does to a review (the tag's tooltip).
const KINDS = [
  ['firm', 'FIRM', 'Set aside more than once: held back from now on. A clear error is still shown.'],
  ['soft', 'LEARNING', 'Set aside once: still shown, marked GUIDELINE?. Set it aside again to make it firm.'],
  ['habit', 'HABIT', 'What your choices show across many passages. It goes when its examples do.'],
  ['note', 'NOTE', 'In your own words. Claude reads it; what it covers is held back unless it is a clear error.'],
];
const TAG = Object.fromEntries(KINDS.map(([k, tag]) => [k, tag]));
const TIP = Object.fromEntries(KINDS.map(([k, , tip]) => [k, tip]));
const cat = (c) => CATEGORY_LABEL[c] || '';
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const day = (t) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

// What the window shows, kept while STET runs: the tab, the kind picked (or none) and the words looked for.
const state = { tab: 'guides', kind: null, q: '' };

/** The guidelines and what they show together, as the rows of the list: [{ kind, main, meta, g? }] (g: removable). */
export function guidelineRows(flags) {
  const rows = guidelinesOf(flags).map((g) => {
    if (g.level === 'note') return { kind: 'note', main: g.notes[0], meta: [day(g.last)], g };
    const habit = g.key.startsWith('edit:') && g.examples.length > 1;
    return {
      kind: g.level, g, main: habit ? g.edit.replace('→', ' → ') : g.text,
      meta: [cat(g.category), `set aside ${times(g.times)}`, g.against ? `accepted ${times(g.against)}` : '', habit ? g.examples.slice(0, 3).join(', ') : '', ...g.notes.map((n) => `“${n}”`), day(g.last)],
    };
  });
  for (const p of patternsOf(flags)) rows.push({ kind: 'habit', main: p.kind === 'kept' ? `keeps “${p.what}”` : `${p.what}’s lines`, meta: [cat(p.category), `${p.count} times`, p.examples.slice(0, 2).join(', ')] });
  return rows.map((r) => ({ ...r, meta: r.meta.filter(Boolean) }));
}

export async function guidelinesDialog(rev) {
  const ignored = () => rev.lists().ignored;
  const found = (r) => !state.q || [r.main, ...r.meta].join(' ').toLowerCase().includes(state.q.toLowerCase());
  const row = (r, i, act) => `<li class="gl-row${r.kind ? '' : ' notag'}">${r.kind ? `<span class="gl-lv" title="${esc(TIP[r.kind])}">${TAG[r.kind]}</span>` : ''}<div class="gl-txt"><div class="gl-main" dir="auto">${esc(r.main)}</div>${r.meta.length ? `<div class="gl-meta" dir="auto">${r.meta.map(esc).join(' · ')}</div>` : ''}</div>${act ? `<button class="gl-x" data-x="${act}" data-i="${i}" title="Remove" aria-label="Remove">${X}</button>` : '<span class="gl-x-none"></span>'}</li>`;

  const head = dlg.h('div', { class: 'gl-dir' }), bar = dlg.h('div', { class: 'gl-bar' }), tools = dlg.h('div', { class: 'gl-tools' });
  const list = dlg.h('div', { class: 'gl-scroll' }), foot = dlg.h('div', { class: 'gl-add' });
  const body = dlg.h('div', { class: 'body gl-body', 'data-own-enter': true }, head, bar, tools, list, foot);
  const field = dlg.h('input', { type: 'text', class: 'gl-q', placeholder: 'Find', spellcheck: false, 'aria-label': 'Find in the list', value: state.q });
  const note = dlg.h('input', { type: 'text', placeholder: 'Write one for Claude, e.g. Rosa mixes Spanish into her lines', spellcheck: false, 'aria-label': 'A new guideline' });
  foot.append(note, dlg.h('button', { class: 'tb', 'data-x': 'add' }, 'ADD'));

  const renderDirection = () => {
    const d = rev.direction();
    const by = d.busy ? 'updating…' : d.by === 'codex' ? 'written by Codex' : d.by === 'claude' ? 'written by Claude' : '';
    head.innerHTML = `<div class="gl-dir-h"><span>DIRECTION</span><span class="gl-dir-by">${by}</span></div><p class="gl-dir-t${d.busy ? ' busy' : ''}">${esc(d.text)}</p>`;
  };
  const renderList = () => {
    const guides = state.tab === 'guides';
    let rows, html;
    if (guides) {
      rows = guidelineRows(rev.flags);
      const removable = rows.filter((r) => r.g); // (the × of a row names its place among these)
      html = rows.filter((r) => (!state.kind || r.kind === state.kind) && found(r)).map((r) => row(r, removable.indexOf(r), r.g ? 'g' : null));
    } else {
      rows = ignored().map((x) => ({ main: x.text, meta: [cat(x.category) || x.category || ''].filter(Boolean) }));
      html = rows.map((r, i) => (found(r) ? row(r, i, 'i') : '')).filter(Boolean);
    }
    const none = !rows.length ? (guides ? 'None yet. +GUIDELINE on a suggestion adds one, or write one below.' : 'None yet. IGNORE on a suggestion adds one.') : 'Nothing here matches.';
    list.innerHTML = html.length ? `<ul class="gl-list">${html.join('')}</ul>` : `<p class="gl-empty">${none}</p>`;
    return rows;
  };
  const render = () => {
    const guides = state.tab === 'guides', flags = rev.flags, nGuides = guidelinesOf(flags).length, nIgn = ignored().length;
    const tab = (k, label, n) => `<button class="tb gl-tab${state.tab === k ? ' cur' : ''}" data-x="tab" data-k="${k}" role="tab" aria-selected="${state.tab === k}">${label}<span class="gl-n">${n}</span></button>`;
    bar.innerHTML = `<div class="gl-tabs" role="tablist">${tab('guides', 'EVERY SCREENPLAY', nGuides)}${tab('ignored', 'THIS SCREENPLAY', nIgn)}</div>`
      + `<button class="tb gl-reset" data-x="reset" title="${guides ? 'Forget every guideline' : 'Flag every passage ignored in this screenplay again'} (press twice)"${(guides ? flags.length : nIgn) ? '' : ' disabled'}>RESET</button>`;
    const rows = renderList();
    const count = (k) => rows.filter((r) => r.kind === k).length;
    const kinds = guides ? KINDS.map(([k, tag, tip]) => `<button class="tb gl-kind${state.kind === k ? ' cur' : ''}" data-x="kind" data-k="${k}" title="${esc(tip)}"${count(k) ? '' : ' disabled'}>${tag}<span class="gl-n">${count(k)}</span></button>`).join('')
      : '<span class="gl-lead">Passages Revise won’t flag again in this screenplay.</span>';
    tools.innerHTML = `<div class="gl-kinds">${kinds}</div>`;
    tools.append(field);
    foot.hidden = !guides;
    renderDirection();
  };
  const add = async () => {
    const v = note.value.trim();
    if (!v) return note.focus();
    note.value = '';
    await rev.saveFlags(addFlag(rev.flags, noteFlag(v)));
    render();
    note.focus();
  };

  field.addEventListener('input', () => { state.q = field.value; renderList(); });
  // Enter in the field adds what is written (and never closes the window: data-own-enter, ui/dialog.js).
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    const i = +b.dataset.i, guides = state.tab === 'guides';
    switch (b.dataset.x) {
      case 'add': return add();
      case 'tab': state.tab = b.dataset.k; state.kind = null; return render();
      case 'kind': state.kind = state.kind === b.dataset.k ? null : b.dataset.k; return render();
      case 'reset':
        return arm(b, async () => {
          if (guides) await rev.saveFlags([]);
          else if (rev.doc.revision) { rev.doc.revision.ignored = rev.doc.revision.ignored.filter((x) => x.category === 'spelling'); rev.session.touch(); }
          state.kind = null;
          render();
        }, { label: 'CONFIRM' });
      case 'g': {
        const g = guidelineRows(rev.flags).filter((r) => r.g)[i]?.g;
        if (g) await rev.saveFlags(removeGuideline(rev.flags, g));
        if (state.kind && !guidelineRows(rev.flags).some((r) => r.kind === state.kind)) state.kind = null;
        return render();
      }
      case 'i': {
        const x = ignored()[i], all = rev.doc.revision.ignored;
        if (x) { all.splice(all.indexOf(x), 1); rev.session.touch(); }
        return render();
      }
    }
  });

  render();
  rev.onDirection = renderDirection;
  rev.direct(0); // (one not written yet, or written for other guidelines: now)
  try {
    return await dlg.open({ title: 'REVISE GUIDELINES', cls: 'gl-dlg', body, buttons: [{ label: 'Close', value: null, primary: true }] });
  } finally { rev.onDirection = null; }
}
