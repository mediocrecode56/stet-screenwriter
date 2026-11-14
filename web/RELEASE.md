# STET browser release

Separate from desktop releases; repository-wide context: `../RELEASE.md`. Version source: this folder's `package.json`.

1. From `web/`, run `npm test`, then `npm run build`. For browser review, `npm run serve` builds and serves port 8127.
2. Output: `web/dist/`, not committed. Keep the desktop/browser separation tests passing; review `BIBLE.md` and this file when the pipeline changes.
3. Commit intended changes and push when authorized. `../.github/workflows/web.yml` tests/builds and deploys `web/dist` to GitHub Pages on relevant pushes to `main`, or manual dispatch. It requires Pages configured with GitHub Actions as source.
4. Watch the Web workflow and check its reported deployment URL with disposable `.stet` files. Verify open/edit/save and any affected cloud path separately from Node tests.

No desktop installer, release tag or GitHub Release assets are produced by this workflow.
Rollback: revert the affected source commit and deploy through the same workflow; preserve users' drafts and cloud documents.
