import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapOFF, toDomainUnit, sweetenerAdditives, fillFoodSource, photoMatchesOFF } from './sources.js';

import { normalizeTo100 } from './domain.js';

describe('mapOFF', () => {
  it('sodium_100g in grams -> ×1000 to mg', () => {
    const p = {
      product_name: 'Refresco', brands: 'Marca X',
      nutriments: { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0, sodium_100g: 0.02 },
      nutrition_data_per: '100g',
    };
    expect(mapOFF(p).micros.sodio_mg).toBe(20);
  });

  it('fallback: without sodium_100g, uses salt_100g / 2.5 × 1000', () => {
    const p = {
      product_name: 'Galletas', brands: '',
      nutriments: { salt_100g: 0.5 },
      nutrition_data_per: '100g',
    };
    expect(mapOFF(p).micros.sodio_mg).toBe(200);
  });

  it('does not turn blank or invalid upstream numbers into measured zeroes', () => {
    const out = mapOFF({ nutriments: {
      'energy-kcal_100g': '', energy_100g: 418.4, proteins_100g: ' ', fat_100g: -0.001,
      fiber_100g: '', 'trans-fat_100g': 0, sodium_100g: '', salt_100g: '0,25',
    } });
    expect(out).toMatchObject({ kcal: 100, protein_g: '', fat_g: '', micros: { grasa_trans_g: 0, sodio_mg: 100 } });
    expect(out.micros.fibra_g).toBeUndefined();
  });

  it('nutrition_data_per 100ml is exposed in per', () => {
    const p = {
      product_name: 'Jugo', brands: '',
      nutriments: { 'energy-kcal_100g': 52 },
      nutrition_data_per: '100ml',
    };
    expect(mapOFF(p).per).toBe('100ml');
  });

  it('nutrition_data_per missing/different from 100ml -> per 100g', () => {
    const p = { product_name: 'X', brands: '', nutriments: {} };
    expect(mapOFF(p).per).toBe('100g');
  });

  it('caffeine_100g in grams -> ×1000 to mg', () => {
    const p = { product_name: 'Energética', brands: '', nutriments: { caffeine_100g: 0.032 }, nutrition_data_per: '100g' };
    expect(mapOFF(p).micros.cafeina_mg).toBe(32);
  });
});

describe('sweetenerAdditives', () => {
  it('detects sweeteners by E-number (includes suffixes like e960c)', () => {
    const p = { additives_tags: ['en:e150d', 'en:e331', 'en:e951', 'en:e960c'] };
    const out = sweetenerAdditives(p);
    expect(out).toEqual([
      { code: 'E951', name: 'aspartamo' },
      { code: 'E960', name: 'glucósidos de esteviol' },
    ]);
  });

  it('no sweetener additives -> empty list', () => {
    expect(sweetenerAdditives({ additives_tags: ['en:e322', 'en:e500'] })).toEqual([]);
    expect(sweetenerAdditives({})).toEqual([]);
  });
});

describe('toDomainUnit', () => {
  it('same unit -> passes through', () => {
    expect(toDomainUnit(100, 'kcal', 'kcal')).toBe(100);
  });

  it('g -> mg: ×1000', () => {
    expect(toDomainUnit(1, 'g', 'mg')).toBe(1000);
  });

  it('mg -> µg: ×1000', () => {
    expect(toDomainUnit(1, 'mg', 'µg')).toBe(1000);
  });

  it('g -> ml: 1:1 (water)', () => {
    expect(toDomainUnit(50, 'g', 'ml')).toBe(50);
  });

  it('non-convertible unit -> null (discarded, never the wrong unit)', () => {
    expect(toDomainUnit(5, 'IU', 'mg')).toBeNull();
  });
});

describe('fetchFDC: kcal priority 1008 > 2048 > 2047', () => {
  // FDC_KEY is read from import.meta.env at module load: the env must be stubbed
  // and the module re-imported (vi.resetModules) so the constant picks up the new value.
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

  it('with 1008 present, ignores 2047 and 2048', async () => {
    mockFoodNutrients([
      [2047, 400, 'kcal'],
      [2048, 410, 'kcal'],
      [1008, 123, 'kcal'],
    ]);
    const { fetchFDC } = await import('./sources.js');
    const out = await fetchFDC('999');
    expect(out.kcal).toBe(123);
  });

  it('without 1008, uses 2048 over 2047', async () => {
    mockFoodNutrients([
      [2047, 400, 'kcal'],
      [2048, 410, 'kcal'],
    ]);
    const { fetchFDC } = await import('./sources.js');
    const out = await fetchFDC('999');
    expect(out.kcal).toBe(410);
  });

  it('only 2047 -> uses it', async () => {
    mockFoodNutrients([[2047, 390, 'kcal']]);
    const { fetchFDC } = await import('./sources.js');
    const out = await fetchFDC('999');
    expect(out.kcal).toBe(390);
  });
});


describe('fillFoodSource', () => {
  const label = { basis: '100ml', protein_g: 2.4, carbs_g: '', fat_g: 0, density_g_ml: 1.2, micros: { sodio_mg: 0 } };
  const off = { per: '100g', name: 'Fixture', carbs_g: 10, fat_g: 3, micros: { calcio_mg: 60, sodio_mg: 10 } };

  it('does not mix per 100 g data into a per 100 ml label, even with density configured', () => {
    const filled = fillFoodSource(label, off);
    expect(filled).toMatchObject({ name: 'Fixture', carbs_g: '', fat_g: 0, micros: { sodio_mg: 0 } });
    expect(normalizeTo100(filled, 100, 'ml')).toMatchObject({ protein_g: 2, carbs_g: '', fat_g: 0, micros: { sodio_mg: 0 } });
    expect(filled.micros).not.toHaveProperty('calcio_mg');
  });

  it('fills same-basis gaps without overwriting label values or a measured zero', () => {
    const filled = fillFoodSource(label, { ...off, per: '100ml' });
    expect(filled).toMatchObject({ carbs_g: 10, fat_g: 0, micros: { sodio_mg: 0, calcio_mg: 60 } });
    expect(normalizeTo100(filled, 100, 'ml').carbs_g).toBe(8.33);
    expect(fillFoodSource(label, null)).toBe(label);
  });

  it('when OFF wins, only same-basis required values fill the gaps', () => {
    const ai = { basis: '100ml', carbs_g: 30, protein_g: 2, micros: { potasio_mg: 20, fibra_g: 1 } };
    expect(fillFoodSource(off, ai, true)).not.toHaveProperty('protein_g');
    const filled = fillFoodSource({ ...off, per: '100ml' }, ai, true);
    expect(filled).toMatchObject({ carbs_g: 10, protein_g: 2, micros: { potasio_mg: 20 } });
    expect(filled.micros).not.toHaveProperty('fibra_g');
  });
});

describe('photo identity without a visible barcode', () => {
  it('requires matching name and brand before using a typed EAN as a supplement', () => {
    const photo = { name: 'Bebida de Limón', brand: 'Marca A' };
    expect(photoMatchesOFF(photo, { name: 'bebida de limon', brand: 'marca a' })).toBe(true);
    expect(photoMatchesOFF(photo, { name: 'Bebida de Limón XL', brand: 'Marca A' })).toBe(false);
    expect(photoMatchesOFF(photo, { name: 'Bebida de Limón', brand: 'Marca B' })).toBe(false);
    expect(photoMatchesOFF({ ...photo, brand: '' }, { ...photo, brand: '' })).toBe(false);
  });
});
