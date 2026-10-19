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
- `["cm", id]` — comment anchor; `id` keys into `comments`. One comment may
  anchor across several consecutive blocks.

### Comments

Only comments referenced by at least one anchor are written. Comment text is
not part of the screenplay and never prints unless explicitly requested.

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
