// Zip archives, just what updates need: reading the files out of one (checked against
// their CRC) and writing one from a folder (the release workflow's patch, see
// scripts/build-exe.js). Stored and deflated entries only, as Compress-Archive and
// this writer produce.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from './container.js';

export class ZipError extends Error {}

/** The entries of a zip archive in a buffer: [{ name, read() }], read() checks the CRC. */
export function zipEntries(buf) {
  const bad = () => new ZipError('damaged archive');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad();
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    out.push({
      name,
      read() {
        if (off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034b50) throw bad();
        const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
        const data = buf.subarray(start, start + csize);
        let d;
        try { d = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null; } catch { throw bad(); }
        if (!d || d.length !== usize || crc32(d) !== crc) throw bad();
        return d;
      },
    });
  }
  return out;
}

/** Unpacks every file of the archive into dir (which must not exist yet). */
export async function extractZip(zipPath, dir) {
  const root = path.resolve(dir) + path.sep;
  for (const e of zipEntries(await fs.readFile(zipPath))) {
    const target = path.resolve(dir, e.name);
    if (!target.startsWith(root)) throw new ZipError('unsafe path in archive: ' + e.name);
    if (/[\\/]$/.test(e.name)) { await fs.mkdir(target, { recursive: true }); continue; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, e.read());
  }
}

/** A zip archive (deflated) of [{ name, data }]. */
export function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Every file under dir, as zip entries with forward-slash names. */
export async function folderEntries(dir) {
  const out = [];
  const walk = async (d, rel) => {
    for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(path.join(d, e.name), name);
      else if (e.isFile()) out.push({ name, data: await fs.readFile(path.join(d, e.name)) });
    }
  };
  await walk(dir, '');
  return out;
}
