# Native helper: evaluated, not built

The brief allows a C helper library where native code would give a
*measurable* benefit. The candidate hot paths were measured first
(`npm run bench`, `npm run perf`; full numbers in [PERFORMANCE.md](PERFORMANCE.md)):

| operation (456-page script, 7 600 elements) | measured cost | budget |
|---|---|---|
| keystroke: edit + incremental repagination | 0.012 ms | 16.7 ms frame |
| full pagination, all layout cached | 0.38 ms | — |
| wrap every element from cold (open) | 0.48 ms | — |
| find all occurrences of "the" | 0.52 ms | — |
| serialise the document for a save | 0.89 ms | runs once per autosave |
| gzip + CRC (main process thread pool) | 19 ms | off the UI thread |
| PDF of the whole script (worker thread) | 28 ms | off the UI thread |

Every UI-thread path costs well under 1 ms; the two multi-millisecond tasks
already run off the UI thread. The remaining per-keystroke cost (~0.5 ms of
renderer JS plus browser style/paint) sits in DOM work that a native library
could not reach through IPC anyway — crossing an N-API or IPC boundary per
keystroke would cost more than the work it replaces.

A native module would also add a compiler toolchain, per-platform builds and
ABI rebuilds on every Electron upgrade — complexity without a benefit to show.
(The build machine has no C compiler installed; that was checked, but it is
not the reason: the numbers are.)

**Decision:** no native code. If a future feature changes this (for example
spell-checking a whole script, or importing very large Final Draft files),
the place to add it is a worker thread behind the same message interface as
`src/main/pdf-worker.js`, with a pure-JS fallback kept for tests.
