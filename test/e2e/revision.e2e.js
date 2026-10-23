// English revision in the real app, against a local mock of the Messages API
// (the real API is exercised separately with a real key; see README).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { App, sleep } from './cdp.js';
import { startMock, elementsOf } from '../helpers/mock-anthropic.js';
import { decode } from '../../src/main/container.js';

let tmp, app, mock, mode = {};
const KEY = 'sk-ant-test-0000000000000000000000000000';

// "Claude": flags known mistakes wherever they appear in a chunk.
const RULES = [
  { find: 'enter in the kitchen', original: 'enter in the kitchen', replacement: 'enters the kitchen', category: 'grammar', confidence: 'high' },
  { find: 'looking to him since five minutes', original: 'looking to him since five minutes', replacement: 'staring at him for five minutes', category: 'non_native', confidence: 'medium' },
  { find: 'made a decision of leaving', original: 'made a decision of leaving', replacement: 'decided to leave', category: 'awkward', confidence: 'medium' },
  { find: 'ITNRO', original: 'ITNRO', replacement: 'INTRO', category: 'awkward', confidence: 'low' },
];

async function handler({ prompt, attempt }) {
  if (mode.status && (!mode.statusTimes || attempt <= mode.statusTimes)) return { status: mode.status, noRetry: mode.noRetry };
  const findings = [];
  for (const el of elementsOf(prompt)) {
    for (const r of RULES) if (el.text.includes(r.find)) findings.push({ element: el.id, category: r.category, original: r.original, replacement: r.replacement, explanation: 'mock: ' + r.category, confidence: r.confidence });
  }
  findings.push({ element: 'e999', category: 'grammar', original: 'nope', replacement: 'x', explanation: 'hallucinated element', confidence: 'high' });
  return { findings, delayMs: mode.delayMs || 0 };
}

