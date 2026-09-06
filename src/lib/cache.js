// Stale-while-revalidate cache (homegrown): each page instantly paints the last thing it
// saw and its background refetch updates on arrival.
//
// Persisted in localStorage, so opening the installed PWA with no connection paints the
// catalog, today's entries, labels and targets instead of an empty app — without it a
// cold start offline cannot even search for a food to log. Only data belonging to the
// authenticated user: App.jsx clears it on sign-out, so it never crosses users.
//
// What survives a reload is an explicit list, not everything: an open-ended cache would
// grow with every day and every dashboard range visited until it hit the storage quota.
// Everything else still works in memory exactly as before.
import { todayISO } from './domain.js';

const KEY = 'nutri.cache';
const PERSIST = new Set(['foods', 'recipes', 'labels', 'targets', 'frequent']);
const persistable = (k) =>
  PERSIST.has(k) || k.startsWith('foodmeta:') || k.startsWith('recipemeta:') || k === `entries:${todayISO()}`;

function load() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}'))); }
  catch { return new Map(); } // private mode, corrupt JSON, no localStorage: memory only
}

const store = load();
let persistOff = false;
let scheduled = false;

// One write per tick: a single page load fills a dozen keys and the catalog is a few
// hundred KB — serializing on every set would be felt on a phone.
function schedulePersist() {
  if (persistOff || scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const obj = {};
    for (const [k, v] of store) if (persistable(k)) obj[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(obj));
    } catch {
      // Quota exceeded or storage blocked: give up on persisting for this session
      // rather than retrying on every set. The cache keeps working in memory.
      persistOff = true;
      try { localStorage.removeItem(KEY); } catch { /* nothing else to do */ }
    }
  }, 0);
}

export const cacheGet = (key) => store.get(key);
export const cacheSet = (key, value) => {
  store.set(key, value);
  if (persistable(key)) schedulePersist();
  return value;
};
export const cacheClear = () => {
  store.clear();
  persistOff = false;
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
};
