// In-memory session cache (homegrown stale-while-revalidate): each page instantly
// paints the last thing it saw, and its background refetch updates on arrival. Only
// data belonging to the authenticated user; App.jsx clears it on sign-out. It does
// not persist (reloading the PWA = clean memory), so it never crosses users or sessions.
const store = new Map();

export const cacheGet = (key) => store.get(key);
export const cacheSet = (key, value) => {
  store.set(key, value);
  return value;
};
export const cacheClear = () => store.clear();
