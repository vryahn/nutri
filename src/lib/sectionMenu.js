import { createContext, useContext, useLayoutEffect, useRef } from 'react';

// ponytail: module-level store so the active page
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

export const SectionAddContext = createContext(null);

// The page owns its editor. The navigation chrome forwards a click to the
// current page without subscribing the layout to every change in its form.
export function useSectionAdd(path, onAdd, enabled = true) {
  const register = useContext(SectionAddContext);
  const actionRef = useRef(onAdd);
  useLayoutEffect(() => { actionRef.current = onAdd; }, [onAdd]);
  useLayoutEffect(() => {
    if (!register || !enabled) return;
    const action = { path, run: () => actionRef.current() };
    register(action);
    return () => register((current) => current === action ? null : current);
  }, [register, path, enabled]);
}
