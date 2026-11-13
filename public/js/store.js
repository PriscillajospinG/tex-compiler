// Saves the project in the browser (IndexedDB), so it survives a page reload.
// Everything is best effort: if storage is unavailable the app still works.

const DB_NAME = 'tex-compiler';
const STORE = 'project';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result && result.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

/** @returns {Promise<{files: Array<{path, text?, blob?}>, main, active, engine} | null>} */
export async function loadProject() {
  try {
    const saved = await tx('readonly', (s) => s.get(KEY));
    if (saved && Array.isArray(saved.files)) return saved;
  } catch { /* storage unavailable */ }

  // Migrate a draft saved by the earlier single-file version of the app.
  try {
    const old = JSON.parse(localStorage.getItem('tex-compiler:draft') || 'null');
    if (old && typeof old.source === 'string') {
      return { files: [{ path: 'main.tex', text: old.source }], main: 'main.tex', active: 'main.tex', engine: old.engine };
    }
  } catch { /* ignore */ }
  return null;
}

export async function saveProject(project) {
  try {
    await tx('readwrite', (s) => s.put(project, KEY));
    try { localStorage.removeItem('tex-compiler:draft'); } catch { /* ignore */ }
    return true;
  } catch {
    return false;
  }
}
