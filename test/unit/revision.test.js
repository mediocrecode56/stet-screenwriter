import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChunks, chunkPrompt, validateFindings, findWhole, minimalEdit, locate, locateAll, planApply, afterApply, isApplied, sortByText, FINDINGS_SCHEMA, REVIEWABLE, SYSTEM_PROMPT } from '../../src/core/revision.js';
import { Editor, pos } from '../../src/core/editor.js';
import { makeBlock } from '../../src/core/model.js';
import { generateScript } from '../fixtures.js';

const refs = (blocks) => new Map(blocks.map((b) => [b.id, b]));

function script() {
  return [
    makeBlock('scene', 'INT. KITCHEN - NIGHT'),
    makeBlock('action', 'Mara enter in the kitchen and make a coffee.'),
    makeBlock('character', 'TEO'),
    makeBlock('dialogue', "Ain't nobody awake at this hour, I think."),
    makeBlock('action', 'She is looking to him since five minutes.'),
  ];
}

test('chunks cover every reviewable element exactly once, scene-aligned, with context', () => {
  const blocks = generateScript(60);
  const chunks = buildChunks(blocks, { target: 3000 });
  assert.ok(chunks.length > 5);
  const seen = new Set();
  for (const c of chunks) for (const x of c.ids) { assert.ok(!seen.has(x.blockId)); seen.add(x.blockId); }
  const expected = blocks.filter((b) => REVIEWABLE.has(b.type) && b.text.trim()).length;
  assert.equal(seen.size, expected);
  const p = chunkPrompt(chunks[2]);
  assert.match(p, /<context>[\s\S]+<\/context>/);
  assert.match(p, /<review>\n[\s\S]*\ne1 \[/);
  assert.match(p, /\[CHARACTER\]/, 'cues appear as context');
  assert.ok(!/ e\d+ \[CHARACTER\]/.test(p), 'cues are not reviewable');
  assert.equal(chunks[0].total, chunks.length);
});

test('dialogue lines carry their speaker', () => {
  const [c] = buildChunks(script());
  assert.match(chunkPrompt(c), /e2 \[DIALOGUE — TEO\] "Ain't nobody/);
});

test('validation keeps only findings that match the snapshot', () => {
  const blocks = script();
  const [c] = buildChunks(blocks);
  const raw = [
    { element: 'e1', category: 'grammar', original: 'Mara enter in the kitchen', replacement: 'Mara enters the kitchen', explanation: 'Agreement; "enter" takes a direct object.', confidence: 'high' },
    { element: 'e9', category: 'grammar', original: 'x', replacement: 'y', explanation: '', confidence: 'high' }, // unknown element
    { element: 'e1', category: 'grammar', original: 'not in the text', replacement: 'z', explanation: '', confidence: 'high' }, // hallucinated
    { element: 'e1', category: 'style', original: 'make', replacement: 'makes', explanation: '', confidence: 'high' }, // bad category
    { element: 'e3', category: 'non_native', original: 'looking to him since five minutes', replacement: 'staring at him for five minutes', explanation: 'Calque.', confidence: 'medium' },
    { element: 'e3', category: 'grammar', original: 'since five', replacement: 'for five', explanation: 'overlaps', confidence: 'low' }, // overlaps the one above
  ];
  const { findings, rejected } = validateFindings(c, raw, refs(blocks));
  assert.equal(rejected, 3);
  assert.equal(findings.length, 2, 'overlapping lower-confidence finding dropped');
  const f = findings.find((x) => x.category === 'grammar');
  assert.equal(f.original, 'enter in');           // minimal span…
  assert.equal(f.replacement, 'enters');          // …and minimal replacement
  assert.equal(blocks[1].text.slice(f.s, f.e), 'enter in');
});

test('a finding must quote whole words of its element, never the inside of a longer word', () => {
  assert.equal(findWhole('A creature appears.', 'creatur'), -1);
  assert.equal(findWhole('A creature appears.', 'creature'), 2);
  assert.equal(findWhole('the theme, then the', 'the'), 0);
  assert.equal(findWhole('theme of the day', 'the'), 9, 'skips a match inside "theme"');
  assert.equal(findWhole('He said, "go".', ', "go"'), 7, 'punctuation at the edges needs no word boundary');
  const blocks = script();
  const [c] = buildChunks(blocks);
  const { findings, rejected } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'nter in', replacement: 'nters', explanation: '', confidence: 'high' },
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enter in', explanation: '', confidence: 'high' }, // unchanged
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' }, // the same again
  ], refs(blocks));
  assert.equal(rejected, 2);
  assert.equal(findings.length, 1, 'a repeat of the same finding is kept once');
  assert.equal(findings[0].original, 'enter in');
});

