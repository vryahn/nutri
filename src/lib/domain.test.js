import { describe, it, expect } from 'vitest';
import {
  computeRecipePer100g, resolveTarget, weekdayOf, kcalFromMacros, kcalSuspicious,
  macrosImplausible, componentsInconsistent, dayCompleteness, bayesAdherence,
  reorderLabels, eanChecksumValid, cleanNumericMap,
  nutrientKind, classifyDiana, classifyKcal, classifyFloor, classifyBand,
  classifyCeiling, classifySodium, sodiumIsLow, sodiumIsHigh,
  SODIUM_FLOOR_MG, SODIUM_CEILING_MG,
  DASH_VARS_BY_KEY, axisUnits, buildDashSeries, dashVarTarget,
  autoAgg, resolveAgg, reduceBucket, bucketRows, mergeFoodResults,
} from './domain.js';

describe('agregación temporal de gráficas custom', () => {
  it('autoAgg deriva el bucket del largo del rango', () => {
    expect(autoAgg(7)).toBe('dia');
    expect(autoAgg(45)).toBe('dia');
    expect(autoAgg(46)).toBe('semana');
    expect(autoAgg(182)).toBe('semana');
    expect(autoAgg(183)).toBe('mes');
    expect(autoAgg(365)).toBe('mes');
  });

  it('resolveAgg: auto/undefined → autoAgg; explícito manda', () => {
    expect(resolveAgg('auto', 7)).toBe('dia');
    expect(resolveAgg(undefined, 200)).toBe('mes');
    expect(resolveAgg('mes', 7)).toBe('mes');
  });

  it('reduceBucket ignora nulls; bucket vacío → null', () => {
    expect(reduceBucket([1, 2, 3, null], 'suma')).toBe(6);
    expect(reduceBucket([1, 2, 3, 4], 'promedio')).toBe(2.5);
    expect(reduceBucket([1, 2, 3, 4], 'mediana')).toBe(2.5);
    expect(reduceBucket([null, null], 'promedio')).toBeNull();
    expect(reduceBucket([], 'suma')).toBeNull();
  });

  it('bucketRows agrupa por semana ISO (lunes) y reduce', () => {
    // 2026-07-06 = lunes; 06..12 = una semana; 13 = semana siguiente
    const daily = ['2026-07-06', '2026-07-08', '2026-07-12', '2026-07-13'].map((day, i) => ({ day, x: i + 1 }));
    const suma = bucketRows(daily, ['x'], 'semana', 'suma');
    expect(suma.map((r) => r.day)).toEqual(['2026-07-06', '2026-07-13']);
    expect(suma[0].x).toBe(1 + 2 + 3); // 06,08,12 caen en la semana del 06
    expect(suma[1].x).toBe(4); // 13
    expect(suma[0].label).toBe('07-06');
    const prom = bucketRows(daily, ['x'], 'semana', 'promedio');
    expect(prom[0].x).toBe(2); // (1+2+3)/3
  });

  it('bucketRows mensual etiqueta YYYY-MM', () => {
    const daily = ['2026-06-30', '2026-07-01', '2026-07-15'].map((day, i) => ({ day, x: i + 1 }));
    const s = bucketRows(daily, ['x'], 'mes', 'suma');
    expect(s.map((r) => r.label)).toEqual(['2026-06', '2026-07']);
    expect(s[1].x).toBe(2 + 3);
  });

  it('buildDashSeries agrega nutrición por semana con Suma', () => {
    const nutByDay = new Map([
      ['2026-07-06', { day: '2026-07-06', kcal: 2000 }],
      ['2026-07-08', { day: '2026-07-08', kcal: 1800 }],
    ]);
    const s = buildDashSeries(['2026-07-06', '2026-07-07', '2026-07-08'], [DASH_VARS_BY_KEY.kcal], nutByDay, new Map(), 'semana', 'suma');
    expect(s).toHaveLength(1);
    expect(s[0].kcal).toBe(3800); // 07-07 no registrado → null, ignorado
  });

  it('kind: nutrición flow, medidas/derivadas stock', () => {
    expect(DASH_VARS_BY_KEY.kcal.kind).toBe('flow');
    expect(DASH_VARS_BY_KEY.sodio_mg.kind).toBe('flow');
    expect(DASH_VARS_BY_KEY.peso_kg.kind).toBe('stock');
    expect(DASH_VARS_BY_KEY.imc.kind).toBe('stock');
  });
});

