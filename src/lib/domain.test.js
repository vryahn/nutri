import { describe, it, expect } from 'vitest';
import {
  computeRecipePer100g, resolveTarget, weekdayOf, kcalFromMacros, kcalSuspicious,
  macrosImplausible, componentsInconsistent, dayCompleteness, bayesAdherence,
  reorderLabels, eanChecksumValid, cleanNumericMap,
  nutrientKind, classifyBullseye, classifyKcal, classifyFloor, classifyBand,
  classifyCeiling, classifySodium, sodiumIsLow, sodiumIsHigh,
  SODIUM_FLOOR_MG, SODIUM_CEILING_MG,
  DASH_VARS_BY_KEY, axisUnits, buildDashSeries, dashVarTarget,
  autoAgg, resolveAgg, reduceBucket, bucketRows, mergeFoodResults, normalizeTo100,
  cleanBounds, classifyBounds, classifyNutrient, impliedBounds, effectiveBound, draftToRows,
  entryNutrients, addDaysISO, cleanRules, evalRules, DEFICIT_RATE_CAP,
} from './domain.js';

describe('temporal aggregation of custom charts', () => {
  it('autoAgg derives the bucket from the range length', () => {
    expect(autoAgg(7)).toBe('dia');
    expect(autoAgg(45)).toBe('dia');
    expect(autoAgg(46)).toBe('semana');
    expect(autoAgg(182)).toBe('semana');
    expect(autoAgg(183)).toBe('mes');
    expect(autoAgg(365)).toBe('mes');
  });

  it('resolveAgg: auto/undefined → autoAgg; explicit wins', () => {
    expect(resolveAgg('auto', 7)).toBe('dia');
    expect(resolveAgg(undefined, 200)).toBe('mes');
    expect(resolveAgg('mes', 7)).toBe('mes');
  });

  it('reduceBucket ignores nulls; empty bucket → null', () => {
    expect(reduceBucket([1, 2, 3, null], 'suma')).toBe(6);
    expect(reduceBucket([1, 2, 3, 4], 'promedio')).toBe(2.5);
    expect(reduceBucket([1, 2, 3, 4], 'mediana')).toBe(2.5);
    expect(reduceBucket([null, null], 'promedio')).toBeNull();
    expect(reduceBucket([], 'suma')).toBeNull();
  });

  it('bucketRows groups by ISO week (Monday) and reduces', () => {
    // 2026-07-06 = Monday; 06..12 = one week; 13 = next week
    const daily = ['2026-07-06', '2026-07-08', '2026-07-12', '2026-07-13'].map((day, i) => ({ day, x: i + 1 }));
    const suma = bucketRows(daily, ['x'], 'semana', 'suma');
    expect(suma.map((r) => r.day)).toEqual(['2026-07-06', '2026-07-13']);
    expect(suma[0].x).toBe(1 + 2 + 3); // 06,08,12 fall in the week of the 06th
    expect(suma[1].x).toBe(4); // 13
    expect(suma[0].label).toBe('07-06');
    const prom = bucketRows(daily, ['x'], 'semana', 'promedio');
    expect(prom[0].x).toBe(2); // (1+2+3)/3
  });

  it('bucketRows monthly labels YYYY-MM', () => {
    const daily = ['2026-06-30', '2026-07-01', '2026-07-15'].map((day, i) => ({ day, x: i + 1 }));
    const s = bucketRows(daily, ['x'], 'mes', 'suma');
    expect(s.map((r) => r.label)).toEqual(['2026-06', '2026-07']);
    expect(s[1].x).toBe(2 + 3);
  });

  it('buildDashSeries aggregates nutrition by week with Sum', () => {
    const nutByDay = new Map([
      ['2026-07-06', { day: '2026-07-06', kcal: 2000 }],
      ['2026-07-08', { day: '2026-07-08', kcal: 1800 }],
    ]);
    const s = buildDashSeries(['2026-07-06', '2026-07-07', '2026-07-08'], [DASH_VARS_BY_KEY.kcal], nutByDay, new Map(), 'semana', 'suma');
    expect(s).toHaveLength(1);
    expect(s[0].kcal).toBe(3800); // 07-07 not logged → null, ignored
  });

  it('kind: nutrition flow, measurements/derived stock', () => {
    expect(DASH_VARS_BY_KEY.kcal.kind).toBe('flow');
    expect(DASH_VARS_BY_KEY.sodio_mg.kind).toBe('flow');
    expect(DASH_VARS_BY_KEY.peso_kg.kind).toBe('stock');
    expect(DASH_VARS_BY_KEY.imc.kind).toBe('stock');
  });
});

