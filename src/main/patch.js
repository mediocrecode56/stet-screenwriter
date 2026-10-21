// Patches: a newer version of STET's own code, run by the Electron that is already
// installed. Most releases change only STET's code, so an update is a download of a
// couple of megabytes (STET-Patch-electron-<version>.zip, see scripts/build-exe.js)
// unpacked into a folder of its own, and a restart. The program files are never
// touched, so nothing needs an installer, and the version that shipped stays as it was.
//
//   %LOCALAPPDATA%\STET\app\<version>\          one folder per patch, a full copy of the app
//     .stet-patch.json                          written last: the patch is complete
//     .launching / .ok                          the first start of a patch, and that it worked
//     .failed                                   it didn't reach its window: never used again
//
// src/main/boot.js starts the newest complete patch made for this Electron that is newer
// than the shipped version, or the shipped version if there is none.
// Plain Node, so it can be tested; boot.js uses only the synchronous part.

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractZip } from './zip.js';

const MARK = '.stet-patch.json';

export const patchAsset = (electron) => `STET-Patch-electron-${electron}.zip`;

/** Where patches live, or null where STET doesn't patch itself (only on Windows; STET_PATCH_DIR in tests). */
export function patchRoot(env = process.env, platform = process.platform) {
  if (env.STET_PATCH_DIR) return env.STET_PATCH_DIR;
  return platform === 'win32' && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'STET', 'app') : null;
}

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}
function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const exists = (f) => { try { fsSync.accessSync(f); return true; } catch { return false; } };

/** The complete patches in root: [{ version, electron, dir, failed, ok }]. */
export function listPatches(root) {
  let names = [];
  try { names = fsSync.readdirSync(root); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!parse(name)) continue;
    const dir = path.join(root, name);
    let meta;
    try { meta = JSON.parse(fsSync.readFileSync(path.join(dir, MARK), 'utf8')); } catch { continue; }
    if (meta.version !== name) continue;
    out.push({ version: name, electron: meta.electron, dir, failed: exists(path.join(dir, '.failed')), ok: exists(path.join(dir, '.ok')) });
  }
  return out;
}

/**
 * The patch to start instead of the shipped version: the newest one for this Electron,
 * newer than the shipped version, that hasn't failed. A patch whose first start never
 * reached its window is marked failed here and skipped.
 */
export function choosePatch({ root, base, electron }) {
  if (!root) return null;
  const usable = listPatches(root).filter((p) => p.electron === electron && newer(p.version, base) && !p.failed)
    .sort((a, b) => (newer(a.version, b.version) ? -1 : 1));
  for (const p of usable) {
    if (!p.ok && exists(path.join(p.dir, '.launching'))) {
      try { fsSync.writeFileSync(path.join(p.dir, '.failed'), ''); } catch { /* skipped all the same */ }
      continue;
    }
    return p;
  }
  return null;
}

/** Called just before a patch starts; until confirmLaunch, a crash counts against it. */
export function beginLaunch(dir) {
  if (!exists(path.join(dir, '.ok'))) fsSync.writeFileSync(path.join(dir, '.launching'), String(Date.now()));
}

/** The patch reached its window: it works. */
export async function confirmLaunch(dir) {
  await fs.writeFile(path.join(dir, '.ok'), '');
  await fs.rm(path.join(dir, '.launching'), { force: true });
}

/** Whether a patch for this version is unpacked and ready (and not failed). */
export function patchReady(root, version, electron) {
  return !!root && listPatches(root).some((p) => p.version === version && p.electron === electron && !p.failed);
}
export function patchFailed(root, version) {
  return !!root && listPatches(root).some((p) => p.version === version && p.failed);
}

/**
 * Unpacks a downloaded patch into root/<version>, checking it is that version, made for
 * this Electron, and complete. Throws an Error with a message for people otherwise.
 */
export async function installPatch({ zipPath, root, version, electron }) {
  const dir = path.join(root, version);
  if (patchReady(root, version, electron)) return dir;
  const tmp = `${dir}.tmp-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  try {
    try { await extractZip(zipPath, tmp); } catch { throw new Error('The downloaded update is damaged. Try again.'); }
    let pkg;
    try { pkg = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8')); } catch { pkg = null; }
    const made = String(pkg?.devDependencies?.electron || '').replace(/^[^\d]*/, '');
    if (!pkg || pkg.version !== version || made !== electron || !exists(path.join(tmp, pkg.main || 'src/main/boot.js'))) {
      throw new Error("The downloaded update isn't the version it should be, so it was not used.");
    }
    await fs.writeFile(path.join(tmp, MARK), JSON.stringify({ version, electron }));
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(tmp, dir);
    return dir;
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Removes what is no longer needed: patches no newer than `running` (other than the one
 * running, `keep`) and leftovers of interrupted downloads. Patches newer than the running
 * version stay: one downloaded and waiting for the next start, or one marked failed.
 */
export async function cleanupPatches({ root, running, keep }) {
  if (!root) return;
  let names = [];
  try { names = await fs.readdir(root); } catch { return; }
  for (const name of names) {
    const dir = path.join(root, name);
    if (keep && path.resolve(dir) === path.resolve(keep)) continue;
    if (parse(name) && newer(name, running)) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); // a file in use: next time
  }
}
