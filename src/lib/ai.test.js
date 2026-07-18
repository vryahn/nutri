import { describe, it, expect, beforeAll } from 'vitest';

// i18n.js (imported by ai.js) reads localStorage at module load time (language
// detection) — it does not exist in vitest's 'node' environment; it is minimally stubbed
// and the import is done dynamically afterwards, instead of adding jsdom as a new dependency.
let toJsonSchema, parseAmount, l2normalize, sanitizeAskPlan, formatAskContext;
beforeAll(async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  ({ toJsonSchema, parseAmount, l2normalize, sanitizeAskPlan, formatAskContext } = await import('./ai.js'));
});

describe('toJsonSchema', () => {
  it('nullable -> [tipo, "null"]', () => {
    const g = { type: 'NUMBER', nullable: true };
    expect(toJsonSchema(g)).toEqual({ type: ['number', 'null'] });
  });

  it('required completo + additionalProperties:false en objetos', () => {
    const g = {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        age: { type: 'NUMBER', nullable: true },
      },
    };
    expect(toJsonSchema(g)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: ['number', 'null'] },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    });
  });
});

describe('parseAmount', () => {
  it('"350ml" -> {unit: "ml", value: 350}', () => {
    expect(parseAmount('350ml')).toEqual({ unit: 'ml', value: 350 });
  });

  it('"1.5 l" -> {unit: "ml", value: 1500}', () => {
    expect(parseAmount('1.5 l')).toEqual({ unit: 'ml', value: 1500 });
  });

  it('"200gr" -> {unit: "g", value: 200}', () => {
    expect(parseAmount('200gr')).toEqual({ unit: 'g', value: 200 });
  });

  it('"0,5 kg" -> {unit: "g", value: 500}', () => {
    expect(parseAmount('0,5 kg')).toEqual({ unit: 'g', value: 500 });
  });

  it('sin cantidad -> null', () => {
    expect(parseAmount('pollo a la plancha')).toBeNull();
  });
});

describe('l2normalize', () => {
  it('[3,4] -> [0.6, 0.8]', () => {
    expect(l2normalize([3, 4])).toEqual([0.6, 0.8]);
  });

  it('array vacío -> null', () => {
    expect(l2normalize([])).toBeNull();
  });

  it('null -> null', () => {
    expect(l2normalize(null)).toBeNull();
  });

  it('vector de ceros -> null', () => {
    expect(l2normalize([0, 0, 0])).toBeNull();
  });
});

describe('sanitizeAskPlan', () => {
  const TODAY = '2026-07-15';
  const VALID = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodio_mg'];

  it('fechas ausentes -> últimos 30 días terminando hoy', () => {
    const out = sanitizeAskPlan({}, TODAY, VALID);
    expect(out.date_to).toBe(TODAY);
    expect(out.date_from).toBe('2026-06-16'); // 30 days incl. today
    expect(out.clamped).toBe(false);
  });

  it('fechas inválidas -> mismo fallback de 30 días', () => {
    const out = sanitizeAskPlan({ date_from: 'no-es-fecha', date_to: '2026-07-15' }, TODAY, VALID);
    expect(out.date_to).toBe(TODAY);
    expect(out.date_from).toBe('2026-06-16');
  });

  it('date_to futuro se recorta a hoy', () => {
    const out = sanitizeAskPlan({ date_from: '2026-07-01', date_to: '2026-08-01' }, TODAY, VALID);
    expect(out.date_to).toBe(TODAY);
    expect(out.date_from).toBe('2026-07-01');
  });

  it('date_from > date_to se intercambian', () => {
    const out = sanitizeAskPlan({ date_from: '2026-07-15', date_to: '2026-07-01' }, TODAY, VALID);
    expect(out.date_from).toBe('2026-07-01');
    expect(out.date_to).toBe('2026-07-15');
  });

  it('rango > 92 días se recorta a 92 y clamped=true', () => {
    const out = sanitizeAskPlan({ date_from: '2025-01-01', date_to: TODAY }, TODAY, VALID);
    expect(out.clamped).toBe(true);
    expect(out.date_to).toBe(TODAY);
    const span = Math.round((Date.parse(`${out.date_to}T00:00:00`) - Date.parse(`${out.date_from}T00:00:00`)) / 86400000) + 1;
    expect(span).toBe(92);
  });

  it('nutrients inválidos -> filtrados, vacío cae a macros', () => {
    const out = sanitizeAskPlan(
      { date_from: '2026-07-10', date_to: '2026-07-15', nutrients: ['inventado', 'otro_falso'] },
      TODAY,
      VALID,
    );
    expect(out.nutrients).toEqual(['kcal', 'protein_g', 'carbs_g', 'fat_g']);
  });

  it('nutrients válidos parciales se conservan', () => {
    const out = sanitizeAskPlan(
      { date_from: '2026-07-10', date_to: '2026-07-15', nutrients: ['sodio_mg', 'inventado'] },
      TODAY,
      VALID,
    );
    expect(out.nutrients).toEqual(['sodio_mg']);
  });
});

