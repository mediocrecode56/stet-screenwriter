// Files on this device, which is also how iCloud Drive is reached (docs/CLOUD.md): Apple offers no
// web API for it, so the device's own file picker and share sheet are the way in and out.
//
// What a browser can do differs, and the differences matter to the writer:
//   Chrome, Edge (computers, Android)  File System Access: open a file and save over it, in place.
//   Safari, Firefox, iPhone, iPad      Open through the picker; saving hands over a new copy.

/** What this browser can do. `w` stands in for window in tests. */
export function abilities(w = globalThis) {
  const nav = w.navigator || {};
  const apple = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return {
    inPlace: typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function',
    share: typeof nav.canShare === 'function' && typeof nav.share === 'function',
    apple,
  };
}

const TYPES = [{ description: 'STET screenplay', accept: { 'application/x-stet': ['.stet'], 'application/xml': ['.fdx'] } }];
const SAVE_TYPES = [{ description: 'STET screenplay', accept: { 'application/x-stet': ['.stet'] } }];

/** A place to save to. write(bytes) puts the bytes there; `inPlace` means saving updates that same file. */
export class HandlePlace {
  constructor(handle, modified = null) { this.kind = 'handle'; this.handle = handle; this.modified = modified; this.inPlace = true; this.label = 'this device'; }
  get name() { return this.handle.name; }

  /** False once the writer has taken permission away, or a new visit has not been given it yet. */
  async allowed(ask = false) {
    const opts = { mode: 'readwrite' };
    if (!this.handle.queryPermission) return true;
    if ((await this.handle.queryPermission(opts)) === 'granted') return true;
    return ask && (await this.handle.requestPermission(opts)) === 'granted';
  }

  /** Whether something else changed the file since it was last read or written here. */
  async changedElsewhere() {
    if (this.modified == null) return false;
    const f = await this.handle.getFile();
    return f.lastModified !== this.modified;
  }

  async write(bytes) {
    const out = await this.handle.createWritable(); // (the browser swaps the file in only on close)
    await out.write(bytes);
    await out.close();
    this.modified = (await this.handle.getFile()).lastModified;
  }

  remember() { return { kind: 'handle', handle: this.handle }; }
}

/** A file picked the plain way: it can be read, and saving hands over a new copy. */
export class CopyPlace {
  constructor(name = 'Untitled.stet') { this.kind = 'copy'; this.name = name; this.inPlace = false; this.label = 'a copy'; }
  remember() { return { kind: 'copy', name: this.name }; }
}

/** Ask for a file. Returns { bytes, name, place } or null if none was chosen. */
export async function pickFile(w = window) {
  if (abilities(w).inPlace) {
    let handle;
    try { [handle] = await w.showOpenFilePicker({ types: TYPES, multiple: false }); } catch (e) { if (e.name === 'AbortError') return null; throw e; }
    const f = await handle.getFile();
    const bytes = new Uint8Array(await f.arrayBuffer());
    return { bytes, name: f.name, place: /\.stet$/i.test(f.name) ? new HandlePlace(handle, f.lastModified) : new CopyPlace(f.name) };
  }
  const f = await chooseWithInput(w);
  if (!f) return null;
  return { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name, place: new CopyPlace(f.name) };
}

function chooseWithInput(w) {
  return new Promise((resolve) => {
    const el = w.document.createElement('input');
    el.type = 'file';
    // An iPhone or iPad greys out extensions it does not know, so there every file can be chosen and
    // the file's own header decides (container.js).
    if (!abilities(w).apple) el.accept = '.stet,.fdx';
    el.addEventListener('change', () => resolve(el.files[0] || null));
    el.addEventListener('cancel', () => resolve(null));
    el.click();
  });
}

/** Ask where to save. Returns a HandlePlace, or null if the writer changed their mind. */
export async function pickSavePlace(name, w = window) {
  try { return new HandlePlace(await w.showSaveFilePicker({ suggestedName: name, types: SAVE_TYPES })); } catch (e) { if (e.name === 'AbortError') return null; throw e; }
}

/** Hand the writer a copy: the share sheet where there is one (Save to Files reaches iCloud Drive), a download elsewhere. */
export async function handOver(bytes, name, { type = 'application/octet-stream', w = window } = {}) {
  const file = new w.File([bytes], name, { type });
  if (abilities(w).share && abilities(w).apple && w.navigator.canShare({ files: [file] })) {
    try { await w.navigator.share({ files: [file] }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return null; }
  }
  const url = w.URL.createObjectURL(file), a = w.document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => w.URL.revokeObjectURL(url), 30000)?.unref?.();
  return 'downloaded';
}
