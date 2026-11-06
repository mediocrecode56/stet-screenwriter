// The .stet container in the browser: the same bytes as src/main/container.js, written with what a
// browser has (Uint8Array, DataView, CompressionStream) in place of Node's Buffer and zlib. The format
// is docs/FILE_FORMAT.md; test/container.test.js proves each side reads what the other writes.

export const MAGIC = Uint8Array.of(0x53, 0x54, 0x45, 0x54, 0x0d, 0x0a, 0x1a, 0x0a);
export const CONTAINER_VERSION = 1;
const HEADER = 20;
const FLAG_GZIP = 1;

export class ContainerError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let table = null;
export function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const through = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function encode(json) {
  const payload = await through(new TextEncoder().encode(json), new CompressionStream('gzip'));
  const out = new Uint8Array(HEADER + payload.length);
  const head = new DataView(out.buffer);
  out.set(MAGIC, 0);
  head.setUint16(8, CONTAINER_VERSION, true);
  head.setUint16(10, FLAG_GZIP, true);
  head.setUint32(12, payload.length, true);
  head.setUint32(16, crc32(payload), true);
  out.set(payload, HEADER);
  return out;
}

/** Validate header, length and checksum without decompressing. */
export function check(bytes) {
  if (bytes.length < HEADER) throw new ContainerError('truncated', 'The file is too short to be a STET document (it may be incomplete).');
  if (!MAGIC.every((b, i) => bytes[i] === b)) {
    if (String.fromCharCode(...bytes.subarray(0, 4)) === 'STET') throw new ContainerError('mangled', 'The file header is damaged (line endings were altered by another program).');
    throw new ContainerError('not-stet', 'This is not a STET document.');
  }
  const head = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  const version = head.getUint16(8, true);
  if (version > CONTAINER_VERSION) throw new ContainerError('too-new', `The file uses container version ${version}, newer than this version of STET supports.`);
  const len = head.getUint32(12, true);
  if (bytes.length < HEADER + len) throw new ContainerError('truncated', 'The file is incomplete: it ends before its content does.');
  if (bytes.length > HEADER + len) throw new ContainerError('trailing', 'The file has unexpected extra data after its content.');
  const payload = bytes.subarray(HEADER, HEADER + len);
  if (crc32(payload) !== head.getUint32(16, true)) throw new ContainerError('checksum', 'The file is damaged: its checksum does not match its content.');
  return { flags: head.getUint16(10, true), payload };
}

export async function decode(bytes) {
  const { flags, payload } = check(bytes);
  try {
    const raw = flags & FLAG_GZIP ? await through(payload, new DecompressionStream('gzip')) : payload;
    return new TextDecoder().decode(raw);
  } catch (e) {
    throw new ContainerError('corrupt', 'The file content could not be decompressed: ' + e.message);
  }
}
