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
} from './mcp.js';

describe('assertValidMicros', () => {
  it('rechaza claves fuera de MICROS y lista las válidas', () => {
    expect(() => assertValidMicros({ vitamina_x_mg: 5 })).toThrow(/vitamina_x_mg/);
    expect(() => assertValidMicros({ vitamina_x_mg: 5 })).toThrow(/sodio_mg/);
  });
  it('acepta claves válidas', () => {
    expect(() => assertValidMicros({ sodio_mg: 100, fibra_g: 2 })).not.toThrow();
  });
});

describe('assertNonNegative', () => {
  it('rechaza negativos y no finitos', () => {
    expect(() => assertNonNegative({ kcal: -1 })).toThrow();
    expect(() => assertNonNegative({ kcal: NaN })).toThrow();
  });
  it('permite campos ausentes (null/undefined)', () => {
    expect(() => assertNonNegative({ kcal: null, protein_g: undefined })).not.toThrow();
  });
});

describe('assertValidPortions', () => {
  it('rechaza portion sin grams > 0', () => {
    expect(() => assertValidPortions([{ name: 'vaso', grams: 0 }])).toThrow();
    expect(() => assertValidPortions([{ grams: 10 }])).toThrow();
  });
  it('acepta portions válidas', () => {
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
  it('macros implausibles: NO bloquea, devuelve warning', () => {
    const food = { kcal: 1080, protein_g: 120, carbs_g: 0, fat_g: 0, micros: {} };
    expect(() => buildWarnings(food)).not.toThrow();
    expect(buildWarnings(food).length).toBeGreaterThan(0);
  });
  it('food razonable: sin warnings', () => {
    const food = { kcal: 52, protein_g: 0.3, carbs_g: 14, fat_g: 0.2, micros: { fibra_g: 2.4 } };
    expect(buildWarnings(food)).toEqual([]);
  });
});

describe('decideUpdatePath', () => {
  const uid = 'user-1';
  it('food ajeno (incluye catálogo base owner null) -> fork', () => {
    expect(decideUpdatePath(null, uid, ['kcal'])).toBe('fork');
    expect(decideUpdatePath('otro-usuario', uid, ['kcal'])).toBe('fork');
  });
  it('food propio, solo portions -> update-portions (no cambia source)', () => {
    expect(decideUpdatePath(uid, uid, ['portions'])).toBe('update-portions');
  });
  it('food propio, cualquier otro campo -> update', () => {
    expect(decideUpdatePath(uid, uid, ['kcal'])).toBe('update');
    expect(decideUpdatePath(uid, uid, ['portions', 'kcal'])).toBe('update');
  });
});

describe('recipeResponse — caso canónico', () => {
  it('100 g de A + 200 g de B, peso cocido 250 => por 100 g = (A + 2B) / 2.5', () => {
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

  it('sin ingredientes y sin peso cocido -> error (peso resultante 0)', () => {
    expect(() => recipeResponse([], 0)).toThrow();
  });
});
