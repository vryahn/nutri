import { supabase } from './supabase.js';

// Elementos frecuentes: conteo simple en ventana de 30 días, top 8, gramos =
// moda dentro de la ventana. Ventana y métrica elegidas por backtest sobre los
// registros reales (2026-07): 30d por etiqueta gana a 20d, a decay exponencial
// y a la métrica anterior (últimos 1000 registros) en hit rate del top-8.
// Caché a nivel módulo: una sola query por sesión (prefetch al montar Hoy);
// las listas por etiqueta se derivan en cliente de las mismas filas.
const WINDOW_DAYS = 30;
let cache = null; // Promise<rows>

function load() {
  if (!cache) {
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    cache = supabase
      .from('entry_nutrients')
      .select('food_id, recipe_id, item, brand, grams, meal_label_id')
      .gte('day', cutoff)
      .then(({ data }) => data || []);
  }
  return cache;
}

export function prefetchFrequent() {
  load();
}

// Tras insertar un registro: invalida y recarga en background.
export function refreshFrequent() {
  cache = null;
  return load();
}

// Top 8 más registrados (dedup food/receta, gramos default = moda), filtrando
// agua; si hay etiqueta, acota a esa etiqueta. Lee del caché: abrir el sheet
// no dispara red si el prefetch ya corrió.
export async function getFrequent(labelId, waterFoodId) {
  const rows = await load();
  const byKey = new Map();
  for (const e of rows) {
    if (labelId && e.meal_label_id !== labelId) continue;
    if (e.food_id && e.food_id === waterFoodId) continue;
    const key = e.food_id || e.recipe_id;
    let rec = byKey.get(key);
    if (!rec) { rec = { food_id: e.food_id, recipe_id: e.recipe_id, item: e.item, brand: e.brand, freq: 0, counts: new Map() }; byKey.set(key, rec); }
    rec.freq++;
    const g = Number(e.grams);
    rec.counts.set(g, (rec.counts.get(g) || 0) + 1);
  }
  return [...byKey.values()]
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 8)
    .map((r) => {
      let best = null, bestCount = 0;
      for (const [g, c] of r.counts) if (c > bestCount) { best = g; bestCount = c; }
      return { food_id: r.food_id, recipe_id: r.recipe_id, item: r.item, brand: r.brand, grams: best };
    });
}
