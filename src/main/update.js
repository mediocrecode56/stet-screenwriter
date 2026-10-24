// Updates: finding a newer release on GitHub, downloading it and putting it in place.
//
// Plain Node, no Electron, so it can be unit-tested; main.js supplies fetch (Electron's
// net.fetch, which follows the system proxy), process spawning and the relaunch.
//
// Most releases change only STET's own code. Those come as a patch of a couple of
// megabytes, made for the Electron STET runs on (src/main/patch.js): it is unpacked into a
// folder of its own and STET restarts into it. No installer, nothing else changes.
// When a release needs a new Electron, the full download is used, and then how STET was
// installed decides how it updates (installKind):
//   installer  STET-Setup.exe (unins000.exe sits beside the program). The new installer
//              runs invisibly once STET has closed, replaces the program in place, keeps
//              the shortcut choice and opens STET again (/relaunch=1, see STET.iss).
//   portable   the single-file STET.exe from STET-Windows.zip (its launcher passes its own
//              path as STET_PORTABLE_EXE). The new STET.exe is unpacked beside it as
//              STET.exe.new, swapped in by renaming, and started once this one has quit.
//   manual     anything else (a Mac, running from source, a dist folder): STET
//              only offers the download page.
// Every download is checked against the size and SHA-256 that GitHub publishes for the
// file before anything is changed. Settings, statistics and screenplays live elsewhere
// (%APPDATA%\STET, wherever they were saved) and are never touched.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipEntries } from './zip.js';
import { patchAsset, patchReady, patchFailed, installPatch } from './patch.js';

export const REPO_URL = 'https://github.com/mediocrecode56/stet-screenwriter';
export const RELEASES_URL = REPO_URL + '/releases/latest';
export const LATEST_API = 'https://api.github.com/repos/mediocrecode56/stet-screenwriter/releases/latest';
export const ASSETS = { installer: 'STET-Setup.exe', portable: 'STET-Windows.zip' };
export const INSTALLER_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCANCEL', '/FORCECLOSEAPPLICATIONS', '/relaunch=1'];

export class UpdateError extends Error {
  constructor(message, { cancelled = false } = {}) { super(message); this.cancelled = cancelled; }
}

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}

