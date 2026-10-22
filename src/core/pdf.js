// Minimal PDF 1.4 writer for screenplay pages.
//
// Text is set in STET Courier (src/fonts: Bitstream's Courier 10 Pitch, the Courier Final
// Draft prints with), embedded as TrueType in regular, bold, italic and bold italic. Without
// the font files (`fonts` not given) it falls back to the standard Type 1 Courier family that
// every PDF reader provides. Either way every glyph is 600/1000 em wide, i.e. 7.2pt at 12pt =
// exactly 10 characters per inch. Text is encoded as WinAnsi (cp1252); characters outside it
// become "?", and the one cp1252 character STET Courier lacks (the euro sign) prints in Courier.

const PT_COL = 7.2;   // 0.1in
const PT_ROW = 12;    // 1/6in
export const PAPER = { w: 595.28, h: 841.89 }; // A4, as Final Draft prints
const PAGE_W = PAPER.w, PAGE_H = PAPER.h;
const BASELINE = 8.52; // baseline offset inside a 12pt row: 0.71em, where Final Draft prints it

const HL_RGB = { blue: '0.784 0.871 0.984', yellow: '0.984 0.937 0.627', pink: '0.984 0.804 0.886' };

const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** Encode text as a PDF literal string body (latin1 "bytes"). */
export function pdfString(text) {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    let b;
    if (c < 0x80) b = c;
    else if (c >= 0xa0 && c <= 0xff) b = c;
    else b = CP1252.get(c) ?? 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 0x20) out += ' ';
    else out += String.fromCharCode(b);
  }
  return out;
}

const n = (v) => (Math.round(v * 100) / 100).toString();

const FONTS = ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'];
const EMBEDDED = ['STETCourier-Regular', 'STETCourier-Bold', 'STETCourier-Italic', 'STETCourier-BoldItalic'];
const fontOf = (st = '') => (st.includes('b') ? 1 : 0) + (st.includes('i') ? 2 : 0);
const MISSING = /\u20ac/; // in cp1252 but not in STET Courier
const UNDER = -1.6, STRIKE = 3.2; // rule heights from the baseline, in pt

function pageStream(page, embedded, used) {
  let s = '';
  for (const r of page.rects) {
    const x = r.col * PT_COL, y = PAGE_H - (r.row + 1) * PT_ROW - 1;
    s += `${HL_RGB[r.color] || '0.9 0.9 0.9'} rg ${n(x)} ${n(y)} ${n(r.w * PT_COL)} ${PT_ROW + 1} re f\n`;
  }
  if (page.notes.length) {
    s += '0 0 0 RG 0.6 w [2 1.5] 0 d\n';
    for (const u of page.notes) {
      const x = u.col * PT_COL, y = PAGE_H - (u.row + 1) * PT_ROW + 0.5;
      s += `${n(x)} ${n(y)} m ${n(x + u.w * PT_COL)} ${n(y)} l S\n`;
    }
    s += '[] 0 d\n';
  }
  s += '0 0 0 rg BT\n';
  let lx = 0, ly = 0, font = -1;
  const rules = [];
  for (const l of page.lines) {
    const x = l.col * PT_COL, y = PAGE_H - l.row * PT_ROW - BASELINE;
    const f = fontOf(l.st);
    // Runs of characters STET Courier lacks print in the standard Courier of the same style.
    const parts = embedded && MISSING.test(l.text) ? l.text.split(/(\u20ac+)/).filter(Boolean) : [l.text];
    let px = x;
    for (const t of parts) {
      const id = embedded && MISSING.test(t) ? f + 4 : f;
      if (id !== font) { s += `/F${id + 1} 12 Tf\n`; font = id; used.add(id); }
      s += `${n(px - lx)} ${n(y - ly)} Td (${pdfString(t)}) Tj\n`;
      lx = px; ly = y; px += [...t].length * PT_COL;
    }
    if (l.st && l.st.includes('u')) rules.push([x, y + UNDER, l.text.length]);
    if (l.st && l.st.includes('s')) rules.push([x, y + STRIKE, l.text.length]);
  }
  s += 'ET\n';
  if (rules.length) {
    s += '0 0 0 RG 0.6 w\n';
    for (const [x, y, w] of rules) s += `${n(x)} ${n(y)} m ${n(x + w * PT_COL)} ${n(y)} l S\n`;
  }
  return s;
}

/**
 * Build a PDF. `deflate` (optional) compresses content streams: (Uint8Array) => Uint8Array.
 * Returns a Uint8Array.
 */
export function buildPdf(pages, { title = '', author = '', creator = 'STET', deflate = null, date = new Date(), fonts: files = null } = {}) {
  const objs = []; // index = object number - 1; each entry is a string (latin1)
  const add = (body) => { objs.push(body); return objs.length; };
  const catalogId = add(null);
  const pagesId = add(null);
  const embedded = !!(files && files.length === 4);
  // /F1-/F4: the script's faces; /F5-/F8: standard Courier (the fallback). Only faces used are written.
  const fontIds = [...EMBEDDED, ...FONTS].map(() => add(null));
  const fonts = fontIds.map((id, i) => `/F${i + 1} ${id} 0 R`).join(' ');
  const used = new Set();
  const kids = [];
  for (const p of pages) {
    let data = pageStream(p, embedded, used);
    let filter = '';
    if (deflate) {
      const bytes = deflate(latin1Bytes(data));
      data = bytesToLatin1(bytes);
      filter = ' /Filter /FlateDecode';
    }
    const contentId = add(`<< /Length ${data.length}${filter} >>\nstream\n${data}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fonts} >> >> /Contents ${contentId} 0 R >>`));
  }
  fontIds.forEach((id, i) => {
    const base = i < 4 ? EMBEDDED[i] : FONTS[i - 4];
    if (i >= 4 || !embedded) {
      objs[id - 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[i % 4]} /Encoding /WinAnsiEncoding >>`;
      return;
    }
    if (!used.has(i)) { objs[id - 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[i]} /Encoding /WinAnsiEncoding >>`; return; }
    let data = bytesToLatin1(files[i]);
    let filter = '';
    if (deflate) { data = bytesToLatin1(deflate(files[i])); filter = ' /Filter /FlateDecode'; }
    const file = add(`<< /Length ${data.length} /Length1 ${files[i].length}${filter} >>\nstream\n${data}\nendstream`);
    const bold = i & 1, italic = i & 2;
    const desc = add(`<< /Type /FontDescriptor /FontName /${base} /Flags ${1 + 32 + (italic ? 64 : 0)} /FontBBox [-100 -310 700 880] ` +
      `/ItalicAngle ${italic ? -12 : 0} /Ascent 710 /Descent -290 /CapHeight 579 /StemV ${bold ? 140 : 80} /FontFile2 ${file} 0 R >>`);
    objs[id - 1] = `<< /Type /Font /Subtype /TrueType /BaseFont /${base} /FirstChar 32 /LastChar 255 ` +
      `/Widths [${Array(224).fill(600).join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${desc} 0 R >>`;
  });
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const d = date;
  const p2 = (v) => String(v).padStart(2, '0');
  const pdfDate = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const infoId = add(`<< /Title (${pdfString(title)}) /Author (${pdfString(author)}) /Creator (${pdfString(creator)}) /Producer (${pdfString(creator)}) /CreationDate (${pdfDate}) >>`);

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1Bytes(out);
}

function latin1Bytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function bytesToLatin1(b) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return s;
}
