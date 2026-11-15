# STET browser: bible

Desktop rules in `../BIBLE.md` apply too. Last verified: 2026-11-14.

## What it is
Independent browser version of STET (ALPHA). Versioned by this folder's `package.json`. It reads the shared desktop core and renderer code.

## Rules (never break)
- The desktop must never depend on `web/`. Fix browser incompatibilities here, never by adding browser conditions to desktop files.
- Keep desktop/browser separation tests passing.
- Protect unsaved work: test file saves and IndexedDB drafts with disposable documents only. Read `docs/CLOUD.md` before changing cloud storage, and preserve users' drafts and cloud documents.

## Quirks
- `build.mjs` follows imports and copies the code it reaches into `dist/`. There is no runtime dependency installation step.
- A push to `main` that touches `web/` or selected shared files deploys GitHub Pages automatically, even without a desktop version bump.

## Build and test
- In `web/`: `npm test`, then `npm run build`. For browser review, `npm run serve` builds and serves port 8127.

## Release
- Version: this folder's `package.json`. Output `web/dist/` is not committed.
- Steps: commit intended changes → push only when authorized. `../.github/workflows/web.yml` tests, builds and deploys `web/dist` to GitHub Pages (needs Pages set to GitHub Actions).
- Verify: watch the Web workflow and check its reported URL with disposable `.stet` files. Check open, edit, save and any cloud path separately from the Node tests.
- No desktop installer, tag or GitHub Release is produced by this workflow.
- Rollback: revert the source commit and deploy through the same workflow.
