import { describe, it, expect } from 'vitest';
import { scoreCase, compareToBaseline } from './score.js';

// Caso base reutilizable: manzana estimada, kcal 63 + un micro.
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
// got mínimo con los 7 requeridos numéricos (para no arrastrar fallos ajenos al aserto).
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
    // 63*0.30 = 18.9 → [44.1, 81.9]. 47 dentro, 44 fuera.
    expect(scoreCase(appleCase(), got({ kcal: 47 })).fields.kcal.pass).toBe(true);
    expect(scoreCase(appleCase(), got({ kcal: 44 })).fields.kcal.pass).toBe(false);
  });

  it('micros estimacion ±40 %: potasio 109 → 65 pasa, 60 falla', () => {
    // 109*0.40 = 43.6 → [65.4, 152.6]. 65 fuera (65<65.4)... 66 dentro.
    expect(scoreCase(appleCase(), got({ micros: { sodio_mg: 1, potasio_mg: 66, magnesio_mg: 5 } })).fields.potasio_mg.pass).toBe(true);
    expect(scoreCase(appleCase(), got({ micros: { sodio_mg: 1, potasio_mg: 60, magnesio_mg: 5 } })).fields.potasio_mg.pass).toBe(false);
  });

  it('etiqueta: kcal max(2%,2), resto max(2%,0.5)', () => {
    const c = { id: 'lbl', expected: { mode: 'etiqueta', basis: '100g', values: { kcal: 100, protein_g: 10, micros: {} } } };
    const g = { mode: 'etiqueta', basis: '100g', kcal: 100, protein_g: 10, carbs_g: 0, fat_g: 0, micros: { sodio_mg: 0, potasio_mg: 0, magnesio_mg: 0 } };
    // kcal tol = max(2,2)=2: 102 pasa, 103 falla.
    expect(scoreCase(c, { ...g, kcal: 102 }).fields.kcal.pass).toBe(true);
    expect(scoreCase(c, { ...g, kcal: 103 }).fields.kcal.pass).toBe(false);
    // protein tol = max(0.2,0.5)=0.5: 10.5 pasa, 10.6 falla.
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
    expect(r.fields.sodio_mg.pass).toBe(false); // ausente del jsonb → no numérico
    expect(r.fields.kcal.pass).toBe(true); // numérico, sin GT → pasa
  });

  it('strict_extras: micro fuera del GT = fallo extra; requeridos exentos', () => {
    const c = appleCase({ strict_extras: true });
    const r = scoreCase(c, got({ micros: { sodio_mg: 1, potasio_mg: 109, magnesio_mg: 5, eritritol_mg: 800 } }));
    expect(r.extras).toContain('eritritol_mg');
    expect(r.extras).not.toContain('sodio_mg'); // requerido, exento
    expect(r.total).toBeGreaterThan(r.passed); // el extra baja el score
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
});
