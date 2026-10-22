// Checks on a real Windows or Mac machine that .stet screenplays open in STET with its icon
// (.github/workflows/file-links.yml). Each check opens a screenplay the way a double-click
// does (Windows) or asks the Finder which app it would use (Mac).
//
//   node scripts/check-file-links.mjs helper      Help > Open .stet Files with STET (src/main/assoc.js)
//   node scripts/check-file-links.mjs installer   STET-Setup.exe: the box ticked, unticked, and
//                                                 uninstalling (Windows; needs Inno Setup 6)
//
// It changes the file links of the user running it: meant for a throwaway CI machine.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkFiles, macSetDefault, macOpener, MAC_GET_DEFAULT, NOTIFY_AND_ASK, FILE_EXTS, BUNDLE_ID, UTI, PROG_ID } from '../src/main/assoc.js';
import { MAC_DOC_INFO } from './package-tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stet-links-'));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const same = (a, b) => path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();

// ---- Windows ------------------------------------------------------------------------------

const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ps = (script) => execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();

/** The icon Windows shows for .stet files ('' when none). */
function winIcon() {
  return ps(`Add-Type -Namespace W -Name A -MemberDefinition '[DllImport("shlwapi.dll", CharSet = CharSet.Unicode)] public static extern int AssocQueryString(int f, int s, string a, string e, System.Text.StringBuilder o, ref int n);'
    $n = 2048; $b = New-Object System.Text.StringBuilder 2048
    if ([W.A]::AssocQueryString(0, 15, '.stet', $null, $b, [ref]$n) -eq 0) { $b.ToString() } else { '' }`); // ASSOCSTR_DEFAULTICON
}
/** The command Windows says a double-click on a .stet file runs. */
const winOpener = () => ps(NOTIFY_AND_ASK);
const regHas = (key) => spawnSync('reg', ['query', key], { stdio: 'ignore' }).status === 0;
const KEY = `HKCU\\Software\\Classes\\${PROG_ID}`;
function winUnlink() {
  spawnSync('reg', ['delete', KEY, '/f'], { stdio: 'ignore' });
  spawnSync('reg', ['delete', 'HKCU\\Software\\Classes\\.stet', '/f'], { stdio: 'ignore' });
  spawnSync('reg', ['delete', FILE_EXTS, '/f'], { stdio: 'ignore' });
}
/**
 * Opens `doc` the way a double-click does (ShellExecute) and returns the program that ran.
 * The stand-in STET.exe is node.exe, which runs the screenplay as a script: it records itself.
 */
function winDoubleClick(dir) {
  const doc = path.join(dir, 'Pilot.stet'), mark = path.join(dir, 'opened-by.txt');
  fs.rmSync(mark, { force: true });
  fs.writeFileSync(doc, `require('fs').writeFileSync(${JSON.stringify(mark)}, process.execPath)`);
  try { ps(`Start-Process -FilePath '${doc.replace(/'/g, "''")}'`); } catch { return ''; } // no program for .stet files
  for (const end = Date.now() + 20000; !fs.existsSync(mark) && Date.now() < end;) spawnSync(PS, ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 200']);
  spawnSync(PS, ['-NoProfile', '-Command', 'Stop-Process -Name OpenWith -Force -ErrorAction SilentlyContinue']); // Windows asked instead
  return fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : '';
}

// A stand-in STET.exe with an icon of its own: a copy of node.exe.
function fakeExe(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, 'STET.exe');
  fs.copyFileSync(process.execPath, exe);
  return exe;
}

async function winHelper() {
  winUnlink();
  check(!regHas(KEY) && !winDoubleClick(tmp), 'before: nothing opens .stet files');
  const exe = fakeExe(path.join(tmp, 'Portable Folder'));
  const r = await linkFiles({ platform: 'win32', exe, spawnDetached: () => {} });
  check(r.ok && /now opens it in STET/.test(r.message), `Help > Open .stet Files: ${r.message || r.error}`);
  check(same(winDoubleClick(tmp), exe), 'a double-click starts this STET.exe');
  const icon = winIcon();
  check(icon.toLowerCase() === `${exe},0`.toLowerCase(), `.stet files show STET's icon (${icon})`);
  const cmd = execFileSync('reg', ['query', `${KEY}\\shell\\open\\command`, '/ve'], { encoding: 'utf8' });
  check(cmd.includes(`"${exe}" "%1"`), 'the file is passed to STET, quoted (a folder name with spaces)');
  // Linking again (another copy of STET) moves the link there.
  const exe2 = fakeExe(path.join(tmp, 'Other'));
  await linkFiles({ platform: 'win32', exe: exe2 });
  check(same(winDoubleClick(tmp), exe2), 'linking again from another copy points the files there');
  winUnlink();
  await winRemembered(exe);
}

