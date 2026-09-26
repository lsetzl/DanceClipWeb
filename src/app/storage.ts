// IndexedDB: projects(動画ごとの設定)、cache(解析結果)
import type { Project } from './state';

const DB_NAME = 'danceclip';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const fileKey = (f: { name: string; size: number }) => `${f.name}|${f.size}`;

export interface SavedProject {
  key: string;
  p: Project;
  updated: number;
  videoName: string;
  audioName: string;
  audioKey: string | null;
  videoHandle?: FileSystemFileHandle;
  audioHandle?: FileSystemFileHandle;
}

export const saveProject = (r: SavedProject) => run('projects', 'readwrite', (s) => s.put(r));
export const loadProject = (key: string) => run<SavedProject | undefined>('projects', 'readonly', (s) => s.get(key));
export const deleteProject = (key: string) => run('projects', 'readwrite', (s) => s.delete(key));

export async function recentProjects(limit = 15): Promise<SavedProject[]> {
  const all = await run<SavedProject[]>('projects', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updated - a.updated).slice(0, limit);
}

export const cacheGet = <T>(key: string) => run<T | undefined>('cache', 'readonly', (s) => s.get(key));
export const cachePut = (key: string, v: unknown) => run('cache', 'readwrite', (s) => s.put(v, key));

export const cacheKey = (kind: string, f: File) => `${kind}|${f.name}|${f.size}|${f.lastModified}`;