describe('gráficas personalizadas del Dashboard', () => {
  const nutByDay = new Map([
    ['2026-07-01', { day: '2026-07-01', kcal: 2000, protein_g: 150, micros: { sodio_mg: 1800 } }],
    // 07-02 no registrado (sin fila) → nutrición debe dar null, no 0
  ]);
  const bodyByDay = new Map([
    ['2026-07-01', { day: '2026-07-01', metrics: { peso_kg: 57.5, grasa_pct: 20, cintura_cm: 82 } }],
    // 07-02 sin medición → body null (serie dispersa)
  ]);
  const dates = ['2026-07-01', '2026-07-02'];

  it('agrupa unidades en ≤2 ejes por orden de aparición', () => {
    const vars = [DASH_VARS_BY_KEY.peso_kg, DASH_VARS_BY_KEY.cintura_cm];
    expect(axisUnits(vars)).toEqual(['kg', 'cm']);
    // 3ª unidad distinta se recorta a 2
    expect(axisUnits([DASH_VARS_BY_KEY.peso_kg, DASH_VARS_BY_KEY.cintura_cm, DASH_VARS_BY_KEY.grasa_pct])).toEqual(['kg', 'cm']);
  });

  it('alinea nutrición (densa, 0 real) y medidas (dispersas, null) por día', () => {
    const vars = [DASH_VARS_BY_KEY.protein_g, DASH_VARS_BY_KEY.peso_kg, DASH_VARS_BY_KEY.sodio_mg];
    const s = buildDashSeries(dates, vars, nutByDay, bodyByDay);
    expect(s[0]).toMatchObject({ protein_g: 150, peso_kg: 57.5, sodio_mg: 1800 });
    // día no registrado → nutrición null (no 0 falso); sin medición → body null
    expect(s[1]).toMatchObject({ protein_g: null, peso_kg: null, sodio_mg: null });
  });

  it('resuelve derivadas (IMC) con las medidas del día + altura del Perfil', () => {
    const s = buildDashSeries(dates, [DASH_VARS_BY_KEY.imc], nutByDay, bodyByDay, 'dia', 'promedio', 175);
    expect(s[0].imc).toBeCloseTo(57.5 / (1.75 * 1.75), 1);
    expect(s[1].imc).toBeNull();
    // sin altura de Perfil → derivadas null aunque haya peso/grasa del día
    const sinAltura = buildDashSeries(dates, [DASH_VARS_BY_KEY.imc], nutByDay, bodyByDay);
    expect(sinAltura[0].imc).toBeNull();
  });

  it('objetivo solo aplica a nutrición; body/derived no lo tienen', () => {
    const target = { kcal: 1800, protein_g: 155, micros: { sodio_mg: 2000 } };
    expect(dashVarTarget(DASH_VARS_BY_KEY.protein_g, target)).toBe(155);
    expect(dashVarTarget(DASH_VARS_BY_KEY.sodio_mg, target)).toBe(2000);
    expect(dashVarTarget(DASH_VARS_BY_KEY.peso_kg, target)).toBeNull();
    expect(dashVarTarget(DASH_VARS_BY_KEY.imc, target)).toBeNull();
  });
});

describe('cleanNumericMap', () => {
  it('conserva números finitos ≥ 0 y descarta vacíos, negativos y basura', () => {
    expect(cleanNumericMap({ peso_kg: '80.5', grasa_pct: 22, vacio: '', nulo: null, neg: -3, txt: 'abc', nan: NaN }))
      .toEqual({ peso_kg: 80.5, grasa_pct: 22 });
  });
  it('mapa vacío o nulo -> {}', () => {
    expect(cleanNumericMap({})).toEqual({});
    expect(cleanNumericMap(null)).toEqual({});
  });
});

describe('computeRecipePer100g', () => {
  const A = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, micros: { sodio_mg: 50 } };
  const B = { kcal: 200, protein_g: 20, carbs_g: 10, fat_g: 8, micros: { sodio_mg: 30 } };

  it('100g A + 200g B, peso cocido 250 -> por 100g = (A+2B)/2.5', () => {
    const r = computeRecipePer100g([{ food: A, grams: 100 }, { food: B, grams: 200 }], 250);
    expect(r.kcal).toBe(200);
    expect(r.protein_g).toBe(20);
    expect(r.carbs_g).toBe(16);
    expect(r.fat_g).toBe(8.4);
    expect(r.micros.sodio_mg).toBe(44);
  });

  it('sin peso cocido usa suma de ingredientes', () => {
    const r = computeRecipePer100g([{ food: A, grams: 100 }, { food: B, grams: 200 }], null);
    expect(r.kcal).toBe(166.7);
    expect(r.protein_g).toBe(16.67);
    expect(r.carbs_g).toBe(13.33);
    expect(r.fat_g).toBe(7);
  });

  it('peso 0 (sin ingredientes) -> null', () => {
    expect(computeRecipePer100g([], 0)).toBeNull();
  });
});

