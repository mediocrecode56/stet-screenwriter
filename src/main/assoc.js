// Help > Open .stet Files with STET: makes double-clicking a screenplay open it in this STET,
// with STET's icon, for a portable copy or when the box was unticked while installing.
//
// Windows: the same per-user registry keys as the installer (scripts/installer/STET.iss), no
// administrator needed: the file type, and STET registered as an app that opens it (so it is
// listed in Settings > Default apps). Like other programs, STET then clears what Explorer
// remembers about .stet files for this user (an earlier "Open with" choice, or apps tried
// once), which otherwise wins over the registration or makes Windows ask "How do you want to
// open this file?" again. Explorer is told that file types changed, so the icon shows at
// once, and Windows is asked which program a double-click now starts. Only if that is still
// not this STET (Windows kept a choice it protects) is Windows' own "Open with" window
// opened, with STET in it, for the person to confirm once.
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
const CAPABILITIES = 'Software\\STET\\Capabilities';
// What Explorer remembers per user about .stet files: UserChoice and UserChoiceLatest (an
// "Always" choice), OpenWithList and OpenWithProgids (apps used once).
export const FILE_EXTS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.stet';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** The `reg add` argument lists that link .stet files to `exe`. */
export function windowsCommands(exe) {
  const add = (key, name, value) => ['add', key, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f'];
  return [
    add(`${CLASSES}\\.stet`, null, PROG_ID),
    add(`${CLASSES}\\.stet\\OpenWithProgids`, PROG_ID, ''),
    add(`${CLASSES}\\${PROG_ID}`, null, 'STET Screenplay'),
    add(`${CLASSES}\\${PROG_ID}\\DefaultIcon`, null, `${exe},0`),
    add(`${CLASSES}\\${PROG_ID}\\shell\\open\\command`, null, `"${exe}" "%1"`),
    add(`HKCU\\${CAPABILITIES}`, 'ApplicationName', 'STET'),
    add(`HKCU\\${CAPABILITIES}`, 'ApplicationDescription', 'Screenwriting'),
    add(`HKCU\\${CAPABILITIES}\\FileAssociations`, '.stet', PROG_ID),
    add('HKCU\\Software\\RegisteredApplications', 'STET', CAPABILITIES),
  ];
}

/** Whether Windows' answer `opener` (the program a double-click starts) is `exe`. */
export function opensWith(opener, exe) {
  return !!opener && path.win32.resolve(opener.trim()).toLowerCase() === path.win32.resolve(exe).toLowerCase();
}

/**
 * The STET.exe a double-click should start: the portable single-file STET.exe (its launcher
 * says where it is), else the running one (installed; patches run inside it).
 */
export function windowsExe(env = process.env, execPath = process.execPath) {
  const portable = env.STET_PORTABLE_EXE;
  return portable && /\.exe$/i.test(portable) ? portable : execPath;
}

// Tells Explorer that file types changed (SHChangeNotify), so the new icon shows now, then
// prints the program a double-click on a .stet file starts (AssocQueryString, ASSOCSTR_EXECUTABLE):
// Windows' own answer, which counts every choice it keeps ('OpenWith.exe' when it would ask).
export const NOTIFY_AND_ASK = `Add-Type -Namespace W -Name S -MemberDefinition '
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, System.IntPtr a, System.IntPtr b);
[DllImport("shlwapi.dll", CharSet = CharSet.Unicode)] public static extern int AssocQueryString(int f, int s, string a, string e, System.Text.StringBuilder o, ref int n);'
[W.S]::SHChangeNotify(0x08000000, 0, [System.IntPtr]::Zero, [System.IntPtr]::Zero)
$n = 1024; $b = New-Object System.Text.StringBuilder 1024
if ([W.S]::AssocQueryString(0, 2, '.stet', $null, $b, [ref]$n) -eq 0) { $b.ToString() } else { '-' }`;

// JavaScript for Automation: make the app at `app` the default for STET Screenplays, and read
// which app is. NSWorkspace's way (macOS 12+) first, Launch Services' older call if that fails.
// UTType is looked up by name: its framework can't be imported into JavaScript for Automation.
const JXA_TYPE = `ObjC.import('AppKit'); var T = $.NSClassFromString($('UTType'));`;
export const macSetDefault = (app, uti = UTI, id = BUNDLE_ID) => `${JXA_TYPE}
var done = false, err = '';
try {
  $.NSWorkspace.sharedWorkspace.setDefaultApplicationAtURLToOpenContentTypeCompletionHandler($.NSURL.fileURLWithPath(${JSON.stringify(app)}), T.typeWithIdentifier(${JSON.stringify(uti)}), function (e) { err = e && !e.isNil() ? ObjC.unwrap(e.localizedDescription) : ''; done = true; });
  for (var i = 0; i < 150 && !done; i++) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
} catch (e) { err = String(e); }
if (!done || err) {
  ObjC.bindFunction('LSSetDefaultRoleHandlerForContentType', ['int', ['id', 'unsigned int', 'id']]);
  err += ' / LS ' + $.LSSetDefaultRoleHandlerForContentType($(${JSON.stringify(uti)}), 0xFFFFFFFF, $(${JSON.stringify(id)}));
}
err || 'ok'`;
export const MAC_GET_DEFAULT = `${JXA_TYPE}
var u = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenContentType(T.typeWithIdentifier('${UTI}'));
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
      await exec(reg, ['delete', FILE_EXTS, '/f']).catch(() => {}); // nothing remembered: fine
      // null: PowerShell could not be asked, so the registration is trusted.
      const opener = await exec(path.win32.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', NOTIFY_AND_ASK]).catch(() => null);
      if (opener !== null && !opensWith(opener, exe)) {
        // Windows kept a choice no program may change: its own window lets the person pick STET.
        let target = file;
        if (!target) {
          target = path.join(os.tmpdir(), 'Screenplay.stet');
          await fs.writeFile(target, '').catch(() => {});
        }
        (spawnDetached || openAs)(path.win32.join(sys, 'rundll32.exe'), ['shell32.dll,OpenAs_RunDLL', target]);
        return { ok: true, message: 'Windows wants you to confirm this yourself, once. In the window Windows opened, choose STET and click "Always".' };
      }
      return { ok: true, message: 'Done. Double-clicking a .stet screenplay now opens it in STET, and screenplays show the STET icon.' };
    }
    if (platform === 'darwin') {
      exe = exe || process.execPath;
      const bundle = path.posix.resolve(path.posix.dirname(exe), '..', '..');
      if (!bundle.endsWith('.app')) return { ok: false, error: 'This copy of STET is not an app bundle, so it cannot be linked to .stet files.' };
      await exec(LSREGISTER, ['-f', bundle]);
      await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macSetDefault(bundle)]).catch(() => '');
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
