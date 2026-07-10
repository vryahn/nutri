import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapOFF, toDomainUnit } from './sources.js';

describe('mapOFF', () => {
  it('sodium_100g en gramos -> ×1000 a mg', () => {
    const p = {
      product_name: 'Refresco', brands: 'Marca X',
      nutriments: { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0, sodium_100g: 0.02 },
      nutrition_data_per: '100g',
    };
    expect(mapOFF(p).micros.sodio_mg).toBe(20);
  });

  it('fallback: sin sodium_100g, usa salt_100g / 2.5 × 1000', () => {
    const p = {
      product_name: 'Galletas', brands: '',
      nutriments: { salt_100g: 0.5 },
      nutrition_data_per: '100g',
    };
    expect(mapOFF(p).micros.sodio_mg).toBe(200);
  });

  it('nutrition_data_per 100ml se expone en per', () => {
    const p = {
      product_name: 'Jugo', brands: '',
      nutriments: { 'energy-kcal_100g': 52 },
      nutrition_data_per: '100ml',
    };
    expect(mapOFF(p).per).toBe('100ml');
  });

  it('nutrition_data_per ausente/distinto de 100ml -> per 100g', () => {
    const p = { product_name: 'X', brands: '', nutriments: {} };
    expect(mapOFF(p).per).toBe('100g');
  });
});

describe('toDomainUnit', () => {
  it('unidad igual -> pasa directo', () => {
    expect(toDomainUnit(100, 'kcal', 'kcal')).toBe(100);
  });

  it('g -> mg: ×1000', () => {
    expect(toDomainUnit(1, 'g', 'mg')).toBe(1000);
  });

  it('mg -> µg: ×1000', () => {
    expect(toDomainUnit(1, 'mg', 'µg')).toBe(1000);
  });

  it('g -> ml: 1:1 (agua)', () => {
    expect(toDomainUnit(50, 'g', 'ml')).toBe(50);
  });

  it('unidad no convertible -> null (se descarta, nunca unidad equivocada)', () => {
    expect(toDomainUnit(5, 'IU', 'mg')).toBeNull();
  });
});

describe('fetchFDC: prioridad de kcal 1008 > 2048 > 2047', () => {
  // FDC_KEY se lee de import.meta.env al cargar el módulo: hay que stubear el
  // env y reimportar (vi.resetModules) para que la constante tome el valor nuevo.
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_FDC_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function mockFoodNutrients(nutrients) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        description: 'Test food',
        foodNutrients: nutrients.map(([id, amount, unitName]) => ({ nutrient: { id, unitName }, amount })),
      }),
    })));
  }

  it('con 1008 presente, ignora 2047 y 2048', async () => {
    mockFoodNutrients([
      [2047, 400, 'kcal'],
      [2048, 410, 'kcal'],
      [1008, 123, 'kcal'],
    ]);
    const { fetchFDC } = await import('./sources.js');
    const out = await fetchFDC('999');
    expect(out.kcal).toBe(123);
  });

  it('sin 1008, usa 2048 sobre 2047', async () => {
    mockFoodNutrients([
      [2047, 400, 'kcal'],
      [2048, 410, 'kcal'],
    ]);
    const { fetchFDC } = await import('./sources.js');
    const out = await fetchFDC('999');
    expect(out.kcal).toBe(410);
  });

  it('solo 2047 -> lo usa', async () => {
    mockFoodNutrients([[2047, 390, 'kcal']]);
    const { fetchFDC } = await import('./sources.js');
    const out = await fetchFDC('999');
    expect(out.kcal).toBe(390);
  });
});
