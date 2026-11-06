// Drafts: every change is kept in this browser (IndexedDB) until it has reached its file, so a closed
// tab, a lost connection or a crash costs nothing. They never leave this browser. Failing storage
// (a private window, a full disk) is not an error: the writer is simply not protected, and is told.

const DB = 'stet-web', STORE = 'drafts';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/** Keep this draft: { id, name, json, place }. False if it could not be kept. */
export async function keepDraft(draft) {
  try { await tx('readwrite', (s) => s.put({ ...draft, when: Date.now() })); return true; } catch { return false; }
}

export async function dropDraft(id) {
  try { await tx('readwrite', (s) => s.delete(id)); } catch { /* nothing to drop */ }
}

/** Every draft, the newest first. */
export async function listDrafts() {
  try { return ((await tx('readonly', (s) => s.getAll())) || []).sort((a, b) => b.when - a.when); } catch { return []; }
}
