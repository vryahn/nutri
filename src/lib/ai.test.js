import { describe, it, expect, beforeAll } from 'vitest';

// i18n.js (importado por ai.js) lee localStorage al cargar el módulo (detección
// de idioma) — en el entorno 'node' de vitest no existe; se stubea mínimamente
// y se importa dinámico después, en vez de sumar jsdom como dependencia nueva.
let toJsonSchema, parseAmount;
beforeAll(async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  ({ toJsonSchema, parseAmount } = await import('./ai.js'));
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
