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

export function todayISO() {
  return new Date().toLocaleDateString('sv-SE'); // yyyy-mm-dd en hora local
}

export function addDaysISO(iso, delta) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('sv-SE');
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
