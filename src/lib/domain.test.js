import { describe, it, expect } from 'vitest';
import {
  computeRecipePer100g, resolveTarget, weekdayOf, kcalFromMacros, kcalSuspicious,
  macrosImplausible, componentsInconsistent, dayCompleteness, bayesAdherence,
  reorderLabels, eanChecksumValid,
} from './domain.js';

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
  it('true: grasa sat.+trans > grasa total (+0.5 holgura)', () => {
    const f = { fat_g: 5, micros: { grasa_sat_g: 6 } };
    expect(componentsInconsistent(f)).toBe(true);
  });

  it('false: grasa sat.+trans <= grasa total', () => {
    const f = { fat_g: 5, micros: { grasa_sat_g: 5 } };
    expect(componentsInconsistent(f)).toBe(false);
  });

  it('dato ausente no cuenta como 0 (fat_g ausente no dispara la desigualdad)', () => {
    const f = { fat_g: '', micros: { grasa_sat_g: 100 } };
    expect(componentsInconsistent(f)).toBe(false);
  });

  it('true: polialcoholes > carbohidratos', () => {
    expect(componentsInconsistent({ carbs_g: 10, micros: { polioles_g: 12 } })).toBe(true);
  });

  it('true: suma de azúcares individuales > azúcar total', () => {
    const f = { micros: { azucar_g: 5, glucosa_g: 4, fructosa_g: 4 } };
    expect(componentsInconsistent(f)).toBe(true);
  });

  it('true: ALA+EPA+DHA > omega-3 total', () => {
    const f = { micros: { omega3_g: 1, ala_g: 0.8, epa_g: 0.5, dha_g: 0.5 } }; // 1.8 > 1+0.5
    expect(componentsInconsistent(f)).toBe(true);
  });

  it('true: suma de aminoácidos > proteína', () => {
    const f = { protein_g: 1, micros: { leucina_g: 0.8, lisina_g: 0.8 } };
    expect(componentsInconsistent(f)).toBe(true);
  });

  it('false: suma parcial de aminoácidos bajo la proteína', () => {
    const f = { protein_g: 10, micros: { leucina_g: 0.8, lisina_g: 0.8 } };
    expect(componentsInconsistent(f)).toBe(false);
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
