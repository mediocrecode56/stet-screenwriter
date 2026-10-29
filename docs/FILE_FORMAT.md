# The `.stet` file format

A `.stet` file is a small binary container around a gzip-compressed JSON
payload. The container makes damage detectable before anything is parsed;
the JSON keeps the content inspectable and easy to migrate.

## Container (version 1)

| offset | size | field |
|-------:|-----:|-------|
| 0  | 8 | magic `53 54 45 54 0D 0A 1A 0A` — `"STET\r\n\x1a\n"` |
| 8  | 2 | container version, uint16 LE (= 1) |
| 10 | 2 | flags, uint16 LE — bit 0: payload is gzip |
| 12 | 4 | payload length in bytes, uint32 LE |
| 16 | 4 | CRC-32 (IEEE) of the payload bytes, uint32 LE |
| 20 | n | payload |

The magic borrows PNG's trick: the CR LF pair and the `0x1A` byte expose
files mangled by line-ending conversion or text-mode transfers.

A file is rejected — with a specific reason shown to the user — if it is
shorter than its header (`truncated`), has a damaged header (`mangled`),
is not a STET file (`not-stet`), is shorter or longer than the declared
length (`truncated` / `trailing`), fails the checksum (`checksum`) or
fails to decompress (`corrupt`). Rejection never modifies the file.

Implementation: `src/main/container.js`.

## Payload (schema 1)

UTF-8 JSON. Keys are written in a fixed order and comment ids are sorted, so
serialising an unchanged document always produces identical bytes
(`save(load(save(doc))) === save(doc)`, covered by tests).

```jsonc
{
  "format": "stet",
  "schema": 1,                     // payload schema version (see Migrations)
  "app": "0.2.0",                  // writer version, informational
  "meta": {
    "id": "uuid",                  // stable document identity (recovery, statistics)
    "created": "ISO-8601",
    "modified": "ISO-8601"
  },
  "settings": {
    "sceneSpacing": 1,             // blank lines before scene headings (1 or 2)
    "autoCapitalize": true,        // first-appearance capitalisation of names
    "backup": {
      "enabled": true,
      "intervalMin": 5,
      "retentionDays": 30,
      "dir": null                  // null = "<Name> Backups" next to the file
    }
  },
  "titlePage": {
    "title": "", "credit": "Written by", "author": "", "source": "",
    "contact": "",                 // may contain "\n" (up to 5 lines)
    "draftDate": "", "revision": ""
  },
  "blocks": [
    { "t": "scene", "x": "INT. COFFEE SHOP - NIGHT" },
    { "t": "action", "x": "Rain hammers the windows.", "m": [[0, 4, "hl", "yellow"]] },
    { "t": "dialogue", "x": "You said eight.", "m": [[0, 15, "cm", "c1"]] }
  ],
  "comments": {
    "c1": { "text": "Too on the nose?", "created": "ISO-8601", "modified": "ISO-8601" }
  }
}
```

### Blocks

`t` is one of `scene`, `action`, `character`, `paren`, `dialogue`,
`transition`, `shot`. `x` is the text exactly as stored; scene headings,
cues, transitions and shots are stored uppercase. `"\n"` inside `x` is a
soft line break within the element. The element *type* — not indentation —
carries the screenplay structure; layout is derived from it.

`m` (optional) lists marks as `[start, end, kind, value]` with UTF-16 offsets
into `x`, `start < end`:

- `["hl", color]` — highlight, color ∈ `blue | yellow | pink`
- `["b", 1]` · `["i", 1]` · `["u", 1]` · `["s", 1]` — bold, italic, underline,
  strikethrough (since 0.10.0). Styles combine freely and always print.
  Older versions of STET open such files and simply leave the styles out.
- `["cm", id]` — comment anchor; `id` keys into `comments`. One comment may
  anchor across several consecutive blocks.

`a` (optional, since 0.24.0) aligns the element between its margins: `left`,
`center`, `right` or `justify`. Without it the element takes its own alignment
(transitions right, everything else left).

`c` (optional, since 0.24.0) is the text as it was written, for an element
stored uppercase, when that differs from `x` (`c` uppercased is always `x`).
Turning the element into one that isn't uppercase brings this text back.

Older versions of STET open files with `a` or `c` and leave them out.

### Revision (optional, since 0.4.0)

```jsonc
"revision": { "ignored": [ { "text": "looking to him since five minutes", "category": "non_native" } ] }
```

