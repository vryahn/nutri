// src/lib/mcp.js — PURE logic for the remote MCP server (api/mcp.js imports it).
// No supabase or I/O here: validators, warnings, fork/update decision, and the
// recipe response. Reuses domain.js — the same criteria as the UI (FoodForm/Recipes).
import {
  MICROS,
  BODY_METRICS,
  BODY_METRIC_MAX,
  kcalFromMacros,
  kcalSuspicious,
  macrosImplausible,
  componentsInconsistent,
  computeRecipePer100g,
} from './domain.js';

export const MICRO_KEYS = new Set(MICROS.map((m) => m.key));
export const BODY_METRIC_KEYS = new Set(BODY_METRICS.map((m) => m.key));

// HARD validation: micro keys outside MICROS block the save.
export function assertValidMicros(micros) {
  if (!micros) return;
  const bad = Object.keys(micros).filter((k) => !MICRO_KEYS.has(k));
  if (bad.length) {
    throw new Error(
      `Claves de micro inválidas: ${bad.join(', ')}. Válidas: ${[...MICRO_KEYS].join(', ')}`
    );
  }
}

// HARD validation: finite numbers ≥ 0 (null/undefined = absent field, allowed).
export function assertNonNegative(fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0) throw new Error(`${k} debe ser un número finito ≥ 0`);
  }
}

// HARD validation of portions: [{name: string, grams: number > 0}].
export function assertValidPortions(portions) {
  if (portions == null) return;
  if (!Array.isArray(portions)) throw new Error('portions debe ser un array [{name, grams}]');
  for (const p of portions) {
    if (typeof p?.name !== 'string' || !p.name || !(Number(p.grams) > 0)) {
      throw new Error('cada elemento de portions requiere {name: string, grams: number > 0}');
    }
  }
}

// HARD validation of body measurements: EXACT keys from BODY_METRICS and finite
// numeric values ≥ 0 (same policy as micros: free-form keys are rejected).
export function assertValidBodyMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics) || !Object.keys(metrics).length) {
    throw new Error('metrics debe ser un objeto no vacío {clave: número}');
  }
  const bad = Object.keys(metrics).filter((k) => !BODY_METRIC_KEYS.has(k));
  if (bad.length) {
    throw new Error(`Claves de medida inválidas: ${bad.join(', ')}. Válidas: ${[...BODY_METRIC_KEYS].join(', ')}`);
  }
  assertNonNegative(metrics);
}

// SOFT warning: values above the physiological ceiling (BODY_METRIC_MAX) — does not block.
export function bodyMetricWarnings(metrics) {
  return Object.entries(metrics)
    .filter(([k, v]) => BODY_METRIC_MAX[k] != null && v > BODY_METRIC_MAX[k])
    .map(([k, v]) => `${k}: ${v} supera la cota fisiológica (${BODY_METRIC_MAX[k]}) — revisa unidades.`);
}

// SOFT warnings — same criteria as FoodForm (Foods.jsx): they never block the save.
export function buildWarnings(food) {
  const warnings = [];
  if (kcalSuspicious(food)) warnings.push('Las kcal declaradas no cuadran con los macros (Atwater).');
  if (macrosImplausible(food)) warnings.push('Valores inusualmente altos para 100 g.');
  const inconsistent = componentsInconsistent(food);
  if (inconsistent) warnings.push(`Componente inconsistente: ${inconsistent}.`);
  return warnings;
}

// Default kcal when it arrives absent/empty while creating a food.
export function resolveKcal(food) {
  return food.kcal != null && food.kcal !== '' ? Number(food.kcal) : kcalFromMacros(food);
}

// update_food: decides fork vs update. 'fork' if the food is not the user's own
// (owner !== uid, including the base catalog's NULL owner — migration 015). If it is
// the user's own: 'update-portions' when the ONLY touched field is portions (source
// does not change), or 'update' in any other case (source becomes 'ia_personal').
export function decideUpdatePath(ownerOfFood, uid, changedFields) {
  if (ownerOfFood !== uid) return 'fork';
  const onlyPortions = changedFields.length > 0 && changedFields.every((f) => f === 'portions');
  return onlyPortions ? 'update-portions' : 'update';
}

// create_recipe: values per 100 g + warnings. Same formula as the SQL view
// recipe_per_100g (computeRecipePer100g replicates it) — if one changes, change the other.
export function recipeResponse(items, cookedWeightG) {
  const per100g = computeRecipePer100g(items, cookedWeightG);
  if (!per100g) throw new Error('cooked_weight_g o items inválidos (peso resultante <= 0)');
  return { ...per100g, warnings: buildWarnings(per100g) };
}
