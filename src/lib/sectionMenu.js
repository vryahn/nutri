// ponytail: module-level store so the active page (currently only Today)
// publishes the actions for the "Más opciones" button that lives in App.jsx,
// without lifting page state up to the layout. Same spirit as the
// `labels-changed` event. Each action: { key, label, icon, onClick }.
let actions = [];
const subs = new Set();

export function setSectionMenu(next) {
  actions = next || [];
  subs.forEach((fn) => fn(actions));
}

export function subscribeSectionMenu(fn) {
  subs.add(fn);
  fn(actions);
  return () => subs.delete(fn);
}
