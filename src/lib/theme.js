// Tema claro/oscuro. El modo vive en localStorage (no en prefs de Supabase:
// debe aplicarse antes del primer paint, mucho antes de que responda la red).
// El script inline de index.html hace la primera aplicación; esto la mantiene.

const KEY = 'nutri-theme';
export const MODES = ['system', 'light', 'dark'];

const mq = () => matchMedia('(prefers-color-scheme: dark)');

export function getMode() {
  const raw = localStorage.getItem(KEY);
  return MODES.includes(raw) ? raw : 'system';
}

const resolve = (mode) => (mode === 'system' ? (mq().matches ? 'dark' : 'light') : mode);

function applyMode(mode) {
  const root = document.documentElement;
  root.dataset.theme = resolve(mode);
  // El color se lee del token ya aplicado, no de una copia del hex: así cambiar
  // la paleta en index.css no deja el theme-color apuntando al color anterior.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function setMode(mode) {
  localStorage.setItem(KEY, mode);
  applyMode(mode);
}

// El SO puede cambiar de tema con la app abierta; solo importa en modo 'system'.
export function watchSystem() {
  const m = mq();
  const onChange = () => getMode() === 'system' && applyMode('system');
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}
