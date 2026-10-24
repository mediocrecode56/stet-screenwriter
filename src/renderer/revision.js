// Revise: review controller + panel, in whatever language the script is written. Claude is only called when the
// writer presses REVIEW; every change to the script is a click the writer makes.
//
// The latest review lives in the document (doc.revision.review) and is saved in
// the .stet file, so suggestions and decisions survive restarts. A suggestion
// keeps its text, replacement, explanation, category and decision until the
// writer decides; edits only move (or lose track of) the passage it points at.
// Running a new review replaces the previous one entirely.

import {
  buildChunks, chunkPrompt, validateFindings, planApply, afterApply, locateAll, shownRange,
  applyUserLists, listsPrompt, estimate, normalize, ignoreEntry, isApplied, sortByText, revisionIgnores,
  CATEGORIES, CATEGORY_LABEL, DECISION_LABEL, MODEL,
} from '../core/revision.js';
import { applyGuidelines, guidelinesPrompt, guidelinesOf, patternsOf, flagOf, noteFlag, addFlag, removeGuideline, cleanFlags } from '../core/guidelines.js';
import { arm } from './ui/arm.js';
import { pos } from '../core/editor.js';
import * as dlg from './ui/dialog.js';
import { setPanel, isOpen } from './ui/motion.js';

const api = window.stet;
const esc = dlg.esc;

const STAGE = {
  connecting: 'Sending the script to Claude…',
  reviewing: 'Claude is reviewing your script…',
  processing: 'Checking the suggestions…',
  cancelling: 'Cancelling…',
};

export class Revision {
  constructor({ host, editor, view, session, jump, getSettings, setSettings, onShow }) {
    Object.assign(this, { host, editor, view, session, jump, getSettings, setSettings, onShow });
    this.run = null;       // transient: { id, chunks, refs, done, failed: Map, cancelled, finished, stage, started, rejected, suppressed, fatal }
    this.cur = null;       // selected suggestion id
    this.hover = null;     // suggestion id under the pointer
    this.locs = new Map(); // id -> {b, s, e} | null
    this.showDecided = false;
    this.timer = 0;
    this.ticker = 0;
    host.addEventListener('mousedown', (e) => this.onClick(e));
    host.addEventListener('mouseover', (e) => this.setHover(e.target.closest('.rv-item')?.dataset.id || null));
    host.addEventListener('mouseleave', () => { this.setHover(null); this.nearEnd(false); });
    host.addEventListener('mousemove', (e) => this.nearEnd(this.atListEnd(e)));
    host.addEventListener('scroll', () => this.nearEnd(this.near), true);
    api.on('review:chunk', (m) => this.onChunk(m));
    api.on('review:done', (m) => this.onDone(m));
    this.render();
  }

  get visible() { return isOpen(this.host); }
  get doc() { return this.session.doc; }
  get review() { return (this.doc && this.doc.revision && this.doc.revision.review) || null; }
  get findings() { return this.review ? this.review.findings : []; }
  lists() { return { ignored: revisionIgnores((this.doc.revision && this.doc.revision.ignored) || []) }; }
  /** The writer's guidelines (every screenplay; core/guidelines.js), as flags. */
  get flags() { return cleanFlags(this.getSettings().guidelines); }
  async saveFlags(flags) { await this.setSettings({ guidelines: flags }); }
  open() { return this.findings.filter((f) => !f.decision); }

  /** A document was loaded: stop any running review and show the one stored in it. */
  reset() {
    if (this.run && !this.run.finished) api.invoke('review:cancel', this.run.id);
    this.stopTicker();
    this.run = null;
    this.cur = null;
    this.hover = null;
    if (this.review && this.review.state === 'running') this.review.state = 'interrupted';
    this.relocate();
    this.render();
    this.paint();
  }

  /** Find every passage again, and keep the list in script order. */
  relocate() {
    this.locs = locateAll(this.findings, this.editor.blocks);
    sortByText(this.findings, this.editor.blocks);
  }
  located(f) { return this.locs.get(f.id) || null; }

  // ---- running a review ------------------------------------------------------------

