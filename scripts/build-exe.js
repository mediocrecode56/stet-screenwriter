// Build a Windows STET.exe for released versions.
//
//   npm run exe            -> every git tag vX.Y.Z that has no build yet
//   npm run exe -- v0.2.0  -> just that tag (rebuilds it)
//   npm run exe -- --all   -> rebuild every tag
//
// Each tag is checked out into a temporary git worktree (your working tree is
// never touched) and packaged with the Electron version that tag pins.
// Output: dist/STET-vX.Y.Z-win32-x64/STET.exe

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(ROOT, '.build');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const args = process.argv.slice(2);
const tags = git('tag', '--list', 'v*.*.*', '--sort=version:refname').split('\n').filter(Boolean);
const wanted = args.filter((a) => !a.startsWith('--'));
for (const t of wanted) if (!tags.includes(t)) { console.error(`No such tag: ${t}`); process.exit(1); }
const force = args.includes('--all') || wanted.length > 0;
const targets = wanted.length ? wanted : tags;

fs.mkdirSync(DIST, { recursive: true });
let built = 0;
for (const tag of targets) {
  const out = path.join(DIST, `STET-${tag}-win32-x64`);
  if (!force && fs.existsSync(path.join(out, 'STET.exe'))) { console.log(`${tag}: already built`); continue; }
  const src = path.join(WORK, tag);
  fs.rmSync(src, { recursive: true, force: true });
  try { git('worktree', 'prune'); } catch { /* nothing to prune */ }
  git('worktree', 'add', '--detach', '--force', src, tag);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    const electronVersion = (pkg.devDependencies?.electron || '').replace(/^[^\d]*/, '');
    // Each version keeps the icon it shipped with (versions before 0.3.0 had none).
    const ico = path.join(src, 'build', 'icon.ico');
    // Runtime dependencies (v0.4+: the Anthropic SDK) are installed into the worktree.
    if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
      console.log(`${tag}: installing runtime dependencies…`);
      execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: src, stdio: 'ignore', shell: process.platform === 'win32' });
    }
    console.log(`${tag}: packaging with Electron ${electronVersion}…`);
    const [made] = await packager({
      dir: src,
      out: WORK,
      name: 'STET',
      executableName: 'STET',
      platform: 'win32',
      arch: 'x64',
      electronVersion,
      appVersion: pkg.version,
      ...(fs.existsSync(ico) ? { icon: ico } : {}),
      win32metadata: { CompanyName: 'STET', ProductName: 'STET', FileDescription: 'STET screenwriting' },
      prune: false, // node_modules holds production dependencies only (npm ci --omit=dev)
      overwrite: true,
      asar: true,
      ignore: [/^\/(dist|bench|test|docs|scripts|\.perf|\.build)(\/|$)/, /^\/\.git/, /^\/build\/icon-\d+\.png$/],
      quiet: true,
    });
    fs.rmSync(out, { recursive: true, force: true });
    fs.renameSync(made, out);
    console.log(`${tag}: ${path.relative(ROOT, path.join(out, 'STET.exe'))}`);
    built++;
  } finally {
    git('worktree', 'remove', '--force', src);
  }
}
fs.rmSync(WORK, { recursive: true, force: true });
console.log(built ? `Built ${built} version(s).` : 'Nothing to build.');