describe('resolveTarget', () => {
  it('day exacto gana a dow', () => {
    const dateISO = '2026-07-10';
    const dow = weekdayOf(dateISO);
    const targets = [
      { day: dateISO, dow: null, valid_from: '2026-01-01', kcal: 1500 },
      { day: null, dow, valid_from: '2026-01-01', kcal: 2000 },
    ];
    expect(resolveTarget(targets, dateISO)).toEqual(targets[0]);
  });

  it('entre dow gana mayor valid_from <= F', () => {
    const dateISO = '2026-07-10';
    const dow = weekdayOf(dateISO);
    const older = { day: null, dow, valid_from: '2026-01-01', kcal: 1800 };
    const newer = { day: null, dow, valid_from: '2026-06-01', kcal: 2000 };
    const future = { day: null, dow, valid_from: '2026-08-01', kcal: 2200 };
    expect(resolveTarget([older, newer, future], dateISO)).toEqual(newer);
  });

  it('sin candidatas -> null', () => {
    const dateISO = '2026-07-10';
    const dow = weekdayOf(dateISO);
    const wrongDow = { day: null, dow: (dow + 1) % 7, valid_from: '2026-01-01', kcal: 1800 };
    expect(resolveTarget([wrongDow], dateISO)).toBeNull();
  });
});

