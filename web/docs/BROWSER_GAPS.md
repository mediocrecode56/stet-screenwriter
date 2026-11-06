# What the browser version does not do yet

The ALPHA is a foundation, not a copy of the desktop app. Whatever a file contains is kept: notes, reviews
and timecodes this version cannot show are saved back untouched and still open on the desktop.

## Works now

Open, edit and save `.stet`; import `.fdx`; every element type with Tab and smart Enter; bold, italic,
underline and strikethrough; undo and redo; the title page; the scene list; PDF export; light and dark;
screens from phone to desktop; drafts that survive a closed tab.

## Needs a real device before it can be trusted

These are built, but were only tried in a phone-sized desktop browser. **Check them on real phones first.**

| what | risk |
|---|---|
| Typing on an on-screen keyboard | the desktop's input is a hidden textarea made for hardware keyboards. Enter and Backspace are translated (`app.js`, `beforeinput`), but Backspace on an empty field is known to be unreliable on Android |
| Autocorrect and predictive text | keyboards that rewrite text may behave oddly |
| The page above the keyboard | `visualViewport` handling needs checking on iPhone |
| Share sheet, Save to Files | see [CLOUD.md](CLOUD.md) |

## Left out for now

| feature | why it is hard | way forward | priority |
|---|---|---|---|
| Selecting text by touch | the view has no touch selection: a tap places the caret, nothing more | handles and long press, in `web/` | high |
| Notes panel | needs the panel code separated from desktop wiring | reuse `ui/panels.js`, or a smaller web panel | high |
| Find and replace | not wired up; the engine already has it | reuse `ui/find.js` | high |
| Working offline | needs a service worker for the site's files; drafts already work offline | add one and test updates carefully | medium |
| Install to the home screen | follows from the above | a web app manifest | medium |
| Print | a browser print dialog and page CSS differ from the desktop's window | `printHTML` in a hidden frame; PDF export covers it meanwhile | medium |
| Spelling | dictionaries are installed on the computer, and the browser's own checker cannot see a custom page | Hunspell dictionaries in a worker: `core/spell.js` is already plain JavaScript; dictionary size is the question | medium |
| The same file open in two tabs | nothing stops them; the second save asks, as for any change elsewhere | a lock through `BroadcastChannel` | medium |
| Revise with Claude | needs an API key. A key in a public web page cannot be kept secret, and Anthropic's API is not meant to be called with a shared key from browsers | a small server of the owner's, or each writer's own key, kept only in their browser. This is a product decision | low |
| Backups | desktop backups are files beside the script | rely on Drive's history; a browser has no folder to write them to | low |
| Writing statistics, streak, goals | kept in a desktop file with no shared account | would need syncing | low |
| The timeline | large and tied to the desktop layout | a read-only strip first | low |
| The dinosaur | works in a canvas and could be moved; it needs the status bar and the stats | keep it for when statistics exist | low |
| Keyboard shortcut editor, Preferences | not needed yet | | low |
| Focus mode | little value before the rest | | low |

## Known small things

- On a phone the page is cropped to the text column, so the title page's right-hand fields run off the edge.
- Saving in Safari and Firefox hands over a copy, so the status bar says KEPT IN THIS BROWSER until one is saved.
- A file saved here records `web-0.1.0-alpha` as the app that wrote it. It is informational only.
