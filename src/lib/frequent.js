import { supabase } from './supabase.js';

// Frequent items: simple count over a 30-day window, top 8, grams =
// mode within the window. Window and metric chosen by backtest over the
// real entries (2026-07): 30d per label beats 20d, exponential decay,
// and the previous metric (last 1000 entries) in top-8 hit rate.
// Module-level cache: a single query per session (prefetched when Today mounts);
// the per-label lists are derived client-side from the same rows.
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

// After inserting an entry: invalidate and reload in the background.
export function refreshFrequent() {
  cache = null;
  return load();
}

// Top 8 most logged (dedup by food/recipe, default grams = mode), filtering out
// water; if a label is given, restrict to that label. Reads from the cache: opening
// the sheet triggers no network request if the prefetch already ran.
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
