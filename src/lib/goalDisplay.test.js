import { describe, expect, it } from 'vitest';
import { goalScale, goalTone } from './goalDisplay.js';

const state = (key, value, bound, coupled = false) => ({
  meta: { key }, value, bound, explicitBound: bound, coupled,
});

describe('goal display', () => {
  it('advances every bounded rail from zero to its applicable limit', () => {
    const cases = [
      [{ min: 1880, max: 2443 }, [[1271, 1271 / 2443]]],
      [{ min: 220, max: 327 }, [[0, 0], [92, 92 / 327], [220, 220 / 327], [273.5, 273.5 / 327], [327, 1], [350, 1]]],
      [{ min: 160, max: null }, [[0, 0], [143, 143 / 160], [160, 1], [180, 1]]],
      [{ min: 40, max: 55 }, [[37.5, 37.5 / 55]]],
      [{ min: 1600, max: 1800 }, [[1705, 1705 / 1800]]],
      [{ min: 3000, max: 3500 }, [[2495, 2495 / 3500]]],
      [{ min: null, max: 55 }, [[0, 0], [37.5, 37.5 / 55], [55, 1], [60, 1]]],
    ];
    for (const [bound, samples] of cases) {
      const scale = goalScale(state('carbs_g', 0, bound), true);
      for (const [value, progress] of samples) expect(scale.at(value)).toBeCloseTo(progress);
      expect(scale.at(-1)).toBe(0);
    }
    expect(goalScale(state('carbs_g', 92, null), false)).toBeNull();
  });

  it('keeps values below an applicable floor neutral and preserves the ceiling transitions', () => {
    const sodium = { min: 1600, max: 1800 };
    const potassium = { min: 3000, max: 3500 };
    expect(goalTone(state('sodio_mg', 0, sodium), false, false)).toBe('var(--text-3)');
    expect(goalTone(state('sodio_mg', 0, sodium), true, false)).toBe('var(--text-3)');
    expect(goalTone(state('protein_g', 159.5, { min: 160, max: null }), true, true)).toBe('var(--text-3)');
    expect(goalTone(state('carbs_g', 204, { min: 279, max: 327 }), true, true)).toBe('var(--text-3)');
    expect(goalTone(state('potasio_mg', 2266, potassium), true, true)).toBe('var(--text-3)');
    expect(goalTone(state('sodio_mg', 1600, sodium), true, true)).toBe('var(--ok)');
    expect(goalTone(state('sodio_mg', 1705, sodium), true, true)).toContain('var(--near)');
    expect(goalTone(state('sodio_mg', 1800, sodium), true, true)).toBe('var(--warn)');
    expect(goalTone(state('sodio_mg', 1801, sodium), true, true)).toBe('var(--danger)');
    expect(goalTone(state('sodio_mg', 3124, sodium), true, true)).toBe('var(--danger)');
    expect(goalTone(state('potasio_mg', 2495, null), true, true)).toBe('var(--text-3)');
  });

  it('supports floors and ceilings independently', () => {
    expect(goalTone(state('protein_g', 0, { min: 160, max: null }), true, true)).toBe('var(--text-3)');
    expect(goalTone(state('protein_g', 160, { min: 160, max: null }), true, true)).toBe('var(--ok)');
    expect(goalTone(state('protein_g', 180, { min: 160, max: null }), true, true)).toBe('var(--ok)');
    expect(goalTone(state('sodio_mg', 0, { min: null, max: 1800 }), true, true)).toBe('var(--ok)');
    expect(goalTone(state('sodio_mg', 1800, { min: null, max: 1800 }), true, true)).toBe('var(--warn)');
    expect(goalTone(state('sodio_mg', 1801, { min: null, max: 1800 }), true, true)).toBe('var(--danger)');
  });

  it('uses the declared envelope for coupled carbs and fat', () => {
    const bound = { min: 40, max: 52 };
    const coupled = { ...state('fat_g', 37.5, bound, true), bound: { min: 100, max: 120 } };
    expect(goalTone(coupled, true, true)).toBe('var(--text-3)');
    expect(goalTone({ ...coupled, value: 40 }, true, true)).toBe('var(--ok)');
    expect(goalTone({ ...coupled, value: 52 }, true, true)).toBe('var(--warn)');
    expect(goalTone({ ...coupled, value: 82.8 }, true, true)).toBe('var(--danger)');
    expect(goalScale(coupled, true).at(37.5)).toBeCloseTo(37.5 / 52);
  });
});
