// The Revise guidelines (core/guidelines.js): soft, learned from the suggestions the writer sets
// aside, separate from the spelling dictionary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editOf, flagOf, noteFlag, assess, applyGuidelines, addFlag, guidelinesOf, guidelinesPrompt, removeGuideline, cleanFlags, FIRM } from '../../src/core/guidelines.js';

const sug = (shownOriginal, shownReplacement, category = 'grammar') => ({ shownOriginal, shownReplacement, original: shownOriginal, replacement: shownReplacement, category });

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
