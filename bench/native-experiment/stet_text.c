/*
 * stet_text — freestanding C text kernel for STET, compiled to WebAssembly.
 *
 * One job: count words for many screenplay elements in a single call (the
 * document-open path counts every element). Semantics are identical to the
 * JavaScript reference in src/core/text.js:
 *
 *     word = [\p{L}\p{N}]+ (['’-] [\p{L}\p{N}]+)*
 *
 * Input is UTF-8 (written by TextEncoder.encodeInto, so always well-formed).
 *
 * Memory ownership
 *   The module owns one linear-memory scratch region. JS asks for it with
 *   stet_scratch(bytes), writes the input into it, calls stet_count_words(),
 *   and reads the results back before the next call. C never keeps pointers
 *   between calls and never allocates anything else.
 *
 * Errors
 *   stet_scratch returns 0 if memory cannot grow; stet_count_words returns -1
 *   if an element length runs past the end of the input. JS then falls back
 *   to the reference implementation.
 */

#include <stdint.h>
#include "unicode_ranges.h" /* generated: WORD_RANGES[][2], WORD_RANGE_COUNT, ASCII_WORD[128] */

#define EXPORT(name) __attribute__((export_name(name)))

extern unsigned char __heap_base;
static uint32_t scratch_size = 0;

/* Pointer to a scratch buffer of at least `bytes`, growing memory if needed. */
EXPORT("stet_scratch")
uint8_t *stet_scratch(uint32_t bytes) {
  uint32_t base = (uint32_t)(uintptr_t)&__heap_base;
  uint32_t need = base + bytes;
  uint32_t have = (uint32_t)__builtin_wasm_memory_size(0) * 65536u;
  if (need > have) {
    uint32_t pages = (need - have + 65535u) / 65536u;
    if (__builtin_wasm_memory_grow(0, pages) == (uint32_t)-1) return 0;
  }
  scratch_size = bytes;
  return (uint8_t *)(uintptr_t)base;
}

static int is_word_cp(uint32_t cp) {
  if (cp < 128) return ASCII_WORD[cp];
  int lo = 0, hi = WORD_RANGE_COUNT - 1;
  while (lo <= hi) {
    int mid = (lo + hi) >> 1;
    if (cp < WORD_RANGES[mid][0]) hi = mid - 1;
    else if (cp > WORD_RANGES[mid][1]) lo = mid + 1;
    else return 1;
  }
  return 0;
}

/* Decode one code point at s[i]; advances *i. Input is well-formed UTF-8. */
static uint32_t next_cp(const uint8_t *s, uint32_t *i) {
  uint32_t c = s[*i];
  if (c < 0x80) { *i += 1; return c; }
  if (c < 0xE0) { uint32_t r = ((c & 0x1F) << 6) | (s[*i + 1] & 0x3F); *i += 2; return r; }
  if (c < 0xF0) { uint32_t r = ((c & 0x0F) << 12) | ((s[*i + 1] & 0x3F) << 6) | (s[*i + 2] & 0x3F); *i += 3; return r; }
  uint32_t r = ((c & 0x07) << 18) | ((s[*i + 1] & 0x3F) << 12) | ((s[*i + 2] & 0x3F) << 6) | (s[*i + 3] & 0x3F);
  *i += 4;
  return r;
}

/*
 * Word counting as a 3-state machine (out / in word / in word just after a
 * joiner), driven by tables so the ASCII path has no data-dependent branches:
 *   class: 0 other, 1 word char, 2 joiner (' ’ -)
 *   NEXT[state][class], STARTS[state][class] (1 when a new word begins)
 * "a-b" stays one word; "a--b", "a- b" and "a-" end the word at the joiner.
 */
static const uint8_t NEXT[3][3]   = { {0, 1, 0}, {0, 1, 2}, {0, 1, 0} };
static const uint8_t STARTS[3][3] = { {0, 1, 0}, {0, 0, 0}, {0, 0, 0} };

static uint8_t ascii_class[128];
static int classes_ready = 0;

static void init_classes(void) {
  for (int c = 0; c < 128; c++) ascii_class[c] = ASCII_WORD[c] ? 1 : 0;
  ascii_class[39] = 2; /* ' */
  ascii_class['-'] = 2;
  classes_ready = 1;
}

static uint32_t count_one(const uint8_t *s, uint32_t n) {
  uint32_t words = 0, i = 0, state = 0;
  while (i < n) {
    uint32_t c = s[i], cls;
    if (c < 0x80) { cls = ascii_class[c]; i++; }
    else {
      uint32_t cp = next_cp(s, &i);
      cls = cp == 0x2019 ? 2 : (uint32_t)is_word_cp(cp);
    }
    words += STARTS[state][cls];
    state = NEXT[state][cls];
  }
  return words;
}

/*
 * Layout of the scratch buffer for a call with `count` elements:
 *   [ uint32 lengths[count] ][ uint32 words_out[count] ][ utf8 bytes ... ]
 * Returns the total word count, or -1 on malformed lengths.
 */
EXPORT("stet_count_words")
int32_t stet_count_words(uint32_t count, uint32_t text_bytes) {
  uint8_t *base = (uint8_t *)(uintptr_t)&__heap_base;
  uint32_t header = count * 8u;
  if (header + text_bytes > scratch_size) return -1;
  const uint32_t *lens = (const uint32_t *)base;
  uint32_t *out = (uint32_t *)(base + count * 4u);
  const uint8_t *text = base + header;
  uint32_t pos = 0, total = 0;
  if (!classes_ready) init_classes();
  for (uint32_t k = 0; k < count; k++) {
    uint32_t len = lens[k];
    if (len > text_bytes - pos) return -1;
    uint32_t w = count_one(text + pos, len);
    out[k] = w;
    total += w;
    pos += len;
  }
  return (int32_t)total;
}