describe('Dashboard custom charts', () => {
  const nutByDay = new Map([
    ['2026-07-01', { day: '2026-07-01', kcal: 2000, protein_g: 150, micros: { sodio_mg: 1800 } }],
    // 07-02 not logged (no row) → nutrition must yield null, not 0
  ]);
  const bodyByDay = new Map([
    ['2026-07-01', { day: '2026-07-01', metrics: { peso_kg: 57.5, grasa_pct: 20, cintura_cm: 82 } }],
    // 07-02 with no measurement → body null (sparse series)
  ]);
  const dates = ['2026-07-01', '2026-07-02'];

  it('groups units into ≤2 axes by order of appearance', () => {
    const vars = [DASH_VARS_BY_KEY.peso_kg, DASH_VARS_BY_KEY.cintura_cm];
    expect(axisUnits(vars)).toEqual(['kg', 'cm']);
    // 3ª unidad distinta se recorta a 2
    expect(axisUnits([DASH_VARS_BY_KEY.peso_kg, DASH_VARS_BY_KEY.cintura_cm, DASH_VARS_BY_KEY.grasa_pct])).toEqual(['kg', 'cm']);
  });

  it('aligns nutrition (dense, real 0) and measurements (sparse, null) by day', () => {
    const vars = [DASH_VARS_BY_KEY.protein_g, DASH_VARS_BY_KEY.peso_kg, DASH_VARS_BY_KEY.sodio_mg];
    const s = buildDashSeries(dates, vars, nutByDay, bodyByDay);
    expect(s[0]).toMatchObject({ protein_g: 150, peso_kg: 57.5, sodio_mg: 1800 });
    // unlogged day → nutrition null (no false 0); no measurement → body null
    expect(s[1]).toMatchObject({ protein_g: null, peso_kg: null, sodio_mg: null });
  });

  it("resolves derived values (BMI) from the day's measurements + Profile height", () => {
    const s = buildDashSeries(dates, [DASH_VARS_BY_KEY.imc], nutByDay, bodyByDay, 'dia', 'promedio', 175);
    expect(s[0].imc).toBeCloseTo(57.5 / (1.75 * 1.75), 1);
    expect(s[1].imc).toBeNull();
    // no Profile height → derived values null even with the day's weight/fat
    const sinAltura = buildDashSeries(dates, [DASH_VARS_BY_KEY.imc], nutByDay, bodyByDay);
    expect(sinAltura[0].imc).toBeNull();
  });

  it("target only applies to nutrition; body/derived don't have it", () => {
    const target = { kcal: 1800, protein_g: 155, micros: { sodio_mg: 2000 } };
    expect(dashVarTarget(DASH_VARS_BY_KEY.protein_g, target)).toBe(155);
    expect(dashVarTarget(DASH_VARS_BY_KEY.sodio_mg, target)).toBe(2000);
    expect(dashVarTarget(DASH_VARS_BY_KEY.peso_kg, target)).toBeNull();
    expect(dashVarTarget(DASH_VARS_BY_KEY.imc, target)).toBeNull();
  });
});

describe('cleanNumericMap', () => {
  it('keeps finite numbers ≥ 0 and discards empty, negative and garbage values', () => {
    expect(cleanNumericMap({ peso_kg: '80.5', grasa_pct: 22, vacio: '', nulo: null, neg: -3, txt: 'abc', nan: NaN }))
      .toEqual({ peso_kg: 80.5, grasa_pct: 22 });
  });
  it('empty or null map -> {}', () => {
    expect(cleanNumericMap({})).toEqual({});
    expect(cleanNumericMap(null)).toEqual({});
  });
});

describe('computeRecipePer100g', () => {
  const A = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, micros: { sodio_mg: 50 } };
  const B = { kcal: 200, protein_g: 20, carbs_g: 10, fat_g: 8, micros: { sodio_mg: 30 } };

  it('100g A + 200g B, cooked weight 250 -> per 100g = (A+2B)/2.5', () => {
    const r = computeRecipePer100g([{ food: A, grams: 100 }, { food: B, grams: 200 }], 250);
    expect(r.kcal).toBe(200);
    expect(r.protein_g).toBe(20);
    expect(r.carbs_g).toBe(16);
    expect(r.fat_g).toBe(8.4);
    expect(r.micros.sodio_mg).toBe(44);
  });

  it('without cooked weight, uses sum of ingredients', () => {
    const r = computeRecipePer100g([{ food: A, grams: 100 }, { food: B, grams: 200 }], null);
    expect(r.kcal).toBe(166.7);
    expect(r.protein_g).toBe(16.67);
    expect(r.carbs_g).toBe(13.33);
    expect(r.fat_g).toBe(7);
  });

  it('weight 0 (no ingredients) -> null', () => {
    expect(computeRecipePer100g([], 0)).toBeNull();
  });
});

describe('resolveTarget', () => {
  it('exact day wins over dow', () => {
    const dateISO = '2026-07-10';
    const dow = weekdayOf(dateISO);
    const targets = [
      { day: dateISO, dow: null, valid_from: '2026-01-01', kcal: 1500 },
      { day: null, dow, valid_from: '2026-01-01', kcal: 2000 },
    ];
    expect(resolveTarget(targets, dateISO)).toEqual(targets[0]);
  });

  it('among dow rows, highest valid_from <= F wins', () => {
    const dateISO = '2026-07-10';
    const dow = weekdayOf(dateISO);
    const older = { day: null, dow, valid_from: '2026-01-01', kcal: 1800 };
    const newer = { day: null, dow, valid_from: '2026-06-01', kcal: 2000 };
    const future = { day: null, dow, valid_from: '2026-08-01', kcal: 2200 };
    expect(resolveTarget([older, newer, future], dateISO)).toEqual(newer);
  });

  it('no candidates -> null', () => {
    const dateISO = '2026-07-10';
    const dow = weekdayOf(dateISO);
    const wrongDow = { day: null, dow: (dow + 1) % 7, valid_from: '2026-01-01', kcal: 1800 };
    expect(resolveTarget([wrongDow], dateISO)).toBeNull();
  });
});

