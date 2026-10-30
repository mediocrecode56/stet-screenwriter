// The English review in the real app: against a local stand-in for the Messages API (what is sent,
// the progress, hovering, accepting and undoing, edits made meanwhile, rate limits, failures and
// cancelling, keeping it all across a restart, gliding to a suggestion), and through a stand-in for
// the Claude Code CLI (how it is run, signed out, unreadable output, the writer's choice of
// connection). The real API is exercised separately with a real key (bench/revision-live.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { App, scratch, ROOT } from './harness.js';
import { startMock, elementsOf } from '../helpers/mock-anthropic.js';
import { decode } from '../../src/main/container.js';

const KEY = 'sk-ant-test-0000000000000000000000000000';
// "Claude" flags known mistakes wherever they appear (and one in an element that doesn't exist).
const RULES = [
  { find: 'enter in the kitchen', replacement: 'enters the kitchen', category: 'grammar', confidence: 'high' },
  { find: 'looking to him since five minutes', replacement: 'staring at him for five minutes', category: 'non_native', confidence: 'medium' },
  { find: 'made a decision of leaving', replacement: 'decided to leave', category: 'awkward', confidence: 'medium' },
  { find: 'ITNRO', replacement: 'INTRO', category: 'awkward', confidence: 'low' },
];
let tmp, app, mock, mode = {};
async function handler({ prompt, attempt }) {
  if (mode.status && (!mode.statusTimes || attempt <= mode.statusTimes)) return { status: mode.status, noRetry: mode.noRetry };
  const findings = [];
  for (const el of elementsOf(prompt)) for (const r of RULES) if (el.text.includes(r.find)) findings.push({ element: el.id, category: r.category, original: r.find, replacement: r.replacement, explanation: 'mock: ' + r.category, confidence: r.confidence });
  findings.push({ element: 'e999', category: 'grammar', original: 'nope', replacement: 'x', explanation: 'hallucinated element', confidence: 'high' });
  return { findings, delayMs: mode.delayMs || 0 };
}
const launch = (o = {}) => App.launch({ userData: path.join(tmp, 'ud'), env: { STET_ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: KEY }, ...o });
const consent = () => app.eval(`window.stet.invoke('settings:set', { reviewConsent: true }).then((s) => Object.assign(__stet.settings(), s))`);
before(async () => {
  tmp = await scratch('stet-review');
  mock = await startMock(handler);
  app = await launch({ hidden: true }); // hidden: no animation frames at all (the glide test needs that first)
  await consent();
});
after(async () => { await app?.close(); await mock?.close(); });

const SCRIPT = [['scene', 'INT. KITCHEN - NIGHT'], ['action', 'Mara enter in the kitchen and sits.'], ['character', 'TEO'], ['dialogue', "Ain't nobody awake. ITNRO starts soon."], ['action', 'She is looking to him since five minutes.'], ['action', 'Teo made a decision of leaving.']];
const texts = () => app.eval('__stet.editor.blocks.map((b) => b.text)');
const findings = () => app.eval(`__stet.revision.findings.map((f) => ({ id: f.id, cat: f.category, decision: f.decision, o: f.shownOriginal, r: f.shownReplacement, orig: f.original, applied: f.appliedText, why: f.explanation, at: __stet.revision.located(f) }))`);
const done = (timeout = 15000) => app.until('!!(__stet.revision.run && __stet.revision.run.finished)', { what: 'the review to finish', timeout });
const settled = () => app.until('!__stet.revision.timer', { what: 'the passages re-located (a moment after an edit)' });
// With undecided suggestions, "review again" asks first; the tests say yes.
// Started here and watched from the test (a hidden window's own timers run only about once a second).
const begin = async () => {
  await app.eval('(() => { const r = __stet.revision; window.__run0 = r.run; r.start(); })()');
  const asked = await app.until(`__stet.revision.run !== window.__run0 ? 'started' : [...document.querySelectorAll('#overlay .dlg:not([inert]) .btn.primary')].some((b) => b.textContent === 'Review') && 'asked'`, { what: 'the review to start (or ask first)' });
  if (asked === 'asked') await app.eval(`[...document.querySelectorAll('#overlay .dlg:not([inert]) .btn.primary')].find((b) => b.textContent === 'Review').click()`); // "review again?" yes
};
const ended = async (timeout = 15000) => {
  try { await app.until('__stet.revision.run && __stet.revision.run !== window.__run0 && __stet.revision.run.finished', { what: 'the review to end', timeout }); }
  catch (e) { throw new Error(e.message + ' ' + await app.eval(`JSON.stringify({ run: __stet.revision.run && { id: __stet.revision.run.id, fin: __stet.revision.run.finished, stage: __stet.revision.run.stage }, same: __stet.revision.run === window.__run0, run0: window.__run0 && window.__run0.id, dlg: document.querySelector('#overlay .dlg')?.innerText, open: __stet.revision.open().length, n: __stet.revision.findings.length, consent: __stet.settings().reviewConsent })`)); }
};
const review = async () => { await begin(); await ended(); };

