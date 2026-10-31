// The toolbar's and the menus' icons, in one place, so a menu offering a toolbar action shows the
// toolbar's own icon (DESIGN_DIRECTION.md). Each is a string of markup drawn in the text colour
// (currentColor), crisp, with square corners, its size fixed so it sits exactly in the middle of a
// toolbar cell (style.css .tb.sq) or a selection-menu slot (.selb .ico).

const svg = (w, h, body, extra = '') => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" shape-rendering="crispEdges"${extra}>${body}</svg>`;

/** The four text styles' letters; Clear Formatting is a T struck through (.sclr). */
export const STYLE_GLYPH = { b: 'B', i: 'I', u: 'U', s: 'S' };

// An alignment: four lines of 10px, the short ones (6px) set to the left, the middle or the right.
const ALIGN_LINES = { left: [10, 6, 10, 6], center: [10, 6, 10, 6], right: [10, 6, 10, 6], justify: [10, 10, 10, 10] };
export const alignIcon = (a) => svg(10, 7, ALIGN_LINES[a].map((w, i) => `<rect x="${a === 'right' ? 10 - w : a === 'center' ? (10 - w) / 2 : 0}" y="${i * 2}" width="${w}" height="1"/>`).join(''), ' fill="currentColor"');

/** A text style's letter in its own style (b, i, u, s), or the struck T for 'clear'. */
export const styleIcon = (k) => (k === 'clear' ? '<span class="sclr">T</span>' : `<span class="s${k}">${STYLE_GLYPH[k]}</span>`);

/** A highlight colour's swatch ('none': the struck square that removes one). */
export const swatch = (c) => `<span class="sw ${c}"></span>`;

/** A style, alignment or highlight command's icon (style-b, align-left, hl-blue...), as its toolbar
 *  button shows it: the selection menu's dropdowns show these. */
export function toolIcon(id) {
  const i = id.indexOf('-'), k = id.slice(0, i), v = id.slice(i + 1);
  if (k === 'align') return alignIcon(v);
  if (k === 'hl') return swatch(v);
  if (k === 'style' && (v === 'clear' || STYLE_GLYPH[v])) return `<span class="st-ic">${styleIcon(v)}</span>`;
  return '';
}

/** The selection menu's own: a bold B (text style), a highlighter's bar, a note's square. */
export const TEXT_STYLE = '<span class="gb">B</span>';
export const HIGHLIGHT = svg(12, 12, '<rect x=".5" y="3.5" width="11" height="5" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1"/>');
export const NOTE = svg(12, 12, '<rect x=".5" y=".5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1"/><rect x="4" y="4" width="4" height="4" fill="currentColor"/>');

/** The side panels' lock beside REVISE: shut, or open with its shackle lifted. */
export const lockIcon = (shut) => `<svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><rect x="1" y="5.5" width="8" height="6" fill="currentColor" shape-rendering="crispEdges"/><path d="M2.8 5.5V3.6a2.2 2.2 0 0 1 4.4 0${shut ? 'V5.5' : 'V3'}" fill="none" stroke="currentColor" stroke-width="1.3" ${shut ? '' : 'transform="translate(2.6 -1)"'}/></svg>`;

/** A dropdown's arrow, after a button's label or icon. */
export const DROP = '<span class="dn" aria-hidden="true">▾</span>';