describe('kcalFromMacros / kcalSuspicious', () => {
  it('fiber subtracts 2 kcal/g', () => {
    const f = { protein_g: 0, carbs_g: 20, fat_g: 0, micros: { fibra_g: 5 } };
    expect(kcalFromMacros(f)).toBe(70); // 4*20 - 2*5
  });

  it('alcohol adds 7 kcal/g', () => {
    const f = { protein_g: 0, carbs_g: 0, fat_g: 0, micros: { alcohol_g: 10 } };
    expect(kcalFromMacros(f)).toBe(70); // 7*10
  });

  it('polyols: declared total corrects to 2.4 kcal/g (subtracts 1.6/g)', () => {
    // carbs 20 los cuenta a 4 (=80); 10 g son polioles -> -16 -> 64
    const f = { protein_g: 0, carbs_g: 20, fat_g: 0, micros: { polioles_g: 10 } };
    expect(kcalFromMacros(f)).toBe(64);
  });

  it('polyols: without a total, uses the sum of individual values', () => {
    const f = { protein_g: 0, carbs_g: 20, fat_g: 0, micros: { xilitol_g: 6, sorbitol_g: 4 } };
    expect(kcalFromMacros(f)).toBe(64); // -1.6*(6+4)
  });

  it('tolerance max(20 kcal, 25%)', () => {
    // expected = 100 kcal -> tolerancia = max(20, 25) = 25
    const base = { protein_g: 25, carbs_g: 0, fat_g: 0, micros: {} }; // expected 100
    expect(kcalSuspicious({ ...base, kcal: 124 })).toBe(false); // diff 24 <= 25
    expect(kcalSuspicious({ ...base, kcal: 126 })).toBe(true); // diff 26 > 25

    // expected = 50 kcal -> tolerancia = max(20, 12.5) = 20
    const small = { protein_g: 12.5, carbs_g: 0, fat_g: 0, micros: {} }; // expected 50
    expect(kcalSuspicious({ ...small, kcal: 69 })).toBe(false); // diff 19 <= 20
    expect(kcalSuspicious({ ...small, kcal: 71 })).toBe(true); // diff 21 > 20
  });
});

describe('macrosImplausible', () => {
  it('true: sum of macros+alcohol+water > 105', () => {
    expect(macrosImplausible({ protein_g: 50, carbs_g: 50, fat_g: 10, micros: {} })).toBe(true);
  });

  it('false: sum within range', () => {
    expect(macrosImplausible({ protein_g: 30, carbs_g: 30, fat_g: 30, micros: {} })).toBe(false);
  });

  it('true: a micro exceeds its MICRO_MAX cap', () => {
    expect(macrosImplausible({ protein_g: 0, carbs_g: 0, fat_g: 0, micros: { sodio_mg: 50000 } })).toBe(true);
  });
});

describe('componentsInconsistent', () => {
  it('reason: sat.+trans fat > total fat (+0.5 slack)', () => {
    const f = { fat_g: 5, micros: { grasa_sat_g: 6 } };
    expect(componentsInconsistent(f)).toBe('grasa saturada + trans supera la grasa total');
  });

  it('null: sat.+trans fat <= total fat', () => {
    const f = { fat_g: 5, micros: { grasa_sat_g: 5 } };
    expect(componentsInconsistent(f)).toBeNull();
  });

  it("a missing value doesn't count as 0 (missing fat_g doesn't trigger the inequality)", () => {
    const f = { fat_g: '', micros: { grasa_sat_g: 100 } };
    expect(componentsInconsistent(f)).toBeNull();
  });

  it('reason: polyols > carbs', () => {
    expect(componentsInconsistent({ carbs_g: 10, micros: { polioles_g: 12 } }))
      .toBe('polialcoholes superan los carbohidratos');
  });

  it('reason: sum of individual sugars > total sugar', () => {
    const f = { micros: { azucar_g: 5, glucosa_g: 4, fructosa_g: 4 } };
    expect(componentsInconsistent(f)).toBe('los azúcares desglosados superan el azúcar total');
  });

  it('reason: ALA+EPA+DHA > total omega-3', () => {
    const f = { micros: { omega3_g: 1, ala_g: 0.8, epa_g: 0.5, dha_g: 0.5 } }; // 1.8 > 1+0.5
    expect(componentsInconsistent(f)).toBe('ALA + EPA + DHA superan el omega-3 total');
  });

  it('null: amino acids are no longer compared against protein (Kjeldahl/different basis)', () => {
    const f = { protein_g: 1, micros: { leucina_g: 0.8, lisina_g: 0.8 } };
    expect(componentsInconsistent(f)).toBeNull();
  });
});