  async start() {
    if (this.run && !this.run.finished) return;
    let status = await api.invoke('claude:key-status');
    if (status.source === 'none') {
      const ok = await keyDialog(status.provider === 'api' ? 'Revise is set to use an API key, and none is set up.' : 'Revise needs Claude. Claude Code was not found on this computer.');
      if (!ok) return;
      status = await api.invoke('claude:key-status');
    }
    const viaCli = status.source === 'claude-code';
    const blocks = this.editor.blocks.slice(); // snapshot: blocks are immutable values
    const chunks = buildChunks(blocks);
    if (!chunks.length) { dlg.alertBox('NOTHING TO REVIEW', 'There is no action or dialogue to review yet.'); return; }
    const est = estimate(chunks);
    const words = this.editor.words;
    if (!this.getSettings().reviewConsent) {
      const remember = dlg.h('input', { type: 'checkbox' });
      const v = await dlg.open({
        title: 'REVISE', sub: MODEL,
        body: dlg.h('div', { class: 'body', style: 'max-width:560px' },
          dlg.h('p', {}, `Send this screenplay's action, dialogue and parentheticals (about ${words.toLocaleString()} words) to Claude for a review? Claude reads it in the language it is written in.`),
          dlg.h('p', { class: 'hint' }, `${est.requests} request${est.requests === 1 ? '' : 's'}, roughly ${est.inputTokens.toLocaleString()} input tokens plus Claude's reasoning and answers, ${viaCli ? 'through Claude Code on your Claude sign-in (counts toward your plan usage)' : 'billed to your Anthropic API account'}. Scene headings and character names are sent as context; the title page and your notes are not sent. Nothing in the script changes until you accept a suggestion.`),
          this.findings.length ? dlg.h('p', { class: 'hint' }, 'The current suggestions and your decisions on them will be replaced by the new review.') : null,
          dlg.h('label', { class: 'chk' }, remember, "don't ask again")),
        buttons: [{ label: 'Cancel', value: null }, { label: 'Review', value: true, primary: true }],
      });
      if (!v) return;
      if (remember.checked) this.setSettings({ reviewConsent: true });
    } else if (this.open().length) {
      const n = this.open().length;
      if (!(await dlg.confirm('REVIEW AGAIN', `A new review replaces the current suggestions (${n} still undecided) and their decisions.`, 'Review'))) return;
    }
    const id = 'r' + Date.now().toString(36);
    const refs = new Map(blocks.map((b) => [b.id, b]));
    // A new review replaces the previous one completely: suggestions and decisions.
    this.doc.revision = this.doc.revision || { ignored: [] };
    this.doc.revision.review = { id, at: new Date().toISOString(), model: MODEL, state: 'running', findings: [] };
    this.session.touch();
    this.cur = null;
    this.locs = new Map();
    this.run = { id, chunks, refs, done: 0, failed: new Map(), cancelled: false, finished: false, stage: 'connecting', started: Date.now(), rejected: 0, suppressed: 0, held: 0, fatal: null };
    this.show(true);
    this.startTicker();
    this.render();
    this.paint();
    this.send(chunks);
  }

  send(chunks) {
    const r = this.run;
    Promise.resolve(api.invoke('review:start', { reviewId: r.id, chunks: chunks.map((c) => ({ index: c.index, prompt: chunkPrompt(c) })), extra: [listsPrompt(this.lists()), guidelinesPrompt(this.flags)].filter(Boolean).join('\n\n') }))
      .then(() => { if (this.run === r && !r.finished && r.stage === 'connecting') { r.stage = 'reviewing'; this.renderStatus(); } })
      .catch((e) => this.onDone({ reviewId: r.id, error: { code: 'ipc', message: String(e && e.message || e) } }));
  }

  retryFailed() {
    const r = this.run;
    if (!r || !r.finished || !r.failed.size) return;
    const chunks = [...r.failed.keys()].map((i) => r.chunks[i]);
    r.failed.clear();
    Object.assign(r, { finished: false, cancelled: false, fatal: null, stage: 'connecting', started: Date.now(), id: 'r' + Date.now().toString(36) });
    r.done -= chunks.length;
    if (this.review) { this.review.state = 'running'; this.review.id = r.id; }
    this.startTicker();
    this.render();
    this.send(chunks);
  }

  cancel() {
    const r = this.run;
    if (!r || r.finished) return;
    r.cancelled = true;
    r.stage = 'cancelling';
    api.invoke('review:cancel', r.id);
    this.renderStatus();
  }

