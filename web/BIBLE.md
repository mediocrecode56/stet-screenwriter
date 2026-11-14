# STET browser bible

- Independent browser project, versioned by this folder's `package.json`; desktop rules still apply from `../AGENTS.md` and `../CLAUDE.md`.
- Reads shared desktop core/renderer code; the desktop must never depend on `web/`. Fix browser incompatibilities here, not by adding browser conditions to desktop files.
- `build.mjs` follows imports and copies reached code to `dist/`. The browser has no runtime dependency installation step.
- File saves and IndexedDB drafts protect unsaved work; test with disposable documents. Read `docs/CLOUD.md` before changing cloud storage.
- A push to `main` touching web or selected shared files automatically deploys GitHub Pages, even without a desktop version bump.
