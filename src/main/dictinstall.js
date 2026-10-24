// Installing a spelling dictionary when the computer has none: open Hunspell dictionaries,
// downloaded in the background into STET's own folder (no administrator rights, nothing else on the
// computer touched). No single link is relied on: the files are looked up where they are published
// (LibreOffice's dictionaries on GitHub, the npm "dictionary-*" packages on jsDelivr and unpkg), each
// by listing what is there before guessing a path, and whatever comes back is checked as a real
// dictionary before it is kept. A source that moves or renames its files just falls through to the next.

import fs from 'node:fs/promises';
import path from 'node:path';
import { Speller } from '../core/spell.js';

const MAX = 20 * 1024 * 1024; // the largest dictionary file accepted
const TIMEOUT = 30000;

/** "en-US" → { code: 'en_US', lang: 'en', region: 'US' }. */
export function localeCode(locale = 'en-US') {
  const [lang, region] = String(locale || 'en').replace(/_/g, '-').split('-');
  const l = (lang || 'en').toLowerCase(), r = region && /^[a-z]{2}$/i.test(region) ? region.toUpperCase() : '';
  return { code: r ? `${l}_${r}` : l, lang: l, region: r };
}

/** The npm packages that may hold this language: dictionary-en-gb, then dictionary-en. */
const npmNames = ({ lang, region }) => [...(region ? [`dictionary-${lang}-${region.toLowerCase()}`] : []), `dictionary-${lang}`];

/** Of a list of file paths, the .aff/.dic pair for this language (exact code first, then the language, then any). */
export function pickPair(files, { code, lang }) {
  const base = (f) => f.split('/').pop().replace(/\.(aff|dic)$/i, '');
  const pairs = [...new Set(files.filter((f) => /\.aff$/i.test(f)).map((f) => f.replace(/\.aff$/i, '')))]
    .filter((p) => files.some((f) => f.toLowerCase() === (p + '.dic').toLowerCase()) && !/^(hyph|th)_/i.test(base(p + '.aff')));
  const score = (p) => { const b = base(p + '.aff').toLowerCase(); return b === code.toLowerCase() ? 0 : b.startsWith(code.toLowerCase()) ? 1 : b === lang || b === 'index' ? 2 : b.startsWith(lang) ? 3 : 4; };
  const best = pairs.sort((a, b) => score(a) - score(b) || a.length - b.length)[0];
  return best ? { aff: best + '.aff', dic: files.find((f) => f.toLowerCase() === (best + '.dic').toLowerCase()) } : null;
}

/**
 * Where to look, in order: each yields candidate { aff, dic } URLs for the language. STET_DICT_SOURCES
 * (a JSON list of { aff, dic } templates with {code} and {lang}) replaces them: the tests' own server.
 */