test('minimalEdit trims shared words but keeps whole words', () => {
  const t = 'She is looking to him since five minutes.';
  const m = minimalEdit(t, 7, 40, 'staring at him for five minutes');
  assert.equal(t.slice(m.s, m.e), 'looking to him since');
  assert.equal(m.rep, 'staring at him for');
});

test('accepting records the decision; undo/redo never change decisions', () => {
  const blocks = script();
  const ed = new Editor(blocks.slice());
  const [c] = buildChunks(ed.blocks);
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
    { element: 'e1', category: 'grammar', original: 'make a coffee', replacement: 'makes coffee', explanation: '', confidence: 'medium' },
  ], refs(ed.blocks));
  const snapshot = JSON.stringify(findings.map(({ ref, ...f }) => f));
  const plan = planApply([findings[0]], ed.blocks);
  ed.replaceRanges(plan.matches, plan.replacements);
  afterApply(findings, plan, ed.blocks);
  assert.equal(ed.blocks[1].text, 'Mara enters the kitchen and make a coffee.');
  assert.equal(findings[0].decision, 'accepted');
  assert.equal(findings[0].appliedText, 'enters');
  // The second suggestion moved exactly with the text and still applies cleanly.
  const at = locate(findings[1], ed.blocks);
  assert.equal(ed.blocks[1].text.slice(at.s, at.e), 'make a');
  const p2 = planApply([findings[1]], ed.blocks);
  ed.replaceRanges(p2.matches, p2.replacements);
  afterApply(findings, p2, ed.blocks);
  assert.equal(ed.blocks[1].text, 'Mara enters the kitchen and makes coffee.');
  ed.undo(); ed.undo();
  assert.equal(ed.blocks[1].text, 'Mara enter in the kitchen and make a coffee.');
  locateAll(findings, ed.blocks);
  assert.deepEqual(findings.map((f) => f.decision), ['accepted', 'accepted'], 'undo changes text, not decisions');
  assert.equal(locate(findings[0], ed.blocks), null, 'the applied change is gone, so nothing is highlighted');
  const kept = JSON.parse(snapshot);
  findings.forEach((f, i) => {
    for (const k of ['original', 'replacement', 'shownOriginal', 'shownReplacement', 'explanation', 'category', 'confidence']) assert.equal(f[k], kept[i][k], k + ' unchanged');
  });
});

test('reopening an accepted suggestion keeps its place, so accepting it again only records the decision', () => {
  const ed = new Editor(script());
  const [c] = buildChunks(ed.blocks);
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
  ], refs(ed.blocks));
  const [f] = findings;
  const plan = planApply([f], ed.blocks);
  ed.replaceRanges(plan.matches, plan.replacements);
  afterApply(findings, plan, ed.blocks);
  f.decision = null; // reopened: the change stays in the script
  const at = locate(f, ed.blocks);
  assert.equal(ed.blocks[at.b].text.slice(at.s, at.e), 'enters', 'found at the change it made');
  assert.ok(isApplied(f, at, ed.blocks), 'accepting again needs no edit');
  assert.equal(planApply([f], ed.blocks).applied.length, 0, 'and never edits the text twice');
  // After undoing the text, it is the original passage again, and applies as usual.
  ed.undo();
  const back = locate(f, ed.blocks);
  assert.equal(ed.blocks[back.b].text.slice(back.s, back.e), 'enter in');
  assert.ok(!isApplied(f, back, ed.blocks));
  assert.equal(planApply([f], ed.blocks).applied.length, 1);
});

test('a reopened suggestion keeps its place when another one in the same element is accepted', () => {
  const ed = new Editor(script());
  const [c] = buildChunks(ed.blocks);
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
    { element: 'e1', category: 'grammar', original: 'make a coffee', replacement: 'makes coffee', explanation: '', confidence: 'medium' },
  ], refs(ed.blocks));
  const [a, b] = findings;
  const p1 = planApply([b], ed.blocks);
  ed.replaceRanges(p1.matches, p1.replacements);
  afterApply(findings, p1, ed.blocks);
  b.decision = null; // reopened, its change still in the script
  const p2 = planApply([a], ed.blocks); // an edit before it, in the same element
  ed.replaceRanges(p2.matches, p2.replacements);
  afterApply(findings, p2, ed.blocks);
  assert.equal(ed.blocks[1].text, 'Mara enters the kitchen and makes coffee.');
  assert.equal(b.ref, ed.blocks[1], 'moved exactly past the edit, not left for the context search');
  assert.equal(ed.blocks[1].text.slice(b.s, b.e), 'makes');
  const at = locate(b, ed.blocks);
  assert.ok(at, 'still located');
  assert.equal(ed.blocks[1].text.slice(at.s, at.e), 'makes');
  assert.ok(isApplied(b, at, ed.blocks));
});