test('a review sends a structured request with a progress indicator; one list in script order; nothing changed yet', async () => {
  await app.load(SCRIPT, {}, 'REV');
  mode = { delayMs: 700 };
  await app.eval('__stet.revision.show(true)');
  await begin();
  const prog = await app.until(`(() => { const p = document.querySelector('#rev .rv-progress'); return p && { text: p.textContent.replace(/\\s+/g, ' '), anim: getComputedStyle(p.querySelector('.rv-indet i')).animationName, pct: /\\d+\\s*%/.test(p.textContent) }; })()`, { what: 'the progress indicator' });
  assert.match(prog.text, /Claude is reviewing|Sending the script/);
  assert.match(prog.text, /CANCEL/);
  assert.deepEqual([prog.anim, prog.pct], ['rv-sweep', false], 'an indeterminate sweep, no made-up percentage');
  const t0 = Date.now(); await app.eval('__stet.editor.rev'); assert.ok(Date.now() - t0 < 200, 'the editor stays responsive');
  await ended();
  mode = {};
  assert.equal(await app.eval('!!document.querySelector("#rev .rv-progress")'), false, 'the indicator gone when finished');
  const req = mock.requests.find((r) => r.body && r.body.messages);
  assert.equal(req.body.model, 'claude-sonnet-5-5');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.headers['x-api-key'], KEY);
  const f = await findings();
  assert.deepEqual(f.map((x) => x.cat).sort(), ['awkward', 'awkward', 'grammar', 'non_native']);
  assert.ok(f.every((x) => x.decision === null && x.at));
  assert.equal(await app.eval('__stet.revision.run.rejected'), 1, 'the made-up element discarded');
  assert.deepEqual(await app.eval('[...document.querySelectorAll("#rev .rv-item")].map((n) => n.dataset.id)'), f.map((x) => x.id), 'one list, in script order');
  assert.deepEqual(f.map((x) => x.at.b), [1, 3, 4, 5]);
  // The top of the panel: no title, the last review in one line, the button centred under it, clear of the edges.
  const top = await app.eval(`(() => { const h = document.getElementById('rev'), r = h.getBoundingClientRect(), l = h.querySelector('.rv-line').getBoundingClientRect(), b = h.querySelector('.rv-run').getBoundingClientRect();
    return { title: /ENGLISH/.test(h.textContent), first: l.bottom <= b.top && l.top - r.top < 16, one: l.height < 16, off: Math.abs((b.left + b.right) / 2 - (r.left + r.right) / 2), gap: b.left - r.left, text: h.querySelector('.rv-line').textContent }; })()`);
  assert.deepEqual([top.title, top.first, top.one], [false, true, true], 'no title; the status first, on one line');
  assert.ok(top.off < 1.5 && top.gap >= 16, `centred (${top.off}px off), ${top.gap}px from the edge`);
  assert.match(top.text, /^Reviewed .+ · 4 of 4 open/);
  await app.eval('__stet.view.frame()');
  assert.ok(await app.eval('document.querySelectorAll(".revr").length') >= 4, 'the passages marked in the script');
  assert.equal((await texts())[1], 'Mara enter in the kitchen and sits.', 'reviewing changes nothing');
});

