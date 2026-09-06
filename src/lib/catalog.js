// The food/recipe catalog kept in the persisted cache (src/lib/cache.js), so the app
// opened cold with no connection can still search and log. The Alimentos and Recetas
// tabs write the same two keys when they load their base list; this module fills them
// from Hoy, which is where the user lands.
import { supabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';
import { isWaterSentinel } from './domain.js';

// Enough to search, render the row and compute a queued entry's nutrients offline.
// Shared with Foods.jsx so both cache the same shape.
export const FOOD_COLUMNS =
  'id,name,brand,kcal,protein_g,carbs_g,fat_g,micros,portions,density_g_ml,source,owner,reviewed_at';

// Only when nothing is cached yet: the whole catalog is a few hundred KB and refreshing
// it is the Alimentos/Recetas tabs' job. Silent — a failure here just leaves the cache
// empty, and every online path still queries the server.
export async function prefetchCatalog() {
  if (!cacheGet('foods')) {
    const { data } = await supabase.from('foods').select(FOOD_COLUMNS).order('name');
    if (data) cacheSet('foods', data.filter((f) => !isWaterSentinel(f)));
  }
  if (!cacheGet('recipes')) {
    const { data } = await supabase.from('recipes').select('*').order('name');
    if (data) cacheSet('recipes', data);
  }
}

// Offline fallback for the add-entry search: same fields the server query returns, so
// the caller cannot tell the difference. Substring match on name and brand, like ilike.
export function searchCatalog(query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { foods: [], recipes: [] };
  const has = (s) => (s || '').toLowerCase().includes(needle);
  return {
    foods: (cacheGet('foods') || []).filter((f) => has(f.name) || has(f.brand)).slice(0, 8),
    recipes: (cacheGet('recipes') || []).filter((r) => has(r.name)).slice(0, 8),
  };
}

// Per-100 g values straight from the cached catalog. Picking a food offline still
// computes its entry's nutrients instead of leaving them null. Foods only: a recipe's
// per-100 g comes from the recipe_per_100g view, which is cached per recipe on use.
export function catalogFood(id) {
  return (cacheGet('foods') || []).find((f) => f.id === id) || null;
}