  onChunk(m) {
    const r = this.run;
    if (!r || m.reviewId !== r.id || !this.review) return; // stale event from a cancelled/replaced run
    r.done++;
    if (r.stage === 'connecting') r.stage = 'reviewing';
    if (!m.ok) {
      if (m.error && m.error.code !== 'cancelled') r.failed.set(m.index, m.error);
    } else {
      const v = validateFindings(r.chunks[m.index], m.findings, r.refs);
      r.rejected += v.rejected;
      const u = applyUserLists(v.findings, this.lists());
      r.suppressed += u.suppressed;
      const g = applyGuidelines(u.findings, this.flags);
      r.held += g.held;
      this.review.findings.push(...g.findings);
      this.session.touch();
    }
    if (r.done >= r.chunks.length && !r.cancelled) r.stage = 'processing';
    this.relocate();
    this.render();
    this.paint();
  }

  onDone(m) {
    const r = this.run;
    if (!r || m.reviewId !== r.id) return;
    r.finished = true;
    if (m.cancelled) r.cancelled = true;
    if (m.error) r.fatal = m.error;
    if (this.review) {
      this.review.state = r.fatal ? 'failed' : r.cancelled ? 'cancelled' : r.failed.size ? 'partial' : 'complete';
      this.session.touch();
    }
    this.stopTicker();
    this.render();
  }

  startTicker() { this.stopTicker(); this.ticker = setInterval(() => this.tick(), 1000); }
  stopTicker() { clearInterval(this.ticker); this.ticker = 0; }
  tick() {
    const el = this.host.querySelector('.rv-el');
    if (el && this.run) el.textContent = elapsed(this.run.started);
  }

  // ---- edits made elsewhere ----------------------------------------------------------

