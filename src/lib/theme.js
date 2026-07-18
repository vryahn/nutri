// Light/dark theme. The mode lives in localStorage (not in Supabase prefs:
// it must be applied before the first paint, long before the network responds).
// The inline script in index.html performs the initial application; this maintains it.

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
  // The color is read from the already-applied token, not from a copy of the hex:
  // that way changing the palette in index.css does not leave the theme-color
  // pointing at the previous color.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function setMode(mode) {
  localStorage.setItem(KEY, mode);
  applyMode(mode);
}

// The OS may switch themes while the app is open; only relevant in 'system' mode.
export function watchSystem() {
  const m = mq();
  const onChange = () => getMode() === 'system' && applyMode('system');
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}
