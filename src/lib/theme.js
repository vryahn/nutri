// Normal theme lives in localStorage; the demo theme lasts in sessionStorage.
// Both are applied before the first paint, before the auth request completes.

const KEY = 'nutri-theme';
const DEMO_KEY = 'nutri-demo-theme';
export const MODES = ['system', 'light', 'dark'];

const mq = () => matchMedia('(prefers-color-scheme: dark)');

export function getMode() {
  const demoMode = sessionStorage.getItem(DEMO_KEY);
  const raw = MODES.includes(demoMode) ? demoMode : localStorage.getItem(KEY);
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
  if (sessionStorage.getItem(DEMO_KEY) !== null) sessionStorage.setItem(DEMO_KEY, mode);
  else localStorage.setItem(KEY, mode);
  applyMode(mode);
}

export function initializeDemoTheme() {
  sessionStorage.setItem(DEMO_KEY, 'dark');
  applyMode('dark');
}

export function syncDemoTheme(isDemo) {
  if (!isDemo) {
    sessionStorage.removeItem(DEMO_KEY);
    applyMode(getMode());
    return;
  }
  const stored = sessionStorage.getItem(DEMO_KEY);
  const mode = MODES.includes(stored) ? stored : 'dark';
  sessionStorage.setItem(DEMO_KEY, mode);
  applyMode(mode);
}

// The OS may switch themes while the app is open; only relevant in 'system' mode.
export function watchSystem() {
  const m = mq();
  const onChange = () => getMode() === 'system' && applyMode('system');
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}
