// English revision: review controller + panel. Claude is only called when the
// writer presses REVIEW; every change to the script is a click the writer makes.

import {
  buildChunks, chunkPrompt, validateFindings, revalidate, planApply, afterApply,
  applyUserLists, ignoreEntry, listsPrompt, estimate, normalize,
  CATEGORIES, CATEGORY_LABEL, MODEL,
} from '../core/revision.js';
import { pos } from '../core/editor.js';
import * as dlg from './ui/dialog.js';

const api = window.stet;
const esc = dlg.esc;
const STATUS_ORDER = { open: 0, outdated: 1, accepted: 2, rejected: 3 };

export class Revision {
  constructor({ host, editor, view, session, jump, getSettings, setSettings, onShow }) {
    Object.assign(this, { host, editor: editor, view, session, jump, getSettings, setSettings, onShow });
    this.findings = [];
    this.run = null;      // { id, chunks, refs, done, failed: Map, cancelled, finished, usage }
    this.cur = null;      // current finding id
    this.collapsed = new Set(['accepted', 'rejected']);
    this.timer = 0;
    host.addEventListener('mousedown', (e) => this.onClick(e));
    api.on('review:chunk', (m) => this.onChunk(m));
    api.on('review:done', (m) => this.onDone(m));
    this.render();
  }

  get visible() { return !this.host.hidden; }

  /** A different document was loaded: drop findings and stop any running review. */
  reset() {
    if (this.run && !this.run.finished) api.invoke('review:cancel', this.run.id);
    this.run = null;
    this.findings = [];
    this.cur = null;
    this.render();
    this.paint();
  }
  get doc() { return this.session.doc; }
  lists() { return { ignored: (this.doc.revision && this.doc.revision.ignored) || [], dictionary: this.getSettings().dictionary || [] }; }

  // ---- running a review ------------------------------------------------------------

  async start() {
    if (this.run && !this.run.finished) return;
    const status = await api.invoke('claude:key-status');
    if (status.source === 'none') {
      const ok = await keyDialog('The English revision uses Claude through your Anthropic API key.');
      if (!ok) return;
    }
    const blocks = this.editor.blocks.slice(); // snapshot: blocks are immutable values
    const chunks = buildChunks(blocks);
    if (!chunks.length) { dlg.alertBox('NOTHING TO REVIEW', 'There is no action or dialogue to review yet.'); return; }
    const est = estimate(chunks);
    const words = this.editor.words;
    if (!this.getSettings().reviewConsent) {
      const remember = dlg.h('input', { type: 'checkbox' });
      const v = await dlg.open({
        title: 'ENGLISH REVISION', sub: MODEL,
        body: dlg.h('div', { class: 'body', style: 'max-width:560px' },
          dlg.h('p', {}, `Send this screenplay's action, dialogue and parentheticals (about ${words.toLocaleString()} words) to Claude for an English review?`),
          dlg.h('p', { class: 'hint' }, `${est.requests} request${est.requests === 1 ? '' : 's'}, roughly ${est.inputTokens.toLocaleString()} input tokens plus Claude's reasoning and answers, billed to your Anthropic account. Scene headings and character names are sent as context; the title page and your notes are not sent. Nothing in the script changes until you accept a suggestion.`),
          dlg.h('label', { class: 'chk' }, remember, "don't ask again")),
        buttons: [{ label: 'Cancel', value: null }, { label: 'Review', value: true, primary: true }],
      });
      if (!v) return;
      if (remember.checked) this.setSettings({ reviewConsent: true });
    }
    const id = 'r' + Date.now().toString(36);
    const refs = new Map(blocks.map((b) => [b.id, b]));
    this.findings = this.findings.filter((f) => f.status === 'accepted'); // a new review replaces open findings
    this.run = { id, chunks, refs, done: 0, failed: new Map(), cancelled: false, finished: false, usage: { input: 0, output: 0 }, rejected: 0, suppressed: 0 };
    this.show(true);
    this.render();
    api.invoke('review:start', { reviewId: id, chunks: chunks.map((c) => ({ index: c.index, prompt: chunkPrompt(c) })), extra: listsPrompt(this.lists()) });
  }

