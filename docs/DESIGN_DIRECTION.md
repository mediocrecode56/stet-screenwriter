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
- Icons over words wherever the toolbar already has an icon: a menu offering the same action shows
  the toolbar's own icon (the right-click menu's style, alignment and highlight rows).
- A button in a group is set exactly like its neighbours (same type, size, width); no stray dividers.

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
- Every end of a symmetric control behaves the same (the timeline's left and right ends).
- Lists in windows (Revise guidelines) are plain rows: a small tag column, the main text, one quiet
  line of detail under it, a small × to remove. No tables of oversized buttons; no explanatory
  paragraphs where a short lead line will do. Settings need no legends explaining how they work.
- Show context in plain words (a scene's name, "page 3"), never cryptic codes like "P.3".

## The dinosaur

- It should feel alive and continuous: never frozen for long while awake, never several things at
  once. Small stirs fill held poses; a breather follows each reaction; small things drift by between
  the bigger events. Keep its character: unhurried, a little silly, never nagging.

## Words

- Public changelog: short, simple phrases anyone understands. Each version has exactly two
  sections, FEATURES and BUGS, PERFORMANCE. No internals.
- In-app text says what a thing does, in one short sentence at most.

## Process

- Startup must feel calm: the window shows once ready and its contents fade up, with no jump.
- Before every release: unit tests, the full app suite (timed, see stet test timings), the Mac traps.
- Privacy: nothing personal in the repository (handle only, no real name, no local paths); the
  script leaves the computer only through Revise, which the writer runs.