test('hovering a suggestion highlights exactly its passage; leaving removes it', async () => {
  const nn = (await findings()).find((f) => f.cat === 'non_native');
  const hov = (ev) => app.eval(`(() => { const n = document.querySelector('#rev .rv-item[data-id="${nn.id}"] .rv-why'); n.dispatchEvent(new MouseEvent('${ev}', { bubbles: true })); if ('${ev}' === 'mouseleave') document.getElementById('rev').dispatchEvent(new MouseEvent('mouseleave')); __stet.view.frame(); return { marks: (__stet.view.revision.marks || []).filter((m) => m.hov), dom: document.querySelectorAll('.revr.hov').length, item: document.querySelector('#rev .rv-item.hov')?.dataset.id || null }; })()`);
  const on = await hov('mouseover');
  const t4 = (await texts())[4];
  assert.equal(on.marks.length, 1);
  assert.deepEqual([on.marks[0].b, on.marks[0].s, on.marks[0].e], [4, t4.indexOf(nn.o), t4.indexOf(nn.o) + nn.o.length], 'exactly the passage the panel shows');
  assert.ok(on.dom >= 1 && on.item === nn.id);
  assert.deepEqual(await hov('mouseleave'), { marks: [], dom: 0, item: null });
});

test('decisions are explicit and kept: accept, undo the text, reopen, discard; accept again changes the text once; decided ones in script order', async () => {
  let f = await findings();
  const g = f.find((x) => x.cat === 'grammar'), aw = f.find((x) => x.o === 'made a decision of leaving');
  await app.eval(`__stet.revision.accept(['${g.id}'])`);
  assert.equal((await texts())[1], 'Mara enters the kitchen and sits.');
  assert.equal((await findings()).find((x) => x.id === g.id).o, 'enter in the kitchen', 'the original kept as reviewed');
  await app.eval('__stet.editor.undo()');
  await settled();
  assert.equal((await texts())[1], 'Mara enter in the kitchen and sits.');
  assert.equal((await findings()).find((x) => x.id === g.id).decision, 'accepted', 'undoing the text does not change the decision');
  await app.eval(`__stet.revision.reopen('${g.id}')`);
  assert.equal((await findings()).find((x) => x.id === g.id).decision, null, 'reopening is explicit');
  await app.eval(`__stet.revision.discard('${aw.id}')`);
  assert.equal((await findings()).find((x) => x.id === aw.id).decision, 'discarded', 'kept, with its decision');
  assert.equal((await texts())[5], 'Teo made a decision of leaving.');
  // Accept, reopen, accept again from its card: decided again, the text changed once.
  await app.eval(`__stet.revision.reopen('${aw.id}')`);
  await app.eval(`__stet.revision.accept(['${aw.id}'])`);
  await app.eval(`__stet.revision.accept(['${g.id}'])`);
  await app.eval(`__stet.revision.reopen('${g.id}')`);
  const re = (await findings()).find((x) => x.id === g.id);
  assert.ok(re.decision === null && re.at, 'still finds its passage (the change it made)');
  assert.match(await app.eval(`document.querySelector('#rev .rv-item[data-id="${g.id}"]').textContent`), /still in the script/);
  await app.eval(`document.querySelector('#rev .rv-item[data-id="${g.id}"] [data-act="accept"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  assert.equal((await findings()).find((x) => x.id === g.id).decision, 'accepted', 'decided again');
  assert.equal((await texts())[1], 'Mara enters the kitchen and sits.', 'changed once, not twice');
  await app.eval(`(() => { const r = __stet.revision; if (!r.showDecided) { r.showDecided = true; r.render(); } })()`);
  assert.deepEqual(await app.eval('[...document.querySelectorAll("#rev .rv-decided .rv-item")].map((n) => n.dataset.id)'), [g.id, aw.id], 'in script order, not the order decided');
});

test('near the lower end of the list a floating DECIDED button takes you to the decided ones; accepting a category is one undo step', async () => {
  await app.load(SCRIPT, {}, 'REV');
  await review();
  const f0 = await findings();
  await app.eval(`__stet.revision.discard('${f0[3].id}')`);
  await app.eval(`(() => { const r = __stet.revision; r.showDecided = false; document.getElementById('rev').style.height = '300px'; r.render(); document.querySelector('#rev .rv-list').scrollTop = 0; })()`);
  const move = (dy) => app.eval(`(() => { const l = document.querySelector('#rev .rv-list').getBoundingClientRect(); document.querySelector('#rev .rv-list').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: l.left + 20, clientY: ${dy} < 0 ? l.bottom + ${dy} : l.top + ${dy} })); return document.querySelector('#rev .rv-jump').classList.contains('on'); })()`);
  assert.equal(await move(10), false, 'not near the top');
  assert.equal(await move(-10), true, 'near the lower end, with decided ones below');
  assert.match(await app.eval(`document.querySelector('#rev .rv-jump').textContent`), /DECIDED · 1/);
  await app.eval(`document.querySelector('#rev .rv-jump').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  await app.until('__stet.revision.showDecided', { what: 'unfolded' });
  await app.until(`(() => { const l = document.querySelector('#rev .rv-list').getBoundingClientRect(), h = document.querySelector('#rev .rv-decided').getBoundingClientRect(); return h.top >= l.top - 1 && h.top < l.bottom; })()`, { what: 'scrolled to them' });
  assert.equal(await move(-10), false, 'no button once they are in sight');
  await app.eval(`document.getElementById('rev').style.height = ''`);
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.filter((f) => f.category === 'awkward' && !f.decision).map((f) => f.id)); })()`);
  assert.equal((await texts())[3], "Ain't nobody awake. INTRO starts soon.");
  await app.eval('__stet.editor.undo()');
  assert.equal((await texts())[3], "Ain't nobody awake. ITNRO starts soon.", 'one undo step');
});

test('edits made meanwhile never change a suggestion: passages are followed, or reported lost, never guessed', async () => {
  await app.load(SCRIPT, {}, 'REV');
  mode = { delayMs: 1200 };
  await begin();
  // While "Claude" thinks: rewrite the sentence that will be flagged as non-native, and move another.
  await app.eval(`(() => { const ed = __stet.editor;
    ed.setSel({ b: 4, o: 0 }, { b: 4, o: ed.blocks[4].text.length }); ed.backspace(); for (const c of 'She watches him.') ed.insertText(c);
    ed.setSel({ b: 1, o: 0 }); for (const c of 'Tired, ') ed.insertText(c); })()`);
  await done();
  mode = {};
  await settled();
  let f = await findings();
  const nn = f.find((x) => x.cat === 'non_native');
  assert.deepEqual([nn.decision, nn.o, nn.r, nn.at], [null, 'looking to him since five minutes', 'staring at him for five minutes', null], 'kept exactly, located nowhere');
  assert.match(await app.eval(`document.querySelector('#rev .rv-item[data-id="${nn.id}"]').textContent`), /can no longer be located/);
  const gr = f.find((x) => x.cat === 'grammar');
  assert.deepEqual(gr.at, { b: 1, s: 12, e: 12 + gr.orig.length }, 'followed to its new place');
  await app.eval(`(() => { const ed = __stet.editor; ed.setSel({ b: 5, o: 12 }); ed.insertText('x'); })()`); // typing inside a flagged passage
  await settled();
  f = await findings();
  const aw = f.find((x) => x.o === 'made a decision of leaving');
  assert.deepEqual([aw.decision, aw.at], [null, null]);
  assert.equal(await app.eval(`(() => { __stet.revision.setHover('${aw.id}'); const m = __stet.view.revision.marks.filter((x) => x.hov).length; __stet.revision.setHover(null); return m; })()`), 0, 'a lost one highlights nothing');
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.map((f) => f.id)); })()`);
  const t = await texts();
  assert.equal(t[1], 'Tired, Mara enters the kitchen and sits.');
  assert.equal(t[4], 'She watches him.', 'a lost suggestion is not applied');
  assert.equal(t[5], 'Teo made a dxecision of leaving.', 'an edited passage is not replaced');
});

