# Working on STET

- Never release a new version unless the owner says so. A push to main that raises
  `version` in package.json publishes a release automatically
  (.github/workflows/release.yml), so don't raise the version or push a tag without
  being asked. Other changes can go to main as usual.
- Only the newest release is kept on GitHub. The Release workflow deletes the older
  releases itself (their tags stay).
- A release is published by the Windows job and never waits for a Mac; the Mac job adds
  that version's STET-macOS.dmg when GitHub has a Mac free (until then the previous one
  stands in). It is done when the release has all four files (STET-Windows.zip,
  STET-Setup.exe, STET-macOS.dmg, STET-Patch-electron-*.zip). Watch the run; if it fails,
  fix the cause and push to main (every push retries an unreleased version).
- Run the unit tests and the quick e2e tests before pushing a version; a test must pass
  on Windows and macOS too (no platform-specific paths in assertions).
