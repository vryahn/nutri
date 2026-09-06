import { describe, it, expect, beforeEach, vi } from 'vitest';

// A localStorage stand-in: cache.js persists through it and this is also how the quota
// failure is exercised. Installed before importing the modules under test.
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

vi.mock('./supabase.js', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [] }) }) }) } }));

const FOODS = [
  { id: 'f1', name: 'Whole egg', brand: null, kcal: 155, micros: { sodio_mg: 124 } },
  { id: 'f2', name: 'Banana', brand: null, kcal: 89, micros: {} },
  { id: 'f3', name: 'Greek yogurt', brand: 'Fage', kcal: 59, micros: {} },
];

async function fresh() {
  globalThis.localStorage = fakeStorage();
  vi.resetModules();
  const cache = await import('./cache.js');
  const catalog = await import('./catalog.js');
  return { cache, catalog };
}

describe('catalog search (offline fallback)', () => {
  let catalog;
  beforeEach(async () => {
    const m = await fresh();
    catalog = m.catalog;
    m.cache.cacheSet('foods', FOODS);
    m.cache.cacheSet('recipes', [{ id: 'r1', name: 'Egg salad' }]);
  });

  it('matches name and brand, case-insensitively, like the ilike query it replaces', () => {
    expect(catalog.searchCatalog('egg').foods.map((f) => f.id)).toEqual(['f1']);
    expect(catalog.searchCatalog('FAGE').foods.map((f) => f.id)).toEqual(['f3']);
    expect(catalog.searchCatalog('egg').recipes.map((r) => r.id)).toEqual(['r1']);
  });

  it('an empty query matches nothing (never the whole catalog)', () => {
    expect(catalog.searchCatalog('  ')).toEqual({ foods: [], recipes: [] });
  });

  it('catalogFood returns the per-100 g row so an offline pick can still be computed', () => {
    expect(catalog.catalogFood('f1').kcal).toBe(155);
    expect(catalog.catalogFood('nope')).toBeNull();
  });
});

describe('cache persistence', () => {
  it('survives a reload for the keys a cold offline start needs', async () => {
    const { cache } = await fresh();
    cache.cacheSet('foods', FOODS);
    cache.cacheSet('labels', [{ id: 'l1' }]);
    await new Promise((r) => setTimeout(r, 5)); // the write is batched to the next tick
    vi.resetModules();
    const reloaded = await import('./cache.js');
    expect(reloaded.cacheGet('foods')).toHaveLength(3);
    expect(reloaded.cacheGet('labels')).toEqual([{ id: 'l1' }]);
  });

  it('does not persist open-ended keys that would grow until the quota breaks', async () => {
    const { cache } = await fresh();
    cache.cacheSet('dash:2026-01-01:2026-12-31', { big: true });
    cache.cacheSet('entries:2020-01-01', [{ id: 'old' }]);
    cache.cacheSet('foods', FOODS); // forces the write
    await new Promise((r) => setTimeout(r, 5));
    vi.resetModules();
    const reloaded = await import('./cache.js');
    expect(reloaded.cacheGet('dash:2026-01-01:2026-12-31')).toBeUndefined();
    expect(reloaded.cacheGet('entries:2020-01-01')).toBeUndefined();
    expect(reloaded.cacheGet('foods')).toHaveLength(3);
  });

  it('signing out wipes what was persisted', async () => {
    const { cache } = await fresh();
    cache.cacheSet('foods', FOODS);
    await new Promise((r) => setTimeout(r, 5));
    cache.cacheClear();
    vi.resetModules();
    const reloaded = await import('./cache.js');
    expect(reloaded.cacheGet('foods')).toBeUndefined();
  });

  it('a full or blocked storage never breaks the cache: it keeps working in memory', async () => {
    globalThis.localStorage = fakeStorage();
    globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    vi.resetModules();
    const cache = await import('./cache.js');
    cache.cacheSet('foods', FOODS);
    await new Promise((r) => setTimeout(r, 5));
    expect(cache.cacheGet('foods')).toHaveLength(3);
  });
});
