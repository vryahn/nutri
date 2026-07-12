import { test, expect } from 'vitest';
import { derivedBodyMetrics } from './domain.js';

test('FFM/IMC/FFMI: caso canónico', () => {
  // peso 80, grasa 20%, altura 180cm → FFM=64, IMC=24.7, FFMI=19.8
  const d = derivedBodyMetrics({ peso_kg: 80, grasa_pct: 20, altura_cm: 180 });
  expect(d.ffm_kg).toBe(64);
  expect(d.imc).toBe(24.7);   // 80/1.8² = 24.69
  expect(d.ffmi).toBe(19.8);  // 64/1.8² = 19.75
});

test('insumos faltantes → null por clave', () => {
  expect(derivedBodyMetrics({ peso_kg: 80, grasa_pct: 20 })).toEqual({ ffm_kg: 64, imc: null, ffmi: null });
  expect(derivedBodyMetrics({ peso_kg: 80, altura_cm: 180 }).ffm_kg).toBe(null); // sin grasa
  expect(derivedBodyMetrics({}).imc).toBe(null);
});

test('strings (los inputs guardan strings)', () => {
  expect(derivedBodyMetrics({ peso_kg: '80', grasa_pct: '20', altura_cm: '180' }).ffm_kg).toBe(64);
});