describe('dayCompleteness', () => {
  it('sin_registro: kcal <= 0', () => {
    expect(dayCompleteness({ kcal: 0, targetKcal: 2000, historyKcals: [], mealsCount: 0, typicalMeals: 0 })).toBe('sin_registro');
  });

  it('sin_evaluar: not enough history and no target', () => {
    expect(dayCompleteness({ kcal: 800, targetKcal: null, historyKcals: [], mealsCount: 2, typicalMeals: 2 })).toBe('sin_evaluar');
  });

  it('completo: with history, kcal >= 60% of the median', () => {
    const historyKcals = [2000, 2000, 2000, 2000, 2000, 2000, 2000];
    expect(dayCompleteness({ kcal: 1300, targetKcal: null, historyKcals, mealsCount: 3, typicalMeals: 3 })).toBe('completo');
  });

  it('parcial: with history, kcal < 60% of the median', () => {
    const historyKcals = [2000, 2000, 2000, 2000, 2000, 2000, 2000];
    expect(dayCompleteness({ kcal: 1000, targetKcal: null, historyKcals, mealsCount: 3, typicalMeals: 3 })).toBe('parcial');
  });

  it('bingeOverride: typicalMeals >= 3 and mealsCount <= 1 -> parcial even if kcal is high', () => {
    const historyKcals = [2000, 2000, 2000, 2000, 2000, 2000, 2000];
    expect(dayCompleteness({ kcal: 2000, targetKcal: null, historyKcals, mealsCount: 1, typicalMeals: 3 })).toBe('parcial');
  });
});

describe('bayesAdherence', () => {
  it('bayesAdherence(8,10): mean 0.75, lower < mean < upper, within [0,1]', () => {
    const { mean, lower, upper } = bayesAdherence(8, 10);
    expect(mean).toBeCloseTo(0.75, 10);
    expect(lower).toBeLessThan(mean);
    expect(mean).toBeLessThan(upper);
    expect(lower).toBeGreaterThanOrEqual(0);
    expect(upper).toBeLessThanOrEqual(1);
  });
});

describe('reorderLabels', () => {
  it('reindexes 0..n-1 returning only the rows that changed', () => {
    const labels = [
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
      { id: 'c', sort_order: 2 },
    ];
    const result = reorderLabels(labels, 1, -1);
    expect(result).toEqual([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 1 },
    ]);
  });

  it('edge case: moving the first one up -> []', () => {
    const labels = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }];
    expect(reorderLabels(labels, 0, -1)).toEqual([]);
  });

  it('edge case: moving the last one down -> []', () => {
    const labels = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }];
    expect(reorderLabels(labels, 1, 1)).toEqual([]);
  });
});

describe('eanChecksumValid', () => {
  it('real valid EAN-13', () => {
    expect(eanChecksumValid('4006381333931')).toBe(true);
  });

  it('same EAN with one digit altered -> invalid', () => {
    expect(eanChecksumValid('4006381333932')).toBe(false);
  });
});

describe('nutrientKind', () => {
  it('maps each archetype and default = meta', () => {
    expect(nutrientKind('kcal')).toBe('diana');
    expect(nutrientKind('protein_g')).toBe('piso');
    expect(nutrientKind('carbs_g')).toBe('rango');
    expect(nutrientKind('fat_g')).toBe('rango');
    expect(nutrientKind('grasa_sat_g')).toBe('techo');
    expect(nutrientKind('azucar_anadido_g')).toBe('techo');
    expect(nutrientKind('alcohol_g')).toBe('techo');
    expect(nutrientKind('sodio_mg')).toBe('sodio');
    expect(nutrientKind('vit_c_mg')).toBe('meta'); // default
  });
});

describe('classifyBullseye (asymmetric band by regimen)', () => {
  it('without a regimen, keeps the historical strict band ±5 / ±15', () => {
    expect(classifyBullseye(2000, 2000, null)).toBe('ok');
    expect(classifyBullseye(2000 * 1.05, 2000, null)).toBe('ok');
    expect(classifyBullseye(2000 * 1.10, 2000, null)).toBe('warn');
    expect(classifyBullseye(2000 * 1.20, 2000, null)).toBe('danger');
    expect(classifyKcal(2000 * 1.20, 2000)).toBe('danger'); // compat wrapper
  });
  it('deficit: excess weighs more than shortfall', () => {
    // −12% under a deficit is still ok (shortfall tolerated down to −15%)
    expect(classifyBullseye(2000 * 0.88, 2000, 'deficit')).toBe('ok');
    // +12% under a deficit is already warn (overshoot ok only up to +8%)
    expect(classifyBullseye(2000 * 1.12, 2000, 'deficit')).toBe('warn');
    // +20% under a deficit is danger (overshoot warn up to +18%)
    expect(classifyBullseye(2000 * 1.20, 2000, 'deficit')).toBe('danger');
  });
  it('volumen: shortfall weighs more than excess (mirror)', () => {
    expect(classifyBullseye(2000 * 1.12, 2000, 'volumen')).toBe('ok');
    expect(classifyBullseye(2000 * 0.88, 2000, 'volumen')).toBe('warn');
  });
  it('without a target -> null', () => {
    expect(classifyBullseye(2000, 0, 'deficit')).toBe(null);
  });
});

describe('classifyFloor / classifyBand / classifyCeiling', () => {
  it('piso: reaching or exceeding = ok, falling short = danger', () => {
    expect(classifyFloor(120, 100)).toBe('ok');
    expect(classifyFloor(90, 100)).toBe('danger');
  });
  it('rango: symmetric band ±15 ok / ±30 warn / outside danger', () => {
    expect(classifyBand(150, 150)).toBe('ok');
    expect(classifyBand(150 * 1.15, 150)).toBe('ok');
    expect(classifyBand(150 * 1.30, 150)).toBe('warn');
    expect(classifyBand(150 * 1.5, 150)).toBe('danger'); // carbs 220 vs 150 ≈ +47%
  });
  it('techo: at/below the limit ok, +10% warn, more danger', () => {
    expect(classifyCeiling(20, 25)).toBe('ok');
    expect(classifyCeiling(25, 25)).toBe('ok');
    expect(classifyCeiling(30, 25)).toBe('danger'); // added sugar 30 vs 25 = +20%
    expect(classifyCeiling(27, 25)).toBe('warn'); // +8%
  });
});

