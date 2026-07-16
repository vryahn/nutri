// src/lib/mcp.js — lógica PURA del servidor MCP remoto (api/mcp.js la importa).
// Sin supabase ni I/O aquí: validadores, avisos, decisión fork/update y respuesta
// de recetas. Reusa domain.js — los mismos criterios que la UI (FoodForm/Recipes).
import {
  MICROS,
  kcalFromMacros,
  kcalSuspicious,
  macrosImplausible,
  componentsInconsistent,
  computeRecipePer100g,
} from './domain.js';

export const MICRO_KEYS = new Set(MICROS.map((m) => m.key));

// Validación DURA: claves de micros fuera de MICROS bloquean el guardado.
export function assertValidMicros(micros) {
  if (!micros) return;
  const bad = Object.keys(micros).filter((k) => !MICRO_KEYS.has(k));
  if (bad.length) {
    throw new Error(
      `Claves de micro inválidas: ${bad.join(', ')}. Válidas: ${[...MICRO_KEYS].join(', ')}`
    );
  }
}

// Validación DURA: números finitos ≥ 0 (null/undefined = campo ausente, se permite).
export function assertNonNegative(fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0) throw new Error(`${k} debe ser un número finito ≥ 0`);
  }
}

// Validación DURA de portions: [{name: string, grams: number > 0}].
export function assertValidPortions(portions) {
  if (portions == null) return;
  if (!Array.isArray(portions)) throw new Error('portions debe ser un array [{name, grams}]');
  for (const p of portions) {
    if (typeof p?.name !== 'string' || !p.name || !(Number(p.grams) > 0)) {
      throw new Error('cada elemento de portions requiere {name: string, grams: number > 0}');
    }
  }
}

// Avisos SUAVES — mismos criterios que FoodForm (Foods.jsx): nunca bloquean el guardado.
export function buildWarnings(food) {
  const warnings = [];
  if (kcalSuspicious(food)) warnings.push('Las kcal declaradas no cuadran con los macros (Atwater).');
  if (macrosImplausible(food)) warnings.push('Valores inusualmente altos para 100 g.');
  const inconsistent = componentsInconsistent(food);
  if (inconsistent) warnings.push(`Componente inconsistente: ${inconsistent}.`);
  return warnings;
}

// Kcal por defecto cuando viene ausente/vacía al crear un food.
export function resolveKcal(food) {
  return food.kcal != null && food.kcal !== '' ? Number(food.kcal) : kcalFromMacros(food);
}

// update_food: decide fork vs update. 'fork' si el food no es propio (owner !== uid,
// incluye owner NULL del catálogo base — migración 015). Si es propio: 'update-portions'
// cuando el ÚNICO campo tocado es portions (no cambia source), o 'update' en cualquier
// otro caso (source pasa a 'ia_personal').
export function decideUpdatePath(ownerOfFood, uid, changedFields) {
  if (ownerOfFood !== uid) return 'fork';
  const onlyPortions = changedFields.length > 0 && changedFields.every((f) => f === 'portions');
  return onlyPortions ? 'update-portions' : 'update';
}

// create_recipe: valores por 100 g + warnings. Misma fórmula que la vista SQL
// recipe_per_100g (computeRecipePer100g la replica) — si una cambia, cambia la otra.
export function recipeResponse(items, cookedWeightG) {
  const per100g = computeRecipePer100g(items, cookedWeightG);
  if (!per100g) throw new Error('cooked_weight_g o items inválidos (peso resultante <= 0)');
  return { ...per100g, warnings: buildWarnings(per100g) };
}
