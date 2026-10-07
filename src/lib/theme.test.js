import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMode, initializeDemoTheme, setMode, watchSystem } from './theme.js';

const values = new Map();
let mediaChange;
let darkOS = false;
const root = { dataset: {} };

function setup() {
  values.clear();
  root.dataset = {};
  mediaChange = undefined;
  darkOS = false;
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  });
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return darkOS; },
    addEventListener: (_event, callback) => { mediaChange = callback; },
    removeEventListener: () => { mediaChange = undefined; },
  }));
  vi.stubGlobal('document', {
    documentElement: root,
    querySelector: () => null,
  });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
}

afterEach(() => vi.unstubAllGlobals());

describe('demo theme', () => {
  it.each([null, 'invalid'])('defaults missing or invalid preference to dark (%s)', (stored) => {
    setup();
    if (stored) values.set('nutri-theme', stored);
    initializeDemoTheme();
    expect(getMode()).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
  });

  it.each(['light', 'dark', 'system'])('preserves saved %s preference', (mode) => {
    setup();
    values.set('nutri-theme', mode);
    initializeDemoTheme();
    expect(getMode()).toBe(mode);
  });

  it('keeps a defaulted demo dark when the OS theme changes', () => {
    setup();
    initializeDemoTheme();
    const stopWatching = watchSystem();
    darkOS = true;
    mediaChange();
    expect(root.dataset.theme).toBe('dark');
    darkOS = false;
    mediaChange();
    expect(root.dataset.theme).toBe('dark');
    stopWatching();
  });

  it('retains an explicitly selected light theme when the demo is re-entered', () => {
    setup();
    setMode('light');
    initializeDemoTheme();
    expect(getMode()).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });

  it.each([
    ['?demo=1', null, false, 'dark'],
    ['?demo=1', 'light', true, 'light'],
    ['?demo=1', 'system', true, 'dark'],
    ['', null, false, 'light'],
    ['', 'invalid', false, 'light'],
  ])('sets first paint for search=%s preference=%s darkOS=%s', (search, stored, dark, expected) => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const [, script] = html.match(/<script>([\s\S]*?)<\/script>/);
    const data = { dataset: {} };
    const meta = { content: '' };
    const localValues = new Map(stored ? [['nutri-theme', stored]] : []);
    runInNewContext(script, {
      localStorage: { getItem: (key) => localValues.get(key) ?? null },
      location: { search },
      matchMedia: () => ({ matches: dark }),
      document: { documentElement: data, querySelector: () => meta },
      URLSearchParams,
    });
    expect(data.dataset.theme).toBe(expected);
  });
});
