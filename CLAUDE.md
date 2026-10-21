# Working on STET

- Never release a new version unless the owner says so. A push to main that raises
  `version` in package.json publishes a release automatically
  (.github/workflows/release.yml), so don't raise the version or push a tag without
  being asked. Other changes can go to main as usual.
- Only the newest release is kept on GitHub. After a release, run the "Clean up
  releases" workflow (.github/workflows/cleanup-releases.yml); it deletes the older
  releases and leaves their tags.
