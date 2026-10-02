// Jednoduchý obal nad IndexedDB – všechna data zůstávají v zařízení.
const DB_NAME = 'muj-denik';
const DB_VERSION = 1;
export const STORES = ['entries', 'media', 'milestones', 'plans', 'days', 'settings'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('date', 'date');
      db.createObjectStore('media', { keyPath: 'id' });
      const ms = db.createObjectStore('milestones', { keyPath: 'id' });
      ms.createIndex('date', 'date');
      db.createObjectStore('plans', { keyPath: 'id' });
      db.createObjectStore('days', { keyPath: 'date' });
      db.createObjectStore('settings');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

const req = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const get = async (name, key) => req((await store(name)).get(key));
export const all = async name => req((await store(name)).getAll());
export const put = async (name, value, key) => req((await store(name, 'readwrite')).put(value, key));
export const del = async (name, key) => req((await store(name, 'readwrite')).delete(key));
export const clear = async name => req((await store(name, 'readwrite')).clear());
export const byRange = async (name, index, lower, upper) =>
  req((await store(name)).index(index).getAll(IDBKeyRange.bound(lower, upper)));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- Nastavení ----
export const DEFAULTS = {
  name: '',
  bookTitle: 'Můj deník',
  font: 'hand',
  theme: 'auto',
  sobriety: false,
  soberStart: '',
  dailyCost: 150,
  currency: 'Kč',
  longestStreak: 0,
  photoQuality: 'medium',
  corrections: 'nevim=nevím\nvim=vím\nprotoze=protože\njeste=ještě\nuz=už\nmozna=možná\ndekuju=děkuju',
  contacts: '',
  letter: '',
  reasons: '',
  pinHash: '',
  reminderTime: '21:00',
  saveDictationAudio: false
};

let cache = null;
export async function settings() {
  if (cache) return cache;
  const s = { ...DEFAULTS };
  const db = await open();
  const st = db.transaction('settings').objectStore('settings');
  const keys = await req(st.getAllKeys());
  const vals = await req(db.transaction('settings').objectStore('settings').getAll());
  keys.forEach((k, i) => { s[k] = vals[i]; });
  cache = s;
  return s;
}
export async function setSetting(key, value) {
  await put('settings', value, key);
  if (cache) cache[key] = value;
}
export function resetSettingsCache() { cache = null; }
