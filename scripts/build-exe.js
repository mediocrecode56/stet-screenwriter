// Build a Windows STET.exe for released versions.
//
//   npm run exe            -> every git tag vX.Y.Z that has no build yet
//   npm run exe -- v0.2.0  -> just that tag (rebuilds it)
//   npm run exe -- --all   -> rebuild every tag
//
// Each tag is checked out into a temporary git worktree (your working tree is
// never touched) and packaged with the Electron version that tag pins.
// Output: dist/STET-vX.Y.Z-win32-x64/STET.exe (one folder per version, never overwritten
// unless rebuilt), and DocumentsSTETSTET.exe: the newest version as a single file.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
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
const rebuiltTags = new Set();
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
    rebuiltTags.add(tag);
  } finally {
    git('worktree', 'remove', '--force', src);
  }
}
console.log(built ? `Built ${built} version(s).` : 'Nothing to build.');
const newest = tags[tags.length - 1];
try {
  if (newest) await updateMainExe(newest, rebuiltTags.has(newest));
} catch (e) {
  console.error(`STET.exe in Documents\\STET was NOT updated: ${e.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(WORK, { recursive: true, force: true });
}
// ---- the unversioned STET.exe in Documents\STET ---------------------------------------
// Always the newest version that built successfully: a single self-contained file
// (scripts/launcher/Launcher.cs with the packaged app embedded), compiled with the C#
// compiler that ships with Windows. It replaces the previous one only after it has
// been built and checked, so a failed build never removes a working STET.exe.

function ps(cmd) { return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' }).trim(); }

async function updateMainExe(tag, rebuilt) {
  const version = tag.replace(/^v/, '');
  const build = path.join(DIST, `STET-${tag}-win32-x64`);
  if (!fs.existsSync(path.join(build, 'STET.exe'))) throw new Error(`the newest version (${tag}) has no successful build in dist/`);
  // STET_EXE_DIR (set by the release workflow) puts it elsewhere; otherwise Documents\STET.
  let destDir = process.env.STET_EXE_DIR;
  if (!destDir) {
    const docs = ps("[Environment]::GetFolderPath('MyDocuments')");
    if (!docs) throw new Error('could not find the Documents folder');
    destDir = path.join(docs, 'STET');
  }
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'STET.exe');
  const current = fs.existsSync(dest) ? ps(`(Get-Item -LiteralPath '${dest.replace(/'/g, "''")}').VersionInfo.ProductVersion`) : '';
  if (!rebuilt && current === version) { console.log(`STET.exe in ${destDir} is already ${tag}.`); return; }

  const csc = path.join(process.env.WINDIR || 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) throw new Error(`the C# compiler that ships with Windows was not found at ${csc}`);
  const work = path.join(WORK, 'main-exe');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  console.log(`STET.exe: packing ${tag} into one file…`);
  const zip = path.join(work, 'app.zip');
  ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${build.replace(/'/g, "''")}', '${zip.replace(/'/g, "''")}', [IO.Compression.CompressionLevel]::Optimal, $false)`);
  const stamp = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex').slice(0, 10);
  const cs = fs.readFileSync(path.join(ROOT, 'scripts', 'launcher', 'Launcher.cs'), 'utf8')
    .replaceAll('{{VERSION4}}', `${version.split('-')[0]}.0`).replaceAll('{{VERSION}}', version).replaceAll('{{STAMP}}', stamp);
  fs.writeFileSync(path.join(work, 'Launcher.cs'), cs);
  const out = path.join(work, 'STET.exe');
  const ico = path.join(ROOT, 'build', 'icon.ico');
  try {
    execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', `/out:${out}`, `/resource:${zip},app.zip`,
      ...(fs.existsSync(ico) ? [`/win32icon:${ico}`] : []),
      '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
      path.join(work, 'Launcher.cs')], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { throw new Error('compiling the launcher failed:\n' + (e.stdout || '') + (e.stderr || '')); }
  // Check it before it replaces anything.
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  if (size < fs.statSync(zip).size) throw new Error('the single-file STET.exe came out incomplete');
  const built = ps(`(Get-Item -LiteralPath '${out.replace(/'/g, "''")}').VersionInfo.ProductVersion`);
  if (built !== version) throw new Error(`the single-file STET.exe reports version "${built}", expected ${version}`);

  // Swap in: copy next to the target, then rename. A running STET.exe can be
  // renamed but not overwritten, so the old one is moved aside first.
  const next = dest + '.new', old = dest + '.old';
  fs.rmSync(next, { force: true });
  try { fs.rmSync(old, { force: true }); } catch { /* still running from an earlier swap */ }
  fs.copyFileSync(out, next);
  if (fs.existsSync(dest)) {
    try { fs.renameSync(dest, old); } catch (e) { fs.rmSync(next, { force: true }); throw new Error(`could not replace ${dest} (${e.code || e.message}). Close STET and run "npm run exe" again; the previous STET.exe is unchanged.`); }
  }
  fs.renameSync(next, dest);
  try { fs.rmSync(old, { force: true }); } catch { /* the old one is running; removed next time */ }
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`STET.exe: ${dest} is now ${tag} (${(fs.statSync(dest).size / 1048576).toFixed(0)} MB, one file).`);
}