describe('formatAskContext', () => {
  it('caso canónico: columnas, redondeo y orden por día', () => {
    const days = [
      { day: '2026-07-02', kcal: 2000, protein_g: 150, micros: { sodio_mg: 1500 } },
      { day: '2026-07-01', kcal: 1850.44, protein_g: 142.36, micros: { sodio_mg: 2890.5 } },
    ];
    const targetByDay = {
      '2026-07-01': { kcal: 2400, protein_g: 165, micros: { sodio_mg: 2000 } },
      '2026-07-02': null,
    };
    const entries = [
      { day: '2026-07-01', item: 'Chilaquiles', grams: 320, kcal: 610.2, protein_g: 18.24, micros: { sodio_mg: 980.7 } },
      { day: '2026-07-02', item: 'Huevo', grams: 100, kcal: 155, protein_g: 12.6 },
    ];
    const out = formatAskContext({ days, targetByDay, entries, nutrients: ['kcal', 'protein_g', 'sodio_mg'], lang: 'es' });
    expect(out).toBe(
      [
        '# Totales diarios (unidades: kcal, g o mg segun la clave)',
        'day,kcal,protein_g,sodio_mg',
        '2026-07-01,1850.4,142.4,2890.5',
        '2026-07-02,2000,150,1500',
        '# Objetivo del día (mismas columnas; vacío si no hay)',
        'day,kcal,protein_g,sodio_mg',
        '2026-07-01,2400,165,2000',
        '2026-07-02,,,',
        '# Alimentos',
        'day,item,grams,kcal,protein_g,sodio_mg',
        '2026-07-01,Chilaquiles,320,610.2,18.2,980.7',
        '2026-07-02,Huevo,100,155,12.6,',
      ].join('\n'),
    );
  });

  it('entries null -> sin sección de Alimentos', () => {
    const out = formatAskContext({ days: [], targetByDay: {}, entries: null, nutrients: ['kcal'], lang: 'es' });
    expect(out).not.toContain('# Alimentos');
  });

  it('más de 400 alimentos -> recorta a los 400 con mayor kcal y avisa', () => {
    const entries = Array.from({ length: 401 }, (_, i) => ({ day: '2026-07-01', item: `Item${i}`, grams: 100, kcal: i }));
    const out = formatAskContext({ days: [], targetByDay: {}, entries, nutrients: ['kcal'], lang: 'es' });
    const lines = out.split('\n');
    expect(lines.at(-1)).toBe('(recortado a 400 alimentos de 401)');
    const itemLines = lines.filter((l) => l.startsWith('2026-07-01,Item'));
    expect(itemLines).toHaveLength(400);
    expect(itemLines[0]).toBe('2026-07-01,Item400,100,400'); // highest kcal first
  });
});
