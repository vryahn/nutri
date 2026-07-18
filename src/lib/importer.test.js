import { describe, it, expect } from 'vitest';
import { parseCSV, matchFood, foodsFromCSV, entriesFromCSV, parseIngredientLines, bodyMetricsFromCSV, BODY_TEMPLATE_HEADERS_EN } from './importer.js';

describe('parseCSV', () => {
  it('parsea comillas, comas internas, comillas escapadas y CRLF', () => {
    const { headers, rows } = parseCSV('name,note\r\n"Arroz, blanco","dice ""hola"""\r\nAvena,\r\n');
    expect(headers).toEqual(['name', 'note']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Arroz, blanco', note: 'dice "hola"' });
    expect(rows[1]).toEqual({ name: 'Avena', note: '' });
  });
  it('ignora líneas en blanco y última línea sin salto', () => {
    expect(parseCSV('a,b\n1,2\n\n3,4').rows).toHaveLength(2);
  });
});

describe('matchFood', () => {
  const foods = [{ id: 1, name: 'Avena' }, { id: 2, name: 'Plátano' }, { id: 3, name: 'Arroz integral' }];
  it('exacto ignorando acentos y mayúsculas', () => {
    expect(matchFood('platano', foods).id).toBe(2);
    expect(matchFood('  AVENA ', foods).id).toBe(1);
  });
  it('subcadena única empareja', () => {
    expect(matchFood('arroz', foods).id).toBe(3);
  });
  it('sin match o vacío devuelve null', () => {
    expect(matchFood('quinoa', foods)).toBeNull();
    expect(matchFood('', foods)).toBeNull();
  });
  it('ambiguo devuelve null (no adivina)', () => {
    const dup = [{ id: 1, name: 'Leche entera' }, { id: 2, name: 'Leche light' }];
    expect(matchFood('leche', dup)).toBeNull();
  });
});

describe('foodsFromCSV', () => {
  it('mapea macros + micros y calcula kcal vacío desde macros', () => {
    const { rows } = parseCSV('name,protein_g,carbs_g,fat_g,sodio_mg,kcal\nPollo,27,0,3,60,');
    const [r] = foodsFromCSV(rows);
    expect(r.valid).toBe(true);
    expect(r.payload.micros).toEqual({ sodio_mg: 60 });
    expect(r.payload.kcal).toBe(27 * 4 + 3 * 9); // 135
    expect(r.warnings).not.toContain('kcal');
  });
  it('marca ⚠ cuando kcal declarado no cuadra con macros', () => {
    const { rows } = parseCSV('name,protein_g,carbs_g,fat_g,kcal\nX,10,10,10,500');
    expect(foodsFromCSV(rows)[0].warnings).toContain('kcal');
  });
  it('fila sin nombre = inválida', () => {
    const { rows } = parseCSV('name,kcal\n,100');
    expect(foodsFromCSV(rows)[0].valid).toBe(false);
  });
});

describe('entriesFromCSV', () => {
  const foods = [{ id: 'f1', name: 'Avena' }];
  const labels = [{ id: 'l1', name: 'Desayuno' }];
  it('empareja alimento y comida, arma el insert', () => {
    const { rows } = parseCSV('day,meal,food,grams\n2026-07-07,Desayuno,Avena,60');
    const [e] = entriesFromCSV(rows, foods, labels);
    expect(e.valid).toBe(true);
    expect(e.insert).toEqual({ day: '2026-07-07', grams: 60, food_id: 'f1', meal_label_id: 'l1' });
  });
  it('alimento sin match o fecha inválida = fila descartable', () => {
    const { rows } = parseCSV('day,food,grams\n07/07/2026,Quinoa,60');
    const [e] = entriesFromCSV(rows, foods, labels);
    expect(e.valid).toBe(false);
    expect(e.insert).toBeNull();
    expect(e.warnings).toEqual(expect.arrayContaining(['sin alimento', 'fecha']));
  });
});

describe('bodyMetricsFromCSV', () => {
  it('mapea día + medidas (clave canónica y coma decimal), arma el row', () => {
    const { rows } = parseCSV('day,peso_kg,grasa_pct\n2026-07-07,"80,5",22');
    const [b] = bodyMetricsFromCSV(rows);
    expect(b.valid).toBe(true);
    expect(b.row).toEqual({ day: '2026-07-07', metrics: { peso_kg: 80.5, grasa_pct: 22 }, note: null });
    expect(b.display.count).toBe(2);
  });
  it('acepta alias de apps de báscula (weight, body_fat, waist)', () => {
    const { rows } = parseCSV('date,weight,body_fat,waist\n2026-07-07,80,22,86');
    const [b] = bodyMetricsFromCSV(rows);
    expect(b.row.metrics).toEqual({ peso_kg: 80, grasa_pct: 22, cintura_cm: 86 });
  });
  it('marca ⚠ fuera de rango pero no descarta la fila', () => {
    const { rows } = parseCSV('day,peso_kg\n2026-07-07,900');
    const [b] = bodyMetricsFromCSV(rows);
    expect(b.valid).toBe(true);
    expect(b.warnings).toContain('fuera de rango');
  });
  it('la plantilla EN hace round-trip: cada encabezado inglés entra por alias', () => {
    const headers = BODY_TEMPLATE_HEADERS_EN;
    const values = headers.map((h) => (h === 'day' ? '2026-07-07' : h === 'note' ? 'x' : '1'));
    const { rows } = parseCSV(headers.join(',') + '\n' + values.join(','));
    const [b] = bodyMetricsFromCSV(rows);
    const metricCols = headers.filter((h) => h !== 'day' && h !== 'note');
    expect(Object.keys(b.row.metrics)).toHaveLength(metricCols.length); // no column is lost
  });
  it('fecha inválida o sin medidas = fila descartable', () => {
    expect(bodyMetricsFromCSV(parseCSV('day,peso_kg\n07/07/2026,80').rows)[0]).toMatchObject({ valid: false, warnings: expect.arrayContaining(['fecha']) });
    expect(bodyMetricsFromCSV(parseCSV('day,peso_kg\n2026-07-07,').rows)[0]).toMatchObject({ valid: false, warnings: expect.arrayContaining(['sin medidas']) });
  });
});

describe('parseIngredientLines', () => {
  const foods = [{ id: 'f1', name: 'Arroz' }, { id: 'f2', name: 'Aceite de oliva' }];
  it('extrae gramos y nombre en varios formatos', () => {
    const out = parseIngredientLines('200 g Arroz\nAceite de oliva, 15\nArroz 120g', foods);
    expect(out[0]).toMatchObject({ grams: 200, valid: true, food: { id: 'f1' } });
    expect(out[1]).toMatchObject({ grams: 15, food: { id: 'f2' } });
    expect(out[2].grams).toBe(120);
  });
  it('toma el número con unidad aunque el nombre tenga dígitos', () => {
    const foods2 = [{ id: 'x', name: 'Omega 3' }];
    const [o] = parseIngredientLines('Omega 3 aceite 120 g', foods2);
    expect(o.grams).toBe(120);
  });
});
