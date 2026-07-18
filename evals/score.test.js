import { describe, it, expect } from 'vitest';
import { scoreCase, compareToBaseline } from './score.js';

// Reusable base case: estimated apple, kcal 63 + one micro.
function appleCase(overrides) {
  return {
    id: 'apple',
    expected: {
      mode: 'estimacion',
      basis: '100g',
      values: { kcal: 63, protein_g: 0.2, carbs_g: 15.2, fat_g: 0.18, micros: { potasio_mg: 109 } },
    },
    ...overrides,
  };
}
// Minimal got with the 7 required fields numeric (to avoid dragging in failures unrelated to the assertion).
function got(over = {}) {
  return {
    mode: 'estimacion', basis: '100g', ai_model: 'gemini:test',
    kcal: 63, protein_g: 0.2, carbs_g: 15.2, fat_g: 0.18,
    micros: { sodio_mg: 1, potasio_mg: 109, magnesio_mg: 5 },
    ...over,
  };
}

describe('scoreCase — tolerancia por modo', () => {
  it('estimacion ±30 %: kcal 63 → 47 pasa, 44 falla', () => {
    // 63*0.30 = 18.9 → [44.1, 81.9]. 47 inside, 44 outside.
    expect(scoreCase(appleCase(), got({ kcal: 47 })).fields.kcal.pass).toBe(true);
    expect(scoreCase(appleCase(), got({ kcal: 44 })).fields.kcal.pass).toBe(false);
  });

  it('micros estimacion ±40 %: potasio 109 → 65 pasa, 60 falla', () => {
    // 109*0.40 = 43.6 → [65.4, 152.6]. 65 outside (65<65.4)... 66 inside.
    expect(scoreCase(appleCase(), got({ micros: { sodio_mg: 1, potasio_mg: 66, magnesio_mg: 5 } })).fields.potasio_mg.pass).toBe(true);
    expect(scoreCase(appleCase(), got({ micros: { sodio_mg: 1, potasio_mg: 60, magnesio_mg: 5 } })).fields.potasio_mg.pass).toBe(false);
  });

  it('estimacion piso absoluto 0.5: esperado 0 no exige exactitud', () => {
    const c = { id: 'z', expected: { mode: 'estimacion', basis: '100g', values: { fat_g: 0, micros: {} } } };
    expect(scoreCase(c, got({ fat_g: 0.3 })).fields.fat_g.pass).toBe(true);
    expect(scoreCase(c, got({ fat_g: 0.6 })).fields.fat_g.pass).toBe(false);
  });

  it('etiqueta: kcal max(2%,2), resto max(2%,0.5)', () => {
    const c = { id: 'lbl', expected: { mode: 'etiqueta', basis: '100g', values: { kcal: 100, protein_g: 10, micros: {} } } };
    const g = { mode: 'etiqueta', basis: '100g', kcal: 100, protein_g: 10, carbs_g: 0, fat_g: 0, micros: { sodio_mg: 0, potasio_mg: 0, magnesio_mg: 0 } };
    // kcal tol = max(2,2)=2: 102 passes, 103 fails.
    expect(scoreCase(c, { ...g, kcal: 102 }).fields.kcal.pass).toBe(true);
    expect(scoreCase(c, { ...g, kcal: 103 }).fields.kcal.pass).toBe(false);
    // protein tol = max(0.2,0.5)=0.5: 10.5 passes, 10.6 fails.
    expect(scoreCase(c, { ...g, protein_g: 10.5 }).fields.protein_g.pass).toBe(true);
    expect(scoreCase(c, { ...g, protein_g: 10.6 }).fields.protein_g.pass).toBe(false);
  });
});

