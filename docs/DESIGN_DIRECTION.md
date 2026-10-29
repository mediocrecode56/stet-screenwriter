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
- Show context in plain words (a scene's name, "page 3"), never cryptic codes like "P.3".

## Words

- Public changelog: short, simple phrases anyone understands. Each version has exactly two
  sections, FEATURES and BUGS, PERFORMANCE. No internals.
- In-app text says what a thing does, in one short sentence at most.

## Process

- Startup must feel calm: the window shows once ready and its contents fade up, with no jump.
- Before every release: unit tests, the full app suite (timed, see stet test timings), the Mac traps.
- Privacy: nothing personal in the repository (handle only, no real name, no local paths); the
  script leaves the computer only through Revise, which the writer runs.
