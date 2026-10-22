# Working on STET

- Never release a new version unless the owner says so. A push to main that raises
  `version` in package.json publishes a release automatically
  (.github/workflows/release.yml), so don't raise the version or push a tag without
  being asked. Other changes can go to main as usual.
- Only the newest release is kept on GitHub. After a release, run the "Clean up
  releases" workflow (.github/workflows/cleanup-releases.yml); it deletes the older
  releases and leaves their tags.
- A release is only done when its run of the Release workflow has succeeded and the
  release on GitHub has all four files (STET-Windows.zip, STET-Setup.exe, STET-macOS.dmg,
  STET-Patch-electron-*.zip). Watch the run to the end; if it fails, fix the cause and
  push to main (every push retries an unreleased version), then clean up releases.
- Run the unit tests and the quick e2e tests before pushing a version; a test must pass
  on Windows and macOS too (no platform-specific paths in assertions).
