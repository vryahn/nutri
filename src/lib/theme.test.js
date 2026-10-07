import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMode, initializeDemoTheme, setMode, syncDemoTheme, watchSystem } from './theme.js';

const localValues = new Map();
const sessionValues = new Map();
let mediaChange;
let darkOS = false;
const root = { dataset: {} };

function setup() {
  localValues.clear();
  sessionValues.clear();
  root.dataset = {};
  mediaChange = undefined;
  darkOS = false;
  const storage = (values) => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  });
  vi.stubGlobal('localStorage', storage(localValues));
  vi.stubGlobal('sessionStorage', storage(sessionValues));
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return darkOS; },
    addEventListener: (_event, callback) => { mediaChange = callback; },
    removeEventListener: () => { mediaChange = undefined; },
  }));
  vi.stubGlobal('document', { documentElement: root, querySelector: () => null });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
}

function firstPaint(search, savedDemo, savedNormal, osDark) {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const [, script] = html.match(/<script>([\s\S]*?)<\/script>/);
  const values = new Map([
    ...(savedDemo ? [['nutri-demo-theme', savedDemo]] : []),
    ...(savedNormal ? [['nutri-theme', savedNormal]] : []),
  ]);
  const data = { dataset: {} };
  const meta = { content: '' };
  runInNewContext(script, {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    location: { search },
    matchMedia: () => ({ matches: osDark }),
    document: { documentElement: data, querySelector: () => meta },
    URLSearchParams,
  });
  return { theme: data.dataset.theme, values };
}

afterEach(() => vi.unstubAllGlobals());

describe('demo theme', () => {
  it('starts every new demo dark without changing the normal preference', () => {
    setup();
    localValues.set('nutri-theme', 'light');
    sessionValues.set('nutri-demo-theme', 'light');
    initializeDemoTheme();
    expect(getMode()).toBe('dark');
    expect(sessionValues.get('nutri-demo-theme')).toBe('dark');
    expect(localValues.get('nutri-theme')).toBe('light');
  });

  it('stores a demo light choice in session storage and keeps it across reload', () => {
    setup();
    localValues.set('nutri-theme', 'dark');
    initializeDemoTheme();
    setMode('light');
    syncDemoTheme(true);
    expect(getMode()).toBe('light');
    expect(sessionValues.get('nutri-demo-theme')).toBe('light');
    expect(localValues.get('nutri-theme')).toBe('dark');
  });

  it.each(['light', 'system', 'dark'])('restores normal %s preference when demo ends', (mode) => {
    setup();
    localValues.set('nutri-theme', mode);
    initializeDemoTheme();
    setMode('light');
    syncDemoTheme(false);
    expect(getMode()).toBe(mode);
    expect(sessionValues.has('nutri-demo-theme')).toBe(false);
    expect(localValues.get('nutri-theme')).toBe(mode);
  });

  it('defaults a reloaded anonymous session to dark when its demo theme is absent or invalid', () => {
    for (const stored of [null, 'invalid']) {
      setup();
      localValues.set('nutri-theme', 'light');
      if (stored) sessionValues.set('nutri-demo-theme', stored);
      syncDemoTheme(true);
      expect(getMode()).toBe('dark');
      expect(localValues.get('nutri-theme')).toBe('light');
    }
  });

  it('preserves a saved demo light theme when an anonymous session reloads', () => {
    setup();
    localValues.set('nutri-theme', 'dark');
    sessionValues.set('nutri-demo-theme', 'light');
    syncDemoTheme(true);
    expect(getMode()).toBe('light');
    expect(root.dataset.theme).toBe('light');
    expect(localValues.get('nutri-theme')).toBe('dark');
  });

  it('watches OS changes using the active demo system preference only', () => {
    setup();
    localValues.set('nutri-theme', 'system');
    initializeDemoTheme();
    setMode('system');
    const stopWatching = watchSystem();
    darkOS = true;
    mediaChange();
    expect(root.dataset.theme).toBe('dark');
    darkOS = false;
    mediaChange();
    expect(root.dataset.theme).toBe('light');
    stopWatching();
    syncDemoTheme(false);
    expect(root.dataset.theme).toBe('light');
  });

  it.each([
    ['?demo=1', 'light', 'light', false, 'dark', 'dark'],
    ['?demo=1', null, 'light', false, 'dark', 'dark'],
    ['', 'light', 'dark', false, 'light', 'light'],
    ['', null, 'light', false, 'light', null],
    ['', null, null, true, 'dark', null],
  ])('sets first paint for search=%s demo=%s normal=%s darkOS=%s', (search, demo, normal, osDark, expected, expectedDemo) => {
    const result = firstPaint(search, demo, normal, osDark);
    expect(result.theme).toBe(expected);
    expect(result.values.get('nutri-demo-theme') ?? null).toBe(expectedDemo);
  });
});