const loadScript = () => app.eval(`(async () => {
  const { newDocument, makeBlock } = await import('../core/model.js');
  const d = newDocument('REV'); d.settings.backup.enabled = false;
  d.blocks = [
    makeBlock('scene', 'INT. KITCHEN - NIGHT'),
    makeBlock('action', 'Mara enter in the kitchen and sits.'),
    makeBlock('character', 'TEO'),
    makeBlock('dialogue', "Ain't nobody awake. ITNRO starts soon."),
    makeBlock('action', 'She is looking to him since five minutes.'),
    makeBlock('action', 'Teo made a decision of leaving.'),
  ];
  __stet.session.load(d, null);
})()`);
const texts = () => app.eval('__stet.editor.blocks.map(b => b.text)');
const findings = () => app.eval(`__stet.revision.findings.map(f => ({ id: f.id, cat: f.category, decision: f.decision, o: f.shownOriginal, r: f.shownReplacement, orig: f.original, applied: f.appliedText, why: f.explanation, at: __stet.revision.located(f) }))`);
const waitDone = async () => { for (let i = 0; i < 300; i++) { if (await app.eval('!!(__stet.revision.run && __stet.revision.run.finished)')) return; await sleep(50); } throw new Error('review did not finish'); };
const settle = () => sleep(250); // documentChanged() re-locates after a short idle delay
const launch = () => App.launch({ userData: path.join(tmp, 'ud'), env: { STET_ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: KEY } });
const consent = () => app.eval(`window.stet.invoke('settings:set', { reviewConsent: true }).then(s => { const cur = __stet.settings(); Object.assign(cur, s); })`);
// With undecided suggestions, "review again" asks first; tests answer yes.
const startReview = () => app.eval(`(async () => { const r = __stet.revision; const p = r.start(); await new Promise(res => setTimeout(res, 30)); const ok = [...document.querySelectorAll('#overlay .btn.primary')].find(b => b.textContent === 'Review'); if (ok) ok.click(); await p; })()`);

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'stet-rev-'));
  mock = await startMock(handler);
  app = await launch();
  await consent();
});
after(async () => { if (app) await app.close(); if (mock) await mock.close(); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('review sends a structured request; a progress indicator shows while waiting', async () => {
  await loadScript();
  mode = { delayMs: 700 };
  await app.eval('__stet.revision.show(true)');
  await startReview();
  await sleep(150);
  const prog = await app.eval(`(() => { const p = document.querySelector('#rev .rv-progress'); return p && { text: p.textContent.replace(/\\s+/g, ' '), anim: getComputedStyle(p.querySelector('.rv-indet i')).animationName, pct: /\\d+\\s*%/.test(p.textContent) }; })()`);
  assert.ok(prog, 'indicator shown');
  assert.match(prog.text, /Claude is reviewing|Sending the script/);
  assert.match(prog.text, /CANCEL/);
  assert.equal(prog.anim, 'rv-sweep', 'indeterminate animation');
  assert.equal(prog.pct, false, 'no made-up percentage');
  // The editor stays responsive while waiting.
  const t0 = Date.now(); await app.eval('__stet.editor.rev'); assert.ok(Date.now() - t0 < 200);
  await waitDone();
  mode = {};
  assert.equal(await app.eval('!!document.querySelector("#rev .rv-progress")'), false, 'indicator gone when finished');
  const req = mock.requests.find((r) => r.body && r.body.messages);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.headers['x-api-key'], KEY);
  const fs_ = await findings();
  assert.deepEqual(fs_.map((f) => f.cat).sort(), ['awkward', 'awkward', 'grammar', 'non_native']);
  assert.ok(fs_.every((f) => f.decision === null && f.at));
  assert.equal(await app.eval('__stet.revision.run.rejected'), 1, 'hallucinated element discarded');
  const shown = await app.eval('[...document.querySelectorAll("#rev .rv-item")].map(n => n.dataset.id)');
  assert.deepEqual(shown, fs_.map((f) => f.id), 'one list, in script order');
  assert.deepEqual(fs_.map((f) => f.at.b), [1, 3, 4, 5]);
  await app.eval('__stet.view.frame()');
  assert.ok(await app.eval('document.querySelectorAll(".revr").length') >= 4, 'flagged passages marked in the script');
  assert.equal(await app.eval('__stet.editor.blocks[1].text'), 'Mara enter in the kitchen and sits.', 'reviewing changes nothing');
});

test('hovering a suggestion highlights exactly its passage; leaving removes it', async () => {
  const nn = (await findings()).find((f) => f.cat === 'non_native');
  const hov = (ev) => app.eval(`(() => { const n = document.querySelector('#rev .rv-item[data-id="${nn.id}"] .rv-why'); n.dispatchEvent(new MouseEvent('${ev}', { bubbles: true })); if ('${ev}' === 'mouseleave') document.getElementById('rev').dispatchEvent(new MouseEvent('mouseleave')); __stet.view.frame(); return { marks: (__stet.view.revision.marks || []).filter(m => m.hov), dom: document.querySelectorAll('.revr.hov').length, item: document.querySelector('#rev .rv-item.hov')?.dataset.id || null }; })()`);
  const on = await hov('mouseover');
  assert.equal(on.marks.length, 1);
  const t4 = (await texts())[4];
  assert.equal(nn.o, 'looking to him since five minutes');
  assert.deepEqual([on.marks[0].b, on.marks[0].s, on.marks[0].e], [4, t4.indexOf(nn.o), t4.indexOf(nn.o) + nn.o.length], 'exactly the passage shown in the panel');
  assert.ok(on.dom >= 1, 'highlight painted');
  assert.equal(on.item, nn.id);
  const off = await hov('mouseleave');
  assert.equal(off.marks.length, 0);
  assert.equal(off.dom, 0);
  assert.equal(off.item, null);
});

test('decisions are explicit and permanent: accept, undo, discard, reopen', async () => {
  const g = (await findings()).find((f) => f.cat === 'grammar');
  await app.eval(`__stet.revision.accept(['${g.id}'])`);
  assert.equal((await texts())[1], 'Mara enters the kitchen and sits.');
  const acc = (await findings()).find((f) => f.id === g.id);
  assert.equal(acc.decision, 'accepted');
  assert.equal(acc.o, 'enter in the kitchen', 'original kept as reviewed');
  await app.eval('__stet.editor.undo()'); await settle();
  assert.equal((await texts())[1], 'Mara enter in the kitchen and sits.');
  assert.equal((await findings()).find((f) => f.id === g.id).decision, 'accepted', 'undoing the text does not change the decision');
  await app.eval(`__stet.revision.reopen('${g.id}')`);
  assert.equal((await findings()).find((f) => f.id === g.id).decision, null, 'reopen is explicit');
  const aw = (await findings()).find((f) => f.o === 'made a decision of leaving');
  await app.eval(`__stet.revision.discard('${aw.id}')`);
  const after = (await findings()).find((f) => f.id === aw.id);
  assert.equal(after.decision, 'discarded', 'discarded suggestions are kept, with their decision');
  assert.equal((await texts())[5], 'Teo made a decision of leaving.');
});

test('accept, reopen, accept again: decided again, the text changed once; decided ones stay in script order', async () => {
  await loadScript();
  await startReview(); await waitDone();
  const f0 = await findings();
  const g = f0.find((f) => f.cat === 'grammar'), aw = f0.find((f) => f.o === 'made a decision of leaving');
  await app.eval(`__stet.revision.accept(['${aw.id}'])`);
  await app.eval(`__stet.revision.accept(['${g.id}'])`);
  await app.eval(`__stet.revision.reopen('${g.id}')`);
  const re = (await findings()).find((f) => f.id === g.id);
  assert.equal(re.decision, null);
  assert.ok(re.at, 'still finds its passage (the change it made)');
  assert.match(await app.eval(`document.querySelector('#rev .rv-item[data-id="${g.id}"]').textContent`), /still in the script/);
  assert.equal(await app.eval(`document.querySelector('#rev .rv-item[data-id="${g.id}"] [data-act="accept"]').disabled`), false, 'ACCEPT works');
  await app.eval(`document.querySelector('#rev .rv-item[data-id="${g.id}"] [data-act="accept"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  assert.equal((await findings()).find((f) => f.id === g.id).decision, 'accepted', 'decided again');
  assert.equal((await texts())[1], 'Mara enters the kitchen and sits.', 'changed once, not twice');
  await app.eval(`(() => { const r = __stet.revision; if (!r.showDecided) { r.showDecided = true; r.render(); } })()`);
  const decided = await app.eval('[...document.querySelectorAll("#rev .rv-decided .rv-item")].map(n => n.dataset.id)');
  assert.deepEqual(decided, [g.id, aw.id], 'decided in script order, not the order decided');
});

test('near the lower end of the list, a floating DECIDED button takes you to the decided ones', async () => {
  await loadScript();
  await startReview(); await waitDone();
  const f0 = await findings();
  await app.eval(`__stet.revision.discard('${f0[3].id}')`);
  await app.eval(`(() => { const r = __stet.revision; r.showDecided = false; document.getElementById('rev').style.height = '300px'; r.render(); document.querySelector('#rev .rv-list').scrollTop = 0; })()`);
  const move = (dy) => app.eval(`(() => { const l = document.querySelector('#rev .rv-list').getBoundingClientRect(); document.querySelector('#rev .rv-list').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: l.left + 20, clientY: ${dy} < 0 ? l.bottom + ${dy} : l.top + ${dy} })); return document.querySelector('#rev .rv-jump').classList.contains('on'); })()`);
  assert.equal(await move(10), false, 'not near the top');
  assert.equal(await move(-10), true, 'shown near the lower end while the decided ones are below');
  assert.match(await app.eval(`document.querySelector('#rev .rv-jump').textContent`), /DECIDED · 1/);
  await app.eval(`document.querySelector('#rev .rv-jump').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  await sleep(50);
  assert.equal(await app.eval('__stet.revision.showDecided'), true, 'unfolded');
  const vis = await app.eval(`(() => { const l = document.querySelector('#rev .rv-list').getBoundingClientRect(), h = document.querySelector('#rev .rv-decided').getBoundingClientRect(); return h.top >= l.top - 1 && h.top < l.bottom; })()`);
  assert.ok(vis, 'scrolled to them');
  assert.equal(await move(-10), false, 'no button once they are in sight');
  await app.eval(`document.getElementById('rev').style.height = ''`);
});

