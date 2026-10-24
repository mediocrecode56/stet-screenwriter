// Spelling with an installed Hunspell dictionary (core/spell.js, main/spell.js): words checked by
// their stems and affixes, only obvious slips flagged (one edit from known words), names and
// all-caps words left alone, and the dictionaries found where a computer keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Speller, parseAff, splitFlags, wordsToCheck, namesIn, inCaseOf, oneEdit, languageName } from '../../src/core/spell.js';
import { dictionaryDirs, findDictionaries, pickDictionary, SpellService } from '../../src/main/spell.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hunspell');
const read = (f) => fs.readFile(path.join(DIR, f), 'utf8');
const speller = async () => new Speller(await read('en_US.aff'), await read('en_US.dic'));

test('words are known by their stem and its prefixes and suffixes, in the case they are written', async () => {
  const sp = await speller();
  for (const w of ['walk', 'walked', 'walking', 'walks', 'opened', 'receiving', 'believes', 'unhappy', 'nights', 'Rain', 'RAIN', 'London', "harbour's"]) assert.ok(sp.has(w), w);
  for (const w of ['walkd', 'happies', 'unwalk', 'london', 'teh']) assert.ok(!sp.has(w), w);
  assert.ok(sp.words.size < 60, 'the stems only, never every form');
});

test('only obvious slips: one edit from a known word, the likeliest fix first; Auto only when one fix stands out', async () => {
  const sp = await speller();
  assert.deepEqual(sp.check('teh'), { fixes: ['the'], auto: 'the' }, 'a swapped pair');
  assert.deepEqual(sp.check('recieve'), { fixes: ['receive'], auto: 'receive' }, 'a known slip (REP)');
  assert.deepEqual(sp.check('Wlak'), { fixes: ['Walk'], auto: 'Walk' }, 'in the case it was written');
  assert.equal(sp.check('walk'), null, 'known');
  assert.equal(sp.check('xylophone'), null, 'unknown but nothing close: not an obvious slip');
  assert.equal(sp.check('wlkd'), null, 'two edits away: not obvious');
  // Two fixes equally likely: suggested, never corrected on its own.
  const two = new Speller('TRY abcdefghijklmnopqrstuvwxyz\n', '2\ncat\ncar\n');
  assert.deepEqual(two.check('cax'), { fixes: ['car', 'cat'], auto: null }, 'in the order of the TRY letters');
});

test('the words worth checking: not names, all caps, short words, or anything by a digit, a slash or a dot', () => {
  const words = (t) => wordsToCheck(t).map((x) => x.word);
  assert.deepEqual(words('Mara opens teh door. She sees Bob, then MARA waves at 5pm.'), ['Mara', 'opens', 'teh', 'door', 'She', 'sees', 'then', 'waves']);
  assert.deepEqual(words('www.example.com e.g. and/or 3rd iPhone don\'t "Hello" (quietly) — Yes'), ['don\'t', 'Hello', 'quietly', 'Yes']);
  assert.deepEqual(wordsToCheck('the teh'), [{ s: 0, e: 3, word: 'the' }, { s: 4, e: 7, word: 'teh' }]);
  assert.deepEqual([...namesIn('Mara opens the door. She sees Bob and Mara.')], ['bob', 'mara']);
  assert.equal(inCaseOf('Teh', 'the'), 'The');
  assert.ok(oneEdit('teh', 'the') && oneEdit('wlak', 'walk') && oneEdit('dor', 'door') && oneEdit('doorr', 'door') && oneEdit('cat', 'car'));
  assert.ok(!oneEdit('cat', 'cat') && !oneEdit('tehx', 'the') && !oneEdit('abc', 'cab'));
});

test('an .aff file: flags as it writes them, aliases, affix rules with their conditions', () => {
  assert.deepEqual(splitFlags('ABC', 'char'), ['A', 'B', 'C']);
  assert.deepEqual(splitFlags('AaBb', 'long'), ['Aa', 'Bb']);
  assert.deepEqual(splitFlags('12,7', 'num'), ['12', '7']);
  const aff = parseAff('FLAG long\nAF 2\nAF AaBb\nAF Bb\nSFX Aa Y 1\nSFX Aa y ies [^aeiou]y\n');
  assert.deepEqual(aff.aliases, [['Aa', 'Bb'], ['Bb']]);
  assert.equal(aff.sfx.get('Aa').rules[0].add, 'ies');
  const sp = new Speller('FLAG long\nAF 1\nAF Aa\nSFX Aa Y 1\nSFX Aa y ies [^aeiou]y\n', '1\ncity/1\n');
  assert.ok(sp.has('cities') && sp.has('city') && !sp.has('citys'));
});

test('the dictionaries installed: found in the usual places, one per language, the one for this computer first', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dict-'));
  try {
    await fs.mkdir(path.join(tmp, 'LibreOffice', 'dict-fr'), { recursive: true });
    for (const f of ['en_GB.aff', 'en_GB.dic', 'hyph_en_GB.dic', 'de_DE.dic']) await fs.writeFile(path.join(tmp, f), '');
    for (const f of ['fr_FR.aff', 'fr_FR.dic']) await fs.writeFile(path.join(tmp, 'LibreOffice', 'dict-fr', f), '');
    const list = await findDictionaries([tmp, DIR]);
    assert.deepEqual(list.map((d) => d.code), ['en_US', 'en_GB', 'fr_FR'].sort((a, b) => languageName(a).localeCompare(languageName(b))), 'with an .aff beside it, no hyphenation patterns');
    assert.equal(list.find((d) => d.code === 'fr_FR').label, 'French (France)');
    assert.equal(pickDictionary(list, 'en-GB').code, 'en_GB');
    assert.equal(pickDictionary(list, 'en-AU').code.slice(0, 2), 'en');
    assert.equal(pickDictionary(list, 'fr').code, 'fr_FR');
    assert.equal(pickDictionary([], 'en'), null);
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  const home = path.join(path.sep, 'home', 'w');
  assert.ok(dictionaryDirs({ platform: 'win32', env: { APPDATA: 'C:\\A', ProgramFiles: 'C:\\P' }, home }).some((d) => d.includes('Spelling')));
  assert.ok(dictionaryDirs({ platform: 'darwin', env: {}, home }).includes(path.join(home, 'Library', 'Spelling')));
  assert.ok(dictionaryDirs({ platform: 'linux', env: {}, home }).includes('/usr/share/hunspell'));
  assert.deepEqual(dictionaryDirs({ platform: 'linux', env: { STET_DICT_DIRS: DIR, STET_DICT_ONLY: '1' }, home }), [DIR]);
});

test('the checker runs in a worker thread with the chosen dictionary', async () => {
  const s = new SpellService();
  try {
    assert.deepEqual(await s.check(['teh']), {}, 'nothing loaded: nothing flagged');
    await s.load(path.join(DIR, 'en_US'));
    assert.deepEqual(await s.check(['teh', 'walked']), { teh: { fixes: ['the'], auto: 'the' }, walked: null });
  } finally { s.stop(); }
});