Passages the writer chose to **Ignore** in the English revision. Future reviews
of this script hide matching findings, and Claude is told not to flag them.
Written only when non-empty, so files without ignores are byte-identical to
0.3.x output. Older builds ignore the field (and would drop it on save). The
spelling dictionary and the revision's guidelines are not stored in screenplays — they live in the app settings.

### Review (optional, since 0.6.0)

```jsonc
"revision": {
  "ignored": [ ... ],
  "review": {
    "id": "r1a2b3", "at": "2026-10-19T21:30:00.000Z", "model": "claude-opus-5-5",
    "state": "complete",            // complete | partial | cancelled | failed | interrupted
    "findings": [ {
      "id": "f12", "el": 4,           // element index (block ids are not stored)
      "s": 7, "e": 27,                // last known position of the minimal span
      "padL": 0, "padR": 13,          // how far the passage shown to the writer extends around it
      "original": "looking to him since", "replacement": "staring at him for",
      "shownOriginal": "looking to him since five minutes", "shownReplacement": "staring at him for five minutes",
      "contextBefore": "She is ", "contextAfter": " five minutes.",
      "category": "non_native", "confidence": "medium", "explanation": "…",
      "decision": "discarded",        // absent = undecided; accepted | discarded | ignored | guideline ("dictionary" before 0.37, read as guideline)
      "appliedText": "…"              // accepted only: the text that was put in
    } ]
  }
}
```

The latest English review with the writer's decisions. Text fields are kept
exactly as reviewed; only the position fields move with edits. On load, each
suggestion is located again from its element index, position and context; one
that can't be identified reliably is shown as not locatable rather than matched
elsewhere. Entries with missing or invalid fields are dropped. Written only
when a review exists; older builds ignore the field.

### Cast (optional, since 0.23.0)

```jsonc
"cast": ["MARY", "JOHN", "DETECTIVE RUIZ"]
```

The script's character names, most recently used first. Typing a character cue
suggests the first of them that starts with what was typed. Only names that
appear in a cue of the script are written, and the field only when non-empty;
older builds ignore it.

### Timecodes (optional, since 0.28.0)

```jsonc
"timecodes": [{ "b": 120, "l": 0, "t": 1500 }]
```

Times pinned on the timeline: `t` seconds at the start of line `l` of element `b`
(its index in `blocks`), in script order. Entries with an invalid element or time are
dropped. Written only when there are any; older builds ignore it.

### Comments

Only comments referenced by at least one anchor are written. Comment text is
not part of the screenplay and never prints unless explicitly requested.
A comment may also carry
`"pinned": true` (listed first in the notes panel), written only when set;
older builds ignore it. A pinned one may carry `"pinOrder"`, a number: the pinned notes are
listed highest first (the one pinned last, unless they were dragged into another order). A note's colour is the highlight on its passage. STET 0.40 to
0.43 wrote it as the comment's `"color"` instead: opening such a file turns it into
that highlight (where the passage has none of its own), and it is not written again.

## Validation and repair on open

`src/core/serialize.js` validates every field. Recoverable problems are
repaired and listed in an "opened with warnings" notice — unknown element
types open as Action, out-of-range marks are clipped or dropped, anchors with
no comment body get an empty note. Unrecoverable problems (no blocks array,
wrong format tag, newer schema) refuse to open and change nothing.

## Versioning and migration

- **Container version** changes only if the binary framing changes.
- **Schema version** changes whenever the payload's meaning changes.

`MIGRATIONS[n]` upgrades a parsed payload from schema `n` to `n + 1`;
opening runs them in sequence up to `SCHEMA_VERSION`. Before a migrated
document can be written back, the original bytes are stored as a backup in
the document's backup folder, so a migration can never cost the original.

A file with a schema *newer* than the running build is refused with an
explanation (`too-new`), never opened read-write, so an older build cannot
silently drop data it does not understand.

## Writing

All writes are atomic: temp file in the same directory → `fsync` → read back
and verify the container → rename over the target (`src/main/files.js`).
A crash at any instant leaves either the previous file or the new one.
Stray temp files (`.Name.stet.<pid>.<hex>.tmp`) from an interrupted write are
removed the next time the folder is opened.

## Backups

`<backup dir>/<Name> YYYY-MM-DD HHMMSS.stet` — ordinary `.stet` files that
open like any document. The timestamp in the name (not the file mtime)
determines age for retention.
