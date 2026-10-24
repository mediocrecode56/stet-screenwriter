// What scripts/build-exe.js does to the packaged app to keep downloads small, and the
// patch it makes for in-app updates (src/main/patch.js). Plain Node, so it can be checked
// anywhere: node scripts/package-tools.js <app folder> prints what pruning would leave.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip, folderEntries } from '../src/main/zip.js';

// Never loaded at run time: type declarations, source maps, TypeScript sources, docs.
const DEAD_FILE = /\.(d\.ts|d\.mts|d\.cts|map|ts|mts|cts|md|markdown)$/i;
const DEAD_DIR = new Set(['src', 'test', 'tests', 'docs', 'example', 'examples', '.github']);

/**
 * What never goes into the packaged app (@electron/packager `ignore`): development folders,
 * git files, notes for contributors, and the icon sources (the window uses icon.ico on
 * Windows and icon.png elsewhere; the Mac bundle icon is made from icon.icns separately).
 */
export const APP_IGNORE = [
  /^\/(dist|bench|test|docs|scripts|\.perf|\.build|\.build-mac)(\/|$)/,
  /^\/\.git/,
  /^\/build\/(icon-\d+\.png|icon\.svg|icon\.icns)$/,
  /^\/(README\.md|CLAUDE\.md|package-lock\.json)$/,
];

/**
 * What STET.app's Info.plist says about screenplays: .stet files are STET Screenplays
 * (app.stet.screenplay), STET owns them, and they show its icon (packager names it electron.icns).
 */
export const MAC_DOC_INFO = {
  CFBundleDocumentTypes: [{ CFBundleTypeName: 'STET Screenplay', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Owner', LSItemContentTypes: ['app.stet.screenplay'], CFBundleTypeIconFile: 'electron.icns' }],
  UTExportedTypeDeclarations: [{ UTTypeIdentifier: 'app.stet.screenplay', UTTypeDescription: 'STET Screenplay', UTTypeConformsTo: ['public.data', 'public.content'], UTTypeIconFile: 'electron.icns', UTTypeTagSpecification: { 'public.filename-extension': ['stet'] } }],
};

/** Removes from node_modules what is never run (and, in a package that is imported as an ES
 *  module, the CommonJS copy of each file beside it). Returns the bytes saved. */
export function pruneModules(appDir) {
  const nm = path.join(appDir, 'node_modules');
  let saved = 0;
  const size = (p) => { let n = 0; for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? size(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size; return n; };
  const walk = (dir, inPackage) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // A package's own src/ (TypeScript sources) and docs, but never a package named so.
        if (inPackage && DEAD_DIR.has(e.name) && !isPackage(p)) { saved += size(p); fs.rmSync(p, { recursive: true, force: true }); continue; }
        walk(p, inPackage || e.name !== 'node_modules');
      } else if (DEAD_FILE.test(e.name) || (e.name.endsWith('.js') && inEsm(p) && fs.existsSync(p.slice(0, -3) + '.mjs'))) {
        saved += fs.statSync(p).size;
        fs.rmSync(p);
      }
    }
  };
  // Packages whose entry for an import is .mjs (STET imports its dependencies, never requires them).
  const esm = new Set();
  const inEsm = (file) => { for (let d = path.dirname(file); d.length > nm.length; d = path.dirname(d)) if (fs.existsSync(path.join(d, 'package.json'))) return esm.has(d); return false; };
  const entry = (x) => typeof x === 'string' ? x : x && (entry(x.import) || entry(x.default));
  const find = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('@')) { find(p); continue; }
      try { const pk = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')); if (/\.mjs$/.test(entry(pk.exports?.['.'] ?? pk.exports) || '')) esm.add(p); } catch { /* no package here */ }
      find(path.join(p, 'node_modules'));
    }
  };
  find(nm);
  if (fs.existsSync(nm)) for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(nm, e.name);
    if (e.name.startsWith('@')) { for (const s of fs.readdirSync(p)) walk(path.join(p, s), true); } else walk(p, true);
  }
  return saved;
}
const isPackage = (dir) => fs.existsSync(path.join(dir, 'package.json')) && path.basename(path.dirname(dir)) === 'node_modules';

/** Keeps only the English interface strings of Chromium (STET is in English). Returns the bytes saved. */
export function trimLocales(electronDir) {
  const dir = path.join(electronDir, 'locales');
  let saved = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir)) {
    if (/^en-(US|GB)\.pak$/i.test(f)) continue;
    saved += fs.statSync(path.join(dir, f)).size;
    fs.rmSync(path.join(dir, f));
  }
  return saved;
}

/** The same on a Mac, where Chromium's (and Electron's) interface strings are <language>.lproj folders. */
export function trimMacLocales(appDir) {
  let saved = 0;
  const size = (p) => { let n = 0; for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? size(path.join(p, e.name)) : fs.lstatSync(path.join(p, e.name)).size; return n; };
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue; // symbolic links inside frameworks are not followed
      const p = path.join(dir, e.name);
      if (!e.name.endsWith('.lproj')) { walk(p); continue; }
      if (/^(en|en_GB|en-GB|Base)\.lproj$/i.test(e.name)) continue;
      saved += size(p);
      fs.rmSync(p, { recursive: true, force: true });
    }
  };
  walk(appDir);
  return saved;
}

/** The patch for in-app updates: the app's files (as they go into app.asar), zipped. */
export async function writePatch(appDir, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, makeZip(await folderEntries(appDir)));
  return fs.statSync(outFile).size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'stet-prune-'));
  fs.cpSync(process.argv[2], tmp, { recursive: true });
  const saved = pruneModules(tmp);
  const size = await writePatch(tmp, path.join(tmp, '..', path.basename(tmp) + '.zip'));
  console.log(`pruned ${(saved / 1048576).toFixed(1)} MB; patch ${(size / 1048576).toFixed(2)} MB`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
