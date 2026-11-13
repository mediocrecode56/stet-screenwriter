# Design direction

The owner's feedback, distilled, to guide changes when a request leaves something open. Newest
lessons go at the end of their section. Update this file whenever new feedback adds or corrects one.

## Principles

- Clean, subtle, professional. Nothing is added that the writer has to learn or dismiss.
- Raw square design: no rounded corners, no soft blurred shadows. Hard 1px rules and hard offset
  shadows only. "Polish" means timing, easing and hover feedback, never rounding.
- One motion language everywhere (ui/motion.js): a surface arrives with one decelerating move from
  where it belongs and leaves the same way. Nothing overshoots, bounces or wobbles. A new menu or
  dropdown copies an existing one's motion exactly rather than inventing its own.
- Minimal complexity: prefer reusing an existing control, idiom or confirmation (ui/arm.js) over a
  new one.
- Readable colours. Highlights are pale pastels leaning to white, never grey, dark or washed out,
  each still clearly its colour. In the dark theme they are deep but clearly coloured, so light text
  stays readable. Small marks (timeline, squares) are a step fuller than highlights.
- No colour may look metallic: no olive, brass or mauve casts. Yellow is a clean warm yellow (honey in
  the dark), pink a warm rose rather than lavender.
- Highlights in each theme share one lightness and one colourfulness (they are chosen in OKLCH), so
  no colour looks heavier, greyer or more washed out than its neighbours. A selection over a
  highlight deepens that highlight's own colour; it never lays a grey or white wash over it (that
  wash is what made yellow look brass and pink mauve).
- A highlight is never tight on its letters: like a word processor's, it reaches a little above the
  capitals and below the descenders (HIGHLIGHT_REACH in core/model.js), the same on paper and in the PDF.
- Icons over words wherever the toolbar already has an icon: a menu offering the same action shows
  the toolbar's own icon (the right-click menu's style, alignment and highlight rows).
