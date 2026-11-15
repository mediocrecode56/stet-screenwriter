# STET: bible

Last verified: 2026-11-15.

## What it is
Free screenplay editor for Windows and macOS (Electron). It formats as you type and saves as you go.

## Rules (never break)
- The owner decides when a release happens. Never raise `version` in `package.json` or push a tag unasked: a push to `main` that raises it publishes automatically (`.github/workflows/release.yml`).
- Tests must pass on Windows and macOS: no platform-specific paths in assertions. App tests wait with `app.until`, never a fixed sleep, and drive the app through `test/app/harness.js`.
- New behaviour gets a unit test in `test/unit`. A workflow a release must not break gets a step in `test/app/smoke.app.js`.
- Read `docs/DESIGN_DIRECTION.md` before UI work, and add the owner's direction to it.
- Fetch before release work. Local `main` can be behind `origin/main`: inspect the divergence before any fast-forward, and never reset or pull over local commits.

## Quirks
- `web/` is a separate ALPHA browser project with its own README and tests. The desktop never depends on it, and browser needs never go into `src/`. After a change to `src/core` or the shared renderer, run `npm test` in `web/`. It publishes through `web.yml`.
- Only the newest GitHub release is kept. Tags stay.
- A release needs all four assets: `STET-Windows.zip`, `STET-Setup.exe`, `STET-macOS.dmg`, `STET-Patch-electron-<version>.zip`. The Mac DMG can lag a release by design.

## Build and test
- `npm run quick` (about 10 s) before any push. `npm run e2e` (about 25 s) before a version.

## Release
- Version: `package.json` `version`. `CHANGELOG.md` needs a section for it (`scripts/release-notes.js`). The tag `vX.Y.Z` must equal it.
- Automatic: a push to `main` that raises the version, a pushed tag, or manual "Run workflow". The Windows job publishes; the Mac job adds the DMG when a runner is free. Watch the run; if it fails, fix the cause and push (each push retries).
- Publish: `mediocrecode56/stet-screenwriter`. The owner decides.
- Verify: all four assets are present and the notes match the CHANGELOG section.
- Page: the README's Download buttons link to `releases/latest/download/<fixed asset name>`, so asset names never change. CHANGELOG.md is newest first, with `## X.Y.Z · D Mon YYYY` headings and FEATURES / BUGS sections. A release's notes are that section.
- Rollback: a new patch version. Never reuse a version number, move or delete tags.

## Look here first
- Also: `.github/workflows/release.yml` (the release automation), `docs/DESIGN_DIRECTION.md` (design decisions).
