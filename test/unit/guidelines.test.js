// The Revise guidelines (core/guidelines.js): soft, learned from the suggestions the writer sets
// aside, separate from the spelling dictionary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editOf, flagOf, noteFlag, assess, applyGuidelines, addFlag, guidelinesOf, guidelinesPrompt, removeGuideline, cleanFlags, patternsOf, words, FIRM, promptEntries, flagsKey, localDirection, directionRequest, cleanDirection, NO_GUIDELINES } from '../../src/core/guidelines.js';

const sug = (shownOriginal, shownReplacement, category = 'grammar', more = {}) => ({ shownOriginal, shownReplacement, original: shownOriginal, replacement: shownReplacement, category, ...more });

test('the edit a suggestion makes, as words out and in', () => {
  assert.equal(editOf('I am gonna go', 'I am going to go'), 'gonna→going to');
  assert.equal(editOf('He go home', 'He goes home'), 'go→goes');
  assert.equal(editOf('Rain.', 'Rain.'), '');
});

test('set aside once: a soft hint, still shown and marked; twice: understood and held back', () => {
  const f = sug('ain\'t nobody', 'nobody is');
  let flags = addFlag([], flagOf(f, { note: 'his voice' }));
  let a = assess(sug('ain\'t nobody', 'nobody is'), flags);
  assert.equal(a.level, 'soft');
  assert.deepEqual(a.notes, ['his voice']);
  const once = applyGuidelines([sug('ain\'t nobody', 'nobody is')], flags);
  assert.equal(once.held, 0);
  assert.ok(once.findings[0].guide, 'kept, and marked as close to a guideline');
  flags = addFlag(flags, flagOf(f));
  a = assess(sug('Ain\'t  nobody', 'nobody is'), flags);
  assert.equal(a.level, 'firm', 'the same passage set aside twice');
  assert.equal(applyGuidelines([sug('ain\'t nobody', 'nobody is')], flags).held, 1);
});

test('the same change in different passages is learned more slowly; another kind never counts it', () => {
  const ex = ['I gonna run', 'we gonna eat', 'they gonna leave', 'you gonna see'];
  let flags = [];
  for (let i = 0; i < 3; i++) flags = addFlag(flags, flagOf(sug(ex[i], ex[i].replace('gonna', 'going to'))));
  assert.equal(assess(sug('she gonna cry', 'she going to cry'), flags).level, 'soft', 'three times: still shown');
  flags = addFlag(flags, flagOf(sug(ex[3], ex[3].replace('gonna', 'going to'))));
  assert.ok(assess(sug('she gonna cry', 'she going to cry'), flags).score >= FIRM, 'four times: understood');
  assert.equal(assess(sug('she gonna cry', 'she going to cry', 'awkward'), flags).level, 'none', 'another kind of problem');
});

test('accepting one that looked like a guideline weakens it', () => {
  const f = sug('the people says', 'the people say');
  let flags = addFlag(addFlag([], flagOf(f)), flagOf(f));
  assert.equal(assess(f, flags).level, 'firm');
  flags = addFlag(flags, flagOf(f, { against: true }));
  assert.equal(assess(f, flags).level, 'soft');
});

test('notes alone go to Claude and never hide anything; groups, the prompt, removing one', () => {
  const f = sug('Que pasa, mijo', 'What is happening, son', 'non_native');
  let flags = addFlag(addFlag([], noteFlag('Rosa mixes in Spanish on purpose')), flagOf(f));
  flags = addFlag(flags, flagOf(f));
  assert.equal(assess(sug('Hola', 'Hello', 'non_native'), flags).level, 'none');
  const list = guidelinesOf(flags);
  assert.deepEqual(list.map((g) => g.level), ['firm', 'note']);
  const p = guidelinesPrompt(flags);
  assert.match(p, /\[firm\] non_native: "Que pasa, mijo"/);
  assert.match(p, /Rosa mixes in Spanish on purpose/);
  assert.equal(guidelinesPrompt([]), '');
  const left = removeGuideline(flags, list[0]);
  assert.equal(left.length, 1);
  assert.equal(guidelinesOf(left)[0].level, 'note');
});

