// Build STET for the Mac: STET.app for Apple silicon, in a disk image (STET-macOS.dmg)
// with the Applications folder beside it to drag it to.
//
//   node scripts/build-mac.js            -> the newest git tag vX.Y.Z
//   node scripts/build-mac.js v0.22.0    -> that tag
//
// Like build-exe.js, the tag is checked out into a temporary git worktree and packaged with
// the Electron version it pins, leaving out what is never run (scripts/package-tools.js).
// Output: dist/STET-vX.Y.Z-darwin-arm64/STET.app, and STET-macOS.dmg in STET_DMG_OUT (the
// release workflow) or dist/. Signing and the disk image need a Mac (codesign, hdiutil);
// elsewhere only STET.app is made, which is enough to check what goes into it.
//
// STET.app is signed ad hoc, not with an Apple Developer ID: macOS asks once, the first
// time it is opened, whether to open it (README.md says how).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { APP_IGNORE, pruneModules, trimMacLocales } from './package-tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(ROOT, '.build-mac');
const ARCH = 'arm64';
const MAC = process.platform === 'darwin';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const run = (cmd, ...args) => execFileSync(cmd, args, { stdio: 'inherit' });

const tags = git('tag', '--list', 'v*.*.*', '--sort=version:refname').split('\n').filter(Boolean);
const tag = process.argv[2] || tags.at(-1);
if (!tags.includes(tag)) { console.error(`No such tag: ${tag}`); process.exit(1); }

const src = path.join(WORK, tag);
const out = path.join(DIST, `STET-${tag}-darwin-${ARCH}`);
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
try { git('worktree', 'prune'); } catch { /* nothing to prune */ }
git('worktree', 'add', '--detach', '--force', src, tag);
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  const electronVersion = (pkg.devDependencies?.electron || '').replace(/^[^\d]*/, '');
  const icns = path.join(src, 'build', 'icon.icns'); // versions before 0.22.0 had none
  console.log(`${tag}: installing runtime dependencies…`);
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: src, stdio: 'ignore' });
  console.log(`${tag}: packaging for the Mac (${ARCH}) with Electron ${electronVersion}…`);
  const [made] = await packager({
    dir: src,
    out: WORK,
    name: 'STET',
    executableName: 'STET',
    platform: 'darwin',
    arch: ARCH,
    electronVersion,
    appVersion: pkg.version,
    buildVersion: pkg.version,
    appBundleId: 'app.stet.screenwriting',
    appCategoryType: 'public.app-category.productivity',
    appCopyright: 'STET',
    darwinDarkModeSupport: true,
    ...(fs.existsSync(icns) ? { icon: icns } : {}),
    // Screenplays (.stet) open in STET from the Finder (main.js: open-file).
    extendInfo: {
      CFBundleDocumentTypes: [{ CFBundleTypeName: 'STET Screenplay', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Owner', LSItemContentTypes: ['app.stet.screenplay'], CFBundleTypeIconFile: 'electron.icns' }],
      UTExportedTypeDeclarations: [{ UTTypeIdentifier: 'app.stet.screenplay', UTTypeDescription: 'STET Screenplay', UTTypeConformsTo: ['public.data', 'public.content'], UTTypeTagSpecification: { 'public.filename-extension': ['stet'] } }],
      LSMinimumSystemVersion: '12.0',
    },
    prune: false, // node_modules holds production dependencies only (npm ci --omit=dev)
    overwrite: true,
    asar: true,
    ignore: APP_IGNORE,
    afterExtract: [({ buildPath }) => { trimMacLocales(buildPath); }],
    afterCopy: [({ buildPath }) => { pruneModules(buildPath); }],
    quiet: true,
  });
  fs.rmSync(out, { recursive: true, force: true });
  fs.renameSync(made, out);
  const appPath = path.join(out, 'STET.app');
  console.log(`${tag}: ${path.relative(ROOT, appPath)}`);

  if (MAC) {
    // Changing Electron's files (name, icon, the app) undid its signature; Apple silicon runs only signed code.
    run('codesign', '--force', '--deep', '--sign', '-', appPath);
    run('codesign', '--verify', '--deep', '--strict', appPath);
    const dmg = path.join(process.env.STET_DMG_OUT || DIST, 'STET-macOS.dmg');
    const stage = path.join(WORK, 'dmg');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    run('ditto', appPath, path.join(stage, 'STET.app')); // ditto keeps the framework links and the signature
    fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
    fs.rmSync(dmg, { force: true });
    // hdiutil now and then finds the new volume still busy: it is tried again.
    for (let i = 1; ; i++) {
      try { run('hdiutil', 'create', '-volname', 'STET', '-srcfolder', stage, '-fs', 'HFS+', '-format', 'ULMO', '-ov', dmg); break; }
      catch (e) { if (i === 3) throw e; console.log('hdiutil failed; trying again…'); execFileSync('sleep', ['5']); }
    }
    console.log(`${tag}: ${dmg} (${(fs.statSync(dmg).size / 1048576).toFixed(0)} MB)`);
  } else {
    console.log('Not on a Mac: STET.app is not signed, and no disk image is made.');
  }
} finally {
  git('worktree', 'remove', '--force', src);
  fs.rmSync(WORK, { recursive: true, force: true });
}
