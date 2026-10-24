// The dictionaries installed on this computer (Hunspell .dic with its .aff: LibreOffice's, the
// Windows spelling folder, a Mac's ~/Library/Spelling, Linux's /usr/share/hunspell), and a worker
// thread that checks words with the one chosen (src/core/spell.js), so the window never waits on it.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { languageName } from '../core/spell.js';

/** Where dictionaries are installed, on this platform (STET_DICT_DIRS first: the tests' own). */
export function dictionaryDirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const extra = (env.STET_DICT_DIRS || '').split(path.delimiter).filter(Boolean);
  if (env.STET_DICT_DIRS && env.STET_DICT_ONLY) return extra;
  if (platform === 'win32') {
    const pf = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
    return [...extra, path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Spelling'),
      ...pf.map((p) => path.join(p, 'LibreOffice', 'share', 'extensions')), ...pf.map((p) => path.join(p, 'Mozilla Firefox', 'dictionaries'))];
  }
  if (platform === 'darwin') {
    return [...extra, path.join(home, 'Library', 'Spelling'), '/Library/Spelling', '/Applications/LibreOffice.app/Contents/Resources/extensions'];
  }
  return [...extra, path.join(home, '.local', 'share', 'hunspell'), '/usr/share/hunspell', '/usr/share/myspell', '/usr/share/myspell/dicts', '/usr/local/share/hunspell'];
}

/** The dictionaries in these folders (and one folder down): [{ id, code, label }], one per language. */
export async function findDictionaries(dirs = dictionaryDirs()) {
  const found = new Map();
  const look = async (dir, depth) => {
    let names;
    try { names = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const p = path.join(dir, d.name);
      if (d.isDirectory() && depth > 0) { await look(p, depth - 1); continue; }
      const m = /^(.+)\.dic$/i.exec(d.name);
      if (!m || /^(hyph|th)_/i.test(m[1]) || !names.some((x) => x.name.toLowerCase() === m[1].toLowerCase() + '.aff')) continue;
      const code = m[1].replace(/-/g, '_');
      if (!found.has(code.toLowerCase())) found.set(code.toLowerCase(), { id: path.join(dir, m[1]), code, label: languageName(code) });
    }
  };
  for (const dir of dirs) await look(dir, 2);
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The dictionary for this locale (en-GB → en_GB, else any English), or the first. */
export function pickDictionary(list, locale = 'en-US') {
  const want = locale.replace(/-/g, '_').toLowerCase(), lang = want.split('_')[0];
  return (list.find((d) => d.code.toLowerCase() === want) || list.find((d) => d.code.toLowerCase().split('_')[0] === lang) || list[0] || null);
}

/** Checks words in a worker thread, with one dictionary loaded at a time. */
export class SpellService {
  constructor() { this.worker = null; this.id = 0; this.waiting = new Map(); this.loaded = null; }

  start() {
    if (this.worker) return this.worker;
    const w = this.worker = new Worker(new URL('./spell-worker.js', import.meta.url));
    w.unref();
    w.on('message', ({ id, ok, value, error }) => { const p = this.waiting.get(id); if (!p) return; this.waiting.delete(id); ok ? p.resolve(value) : p.reject(new Error(error)); });
    const fail = (e) => { for (const p of this.waiting.values()) p.reject(e instanceof Error ? e : new Error('The spelling checker stopped.')); this.waiting.clear(); this.worker = null; this.loaded = null; };
    w.on('error', fail);
    w.on('exit', fail);
    return w;
  }

  ask(op, arg) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.start().postMessage({ id, op, arg }); });
  }

  /** Load a dictionary (its path without the extension); true once it is ready. */
  async load(id) {
    if (this.loaded === id) return true;
    await this.ask('load', id);
    this.loaded = id;
    return true;
  }

  /** { word: null (fine) | { fixes, auto } } with the loaded dictionary. */
  check(words) { return this.loaded ? this.ask('check', words) : Promise.resolve({}); }

  stop() { if (this.worker) this.worker.terminate(); this.worker = null; this.loaded = null; }
}
