# Project bible: STET

Read this before changing code. It lists quirks that are not obvious from the code. Last reviewed: 2026-11-14.

**What it is:** a free screenplay editor for Windows and macOS (Electron). It formats as you type and saves as you go.

## Quirks

- **A version bump on `main` publishes a release.** `.github/workflows/release.yml` tags and publishes whenever `package.json` `version` rises on `main`. The owner decides when that happens. Don't raise the version or push a tag unasked.
- **`web/` is a different project.** The browser version (ALPHA) has its own README and its own tests. The desktop never depends on it. Browser needs never go into `src/`; the `web/test` tests fail if they do. A change to `src/core` or the shared renderer can break it, so run `npm test` in `web/` after one.
- **Tests must pass on both systems.** No platform-specific paths in assertions. The app tests wait with `app.until`, never a fixed sleep, and drive the real app through `test/app/harness.js`.
- **Design decisions are recorded.** Read `docs/DESIGN_DIRECTION.md` before UI work. Add to it when the owner gives feedback that sets a direction, because it is the reference for choices a request leaves open.
- **Only the newest release is kept on GitHub.** The workflow deletes older releases; their tags stay.
- **Local `main` can be behind `origin/main`.** Fetch before release work (see `RELEASE.md`).

## Look here first

- `CLAUDE.md`: the owner's working rules.
- `RELEASE.md`: the pipeline.
- `docs/DESIGN_DIRECTION.md`: design reference.