test('rate limits are retried; a failure says so and can be retried; cancelling is prompt', async () => {
  await app.load(SCRIPT, {}, 'REV');
  mode = { status: 429, statusTimes: 2 };
  await review();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 0);
  assert.ok((await findings()).length >= 4);
  mode = { status: 500, noRetry: true };
  await review();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 1);
  assert.match(await app.eval('document.querySelector(".rv-fail").textContent'), /failed/);
  assert.match(await app.eval('document.querySelector("#rev .rv-status").textContent'), /Review incomplete/);
  assert.equal(await app.eval('!!document.querySelector("#rev .rv-progress")'), false);
  mode = {};
  await app.eval('__stet.revision.retryFailed()');
  await app.until('__stet.revision.run.finished && __stet.revision.run.failed.size === 0', { what: 'the retry to succeed' });
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 0);
  mode = { delayMs: 8000 };
  await begin();
  await app.until('!!document.querySelector("#rev .rv-progress")').catch(async (e) => { throw new Error(e.message + ' ' + await app.eval(`JSON.stringify({ run: __stet.revision.run && { fin: __stet.revision.run.finished, stage: __stet.revision.run.stage, failed: __stet.revision.run.failed.size }, same: __stet.revision.run === window.__run0, dlg: document.querySelector('#overlay .dlg')?.innerText, shown: !document.getElementById('rev')?.hidden })`)); });
  const t0 = Date.now();
  assert.match(await app.eval('__stet.revision.cancel(), document.querySelector("#rev .rv-progress").textContent'), /Cancelling/);
  await done();
  assert.ok(Date.now() - t0 < 3000, 'promptly');
  assert.equal(await app.eval('__stet.revision.run.cancelled'), true);
  assert.equal(await app.eval('!!document.querySelector("#rev .rv-progress")'), false);
  assert.match(await app.eval('document.querySelector("#rev .rv-status").textContent'), /cancelled/i);
  mode = {};
});

