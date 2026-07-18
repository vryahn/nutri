// Bulk import from the UI (foods, entries, recipe ingredients).
// Pure functions + one catalog fetch; the UI lives in components/ImportSheet.jsx
// and in the Recipes editor. Reuses the domain validators so that imported data
// inherits the same ⚠ warnings as manual capture: accuracy wins, nothing is
// saved silently.
import { supabase } from './supabase.js';
import {
  MICROS, BODY_METRICS, BODY_METRIC_MAX,
  kcalFromMacros, kcalSuspicious, macrosImplausible, componentsInconsistent,
} from './domain.js';

export const MICRO_KEYS = MICROS.map((m) => m.key);
// Canonical headers of the foods CSV (base columns + one column per micro).
export const FOODS_TEMPLATE_HEADERS = [
  'name', 'brand', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'density_g_ml', 'source', ...MICRO_KEYS,
];

export const BODY_METRIC_KEYS = BODY_METRICS.map((m) => m.key);
// Headers of the measurements CSV (day + one column per measurement + note).
export const BODY_TEMPLATE_HEADERS = ['day', ...BODY_METRIC_KEYS, 'note'];

// --- CSV (minimal RFC 4180: quotes, escaped commas and line breaks) ------------
// ponytail: an in-house ~30-line parser instead of adding papaparse to the closed stack.
export function parseCSV(text) {
  const s = (text || '').replace(/^\uFEFF/, ''); // Excel BOM
  const rows = [];
  let field = '', row = [], inQuotes = false;
  const pushRow = () => {
    row.push(field); field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      pushRow();
    } else field += c;
  }
  if (field !== '' || row.length) pushRow();
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const objs = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows: objs };
}

