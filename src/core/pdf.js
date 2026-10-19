// Minimal PDF 1.4 writer for screenplay pages.
//
// Uses the standard Type 1 font Courier (one of the 14 fonts every PDF reader
// provides), so no font embedding is needed and metrics are exact: every glyph
// is 600/1000 em wide, i.e. 7.2pt at 12pt = exactly 10 characters per inch.
// Text is encoded as WinAnsi (cp1252); characters outside it become "?".

const PT_COL = 7.2;   // 0.1in
const PT_ROW = 12;    // 1/6in
const PAGE_W = 612, PAGE_H = 792;
const BASELINE = 9.2; // baseline offset inside a 12pt row, matches screen rendering

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

function pageStream(page) {
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
  s += '0 0 0 rg BT /F1 12 Tf\n';
  let lx = 0, ly = 0;
  for (const l of page.lines) {
    const x = l.col * PT_COL, y = PAGE_H - l.row * PT_ROW - BASELINE;
    s += `${n(x - lx)} ${n(y - ly)} Td (${pdfString(l.text)}) Tj\n`;
    lx = x; ly = y;
  }
  s += 'ET\n';
  return s;
}

/**
 * Build a PDF. `deflate` (optional) compresses content streams: (Uint8Array) => Uint8Array.
 * Returns a Uint8Array.
 */
export function buildPdf(pages, { title = '', author = '', creator = 'STET', deflate = null, date = new Date() } = {}) {
  const objs = []; // index = object number - 1; each entry is a string (latin1)
  const add = (body) => { objs.push(body); return objs.length; };
  const catalogId = add(null);
  const pagesId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const p of pages) {
    let data = pageStream(p);
    let filter = '';
    if (deflate) {
      const bytes = deflate(latin1Bytes(data));
      data = bytesToLatin1(bytes);
      filter = ' /Filter /FlateDecode';
    }
    const contentId = add(`<< /Length ${data.length}${filter} >>\nstream\n${data}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
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
