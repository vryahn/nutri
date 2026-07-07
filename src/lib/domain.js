export const MICROS = [
  { key: 'fibra_g', label: 'Fibra', unit: 'g' },
  { key: 'sodio_mg', label: 'Sodio', unit: 'mg' },
  { key: 'potasio_mg', label: 'Potasio', unit: 'mg' },
  { key: 'magnesio_mg', label: 'Magnesio', unit: 'mg' },
  { key: 'calcio_mg', label: 'Calcio', unit: 'mg' },
  { key: 'hierro_mg', label: 'Hierro', unit: 'mg' },
  { key: 'agua_ml', label: 'Agua', unit: 'ml' },
  { key: 'alcohol_g', label: 'Alcohol', unit: 'g' },
];

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

// Mapea un producto de Open Food Facts a nuestro modelo de alimento (§F5).
// OJO: sodium_100g viene en GRAMOS (hay que ×1000 a mg); usar energy-kcal_100g, no energy_100g (que es kJ).
export function mapOffProduct(product) {
  const n = product.nutriments || {};
  const gToMg = (v) => (v != null ? Math.round(Number(v) * 1000 * 100) / 100 : undefined);
  const micros = {};
  if (n.fiber_100g != null) micros.fibra_g = Number(n.fiber_100g);
  if (n.sodium_100g != null) micros.sodio_mg = gToMg(n.sodium_100g);
  if (n.potassium_100g != null) micros.potasio_mg = gToMg(n.potassium_100g);
  if (n.magnesium_100g != null) micros.magnesio_mg = gToMg(n.magnesium_100g);
  if (n.calcium_100g != null) micros.calcio_mg = gToMg(n.calcium_100g);
  if (n.iron_100g != null) micros.hierro_mg = gToMg(n.iron_100g);

  return {
    name: product.product_name || '',
    brand: (product.brands || '').split(',')[0].trim() || null,
    kcal: n['energy-kcal_100g'] != null ? Number(n['energy-kcal_100g']) : '',
    protein_g: n.proteins_100g != null ? Number(n.proteins_100g) : '',
    carbs_g: n.carbohydrates_100g != null ? Number(n.carbohydrates_100g) : '',
    fat_g: n.fat_100g != null ? Number(n.fat_100g) : '',
    micros,
    source: 'off',
  };
}

// Mapea un resultado de USDA FoodData Central (nutrientes por 100 g, ya en las unidades correctas).
export function mapUsdaFood(food) {
  const byNumber = Object.fromEntries((food.foodNutrients || []).map((n) => [n.nutrientNumber, n.value]));
  const micros = {};
  if (byNumber['291'] != null) micros.fibra_g = byNumber['291'];
  if (byNumber['307'] != null) micros.sodio_mg = byNumber['307'];
  if (byNumber['306'] != null) micros.potasio_mg = byNumber['306'];
  if (byNumber['304'] != null) micros.magnesio_mg = byNumber['304'];
  if (byNumber['301'] != null) micros.calcio_mg = byNumber['301'];
  if (byNumber['303'] != null) micros.hierro_mg = byNumber['303'];

  return {
    name: food.description || '',
    brand: food.brandName || null,
    kcal: byNumber['208'] ?? '',
    protein_g: byNumber['203'] ?? '',
    carbs_g: byNumber['205'] ?? '',
    fat_g: byNumber['204'] ?? '',
    micros,
    source: 'usda',
  };
}

function round(n, decimals) {
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