test('suggestions are sorted as their passages appear in the script', () => {
  const ed = new Editor(script());
  const [c] = buildChunks(ed.blocks);
  const { findings } = validateFindings(c, [
    { element: 'e3', category: 'non_native', original: 'looking to him since five minutes', replacement: 'staring at him for five minutes', explanation: '', confidence: 'medium' },
    { element: 'e1', category: 'grammar', original: 'make a coffee', replacement: 'makes coffee', explanation: '', confidence: 'medium' },
    { element: 'e1', category: 'awkward', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
  ], refs(ed.blocks));
  const order = () => sortByText(findings, ed.blocks).map((f) => f.original.split(' ')[0]);
  assert.deepEqual(order(), ['enter', 'make', 'looking'], 'by element, then by position, whatever the kind');
  // Moving the last action to the top moves its suggestion first.
  const last = ed.blocks[4];
  ed.blocks.splice(4, 1); ed.blocks.unshift(last);
  locateAll(findings, ed.blocks);
  assert.deepEqual(order(), ['looking', 'enter', 'make']);
});

test('suggestions survive edits during a review; lost passages are never guessed', () => {
  const ed = new Editor(script());
  const snapshotRefs = refs(ed.blocks);
  const [c] = buildChunks(ed.blocks); // review starts on this snapshot...
  // ...the writer keeps typing before the answer arrives:
  ed.setSel(pos(1, 0)); for (const ch of 'Tired, ') ed.insertText(ch);   // text moves: followed exactly
  ed.setSel(pos(4, 0), pos(4, ed.blocks[4].text.length)); ed.backspace();
  for (const ch of 'She waits.') ed.insertText(ch);                        // passage gone
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
    { element: 'e3', category: 'non_native', original: 'looking to him since five minutes', replacement: 'staring at him for five minutes', explanation: '', confidence: 'medium' },
  ], snapshotRefs);
  const locs = locateAll(findings, ed.blocks);
  const a = locs.get(findings[0].id);
  assert.equal(ed.blocks[a.b].text.slice(a.s, a.e), 'enter in', 'followed to the moved text');
  assert.equal(locs.get(findings[1].id), null, 'cannot be located');
  assert.equal(findings[1].decision, null, 'but still there, undecided');
  const plan = planApply(findings, ed.blocks);
  assert.equal(plan.applied.length, 1, 'a lost suggestion is never applied');
  ed.replaceRanges(plan.matches, plan.replacements);
  assert.equal(ed.blocks[1].text, 'Tired, Mara enters the kitchen and make a coffee.');
  assert.equal(ed.blocks[4].text, 'She waits.');
});

test('ambiguous passages are not guessed; accept-all is one undo step', () => {
  const ed = new Editor([makeBlock('action', 'He go home. Later he go out.')]);
  const [c] = buildChunks(ed.blocks);
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'He go home', replacement: 'He goes home', explanation: '', confidence: 'high' },
    { element: 'e1', category: 'grammar', original: 'he go out', replacement: 'he goes out', explanation: '', confidence: 'high' },
  ], refs(ed.blocks));
  const plan = planApply(findings, ed.blocks);
  ed.replaceRanges(plan.matches, plan.replacements);
  afterApply(findings, plan, ed.blocks);
  assert.equal(ed.blocks[0].text, 'He goes home. Later he goes out.');
  ed.undo();
  assert.equal(ed.blocks[0].text, 'He go home. Later he go out.', 'both changes undone together');
  findings.forEach((f) => { f.decision = null; f.appliedText = null; }); // the writer re-opens both
  // A repeat of the passage elsewhere: the exact edit diff still identifies the right one.
  ed.setSel(pos(0, 0)); for (const ch of 'Later he go out. ') ed.insertText(ch);
  const l1 = locate(findings[1], ed.blocks);
  assert.ok(l1 && l1.s > 20, 'the original occurrence, not the new copy');
  assert.equal(l1.s, ed.blocks[0].text.lastIndexOf('go out'), 'the "go" in the original sentence');
  // Reopened from disk (no edit history) with the surroundings copied too: genuinely ambiguous.
  const fresh = findings.map((f) => ({ ...f, ref: null, s: 0, e: 0 }));
  ed.setSel(pos(0, 0)); for (const ch of 'home. Later he go out. ') ed.insertText(ch);
  assert.equal(locate(fresh[1], ed.blocks), null, 'ambiguous match is not guessed');
});