// Anywhere on a card (the explanation, the change, the gaps between its buttons, its edge) shows its passage, gliding it to the middle.
const LONG = [['scene', 'INT. KITCHEN - NIGHT'], ['action', 'Mara enter in the kitchen and sits.'],
  ...Array.from({ length: 90 }, (_, i) => ['action', `The rain goes on and on against the window, line ${i + 1}.`]), ['action', 'She is looking to him since five minutes.'],
  ...Array.from({ length: 90 }, (_, i) => ['action', `Still the rain, line ${i + 1}.`]), ['action', 'Teo made a decision of leaving.'],
  ...Array.from({ length: 60 }, (_, i) => ['action', `After, line ${i + 1}.`])];
let part = 0;
const PARTS = ['.rv-why', '.rv-diff', '.rv-acts', null];
const pressCard = (o) => { const p = PARTS[part++ % PARTS.length]; return app.eval(`(() => { const card = [...document.querySelectorAll('.rv-item')].find((n) => n.textContent.includes(${JSON.stringify(o)})); (${JSON.stringify(p)} ? card.querySelector(${JSON.stringify(p)}) : card).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); })()`); };
const centred = async (what) => {
  await app.until('!__stet.view.glide', { what: 'the glide to end' });
  const w = await app.eval(`(() => { const v = __stet.view, s = v.scroller, sel = __stet.editor.sel, a = v.caretRect(sel.a), b = v.caretRect(sel.f);
    const mid = (Math.min(a.y, b.y) + Math.max(a.y + a.h, b.y + b.h)) / 2, max = s.scrollHeight - s.clientHeight;
    return { off: Math.round(mid - (s.scrollTop + s.clientHeight / 2)), atEnd: s.scrollTop <= 0 || s.scrollTop >= max - 1, row: v.row }; })()`);
  assert.ok(Math.abs(w.off) <= w.row || w.atEnd, `${what}: the passage centred (off by ${w.off} px)`);
};
const glides = async (label, passages) => {
  await app.load(LONG, {}, 'GLIDE');
  await review();
  await app.eval('document.getElementById("scroller").scrollTop = 0');
  for (const o of passages) { await pressCard(o); await centred(`${label}, ${o}`); }
};

test('clicking a suggestion glides its passage to the middle of the screen, even in a window that draws no frames', async () => {
  await glides('a hidden window', ['made a decision', 'enter in the kitchen']); // (its timers run about once a second: far down and back up is enough)
});