- A button in a group is set exactly like its neighbours (same type, size, width); no stray dividers.
- Icon buttons are cells of one width with the icon exactly in the middle (the toolbar's --cell, the
  selection menu's icon slot), so swatches, B I U S and the small icons keep one rhythm.

## Interaction

- Menus: hover only lights the icon/label; a dropdown opens on a click (like the top menu bar).
- Anything clickable inside a card or row shows the same hand pointer as the card. The pointer must
  never change to an arrow over something that still takes a click.
- Going somewhere (a scene, a note, a timeline mark, a Revise card) places the caret at the start of
  the passage, never selecting it. A note also opens the notes panel.
- Confirmation for destructive actions is a second press on the same button (CONFIRM / an X), never a
  modal, never a timeout.
- A field edit counts when the writer clicks away after changing something; with nothing changed a
  click away changes nothing.
- Fields always allow normal text selection; a time field selects the part clicked and the wheel steps it.
- Overlays (Find) sit over the script at the top right rather than pushing it down, so nothing jumps.
- Nothing in a bar shifts as you type: a readout that changes (Find's count) keeps one width.
- Going to a place in the script (a Find match, a timeline mark) glides it to the same spot, 10% of
  the window above the middle, never a bare scroll that leaves it at an edge.
- Every end of a symmetric control behaves the same (the timeline's left and right ends).
- Lists in windows (Revise guidelines) are plain rows: a small tag column, the main text, one quiet
  line of detail under it, a small × to remove. No tables of oversized buttons; no explanatory
  paragraphs where a short lead line will do. Settings need no legends explaining how they work.
- A window with a long list (Revise guidelines) is big enough to read, and only the list scrolls,
  in a box of its own under what stays fixed (a summary line, tabs, filters). Nothing sticky: a
  row must never slide over or under a header. Tabs carry their counts.
- Something the writer may want and has not asked for (a dictionary to download) is offered in one
  line above the status bar with its answers beside it, never in a window, and one of the answers
  ends the offers for good. What is still missing afterwards is a small "!" on the button it
  belongs to, with a tooltip that says what is missing and how to get it.
- Two ways to do the same job (Review, Strict Review) sit side by side, set alike; the usual one
  is the filled one.
- Show context in plain words (a scene's name, "page 3"), never cryptic codes like "P.3".
- A View menu item that turns something on or off says what it will do now (Show ... / Hide ...,
  Enter / Leave, Turn On / Turn Off), never a tick beside a fixed name.
- Showing or hiding the title page moves like a side panel: it slides in from above the script and
  the script glides with it. A writer further down the script stays exactly where they are.
- Focus mode hides everything, but never what the writer is changing: Tab alone brings the toolbar's
  element buttons to the top left corner, for a few seconds so they can be clicked. The pointer never
  brings them on their own: anywhere along the top it brings the whole toolbar.
  In that corner they have one plain outline: no shadow, no box inside a box. They are the toolbar's
  own buttons and work exactly as they do there (click, Ctrl+click, the Tab cycle's ends, its outline
  when some elements are left out), with the toolbar shown or hidden.
- The dinosaur stays out of focus mode unless the writer asks for it (View menu). Then it is the only
  thing at the bottom, standing on the window's edge: no status bar, not even kept out of sight.

## Page format

The owner's reference is Final Draft's page. These numbers are checked by test/unit/finaldraft.test.js
and live in core/format.js; change them only on the owner's word.

- A4 is the default page. The standard below is written for Letter, so on A4 every right edge is kept
  as a distance from the paper's right edge, never as the Letter figure (which is how action came to
  run too far right). Left indents are measured from the left edge and never change.
- Courier 12pt, 6 lines an inch, characters 7pt apart.
- Page: 1.5in left, 1in right, 1in top, 54 lines of body (9in, a page stays about a minute).
- Page number: 0.5in from the top, ending 1.25in from the right edge, with a full stop after it.
- Scene heading, action, shot: from 1.5in to the right margin (57 characters on A4, 60 on Letter).
- Character: from 3.5in, to 1.25in from the right edge.
- Parenthetical: 3.0in to 5.5in (25 characters). Dialogue: 2.5in to 6.0in (35 characters).
- Transition: 16 characters wide, ending 1.4in from the right edge.
- One blank line before scene headings, action, character, transitions and shots; none before
  parentheticals and dialogue. Two before a scene heading is the writer's choice in Preferences.

## The dinosaur

- It should feel alive and continuous: never frozen for long while awake, never several things at
  once. Small stirs fill held poses; a breather follows each reaction; small things drift by between
  the bigger events. Keep its character: unhurried, a little silly, never nagging.
- One thing grows out of the last: between two activities it does something small that belongs to
  both (a bridge, dino-acts.js), and after a reaction it finds its place again. New routines keep to
  this: never a cut from one thing to another, and a bridge never changes what it chooses to do.

## Words

- Public changelog: short, simple phrases anyone understands. Each version has exactly two
  sections, FEATURES and BUGS, PERFORMANCE. No internals.
- In-app text says what a thing does, in one short sentence at most.

## Code

- A colour is named once: :root holds its values, one line in style.css's colours section maps it
  to --hl / --mark / --paper, and every rule reads those. HIGHLIGHT_PAPER (core/model.js) is the
  same paper colours for print. Icons live in ui/icons.js; a new toolbar or menu icon goes there.

## Process

- Startup must feel calm: the window shows once ready and its contents fade up, with no jump.
- Before every release: unit tests, the full app suite (timed, see stet test timings), the Mac traps.
- Privacy: nothing personal in the repository (handle only, no real name, no local paths); the
  script leaves the computer only through Revise, which the writer runs. The one addition, asked
  for by the owner: the guidelines (passages the writer set aside, their notes) go to Claude or
  Codex when one is added or removed, for the one sentence of direction.
- The review must never go quiet because of the guidelines: what they hold back stays in sight
  (HELD BACK), a clear error is always shown, and a strict review ignores them all.
- A day is the computer's own day: counted from the operating system's clock, never from a time
  zone worked out some other way.