test('a review and its decisions round-trip through the .stet payload', async () => {
  const { serialize, deserialize } = await import('../../src/core/serialize.js');
  const { newDocument } = await import('../../src/core/model.js');
  const d = newDocument();
  d.blocks = script();
  const [c] = buildChunks(d.blocks);
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: 'Agreement.', confidence: 'high' },
    { element: 'e3', category: 'non_native', original: 'looking to him since five minutes', replacement: 'staring at him for five minutes', explanation: 'Calque.', confidence: 'medium' },
  ], refs(d.blocks));
  findings[1].decision = 'discarded';
  d.revision.review = { id: 'r1', at: '2026-10-19T10:00:00.000Z', model: 'claude-opus-5-5', state: 'complete', findings };
  const json = serialize(d);
  const back = deserialize(json).doc;
  const r = back.revision.review;
  assert.equal(r.findings.length, 2);
  assert.deepEqual(r.findings.map((f) => [f.category, f.decision, f.shownOriginal, f.explanation]), [['grammar', null, 'enter in', 'Agreement.'], ['non_native', 'discarded', 'looking to him since five minutes', 'Calque.']]);
  const at = locate(r.findings[0], back.blocks);
  assert.equal(back.blocks[at.b].text.slice(at.s, at.e), 'enter in', 'located again in the reloaded blocks');
  assert.equal(serialize(back), json, 'deterministic');
  // Malformed entries are dropped, not trusted.
  const p = JSON.parse(json);
  p.revision.review.findings.push({ id: 'x', category: 'nonsense' }, { nope: 1 });
  assert.equal(deserialize(JSON.stringify(p)).doc.revision.review.findings.length, 2);
});

test('the review checks the English, not how clear or complete the story is', () => {
  assert.match(SYSTEM_PROMPT, /checking the English, not editing the story/);
  assert.match(SYSTEM_PROMPT, /Do not flag a passage because it could be clearer, simpler, shorter or easier to follow, because it lacks context/);
  assert.ok(!/unclear or needlessly complicated/.test(SYSTEM_PROMPT), 'awkward no longer covers "unclear"');
  for (const k of ['grammar:', 'non_native:', 'awkward:', 'Protect the writer\'s voice']) assert.ok(SYSTEM_PROMPT.includes(k), k + ' kept');
});

test('structured-output schema is strict', () => {
  const item = FINDINGS_SCHEMA.properties.findings.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required.sort(), ['category', 'confidence', 'element', 'explanation', 'original', 'replacement']);
});

test('ignored passages (per script) and dictionary words (global) suppress findings', async () => {
  const { applyUserLists, ignoreEntry, listsPrompt } = await import('../../src/core/revision.js');
  const blocks = [makeBlock('action', 'Mara enter the cocina. ITNRO plays.')];
  const [c] = buildChunks(blocks);
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'Mara enter', replacement: 'Mara enters', explanation: '', confidence: 'high' },
    { element: 'e1', category: 'non_native', original: 'the cocina', replacement: 'the kitchen', explanation: '', confidence: 'medium' },
    { element: 'e1', category: 'awkward', original: 'ITNRO', replacement: 'INTRO', explanation: '', confidence: 'low' },
  ], refs(blocks));
  const lists = { ignored: [ignoreEntry(findings[1])], dictionary: ['itnro'] };
  const r = applyUserLists(findings, lists);
  assert.deepEqual(r.findings.map((f) => f.category), ['grammar']);
  assert.equal(r.suppressed, 2);
  const p = listsPrompt(lists);
  assert.match(p, /dictionary[\s\S]*"itnro"/);
  assert.match(p, /already reviewed[\s\S]*"the cocina"/);
});

test('ignore list round-trips through the .stet payload', async () => {
  const { serialize, deserialize } = await import('../../src/core/serialize.js');
  const { newDocument } = await import('../../src/core/model.js');
  const d = newDocument();
  assert.ok(!('revision' in JSON.parse(serialize(d))), 'absent when empty: older files unchanged');
  d.revision.ignored.push({ text: 'the cocina', category: 'non_native' });
  const back = deserialize(serialize(d)).doc;
  assert.deepEqual(back.revision.ignored, [{ text: 'the cocina', category: 'non_native' }]);
  assert.equal(serialize(back), serialize(d));
});