  retryFailed() {
    const r = this.run;
    if (!r || !r.finished || !r.failed.size) return;
    const chunks = [...r.failed.keys()].map((i) => r.chunks[i]);
    r.failed.clear();
    r.finished = false;
    r.cancelled = false;
    r.id = 'r' + Date.now().toString(36);
    r.done -= chunks.length;
    this.render();
    api.invoke('review:start', { reviewId: r.id, chunks: chunks.map((c) => ({ index: c.index, prompt: chunkPrompt(c) })), extra: listsPrompt(this.lists()) });
  }

  cancel() {
    if (!this.run || this.run.finished) return;
    this.run.cancelled = true;
    api.invoke('review:cancel', this.run.id);
    this.render();
  }

  onChunk(m) {
    const r = this.run;
    if (!r || m.reviewId !== r.id) return; // stale event from a cancelled/replaced run
    r.done++;
    if (!m.ok) {
      if (m.error && m.error.code !== 'cancelled') r.failed.set(m.index, m.error);
    } else {
      const chunk = r.chunks[m.index];
      const v = validateFindings(chunk, m.findings, r.refs);
      r.rejected += v.rejected;
      const u = applyUserLists(v.findings, this.lists());
      r.suppressed += u.suppressed;
      revalidate(u.findings, this.editor.blocks); // the script may have changed since the snapshot
      this.findings.push(...u.findings);
      if (m.usage) { r.usage.input += m.usage.input; r.usage.output += m.usage.output; }
    }
    this.sortFindings();
    this.render();
    this.paint();
  }

  onDone(m) {
    const r = this.run;
    if (!r || m.reviewId !== r.id) return;
    r.finished = true;
    if (m.cancelled) r.cancelled = true;
    if (m.error) r.fatal = m.error;
    this.render();
  }

