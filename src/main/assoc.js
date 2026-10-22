// Help > Open .stet Files with STET: makes double-clicking a screenplay open it in this STET,
// with STET's icon, for a portable copy or when the box was unticked while installing.
//
// Windows: the same per-user registry keys as the installer (scripts/installer/STET.iss), no
// administrator needed, then Explorer is told that file types changed so the icon shows at
// once. If someone once picked another app with "Always", Windows keeps that choice
// (UserChoice) and no program may change it: Windows' own "How do you want to open this
// file?" window is then opened, with STET in it, for the person to choose.
// Mac: STET.app declares .stet files (scripts/build-mac.js). It is registered again with
// Launch Services and made the default app for them.
// scripts/check-file-links.mjs checks all of this on real Windows and Mac machines.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PROG_ID = 'STET.Screenplay';
export const UTI = 'app.stet.screenplay';
export const BUNDLE_ID = 'app.stet.screenwriting';
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

/**
 * The STET.exe a double-click should start: the portable single-file STET.exe (its launcher
 * says where it is), else the running one (installed; patches run inside it).
 */
export function windowsExe(env = process.env, execPath = process.execPath) {
  const portable = env.STET_PORTABLE_EXE;
  return portable && /\.exe$/i.test(portable) ? portable : execPath;
}

// Tells Explorer that file types changed (SHChangeNotify), so the new icon shows now.
const NOTIFY = 'Add-Type -Namespace W -Name S -MemberDefinition \'[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, System.IntPtr a, System.IntPtr b);\'; [W.S]::SHChangeNotify(0x08000000, 0, [System.IntPtr]::Zero, [System.IntPtr]::Zero)';

// JavaScript for Automation (macOS 12+): make the app at `app` the default for STET Screenplays,
// and read which app is. The first prints 'ok' or why not.
export const macSetDefault = (app, uti = UTI) => `ObjC.import('AppKit'); ObjC.import('UniformTypeIdentifiers');
var done = false, err = '';
$.NSWorkspace.sharedWorkspace.setDefaultApplicationAtURLToOpenContentTypeCompletionHandler($.NSURL.fileURLWithPath(${JSON.stringify(app)}), $.UTType.typeWithIdentifier(${JSON.stringify(uti)}), function (e) { err = e && !e.isNil() ? ObjC.unwrap(e.localizedDescription) : ''; done = true; });
for (var i = 0; i < 150 && !done; i++) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
done ? (err || 'ok') : 'no answer'`;
export const MAC_GET_DEFAULT = `ObjC.import('AppKit'); ObjC.import('UniformTypeIdentifiers');
var u = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenContentType($.UTType.typeWithIdentifier('${UTI}'));
u.isNil() ? '' : ObjC.unwrap($.NSBundle.bundleWithURL(u).bundleIdentifier)`;

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 30000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

/**
 * Link .stet files to this STET. Resolves { ok, message } or { ok: false, error }.
 * `file`: a screenplay to show Windows' "Open with" window for, when one is needed.
 */
export async function linkFiles({ platform = process.platform, exe, file = null, exec = run, spawnDetached = null } = {}) {
  try {
    if (platform === 'win32') {
      exe = exe || windowsExe();
      const sys = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      const reg = path.win32.join(sys, 'reg.exe');
      for (const args of windowsCommands(exe)) await exec(reg, args);
      await exec(path.win32.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', NOTIFY]).catch(() => {});
      const chosen = userChoice(await exec(reg, ['query', USER_CHOICE, '/v', 'ProgId']).catch(() => ''));
      if (chosen && chosen !== PROG_ID) {
        // Windows keeps the earlier "Always" choice: its own window lets the person pick STET.
        let target = file;
        if (!target) {
          target = path.join(os.tmpdir(), 'Screenplay.stet');
          await fs.writeFile(target, '').catch(() => {});
        }
        (spawnDetached || openAs)(path.win32.join(sys, 'rundll32.exe'), ['shell32.dll,OpenAs_RunDLL', target]);
        return { ok: true, message: 'Windows was told earlier to open .stet files with another app, and only you can change that. In the window Windows opened, choose STET and tick "Always use this app".' };
      }
      return { ok: true, message: 'Done. Double-clicking a .stet screenplay now opens it in STET, and screenplays show the STET icon.' };
    }
    if (platform === 'darwin') {
      exe = exe || process.execPath;
      const bundle = path.posix.resolve(path.posix.dirname(exe), '..', '..');
      if (!bundle.endsWith('.app')) return { ok: false, error: 'This copy of STET is not an app bundle, so it cannot be linked to .stet files.' };
      await exec(LSREGISTER, ['-f', bundle]);
      await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macSetDefault(bundle)]);
      const now = (await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_GET_DEFAULT]).catch(() => '')).trim();
      if (now.toLowerCase() !== BUNDLE_ID) {
        return { ok: true, message: 'STET is registered for .stet screenplays, but macOS kept another app as their default. Select a .stet file in the Finder, choose File > Get Info, pick STET under "Open with" and click Change All.' };
      }
      return { ok: true, message: 'Done. Double-clicking a .stet screenplay now opens it in STET, and screenplays show the STET icon.' };
    }
    return { ok: false, error: 'On this system your desktop decides which app opens .stet files.' };
  } catch {
    return { ok: false, error: 'STET could not link .stet files. Nothing else was changed.' };
  }
}

function openAs(file, args) {
  spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}
