// HTML rendering of print-model pages for the OS print dialog. Positions are in
// inches on the same character grid as the PDF, independent of editor zoom.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// The script font's faces, from `fonts` (a URL ending in /): file, weight, style.
const FACES = [['Regular', 400, 'normal'], ['Bold', 700, 'normal'], ['Italic', 400, 'italic'], ['BoldItalic', 700, 'italic']];
const HL = { blue: '#c8defb', yellow: '#fbefa0', pink: '#fbcde2' };

export function printHTML(pages, title = 'Screenplay', fonts = '') {
  let body = '';
  for (const p of pages) {
    body += '<div class="p">';
    for (const r of p.rects) body += `<i style="left:${r.col / 10}in;top:${r.row / 6}in;width:${r.w / 10}in;background:${HL[r.color] || '#ddd'}"></i>`;
    for (const u of p.notes) body += `<u style="left:${u.col / 10}in;top:${u.row / 6}in;width:${u.w / 10}in"></u>`;
    for (const l of p.lines) body += `<b${l.st ? ` class="${[...l.st].map((k) => 's' + k).join(' ')}"` : ''} style="left:${l.col / 10}in;top:${l.row / 6}in">${esc(l.text)}</b>`;
    body += '</div>';
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${FACES.map(([f, w, st]) => `@font-face { font-family: "STET Courier"; src: url("${fonts}STETCourier-${f}.ttf"); font-weight: ${w}; font-style: ${st}; }`).join('\n')}
@page { size: 210mm 297mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.p { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
.p:last-child { page-break-after: auto; break-after: auto; }
b { position: absolute; font: 400 12pt/1 "STET Courier", "Courier New", Courier, monospace; white-space: pre; color: #000; height: 12pt; }
i { position: absolute; height: 12pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
u { position: absolute; height: 12pt; border-bottom: 0.6pt dashed #000; }
.sb { font-weight: 700; } .si { font-style: italic; }
.su { text-decoration: underline; } .ss { text-decoration: line-through; } .su.ss { text-decoration: underline line-through; }
</style></head><body>${body}</body></html>`;
}
