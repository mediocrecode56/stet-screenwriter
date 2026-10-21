// STET's entry point. It starts the newest patch of STET's code downloaded by the
// in-app updater (src/main/patch.js), or the version that shipped if there is none.
// Kept tiny on purpose: everything here runs before STET itself, in every version.

import { app } from 'electron';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patchRoot, choosePatch, beginLaunch } from './patch.js';

const own = new URL('./main.js', import.meta.url);
let patch = null;
if (app.isPackaged || process.env.STET_PATCH_DIR) {
  try {
    const base = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version;
    patch = choosePatch({ root: patchRoot(), base, electron: process.versions.electron });
    if (patch) beginLaunch(patch.dir);
  } catch {
    patch = null; // anything wrong with the patches: the shipped version starts
  }
}

if (patch) {
  process.env.STET_PATCH = patch.dir; // main.js confirms it once its window is up
  try {
    await import(pathToFileURL(`${patch.dir}/src/main/main.js`).href);
  } catch (e) {
    console.error('STET: the update could not start, so the shipped version is used.', e);
    try { fs.writeFileSync(`${patch.dir}/.failed`, ''); } catch { /* skipped next time anyway */ }
    delete process.env.STET_PATCH;
    await import(own.href);
  }
} else {
  await import(own.href);
}