  sortFindings() {
    const idx = new Map(this.editor.blocks.map((b, i) => [b.id, i]));
    this.findings.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || ((idx.get(a.blockId) ?? 1e9) - (idx.get(b.blockId) ?? 1e9)) || (a.s - b.s));
  }

  // ---- edits made elsewhere ----------------------------------------------------------

  /** Called after every document change; re-checks findings when idle. */
  documentChanged() {
    if (!this.findings.length) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (revalidate(this.findings, this.editor.blocks)) { this.sortFindings(); this.render(); }
      this.paint();
    }, 120);
  }

  // ---- actions -------------------------------------------------------------------------

  byId(id) { return this.findings.find((f) => f.id === id); }

  accept(ids) {
    revalidate(this.findings, this.editor.blocks);
    const list = ids.map((id) => this.byId(id)).filter((f) => f && f.status === 'open');
    const plan = planApply(list, this.editor.blocks);
    if (!plan.applied.length) { this.render(); return 0; }
    this.editor.replaceRanges(plan.matches, plan.replacements); // one undo step
    afterApply(this.findings, plan, this.editor.blocks);
    this.sortFindings();
    this.render();
    this.paint();
    return plan.applied.length;
  }

  async acceptAll(category) {
    const open = this.findings.filter((f) => f.status === 'open' && (!category || f.category === category));
    if (!open.length) return;
    const what = category ? `all ${open.length} ${CATEGORY_LABEL[category]} suggestion${open.length === 1 ? '' : 's'}` : `all ${open.length} open suggestions`;
    if (!(await dlg.confirm('ACCEPT SUGGESTIONS', `Apply ${what}? You can undo this in one step (Ctrl+Z).`, 'Accept'))) return;
    this.accept(open.map((f) => f.id));
  }

  setStatus(id, status) {
    const f = this.byId(id);
    if (!f) return;
    if (status === 'dismissed') this.findings.splice(this.findings.indexOf(f), 1);
    else f.status = status;
    this.sortFindings();
    this.render();
    this.paint();
  }

  /** Ignore in this script: remembered in the .stet file, and similar findings vanish. */
  ignore(id) {
    const f = this.byId(id);
    if (!f) return;
    if (!this.doc.revision) this.doc.revision = { ignored: [] };
    const e = ignoreEntry(f);
    if (!this.doc.revision.ignored.some((x) => x.category === e.category && normalize(x.text) === normalize(e.text))) this.doc.revision.ignored.push(e);
    this.session.touch();
    this.findings = this.findings.filter((x) => !(x.status !== 'accepted' && x.category === f.category && normalize(x.shownOriginal) === normalize(f.shownOriginal)));
    this.render();
    this.paint();
  }

  /** Add the flagged words to the dictionary shared by every script. */
  async addToDictionary(id) {
    const f = this.byId(id);
    if (!f) return;
    const word = (f.original.trim() || f.shownOriginal.trim());
    const v = await dlg.prompt('ADD TO DICTIONARY', 'Word or phrase', word, 'Saved for every screenplay. Claude will not flag it again.');
    if (!v || !v.trim()) return;
    const dict = [...(this.getSettings().dictionary || [])];
    if (!dict.some((d) => normalize(d) === normalize(v))) dict.push(v.trim());
    await this.setSettings({ dictionary: dict });
    this.findings = applyUserLists(this.findings.filter((x) => x.status !== 'accepted'), this.lists()).findings.concat(this.findings.filter((x) => x.status === 'accepted'));
    this.sortFindings();
    this.render();
    this.paint();
  }

  select(id, focus = true) {
    const f = this.byId(id);
    if (!f) return;
    this.cur = id;
    const b = this.editor.blocks.findIndex((x) => x.id === f.blockId);
    if (b !== -1 && f.status !== 'outdated') this.jump(pos(b, f.s), true, pos(b, f.e));
    else if (b !== -1) this.jump(pos(b, 0), true);
    this.render();
    this.paint();
    if (focus) {
      const n = this.host.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (n) n.scrollIntoView({ block: 'nearest' });
    }
  }

  step(dir) {
    const open = this.findings.filter((f) => f.status === 'open');
    if (!open.length) return;
    const i = open.findIndex((f) => f.id === this.cur);
    const next = open[(i + dir + open.length) % open.length] || open[0];
    if (!this.visible) this.show(true);
    this.select(next.id);
  }

  show(on) {
    const want = on ?? this.host.hidden;
    this.host.hidden = !want;
    if (this.onShow) this.onShow(want);
    this.paint();
    if (want) this.render();
  }

  // ---- marks in the script -------------------------------------------------------------

  paint() {
    if (!this.visible || !this.findings.length) { if (this.view.revision) { this.view.revision = null; this.view.schedule(); } return; }
    const idx = new Map(this.editor.blocks.map((b, i) => [b.id, i]));
    const marks = [];
    for (const f of this.findings) {
      if (f.status !== 'open') continue;
      const b = idx.get(f.blockId);
      if (b === undefined) continue;
      marks.push({ b, s: f.s, e: Math.max(f.e, f.s + 1), cat: f.category, cur: f.id === this.cur });
    }
    marks.sort((x, y) => (x.b - y.b) || (x.s - y.s));
    this.view.revision = { marks };
    this.view.schedule();
  }

  // ---- panel ------------------------------------------------------------------------------

  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    e.preventDefault();
    const id = t.closest('[data-id]')?.dataset.id;
    const act = t.dataset.act;
    switch (act) {
      case 'run': return this.start();
      case 'cancel': return this.cancel();
      case 'retry': return this.retryFailed();
      case 'key': return keyDialog();
      case 'dict': return dictionaryDialog(this);
      case 'select': return this.select(id, false);
      case 'accept': return this.accept([id]);
      case 'reject': return this.setStatus(id, 'rejected');
      case 'restore': return this.setStatus(id, 'open');
      case 'dismiss': return this.setStatus(id, 'dismissed');
      case 'ignore': return this.ignore(id);
      case 'dictadd': return this.addToDictionary(id);
      case 'cat-all': return this.acceptAll(t.dataset.cat);
      case 'all': return this.acceptAll(null);
      case 'fold': { const k = t.dataset.k; this.collapsed.has(k) ? this.collapsed.delete(k) : this.collapsed.add(k); return this.render(); }
    }
  }

  render() {
    if (!this.visible) return;
    const r = this.run;
    const open = this.findings.filter((f) => f.status === 'open');
    let head = '';
    if (r && !r.finished) {
      head = `<div class="rv-status"><span>REVIEWING · ${r.done}/${r.chunks.length}</span><span class="rv-bar"><i style="width:${(r.done / r.chunks.length) * 100}%"></i></span><button class="tb" data-act="cancel">CANCEL</button></div>`;
    } else {
      const msg = !r ? 'Claude reads the action and dialogue and suggests minimal fixes. Nothing changes until you accept.'
        : r.fatal ? esc(r.fatal.message)
          : `${r.cancelled ? 'Cancelled' : 'Done'} · ${open.length} open${r.suppressed ? ` · ${r.suppressed} hidden by your lists` : ''}${r.rejected ? ` · ${r.rejected} unverifiable discarded` : ''}`;
      head = `<div class="rv-status"><span class="hint">${msg}</span><button class="btn primary" data-act="run">${r ? 'REVIEW AGAIN' : 'REVIEW SCRIPT'}</button></div>`;
    }
    if (r && r.failed.size && r.finished) {
      const first = [...r.failed.values()][0];
      head += `<div class="rv-fail">${r.failed.size} section${r.failed.size === 1 ? '' : 's'} failed: ${esc(first.message)} <button class="tb" data-act="retry">RETRY</button></div>`;
    }
    let body = '';
    for (const cat of CATEGORIES) {
      const items = this.findings.filter((f) => f.category === cat && (f.status === 'open' || f.status === 'outdated'));
      if (!items.length) continue;
      const nOpen = items.filter((f) => f.status === 'open').length;
      body += `<div class="rv-group"><div class="rv-gh"><span>${CATEGORY_LABEL[cat].toUpperCase()} · ${items.length}</span>${nOpen ? `<button class="tb" data-act="cat-all" data-cat="${cat}" title="Accept every open suggestion in this group">ACCEPT ALL</button>` : ''}</div>`;
      for (const f of items) body += this.item(f);
      body += '</div>';
    }
    for (const [k, label] of [['accepted', 'ACCEPTED'], ['rejected', 'REJECTED']]) {
      const items = this.findings.filter((f) => f.status === k);
      if (!items.length) continue;
      body += `<div class="rv-group"><div class="rv-gh"><button class="tb" data-act="fold" data-k="${k}">${this.collapsed.has(k) ? '▸' : '▾'} ${label} · ${items.length}</button></div>`;
      if (!this.collapsed.has(k)) for (const f of items) body += this.item(f);
      body += '</div>';
    }
    if (!body && r && r.finished && !r.fatal) body = '<div class="empty">No problems found. Your English reads naturally.</div>';
    const foot = `<div class="rv-foot">${open.length > 1 ? '<button class="tb" data-act="all">ACCEPT ALL…</button>' : ''}<span class="grow"></span><button class="tb" data-act="dict">DICTIONARY</button><button class="tb" data-act="key">API KEY</button></div>`;
    this.host.innerHTML = `<div class="panel-head">ENGLISH REVISION <span>${open.length ? '· ' + open.length : ''}</span></div>${head}<div class="list rv-list">${body}</div>${foot}`;
  }

  item(f) {
    const cur = f.id === this.cur ? ' cur' : '';
    const conf = `<span class="rv-conf c-${f.confidence}" title="Confidence">${f.confidence}</span>`;
    const diff = `<span class="rv-old">${esc(f.shownOriginal)}</span> <span class="rv-arrow">→</span> <span class="rv-new">${esc(f.shownReplacement)}</span>`;
    let actions;
    if (f.status === 'open') actions = '<button class="tb" data-act="accept">ACCEPT</button><button class="tb" data-act="reject">REJECT</button><button class="tb" data-act="dismiss" title="Hide without changing anything">DISMISS</button><button class="tb" data-act="ignore" title="Never flag this passage again in this screenplay">IGNORE</button><button class="tb" data-act="dictadd" title="Words that are correct in every screenplay">+DICT</button>';
    else if (f.status === 'outdated') actions = '<span class="hint">text changed since the review — not applied</span><button class="tb" data-act="dismiss">DISMISS</button>';
    else if (f.status === 'rejected') actions = '<button class="tb" data-act="restore">RESTORE</button><button class="tb" data-act="dismiss">DISMISS</button>';
    else actions = '<span class="hint">applied · Ctrl+Z undoes it</span>';
    return `<div class="rv-item s-${f.status} k-${f.category}${cur}" data-id="${esc(f.id)}">
      <div class="rv-diff" data-act="select" title="Show in script">${diff} ${conf}</div>
      <div class="rv-why">${esc(f.explanation)}</div>
      <div class="rv-acts">${actions}</div></div>`;
  }
}