test('stored flags are cleaned: anything malformed dropped', () => {
  assert.deepEqual(cleanFlags(null), []);
  const out = cleanFlags([{ text: 'x', category: 'grammar', at: 1 }, { nope: true }, 5, { text: '', note: 'n' }]);
  assert.equal(out.length, 2);
});

test('the same passage however it is punctuated, quoted or written; words in any script', () => {
  const flags = addFlag(addFlag([], flagOf(sug('Ain’t nobody.', 'Nobody is.'))), flagOf(sug("ain't nobody", 'nobody is')));
  assert.equal(assess(sug('"Ain\'t nobody"', 'nobody is'), flags).level, 'firm', 'curly or straight, with or without the full stop');
  assert.deepEqual(words('我昨天去了学校'), ['我', '昨', '天', '去', '了', '学', '校'], 'a script without spaces: one word a character');
  assert.equal(editOf('我去了学校了', '我去了学校'), '了→');
});

test('words the writer keeps whatever the fix become a pattern; a single passage never does', () => {
  let flags = [];
  for (const [o, r] of [['I gonna run', 'I am going to run'], ['we gonna eat', 'we will eat'], ['they gonna leave', 'they are going to leave']]) flags = addFlag(flags, flagOf(sug(o, r)));
  const [p] = patternsOf(flags);
  assert.deepEqual([p.kind, p.what, p.count], ['kept', 'gonna', 3]);
  assert.match(guidelinesPrompt(flags), /\[pattern\] grammar: the writer keeps "gonna" whatever the fix/);
  assert.equal(assess(sug('you gonna see', 'you shall see'), flags).level, 'soft', 'a new fix for the same words: close to a guideline');
  assert.deepEqual(patternsOf(addFlag(addFlag([], flagOf(sug('x gonna', 'x going to'))), flagOf(sug('x gonna', 'x going to')))), []);
});