/** -1, 0 or 1 as version a is older than, the same as, or newer than b. */
export function compareVersions(a, b) {
  const x = parseVersion(a) || [0, 0, 0], y = parseVersion(b) || [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** The parts of a GitHub release STET needs, or null if it isn't a usable release. */
export function parseRelease(json) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const version = String(json.tag_name || '').replace(/^v/, '');
  if (!parseVersion(version)) return null;
  const assets = {};
  for (const a of Array.isArray(json.assets) ? json.assets : []) {
    const sha = /^sha256:([0-9a-f]{64})$/i.exec(a.digest || '');
    assets[a.name] = { name: a.name, url: a.browser_download_url, size: a.size || 0, sha256: sha ? sha[1].toLowerCase() : null };
  }
  // The notes start with download instructions meant for the release page.
  const notes = String(json.body || '').replace(/\r\n/g, '\n').replace(/^\*\*To get STET[^\n]*\n+/, '').trim();
  return { version, notes, page: json.html_url || RELEASES_URL, assets };
}

/**
 * Asks GitHub for the newest release.
 * → { status: 'available', version, current, notes, page, assets } | { status: 'current', version } | { status: 'error', message }
 */
export async function checkForUpdate({ current, fetch, url = LATEST_API, timeoutMs = 15000 }) {
  let res;
  try {
    // Never a cached answer: GitHub lets "latest" be cached for a minute, long enough to miss a release.
    res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json', 'User-Agent': `STET/${current}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { status: 'error', message: "STET couldn't reach GitHub. Check your internet connection and try again." };
  }
  if (res.status === 404) return { status: 'error', message: 'No published version of STET was found.' };
  if (res.status === 403 || res.status === 429) return { status: 'error', message: 'GitHub is limiting requests right now. Try again later.' };
  if (!res.ok) return { status: 'error', message: `GitHub answered with an error (${res.status}). Try again later.` };
  let release;
  try { release = parseRelease(await res.json()); } catch { release = null; }
  if (!release) return { status: 'error', message: 'GitHub sent an answer STET could not read.' };
  if (compareVersions(release.version, current) <= 0) return { status: 'current', version: current };
  return { status: 'available', current, ...release };
}

/** How this copy of STET was installed, and so how it can update. */
export function installKind({ platform, packaged, execPath, env, exists }) {
  if (platform !== 'win32' || !packaged) return { kind: 'manual' };
  const portable = env.STET_PORTABLE_EXE;
  if (portable && /\.exe$/i.test(portable)) return { kind: 'portable', target: portable };
  if (exists(path.join(path.dirname(execPath), 'unins000.exe'))) return { kind: 'installer' };
  return { kind: 'manual' };
}

/** Downloads an asset to dest, checking its size and SHA-256. onProgress(received, total). */
export async function download({ asset, dest, fetch, onProgress = () => {}, signal, userAgent = 'STET' }) {
  let res;
  try {
    res = await fetch(asset.url, { headers: { Accept: 'application/octet-stream', 'User-Agent': userAgent }, signal });
  } catch {
    if (signal?.aborted) throw new UpdateError('Cancelled.', { cancelled: true });
    throw new UpdateError("STET couldn't reach GitHub. Check your internet connection and try again.");
  }
  if (!res.ok || !res.body) throw new UpdateError(`The download failed (${res.status}). Try again later.`);
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  const out = createWriteStream(part);
  out.on('error', () => {}); // a write failing after a cancel is handled below, never left unhandled
  const hash = createHash('sha256');
  let received = 0;
  try {
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      hash.update(buf);
      received += buf.length;
      if (!out.write(buf)) await once(out, 'drain');
      onProgress(received, total);
    }
    out.end();
    await finished(out);
  } catch {
    const closed = out.closed ? null : once(out, 'close').catch(() => {});
    out.destroy();
    await closed;
    await fs.rm(part, { force: true });
    if (signal?.aborted) throw new UpdateError('Cancelled.', { cancelled: true });
    throw new UpdateError('The download was interrupted. Check your internet connection and try again.');
  }
  if ((asset.size && received !== asset.size) || (asset.sha256 && hash.digest('hex') !== asset.sha256)) {
    await fs.rm(part, { force: true });
    throw new UpdateError("The download didn't match the published file, so it was not used. Try again.");
  }
  await fs.rename(part, dest);
  return dest;
}

/** The contents of one file (by name, in any folder) from a zip archive, checked against its CRC. */
export async function readZipEntry(zipPath, name) {
  const bad = () => new UpdateError('The downloaded archive is damaged. Try again.');
  let entries;
  try { entries = zipEntries(await fs.readFile(zipPath)); } catch { throw bad(); }
  const e = entries.find((x) => x.name.split(/[\\/]/).pop().toLowerCase() === name.toLowerCase());
  if (!e) throw new UpdateError(`The downloaded archive has no ${name}.`);
  try { return e.read(); } catch { throw bad(); }
}

const folderError = (target) => new UpdateError(`STET can't replace itself in ${path.dirname(target)}. Move STET.exe to a folder you can change, such as your Desktop, or download the new version from the website.`);

/** Unpacks the new STET.exe from the zip next to the running one, as STET.exe.new. */
export async function preparePortable({ zipPath, target }) {
  const exe = await readZipEntry(zipPath, 'STET.exe');
  if (exe.length < 2 || exe[0] !== 0x4d || exe[1] !== 0x5a) throw new UpdateError('The downloaded STET.exe is not a Windows program. Try again.');
  try { await fs.writeFile(target + '.new', exe); } catch { throw folderError(target); }
}

/** Puts STET.exe.new in place of STET.exe; the old one stays as STET.exe.old until the next start. */
export async function swapPortable(target) {
  const next = target + '.new', old = target + '.old';
  await fs.rm(old, { force: true }).catch(() => {});
  let moved = false;
  try { await fs.rename(target, old); moved = true; } catch (e) { if (e.code !== 'ENOENT') throw folderError(target); }
  try { await fs.rename(next, target); } catch {
    if (moved) await fs.rename(old, target).catch(() => {});
    throw folderError(target);
  }
}

