import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChunks, chunkPrompt, validateFindings, minimalEdit, revalidate, planApply, afterApply, FINDINGS_SCHEMA, REVIEWABLE } from '../src/core/revision.js';
import { Editor, pos } from '../src/core/editor.js';
import { makeBlock } from '../src/core/model.js';
import { generateScript } from './fixtures.js';

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

test('minimalEdit trims shared words but keeps whole words', () => {
  const t = 'She is looking to him since five minutes.';
  const m = minimalEdit(t, 7, 40, 'staring at him for five minutes');
  assert.equal(t.slice(m.s, m.e), 'looking to him since');
  assert.equal(m.rep, 'staring at him for');
});

test('accept applies only to unchanged text; undo/redo bring findings back', () => {
  const blocks = script();
  const ed = new Editor(blocks.slice());
  const [c] = buildChunks(ed.blocks);
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
    { element: 'e1', category: 'grammar', original: 'make a coffee', replacement: 'makes coffee', explanation: '', confidence: 'medium' },
  ], refs(ed.blocks));
  revalidate(findings, ed.blocks);
  const plan = planApply([findings[0]], ed.blocks);
  ed.replaceRanges(plan.matches, plan.replacements);
  afterApply(findings, plan, ed.blocks);
  assert.equal(ed.blocks[1].text, 'Mara enters the kitchen and make a coffee.');
  assert.equal(findings[0].status, 'accepted');
  // The second finding moved with the text and still applies cleanly.
  assert.equal(findings[1].original, 'make a');
  assert.equal(ed.blocks[1].text.slice(findings[1].s, findings[1].e), 'make a');
  const p2 = planApply([findings[1]], ed.blocks);
  ed.replaceRanges(p2.matches, p2.replacements);
  afterApply(findings, p2, ed.blocks);
  assert.equal(ed.blocks[1].text, 'Mara enters the kitchen and makes coffee.');
  ed.undo(); ed.undo();
  revalidate(findings, ed.blocks);
  assert.equal(ed.blocks[1].text, 'Mara enter in the kitchen and make a coffee.');
  assert.deepEqual(findings.map((f) => f.status), ['open', 'open'], 'undo re-opens accepted findings');
  ed.redo();
  revalidate(findings, ed.blocks);
  assert.equal(findings[0].status, 'accepted', 'redo marks it accepted again');
});

test('editing during a review never produces a wrong replacement', () => {
  const ed = new Editor(script());
  const snapshotRefs = refs(ed.blocks);
  const [c] = buildChunks(ed.blocks); // review starts on this snapshot…
  // …the writer keeps typing before the answer arrives:
  ed.setSel(pos(1, 0)); for (const ch of 'Tired, ') ed.insertText(ch);   // text moves: relocatable
  ed.setSel(pos(4, 0), pos(4, ed.blocks[4].text.length)); ed.backspace();
  for (const ch of 'She waits.') ed.insertText(ch);                        // passage gone
  const { findings } = validateFindings(c, [
    { element: 'e1', category: 'grammar', original: 'enter in', replacement: 'enters', explanation: '', confidence: 'high' },
    { element: 'e3', category: 'non_native', original: 'looking to him since five minutes', replacement: 'staring at him for five minutes', explanation: '', confidence: 'medium' },
  ], snapshotRefs);
  revalidate(findings, ed.blocks);
  assert.equal(findings[0].status, 'open');
  assert.equal(ed.blocks[1].text.slice(findings[0].s, findings[0].e), 'enter in', 'relocated to the moved text');
  assert.equal(findings[1].status, 'outdated');
  const plan = planApply(findings, ed.blocks);
  assert.equal(plan.applied.length, 1, 'outdated findings are never applied');
  ed.replaceRanges(plan.matches, plan.replacements);
  assert.equal(ed.blocks[1].text, 'Tired, Mara enters the kitchen and make a coffee.');
  assert.equal(ed.blocks[4].text, 'She waits.');
});

test('ambiguous relocation is refused; accept-all is one undo step', () => {
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
  revalidate(findings, ed.blocks);
  assert.deepEqual(findings.map((f) => f.status), ['open', 'open']);
  // A repeat of the passage elsewhere: nearby context still identifies the right one.
  ed.setSel(pos(0, 0)); for (const ch of 'Later he go out. ') ed.insertText(ch);
  revalidate(findings, ed.blocks);
  assert.equal(findings[0].status, 'open', 'unique context relocates');
  assert.equal(ed.blocks[0].text.slice(findings[0].s - 3, findings[0].e), 'He go');
  assert.equal(findings[1].status, 'open');
  assert.equal(ed.blocks[0].text.slice(findings[1].s - 9, findings[1].e + 5), 'Later he go out.');
  assert.ok(findings[1].s > 20, 'the original occurrence, not the new copy');
  // A repeat that also copies the surroundings is genuinely ambiguous: not guessed.
  ed.setSel(pos(0, 0)); for (const ch of 'home. Later he go out. ') ed.insertText(ch);
  revalidate(findings, ed.blocks);
  assert.equal(findings[1].status, 'outdated', 'ambiguous match is not guessed');
});

test('structured-output schema is strict', () => {
  const item = FINDINGS_SCHEMA.properties.findings.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required.sort(), ['category', 'confidence', 'element', 'explanation', 'original', 'replacement']);
});

test('ignored passages (per script) and dictionary words (global) suppress findings', async () => {
  const { applyUserLists, ignoreEntry, listsPrompt } = await import('../src/core/revision.js');
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
  const { serialize, deserialize } = await import('../src/core/serialize.js');
  const { newDocument } = await import('../src/core/model.js');
  const d = newDocument();
  assert.ok(!('revision' in JSON.parse(serialize(d))), 'absent when empty: older files unchanged');
  d.revision.ignored.push({ text: 'the cocina', category: 'non_native' });
  const back = deserialize(serialize(d)).doc;
  assert.deepEqual(back.revision.ignored, [{ text: 'the cocina', category: 'non_native' }]);
  assert.equal(serialize(back), serialize(d));
});