describe('kcalFromMacros / kcalSuspicious', () => {
  it('fibra resta 2 kcal/g', () => {
    const f = { protein_g: 0, carbs_g: 20, fat_g: 0, micros: { fibra_g: 5 } };
    expect(kcalFromMacros(f)).toBe(70); // 4*20 - 2*5
  });

  it('alcohol suma 7 kcal/g', () => {
    const f = { protein_g: 0, carbs_g: 0, fat_g: 0, micros: { alcohol_g: 10 } };
    expect(kcalFromMacros(f)).toBe(70); // 7*10
  });

  it('polialcoholes: total declarado corrige a 2.4 kcal/g (resta 1.6/g)', () => {
    // carbs 20 los cuenta a 4 (=80); 10 g son polioles -> -16 -> 64
    const f = { protein_g: 0, carbs_g: 20, fat_g: 0, micros: { polioles_g: 10 } };
    expect(kcalFromMacros(f)).toBe(64);
  });

  it('polialcoholes: sin total usa la suma de individuales', () => {
    const f = { protein_g: 0, carbs_g: 20, fat_g: 0, micros: { xilitol_g: 6, sorbitol_g: 4 } };
    expect(kcalFromMacros(f)).toBe(64); // -1.6*(6+4)
  });

  it('tolerancia max(20 kcal, 25%)', () => {
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
  it('true: suma de macros+alcohol+agua > 105', () => {
    expect(macrosImplausible({ protein_g: 50, carbs_g: 50, fat_g: 10, micros: {} })).toBe(true);
  });

  it('false: suma dentro de rango', () => {
    expect(macrosImplausible({ protein_g: 30, carbs_g: 30, fat_g: 30, micros: {} })).toBe(false);
  });

  it('true: un micro supera su cota en MICRO_MAX', () => {
    expect(macrosImplausible({ protein_g: 0, carbs_g: 0, fat_g: 0, micros: { sodio_mg: 50000 } })).toBe(true);
  });
});

describe('componentsInconsistent', () => {
  it('razón: grasa sat.+trans > grasa total (+0.5 holgura)', () => {
    const f = { fat_g: 5, micros: { grasa_sat_g: 6 } };
    expect(componentsInconsistent(f)).toBe('grasa saturada + trans supera la grasa total');
  });

  it('null: grasa sat.+trans <= grasa total', () => {
    const f = { fat_g: 5, micros: { grasa_sat_g: 5 } };
    expect(componentsInconsistent(f)).toBeNull();
  });

  it('dato ausente no cuenta como 0 (fat_g ausente no dispara la desigualdad)', () => {
    const f = { fat_g: '', micros: { grasa_sat_g: 100 } };
    expect(componentsInconsistent(f)).toBeNull();
  });

  it('razón: polialcoholes > carbohidratos', () => {
    expect(componentsInconsistent({ carbs_g: 10, micros: { polioles_g: 12 } }))
      .toBe('polialcoholes superan los carbohidratos');
  });

  it('razón: suma de azúcares individuales > azúcar total', () => {
    const f = { micros: { azucar_g: 5, glucosa_g: 4, fructosa_g: 4 } };
    expect(componentsInconsistent(f)).toBe('los azúcares desglosados superan el azúcar total');
  });

  it('razón: ALA+EPA+DHA > omega-3 total', () => {
    const f = { micros: { omega3_g: 1, ala_g: 0.8, epa_g: 0.5, dha_g: 0.5 } }; // 1.8 > 1+0.5
    expect(componentsInconsistent(f)).toBe('ALA + EPA + DHA superan el omega-3 total');
  });

  it('null: aminoácidos ya no se comparan contra proteína (Kjeldahl/base distinta)', () => {
    const f = { protein_g: 1, micros: { leucina_g: 0.8, lisina_g: 0.8 } };
    expect(componentsInconsistent(f)).toBeNull();
  });
});

describe('dayCompleteness', () => {
  it('sin_registro: kcal <= 0', () => {
    expect(dayCompleteness({ kcal: 0, targetKcal: 2000, historyKcals: [], mealsCount: 0, typicalMeals: 0 })).toBe('sin_registro');
  });

  it('sin_evaluar: sin historial suficiente y sin target', () => {
    expect(dayCompleteness({ kcal: 800, targetKcal: null, historyKcals: [], mealsCount: 2, typicalMeals: 2 })).toBe('sin_evaluar');
  });

  it('completo: con historial, kcal >= 60% de la mediana', () => {
    const historyKcals = [2000, 2000, 2000, 2000, 2000, 2000, 2000];
    expect(dayCompleteness({ kcal: 1300, targetKcal: null, historyKcals, mealsCount: 3, typicalMeals: 3 })).toBe('completo');
  });

  it('parcial: con historial, kcal < 60% de la mediana', () => {
    const historyKcals = [2000, 2000, 2000, 2000, 2000, 2000, 2000];
    expect(dayCompleteness({ kcal: 1000, targetKcal: null, historyKcals, mealsCount: 3, typicalMeals: 3 })).toBe('parcial');
  });

  it('bingeOverride: typicalMeals >= 3 y mealsCount <= 1 -> parcial aunque kcal sea alto', () => {
    const historyKcals = [2000, 2000, 2000, 2000, 2000, 2000, 2000];
    expect(dayCompleteness({ kcal: 2000, targetKcal: null, historyKcals, mealsCount: 1, typicalMeals: 3 })).toBe('parcial');
  });
});

describe('bayesAdherence', () => {
  it('bayesAdherence(8,10): mean 0.75, lower < mean < upper, en [0,1]', () => {
    const { mean, lower, upper } = bayesAdherence(8, 10);
    expect(mean).toBeCloseTo(0.75, 10);
    expect(lower).toBeLessThan(mean);
    expect(mean).toBeLessThan(upper);
    expect(lower).toBeGreaterThanOrEqual(0);
    expect(upper).toBeLessThanOrEqual(1);
  });
});

describe('reorderLabels', () => {
  it('reindexa 0..n-1 devolviendo solo las filas que cambiaron', () => {
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

  it('borde: mover el primero hacia arriba -> []', () => {
    const labels = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }];
    expect(reorderLabels(labels, 0, -1)).toEqual([]);
  });

  it('borde: mover el último hacia abajo -> []', () => {
    const labels = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }];
    expect(reorderLabels(labels, 1, 1)).toEqual([]);
  });
});

describe('eanChecksumValid', () => {
  it('EAN-13 real válido', () => {
    expect(eanChecksumValid('4006381333931')).toBe(true);
  });

  it('mismo EAN con un dígito alterado -> inválido', () => {
    expect(eanChecksumValid('4006381333932')).toBe(false);
  });
});

