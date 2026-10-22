// Help > Open .stet Files with STET: makes double-clicking a screenplay open it in this STET,
// for a portable copy or when the box was unticked while installing.
//
// Windows: the same per-user registry keys as the installer (scripts/installer/STET.iss), no
// administrator needed. If someone once picked another app with "Always", Windows keeps that
// choice (UserChoice) and no program may change it: the result says so, and how to change it.
// Mac: STET.app declares .stet files (scripts/build-mac.js); registering it again with Launch
// Services makes it their app.

import { execFile } from 'node:child_process';
import path from 'node:path';

export const PROG_ID = 'STET.Screenplay';
const CLASSES = 'HKCU\\Software\\Classes';
const USER_CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.stet\\UserChoice';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** The `reg add` argument lists that link .stet files to `exe`. */
export function windowsCommands(exe) {
  const add = (key, name, value) => ['add', `${CLASSES}\\${key}`, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f'];
  return [
    add('.stet', null, PROG_ID),
    add('.stet\\OpenWithProgids', PROG_ID, ''),
    add(PROG_ID, null, 'STET Screenplay'),
    add(`${PROG_ID}\\DefaultIcon`, null, `${exe},0`),
    add(`${PROG_ID}\\shell\\open\\command`, null, `"${exe}" "%1"`),
  ];
}

/** The program Windows was told to always use for .stet files, from `reg query` output; '' if none. */
export function userChoice(output) {
  const m = /ProgId\s+REG_SZ\s+(.+)/i.exec(output || '');
  return m ? m[1].trim() : '';
}

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 15000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

/**
 * Link .stet files to this STET. Resolves { ok, message } or { ok: false, error }.
 * `exe` is the running STET.exe (the installed or portable one; patches run inside it).
 */
export async function linkFiles({ platform = process.platform, exe = process.execPath, exec = run } = {}) {
  try {
    if (platform === 'win32') {
      const { join } = path.win32;
      const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
      for (const args of windowsCommands(exe)) await exec(reg, args);
      // Explorer shows the new icon now rather than after the next sign-in.
      await exec(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe'), ['-show']).catch(() => {});
      const chosen = userChoice(await exec(reg, ['query', USER_CHOICE, '/v', 'ProgId']).catch(() => ''));
      if (chosen && chosen !== PROG_ID) {
        return { ok: true, message: 'STET is set up to open .stet files, but Windows was told earlier to always open them with another app, and only you can change that: right-click a .stet file, choose Open with > Choose another app, pick STET and tick "Always use this app".' };
      }
      return { ok: true, message: 'Double-clicking a .stet screenplay now opens it in STET.' };
    }
    if (platform === 'darwin') {
      const bundle = path.posix.resolve(path.posix.dirname(exe), '..', '..');
      if (!bundle.endsWith('.app')) return { ok: false, error: 'This copy of STET is not an app bundle, so it cannot be linked to .stet files.' };
      await exec(LSREGISTER, ['-f', bundle]);
      return { ok: true, message: 'STET is registered for .stet screenplays. If one still opens elsewhere, select it in the Finder, choose File > Get Info, pick STET under "Open with" and click Change All.' };
    }
    return { ok: false, error: 'Linking .stet files is done by your desktop on this system.' };
  } catch {
    return { ok: false, error: 'STET could not link .stet files. Nothing else was changed.' };
  }
}