// What Explorer remembers about .stet files from earlier, which made Windows ask "How do you
// want to open this file?" (or open another app) although STET was registered. Each is set
// up the way Explorer leaves it, then Help > Open .stet Files must still make a double-click
// start STET.
const REMEMBERED = {
  'apps tried once (Open with)': [
    ['add', `${FILE_EXTS}\\OpenWithList`, '/v', 'a', '/t', 'REG_SZ', '/d', 'notepad.exe', '/f'],
    ['add', `${FILE_EXTS}\\OpenWithList`, '/v', 'MRUList', '/t', 'REG_SZ', '/d', 'a', '/f'],
    ['add', `${FILE_EXTS}\\OpenWithProgids`, '/v', 'txtfile', '/t', 'REG_NONE', '/f'],
  ],
  'an "Always" choice of another app (UserChoice)': [
    ['add', `${FILE_EXTS}\\UserChoice`, '/v', 'ProgId', '/t', 'REG_SZ', '/d', 'txtfile', '/f'],
    ['add', `${FILE_EXTS}\\UserChoice`, '/v', 'Hash', '/t', 'REG_SZ', '/d', 'kZ8m1Xx2Y0Q=', '/f'],
  ],
  'an "Always" choice of STET from an older copy (UserChoice)': [
    ['add', `${FILE_EXTS}\\UserChoice`, '/v', 'ProgId', '/t', 'REG_SZ', '/d', 'Applications\\STET.exe', '/f'],
    ['add', `${FILE_EXTS}\\UserChoice`, '/v', 'Hash', '/t', 'REG_SZ', '/d', 'kZ8m1Xx2Y0Q=', '/f'],
  ],
  'the newer Windows 11 choice (UserChoiceLatest)': [
    ['add', `${FILE_EXTS}\\UserChoiceLatest`, '/v', 'ProgId', '/t', 'REG_SZ', '/d', 'txtfile', '/f'],
    ['add', `${FILE_EXTS}\\UserChoiceLatest`, '/v', 'Hash', '/t', 'REG_SZ', '/d', 'kZ8m1Xx2Y0Q=', '/f'],
  ],
};
// Explorer locks an "Always" choice: the user may not change its values, only delete it.
const LOCK = (key) => `$ErrorActionPreference = 'Stop'; $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key.replace(/^HKCU\\/, '')}', [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [System.Security.AccessControl.RegistryRights]::ChangePermissions -bor [System.Security.AccessControl.RegistryRights]::ReadKey)
$a = $k.GetAccessControl(); $a.AddAccessRule((New-Object System.Security.AccessControl.RegistryAccessRule([System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'SetValue', 'Deny'))); $k.SetAccessControl($a)`;

async function winRemembered(exe) {
  for (const [what, adds] of Object.entries(REMEMBERED)) {
    winUnlink();
    await linkFiles({ platform: 'win32', exe, spawnDetached: () => {} }); // linked once before
    for (const args of adds) {
      const r = spawnSync('reg', args, { encoding: 'utf8' });
      if (r.status) console.log(`      (reg ${args.slice(0, 4).join(' ')}: ${(r.stderr || '').trim()})`);
    }
    for (const k of new Set(adds.map((a) => a[1]).filter((k) => /UserChoice/.test(k)))) {
      try { ps(LOCK(k)); } catch (e) { console.log(`      (locking ${k}: ${String(e.stderr || e).trim().split('\n')[0]})`); }
    }
    const kept = spawnSync('reg', ['query', FILE_EXTS, '/s'], { encoding: 'utf8' }).stdout || '';
    console.log(`      with ${what}, Windows would run: ${winOpener()}\n${kept.trim().split(/\r?\n/).map((l) => '        ' + l).join('\n')}`);
    const r = await linkFiles({ platform: 'win32', exe, spawnDetached: () => {} });
    check(r.ok && /now opens it in STET/.test(r.message), `${what}: Help > Open .stet Files: ${r.message || r.error}`);
    check(same(winDoubleClick(tmp), exe), `${what}: then a double-click starts this STET.exe (${winOpener()})`);
  }
  winUnlink();
}