test('accept-all in a category is one undo step', async () => {
  await loadScript();
  await startReview(); await waitDone();
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.filter(f => f.category === 'awkward' && !f.decision).map(f => f.id)); })()`);
  const t = await texts();
  assert.equal(t[5], 'Teo decided to leave.');
  assert.equal(t[3], "Ain't nobody awake. INTRO starts soon.");
  await app.eval('__stet.editor.undo()');
  const u = await texts();
  assert.equal(u[5], 'Teo made a decision of leaving.');
  assert.equal(u[3], "Ain't nobody awake. ITNRO starts soon.");
});

test('edits never change a suggestion; passages are followed or reported lost, never guessed', async () => {
  await loadScript();
  mode = { delayMs: 1200 };
  await startReview();
  await sleep(200);
  // While Claude "thinks", rewrite the sentence that will be flagged as non-native and move another.
  await app.eval(`(() => { const ed = __stet.editor;
    ed.setSel({ b: 4, o: 0 }, { b: 4, o: ed.blocks[4].text.length }); ed.backspace(); for (const c of 'She watches him.') ed.insertText(c);
    ed.setSel({ b: 1, o: 0 }); for (const c of 'Tired, ') ed.insertText(c); })()`);
  await waitDone();
  mode = {};
  await settle();
  let f = await findings();
  const nn = f.find((x) => x.cat === 'non_native');
  assert.equal(nn.decision, null, 'still undecided');
  assert.equal(nn.o, 'looking to him since five minutes', 'text kept exactly');
  assert.equal(nn.r, 'staring at him for five minutes');
  assert.equal(nn.at, null, 'its passage is gone, so it is not located anywhere');
  assert.match(await app.eval(`document.querySelector('#rev .rv-item[data-id="${nn.id}"]').textContent`), /can no longer be located/);
  const gr = f.find((x) => x.cat === 'grammar');
  assert.deepEqual(gr.at, { b: 1, s: 7 + 5, e: 7 + 5 + gr.orig.length }, 'followed to its new position');
  // Typing inside the flagged passage: kept, but never applied to the wrong text.
  await app.eval(`(() => { const ed = __stet.editor; ed.setSel({ b: 5, o: 12 }); ed.insertText('x'); })()`);
  await settle();
  f = await findings();
  const aw = f.find((x) => x.o === 'made a decision of leaving');
  assert.equal(aw.decision, null);
  assert.equal(aw.at, null);
  // Hovering a lost suggestion highlights nothing.
  const marks = await app.eval(`(() => { __stet.revision.setHover('${aw.id}'); const m = __stet.view.revision.marks.filter(x => x.hov).length; __stet.revision.setHover(null); return m; })()`);
  assert.equal(marks, 0);
  await app.eval(`(() => { const r = __stet.revision; r.accept(r.findings.map(f => f.id)); })()`);
  const t = await texts();
  assert.equal(t[1], 'Tired, Mara enters the kitchen and sits.');
  assert.equal(t[4], 'She watches him.', 'lost suggestion not applied');
  assert.equal(t[5], 'Teo made a dxecision of leaving.', 'edited passage not replaced');
});

test('rate limits are retried; failures and cancellation give clear feedback', async () => {
  await loadScript();
  mode = { status: 429, statusTimes: 2 }; // SDK retries with backoff
  await startReview(); await waitDone();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 0);
  assert.ok((await findings()).length >= 4);

  mode = { status: 500, noRetry: true };
  await startReview(); await waitDone();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 1);
  assert.match(await app.eval('document.querySelector(".rv-fail").textContent'), /failed/);
  assert.match(await app.eval('document.querySelector("#rev .rv-status").textContent'), /Review incomplete/);
  assert.equal(await app.eval('!!document.querySelector("#rev .rv-progress")'), false);
  mode = {};
  await app.eval('__stet.revision.retryFailed()'); await waitDone();
  assert.equal(await app.eval('__stet.revision.run.failed.size'), 0);
  assert.ok((await findings()).length >= 4);

  mode = { delayMs: 8000 };
  await startReview();
  await sleep(300);
  const t0 = Date.now();
  assert.match(await app.eval('__stet.revision.cancel(), document.querySelector("#rev .rv-progress").textContent'), /Cancelling/);
  await waitDone();
  assert.ok(Date.now() - t0 < 3000, 'cancel is prompt');
  assert.equal(await app.eval('__stet.revision.run.cancelled'), true);
  assert.equal(await app.eval('!!document.querySelector("#rev .rv-progress")'), false, 'indicator gone after cancel');
  assert.match(await app.eval('document.querySelector("#rev .rv-status").textContent'), /cancelled/i);
  mode = {};
});

test('suggestions, decisions, ignores persist across restarts; a new review replaces them', async () => {
  await loadScript();
  await startReview(); await waitDone();
  let f = await findings();
  const nn = f.find((x) => x.cat === 'non_native');
  const g = f.find((x) => x.cat === 'grammar');
  await app.eval(`__stet.revision.ignore('${nn.id}')`);
  await app.eval(`__stet.revision.accept(['${g.id}'])`);
  const it = f.find((x) => x.o === 'ITNRO');
  await app.eval(`__stet.revision.addToDictionary('${it.id}', 'ITNRO')`);
  const file = path.join(tmp, 'Rev.stet');
  assert.equal((await app.eval(`__stet.session.saveTo(${JSON.stringify(file)})`)).ok, true);
  const json = JSON.parse(await decode(await fs.readFile(file)));
  assert.deepEqual(json.revision.ignored, [{ text: 'looking to him since five minutes', category: 'non_native' }]);
  assert.equal(json.revision.review.findings.length, 4);
  assert.ok(!JSON.stringify(json).includes('sk-ant'), 'no key in the screenplay file');
  const before = (await findings()).map((x) => ({ ...x, at: undefined }));

  await app.close();
  app = await launch();
  await app.eval(`__stet.openPath(${JSON.stringify(file)})`);
  await app.eval('__stet.revision.show(true)');
  f = await findings();
  assert.deepEqual(f.map((x) => ({ ...x, at: undefined })), before, 'same suggestions, text and decisions after a restart');
  const ga = f.find((x) => x.cat === 'grammar');
  assert.deepEqual(ga.at, { b: 1, s: 5, e: 5 + ga.applied.length }, 'accepted change located again');
  assert.ok(f.find((x) => x.o === 'made a decision of leaving').at, 'undecided suggestion located again');
  assert.equal(await app.eval('document.querySelectorAll("#rev .rv-item").length') >= 1, true);

  // A new review starts from scratch: no suggestions or decisions carried over.
  mock.requests.length = 0;
  await startReview(); await waitDone();
  f = await findings();
  assert.ok(f.every((x) => x.decision === null), 'no decisions carried over');
  assert.ok(!f.some((x) => x.cat === 'non_native'), 'ignored passage not shown again');
  assert.ok(!f.some((x) => x.o === 'ITNRO'), 'dictionary word not shown again');
  assert.ok(!f.some((x) => x.id === g.id), 'old suggestions gone');
  const sys = mock.requests.find((r) => r.body && r.body.system).body.system[0].text;
  assert.match(sys, /dictionary[\s\S]*"ITNRO"/);
  assert.match(sys, /already reviewed[\s\S]*looking to him since five minutes/);
});

test('clicking a suggestion always glides its passage to the middle of the screen', async () => {
  const longScript = () => app.eval(`(async () => {
    const { newDocument, makeBlock } = await import('../core/model.js');
    const d = newDocument('GLIDE'); d.settings.backup.enabled = false;
    d.blocks = [makeBlock('scene', 'INT. KITCHEN - NIGHT'), makeBlock('action', 'Mara enter in the kitchen and sits.')];
    for (let i = 0; i < 90; i++) d.blocks.push(makeBlock('action', 'The rain goes on and on against the window, line ' + (i + 1) + '.'));
    d.blocks.push(makeBlock('action', 'She is looking to him since five minutes.'));
    for (let i = 0; i < 90; i++) d.blocks.push(makeBlock('action', 'Still the rain, line ' + (i + 1) + '.'));
    d.blocks.push(makeBlock('action', 'Teo made a decision of leaving.'));
    for (let i = 0; i < 60; i++) d.blocks.push(makeBlock('action', 'After, line ' + (i + 1) + '.'));
    __stet.session.load(d, null);
  })()`);
  // Anywhere on the card: the explanation, the change itself, the gaps in the button row, the card's own edge (in turn).
  let part = 0;
  const PARTS = ['.rv-why', '.rv-diff', '.rv-acts', null];
  const press = (o) => { const p = PARTS[part++ % PARTS.length]; return `(() => { const card = [...document.querySelectorAll('.rv-item')].find(n => n.textContent.includes(${JSON.stringify(o)})); (${JSON.stringify(p)} ? card.querySelector(${JSON.stringify(p)}) : card).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); })()`; };
  // Where the selected passage sits: its middle against the middle of the view (or the scroll stops at an end of the script).
  const where = () => app.eval(`(() => {
    const v = __stet.view, s = v.scroller, sel = __stet.editor.sel, a = v.caretRect(sel.a), b = v.caretRect(sel.f);
    const mid = (Math.min(a.y, b.y) + Math.max(a.y + a.h, b.y + b.h)) / 2;
    const max = s.scrollHeight - s.clientHeight;
    return { off: Math.round(mid - (s.scrollTop + s.clientHeight / 2)), top: s.scrollTop, max, atEnd: s.scrollTop <= 0 || s.scrollTop >= max - 1, row: v.row };
  })()`);
  const centred = (w, what) => assert.ok(Math.abs(w.off) <= w.row || w.atEnd, `${what}: passage centred (off by ${w.off} px, scroll ${w.top}/${w.max})`);
  const run = async (label) => {
    await longScript();
    await startReview(); await waitDone();
    await app.eval('document.getElementById("scroller").scrollTop = 0');
    await sleep(100);
    // Far down, then far up, then one already on screen: each time it ends in the middle.
    for (const o of ['made a decision', 'looking to him', 'made a decision', 'made a decision', 'enter in the kitchen', 'looking to him']) {
      await app.eval(press(o)); await sleep(900);
      centred(await where(), `${label} ${o}`);
    }
    // Clicked again and again, mid-glide: it always ends on the last one, centred.
    for (const o of ['made a decision', 'looking to him', 'made a decision', 'enter in the kitchen', 'looking to him']) { await app.eval(press(o)); await sleep(120); }
    await sleep(900);
    centred(await where(), `${label} after rapid clicks`);
    assert.match(await app.eval('__stet.editor.blocks[__stet.view.editor.caret.b].text'), /looking to him/);
  };
  await run('hidden window'); // no animation frames at all: it still gets there
  // A shown window: the glide itself, frame by frame.
  await app.close();
  app = await App.launch({ userData: path.join(tmp, 'ud'), env: { STET_ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: KEY }, hidden: false });
  await consent();
  await run('shown window');
  await app.eval('document.getElementById("scroller").scrollTop = 0');
  await sleep(100);
  const samples = await app.eval(`new Promise((done) => {
    const s = document.getElementById('scroller'), out = [];
    ${press('made a decision')};
    const t0 = performance.now();
    const tick = () => { out.push(s.scrollTop); performance.now() - t0 < 1200 ? requestAnimationFrame(tick) : done(out); };
    requestAnimationFrame(tick);
  })`);
  const end = samples.at(-1);
  assert.ok(samples.filter((y) => y > 5 && y < end - 5).length >= 5, 'a glide through in-between positions, not a jump');
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1] - 0.5, 'one way only');
  // The buttons on a card still do their own job, not just show the passage.
  const before = await app.eval('__stet.revision.findings.filter(f => !f.decision).length');
  await app.eval(`[...document.querySelectorAll('.rv-item')].find(n => n.textContent.includes('enter in the kitchen')).querySelector('[data-act="discard"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  await sleep(200);
  assert.equal(await app.eval('__stet.revision.findings.filter(f => !f.decision).length'), before - 1, 'DISCARD discards');
  // The marks: neutral, never yellow (colour belongs to your own highlights).
  const bg = await app.eval(`getComputedStyle(document.querySelector('.revr.cur')).backgroundColor`);
  const [r, g, b] = bg.match(/[\d.]+/g).map(Number);
  assert.ok(r === g && g === b, `the selected suggestion's shade is a grey (${bg})`);
  const edge = await app.eval(`(() => { const st = getComputedStyle(document.querySelector('.revr.cur')); return { shadow: st.boxShadow, border: st.borderBottomWidth }; })()`);
  assert.deepEqual(edge, { shadow: 'none', border: '0px' }, 'just the soft highlight: no outline, no underline');
});