/** Leftovers of an earlier update: STET.exe.old (the previous version) and an unused STET.exe.new. */
export async function cleanupPortable(target) {
  for (const f of [target + '.old', target + '.new']) await fs.rm(f, { force: true }).catch(() => {});
}

/**
 * One update at a time: check, download (and unpack: a patch, or the portable STET.exe), apply.
 * deps: { current, fetch, kind: installKind(), patches: patchRoot() or null, electron:
 * the running Electron's version, dir: a folder for downloads, url? }
 */
export class Updater {
  constructor({ current, fetch, kind, patches = null, electron = '', dir, url = LATEST_API }) {
    Object.assign(this, { current, fetch, kind, patches, electron, dir, url });
    this.latest = null; // the release found by the last check
    this.ready = null;  // { version, file, mode } once downloaded and checked
    this.abort = null;
  }

  /** How the release found would be installed: 'patch', or the full download ('installer' | 'portable'), or 'manual'. */
  mode(rel = this.latest) {
    if (rel && this.patches && this.electron && rel.assets[patchAsset(this.electron)] && !patchFailed(this.patches, rel.version)) return 'patch';
    return this.kind.kind;
  }

  async check() {
    const r = await checkForUpdate({ current: this.current, fetch: this.fetch, url: this.url });
    if (r.status === 'available') this.latest = r;
    const { assets, ...rest } = r;
    if (r.status !== 'available') return rest;
    const mode = this.mode(r);
    const asset = assets[mode === 'patch' ? patchAsset(this.electron) : ASSETS[mode]];
    const ready = (this.ready && this.ready.version === r.version) || (mode === 'patch' && patchReady(this.patches, r.version, this.electron));
    if (ready && !this.ready) this.ready = { version: r.version, mode };
    return { ...rest, kind: mode, size: asset ? asset.size : 0, ready: !!ready };
  }

  async download(onProgress) {
    const rel = this.latest;
    if (!rel) throw new UpdateError('Check for updates first.');
    if (this.ready && this.ready.version === rel.version) return this.ready;
    if (this.abort) throw new UpdateError('The update is already downloading.');
    const mode = this.mode(rel);
    const asset = rel.assets[mode === 'patch' ? patchAsset(this.electron) : ASSETS[mode]];
    if (!asset || !asset.url) throw new UpdateError('This version has no download for your copy of STET. Download it from the website instead.');
    this.abort = new AbortController();
    try {
      await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {});
      const file = await download({ asset, dest: path.join(this.dir, asset.name), fetch: this.fetch, onProgress, signal: this.abort.signal, userAgent: `STET/${this.current}` });
      if (mode === 'patch') {
        try { await installPatch({ zipPath: file, root: this.patches, version: rel.version, electron: this.electron }); } catch (e) { throw new UpdateError(e.message); }
        await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {});
      } else if (mode === 'portable') await preparePortable({ zipPath: file, target: this.kind.target });
      this.ready = { version: rel.version, file, mode };
      return this.ready;
    } finally {
      this.abort = null;
    }
  }

  cancel() { if (this.abort) this.abort.abort(); }

  /** Puts the downloaded version in place. The caller quits STET straight after. */
  async apply({ spawn, relaunch, pid = process.pid }) {
    if (!this.ready) throw new UpdateError('Nothing has been downloaded yet.');
    const mode = this.ready.mode;
    if (mode === 'patch') {
      relaunch(null); // the same STET.exe; src/main/boot.js starts the patch
    } else if (mode === 'installer') {
      // Only quit once the installer is really running. It waits for this STET to close (/waitpid).
      const child = spawn(this.ready.file, [...INSTALLER_ARGS, `/waitpid=${pid}`], { detached: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); })
        .catch(() => { throw new UpdateError("The installer couldn't be started. Download the new version from the website instead."); });
      child.unref();
    } else if (mode === 'portable') {
      await swapPortable(this.kind.target);
      relaunch(this.kind.target);
    } else {
      throw new UpdateError('This copy of STET updates from the website.');
    }
  }
}