describe('scoreCase — override, requeridos, extras, mode', () => {
  it('override por campo: kcal ±10 %', () => {
    const c = appleCase({ tolerances: { kcal: 0.1 } }); // 63*0.1=6.3 → [56.7,69.3]
    expect(scoreCase(c, got({ kcal: 57 })).fields.kcal.pass).toBe(true);
    expect(scoreCase(c, got({ kcal: 55 })).fields.kcal.pass).toBe(false);
  });

  it('requerido no numérico (null/"") falla aunque no haya GT', () => {
    const c = { id: 'x', expected: { mode: 'estimacion', basis: '100g', values: {} } };
    const r = scoreCase(c, got({ sodio_mg: undefined, micros: { potasio_mg: 109, magnesio_mg: 5 } }));
    expect(r.fields.sodio_mg.pass).toBe(false); // absent from the jsonb → not numeric
    expect(r.fields.kcal.pass).toBe(true); // numeric, no GT → passes
  });

  it('strict_extras: micro fuera del GT = fallo extra; requeridos exentos', () => {
    const c = appleCase({ strict_extras: true });
    const r = scoreCase(c, got({ micros: { sodio_mg: 1, potasio_mg: 109, magnesio_mg: 5, eritritol_mg: 800 } }));
    expect(r.extras).toContain('eritritol_mg');
    expect(r.extras).not.toContain('sodio_mg'); // required, exempt
    expect(r.total).toBeGreaterThan(r.passed); // the extra lowers the score
  });

  it('mode distinto → todo el caso falla', () => {
    const r = scoreCase(appleCase(), got({ mode: 'etiqueta' }));
    expect(r.mode_ok).toBe(false);
    expect(Object.values(r.fields).every((f) => !f.pass)).toBe(true);
  });

  it('basis distinto → todo el caso falla', () => {
    const r = scoreCase(appleCase(), got({ basis: '100ml' }));
    expect(r.basis_ok).toBe(false);
    expect(Object.values(r.fields).every((f) => !f.pass)).toBe(true);
  });
});

describe('compareToBaseline', () => {
  const base = [{ id: 'a', fields: { kcal: { pass: true }, sodio_mg: { pass: false } } }];

  it('regresión: campo que pasaba y ahora falla', () => {
    const run = [{ id: 'a', fields: { kcal: { pass: false, got: 30, expected: 63 }, sodio_mg: { pass: false } } }];
    const cmp = compareToBaseline(base, run);
    expect(cmp.regressions).toHaveLength(1);
    expect(cmp.regressions[0].field).toBe('kcal');
  });

  it('mejora: campo que fallaba y ahora pasa (no es regresión)', () => {
    const run = [{ id: 'a', fields: { kcal: { pass: true }, sodio_mg: { pass: true } } }];
    const cmp = compareToBaseline(base, run);
    expect(cmp.regressions).toHaveLength(0);
    expect(cmp.improvements.map((i) => i.field)).toContain('sodio_mg');
  });

  it('caso nuevo sin baseline → reportado como nuevo, no falla', () => {
    const run = [
      { id: 'a', fields: { kcal: { pass: true }, sodio_mg: { pass: false } } },
      { id: 'b', fields: { kcal: { pass: true } } },
    ];
    const cmp = compareToBaseline(base, run);
    expect(cmp.regressions).toHaveLength(0);
    expect(cmp.newItems.some((n) => n.id === 'b')).toBe(true);
  });

  it('caso del baseline ausente en la corrida → regresión', () => {
    const cmp = compareToBaseline(base, []);
    expect(cmp.regressions.some((r) => r.id === 'a' && r.field === null)).toBe(true);
  });

  it('extras: regresión solo si el conteo crece más allá de 1.5×+3', () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => `x${i}`);
    const run = (n) => [{ id: 'a', fields: {}, extras: mk(n) }];
    const base0 = [{ id: 'a', fields: {}, extras: [] }];
    // 0 → threshold 3: 3 extras tolerated, 4 is a regression.
    expect(compareToBaseline(base0, run(3)).regressions).toHaveLength(0);
    expect(compareToBaseline(base0, run(4)).regressions.some((r) => r.field === 'extras')).toBe(true);
    // 60 → threshold 93: fine variation tolerated, a big jump gates.
    const base60 = [{ id: 'a', fields: {}, extras: mk(60) }];
    expect(compareToBaseline(base60, run(90)).regressions).toHaveLength(0);
    expect(compareToBaseline(base60, run(94)).regressions.some((r) => r.field === 'extras')).toBe(true);
    // An old baseline without the extras field does not blow up.
    expect(compareToBaseline([{ id: 'a', fields: {} }], run(0)).regressions).toHaveLength(0);
  });
});
