// Cache de sesión en memoria (stale-while-revalidate casero): cada página pinta
// al instante lo último que vio y su refetch de fondo actualiza al llegar. Solo
// datos del usuario autenticado; App.jsx lo vacía al cerrar sesión. No persiste
// (recargar la PWA = memoria limpia), así que nunca cruza usuarios ni sesiones.
const store = new Map();

export const cacheGet = (key) => store.get(key);
export const cacheSet = (key, value) => {
  store.set(key, value);
  return value;
};
export const cacheClear = () => store.clear();