test('a character’s voice: learned from their lines, never enough alone to hide one, weakened by accepting', () => {
  const rosa = (o, r) => sug(o, r, 'non_native', { type: 'dialogue', speaker: 'ROSA' });
  let flags = [];
  for (const [o, r] of [['Is not possible', 'It is not possible'], ['I have hungry', 'I am hungry'], ['Make the bed you', 'Make your bed'], ['We go tomorrow the market', 'We go to the market tomorrow']]) flags = addFlag(flags, flagOf(rosa(o, r)));
  const fresh = rosa('She have reason', 'She is right');
  assert.equal(assess(fresh, flags).level, 'soft', 'shown, marked: her voice');
  assert.equal(assess({ ...fresh, speaker: 'TEO' }, flags).level, 'none', 'another character');
  assert.equal(assess({ ...fresh, category: 'grammar' }, flags).level, 'none', 'another kind of problem');
  for (let i = 0; i < 6; i++) flags = addFlag(flags, flagOf(rosa('line ' + i, 'fixed ' + i)));
  assert.ok(assess(fresh, flags).score < FIRM, 'a voice alone never hides a suggestion');
  assert.match(guidelinesPrompt(flags), /non_native in ROSA's lines: set aside 10 times/);
  const before = assess(fresh, flags).score;
  flags = addFlag(flags, flagOf(rosa('Is not fair', 'It is not fair'), { against: true }));
  assert.ok(assess(fresh, flags).score < before, 'accepted in her lines: the voice counts for less');
});

test('how sure the evidence must be follows how sure Claude is', () => {
  const f = sug('the people says', 'the people say');
  const flags = addFlag(addFlag([], flagOf(f)), flagOf(f));
  assert.equal(assess({ ...f, confidence: 'low' }, flags).level, 'firm');
  assert.equal(assess({ ...f, confidence: 'medium' }, flags).level, 'firm');
  assert.equal(assess({ ...f, confidence: 'high' }, flags).level, 'soft', 'a clear error needs more than two set-asides');
  assert.equal(assess({ ...f, confidence: 'low' }, addFlag([], flagOf(f))).level, 'soft');
});

test('what has been learned is kept: no endless copies, and a full list lets go of surplus first', () => {
  const f = sug('ITNRO', 'INTRO', 'awkward');
  let flags = [];
  for (let i = 0; i < 6; i++) flags = addFlag(flags, flagOf(f, { at: i }));
  assert.equal(flags.length, 3, 'understood after three: more of the same adds nothing');
  assert.equal(addFlag(flags, flagOf(f, { note: 'a band name' })).length, 4, 'but a new note is kept');
  // A full list: hundreds of one-off flags arrive after a guideline understood long ago.
  for (let i = 0; i < 420; i++) flags = addFlag(flags, flagOf(sug('p' + i, 'q' + i), { at: 100 + i }));
  assert.equal(flags.length, 400);
  assert.equal(assess(f, flags).level, 'firm', 'the old guideline survives');
});

test('guidelines saved by earlier versions read the same', () => {
  const old = [
    { text: 'ain’t nobody', category: 'grammar', replacement: 'nobody is', edit: 'ain’t nobody→nobody is', note: 'his voice', at: 1 },
    { text: 'ain’t nobody', category: 'grammar', replacement: 'nobody is', edit: 'ain’t nobody→nobody is', note: '', at: 2 },
    { text: '', category: null, replacement: '', edit: '', note: 'Rosa mixes in Spanish', at: 3 },
  ];
  const flags = cleanFlags(old);
  assert.equal(flags.length, 3);
  assert.equal(assess(sug("Ain't nobody", 'Nobody is'), flags).level, 'firm');
  assert.deepEqual(guidelinesOf(flags).map((g) => g.level), ['firm', 'note']);
});

// ---- the guidelines never make the review stop finding mistakes ------------------------------

test('nothing held back is thrown away: it stays with the review, marked held with what covers it', () => {
  const f = sug('ain’t nobody', 'nobody is');
  const flags = addFlag(addFlag([], flagOf(f)), flagOf(f));
  const all = [sug('ain’t nobody', 'nobody is', 'grammar', { decision: null }), sug('He go home', 'He goes home', 'grammar', { decision: null })];
  const r = applyGuidelines(all, flags);
  assert.equal(r.findings.length, 2, 'both still there');
  assert.deepEqual(r.findings.map((x) => x.decision), ['held', null]);
  assert.equal(r.findings[0].heldBy, 'ain’t nobody');
  assert.ok(r.findings[0].guide, 'accepting it later counts against the guideline');
});

test('a clear error is held back only by its very passage; a habit, a voice or a pattern only marks it', () => {
  let flags = [];
  for (const o of ['I gonna run', 'we gonna eat', 'they gonna leave', 'you gonna see', 'he gonna stay', 'it gonna rain']) flags = addFlag(flags, flagOf(sug(o, o.replace('gonna', 'going to'))));
  const fresh = (confidence) => sug('she gonna cry', 'she going to cry', 'grammar', { confidence });
  assert.equal(assess(fresh('medium'), flags).level, 'firm', 'a habit seen six times holds back what Claude is unsure of');
  assert.equal(assess(fresh('high'), flags).level, 'soft', 'never what Claude calls a clear error');
  const same = sug('the people says', 'the people say', 'grammar', { confidence: 'high' });
  let own = [];
  for (let i = 0; i < 3; i++) own = addFlag(own, flagOf(same));
  assert.equal(assess(same, own).level, 'firm', 'the same passage set aside three times');
});

test('an edit that only adds words is no habit: adding "the" somewhere says nothing about anywhere else', () => {
  let flags = [];
  for (const [o, r] of [['went to store', 'went to the store'], ['opens door', 'opens the door'], ['on table', 'on the table'], ['at window', 'at the window'], ['in kitchen', 'in the kitchen'], ['by car', 'by the car']]) flags = addFlag(flags, flagOf(sug(o, r)));
  assert.equal(editOf('went to store', 'went to the store'), '→the');
  assert.equal(assess(sug('reads letter', 'reads the letter', 'grammar', { confidence: 'low' }), flags).level, 'none', 'a missing article elsewhere is still flagged');
  assert.equal(guidelinesOf(flags).length, 6, 'six passages, not one rule about articles');
  assert.equal(assess(sug('on table', 'on the table'), flags).level, 'soft', 'each still counts for its own passage');
});

test('a voice alone never hides a suggestion, however often it was set aside and however unsure Claude is', () => {
  const rosa = (o, r, more) => sug(o, r, 'non_native', { type: 'dialogue', speaker: 'ROSA', ...more });
  let flags = [];
  for (let i = 0; i < 12; i++) flags = addFlag(flags, flagOf(rosa('line ' + i, 'fixed ' + i)));
  const a = assess(rosa('She have reason', 'She is right', { confidence: 'low' }), flags);
  assert.equal(a.level, 'soft');
  assert.equal(applyGuidelines([rosa('She have reason', 'She is right', { confidence: 'low' })], flags).held, 0);
});

test('Claude reports everything and only names the guideline: what it names is held or marked here', () => {
  let flags = addFlag([], noteFlag('Rosa mixes in Spanish on purpose'));
  const f = sug('ain’t nobody', 'nobody is');
  flags = addFlag(flags, flagOf(f)); // a hint: set aside once
  const entries = promptEntries(flags);
  assert.deepEqual(entries.map((e) => [e.id, e.level]), [['G1', 'hint'], ['G2', 'note']]);
  const p = guidelinesPrompt(flags);
  assert.match(p, /never make you leave a problem out/);
  assert.match(p, /G1 \[hint\] grammar: "ain’t nobody"/);
  const tagged = (g, confidence) => sug('Que pasa, mijo', 'What is happening, son', 'non_native', { tagged: g, confidence, decision: null });
  let r = applyGuidelines([tagged('G2', 'medium'), tagged('G2', 'high'), tagged('G1', 'low'), tagged('G9', 'low')], flags);
  assert.deepEqual(r.findings.map((x) => x.decision), ['held', null, null, null], 'a note holds what Claude is unsure of; a clear error, a hint and a made-up number never');
  assert.equal(r.findings[0].heldBy, 'Rosa mixes in Spanish on purpose');
  assert.deepEqual([!!r.findings[1].guide, !!r.findings[2].guide, !!r.findings[3].guide], [true, true, false], 'the others marked GUIDELINE?');
  assert.ok(r.findings.every((x) => !('tagged' in x)), 'the tag is used up');
  r = applyGuidelines([tagged('G2', 'medium'), sug('ain’t nobody', 'nobody is', 'grammar', { decision: null })], addFlag(flags, flagOf(f)), { strict: true });
  assert.deepEqual([r.held, r.findings.map((x) => x.decision), r.findings.some((x) => x.guide)], [0, [null, null], false], 'a strict review ignores them all');
});

test('the direction: one sentence asked of Claude, a plain one meanwhile, its key changing with the guidelines', () => {
  assert.equal(directionRequest([]), null, 'nothing to ask with no guidelines');
  assert.equal(localDirection([]), NO_GUIDELINES);
  const f = sug('ain’t nobody', 'nobody is');
  let flags = addFlag([], flagOf(f));
  const k1 = flagsKey(flags);
  assert.match(localDirection(flags), /^Revise marks 1 thing you set aside once\. Clear errors are always shown\.$/);
  flags = addFlag(addFlag(flags, flagOf(f)), noteFlag('Rosa mixes in Spanish'));
  assert.notEqual(flagsKey(flags), k1);
  assert.equal(flagsKey(cleanFlags(JSON.parse(JSON.stringify(flags)))), flagsKey(flags), 'the same after a save');
  assert.match(localDirection(flags), /holds back 1 thing you set aside more than once and reads 1 note you wrote/);
  const req = directionRequest(flags);
  assert.match(req.system, /one sentence of at most 28 words/);
  assert.match(req.prompt, /\[firm\] grammar: "ain’t nobody"\n\[note\] "Rosa mixes in Spanish"/);
  assert.equal(cleanDirection('  "Revise now leaves Teo’s dialect\nalone."  '), 'Revise now leaves Teo’s dialect alone.');
  assert.equal(cleanDirection('ok'), '');
});