// --- Name matching (shared by entries and ingredients) -------
export function normName(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

// Exact → unique prefix → unique substring. Ambiguous or no match = null: a
// wrong food is never guessed (accuracy rule); the user resolves it.
export function matchFood(name, foods) {
  const n = normName(name);
  if (!n) return null;
  const norm = foods.map((f) => [normName(f.name), f]);
  const exact = norm.find(([fn]) => fn === n);
  if (exact) return exact[1];
  const starts = norm.filter(([fn]) => fn.startsWith(n) || n.startsWith(fn));
  if (starts.length === 1) return starts[0][1];
  const inc = norm.filter(([fn]) => fn.includes(n) || n.includes(fn));
  if (inc.length === 1) return inc[0][1];
  return null;
}

function matchLabel(name, labels) {
  const n = normName(name);
  if (!n) return null;
  return labels.find((l) => normName(l.name) === n) || null;
}

// --- Foods from CSV --------------------------------------------------------
function foodWarnings(f) {
  const w = [];
  if (kcalSuspicious(f)) w.push('kcal');
  if (macrosImplausible(f)) w.push('macros');
  if (componentsInconsistent(f)) w.push('componentes');
  return w;
}

export function foodsFromCSV(rows) {
  const num = (v) => { const x = Number(v); return v === '' || v == null || Number.isNaN(x) ? 0 : x; };
  return rows.map((r) => {
    const micros = {};
    for (const k of MICRO_KEYS) {
      if (r[k] !== undefined && r[k] !== '') {
        const x = Number(r[k]);
        if (!Number.isNaN(x) && x !== 0) micros[k] = x; // a 0 weighs the same as an absent key in the SQL views
      }
    }
    const payload = {
      name: (r.name || '').trim(),
      brand: (r.brand || '').trim() || null,
      protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
      micros,
      density_g_ml: Number(r.density_g_ml) > 0 ? Number(r.density_g_ml) : null,
      source: (r.source || 'manual').trim() || 'manual',
      portions: [],
    };
    // Empty kcal → computed from the macros (same default FoodForm applies on save).
    const kcalRaw = (r.kcal ?? '').toString().trim();
    payload.kcal = kcalRaw === '' ? kcalFromMacros(payload) : num(kcalRaw);
    return { payload, warnings: foodWarnings(payload), valid: !!payload.name };
  });
}

// --- Entries from CSV ------------------------------------------------------
function normalizeDay(v) {
  const s = (v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; // ponytail: ISO only; other formats if they ever show up
}

export function entriesFromCSV(rows, foods, labels) {
  return rows.map((r) => {
    const rawName = r.food || r.name || '';
    const food = matchFood(rawName, foods);
    const label = matchLabel(r.meal || r.group || '', labels);
    const grams = Number((r.grams || r.amount || '').toString().replace(',', '.'));
    const day = normalizeDay(r.day || r.date || '');
    const warnings = [];
    if (!food) warnings.push('sin alimento');
    if (!(grams > 0)) warnings.push('gramos');
    if (!day) warnings.push('fecha');
    const valid = !!(food && grams > 0 && day);
    return {
      display: { day: day || (r.day || r.date || ''), food: rawName, grams, meal: label?.name || r.meal || r.group || '' },
      insert: valid ? { day, grams, food_id: food.id, meal_label_id: label?.id ?? null } : null,
      warnings, valid,
    };
  });
}

// --- Body measurements from CSV --------------------------------------------
// Column aliases from scale/tracker apps (English) → canonical BODY_METRICS
// key, so a Renpho/Withings/Cronometer export imports without editing.
const BODY_ALIASES = {
  weight: 'peso_kg', peso: 'peso_kg',
  body_fat: 'grasa_pct', bodyfat: 'grasa_pct', body_fat_pct: 'grasa_pct', fat: 'grasa_pct', grasa: 'grasa_pct',
  muscle: 'musculo_kg', muscle_mass: 'musculo_kg', musculo: 'musculo_kg',
  water: 'agua_pct', body_water: 'agua_pct',
  body_water_l: 'agua_l', water_l: 'agua_l', tbw_l: 'agua_l',
  bone: 'hueso_kg', bone_mass: 'hueso_kg',
  visceral: 'grasa_visceral', visceral_fat: 'grasa_visceral',
  bmr: 'metabolismo_basal_kcal',
  waist: 'cintura_cm', hip: 'cadera_cm', hips: 'cadera_cm', chest: 'pecho_cm', neck: 'cuello_cm',
  // Per-side laterals: English left_/right_ aliases (a single word would be ambiguous).
  right_biceps: 'biceps_der_cm', left_biceps: 'biceps_izq_cm',
  right_arm: 'biceps_der_cm', left_arm: 'biceps_izq_cm',
  left_leg: 'pierna_izq_cm', right_leg: 'pierna_der_cm',
  left_thigh: 'pierna_izq_cm', right_thigh: 'pierna_der_cm',
  left_calf: 'pantorrilla_izq_cm', right_calf: 'pantorrilla_der_cm',
  // Bioimpedance segmental data (typical BIA export columns): magra = FFM (fat-free mass).
  ffm_trunk: 'magra_tronco_kg', ffm_arm_l: 'magra_brazo_izq_kg', ffm_arm_r: 'magra_brazo_der_kg',
  ffm_leg_l: 'magra_pierna_izq_kg', ffm_leg_r: 'magra_pierna_der_kg',
  fat_trunk: 'grasa_tronco_kg', fat_arm_l: 'grasa_brazo_izq_kg', fat_arm_r: 'grasa_brazo_der_kg',
  fat_leg_l: 'grasa_pierna_izq_kg', fat_leg_r: 'grasa_pierna_der_kg',
};

// Preferred English header per canonical key, for the template and the example
// in EN mode. Every key has an English form, so the EN template re-enters
// through the aliases above. Falls back to the key if any were missing.
export const BODY_HEADERS_EN = {
  day: 'day', note: 'note',
  peso_kg: 'weight', grasa_pct: 'body_fat', musculo_kg: 'muscle', agua_pct: 'body_water',
  agua_l: 'body_water_l',
  hueso_kg: 'bone_mass', grasa_visceral: 'visceral_fat', metabolismo_basal_kcal: 'bmr',
  cintura_cm: 'waist', cadera_cm: 'hip', pecho_cm: 'chest', cuello_cm: 'neck',
  biceps_der_cm: 'right_biceps', biceps_izq_cm: 'left_biceps',
  pierna_izq_cm: 'left_leg', pierna_der_cm: 'right_leg',
  pantorrilla_izq_cm: 'left_calf', pantorrilla_der_cm: 'right_calf',
  magra_tronco_kg: 'ffm_trunk', magra_brazo_izq_kg: 'ffm_arm_l', magra_brazo_der_kg: 'ffm_arm_r',
  magra_pierna_izq_kg: 'ffm_leg_l', magra_pierna_der_kg: 'ffm_leg_r',
  grasa_tronco_kg: 'fat_trunk', grasa_brazo_izq_kg: 'fat_arm_l', grasa_brazo_der_kg: 'fat_arm_r',
  grasa_pierna_izq_kg: 'fat_leg_l', grasa_pierna_der_kg: 'fat_leg_r',
};
export const BODY_TEMPLATE_HEADERS_EN = BODY_TEMPLATE_HEADERS.map((h) => BODY_HEADERS_EN[h] || h);

// One row = one day. Maps columns (canonical key or alias) to `metrics`, inherits
// the "fuera de rango" (out of range) ⚠ from BODY_METRIC_MAX (same accuracy policy
// as manual capture). `valid` = ISO day + at least one numeric measurement ≥ 0.
export function bodyMetricsFromCSV(rows) {
  return rows.map((r) => {
    const day = normalizeDay(r.day || r.date || r.fecha || '');
    const metrics = {};
    const warnings = [];
    for (const [col, val] of Object.entries(r)) {
      const lc = col.toLowerCase();
      const key = BODY_METRIC_KEYS.includes(lc) ? lc : BODY_ALIASES[lc];
      if (!key || val === '' || val == null) continue;
      const x = Number(String(val).replace(',', '.'));
      if (!Number.isFinite(x) || x < 0) continue;
      metrics[key] = x;
      if (BODY_METRIC_MAX[key] != null && x > BODY_METRIC_MAX[key] && !warnings.includes('fuera de rango')) {
        warnings.push('fuera de rango');
      }
    }
    const note = (r.note || r.nota || '').trim() || null;
    const hasData = Object.keys(metrics).length > 0;
    if (!day) warnings.push('fecha');
    else if (!hasData) warnings.push('sin medidas');
    const valid = !!(day && hasData);
    return {
      display: { day: day || (r.day || r.date || r.fecha || ''), count: Object.keys(metrics).length },
      row: valid ? { day, metrics, note } : null,
      warnings, valid,
    };
  });
}

// --- Recipe ingredients from pasted text -----------------------------------
// One line = "120 g arroz", "arroz, 120", "arroz 120g". Takes the number with a
// unit if present, otherwise the last number on the line (amounts usually come
// at the end); the rest is the name.
export function parseIngredientLines(text, foods) {
  return (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const nums = [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*(g|gr|grs|gramos|ml)?\b/gi)];
    const pick = nums.find((m) => m[2]) || nums[nums.length - 1];
    const grams = pick ? Number(pick[1].replace(',', '.')) : null;
    const name = (pick ? line.replace(pick[0], '') : line).replace(/[,;:\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    const food = matchFood(name, foods);
    const warnings = [];
    if (!food) warnings.push('sin alimento');
    if (!(grams > 0)) warnings.push('gramos');
    return { name, grams, food, valid: !!(food && grams > 0), warnings };
  });
}

// Catalog with the fields required by name matching and the live total in
// Recipes (entries only need the id, but fetching everything costs the same with ~150 rows).
export async function fetchFoodsForImport() {
  const { data } = await supabase
    .from('foods')
    .select('id, name, brand, kcal, protein_g, carbs_g, fat_g, micros, density_g_ml, portions')
    .order('name');
  return data || [];
}
