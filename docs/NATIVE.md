# Native code: measured, built, benchmarked — not shipped

STET contains no native code. That is a measured result, not an omission.
This page records the audit (v0.3.0) so it can be re-checked.

## 1. Where does time go?

Profile of the engine on a 456-page script (7 601 elements, 583 k chars),
Node 24, i9-13900K:

| operation | cost | where it runs |
|---|---|---|
| keystroke: edit + incremental repagination | 0.012 ms | UI thread |
| wrap every element (open) | 0.58 ms | UI thread |
| **count words in every element (open, reset)** | **3.2 ms** (regex) | UI thread |
| parse + validate a document | 1.9 ms | UI thread (JSON.parse is already native) |
| whole open path (parse, count, wrap, paginate) | 14.5 ms | UI thread |
| gzip + CRC for a save | 19 ms | main-process thread pool (zlib is native) |
| PDF of the whole script | 27 ms (17 ms of it zlib) | worker thread |

Per-keystroke work is microseconds, so a native helper there could only add
crossing overhead. The largest UI-thread text operation was word counting,
which also degraded badly on non-Latin text (Unicode property regex). That
was the one candidate worth testing in C.

## 2. The C experiment

`bench/native-experiment/` contains the full, reproducible experiment:

- `stet_text.c` — freestanding C (no libc), table-driven 3-state word counter
  over UTF-8, Unicode letter/number ranges generated from the JS engine's own
  `\p{L}\p{N}` so results match exactly. Processes **all elements in one
  call** to avoid per-element crossing cost. Defined memory ownership (one
  scratch region owned by the module; JS writes input, reads output, no
  pointers kept across calls) and error returns (fallback to JS).
- `build.js` — compiles it to WebAssembly with Clang (`@yowasp/clang`, Clang
  built for WebAssembly, so no system compiler or per-platform builds).
  WebAssembly was chosen over an N-API addon because it needs no ABI rebuild
  per Electron version and runs in the renderer, workers and tests alike.
- `native.js` — the JS bridge; `bench.js` — the benchmark below.

Reproduce: `npm i --no-save @yowasp/clang && node bench/native-experiment/build.js && node bench/native-experiment/bench.js`

## 3. Results (456 pages, ms per full pass, median of 40 after warm-up)

| text | old regex (JS) | **state machine (JS, shipped)** | C → WebAssembly incl. copy |
|---|---|---|---|
| English | 3.95 | **1.59** | 1.50 |
| Spanish (accents, ~2 % non-ASCII) | 3.56 | **1.43** | 1.57 |
| Russian mix (~32 % non-ASCII) | 14.56 | **1.51** | 3.60 |

The C kernel's inner loop is about twice as fast as the JIT-compiled JS one,
but every call must first convert the UTF-16 strings to UTF-8 and copy them
into WebAssembly memory (≈ 0.6 ms for this script). With the *same algorithm
and tables* in JavaScript — UTF-16 code units, a memoised 64 K class table —
JS is within 6 % on English and 1.1–2.4× faster on accented and non-Latin text.

## 4. Decision

- **Shipped:** the table-driven state machine, in JavaScript
  (`src/core/text.js`). Word counting is 2.5× faster on English and 9.6×
  faster on Cyrillic; the open path went from 14.5 ms to 13.0 ms. A fuzz
  test (4 000 random strings with joiners, accents, CJK, emoji, lone
  surrogates) checks it against the regex definition.
- **Not shipped:** the C kernel. It is at best 6 % faster than equivalent JS,
  slower on international text, and would add a compiler toolchain, a binary
  artifact and a fallback path. The brief says not to rewrite working
  components in C merely to use C; the numbers say the same.

If a future feature has a genuinely native-shaped workload (for example
importing very large Final Draft XML or spell-checking a whole script), the
experiment's structure — one batched call, module-owned scratch memory,
WebAssembly, JS fallback — is the template, behind a worker like
`src/main/pdf-worker.js`.
