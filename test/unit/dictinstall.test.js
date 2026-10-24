// Installing a dictionary when none is found (main/dictinstall.js): looked up where it is published,
// each source listed before guessed, every download checked as a real dictionary, the first good
// one kept; a source that fails, moves or renames its files falls through to the next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { localeCode, pickPair, checkPair, sources, installDictionary } from '../../src/main/dictinstall.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hunspell');
const AFF = await fs.readFile(path.join(DIR, 'en_US.aff')), DIC = await fs.readFile(path.join(DIR, 'en_US.dic'));
const HTML = Buffer.from('<!doctype html><html><body>Moved</body></html>');

/** A fetch answering from a map of URL → Buffer | object (JSON) | number (a status); anything else a 404. */
const fakeFetch = (routes, seen = []) => async (url) => {
  seen.push(url);
  const v = Object.entries(routes).find(([k]) => url.startsWith(k))?.[1];
  if (v === undefined || typeof v === 'number') return new Response('no', { status: v || 404 });
  if (v instanceof Error) throw v;
  return new Response(Buffer.isBuffer(v) ? v : JSON.stringify(v), { status: 200 });
};

test('a locale names the dictionary; of the files a source lists, the pair for that language', () => {
  assert.deepEqual(localeCode('en-GB'), { code: 'en_GB', lang: 'en', region: 'GB' });
  assert.deepEqual(localeCode('fr'), { code: 'fr', lang: 'fr', region: '' });
  assert.deepEqual(localeCode('pt_br'), { code: 'pt_BR', lang: 'pt', region: 'BR' });
  const files = ['en/en_GB.aff', 'en/en_GB.dic', 'en/en_US.aff', 'en/en_US.dic', 'en/hyph_en_US.dic', 'en/th_en_US_v2.dat', 'en/README'];
  assert.deepEqual(pickPair(files, localeCode('en-US')), { aff: 'en/en_US.aff', dic: 'en/en_US.dic' });
  assert.deepEqual(pickPair(files, localeCode('en-AU')), { aff: 'en/en_GB.aff', dic: 'en/en_GB.dic' }, 'the same language when the region is missing');
  assert.deepEqual(pickPair(['index.aff', 'index.dic', 'package.json'], localeCode('de-DE')), { aff: 'index.aff', dic: 'index.dic' });
  assert.deepEqual(pickPair(['fr_FR/fr-moderne.aff', 'fr_FR/fr-moderne.dic'], localeCode('fr-FR')), { aff: 'fr_FR/fr-moderne.aff', dic: 'fr_FR/fr-moderne.dic' }, 'a renamed file still found');
  assert.equal(pickPair(['en/en_US.aff'], localeCode('en-US')), null, 'never half a pair');
});

test('only a real dictionary is kept: not an error page, not an empty or broken file', () => {
  assert.ok(checkPair(AFF, DIC));
  assert.ok(!checkPair(HTML, HTML));
  assert.ok(!checkPair(AFF, HTML));
  assert.ok(!checkPair(AFF, Buffer.from('1\nword\n')), 'too small to be one');
});

test('the sources fall through: one down, one moved (an error page), the next one good, written whole', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicti-'));
  try {
    const seen = [];
    const env = { STET_DICT_SOURCES: JSON.stringify([
      { aff: 'https://down.example/{code}.aff', dic: 'https://down.example/{code}.dic' },
      { aff: 'https://moved.example/{lang}.aff', dic: 'https://moved.example/{lang}.dic' },
      { aff: 'https://good.example/{code}/a.aff', dic: 'https://good.example/{code}/a.dic' },
    ]) };
    const fetch = fakeFetch({ 'https://down.example': new Error('offline'), 'https://moved.example': HTML, 'https://good.example/en_GB/a.aff': AFF, 'https://good.example/en_GB/a.dic': DIC }, seen);
    const r = await installDictionary({ locale: 'en-GB', dir, fetch, env });
    assert.deepEqual([r.code, r.path], ['en_GB', path.join(dir, 'en_GB', 'en_GB')]);
    assert.deepEqual(await fs.readFile(r.path + '.dic'), DIC);
    assert.deepEqual((await fs.readdir(path.join(dir, 'en_GB'))).sort(), ['en_GB.aff', 'en_GB.dic'], 'no part files left');
    assert.ok(seen.some((u) => u.startsWith('https://moved.example')), 'the moved source was tried');
    await assert.rejects(installDictionary({ locale: 'en-GB', dir, fetch: fakeFetch({}), env }), /No dictionary could be downloaded \(test: 404/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('the published sources: listed first (so renamed files are found), then the usual paths', async () => {
  const c = localeCode('en-US');
  const [lo, jsd, unpkg, direct] = sources({});
  // GitHub's listing, with LibreOffice's English files renamed: still found.
  const gh = fakeFetch({
    'https://api.github.com/repos/LibreOffice/dictionaries/contents/en': [{ type: 'file', path: 'en/en_US-2030.aff', download_url: 'https://raw/en_US-2030.aff' }, { type: 'file', path: 'en/en_US-2030.dic', download_url: 'https://raw/en_US-2030.dic' }],
    'https://api.github.com/repos/LibreOffice/dictionaries/contents/': [{ type: 'dir', name: 'de', url: 'https://api.github.com/repos/LibreOffice/dictionaries/contents/de' }, { type: 'dir', name: 'en', url: 'https://api.github.com/repos/LibreOffice/dictionaries/contents/en' }],
  });
  const get = async (u) => Buffer.from(await (await gh(u)).arrayBuffer());
  assert.deepEqual(await lo.find(c, get), [{ aff: 'https://raw/en_US-2030.aff', dic: 'https://raw/en_US-2030.dic' }]);
  // jsDelivr's file list for the npm package, the version pinned; and the guess if the list is gone.
  const jl = fakeFetch({ 'https://data.jsdelivr.com/v1/packages/npm/dictionary-en-us@latest': 404, 'https://data.jsdelivr.com/v1/packages/npm/dictionary-en@latest': { version: '4.0.0', files: [{ name: '/index.aff' }, { name: '/index.dic' }] } });
  const jget = async (u) => { const r = await jl(u); if (!r.ok) throw new Error(String(r.status)); return Buffer.from(await r.arrayBuffer()); };
  const j = await jsd.find(c, jget);
  assert.ok(j.some((x) => x.aff === 'https://cdn.jsdelivr.net/npm/dictionary-en@4.0.0/index.aff'));
  assert.ok(j.some((x) => x.aff === 'https://cdn.jsdelivr.net/npm/dictionary-en-us/index.aff'), 'the guess for a package not listed');
  assert.ok((await unpkg.find(c)).some((x) => x.dic === 'https://unpkg.com/dictionary-en/index.dic'));
  assert.ok((await direct.find(c)).some((x) => x.aff.endsWith('/master/en/en_US.aff')));
});