export function sources(env = process.env) {
  if (env.STET_DICT_SOURCES) {
    const list = JSON.parse(env.STET_DICT_SOURCES);
    return [{ name: 'test', find: async (c) => list.map((t) => ({ aff: fill(t.aff, c), dic: fill(t.dic, c) })) }];
  }
  return [
    { name: 'LibreOffice', find: async (c, get) => { // their folders and files listed, not assumed
      const root = await getJson(get, 'https://api.github.com/repos/LibreOffice/dictionaries/contents/');
      const dirs = root.filter((d) => d.type === 'dir' && (d.name.toLowerCase() === c.lang || d.name.toLowerCase().startsWith(c.lang + '_')))
        .sort((a, b) => (b.name.toLowerCase() === c.code.toLowerCase()) - (a.name.toLowerCase() === c.code.toLowerCase()));
      const out = [];
      for (const d of dirs.slice(0, 3)) {
        const files = (await getJson(get, d.url)).filter((f) => f.type === 'file');
        const pair = pickPair(files.map((f) => f.path), c);
        if (pair) out.push({ aff: files.find((f) => f.path === pair.aff).download_url, dic: files.find((f) => f.path === pair.dic).download_url });
      }
      return out;
    } },
    { name: 'jsDelivr', find: async (c, get) => { // each package's files listed, then the usual names
      const out = [];
      for (const n of npmNames(c)) {
        try {
          const meta = await getJson(get, `https://data.jsdelivr.com/v1/packages/npm/${n}@latest?structure=flat`);
          const pair = pickPair((meta.files || []).map((f) => f.name.replace(/^\//, '')), c);
          if (pair) out.push({ aff: `https://cdn.jsdelivr.net/npm/${n}@${meta.version || 'latest'}/${pair.aff}`, dic: `https://cdn.jsdelivr.net/npm/${n}@${meta.version || 'latest'}/${pair.dic}` });
        } catch { /* unknown package, or the listing moved: the guess below */ }
        out.push({ aff: `https://cdn.jsdelivr.net/npm/${n}/index.aff`, dic: `https://cdn.jsdelivr.net/npm/${n}/index.dic` });
      }
      return out;
    } },
    { name: 'unpkg', find: async (c) => npmNames(c).map((n) => ({ aff: `https://unpkg.com/${n}/index.aff`, dic: `https://unpkg.com/${n}/index.dic` })) },
    { name: 'LibreOffice (direct)', find: async (c) => { // the layouts their folders have used (en/en_US, fr_FR/fr, de/de_DE_frami…)
      const raw = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/';
      const paths = [`${c.lang}/${c.code}`, `${c.code}/${c.code}`, `${c.code}/${c.lang}`, `${c.lang}/${c.lang}`, `${c.lang}/${c.code}_frami`, ...(c.region ? [] : [`${c.lang}_${c.lang.toUpperCase()}/${c.lang}`, `${c.lang}/${c.lang}_${c.lang.toUpperCase()}`])];
      return [...new Set(paths)].map((p) => ({ aff: raw + p + '.aff', dic: raw + p + '.dic' }));
    } },
  ];
}

const fill = (t, c) => t.replace(/\{code\}/g, c.code).replace(/\{lang\}/g, c.lang);

async function getJson(get, url) { return JSON.parse((await get(url)).toString('utf8')); }

/** A fetch(url) → Buffer, with a time limit and a size limit; throws on anything but a 200. */
export function getter(fetch) {
  return async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'STET', Accept: '*/*' } });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    const len = +r.headers.get('content-length');
    if (len > MAX) throw new Error('too large');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) throw new Error('too large');
    return buf;
  };
}

/** The text of a downloaded pair, if it is really a Hunspell dictionary (not an error page, not empty). */
export function checkPair(affBuf, dicBuf) {
  const enc = /^SET\s+(\S+)/m.exec(affBuf.toString('latin1'))?.[1] || 'utf-8';
  let aff, dic;
  try { aff = new TextDecoder(enc).decode(affBuf); dic = new TextDecoder(enc).decode(dicBuf); } catch { return null; }
  if (!/^(SFX|PFX|TRY|SET|FLAG|REP|KEY)\s/m.test(aff) || /<html|<!doctype/i.test(aff.slice(0, 500) + dic.slice(0, 500))) return null;
  if (!/^\s*\d+\s*$/.test(dic.split(/\r?\n/, 1)[0])) return null;
  const sp = new Speller(aff, dic);
  if (sp.words.size < 20) return null;
  return true;
}

/**
 * Download a dictionary for `locale` into `dir`/<code>/ (first source that gives a real one wins).
 * Returns { code, path, source }; throws with what was tried when none did.
 */
export async function installDictionary({ locale, dir, fetch, env = process.env, onStep = () => {} }) {
  const c = localeCode(locale), get = getter(fetch), tried = [];
  for (const src of sources(env)) {
    let cands = [];
    try { cands = await src.find(c, get); } catch (e) { tried.push(`${src.name}: ${e.message}`); continue; }
    for (const u of cands) {
      try {
        onStep(src.name);
        const [affBuf, dicBuf] = await Promise.all([get(u.aff), get(u.dic)]);
        if (!checkPair(affBuf, dicBuf)) { tried.push(`${src.name}: not a dictionary`); continue; }
        const into = path.join(dir, c.code);
        await fs.mkdir(into, { recursive: true });
        for (const [ext, buf] of [['aff', affBuf], ['dic', dicBuf]]) { // whole files only: written beside, then moved in
          const f = path.join(into, `${c.code}.${ext}`);
          await fs.writeFile(f + '.part', buf);
          await fs.rename(f + '.part', f);
        }
        return { code: c.code, path: path.join(into, c.code), source: src.name };
      } catch (e) { tried.push(`${src.name}: ${e.message}`); }
    }
  }
  throw new Error('No dictionary could be downloaded (' + [...new Set(tried)].slice(0, 6).join('; ') + ').');
}