  /** Called after every document change: re-find passages when idle. Never changes a suggestion. */
  documentChanged() {
    if (!this.findings.length) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = 0;
      const seen = () => this.findings.map((f) => f.id + (this.located(f) ? 1 : 0)).join();
      const before = seen();
      this.relocate();
      const after = seen();
      if (before !== after) this.render();
      this.paint();
    }, 120);
  }

  // ---- decisions -------------------------------------------------------------------------

  byId(id) { return this.findings.find((f) => f.id === id); }

  decide(f, decision) {
    f.decision = decision;
    // Reopening keeps what accepting put in, so the suggestion still finds its passage and can be accepted again.
    if (decision && decision !== 'accepted') f.appliedText = null;
    this.session.touch();
    this.relocate();
    this.render();
    this.paint();
  }

  accept(ids) {
    const list = ids.map((id) => this.byId(id)).filter((f) => f && !f.decision);
    // Reopened ones whose change is still in the script: nothing to edit, only the decision.
    const already = list.filter((f) => isApplied(f, this.located(f), this.editor.blocks));
    for (const f of already) f.decision = 'accepted';
    const plan = planApply(list.filter((f) => !already.includes(f)), this.editor.blocks);
    if (!plan.applied.length && !already.length) { this.render(); return 0; }
    if (plan.applied.length) {
      this.editor.replaceRanges(plan.matches, plan.replacements); // one undo step
      afterApply(this.findings, plan, this.editor.blocks);
    }
    // Accepted although it looked like a guideline: the guideline was wrong about this one.
    const counter = [...already, ...plan.applied].filter((f) => f.guide);
    if (counter.length) this.saveFlags(counter.reduce((fl, f) => addFlag(fl, flagOf(f, { against: true })), this.flags));
    this.session.touch();
    this.relocate();
    this.render();
    this.paint();
    return plan.applied.length + already.length;
  }

  /** Accept every open suggestion that can be applied, or only those of one kind: the dialog offers the kinds. */
  async acceptAll(category) {
    const open = this.open().filter((f) => (!category || f.category === category) && this.canApply(f));
    if (!open.length) return;
    let pick = category || 'all';
    if (category) {
      if (!(await dlg.confirm('ACCEPT SUGGESTIONS', `Apply all ${open.length} ${CATEGORY_LABEL[category]} suggestion${open.length === 1 ? '' : 's'}? You can undo the text change in one step (Ctrl+Z).`, 'Accept'))) return;
    } else {
      const kinds = CATEGORIES.map((c) => [c, open.filter((f) => f.category === c).length]).filter(([, n]) => n);
      pick = await dlg.open({
        title: 'ACCEPT SUGGESTIONS',
        body: dlg.h('div', { class: 'body', style: 'max-width:520px' },
          dlg.h('p', {}, `Apply all ${open.length} open suggestions, or only one kind? You can undo the text change in one step (Ctrl+Z).`)),
        buttons: [{ label: 'Cancel', value: null }, ...(kinds.length > 1 ? kinds.map(([c, n]) => ({ label: `${CATEGORY_LABEL[c]} · ${n}`, value: c })) : []), { label: `All · ${open.length}`, value: 'all', primary: true }],
      });
      if (!pick) return;
    }
    this.accept(open.filter((f) => pick === 'all' || f.category === pick).map((f) => f.id));
  }

  /** The original passage is where the suggestion says, unchanged (or, reopened, still holds the accepted change). */
  canApply(f) {
    const at = this.located(f);
    return !!at && !f.decision && (this.editor.blocks[at.b].text.slice(at.s, at.e) === f.original || isApplied(f, at, this.editor.blocks));
  }

  discard(id) { const f = this.byId(id); if (f && !f.decision) this.decide(f, 'discarded'); }
  reopen(id) { const f = this.byId(id); if (f && f.decision) this.decide(f, null); }

  /** Ignore: remembered in this .stet file so future reviews never flag the passage again. */
  ignore(id) {
    const f = this.byId(id);
    if (!f || f.decision) return;
    if (!this.doc.revision) this.doc.revision = { ignored: [] };
    const e = ignoreEntry(f);
    if (!this.doc.revision.ignored.some((x) => x.category === e.category && normalize(x.text) === normalize(e.text))) this.doc.revision.ignored.push(e);
    this.decide(f, 'ignored');
  }

  /** Set a suggestion aside as a guideline (every screenplay), with a note in the writer's words if
   *  they want; the guidelines learn from it (core/guidelines.js), so similar ones stop coming up. */
  async addToGuidelines(id, note) {
    const f = this.byId(id);
    if (!f || f.decision) return;
    const v = note ?? await dlg.prompt('ADD TO GUIDELINES', 'Why it is fine (optional)', '', 'Revise learns from it, in every screenplay.');
    if (v == null) return;
    await this.saveFlags(addFlag(this.flags, flagOf(f, { note: v })));
    this.decide(f, 'guideline');
  }

  select(id, focus = true) {
    const f = this.byId(id);
    if (!f) return;
    this.cur = id;
    const at = this.located(f);
    if (at) this.jump(pos(at.b, at.s), true, pos(at.b, at.e), true); // a glide to its passage, not a jump
    this.render();
    this.paint();
    if (focus) {
      const n = this.host.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (n) n.scrollIntoView({ block: 'nearest' });
    }
  }

  step(dir) {
    const open = this.open().filter((f) => this.located(f));
    if (!open.length) return;
    const i = open.findIndex((f) => f.id === this.cur);
    const next = open[(i + dir + open.length) % open.length] || open[0];
    if (!this.visible) this.show(true);
    this.select(next.id);
  }

  show(on) {
    const want = on ?? !this.visible;
    setPanel(this.host, want);
    if (!want) this.setHover(null);
    if (this.onShow) this.onShow(want);
    this.paint();
    if (want) this.render();
  }

  // ---- marks in the script -------------------------------------------------------------

  /** The pointer is over the lower end of the list. */
  atListEnd(e) {
    const list = this.host.querySelector('.rv-list');
    if (!list) return false;
    const r = list.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY <= r.bottom && e.clientY >= r.bottom - Math.min(96, r.height / 3);
  }

  /** Near the lower end, a floating DECIDED button while the decided ones are out of sight below. */
  nearEnd(on) {
    this.near = on;
    const btn = this.host.querySelector('.rv-jump'), head = this.host.querySelector('.rv-decided'), list = this.host.querySelector('.rv-list');
    if (!btn) return;
    const below = !!head && !!list && head.getBoundingClientRect().top > list.getBoundingClientRect().bottom - 8;
    btn.classList.toggle('on', !!on && below);
  }

  /** Scroll the decided suggestions into view, unfolded. */
  toDecided() {
    if (!this.showDecided) { this.showDecided = true; this.render(); }
    const list = this.host.querySelector('.rv-list'), head = this.host.querySelector('.rv-decided');
    if (list && head) list.scrollTop += head.getBoundingClientRect().top - list.getBoundingClientRect().top;
    this.nearEnd(false);
  }

  setHover(id) {
    if (id === this.hover) return;
    this.hover = id;
    for (const n of this.host.querySelectorAll('.rv-item.hov')) n.classList.remove('hov');
    if (id) this.host.querySelector(`.rv-item[data-id="${CSS.escape(id)}"]`)?.classList.add('hov');
    this.paint();
  }

  paint() {
    if (!this.visible || !this.findings.length) { if (this.view.revision) { this.view.revision = null; this.view.schedule(); } return; }
    const marks = [];
    for (const f of this.findings) {
      const hov = f.id === this.hover;
      if (f.decision && !hov) continue;
      const at = hov ? shownRange(f, this.located(f), this.editor.blocks) : this.located(f);
      if (!at) continue; // never point at a passage we can't identify
      marks.push({ b: at.b, s: at.s, e: Math.max(at.e, at.s + 1), cat: f.decision ? 'decided' : f.category, cur: f.id === this.cur, hov });
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
    switch (t.dataset.act) {
      case 'run': return this.start();
      case 'cancel': return this.cancel();
      case 'retry': return this.retryFailed();
      case 'key': return keyDialog();
      case 'guides': return guidelinesDialog(this);
      case 'select': return this.select(id, false);
      case 'accept': return this.accept([id]);
      case 'discard': return this.discard(id);
      case 'reopen': return this.reopen(id);
      case 'ignore': return this.ignore(id);
      case 'guide': return this.addToGuidelines(id);
      case 'all': return this.acceptAll(null);
      case 'fold': this.showDecided = !this.showDecided; return this.render();
      case 'to-decided': return this.toDecided();
    }
  }

  statusHTML() {
    const r = this.run, rv = this.review;
    if (r && !r.finished) {
      const sub = r.chunks.length > 1 ? `${r.done} of ${r.chunks.length} sections done` : 'Reviewing in one request';
      return `<div class="rv-progress" role="status" aria-live="polite">
        <div class="rv-indet" aria-hidden="true"><i></i></div>
        <div class="rv-stage"><span class="rv-stage-t">${STAGE[r.stage] || STAGE.reviewing}</span><span class="rv-el">${elapsed(r.started)}</span></div>
        <div class="rv-stage"><span class="hint">${sub} · you can keep writing</span>${r.stage === 'cancelling' ? '' : '<button class="tb" data-act="cancel">CANCEL</button>'}</div></div>`;
    }
    // The last review in one line at the top (all of it in the tooltip), the button centred under it.
    let msg;
    const n = this.open().length;
    if (r && r.fatal) msg = 'Review failed';
    else if (rv) {
      const when = rv.at ? new Date(rv.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const state = { cancelled: 'Review cancelled', interrupted: 'Review interrupted', partial: 'Review incomplete', failed: 'Review failed', running: 'Review interrupted' }[rv.state] || 'Reviewed';
      msg = `${state}${when ? ' ' + when : ''} · ${n ? `${n} of ${this.findings.length} open` : `${this.findings.length} decided`}`;
      if (r && r.suppressed) msg += ` · ${r.suppressed} ignored`;
      if (r && r.held) msg += ` · ${r.held} held back by your guidelines`;
      if (r && r.rejected) msg += ` · ${r.rejected} unverifiable dropped`;
    } else msg = 'Claude suggests fixes; nothing changes until you accept.';
    let html = `<div class="rv-status"><div class="rv-line" title="${esc(msg)}">${esc(msg)}</div><button class="btn primary rv-run" data-act="run">${rv ? 'REVIEW AGAIN' : 'REVIEW SCRIPT'}</button></div>`;
    if (r && r.fatal) html += `<div class="rv-fail">${esc(r.fatal.message)}</div>`;
    if (r && r.finished && r.failed.size) {
      const first = [...r.failed.values()][0];
      html += `<div class="rv-fail">${r.failed.size} section${r.failed.size === 1 ? '' : 's'} failed: ${esc(first.message)} <button class="tb" data-act="retry">RETRY</button></div>`;
    }
    return html;
  }

  renderStatus() {
    const el = this.host.querySelector('.rv-head');
    if (el) el.innerHTML = this.statusHTML(); else this.render();
  }

  render() {
    if (!this.visible) return;
    const open = this.open();
    const decided = this.findings.filter((f) => f.decision);
    let body = '';
    // One list in script order; each card names its kind.
    if (open.length) {
      body += '<div class="rv-group">';
      for (const f of open) body += this.item(f);
      body += '</div>';
    }
    if (decided.length) {
      body += `<div class="rv-group rv-decided"><div class="rv-gh"><button class="tb" data-act="fold">${this.showDecided ? '▾' : '▸'} DECIDED · ${decided.length}</button></div>`;
      if (this.showDecided) for (const f of decided) body += this.item(f);
      body += '</div>';
    }
    const r = this.run;
    if (!body && this.review && (!r || r.finished) && this.review.state === 'complete') body = '<div class="empty">No problems found. The writing reads naturally.</div>';
    const nApply = open.filter((f) => this.canApply(f)).length;
    const foot = `<div class="rv-foot">${nApply > 1 ? '<button class="tb" data-act="all">ACCEPT ALL…</button>' : ''}<span class="grow"></span><button class="tb" data-act="guides">GUIDELINES</button><button class="tb" data-act="key">CONNECTION</button></div>`;
    const list = this.host.querySelector('.rv-list');
    const scroll = list ? list.scrollTop : 0;
    const jump = decided.length ? `<button class="rv-jump" data-act="to-decided" title="Go to the decided suggestions">DECIDED · ${decided.length} ↓</button>` : '';
    this.host.innerHTML = `<div class="rv-head">${this.statusHTML()}</div><div class="rv-wrap"><div class="list rv-list">${body}</div>${jump}</div>${foot}`;
    this.host.querySelector('.rv-list').scrollTop = scroll;
    if (this.near) this.nearEnd(true);
  }

  item(f) {
    const cls = [f.id === this.cur ? 'cur' : '', f.id === this.hover ? 'hov' : '', f.decision ? 'decided' : ''].join(' ');
    const at = this.located(f);
    const guide = f.guide && !f.decision ? `<span class="rv-guide" title="${esc(`Close to something you set aside before${f.guide.notes.length ? ': ' + f.guide.notes.join('; ') : ''}`)}">GUIDELINE?</span>` : '';
    const head = `<div class="nh"><span class="rv-kind">${CATEGORY_LABEL[f.category]}</span>${guide}<span class="rv-conf c-${f.confidence}" title="Confidence">${f.confidence}</span></div>`;
    const diff = `<span class="rv-old">${esc(f.shownOriginal)}</span> <span class="rv-arrow">→</span> <span class="rv-new">${esc(f.shownReplacement)}</span>`;
    let actions, note = '';
    if (!f.decision) {
      const ok = this.canApply(f);
      if (!at) note = '<div class="rv-lost">The original passage can no longer be located in the script.</div>';
      else if (isApplied(f, at, this.editor.blocks)) note = '<div class="rv-lost">The change is still in the script; accepting keeps it.</div>';
      else if (!ok) note = '<div class="rv-lost">The passage has been edited since the review.</div>';
      actions = `<button class="tb" data-act="accept"${ok ? '' : ' disabled title="The original text is no longer there to replace"'}>ACCEPT</button><button class="tb" data-act="discard" title="Keep your text; drop this suggestion">DISCARD</button><button class="tb" data-act="ignore" title="Keep your text and never flag this passage again in this screenplay">IGNORE</button><button class="tb" data-act="guide" title="Fine in every screenplay: add to your guidelines, so similar suggestions stop coming up">+GUIDELINE</button>`;
    } else {
      const extra = f.decision === 'accepted' && !at ? ' · change no longer found in the script' : '';
      actions = `<span class="rv-dec">${DECISION_LABEL[f.decision]}${extra}</span><button class="tb" data-act="reopen" title="Make this suggestion undecided again (does not change the script)">REOPEN</button>`;
    }
    // A press anywhere on the card shows its passage; the buttons on it keep their own jobs (the nearest data-act wins).
    return `<div class="rv-item k-${f.category} ${cls}" data-id="${esc(f.id)}" data-act="select" title="${at ? 'Show in script' : 'Passage not found'}">
      ${head}<div class="rv-diff" dir="auto">${diff}</div>
      <div class="rv-why" dir="auto">${esc(f.explanation)}</div>${note}
      <div class="rv-acts">${actions}</div></div>`;
  }
}

function elapsed(t0) {
  const s = Math.max(0, Math.round((Date.now() - t0) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

// ---- dialogs -------------------------------------------------------------------------------

const CONNECTIONS = [
  ['auto', 'Automatic: an API key if one is set, otherwise your Claude sign-in'],
  ['cli', 'Claude sign-in (Claude Code), no API key'],
  ['api', 'API key (billed to an Anthropic API account)'],
];

/** What a status means for the next review, in a sentence. */
function connectionText(st) {
  const via = st.source === 'saved' ? `a saved API key (${st.hint}), encrypted by the operating system`
    : st.source === 'env' ? 'the ANTHROPIC_API_KEY environment variable'
    : st.source === 'claude-code' ? `${st.cli} on your existing Claude sign-in — no key needed` : null;
  if (via) return `Reviews use ${via}.`;
  if (st.provider === 'cli') return 'Claude Code was not found. Install the Claude desktop app (or Claude Code) and sign in; STET then finds it by itself.' + (st.key ? ' Or choose the API key below.' : '');
  if (st.provider === 'api') return 'No API key is set up yet: paste one below (console.anthropic.com).' + (st.cli ? ` Or choose your Claude sign-in (${st.cli} was found).` : '');
  return 'Claude Code was not found. Install the Claude desktop app or Claude Code and sign in — STET then uses that sign-in automatically. Or paste an Anthropic API key (console.anthropic.com).';
}

export async function keyDialog(lead = '') {
  let st = await api.invoke('claude:key-status');
  const input = dlg.h('input', { type: 'password', placeholder: 'sk-ant-…', spellcheck: false, autocomplete: 'off' });
  const where = dlg.h('p', { class: st.source === 'none' ? '' : 'hint' }, connectionText(st));
  const choice = dlg.h('select', {
    onchange: async () => {
      await api.invoke('claude:provider-set', choice.value);
      st = await api.invoke('claude:key-status');
      where.textContent = connectionText(st);
      where.className = st.source === 'none' ? '' : 'hint';
    },
  }, ...CONNECTIONS.map(([v, label]) => dlg.h('option', { value: v, selected: st.provider === v }, label)));
  const v = await dlg.open({
    title: 'CLAUDE CONNECTION', sub: 'your choice is kept · a key is stored encrypted, never in your scripts',
    body: dlg.h('div', { class: 'body', style: 'max-width:560px' },
      lead ? dlg.h('p', {}, lead) : null,
      dlg.h('div', { class: 'field' }, dlg.h('label', {}, 'Connect through'), choice),
      where,
      dlg.h('div', { class: 'field' }, dlg.h('label', {}, 'API key (optional)'), input),
      dlg.h('p', { class: 'hint' }, 'A key stays in this app\'s main process and is only sent to the Anthropic API when you start a review. STET never switches between your sign-in and a key by itself: if the chosen one fails, the review says so.')),
    buttons: [
      ...(st.key === 'saved' ? [{ label: 'Remove key', value: 'clear' }] : []),
      { label: 'Check', value: 'check' },
      { label: 'Close', value: null },
      { label: 'Save', value: 'save', primary: true },
    ],
  });
  if (v === 'clear') { await api.invoke('claude:key-clear'); return (await api.invoke('claude:key-status')).source !== 'none'; }
  if (v === 'save' && input.value.trim()) {
    const r = await api.invoke('claude:key-set', input.value);
    input.value = '';
    if (!r.ok) { await dlg.alertBox('KEY NOT SAVED', r.error); return false; }
    st = await api.invoke('claude:key-status');
  }
  if (v === 'check' || (v === 'save' && st.key === 'saved' && st.source === 'saved')) {
    if (st.source === 'none') { await dlg.alertBox('NOT SET UP', connectionText(st)); return false; }
    const t = await api.invoke('claude:key-test');
    if (!t.ok) { await dlg.alertBox(st.source === 'claude-code' ? 'CLAUDE CODE CHECK FAILED' : 'KEY TEST FAILED', t.message); return st.source !== 'none'; }
    if (v === 'check') await dlg.alertBox('READY', st.source === 'claude-code' ? `${st.cli} is signed in. Reviews use your Claude plan.` : 'The API key works.');
  }
  return (await api.invoke('claude:key-status')).source !== 'none';
}

const LEVEL = { firm: 'FIRM', soft: 'LEARNING', note: 'NOTE', kept: 'PATTERN', voice: 'VOICE' };

/** The writer's guidelines (every screenplay), what they show, and the passages ignored in this one:
 *  each can be removed, a guideline can be written by hand, and RESET (pressed twice) starts over. */
export async function guidelinesDialog(rev) {
  const render = () => {
    const list = guidelinesOf(rev.flags), learned = patternsOf(rev.flags), ign = rev.lists().ignored;
    const what = (g) => {
      if (g.level === 'note') return esc(g.notes[0]);
      const pattern = g.key.startsWith('edit:') && g.edit && g.examples.length > 1;
      const head = pattern ? `${esc(g.edit.replace('→', ' → '))} <span class="hint">· ${g.examples.slice(0, 3).map(esc).join(' · ')}</span>` : esc(g.text);
      return `${head} <span class="hint">· ${CATEGORY_LABEL[g.category] || ''}</span>${g.notes.length ? `<div class="hint">${g.notes.map(esc).join(' · ')}</div>` : ''}`;
    };
    const row = (html, act, i, tag = '') => `<tr><td>${tag ? `<span class="gl-lv">${tag}</span>` : ''}${html}</td><td style="text-align:right">${act ? `<button class="tb" data-x="${act}" data-i="${i}">REMOVE</button>` : ''}</td></tr>`;
    // (what the flags show together: learned, so not removed on its own; it goes with its examples)
    const pattern = (p) => `${p.kind === 'kept' ? `keeps “${esc(p.what)}”` : `${esc(p.what)}’s lines`} <span class="hint">· ${CATEGORY_LABEL[p.category] || ''} · ${p.count} times</span>`;
    return `<p class="hint">What Revise leaves alone in every screenplay, learned from the suggestions you set aside.</p>
      <table class="t">${list.map((g, i) => row(what(g), 'g', i, LEVEL[g.level])).join('') || '<tr><td class="hint">none yet: +GUIDELINE on a suggestion adds one</td></tr>'}${learned.map((p) => row(pattern(p), '', 0, LEVEL[p.kind])).join('')}</table>
      <div class="gl-add"><input type="text" placeholder="write one for Claude: Rosa's dialogue mixes in Spanish on purpose" spellcheck="false"><button class="tb" data-x="add">ADD</button></div>
      <p class="hint" style="margin-top:14px">Ignored in this screenplay (${ign.length})</p><table class="t">${ign.map((x, i) => row(`${esc(x.text)} <span class="hint">· ${CATEGORY_LABEL[x.category] || x.category}</span>`, 'i', i)).join('') || '<tr><td class="hint">none</td></tr>'}</table>`;
  };
  const body = dlg.h('div', { class: 'body', style: 'width:560px', html: render() });
  const add = async () => {
    const field = body.querySelector('.gl-add input'), v = field.value.trim();
    if (!v) return field.focus();
    await rev.saveFlags(addFlag(rev.flags, noteFlag(v)));
    body.innerHTML = render();
    sync();
    body.querySelector('.gl-add input').focus();
  };
  // Enter in the field adds what is written (and doesn't close the window).
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.gl-add')) { e.preventDefault(); e.stopPropagation(); add(); } }, true);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    const i = +b.dataset.i;
    if (b.dataset.x === 'add') return add();
    if (b.dataset.x === 'g') await rev.saveFlags(removeGuideline(rev.flags, guidelinesOf(rev.flags)[i]));
    else {
      const x = rev.lists().ignored[i], all = rev.doc.revision.ignored;
      all.splice(all.indexOf(x), 1);
      rev.session.touch();
    }
    body.innerHTML = render();
    sync();
  });
  const reset = dlg.h('button', { class: 'btn', title: 'Forget every guideline (press twice)' }, 'RESET');
  const sync = () => { reset.disabled = !rev.flags.length; };
  reset.addEventListener('click', () => arm(reset, async () => { await rev.saveFlags([]); body.innerHTML = render(); sync(); }, { label: 'CONFIRM RESET' }));
  sync();
  return dlg.open({ title: 'REVISE GUIDELINES', body, foot: reset, buttons: [{ label: 'Close', value: null, primary: true }] });
}