// ---- dialogs -------------------------------------------------------------------------------

export async function keyDialog(lead = '') {
  const st = await api.invoke('claude:key-status');
  const input = dlg.h('input', { type: 'password', placeholder: 'sk-ant-…', spellcheck: false, autocomplete: 'off' });
  const msg = dlg.h('div', { class: 'hint' });
  const where = st.source === 'saved' ? `A key is saved (${st.hint}), encrypted by the operating system.`
    : st.source === 'env' ? 'Using the ANTHROPIC_API_KEY environment variable.' : 'No key yet.';
  let closeFn;
  const v = await dlg.open({
    title: 'CLAUDE API KEY', sub: 'stored encrypted · never in your scripts',
    body: dlg.h('div', { class: 'body', style: 'max-width:540px' },
      lead ? dlg.h('p', {}, lead) : null,
      dlg.h('p', { class: 'hint' }, where + ' Create a key at console.anthropic.com. It stays in this app\'s main process and is only sent to the Anthropic API when you start a review.'),
      dlg.h('div', { class: 'field' }, dlg.h('label', {}, 'API key'), input), msg),
    buttons: [
      ...(st.source === 'saved' ? [{ label: 'Remove key', value: 'clear' }] : []),
      { label: 'Cancel', value: null },
      { label: 'Save & test', value: 'save', primary: true },
    ],
    init: (_d, close) => { closeFn = close; },
  });
  void closeFn;
  if (v === 'clear') { await api.invoke('claude:key-clear'); return false; }
  if (v !== 'save') return st.source !== 'none';
  if (!input.value.trim()) return st.source !== 'none';
  const r = await api.invoke('claude:key-set', input.value);
  input.value = '';
  if (!r.ok) { await dlg.alertBox('KEY NOT SAVED', r.error); return false; }
  const t = await api.invoke('claude:key-test');
  if (!t.ok) { await dlg.alertBox('KEY SAVED, BUT THE TEST FAILED', t.message); return true; }
  return true;
}

