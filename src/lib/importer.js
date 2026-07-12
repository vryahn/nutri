// Carga en bloque desde la UI (alimentos, registros, ingredientes de receta).
// Funciones puras + un fetch de catálogo; la UI vive en components/ImportSheet.jsx
// y en el editor de Recetas. Reúsa los validadores de dominio para que lo
// importado herede los mismos ⚠ que la captura manual: la precisión gana, nada
// se guarda en silencio.
import { supabase } from './supabase.js';
import {
  MICROS, BODY_METRICS, BODY_METRIC_MAX,
  kcalFromMacros, kcalSuspicious, macrosImplausible, componentsInconsistent,
} from './domain.js';

export const MICRO_KEYS = MICROS.map((m) => m.key);
// Cabeceras canónicas del CSV de alimentos (base + una columna por micro).
export const FOODS_TEMPLATE_HEADERS = [
  'name', 'brand', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'density_g_ml', 'source', ...MICRO_KEYS,
];

export const BODY_METRIC_KEYS = BODY_METRICS.map((m) => m.key);
// Cabeceras del CSV de medidas (día + una columna por medida + nota).
export const BODY_TEMPLATE_HEADERS = ['day', ...BODY_METRIC_KEYS, 'note'];

// --- CSV (RFC 4180 mínimo: comillas, comas y saltos escapados) ------------
// ponytail: parser propio de ~30 líneas en vez de sumar papaparse al stack cerrado.
export function parseCSV(text) {
  const s = (text || '').replace(/^\uFEFF/, ''); // BOM de Excel
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

// --- Emparejado por nombre (compartido por registros e ingredientes) -------
export function normName(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

// Exacto → prefijo único → subcadena única. Ambiguo o sin match = null: nunca
// se adivina un alimento equivocado (regla de precisión); el usuario resuelve.
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

// --- Alimentos desde CSV ---------------------------------------------------
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
        if (!Number.isNaN(x) && x !== 0) micros[k] = x; // un 0 pesa igual que ausente en las vistas SQL
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
    // kcal vacío → se calcula de los macros (mismo default que FoodForm al guardar).
    const kcalRaw = (r.kcal ?? '').toString().trim();
    payload.kcal = kcalRaw === '' ? kcalFromMacros(payload) : num(kcalRaw);
    return { payload, warnings: foodWarnings(payload), valid: !!payload.name };
  });
}

// --- Registros (entries) desde CSV -----------------------------------------
function normalizeDay(v) {
  const s = (v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; // ponytail: solo ISO; otros formatos si aparecen
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

// --- Medidas corporales desde CSV ------------------------------------------
// Alias de columnas de apps de báscula/trackers (inglés) → clave canónica de
// BODY_METRICS, para que un export de Renpho/Withings/Cronometer entre sin editar.
const BODY_ALIASES = {
  weight: 'peso_kg', peso: 'peso_kg',
  body_fat: 'grasa_pct', bodyfat: 'grasa_pct', body_fat_pct: 'grasa_pct', fat: 'grasa_pct', grasa: 'grasa_pct',
  muscle: 'musculo_kg', muscle_mass: 'musculo_kg', musculo: 'musculo_kg',
  water: 'agua_pct', body_water: 'agua_pct',
  bone: 'hueso_kg', bone_mass: 'hueso_kg',
  visceral: 'grasa_visceral', visceral_fat: 'grasa_visceral',
  bmr: 'metabolismo_basal_kcal',
  waist: 'cintura_cm', hip: 'cadera_cm', hips: 'cadera_cm', chest: 'pecho_cm', neck: 'cuello_cm',
  arm: 'brazo_cm', thigh: 'muslo_cm', calf: 'pantorrilla_cm',
};

// Una fila = un día. Mapea columnas (clave canónica o alias) a `metrics`, hereda
// el ⚠ "fuera de rango" de BODY_METRIC_MAX (misma política de precisión que la
// captura manual). `valid` = día ISO + al menos una medida numérica ≥ 0.
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

// --- Ingredientes de receta desde texto pegado -----------------------------
// Una línea = "120 g arroz", "arroz, 120", "arroz 120g". Toma el número con
// unidad si existe, si no el último número de la línea (las cantidades suelen ir
// al final); el resto es el nombre.
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

// Catálogo con los campos que necesita el emparejado y el total en vivo de
// Recetas (para registros basta el id, pero traer todo cuesta lo mismo con ~150 filas).
export async function fetchFoodsForImport() {
  const { data } = await supabase
    .from('foods')
    .select('id, name, brand, kcal, protein_g, carbs_g, fat_g, micros, density_g_ml, portions')
    .order('name');
  return data || [];
}
