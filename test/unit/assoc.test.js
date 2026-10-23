import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsCommands, windowsExe, opensWith, linkFiles, FILE_EXTS, PROG_ID } from '../../src/main/assoc.js';

const EXE = 'C:\\Users\\Ann\\STET\\STET.exe';

test('Windows: the same per-user keys as the installer, pointing at this STET.exe', () => {
  const cmds = windowsCommands(EXE);
  assert.deepEqual(cmds[0], ['add', 'HKCU\\Software\\Classes\\.stet', '/ve', '/t', 'REG_SZ', '/d', PROG_ID, '/f']);
  assert.deepEqual(cmds[1].slice(1, 4), ['HKCU\\Software\\Classes\\.stet\\OpenWithProgids', '/v', PROG_ID]);
  assert.equal(cmds[3][6], EXE + ',0');
  assert.deepEqual(cmds[4].slice(1, 3), ['HKCU\\Software\\Classes\\STET.Screenplay\\shell\\open\\command', '/ve']);
  assert.equal(cmds[4][6], `"${EXE}" "%1"`);
  // registered as an app for .stet files, as Settings > Default apps lists them
  assert.deepEqual(cmds.at(-1).slice(1, 7), ['HKCU\\Software\\RegisteredApplications', '/v', 'STET', '/t', 'REG_SZ', '/d']);
  assert.ok(cmds.some((c) => c[1] === `HKCU\\${cmds.at(-1)[7]}\\FileAssociations` && c[3] === '.stet' && c[7] === PROG_ID));
});

test('Windows: the portable STET.exe is linked, not the copy its launcher runs', () => {
  assert.equal(windowsExe({ STET_PORTABLE_EXE: 'D:\\Tools\\STET.exe' }, 'C:\\Users\\Ann\\AppData\\Local\\STET\\runtime\\0.23.0-1\\STET.exe'), 'D:\\Tools\\STET.exe');
  assert.equal(windowsExe({}, EXE), EXE);
  assert.equal(windowsExe({ STET_PORTABLE_EXE: 'nonsense' }, EXE), EXE);
});

// The PowerShell step answers with the program a double-click starts.
const windows = (opener, calls = []) => async (f, a) => {
  calls.push([f, a]);
  if (/powershell\.exe$/i.test(f)) return opener + '\r\n';
  return '';
};

test('Windows: linking writes the keys, clears what Explorer remembered, and checks with Windows', async () => {
  const calls = [];
  const r = await linkFiles({ platform: 'win32', exe: EXE, exec: windows(`"${EXE.toLowerCase()}" "%1"`, calls), spawnDetached: () => assert.fail('no window') });
  assert.equal(r.ok, true);
  assert.match(r.message, /now opens it in STET/);
  assert.equal(calls.filter(([, a]) => a[0] === 'add').length, windowsCommands(EXE).length);
  const del = calls.findIndex(([, a]) => a[0] === 'delete');
  assert.deepEqual(calls[del][1], ['delete', FILE_EXTS, '/f']);
  const ask = calls.findIndex(([f]) => /powershell\.exe$/i.test(f));
  assert.ok(ask > del, 'Windows is asked after the old choices are gone');
  assert.match(calls[ask][1].at(-1), /SHChangeNotify[\s\S]*AssocQueryString/);
});

test('Windows: if Windows would still not start STET, its own Open with window opens', async () => {
  assert.equal(opensWith('"C:\\USERS\\ann\\stet\\STET.exe" "%1"\r\n', EXE), true);
  assert.equal(opensWith('C:\\Users\\Ann\\STET\\STET.exe %1', EXE), true);
  assert.equal(opensWith('C:\\Windows\\system32\\OpenWith.exe "%1"', EXE), false);
  assert.equal(opensWith('', EXE), false);
  for (const opener of ['C:\\Windows\\system32\\OpenWith.exe "%1"', '%SystemRoot%\\system32\\NOTEPAD.EXE %1', 'none 80070483']) {
    const spawned = [];
    const r = await linkFiles({ platform: 'win32', exe: EXE, file: 'C:\\Scripts\\Pilot.stet', exec: windows(opener), spawnDetached: (f, a) => spawned.push([f, a]) });
    assert.equal(r.ok, true);
    assert.match(r.message, /choose STET and click "Always"/);
    assert.match(spawned[0][0], /rundll32\.exe$/i);
    assert.deepEqual(spawned[0][1], ['shell32.dll,OpenAs_RunDLL', 'C:\\Scripts\\Pilot.stet']);
  }
  // Nothing remembered to delete, or PowerShell unavailable: the registration stands.
  const exec = async (f, a) => { if (a[0] === 'delete' || /powershell/i.test(f)) throw new Error('x'); return ''; };
  assert.match((await linkFiles({ platform: 'win32', exe: EXE, exec, spawnDetached: () => assert.fail('no window') })).message, /now opens it in STET/);
  const failed = await linkFiles({ platform: 'win32', exe: EXE, exec: async () => { throw new Error('denied'); } });
  assert.equal(failed.ok, false);
});

test('Mac: STET.app is registered with Launch Services and made the default', async () => {
  const calls = [];
  const exec = async (f, a) => { calls.push([f, a]); return a.at(-1).includes('URLForApplicationToOpenURL') ? '/Applications/STET.app\n' : ''; };
  const r = await linkFiles({ platform: 'darwin', exe: '/Applications/STET.app/Contents/MacOS/STET', exec });
  assert.equal(r.ok, true);
  assert.match(r.message, /now opens it in STET/);
  assert.match(calls[0][0], /lsregister$/);
  assert.deepEqual(calls[0][1], ['-f', '/Applications/STET.app']);
  assert.match(calls[1][1].at(-1), /LSSetDefaultRoleHandlerForContentType\(\$\("app\.stet\.screenplay"\), 0xFFFFFFFF, \$\("app\.stet\.screenwriting"\)\)/);
  assert.match(calls[1][1].at(-1), /setDefaultApplicationAtURLToOpenContentType.*"\/Applications\/STET\.app"/s);
  assert.match(calls[2][1].at(-1), /URLForApplicationToOpenURL/, 'then asks what the Finder would open a screenplay with');
  const kept = await linkFiles({ platform: 'darwin', exe: '/Applications/STET.app/Contents/MacOS/STET', exec: async () => '/Applications/TextEdit.app' });
  assert.match(kept.message, /Change All/);
  assert.equal((await linkFiles({ platform: 'darwin', exe: '/opt/electron/electron', exec: async () => '' })).ok, false);
  assert.equal((await linkFiles({ platform: 'linux', exe: '/x', exec: async () => '' })).ok, false);
});
