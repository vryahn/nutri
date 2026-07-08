// Claves EXACTAS del jsonb `micros` (claves libres fragmentarían las sumas).
// El orden es contrato de UI: los primeros MICROS_DEFAULT visibles en FoodForm
// y orden de la tabla del Dashboard. Las claves jamás se renombran.
export const MICROS = [
  { key: 'grasa_sat_g', label: 'Grasa sat.', unit: 'g' },
  { key: 'grasa_trans_g', label: 'Grasa trans', unit: 'g' },
  { key: 'azucar_g', label: 'Azúcar', unit: 'g' },
  { key: 'azucar_anadido_g', label: 'Azúcar añadido', unit: 'g' },
  { key: 'fibra_g', label: 'Fibra', unit: 'g' },
  { key: 'sodio_mg', label: 'Sodio', unit: 'mg' },
  { key: 'potasio_mg', label: 'Potasio', unit: 'mg' },
  { key: 'magnesio_mg', label: 'Magnesio', unit: 'mg' },
  { key: 'calcio_mg', label: 'Calcio', unit: 'mg' },
  { key: 'hierro_mg', label: 'Hierro', unit: 'mg' },
  { key: 'agua_ml', label: 'Agua', unit: 'ml' },
  { key: 'alcohol_g', label: 'Alcohol', unit: 'g' },
  // — ocultos por defecto; el usuario los promueve con prefs.data.fav_micros —
  { key: 'colesterol_mg', label: 'Colesterol', unit: 'mg' },
  { key: 'vit_a_mcg', label: 'Vit. A', unit: 'µg' },
  { key: 'vit_c_mg', label: 'Vit. C', unit: 'mg' },
  { key: 'vit_d_mcg', label: 'Vit. D', unit: 'µg' },
  { key: 'vit_e_mg', label: 'Vit. E', unit: 'mg' },
  { key: 'vit_k_mcg', label: 'Vit. K', unit: 'µg' },
  { key: 'vit_b1_mg', label: 'B1 Tiamina', unit: 'mg' },
  { key: 'vit_b2_mg', label: 'B2 Riboflavina', unit: 'mg' },
  { key: 'vit_b3_mg', label: 'B3 Niacina', unit: 'mg' },
  { key: 'vit_b5_mg', label: 'B5 Ác. pantoténico', unit: 'mg' },
  { key: 'vit_b6_mg', label: 'B6', unit: 'mg' },
  { key: 'vit_b7_mcg', label: 'B7 Biotina', unit: 'µg' },
  { key: 'vit_b9_mcg', label: 'B9 Folato', unit: 'µg' },
  { key: 'vit_b12_mcg', label: 'B12', unit: 'µg' },
  { key: 'colina_mg', label: 'Colina', unit: 'mg' },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg' },
  { key: 'fosforo_mg', label: 'Fósforo', unit: 'mg' },
  { key: 'selenio_mcg', label: 'Selenio', unit: 'µg' },
  { key: 'cobre_mg', label: 'Cobre', unit: 'mg' },
  { key: 'manganeso_mg', label: 'Manganeso', unit: 'mg' },
  { key: 'yodo_mcg', label: 'Yodo', unit: 'µg' },
  { key: 'cromo_mcg', label: 'Cromo', unit: 'µg' },
  { key: 'molibdeno_mcg', label: 'Molibdeno', unit: 'µg' },
  { key: 'beta_caroteno_mcg', label: 'β-caroteno', unit: 'µg' },
  { key: 'licopeno_mcg', label: 'Licopeno', unit: 'µg' },
  { key: 'luteina_zeaxantina_mcg', label: 'Luteína + Zeaxantina', unit: 'µg' },
];

export const MICROS_DEFAULT = 8; // grasa sat/trans, azúcares, fibra, sodio, potasio, magnesio

