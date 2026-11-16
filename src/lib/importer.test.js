import { describe, it, expect } from 'vitest';
import { parseCSV, matchFood, foodsFromCSV, entriesFromCSV, parseIngredientLines, bodyMetricsFromCSV, BODY_TEMPLATE_HEADERS_EN } from './importer.js';

describe('parseCSV', () => {
  it('parses quotes, internal commas, escaped quotes and CRLF', () => {
    const { headers, rows } = parseCSV('name,note\r\n"Arroz, blanco","dice ""hola"""\r\nAvena,\r\n');
    expect(headers).toEqual(['name', 'note']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Arroz, blanco', note: 'dice "hola"' });
    expect(rows[1]).toEqual({ name: 'Avena', note: '' });
  });
  it('ignores blank lines and a trailing line with no newline', () => {
    expect(parseCSV('a,b\n1,2\n\n3,4').rows).toHaveLength(2);
  });
});

describe('matchFood', () => {
  const foods = [{ id: 1, name: 'Avena' }, { id: 2, name: 'Plátano' }, { id: 3, name: 'Arroz integral' }];
  it('exact match ignoring accents and case', () => {
    expect(matchFood('platano', foods).id).toBe(2);
    expect(matchFood('  AVENA ', foods).id).toBe(1);
  });
  it('unique substring matches', () => {
    expect(matchFood('arroz', foods).id).toBe(3);
  });
  it('no match or empty returns null', () => {
    expect(matchFood('quinoa', foods)).toBeNull();
    expect(matchFood('', foods)).toBeNull();
  });
  it('refuses exact duplicate names belonging to different foods', () => {
    expect(matchFood('leche', [{ id: 1, name: 'Leche' }, { id: 2, name: 'LECHE' }])).toBeNull();
  });
  it('ambiguous returns null (no guessing)', () => {
    const dup = [{ id: 1, name: 'Leche entera' }, { id: 2, name: 'Leche light' }];
    expect(matchFood('leche', dup)).toBeNull();
  });
});

describe('foodsFromCSV', () => {
  it('maps macros + micros and computes empty kcal from macros', () => {
    const { rows } = parseCSV('name,protein_g,carbs_g,fat_g,sodio_mg,kcal\nPollo,27,0,3,60,');
    const [r] = foodsFromCSV(rows);
    expect(r.valid).toBe(true);
    expect(r.payload.micros).toEqual({ sodio_mg: 60 });
    expect(r.payload.kcal).toBe(27 * 4 + 3 * 9); // 135
    expect(r.warnings).not.toContain('kcal');
  });
  it("flags ⚠ when declared kcal doesn't match macros", () => {
    const { rows } = parseCSV('name,protein_g,carbs_g,fat_g,kcal\nX,10,10,10,500');
    expect(foodsFromCSV(rows)[0].warnings).toContain('kcal');
  });
  it('retains a declared zero micro and refuses to invent a missing macro', () => {
    const { rows } = parseCSV('name,protein_g,carbs_g,fat_g,fibra_g,sodio_mg\nAvena,17,66,7,0,\nSin datos,17,,,0,');
    const [known, unknown] = foodsFromCSV(rows);
    expect(known.valid).toBe(true);
    expect(known.payload.micros).toEqual({ fibra_g: 0 });
    expect(unknown).toMatchObject({ valid: false, payload: { carbs_g: null, fat_g: null, kcal: null } });
    expect(unknown.warnings).toContain('sin macros válidos');
  });
  it('does not discard an invalid declared density silently', () => {
    const base = { name: 'Leche', kcal: '20', protein_g: '0', carbs_g: '5', fat_g: '0' };
    const [missing, zero, negative, bad] = foodsFromCSV([
      base, { ...base, density_g_ml: '0' }, { ...base, density_g_ml: '-1' }, { ...base, density_g_ml: 'error' },
    ]);
    expect(missing).toMatchObject({ valid: true, payload: { density_g_ml: null } });
    expect(zero).toMatchObject({ valid: true, payload: { density_g_ml: null } });
    expect(negative).toMatchObject({ valid: false, warnings: ['densidad inválida'] });
    expect(bad).toMatchObject({ valid: false, warnings: ['densidad inválida'] });
  });
  it('row without a name = invalid', () => {
    const { rows } = parseCSV('name,kcal\n,100');
    expect(foodsFromCSV(rows)[0].valid).toBe(false);
  });
});

describe('entriesFromCSV', () => {
  const foods = [{ id: 'f1', name: 'Avena' }];
  const labels = [{ id: 'l1', name: 'Desayuno' }];
  it('matches food and meal, builds the insert', () => {
    const { rows } = parseCSV('day,meal,food,grams\n2026-07-07,Desayuno,Avena,60');
    const [e] = entriesFromCSV(rows, foods, labels);
    expect(e.valid).toBe(true);
    expect(e.insert).toEqual({ day: '2026-07-07', grams: 60, food_id: 'f1', meal_label_id: 'l1' });
  });
  it('unmatched food or invalid date = discardable row', () => {
    const { rows } = parseCSV('day,food,grams\n07/07/2026,Quinoa,60');
    const [e] = entriesFromCSV(rows, foods, labels);
    expect(e.valid).toBe(false);
    expect(e.insert).toBeNull();
    expect(e.warnings).toEqual(expect.arrayContaining(['sin alimento', 'fecha']));
  });
});

describe('bodyMetricsFromCSV', () => {
  it('maps day + measurements (canonical key and decimal comma), builds the row', () => {
    const { rows } = parseCSV('day,peso_kg,grasa_pct\n2026-07-07,"80,5",22');
    const [b] = bodyMetricsFromCSV(rows);
    expect(b.valid).toBe(true);
    expect(b.row).toEqual({ day: '2026-07-07', metrics: { peso_kg: 80.5, grasa_pct: 22 }, note: null });
    expect(b.display.count).toBe(2);
  });
  it('accepts scale-app aliases (weight, body_fat, waist)', () => {
    const { rows } = parseCSV('date,weight,body_fat,waist\n2026-07-07,80,22,86');
    const [b] = bodyMetricsFromCSV(rows);
    expect(b.row.metrics).toEqual({ peso_kg: 80, grasa_pct: 22, cintura_cm: 86 });
  });
  it("flags ⚠ out of range but doesn't discard the row", () => {
    const { rows } = parseCSV('day,peso_kg\n2026-07-07,900');
    const [b] = bodyMetricsFromCSV(rows);
    expect(b.valid).toBe(true);
    expect(b.warnings).toContain('fuera de rango');
  });
  it('the EN template round-trips: every English header maps in via alias', () => {
    const headers = BODY_TEMPLATE_HEADERS_EN;
    const values = headers.map((h) => (h === 'day' ? '2026-07-07' : h === 'note' ? 'x' : '1'));
    const { rows } = parseCSV(headers.join(',') + '\n' + values.join(','));
    const [b] = bodyMetricsFromCSV(rows);
    const metricCols = headers.filter((h) => h !== 'day' && h !== 'note');
    expect(Object.keys(b.row.metrics)).toHaveLength(metricCols.length); // no column is lost
  });
  it('invalid date or no measurements = discardable row', () => {
    expect(bodyMetricsFromCSV(parseCSV('day,peso_kg\n07/07/2026,80').rows)[0]).toMatchObject({ valid: false, warnings: expect.arrayContaining(['fecha']) });
    expect(bodyMetricsFromCSV(parseCSV('day,peso_kg\n2026-07-07,').rows)[0]).toMatchObject({ valid: false, warnings: expect.arrayContaining(['sin medidas']) });
  });
});

describe('parseIngredientLines', () => {
  const foods = [{ id: 'f1', name: 'Arroz' }, { id: 'f2', name: 'Aceite de oliva' }];
  it('extracts grams and name in various formats', () => {
    const out = parseIngredientLines('200 g Arroz\nAceite de oliva, 15\nArroz 120g', foods);
    expect(out[0]).toMatchObject({ grams: 200, valid: true, food: { id: 'f1' } });
    expect(out[1]).toMatchObject({ grams: 15, food: { id: 'f2' } });
    expect(out[2].grams).toBe(120);
  });
  it('pastes volume only with explicit food density and preserves grams otherwise', () => {
    const milk = { id: 'milk', name: 'Leche', density_g_ml: 1.03 };
    const [vol, mass, noDensity, negative, mg] = parseIngredientLines('100 ml leche\n0,1 L leche\n100 ml Arroz\nArroz -120 g\nArroz 120 mg', [...foods, milk]);
    expect([vol.grams, mass.grams]).toEqual([103, 103]);
    expect([vol.valid, mass.valid]).toEqual([true, true]);
    expect(noDensity).toMatchObject({ valid: false, grams: null, warnings: ['sin densidad'] });
    expect([negative.valid, mg.valid]).toEqual([false, false]);
  });
  it.each(['100 mg arroz', '100 oz arroz', '1/2 kg arroz', 'arroz 1 / 2 kg',
    '100 tazas arroz', '100 cups arroz', '100 cucharadas arroz', '100 piezas arroz'])('rejects ambiguous or unsupported quantity %s', (line) => {
    expect(parseIngredientLines(line, foods)[0]).toMatchObject({ valid: false, grams: null });
  });
  it.each(['100 arroz', 'arroz 100'])('treats an unambiguous bare number as grams: %s', (line) => {
    expect(parseIngredientLines(line, foods)[0]).toMatchObject({ valid: true, grams: 100 });
  });
  it('takes the number with unit even if the name has digits', () => {
    const foods2 = [{ id: 'x', name: 'Omega 3' }];
    const [o] = parseIngredientLines('Omega 3 aceite 120 g', foods2);
    expect(o.grams).toBe(120);
  });
});
