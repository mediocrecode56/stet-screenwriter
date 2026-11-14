# Release pipeline: STET

Last release: v0.60.1 on `origin/main` (tag `v0.60.1`). Scripts reviewed: 2026-11-14.
Read `CLAUDE.md` too: the owner decides when a release happens.

## Version source

- `package.json` `"version"`. The release workflow requires that the tag `vX.Y.Z` equals this version and that
  `CHANGELOG.md` has a section for it (`scripts/release-notes.js`).
- Update `CHANGELOG.md` in the same commit.

## Pipeline (automatic, GitHub Actions)

`.github/workflows/release.yml` (named "Release") runs on:

- a push to `main` that raises `version` in `package.json`: tags it `vX.Y.Z`, builds and publishes;
- a pushed tag `vX.Y.Z`;
- manual "Run workflow" (empty box: the version in `package.json`). Running it for a released version replaces its files.

Steps: `npm ci`, `npm test`, the Windows build (`STET.exe`, installer, patch zip), then the Mac job builds
`STET-macOS.dmg` (`scripts/build-mac.js`) when a Mac runner is free. The Windows job publishes first with the previous
`STET-macOS.dmg`, so the download link never breaks, and deletes the older releases (tags stay).

Local checks before a push: `npm run quick` (about ten seconds) and, before a version, `npm run e2e` (about 25 seconds).
`web/` (browser version, ALPHA) publishes separately through `.github/workflows/web.yml`.

## Outputs

- GitHub release assets: `STET-Windows.zip`, `STET-Setup.exe`, `STET-macOS.dmg`, `STET-Patch-electron-<version>.zip`.
  A release is complete when all four are present.

## Publishing

- GitHub: `mediocrecode56/stet-screenwriter`, latest release only.
- Publishing is decided by the owner (see `CLAUDE.md`). Never raise `version` or push a tag without being asked.

## Verification

- Watch the run to the end. A failed run is retried by the next push to `main`; fix the cause, do not just retry.
- Check the release lists all four files and that the notes match the `CHANGELOG.md` section.

## Rollback

- Publish a new patch version. Do not move or delete tags.

## Pitfalls

- Local `main` may be behind cached `origin/main`. Fetch before release work; inspect status and divergence before a fast-forward. Preserve local edits/commits rather than resetting or blindly pulling.
- Mac DMG is built on a Mac runner, so a release can show a previous DMG for a while. That is expected.
