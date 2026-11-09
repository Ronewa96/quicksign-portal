// Original uploaded files live in IndexedDB (localStorage is too small for binaries)

const DB_NAME = 'quicksign_files';
const STORE = 'originals';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = action(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export const saveOriginalFile = (docId: string, file: Blob) => run<void>('readwrite', (s) => s.put(file, docId));

export const getOriginalFile = (docId: string) => run<Blob | undefined>('readonly', (s) => s.get(docId));

export const deleteOriginalFile = (docId: string) =>
  run<void>('readwrite', (s) => s.delete(docId)).catch((e) => console.warn('Failed to delete stored file:', e));