test('suggestions, decisions and ignored passages are kept across a restart; a new review starts afresh', async () => {
  await app.load(SCRIPT, {}, 'REV');
  await review();
  let f = await findings();
  const nn = f.find((x) => x.cat === 'non_native'), g = f.find((x) => x.cat === 'grammar'), it = f.find((x) => x.o === 'ITNRO');
  await app.eval(`__stet.revision.ignore('${nn.id}')`);
  await app.eval(`__stet.revision.accept(['${g.id}'])`);
  await app.eval(`__stet.revision.addToGuidelines('${it.id}', 'a band name')`);
  assert.deepEqual(await app.eval('__stet.settings().dictionary'), [], 'the spelling dictionary is not the revision\'s');
  const file = path.join(tmp, 'Rev.stet');
  assert.equal((await app.saveTo(file)).ok, true);
  const json = JSON.parse(await decode(await fs.readFile(file)));
  assert.deepEqual(json.revision.ignored, [{ text: 'looking to him since five minutes', category: 'non_native' }]);
  assert.equal(json.revision.review.findings.length, 4);
  assert.ok(!JSON.stringify(json).includes('sk-ant'), 'no key in the screenplay file');
  const before = (await findings()).map((x) => ({ ...x, at: undefined }));
  await app.close();
  app = await launch(); // shown, from here on
  await consent();
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  await app.eval('__stet.revision.show(true)');
  f = await findings();
  assert.deepEqual(f.map((x) => ({ ...x, at: undefined })), before, 'the same suggestions, text and decisions');
  const ga = f.find((x) => x.cat === 'grammar');
  assert.deepEqual(ga.at, { b: 1, s: 5, e: 5 + ga.applied.length }, 'an accepted change located again');
  assert.ok(f.find((x) => x.o === 'made a decision of leaving').at, 'an undecided one too');
  mock.requests.length = 0;
  await review();
  f = await findings();
  assert.ok(f.every((x) => x.decision === null), 'no decisions carried over');
  assert.ok(!f.some((x) => x.cat === 'non_native' || x.id === g.id), 'ignored passages not shown again; the old ones gone');
  // Set aside once, a guideline is soft: the suggestion still comes, marked as close to it.
  assert.equal(await app.eval(`__stet.revision.findings.filter((x) => x.original === 'ITNRO' && x.guide).length`), 1, 'shown, marked as close to a guideline');
  const sys = mock.requests.find((r) => r.body && r.body.system).body.system[0].text;
  assert.match(sys, /guidelines[\s\S]*\[hint\] awkward: "ITNRO"[\s\S]*a band name/);
  assert.match(sys, /already reviewed[\s\S]*looking to him since five minutes/);
  // The guidelines window: the passages ignored in this screenplay first, then the guidelines (what
  // they are for in one sentence), each section folding from its header with its own RESET, which
  // works only on a second press and empties that section alone.
  await app.eval(`__stet.cmd.run('revise-guides')`);
  const sec = (k) => `#overlay .dlg .gl-sec[data-k="${k}"]`;
  await app.until(`!!document.querySelector('${sec('guides')} .gl-reset')`, { what: 'the guidelines window' });
  assert.deepEqual(await app.eval(`[...document.querySelectorAll('#overlay .dlg .gl-sec')].map((s) => s.dataset.k)`), ['ignored', 'guides'], 'ignored at the top');
  assert.equal(await app.eval(`document.querySelector('${sec('guides')} .gl-in > p.gl-lead').textContent`), 'What Revise leaves alone everywhere, learned from the suggestions you set aside.');
  await app.clickOn(`${sec('guides')} .gl-fold`);
  await app.until(`document.querySelector('${sec('guides')}').classList.contains('shut')`, { what: 'the guidelines folded shut' });
  await app.clickOn(`${sec('guides')} .gl-fold`);
  await app.until(`!document.querySelector('${sec('guides')}').classList.contains('shut')`, { what: 'and open again' });
  const ignored = await app.eval('__stet.session.doc.revision.ignored.length');
  await app.clickOn(`${sec('guides')} .gl-reset`);
  assert.equal(await app.eval(`document.querySelector('${sec('guides')} .gl-reset').textContent`), 'CONFIRM');
  assert.ok((await app.eval('__stet.settings().guidelines.length')) > 0, 'one press: nothing forgotten');
  await app.clickOn(`${sec('guides')} .gl-reset`);
  await app.until(`(__stet.settings().guidelines || []).length === 0 && document.querySelector('${sec('guides')} .gl-reset').disabled`, { what: 'the guidelines reset' });
  assert.equal(await app.eval('__stet.session.doc.revision.ignored.length'), ignored, 'the ignored passages left as they were');
  await app.key('Escape');
});