describe('nutrientKind', () => {
  it('mapea cada arquetipo y default = meta', () => {
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

describe('classifyDiana (banda asimétrica por régimen)', () => {
  it('sin régimen conserva la banda estricta histórica ±5 / ±15', () => {
    expect(classifyDiana(2000, 2000, null)).toBe('ok');
    expect(classifyDiana(2000 * 1.05, 2000, null)).toBe('ok');
    expect(classifyDiana(2000 * 1.10, 2000, null)).toBe('warn');
    expect(classifyDiana(2000 * 1.20, 2000, null)).toBe('danger');
    expect(classifyKcal(2000 * 1.20, 2000)).toBe('danger'); // compat wrapper
  });
  it('déficit: el exceso pesa más que el defecto', () => {
    // −12% en déficit sigue en ok (defecto tolerado hasta −15%)
    expect(classifyDiana(2000 * 0.88, 2000, 'deficit')).toBe('ok');
    // +12% en déficit ya es warn (exceso ok solo hasta +8%)
    expect(classifyDiana(2000 * 1.12, 2000, 'deficit')).toBe('warn');
    // +20% en déficit es danger (warn de exceso hasta +18%)
    expect(classifyDiana(2000 * 1.20, 2000, 'deficit')).toBe('danger');
  });
  it('volumen: el defecto pesa más que el exceso (espejo)', () => {
    expect(classifyDiana(2000 * 1.12, 2000, 'volumen')).toBe('ok');
    expect(classifyDiana(2000 * 0.88, 2000, 'volumen')).toBe('warn');
  });
  it('sin objetivo -> null', () => {
    expect(classifyDiana(2000, 0, 'deficit')).toBe(null);
  });
});

describe('classifyFloor / classifyBand / classifyCeiling', () => {
  it('piso: alcanzar o pasar = ok, quedarse corto = danger', () => {
    expect(classifyFloor(120, 100)).toBe('ok');
    expect(classifyFloor(90, 100)).toBe('danger');
  });
  it('rango: banda simétrica ±15 ok / ±30 warn / fuera danger', () => {
    expect(classifyBand(150, 150)).toBe('ok');
    expect(classifyBand(150 * 1.15, 150)).toBe('ok');
    expect(classifyBand(150 * 1.30, 150)).toBe('warn');
    expect(classifyBand(150 * 1.5, 150)).toBe('danger'); // carbs 220 vs 150 ≈ +47%
  });
  it('techo: en/bajo el límite ok, +10% warn, más danger', () => {
    expect(classifyCeiling(20, 25)).toBe('ok');
    expect(classifyCeiling(25, 25)).toBe('ok');
    expect(classifyCeiling(30, 25)).toBe('danger'); // azúcar añadido 30 vs 25 = +20%
    expect(classifyCeiling(27, 25)).toBe('warn'); // +8%
  });
});

describe('sodio dual (piso 1500 + techo 2300)', () => {
  it('constantes médicas', () => {
    expect(SODIUM_FLOOR_MG).toBe(1500);
    expect(SODIUM_CEILING_MG).toBe(2300);
  });
  it('classifySodium: danger fuera de [piso, techo], ok dentro', () => {
    expect(classifySodium(2000, true)).toBe('ok');
    expect(classifySodium(1200, true)).toBe('danger'); // bajo piso
    expect(classifySodium(2600, true)).toBe('danger'); // sobre techo
    expect(classifySodium(2000, false)).toBe(null); // sin registros
  });
  it('sodiumIsLow / sodiumIsHigh respetan hasEntries', () => {
    expect(sodiumIsLow(1200, true)).toBe(true);
    expect(sodiumIsLow(1200, false)).toBe(false);
    expect(sodiumIsHigh(2600, true)).toBe(true);
    expect(sodiumIsHigh(2000, true)).toBe(false);
  });
});

describe('mergeFoodResults', () => {
  it('primary primero, semantic dedup por id', () => {
    const primary = [{ id: 1 }, { id: 2 }];
    const semantic = [{ id: 2 }, { id: 3 }];
    expect(mergeFoodResults(primary, semantic)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('recorta a max', () => {
    const primary = [{ id: 1 }, { id: 2 }];
    const semantic = [{ id: 3 }, { id: 4 }, { id: 5 }];
    expect(mergeFoodResults(primary, semantic, 3)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('semantic vacío o null se tolera', () => {
    const primary = [{ id: 1 }];
    expect(mergeFoodResults(primary, [])).toEqual(primary);
    expect(mergeFoodResults(primary, null)).toEqual(primary);
  });
});
