// ponytail: store módulo-nivel para que la página activa (hoy solo Today)
// publique las acciones del botón "Más opciones" que vive en App.jsx, sin
// levantar el estado de la página al layout. Mismo espíritu que el evento
// `labels-changed`. Cada acción: { key, label, icon, onClick }.
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