test('in a shown window the glide passes through the positions in between, one way; the card buttons still do their own job; the marks are grey', async () => {
  // Far down, back up, one already on screen, all the way up: each time it ends in the middle.
  await glides('a shown window', ['made a decision', 'looking to him', 'looking to him', 'enter in the kitchen']);
  // Clicked again and again mid-glide: it always ends on the last one, centred.
  for (const o of ['made a decision', 'enter in the kitchen', 'made a decision', 'looking to him']) { await pressCard(o); await app.eval('new Promise((r) => setTimeout(r, 60))'); }
  await centred('after rapid clicks');
  assert.match(await app.eval('__stet.editor.blocks[__stet.editor.caret.b].text'), /looking to him/);
  await app.eval('document.getElementById("scroller").scrollTop = 0');
  await app.frame();
  const samples = await app.eval(`new Promise((done) => {
    const s = document.getElementById('scroller'), out = [];
    [...document.querySelectorAll('.rv-item')].find((n) => n.textContent.includes('made a decision')).querySelector('.rv-why').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const tick = () => { out.push(s.scrollTop); __stet.view.glide ? requestAnimationFrame(tick) : done(out); };
    requestAnimationFrame(tick);
  })`);
  const end = samples.at(-1);
  assert.ok(samples.filter((y) => y > 5 && y < end - 5).length >= 5, 'a glide through the positions in between, not a jump');
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1] - 0.5, 'one way only');
  const before = await app.eval('__stet.revision.findings.filter((f) => !f.decision).length');
  await app.eval(`[...document.querySelectorAll('.rv-item')].find((n) => n.textContent.includes('enter in the kitchen')).querySelector('[data-act="discard"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  assert.equal(await app.eval('__stet.revision.findings.filter((f) => !f.decision).length'), before - 1, 'DISCARD discards');
  await app.frame();
  const look = await app.eval(`(() => { const st = getComputedStyle(document.querySelector('.revr.cur')); return { bg: st.backgroundColor, shadow: st.boxShadow, border: st.borderBottomWidth }; })()`);
  const [r, g, b] = look.bg.match(/[\d.]+/g).map(Number);
  assert.ok(r === g && g === b, `the selected suggestion's shade is a grey, never a highlight colour (${look.bg})`);
  assert.deepEqual([look.shadow, look.border], ['none', '0px'], 'no outline, no underline');
});

// ---- through Claude Code ----

const FAKE = path.join(ROOT, 'test', 'helpers', 'fake-claude-code.mjs');
let log, modeFile;
const calls = async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cliMode = (m) => fs.writeFile(modeFile, m);