// Kcal teóricas por Atwater (prot 4 + carbs 4 + grasa 9 + alcohol 7).
// Placeholder y valor por defecto del campo kcal en el formulario de alimento.
export function kcalFromMacros(f) {
  return Math.round(
    4 * Number(f.protein_g || 0) +
      4 * Number(f.carbs_g || 0) +
      9 * Number(f.fat_g || 0) +
      7 * Number(f.micros?.alcohol_g || 0)
  );
}

// Kcal declaradas incompatibles con los macros → el alimento requiere revisión
// (auditable después por el usuario o una IA vía API; se calcula al vuelo, no se persiste).
// Tolerancia: 25 % o 20 kcal — cubre redondeos de etiqueta, fibra y polioles.
export function kcalSuspicious(f) {
  const expected = kcalFromMacros(f);
  return Math.abs(Number(f.kcal || 0) - expected) > Math.max(20, expected * 0.25);
}

// Mueve la etiqueta en `index` una posición (dir -1|1) y devuelve las filas
// {id, sort_order} a persistir, reindexando 0..n-1. Reindexar (y no hacer swap)
// corrige las labels creadas por la RPC log_entry, que quedan todas con sort_order 0.
export function reorderLabels(labels, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= labels.length) return [];
  const next = [...labels];
  [next[index], next[j]] = [next[j], next[index]];
  return next.flatMap((l, i) => (l.sort_order === i ? [] : [{ id: l.id, sort_order: i }]));
}

export function todayISO() {
  return new Date().toLocaleDateString('sv-SE'); // yyyy-mm-dd en hora local
}

export function addDaysISO(iso, delta) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('sv-SE');
}

export const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00`).getDay(); // 0=domingo, coincide con dow
}

// Resolución de objetivo para una fecha (§4.4): override por day si existe;
// si no, la fila dow=weekday(F) con mayor valid_from <= F.
export function resolveTarget(targets, dateISO) {
  const exact = targets.find((t) => t.day === dateISO);
  if (exact) return exact;
  const dow = weekdayOf(dateISO);
  const candidates = targets.filter((t) => t.dow === dow && t.valid_from <= dateISO);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, t) => (t.valid_from > best.valid_from ? t : best));
}

// Semántica de adherencia (§4.5): kcal = diana, proteína = piso.
export function classifyKcal(consumed, target) {
  if (!target) return null;
  const diff = Math.abs(consumed - target) / target;
  if (diff <= 0.05) return 'ok';
  if (diff <= 0.15) return 'warn';
  return 'danger';
}

export function classifyFloor(consumed, target) {
  if (!target) return null;
  return consumed >= target ? 'ok' : 'danger';
}

export const SODIUM_FLOOR_MG = 1500;

export function sodiumIsLow(sodiumMg, hasEntries) {
  return hasEntries && sodiumMg < SODIUM_FLOOR_MG;
}

export function round(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// Replica en cliente la vista SQL nutri.recipe_per_100g (§4.3).
export function computeRecipePer100g(ingredients, cookedWeightG) {
  const totalGrams = ingredients.reduce((sum, i) => sum + Number(i.grams || 0), 0);
  const weight = Number(cookedWeightG) > 0 ? Number(cookedWeightG) : totalGrams;
  if (weight <= 0) return null;

  const sums = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const micros = {};
  for (const { food, grams } of ingredients) {
    const factor = Number(grams || 0) / 100;
    sums.kcal += Number(food.kcal) * factor;
    sums.protein_g += Number(food.protein_g) * factor;
    sums.carbs_g += Number(food.carbs_g) * factor;
    sums.fat_g += Number(food.fat_g) * factor;
    for (const [k, v] of Object.entries(food.micros || {})) {
      micros[k] = (micros[k] || 0) + Number(v) * factor;
    }
  }

  const scale = 100 / weight;
  return {
    kcal: round(sums.kcal * scale, 1),
    protein_g: round(sums.protein_g * scale, 2),
    carbs_g: round(sums.carbs_g * scale, 2),
    fat_g: round(sums.fat_g * scale, 2),
    micros: Object.fromEntries(Object.entries(micros).map(([k, v]) => [k, round(v * scale, 3)])),
  };
}
