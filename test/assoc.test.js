import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsCommands, windowsExe, userChoice, linkFiles, PROG_ID, BUNDLE_ID } from '../src/main/assoc.js';

const EXE = 'C:\\Users\\Ann\\STET\\STET.exe';

test('Windows: the same per-user keys as the installer, pointing at this STET.exe', () => {
  const cmds = windowsCommands(EXE);
  assert.deepEqual(cmds[0], ['add', 'HKCU\\Software\\Classes\\.stet', '/ve', '/t', 'REG_SZ', '/d', PROG_ID, '/f']);
  assert.deepEqual(cmds[1].slice(1, 4), ['HKCU\\Software\\Classes\\.stet\\OpenWithProgids', '/v', PROG_ID]);
  assert.equal(cmds[3][6], EXE + ',0');
  assert.deepEqual(cmds[4].slice(1, 3), ['HKCU\\Software\\Classes\\STET.Screenplay\\shell\\open\\command', '/ve']);
  assert.equal(cmds[4][6], `"${EXE}" "%1"`);
});

test('Windows: the portable STET.exe is linked, not the copy its launcher runs', () => {
  assert.equal(windowsExe({ STET_PORTABLE_EXE: 'D:\\Tools\\STET.exe' }, 'C:\\Users\\Ann\\AppData\\Local\\STET\\runtime\\0.23.0-1\\STET.exe'), 'D:\\Tools\\STET.exe');
  assert.equal(windowsExe({}, EXE), EXE);
  assert.equal(windowsExe({ STET_PORTABLE_EXE: 'nonsense' }, EXE), EXE);
});

test('Windows: linking writes the keys, refreshes Explorer, and reports success', async () => {
  const calls = [];
  const r = await linkFiles({ platform: 'win32', exe: EXE, exec: async (f, a) => { calls.push([f, a]); return ''; } });
  assert.equal(r.ok, true);
  assert.match(r.message, /now opens it in STET/);
  assert.equal(calls.filter(([, a]) => a[0] === 'add').length, 5);
  assert.ok(calls.some(([f, a]) => /powershell\.exe$/i.test(f) && /SHChangeNotify/.test(a.at(-1))));
});

test('Windows: an earlier "Always" choice opens Windows\' own Open with window', async () => {
  assert.equal(userChoice('\r\nHKEY_CURRENT_USER\\...\\UserChoice\r\n    ProgId    REG_SZ    Applications\\notepad.exe\r\n'), 'Applications\\notepad.exe');
  assert.equal(userChoice(''), '');
  const spawned = [];
  const exec = async (_f, args) => (args[0] === 'query' ? '    ProgId    REG_SZ    Applications\\notepad.exe' : '');
  const r = await linkFiles({ platform: 'win32', exe: EXE, file: 'C:\\Scripts\\Pilot.stet', exec, spawnDetached: (f, a) => spawned.push([f, a]) });
  assert.equal(r.ok, true);
  assert.match(r.message, /Always use this app/);
  assert.match(spawned[0][0], /rundll32\.exe$/i);
  assert.deepEqual(spawned[0][1], ['shell32.dll,OpenAs_RunDLL', 'C:\\Scripts\\Pilot.stet']);
  // STET's own choice is not a problem
  const mine = await linkFiles({ platform: 'win32', exe: EXE, exec: async (_f, a) => (a[0] === 'query' ? `ProgId    REG_SZ    ${PROG_ID}` : ''), spawnDetached: () => assert.fail('no window') });
  assert.match(mine.message, /now opens it in STET/);
  const failed = await linkFiles({ platform: 'win32', exe: EXE, exec: async () => { throw new Error('denied'); } });
  assert.equal(failed.ok, false);
});

test('Mac: STET.app is registered with Launch Services and made the default', async () => {
  const calls = [];
  const exec = async (f, a) => { calls.push([f, a]); return a.at(-1).includes('URLForApplicationToOpenContentType') ? BUNDLE_ID + '\n' : ''; };
  const r = await linkFiles({ platform: 'darwin', exe: '/Applications/STET.app/Contents/MacOS/STET', exec });
  assert.equal(r.ok, true);
  assert.match(r.message, /now opens it in STET/);
  assert.match(calls[0][0], /lsregister$/);
  assert.deepEqual(calls[0][1], ['-f', '/Applications/STET.app']);
  assert.match(calls[1][1].at(-1), /setDefaultApplicationAtURLToOpenContentType.*"\/Applications\/STET\.app"/s);
  const kept = await linkFiles({ platform: 'darwin', exe: '/Applications/STET.app/Contents/MacOS/STET', exec: async () => 'com.other.app' });
  assert.match(kept.message, /Change All/);
  assert.equal((await linkFiles({ platform: 'darwin', exe: '/opt/electron/electron', exec: async () => '' })).ok, false);
  assert.equal((await linkFiles({ platform: 'linux', exe: '/x', exec: async () => '' })).ok, false);
});