export async function dictionaryDialog(rev) {
  const render = () => {
    const dict = rev.getSettings().dictionary || [];
    const ign = rev.lists().ignored;
    const row = (text, act, i) => `<tr><td>${esc(text)}</td><td style="text-align:right"><button class="tb" data-x="${act}" data-i="${i}">REMOVE</button></td></tr>`;
    return `<p class="hint">Dictionary — correct in every screenplay (${dict.length})</p><table class="t">${dict.map((d, i) => row(d, 'd', i)).join('') || '<tr><td class="hint">empty</td></tr>'}</table>
      <p class="hint" style="margin-top:14px">Ignored in this screenplay (${ign.length})</p><table class="t">${ign.map((x, i) => row(`${x.text} · ${CATEGORY_LABEL[x.category] || x.category}`, 'g', i)).join('') || '<tr><td class="hint">none</td></tr>'}</table>`;
  };
  const body = dlg.h('div', { class: 'body', style: 'width:520px', html: render() });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    const i = +b.dataset.i;
    if (b.dataset.x === 'd') {
      const dict = [...(rev.getSettings().dictionary || [])];
      dict.splice(i, 1);
      await rev.setSettings({ dictionary: dict });
    } else {
      rev.doc.revision.ignored.splice(i, 1);
      rev.session.touch();
    }
    body.innerHTML = render();
  });
  return dlg.open({ title: 'DICTIONARY & IGNORED', body, buttons: [{ label: 'Close', value: null, primary: true }] });
}