test('with no API key the review runs through Claude Code: no tools, no settings, the script on stdin, an empty folder, no key', async () => {
  log = path.join(tmp, 'calls.jsonl'); modeFile = path.join(tmp, 'cc-mode');
  await cliMode('');
  await app.close();
  app = await App.launch({ userData: path.join(tmp, 'ud-cc'), env: { STET_CLAUDE_CODE: FAKE, FAKE_CC_LOG: log, FAKE_CC_MODE_FILE: modeFile, ANTHROPIC_API_KEY: '' } });
  await consent();
  assert.equal((await app.eval(`window.stet.invoke('claude:key-status')`)).source, 'claude-code');
  await app.load(SCRIPT.filter((b) => !b[1].includes('ITNRO')), {}, 'CLI');
  await app.eval('__stet.revision.show(true); __stet.revision.start()');
  await done();
  assert.deepEqual((await app.eval('__stet.revision.findings.map((f) => f.category)')).sort(), ['awkward', 'grammar', 'non_native']);
  const [c] = await calls();
  const arg = (k) => c.args[c.args.indexOf(k) + 1];
  assert.ok(c.args.includes('-p'));
  assert.deepEqual([arg('--output-format'), arg('--model'), arg('--tools'), arg('--setting-sources')], ['json', 'claude-sonnet-5-5', '', ''], 'json out, the model, all tools off, no user or project settings');
  assert.ok(c.args.includes('--strict-mcp-config') && c.args.includes('--no-session-persistence') && c.args.includes('--disable-slash-commands'));
  assert.equal(JSON.parse(arg('--json-schema')).type, 'object');
  assert.match(c.system, /screenplay/i, 'the system prompt from a file');
  assert.match(c.stdin, /Mara enter in the kitchen/, 'the script on stdin…');
  assert.ok(!c.args.join(' ').includes('Mara'), '…never on the command line');
  assert.match(path.basename(c.cwd), /^stet-review-/, 'in an empty temp folder');
  assert.equal(c.apiKey, null, 'no API key passed on');
  await app.until(() => fs.stat(c.cwd).then(() => false, () => true), { what: 'the temp folder removed' });
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.filter((f) => f.category === 'grammar').map((f) => f.id)); })()`);
  assert.equal((await texts())[1], 'Mara enters the kitchen and sits.', 'accepting works the usual way');
});

test('Claude Code signed out, slow, or answering nonsense: a clear message, a prompt cancel, nothing trusted', async () => {
  await fs.rm(log, { force: true });
  await cliMode('logged-out');
  await review();
  assert.match(await app.eval('[...__stet.revision.run.failed.values()][0].message'), /not signed in/);
  await cliMode('slow');
  await begin();
  await app.until(async () => (await calls()).length >= 2, { what: 'the CLI started' });
  const t0 = Date.now();
  await app.eval('__stet.revision.cancel()');
  await ended(5000);
  assert.ok(Date.now() - t0 < 3000, 'cancelled promptly');
  assert.equal(await app.eval('__stet.revision.run.cancelled'), true);
  await cliMode('garbage');
  await review();
  assert.equal(await app.eval('__stet.revision.findings.length'), 0);
  assert.match(await app.eval('[...__stet.revision.run.failed.values()][0].message'), /Claude Code: panic/);
  await fs.rm(log, { force: true });
  await cliMode('auth-out');
  await review();
  assert.match(await app.eval('__stet.revision.run.fatal.message'), /not signed in/, 'signed out: one message before anything is sent');
  assert.equal((await calls()).length, 0, 'no review started');
  await cliMode('');
});

test('the connection is the writer’s choice, kept across a restart, and never switched behind their back', async () => {
  await app.close();
  await fs.rm(log, { force: true });
  const env = (key) => ({ STET_CLAUDE_CODE: FAKE, FAKE_CC_LOG: log, FAKE_CC_MODE_FILE: modeFile, ANTHROPIC_API_KEY: key, STET_ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
  const ud = path.join(tmp, 'ud-choice');
  app = await App.launch({ userData: ud, env: env('sk-ant-test-0000000000000000000000') });
  await consent();
  const status = () => app.eval(`window.stet.invoke('claude:key-status')`);
  let st = await status();
  assert.deepEqual([st.provider, st.source, !!st.cli], ['auto', 'env', true], 'automatic: a key that is set up comes first; Claude Code found too');
  await app.eval(`window.stet.invoke('claude:provider-set', 'cli')`);
  assert.equal((await status()).source, 'claude-code', 'Claude sign-in chosen: through Claude Code although a key is set');
  await app.load(SCRIPT.filter((b) => !b[1].includes('ITNRO')), {}, 'CLI');
  await app.eval('__stet.revision.start()'); await done();
  assert.equal(await app.eval('__stet.revision.findings.length'), 3);
  assert.equal((await calls())[0].apiKey, null, 'the key never reaches the CLI');
  await app.eval(`window.stet.invoke('claude:provider-set', 'api')`);
  await app.close();
  await fs.rm(log, { force: true });
  app = await App.launch({ userData: ud, env: env('') });
  await consent();
  st = await status();
  assert.deepEqual([st.provider, st.source], ['api', 'none'], 'kept across the restart');
  await app.load(SCRIPT, {}, 'CLI');
  await app.eval('void __stet.revision.start()'); // (it waits on the dialog)
  await app.dialogMatching(/set to use an API key.*Claude sign-in/s);
  await app.key('Escape');
  await app.noDialog();
  assert.equal((await calls()).length, 0, 'it did not fall back to Claude Code by itself');
  assert.equal(await app.eval('__stet.revision.run'), null, 'no review started');
});
