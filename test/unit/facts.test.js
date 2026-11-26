// Revise checks the script's factual claims: the review lists them, a small checker searches the
// web for each, and only one found wrong or out of date becomes a suggestion (core/revision.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINDINGS_SCHEMA, REVIEW_CATEGORIES, CATEGORIES, CATEGORY_LABEL, SYSTEM_PROMPT, FACT_SYSTEM, FACT_MODEL, factPrompt, parseVerdict, factFinding, claimsOf, buildChunks, validateFindings } from '../../src/core/revision.js';
import { makeBlock } from '../../src/core/model.js';

test('the review lists claims apart; it can never report a fact itself, only a checked claim can', () => {
  assert.deepEqual(FINDINGS_SCHEMA.required, ['findings', 'claims']);
  assert.ok(!FINDINGS_SCHEMA.properties.findings.items.properties.category.enum.includes('fact'));
  assert.deepEqual(REVIEW_CATEGORIES, ['grammar', 'non_native', 'awkward']);
  assert.ok(CATEGORIES.includes('fact') && CATEGORY_LABEL.fact === 'Factual Error');
  assert.match(SYSTEM_PROMPT, /Factual claims[\s\S]*invented facts[\s\S]*are not claims/);
  assert.match(FACT_SYSTEM, /Search the web[\s\S]*"verdict"/);
  assert.equal(FACT_MODEL, 'claude-haiku-5-5', 'a low-cost checker');
});

test('a verdict is read from the checker’s answer, even with words around it; anything else is no verdict', () => {
  assert.deepEqual(parseVerdict('I searched.\n{"verdict": "wrong", "replacement": "1889", "explanation": "x", "source": ""}'), { verdict: 'wrong', replacement: '1889', explanation: 'x', source: '' });
  assert.equal(parseVerdict('{"verdict": "maybe"}'), null);
  assert.equal(parseVerdict('no json here'), null);
  assert.equal(parseVerdict(''), null);
  assert.equal(parseVerdict('{"a": {"verdict": "correct"}}').verdict, 'correct', 'the innermost object that is a verdict');
});

test('only a claim found wrong or out of date, with a real change, becomes a suggestion; its source goes with it', () => {
  const c = { element: 'e1', original: 'finished in 1902', claim: 'The tower was finished in 1902.' };
  const f = factFinding(c, { verdict: 'wrong', replacement: 'finished in 1889', explanation: 'It opened in 1889.', source: 'https://example.org/tower' });
  assert.deepEqual(f, { element: 'e1', category: 'fact', original: 'finished in 1902', replacement: 'finished in 1889', explanation: 'It opened in 1889. Source: https://example.org/tower', confidence: 'high', guideline: '' });
  assert.equal(factFinding(c, { verdict: 'outdated', replacement: 'finished in 1889', explanation: '', source: 'not a url' }).confidence, 'medium', 'no source: less sure');
  for (const v of [{ verdict: 'correct' }, { verdict: 'unsure', replacement: 'x' }, { verdict: 'wrong', replacement: '' }, { verdict: 'wrong', replacement: 'finished in 1902' }, null]) assert.equal(factFinding(c, v), null, JSON.stringify(v));
});

test('claims worth checking: in a reviewable element, quoted from it, each once, at most eight', () => {
  const blocks = [makeBlock('scene', 'EXT. PARIS - NIGHT'), makeBlock('action', 'The Eiffel Tower, finished in 1902, glows.')];
  const [chunk] = buildChunks(blocks);
  const raw = [
    { element: 'e1', original: 'finished in 1902', claim: 'The Eiffel Tower was finished in 1902.' },
    { element: 'e1', original: 'finished in 1902', claim: 'again' },
    { element: 'e1', original: 'built in 1700', claim: 'not in the line' },
    { element: 'e9', original: 'x', claim: 'no such element' },
    { element: 'e1', original: '', claim: 'empty' },
    { element: 'e1', original: '190', claim: 'only inside a longer word' },
  ];
  const got = claimsOf(chunk, raw);
  assert.deepEqual(got, [{ element: 'e1', original: 'finished in 1902', claim: 'The Eiffel Tower was finished in 1902.', text: 'The Eiffel Tower, finished in 1902, glows.' }]);
  assert.equal(claimsOf(chunk, Array.from({ length: 20 }, () => raw[0])).length, 1);
  assert.deepEqual(claimsOf(chunk, null), []);
  assert.match(factPrompt(got[0]), /<claim>The Eiffel Tower was finished in 1902\.<\/claim>\n<quoted>finished in 1902<\/quoted>/);
  // A checked claim goes through the same checks as any finding: the minimal change, in the element.
  const v = validateFindings(chunk, [factFinding(got[0], { verdict: 'wrong', replacement: 'finished in 1889', explanation: 'x', source: '' })]);
  assert.deepEqual(v.findings.map((f) => [f.category, f.original, f.replacement]), [['fact', '1902', '1889']]);
});
