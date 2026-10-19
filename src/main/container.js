// .stet binary container: fixed header + gzip-compressed JSON payload.
//
//   offset size  field
//   0      8     magic   "STET\r\n\x1a\n"  (detects text-mode/line-ending corruption)
//   8      2     container version (uint16 LE) = 1
//   10     2     flags (uint16 LE): bit 0 = payload is gzip
//   12     4     payload length in bytes (uint32 LE)
//   16     4     CRC-32 of the payload bytes (uint32 LE)
//   20     n     payload
//
// Truncated, padded or bit-flipped files are rejected before parsing.

import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const MAGIC = Buffer.from([0x53, 0x54, 0x45, 0x54, 0x0d, 0x0a, 0x1a, 0x0a]);
export const CONTAINER_VERSION = 1;
const HEADER = 20;
const FLAG_GZIP = 1;

export class ContainerError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let table = null;
export function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function encode(json) {
  const payload = await gzip(Buffer.from(json, 'utf8'), { level: 6 });
  const head = Buffer.alloc(HEADER);
  MAGIC.copy(head, 0);
  head.writeUInt16LE(CONTAINER_VERSION, 8);
  head.writeUInt16LE(FLAG_GZIP, 10);
  head.writeUInt32LE(payload.length, 12);
  head.writeUInt32LE(crc32(payload), 16);
  return Buffer.concat([head, payload]);
}

/** Validate header, length and checksum without decompressing. */
export function check(buf) {
  if (buf.length < HEADER) throw new ContainerError('truncated', 'The file is too short to be a STET document (it may be incomplete).');
  if (!buf.subarray(0, 8).equals(MAGIC)) {
    if (buf.subarray(0, 4).toString('latin1') === 'STET') throw new ContainerError('mangled', 'The file header is damaged (line endings were altered by another program).');
    throw new ContainerError('not-stet', 'This is not a STET document.');
  }
  const version = buf.readUInt16LE(8);
  if (version > CONTAINER_VERSION) throw new ContainerError('too-new', `The file uses container version ${version}, newer than this build supports.`);
  const len = buf.readUInt32LE(12);
  if (buf.length < HEADER + len) throw new ContainerError('truncated', 'The file is incomplete: it ends before its content does.');
  if (buf.length > HEADER + len) throw new ContainerError('trailing', 'The file has unexpected extra data after its content.');
  const payload = buf.subarray(HEADER, HEADER + len);
  if (crc32(payload) !== buf.readUInt32LE(16)) throw new ContainerError('checksum', 'The file is damaged: its checksum does not match its content.');
  return { flags: buf.readUInt16LE(10), payload };
}

export async function decode(buf) {
  const { flags, payload } = check(buf);
  try {
    const raw = flags & FLAG_GZIP ? await gunzip(payload) : payload;
    return raw.toString('utf8');
  } catch (e) {
    throw new ContainerError('corrupt', 'The file content could not be decompressed: ' + e.message);
  }
}
