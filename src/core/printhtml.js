// HTML rendering of print-model pages for the OS print dialog. Positions are in
// inches on the same character grid as the PDF, independent of editor zoom.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HL = { blue: '#c8defb', yellow: '#fbefa0', pink: '#fbcde2' };

export function printHTML(pages, title = 'Screenplay') {
  let body = '';
  for (const p of pages) {
    body += '<div class="p">';
    for (const r of p.rects) body += `<i style="left:${r.col / 10}in;top:${r.row / 6}in;width:${r.w / 10}in;background:${HL[r.color] || '#ddd'}"></i>`;
    for (const u of p.notes) body += `<u style="left:${u.col / 10}in;top:${u.row / 6}in;width:${u.w / 10}in"></u>`;
    for (const l of p.lines) body += `<b style="left:${l.col / 10}in;top:${l.row / 6}in">${esc(l.text)}</b>`;
    body += '</div>';
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: 8.5in 11in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.p { position: relative; width: 8.5in; height: 11in; overflow: hidden; page-break-after: always; break-after: page; }
.p:last-child { page-break-after: auto; break-after: auto; }
b { position: absolute; font: 400 12pt/1 "Courier New", Courier, monospace; white-space: pre; color: #000; height: 12pt; }
i { position: absolute; height: 12pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
u { position: absolute; height: 12pt; border-bottom: 0.6pt dashed #000; }
</style></head><body>${body}</body></html>`;
}