describe('dual sodium (piso 1500 + techo 2300)', () => {
  it('medical constants', () => {
    expect(SODIUM_FLOOR_MG).toBe(1500);
    expect(SODIUM_CEILING_MG).toBe(2300);
  });
  it('classifySodium: danger outside [piso, techo], ok inside', () => {
    expect(classifySodium(2000, true)).toBe('ok');
    expect(classifySodium(1200, true)).toBe('danger'); // bajo piso
    expect(classifySodium(2600, true)).toBe('danger'); // sobre techo
    expect(classifySodium(2000, false)).toBe(null); // no entries
  });
  it('sodiumIsLow / sodiumIsHigh respect hasEntries', () => {
    expect(sodiumIsLow(1200, true)).toBe(true);
    expect(sodiumIsLow(1200, false)).toBe(false);
    expect(sodiumIsHigh(2600, true)).toBe(true);
    expect(sodiumIsHigh(2000, true)).toBe(false);
  });
});

describe('mergeFoodResults', () => {
  it('primary first, semantic dedup by id', () => {
    const primary = [{ id: 1 }, { id: 2 }];
    const semantic = [{ id: 2 }, { id: 3 }];
    expect(mergeFoodResults(primary, semantic)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('trims to max', () => {
    const primary = [{ id: 1 }, { id: 2 }];
    const semantic = [{ id: 3 }, { id: 4 }, { id: 5 }];
    expect(mergeFoodResults(primary, semantic, 3)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('semantic empty or null is tolerated', () => {
    const primary = [{ id: 1 }];
    expect(mergeFoodResults(primary, [])).toEqual(primary);
    expect(mergeFoodResults(primary, null)).toEqual(primary);
  });
});

describe('normalizeTo100', () => {
  it('basis 100 g -> identity, no scaling', () => {
    const f = { kcal: 150, protein_g: 10, carbs_g: 20, fat_g: 5, micros: { sodio_mg: 30 } };
    expect(normalizeTo100(f, 100, 'g')).toBe(f);
  });

  it('basis 50 g -> doubles', () => {
    const f = { kcal: 100, protein_g: 5, carbs_g: 0, fat_g: 0, micros: { sodio_mg: 10 } };
    const r = normalizeTo100(f, 50, 'g');
    expect(r.kcal).toBe(200);
    expect(r.protein_g).toBe(10);
    expect(r.micros.sodio_mg).toBe(20);
  });

  it('basis 200 g -> halves', () => {
    const f = { kcal: 100, protein_g: 10, carbs_g: 0, fat_g: 0, micros: { sodio_mg: 40 } };
    const r = normalizeTo100(f, 200, 'g');
    expect(r.kcal).toBe(50);
    expect(r.protein_g).toBe(5);
    expect(r.micros.sodio_mg).toBe(20);
  });

  it('basis ml WITH density converts to grams first', () => {
    const f = { kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0, micros: {}, density_g_ml: 0.92 };
    const r = normalizeTo100(f, 100, 'ml');
    // baseGrams = 100 ml * 0.92 g/ml = 92 g -> kcal scales by 100/92
    expect(r.kcal).toBe(108.7);
  });

  it('basis ml WITHOUT density is blocked (null) — density 0 or absent', () => {
    const f = { kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0, micros: {}, density_g_ml: 0 };
    expect(normalizeTo100(f, 100, 'ml')).toBeNull();
    const noDensity = { kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0, micros: {} };
    expect(normalizeTo100(noDensity, 100, 'ml')).toBeNull();
  });

  it('empty string and null fields survive without becoming 0 or NaN', () => {
    const f = { kcal: '', protein_g: null, carbs_g: 50, fat_g: '', micros: {} };
    const r = normalizeTo100(f, 50, 'g');
    expect(r.kcal).toBe('');
    expect(r.protein_g).toBeNull();
    expect(r.carbs_g).toBe(100);
  });

  it('invalid basis (0, negative, non-numeric) -> object unchanged', () => {
    const f = { kcal: 100, protein_g: 5, carbs_g: 0, fat_g: 0, micros: {} };
    expect(normalizeTo100(f, 0, 'g')).toBe(f);
    expect(normalizeTo100(f, -10, 'g')).toBe(f);
    expect(normalizeTo100(f, 'abc', 'g')).toBe(f);
  });
});

describe('bounds explícitos (targets.bounds)', () => {
  it('cleanBounds drops empty sides/keys and clamps sodium floor', () => {
    expect(cleanBounds({ kcal: { min: '1900', max: '' }, fat_g: { min: '', max: '' }, sodio_mg: { min: 1000, max: 2000 } }))
      .toEqual({ kcal: { min: 1900 }, sodio_mg: { min: SODIUM_FLOOR_MG, max: 2000 } });
    expect(draftToRows([{ dows: [1], values: { kcal: 2000, protein_g: '', carbs_g: '', fat_g: '', micros: {}, bounds: { kcal: { min: 1900, max: 2100 } } } }], { validFrom: '2026-01-05' })[1].bounds)
      .toEqual({ kcal: { min: 1900, max: 2100 } });
    expect(draftToRows([], { validFrom: '2026-01-05' })[0].bounds).toEqual({});
  });
  it('classifyBounds: ok inside, warn ≤10 % outside, danger beyond; open sides', () => {
    const b = { min: 1900, max: 2100 };
    expect(classifyBounds(2000, b)).toBe('ok');
    expect(classifyBounds(1900, b)).toBe('ok');
    expect(classifyBounds(1800, b)).toBe('warn'); // 1900·0.9 = 1710
    expect(classifyBounds(1700, b)).toBe('danger');
    expect(classifyBounds(2200, b)).toBe('warn'); // 2100·1.1 = 2310
    expect(classifyBounds(2400, b)).toBe('danger');
    expect(classifyBounds(5000, { min: 150 })).toBe('ok');
    expect(classifyBounds(0, { max: 20 })).toBe('ok');
    expect(classifyBounds(10, {})).toBeNull();
  });
  it('classifyNutrient: bound wins over archetype; falls back without it', () => {
    expect(classifyNutrient('protein_g', 120, 150)).toBe('danger'); // piso
    expect(classifyNutrient('protein_g', 120, 150, { bounds: { min: 100, max: 200 } })).toBe('ok');
    expect(classifyNutrient('protein_g', 260, 150, { bounds: { min: 100, max: 200 } })).toBe('danger');
    // one-sided bound: the other side is the implied one (piso keeps its floor)
    expect(effectiveBound('protein_g', 150, null, { max: 200 })).toEqual({ min: 150, max: 200 });
    expect(classifyNutrient('protein_g', 0, 150, { bounds: { max: 200 } })).toBe('danger');
    expect(effectiveBound('kcal', 2000, 'deficit', { min: 1900 })).toEqual({ min: 1900, max: 2160 });
    expect(effectiveBound('kcal', 2000, null, null)).toBeNull();
    expect(classifyNutrient('kcal', 2000, 2000, { goal: 'deficit' })).toBe('ok');
    expect(classifyNutrient('calcio_mg', 900, 1000)).toBe('warn'); // meta
    expect(classifyNutrient('calcio_mg', 900, null)).toBeNull();
    // sodium: medical floor is not relaxable, ceiling is
    expect(classifyNutrient('sodio_mg', 1400, null, { bounds: { min: 1000, max: 3000 } })).toBe('danger');
    expect(classifyNutrient('sodio_mg', 2800, null, { bounds: { max: 3000 } })).toBe('ok');
    expect(classifyNutrient('sodio_mg', 2800, null, { bounds: { min: 1800 } })).toBe('danger'); // min-only keeps the FDA ceiling
    expect(classifyNutrient('sodio_mg', 2800, null)).toBe('danger');
    expect(classifyNutrient('sodio_mg', 100, null, { hasFood: false })).toBeNull();
  });
  it('impliedBounds mirrors the archetype bands', () => {
    expect(impliedBounds('kcal', 2000, 'deficit')).toEqual({ min: 1700, max: 2160 });
    expect(impliedBounds('protein_g', 150)).toEqual({ min: 150, max: null });
    expect(impliedBounds('grasa_sat_g', 20)).toEqual({ min: null, max: 20 });
    expect(impliedBounds('carbs_g', 200)).toEqual({ min: 170, max: 230 });
    expect(impliedBounds('sodio_mg', null)).toEqual({ min: SODIUM_FLOOR_MG, max: SODIUM_CEILING_MG });
    expect(impliedBounds('kcal', null)).toEqual({ min: null, max: null });
  });
});

describe('entryNutrients (client replica of the entry_nutrients view)', () => {
  const meta = {
    kcal: 89, protein_g: 1.09, carbs_g: 22.84, fat_g: 0.33,
    micros: { potasio_mg: 358, sodio_mg: 1, magnesio_mg: 27 },
  };

  it('150 g of a food is 1.5x its per-100 g values, macros and micros alike', () => {
    const r = entryNutrients({ id: 'a', day: '2026-09-05', grams: 150 }, meta, { item: 'Plátano' });
    expect(r.kcal).toBe(133.5);
    expect(r.protein_g).toBe(1.64); // round(1.635, 2), same as the view
    expect(r.carbs_g).toBe(34.26);
    expect(r.fat_g).toBe(0.5);
    expect(r.micros).toEqual({ potasio_mg: 537, sodio_mg: 1.5, magnesio_mg: 40.5 });
    expect(r.item).toBe('Plátano');
  });

  it('100 g leaves the values untouched', () => {
    const r = entryNutrients({ grams: 100 }, meta);
    expect([r.kcal, r.protein_g, r.carbs_g, r.fat_g]).toEqual([89, 1.09, 22.84, 0.33]);
  });

  it('without meta the nutrients are null, never an invented zero', () => {
    const r = entryNutrients({ id: 'a', grams: 150 }, null);
    expect(r.kcal).toBeNull();
    expect(r.protein_g).toBeNull();
    expect(r.micros).toEqual({});
    expect(r.grams).toBe(150);
  });
});

describe('cleanRules', () => {
  it('discards items with unknown kind', () => {
    expect(cleanRules({ items: [{ id: 'x', kind: 'bogus', value: 1, weeks: 1 }] }).items).toEqual([]);
  });
  it('discards items with non-numeric required fields', () => {
    expect(cleanRules({ items: [{ id: 'r1', kind: 'ritmo_alto', value: 'abc', weeks: 2, delta_carbs_g: -25 }] }).items).toEqual([]);
    expect(cleanRules({ items: [{ id: 'r3', kind: 'estancamiento', days: '', delta_carbs_g: 25 }] }).items).toEqual([]);
  });
  it('keeps well-formed items and coerces to numbers', () => {
    const out = cleanRules({
      kcal_min: '1800', paused_until: '2026-01-01',
      items: [{ id: 'r1', kind: 'ritmo_alto', value: '0.3', weeks: '2', delta_carbs_g: '-25', scope: [1, 2] }],
    });
    expect(out.kcal_min).toBe(1800);
    expect(out.paused_until).toBe('2026-01-01');
    expect(out.items).toEqual([{ id: 'r1', kind: 'ritmo_alto', auto: false, value: 0.3, weeks: 2, delta_carbs_g: -25, scope: [1, 2] }]);
  });
  it('techo_peso ignores delta_carbs_g and scope', () => {
    const out = cleanRules({ items: [{ id: 'r2', kind: 'techo_peso', value: 85, delta_carbs_g: -25, scope: [1] }] });
    expect(out.items).toEqual([{ id: 'r2', kind: 'techo_peso', auto: false, value: 85 }]);
  });
});

describe('evalRules', () => {
  const today = '2026-03-15';
  const vf = '2026-01-01';

  function phaseRows({ validFrom, owner = 'u1', kcal = 2000, protein_g = 150, carbs_g = 250, fat_g = 60, goal = null, rules = { items: [] }, applied_rule = null }) {
    const rows = [];
    for (let dow = 0; dow < 7; dow++) {
      rows.push({
        id: `id-${validFrom}-${dow}`, owner, dow, day: null, valid_from: validFrom,
        label: 'Fase test', description: null, goal, kcal, protein_g, carbs_g, fat_g,
        micros: {}, bounds: {}, rules, applied_rule,
      });
    }
    return rows;
  }
  function baseTargets({ goal = null, rulesItems = [], kcalMin, kcalMax } = {}) {
    const rules = { items: rulesItems, ...(kcalMin != null ? { kcal_min: kcalMin } : {}) };
    void kcalMax;
    return phaseRows({ validFrom: vf, goal, rules });
  }
  function weightFixture({ recentDays, recentWeight, pastDays, pastWeight }) {
    const rows = [];
    for (const off of recentDays) rows.push({ day: addDaysISO(today, -off), metrics: { peso_kg: recentWeight } });
    for (const off of pastDays) rows.push({ day: addDaysISO(today, -off), metrics: { peso_kg: pastWeight } });
    return rows;
  }
  function dailyTotalsFixture(offsets, kcal) {
    return offsets.map((off) => ({ day: addDaysISO(today, -off), kcal }));
  }

  const bodyMetrics35 = () => weightFixture({ recentDays: [0, 1, 2, 3, 4, 5, 6], recentWeight: 80.6, pastDays: [14, 15, 16, 17, 18, 19, 20], pastWeight: 80.0 });
  const dailyTotalsGood = () => dailyTotalsFixture([0, 1, 2, 4, 5, 6, 8, 9, 10, 12], 2000); // 10 of 14 days registered, on target

  it('1) ritmo_alto fires with +0.3 kg/sem over 2 weeks and ok adherence; rows are correct', () => {
    const targets = baseTargets({ rulesItems: [{ id: 'r1', kind: 'ritmo_alto', value: 0.25, weeks: 2, delta_carbs_g: -25, scope: null, auto: false }] });
    const res = evalRules({ targets, bodyMetrics: bodyMetrics35(), dailyTotals: dailyTotalsGood(), todayISO: today });
    expect(res).not.toBeNull();
    expect(res.rule).toBe('ritmo_alto');
    expect(res.rows).toHaveLength(7);
    for (const row of res.rows) {
      expect(row.valid_from).toBe(addDaysISO(today, 1));
      expect(row.carbs_g).toBe(225); // 250 - 25
      expect(row.kcal).toBe(1900); // 2000 + (-25 * 4)
      expect(row.protein_g).toBe(150); // untouched
      expect(row.fat_g).toBe(60); // untouched
      expect(row.bounds).toEqual({});
      expect(row.rules).toEqual(targets[0].rules);
      expect(row.applied_rule.startsWith('r1 ')).toBe(true);
    }
  });

  it('2) does not fire when adherence deviates 12 % from target', () => {
    const targets = baseTargets({ rulesItems: [{ id: 'r1', kind: 'ritmo_alto', value: 0.25, weeks: 2, delta_carbs_g: -25 }] });
    const dailyTotals = dailyTotalsFixture([0, 1, 2, 4, 5, 6, 8, 9, 10, 12], 2240); // 12 % over the 2000 target
    expect(evalRules({ targets, bodyMetrics: bodyMetrics35(), dailyTotals, todayISO: today })).toBeNull();
  });

  it('3) does not fire with only 4 weigh-ins in the last 7 days', () => {
    const targets = baseTargets({ rulesItems: [{ id: 'r1', kind: 'ritmo_alto', value: 0.25, weeks: 2, delta_carbs_g: -25 }] });
    const bodyMetrics = weightFixture({ recentDays: [0, 1, 2, 3], recentWeight: 80.6, pastDays: [14, 15, 16, 17, 18, 19, 20], pastWeight: 80.0 });
    expect(evalRules({ targets, bodyMetrics, dailyTotals: dailyTotalsGood(), todayISO: today })).toBeNull();
  });

  it('4) does not fire when the vigente phase is only 5 days old (incomplete window)', () => {
    const targets = phaseRows({ validFrom: addDaysISO(today, -5), rules: { items: [{ id: 'r1', kind: 'ritmo_alto', value: 0.25, weeks: 2, delta_carbs_g: -25 }] } });
    expect(evalRules({ targets, bodyMetrics: bodyMetrics35(), dailyTotals: dailyTotalsGood(), todayISO: today })).toBeNull();
  });

  it('5) cooldown: a phase already tagged with this rule blocks re-firing within its window', () => {
    const ruleItems = [{ id: 'r1', kind: 'ritmo_alto', value: 0.25, weeks: 2, delta_carbs_g: -25 }];
    const targets = phaseRows({ validFrom: addDaysISO(today, -3), rules: { items: ruleItems }, applied_rule: 'r1 · +0.30 kg/sem × 2 sem · −25 g carbs' });
    expect(evalRules({ targets, bodyMetrics: bodyMetrics35(), dailyTotals: dailyTotalsGood(), todayISO: today })).toBeNull();
  });

  it('6) techo_peso computes estimated maintenance kcal and sets goal to mantenimiento', () => {
    const targets = baseTargets({ rulesItems: [{ id: 'r2', kind: 'techo_peso', value: 85 }] });
    const bodyMetrics = weightFixture({ recentDays: [0, 1, 2, 3, 4, 5, 6], recentWeight: 86, pastDays: [14, 15, 16, 17, 18, 19, 20], pastWeight: 84 });
    const dailyTotals = dailyTotalsFixture([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2200);
    const res = evalRules({ targets, bodyMetrics, dailyTotals, todayISO: today });
    expect(res).not.toBeNull();
    expect(res.rule).toBe('techo_peso');
    expect(res.why.mantenimiento).toBe(1100); // round((2200 - 1.0kg/sem*1100)/10)*10
    for (const row of res.rows) {
      expect(row.goal).toBe('mantenimiento');
      expect(row.kcal).toBe(1100);
      expect(row.carbs_g).toBe(25); // 250 + round((1100-2000)/4)
    }
  });

  it('7) deficit protection fires at −0.6 %/sem with no configured item', () => {
    const rules = { items: [] };
    const targets = phaseRows({ validFrom: vf, goal: 'deficit', kcal: 1800, rules });
    // ma7Now=80, ma7Past=80.96 → ritmo=-0.48 kg/sem → pctWk = -0.6 %
    const bodyMetrics = weightFixture({ recentDays: [0, 1, 2, 3, 4, 5, 6], recentWeight: 80, pastDays: [14, 15, 16, 17, 18, 19, 20], pastWeight: 80.96 });
    const dailyTotals = dailyTotalsFixture([0, 1, 2, 4, 5, 6, 8, 9, 10, 12], 1800);
    const res = evalRules({ targets, bodyMetrics, dailyTotals, todayISO: today });
    expect(res).not.toBeNull();
    expect(res.rule).toBe('proteccion-ritmo');
    expect(res.why.pctWk).toBeCloseTo(-0.6, 1);
    expect(res.rows[0].kcal).toBe(1800 + DEFICIT_RATE_CAP.deltaCarbsG * 4);
    expect(res.rows[0].carbs_g).toBe(250 + DEFICIT_RATE_CAP.deltaCarbsG);
    expect(res.rows[0].applied_rule.startsWith('proteccion-ritmo ')).toBe(true);
  });

  it('8) kcal_min clamp that cancels the change blocks the fire', () => {
    const targets = baseTargets({ rulesItems: [{ id: 'r1', kind: 'ritmo_alto', value: 0.25, weeks: 2, delta_carbs_g: -25 }], kcalMin: 2000 });
    expect(evalRules({ targets, bodyMetrics: bodyMetrics35(), dailyTotals: dailyTotalsGood(), todayISO: today })).toBeNull();
  });

  it('9) an unknown rule kind never fires (cleanRules already dropped it)', () => {
    const targets = baseTargets({ rulesItems: [{ id: 'rX', kind: 'bogus', value: 0.25, weeks: 2, delta_carbs_g: -25 }] });
    expect(evalRules({ targets, bodyMetrics: bodyMetrics35(), dailyTotals: dailyTotalsGood(), todayISO: today })).toBeNull();
  });

  it('10) scope only touches the listed dows', () => {
    const targets = baseTargets({ rulesItems: [{ id: 'r1', kind: 'ritmo_alto', value: 0.25, weeks: 2, delta_carbs_g: -25, scope: [1, 2, 3] }] });
    const res = evalRules({ targets, bodyMetrics: bodyMetrics35(), dailyTotals: dailyTotalsGood(), todayISO: today });
    expect(res).not.toBeNull();
    for (let dow = 0; dow < 7; dow++) {
      const row = res.rows.find((r) => r.dow === dow);
      if ([1, 2, 3].includes(dow)) {
        expect(row.carbs_g).toBe(225);
        expect(row.kcal).toBe(1900);
      } else {
        expect(row.carbs_g).toBe(250);
        expect(row.kcal).toBe(2000);
      }
    }
  });
});
