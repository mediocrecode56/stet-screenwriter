// Builds the site into web/dist: web/index.html and web.css, plus exactly the files the app imports,
// found by following its imports from web/src/app.js. They keep their paths from the repository's root
// (web/src/..., src/core/...), so no import is rewritten and web/dist is the code that is tested.
// The desktop's files are only ever read: nothing here writes outside web/dist.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WEB, '..');
const DIST = process.argv[2] ? path.resolve(process.argv[2]) : path.join(WEB, 'dist');
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g;

/** Every file reached from `entry`, by repository path. */
export function graph(entry, root = ROOT) {
  const seen = new Set(), todo = [path.resolve(root, entry)];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) todo.push(path.resolve(path.dirname(file), m[1]));
  }
  return [...seen].map((f) => path.relative(root, f).split(path.sep).join('/')).sort();
}

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  const copy = (from, to = from) => { const out = path.join(DIST, to); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(path.join(ROOT, from), out); };
  const files = graph('web/src/app.js');
  for (const f of files) copy(f);
  copy('web/index.html', 'index.html');
  copy('web/web.css', 'web.css');
  copy('src/renderer/style.css');
  copy('src/renderer/mark.svg');
  for (const f of fs.readdirSync(path.join(ROOT, 'src/fonts'))) copy(`src/fonts/${f}`);
  fs.writeFileSync(path.join(DIST, '.nojekyll'), ''); // (Pages serves the files as they are)
  console.log(`web/dist: ${files.length} modules`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
