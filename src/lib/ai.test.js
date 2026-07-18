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
  it('nullable -> [type, "null"]', () => {
    const g = { type: 'NUMBER', nullable: true };
    expect(toJsonSchema(g)).toEqual({ type: ['number', 'null'] });
  });

  it('complete required + additionalProperties:false on objects', () => {
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

  it('no quantity -> null', () => {
    expect(parseAmount('pollo a la plancha')).toBeNull();
  });
});

describe('l2normalize', () => {
  it('[3,4] -> [0.6, 0.8]', () => {
    expect(l2normalize([3, 4])).toEqual([0.6, 0.8]);
  });

  it('empty array -> null', () => {
    expect(l2normalize([])).toBeNull();
  });

  it('null -> null', () => {
    expect(l2normalize(null)).toBeNull();
  });

  it('zero vector -> null', () => {
    expect(l2normalize([0, 0, 0])).toBeNull();
  });
});

describe('sanitizeAskPlan', () => {
  const TODAY = '2026-07-15';
  const VALID = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodio_mg'];

  it('missing dates -> last 30 days ending today', () => {
    const out = sanitizeAskPlan({}, TODAY, VALID);
    expect(out.date_to).toBe(TODAY);
    expect(out.date_from).toBe('2026-06-16'); // 30 days incl. today
    expect(out.clamped).toBe(false);
  });

  it('invalid dates -> same 30-day fallback', () => {
    const out = sanitizeAskPlan({ date_from: 'no-es-fecha', date_to: '2026-07-15' }, TODAY, VALID);
    expect(out.date_to).toBe(TODAY);
    expect(out.date_from).toBe('2026-06-16');
  });

  it('date_to in the future is clamped to today', () => {
    const out = sanitizeAskPlan({ date_from: '2026-07-01', date_to: '2026-08-01' }, TODAY, VALID);
    expect(out.date_to).toBe(TODAY);
    expect(out.date_from).toBe('2026-07-01');
  });

  it('date_from > date_to get swapped', () => {
    const out = sanitizeAskPlan({ date_from: '2026-07-15', date_to: '2026-07-01' }, TODAY, VALID);
    expect(out.date_from).toBe('2026-07-01');
    expect(out.date_to).toBe('2026-07-15');
  });

  it('range > 92 days is clamped to 92 and clamped=true', () => {
    const out = sanitizeAskPlan({ date_from: '2025-01-01', date_to: TODAY }, TODAY, VALID);
    expect(out.clamped).toBe(true);
    expect(out.date_to).toBe(TODAY);
    const span = Math.round((Date.parse(`${out.date_to}T00:00:00`) - Date.parse(`${out.date_from}T00:00:00`)) / 86400000) + 1;
    expect(span).toBe(92);
  });

  it('invalid nutrients -> filtered out, empty falls back to macros', () => {
    const out = sanitizeAskPlan(
      { date_from: '2026-07-10', date_to: '2026-07-15', nutrients: ['inventado', 'otro_falso'] },
      TODAY,
      VALID,
    );
    expect(out.nutrients).toEqual(['kcal', 'protein_g', 'carbs_g', 'fat_g']);
  });

  it('valid partial nutrients are kept', () => {
    const out = sanitizeAskPlan(
      { date_from: '2026-07-10', date_to: '2026-07-15', nutrients: ['sodio_mg', 'inventado'] },
      TODAY,
      VALID,
    );
    expect(out.nutrients).toEqual(['sodio_mg']);
  });
});

describe('formatAskContext', () => {
  it('canonical case: columns, rounding and order by day', () => {
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

  it('entries null -> no Alimentos section', () => {
    const out = formatAskContext({ days: [], targetByDay: {}, entries: null, nutrients: ['kcal'], lang: 'es' });
    expect(out).not.toContain('# Alimentos');
  });

  it('more than 400 foods -> trims to the 400 with highest kcal and warns', () => {
    const entries = Array.from({ length: 401 }, (_, i) => ({ day: '2026-07-01', item: `Item${i}`, grams: 100, kcal: i }));
    const out = formatAskContext({ days: [], targetByDay: {}, entries, nutrients: ['kcal'], lang: 'es' });
    const lines = out.split('\n');
    expect(lines.at(-1)).toBe('(recortado a 400 alimentos de 401)');
    const itemLines = lines.filter((l) => l.startsWith('2026-07-01,Item'));
    expect(itemLines).toHaveLength(400);
    expect(itemLines[0]).toBe('2026-07-01,Item400,100,400'); // highest kcal first
  });
});
