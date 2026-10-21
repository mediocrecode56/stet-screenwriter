// Rasterise the icon with Chromium and write build/icon.ico (+ PNGs), and build/icon.icns for
// the Mac: the same tile, inside the margin every Mac app icon has (824 of 1024 pixels).
// `npx electron scripts/make-icon.cjs`
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'build');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function ico(pngs) { // ICO container with PNG-compressed entries (Windows Vista+)
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

// ICNS container of PNGs: [type, pixels] for each size a Mac asks for (1x and 2x).
const ICNS = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
function icns(bySize) {
  const parts = ICNS.map(([type, size]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii'); head.writeUInt32BE(8 + bySize[size].length, 4);
    return Buffer.concat([head, bySize[size]]);
  });
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii'); head.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}

app.whenReady().then(async () => {
  const { iconSvg } = await import('./icon.svg.js');
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,<canvas></canvas>');
  fs.mkdirSync(OUT, { recursive: true });
  // The icon drawn at tile pixels, on a transparent canvas of size pixels.
  const render = (size, tile = size) => w.webContents.executeJavaScript(`new Promise((res) => {
      const img = new Image();
      img.onload = () => { const c = document.querySelector('canvas'); c.width = c.height = ${size};
        const g = c.getContext('2d'); g.clearRect(0, 0, ${size}, ${size}); g.drawImage(img, ${(size - tile) >> 1}, ${(size - tile) >> 1}, ${tile}, ${tile});
        res(c.toDataURL('image/png').split(',')[1]); };
      img.src = 'data:image/svg+xml;base64,' + btoa(${JSON.stringify(iconSvg(tile))});
    })`).then((b64) => Buffer.from(b64, 'base64'));
  const pngs = [];
  for (const size of SIZES) {
    const buf = await render(size);
    pngs.push({ size, buf });
    if ([16, 32, 64, 256].includes(size)) fs.writeFileSync(path.join(OUT, `icon-${size}.png`), buf);
  }
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(pngs));
  const mac = {};
  for (const size of new Set(ICNS.map(([, s]) => s))) mac[size] = await render(size, Math.round(size * 824 / 1024));
  fs.writeFileSync(path.join(OUT, 'icon.icns'), icns(mac));
  fs.writeFileSync(path.join(OUT, 'icon.png'), pngs.find((p) => p.size === 256).buf);
  fs.writeFileSync(path.join(OUT, 'icon.svg'), iconSvg(256));
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'mark.svg'), iconSvg(16)); // top-bar mark
  console.log('wrote build/icon.ico with', SIZES.join(', '), 'and build/icon.icns');
  app.quit();
});