async function winInstaller() {
  const iscc = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe');
  const files = path.join(tmp, 'app');
  fakeExe(files);
  execFileSync(iscc, ['/Q', '/DAppVersion=0.0.1', `/DAppFiles=${files}`, `/O${tmp}`, path.join(ROOT, 'scripts', 'installer', 'STET.iss')], { stdio: 'inherit' });
  const setup = path.join(tmp, 'STET-Setup.exe');
  const installed = path.join(process.env.LOCALAPPDATA, 'Programs', 'STET', 'STET.exe');
  const install = (...args) => execFileSync(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ...args], { stdio: 'inherit' });
  const uninstall = () => {
    execFileSync(path.join(path.dirname(installed), 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { stdio: 'inherit' });
    // The uninstaller runs on from a copy of itself: wait until it has finished.
    const end = Date.now() + 120000;
    while (fs.existsSync(installed) && Date.now() < end) spawnSync(PS, ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']);
    spawnSync(PS, ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2']);
  };
  winUnlink();
  for (const args of REMEMBERED['an "Always" choice of another app (UserChoice)']) execFileSync('reg', args, { stdio: 'ignore' });
  ps(LOCK(`${FILE_EXTS}\\UserChoice`));

  install(); // the box as it comes: ticked (and Explorer remembered another app)
  check(same(winDoubleClick(tmp), installed), 'installer, box ticked: a double-click starts the installed STET');
  const icon = winIcon();
  check(icon.toLowerCase() === `${installed},0`.toLowerCase(), `installer: .stet files show STET's icon (${icon})`);
  uninstall();
  check(!fs.existsSync(installed), 'uninstalled');
  check(!regHas(KEY) && !winDoubleClick(tmp), 'uninstalling removes the link');
  check(!regHas('HKCU\\Software\\STET\\Capabilities'), 'uninstalling removes STET from Settings > Default apps');

  install('/MERGETASKS=!assoc'); // the box unticked
  check(!regHas(KEY) && !winDoubleClick(tmp), 'installer, box unticked: .stet files are left alone');
  await linkFiles({ platform: 'win32', exe: installed }); // Help > Open .stet Files, later
  check(same(winDoubleClick(tmp), installed), 'then Help > Open .stet Files links them to the installed STET');
  uninstall();
  check(!regHas(KEY) && !winDoubleClick(tmp), 'uninstalling removes a link made from the Help menu too');
}

// ---- Mac ----------------------------------------------------------------------------------

const jxa = (code) => execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', code], { encoding: 'utf8' }).trim();
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function plistValue(v, ind) {
  const pad = '  '.repeat(ind);
  if (Array.isArray(v)) return `<array>\n${v.map((x) => pad + '  ' + plistValue(x, ind + 1)).join('\n')}\n${pad}</array>`;
  if (typeof v === 'object') return `<dict>\n${Object.entries(v).map(([k, x]) => `${pad}  <key>${k}</key>\n${pad}  ${plistValue(x, ind + 1)}`).join('\n')}\n${pad}</dict>`;
  return `<string>${v}</string>`;
}

/** A minimal app bundle declaring .stet files as STET.app does (MAC_DOC_INFO). */
function fakeApp(name, id, info) {
  const app = path.join(tmp, name + '.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'build', 'icon.icns'), path.join(app, 'Contents', 'Resources', 'electron.icns'));
  const exe = path.join(app, 'Contents', 'MacOS', name);
  fs.copyFileSync('/usr/bin/true', exe); // a real program, signed below like STET.app (ad hoc)
  fs.chmodSync(exe, 0o755);
  const plist = { CFBundleIdentifier: id, CFBundleName: name, CFBundleExecutable: name, CFBundlePackageType: 'APPL', CFBundleIconFile: 'electron.icns', ...info };
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(plist, 0)}\n</plist>\n`);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  execFileSync(LSREGISTER, ['-f', app]);
  return { app, exe };
}

/** The app the Finder would open `file` with. */
const opener = (file) => jxa(macOpener(file));
/** What Launch Services knows about .stet files, shown when a check fails. */
function macDump() {
  const dump = spawnSync('/bin/sh', ['-c', `${LSREGISTER} -dump | grep -i -B3 -A3 'stet' | head -80`], { encoding: 'utf8' }).stdout;
  console.log(dump.split('\n').map((l) => '        ' + l).join('\n'));
}

async function macHelper() {
  const doc = path.join(tmp, 'Pilot.stet');
  fs.writeFileSync(doc, '');
  // Another app that also claims .stet files, and is their default for now.
  const other = fakeApp('Other', 'com.example.other', { CFBundleDocumentTypes: [{ CFBundleTypeName: 'Screenplay', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Owner', LSItemContentTypes: [UTI] }] });
  const stet = fakeApp('STET', BUNDLE_ID, MAC_DOC_INFO);
  const set = jxa(macSetDefault(other.app, UTI, 'com.example.other'));
  const before = jxa(MAC_GET_DEFAULT);
  check(before.toLowerCase() === 'com.example.other', `before: another app is the default for .stet files (${set}; ${before})`);
  console.log(`      before, the Finder opens a .stet file with: ${opener(doc)}`);
  const r = await linkFiles({ platform: 'darwin', exe: stet.exe });
  check(r.ok && /now opens it in STET/.test(r.message), `Help > Open .stet Files: ${r.message || r.error}`);
  const now = jxa(MAC_GET_DEFAULT);
  check(now.toLowerCase() === BUNDLE_ID, `STET is the default app for STET Screenplays (${now})`);
  const by = opener(doc);
  check(by && same(fs.realpathSync(by), fs.realpathSync(stet.app)), `the Finder opens a .stet file with STET.app (${by})`);
  const kind = jxa(`ObjC.import('AppKit'); ObjC.unwrap($.NSWorkspace.sharedWorkspace.typeOfFileError(${JSON.stringify(doc)}, null))`);
  check(kind === UTI, `a .stet file is a STET Screenplay (${kind})`);
  check(fs.existsSync(path.join(other.app, 'Contents')), 'the other app is still there, only no longer the default');
  if (failed) macDump();
}

// --------------------------------------------------------------------------------------------

const what = process.argv[2];
try {
  if (what === 'helper') await (WIN ? winHelper() : macHelper());
  else if (what === 'installer' && WIN) await winInstaller();
  else { console.error('usage: node scripts/check-file-links.mjs helper|installer (installer: Windows only)'); process.exit(2); }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
