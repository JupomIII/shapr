// Local-only persistence. Projects live in IndexedDB; nothing leaves the device.

import { ProjectDoc } from '../model/types';

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  doc: ProjectDoc;
  thumbnail?: string;
}

const DB_NAME = 'shapr-db';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Never let a stalled IndexedDB request freeze the interface. */
function withTimeout<T>(p: Promise<T>, fallback: T, ms = 4000): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const all = await withTimeout(
    tx<ProjectRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ProjectRecord[]>),
    [] as ProjectRecord[],
  );
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const rec = await withTimeout(
    tx<ProjectRecord | undefined>('readonly', (s) => s.get(id)),
    undefined,
  );
  return rec ?? null;
}

export async function saveProject(rec: ProjectRecord): Promise<void> {
  await withTimeout(tx('readwrite', (s) => s.put(rec)), undefined, 6000);
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

export async function duplicateProject(id: string): Promise<ProjectRecord | null> {
  const rec = await getProject(id);
  if (!rec) return null;
  const copy: ProjectRecord = {
    ...rec,
    id: crypto.randomUUID(),
    name: `${rec.name} copy`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    doc: { ...rec.doc, id: crypto.randomUUID(), name: `${rec.name} copy` },
  };
  await saveProject(copy);
  return copy;
}
