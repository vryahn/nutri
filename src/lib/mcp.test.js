import { describe, it, expect } from 'vitest';
import {
  assertValidMicros,
  assertNonNegative,
  assertValidPortions,
  assertValidBodyMetrics,
  bodyMetricWarnings,
  buildWarnings,
  decideUpdatePath,
  recipeResponse,
  mergeBounds,
} from './mcp.js';

describe('assertValidMicros', () => {
  it('rejects keys outside MICROS and lists the valid ones', () => {
    expect(() => assertValidMicros({ vitamina_x_mg: 5 })).toThrow(/vitamina_x_mg/);
    expect(() => assertValidMicros({ vitamina_x_mg: 5 })).toThrow(/sodio_mg/);
  });
  it('accepts valid keys', () => {
    expect(() => assertValidMicros({ sodio_mg: 100, fibra_g: 2 })).not.toThrow();
  });
  it('rechaza micros negativos', () => {
    expect(() => assertValidMicros({ sodio_mg: -500 })).toThrow();
  });
});

describe('assertNonNegative', () => {
  it('rejects negative and non-finite values', () => {
    expect(() => assertNonNegative({ kcal: -1 })).toThrow();
    expect(() => assertNonNegative({ kcal: NaN })).toThrow();
  });
  it('allows missing fields (null/undefined)', () => {
    expect(() => assertNonNegative({ kcal: null, protein_g: undefined })).not.toThrow();
  });
});

describe('assertValidPortions', () => {
  it('rejects a portion without grams > 0', () => {
    expect(() => assertValidPortions([{ name: 'vaso', grams: 0 }])).toThrow();
    expect(() => assertValidPortions([{ grams: 10 }])).toThrow();
  });
  it('accepts valid portions', () => {
    expect(() => assertValidPortions([{ name: 'vaso', grams: 250 }])).not.toThrow();
  });
});

describe('assertValidBodyMetrics', () => {
  it('acepta claves de BODY_METRICS (caso de aceptación: peso + grasa)', () => {
    expect(() => assertValidBodyMetrics({ peso_kg: 80, grasa_pct: 18 })).not.toThrow();
  });
  it('rechaza claves libres y lista las válidas', () => {
    expect(() => assertValidBodyMetrics({ weight_kg: 80 })).toThrow(/weight_kg/);
    expect(() => assertValidBodyMetrics({ weight_kg: 80 })).toThrow(/peso_kg/);
  });
  it('rechaza vacío, no-objeto y valores no numéricos/negativos', () => {
    expect(() => assertValidBodyMetrics({})).toThrow();
    expect(() => assertValidBodyMetrics(null)).toThrow();
    expect(() => assertValidBodyMetrics([1])).toThrow();
    expect(() => assertValidBodyMetrics({ peso_kg: -1 })).toThrow();
    expect(() => assertValidBodyMetrics({ peso_kg: NaN })).toThrow();
  });
});

describe('bodyMetricWarnings', () => {
  it('avisa sobre la cota fisiológica sin bloquear', () => {
    expect(bodyMetricWarnings({ peso_kg: 800 })).toHaveLength(1);
    expect(bodyMetricWarnings({ peso_kg: 80, grasa_pct: 18 })).toEqual([]);
  });
});

describe('buildWarnings', () => {
  it('implausible macros: does NOT block, returns a warning', () => {
    const food = { kcal: 1080, protein_g: 120, carbs_g: 0, fat_g: 0, micros: {} };
    expect(() => buildWarnings(food)).not.toThrow();
    expect(buildWarnings(food).length).toBeGreaterThan(0);
  });
  it('reasonable food: no warnings', () => {
    const food = { kcal: 52, protein_g: 0.3, carbs_g: 14, fat_g: 0.2, micros: { fibra_g: 2.4 } };
    expect(buildWarnings(food)).toEqual([]);
  });
});

describe('decideUpdatePath', () => {
  const uid = 'user-1';
  it("someone else's food (includes base catalog owner null) -> fork", () => {
    expect(decideUpdatePath(null, uid, ['kcal'])).toBe('fork');
    expect(decideUpdatePath('otro-usuario', uid, ['kcal'])).toBe('fork');
  });
  it("own food, portions only -> update-portions (source doesn't change)", () => {
    expect(decideUpdatePath(uid, uid, ['portions'])).toBe('update-portions');
  });
  it('own food, any other field -> update', () => {
    expect(decideUpdatePath(uid, uid, ['kcal'])).toBe('update');
    expect(decideUpdatePath(uid, uid, ['portions', 'kcal'])).toBe('update');
  });
});

describe('recipeResponse — canonical case', () => {
  it('100 g of A + 200 g of B, cooked weight 250 => per 100 g = (A + 2B) / 2.5', () => {
    const A = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, micros: { sodio_mg: 50 } };
    const B = { kcal: 200, protein_g: 20, carbs_g: 10, fat_g: 8, micros: { sodio_mg: 30 } };
    const items = [
      { food: A, grams: 100 },
      { food: B, grams: 200 },
    ];
    const result = recipeResponse(items, 250);
    expect(result.kcal).toBeCloseTo((100 + 2 * 200) / 2.5, 5);
    expect(result.protein_g).toBeCloseTo((10 + 2 * 20) / 2.5, 5);
    expect(result.carbs_g).toBeCloseTo((20 + 2 * 10) / 2.5, 5);
    expect(result.fat_g).toBeCloseTo((5 + 2 * 8) / 2.5, 5);
    expect(result.micros.sodio_mg).toBeCloseTo((50 + 2 * 30) / 2.5, 5);
    expect(result.warnings).toEqual([]);
  });

  it('no ingredients and no cooked weight -> error (resulting weight 0)', () => {
    expect(() => recipeResponse([], 0)).toThrow();
  });
});

describe('mergeBounds (set_target_bounds)', () => {
  it('patches per key, removes with null, keeps the rest, clamps sodium floor', () => {
    const existing = { kcal: { min: 1800, max: 2000 }, protein_g: { max: 200 } };
    expect(mergeBounds(existing, { protein_g: null, sodio_mg: { min: 1000, max: 2000 }, calcio_mg: { max: 2500 } }))
      .toEqual({ calcio_mg: { max: 2500 }, kcal: { min: 1800, max: 2000 }, sodio_mg: { min: 1500, max: 2000 } });
    expect(mergeBounds(null, { kcal: { min: null, max: null } })).toEqual({});
  });
  it('rejects unknown keys, negatives and mín > máx', () => {
    expect(() => mergeBounds({}, { foo: { min: 1 } })).toThrow(/inválidas/);
    expect(() => mergeBounds({}, { kcal: { min: -1 } })).toThrow(/negativos/);
    expect(() => mergeBounds({}, { kcal: { min: 3, max: 2 } })).toThrow(/mín/);
  });
});
