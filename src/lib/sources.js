// Clients for external nutrition data sources, per 100 g, mapped to the EXACT
// MICROS keys (src/lib/domain.js). fetch only, no new dependencies.
import { MICROS, nutritionNumber, round } from './domain.js';
import { supabase } from './supabase.js';

// La key SOLO existe en dev (dev server y vitest). En el build de producción
// `import.meta.env.DEV` es el literal false, así que el minificador borra la rama
// directa y la key no llega al bundle: ahí todo va por el proxy /api/ai, que la
// tiene del lado servidor (mismo patrón que src/lib/ai.js).
const FDC_KEY = import.meta.env.DEV ? import.meta.env.VITE_FDC_KEY : undefined;

// En producción siempre hay proxy; en dev, solo con key en .env (sin ella los
// chips de coincidencias USDA simplemente no aparecen, como siempre).
export const FDC_AVAILABLE = !import.meta.env.DEV || !!FDC_KEY;

// Un solo lugar decide directo (dev) vs proxy (producción).
async function fdcFetch(model, payload) {
  if (FDC_KEY) {
    const url = model === 'search'
      ? `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(payload.query)}&dataType=Foundation,SR%20Legacy&pageSize=6&api_key=${FDC_KEY}`
      : `https://api.nal.usda.gov/fdc/v1/food/${payload.fdcId}?api_key=${FDC_KEY}`;
    return fetch(url);
  }
  const { data } = await supabase.auth.getSession();
  return fetch('/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token || ''}`,
    },
    body: JSON.stringify({ kind: 'usda', model, payload }),
  });
}

// --- Open Food Facts ---

// Sweetener E-numbers (INS/Codex) → Spanish name. OFF exposes them in additives_tags
// even though the label rarely declares the mg: used to WARN about their presence.
const SWEETENER_ADDITIVES = {
  e420: 'sorbitol', e421: 'manitol', e953: 'isomalt', e965: 'maltitol', e966: 'lactitol',
  e967: 'xilitol', e968: 'eritritol', e964: 'poliglicitol',
  e950: 'acesulfamo K', e951: 'aspartamo', e952: 'ciclamato', e954: 'sacarina',
  e955: 'sucralosa', e956: 'alitamo', e957: 'taumatina', e959: 'neohesperidina DC',
  e960: 'glucósidos de esteviol', e961: 'neotamo', e962: 'sal de aspartamo-acesulfamo',
  e969: 'advantamo',
};

// List of sweeteners detected in an OFF product, via its additives_tags
// (e.g. 'en:e955' or 'en:e960c'). Returns [{ code, name }] without duplicates.
export function sweetenerAdditives(product) {
  const out = [];
  const seen = new Set();
  for (const tag of product.additives_tags || []) {
    const m = /e(\d{3})/i.exec(tag);
    if (!m) continue;
    const code = 'e' + m[1];
    const name = SWEETENER_ADDITIVES[code];
    if (name && !seen.has(code)) {
      seen.add(code);
      out.push({ code: code.toUpperCase(), name });
    }
  }
  return out;
}

export async function fetchOFF(ean) {
  let res;
  try {
    res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,brands,nutriments,quantity,nutrition_data_per,additives_tags`
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status === 0 || !data.product) return null;
  return mapOFF(data.product);
}

export function mapOFF(p) {
  const n = p.nutriments || {};
  const out = {
    name: p.product_name || '',
    brand: (p.brands || '').split(',')[0].trim(),
    kcal: '', protein_g: '', carbs_g: '', fat_g: '', micros: {},
    // nutrition_data_per: basis declared by the product ('100g' or '100ml'); OFF does
    // not convert, it only labels — verified live with real French juices (actual 100ml).
    per: p.nutrition_data_per === '100ml' ? '100ml' : '100g',
    // Sweeteners detected by additive (presence, not amount): the UI warns.
    sweeteners: sweetenerAdditives(p),
  };

  function assign(target, key, value, digits, multiplier = 1) {
    const valid = nutritionNumber(value);
    if (valid == null) return;
    const rounded = nutritionNumber(round(valid * multiplier, digits));
    if (rounded != null) target[key] = rounded;
  }

  const kcal = nutritionNumber(n['energy-kcal_100g']);
  const kj = nutritionNumber(n.energy_100g);
  assign(out, 'kcal', kcal ?? (kj == null ? null : kj / 4.184), 1);
  for (const [key, source] of [['protein_g', 'proteins'], ['carbs_g', 'carbohydrates'], ['fat_g', 'fat']]) {
    assign(out, key, n[source + '_100g'], 2);
  }

  const m = out.micros;
  // OFF supplies the mapped nutrients in grams, including minerals and caffeine.
  for (const [key, source] of [
    ['grasa_sat_g', 'saturated-fat'], ['grasa_trans_g', 'trans-fat'], ['azucar_g', 'sugars'],
    ['fibra_g', 'fiber'], ['polioles_g', 'polyols'], ['almidon_g', 'starch'],
    ['fructosa_g', 'fructose'], ['glucosa_g', 'glucose'], ['sacarosa_g', 'sucrose'],
    ['maltosa_g', 'maltose'], ['lactosa_g', 'lactose'], ['grasa_mono_g', 'monounsaturated-fat'],
    ['grasa_poli_g', 'polyunsaturated-fat'], ['omega3_g', 'omega-3-fat'], ['omega6_g', 'omega-6-fat'],
  ]) {
    assign(m, key, n[source + '_100g'], key.startsWith('omega') ? 3 : 2);
  }
  for (const [key, source] of [
    ['potasio_mg', 'potassium'], ['magnesio_mg', 'magnesium'], ['calcio_mg', 'calcium'],
    ['hierro_mg', 'iron'], ['cafeina_mg', 'caffeine'],
  ]) {
    assign(m, key, n[source + '_100g'], key === 'hierro_mg' ? 2 : 1, 1000);
  }
  const sodium = nutritionNumber(n.sodium_100g);
  const salt = nutritionNumber(n.salt_100g);
  assign(m, 'sodio_mg', sodium ?? (salt == null ? null : salt / 2.5), 1, 1000);

  return out;
}

// Metadata describes the product independently of the nutrition basis. Nutrients
// may only fill gaps from a compatible basis; a measured zero is never a gap.
// A typed barcode is only a candidate when it cannot be corroborated by
// the photo. Require both name and brand before using that OFF product.
export function photoMatchesOFF(photo, off) {
  const normalize = (value) => (typeof value === 'string' ? value : '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const name = normalize(photo.name);
  const brand = normalize(photo.brand);
  return !!(name && brand && name === normalize(off.name) && brand === normalize(off.brand));
}

export function fillFoodSource(winner, filler, requiredOnly = false) {
  if (!filler) return winner;
  const out = { ...winner, name: winner.name || filler.name || '', brand: winner.brand || filler.brand || '' };
  const basis = winner.basis || winner.per;
  if (!basis || basis !== (filler.basis || filler.per)) return out;
  for (const key of ['kcal', 'protein_g', 'carbs_g', 'fat_g']) {
    if (nutritionNumber(out[key]) == null && nutritionNumber(filler[key]) != null) out[key] = filler[key];
  }
  out.micros = { ...winner.micros };
  const keys = requiredOnly ? ['sodio_mg', 'potasio_mg', 'magnesio_mg'] : MICROS.map((m) => m.key);
  for (const key of keys) {
    if (nutritionNumber(out.micros[key]) == null && nutritionNumber(filler.micros?.[key]) != null) out.micros[key] = filler.micros[key];
  }
  return out;
}

// --- USDA FoodData Central ---
// Foundation/SR Legacy come per 100 g. Verified against the real API (avocado,
// butter): the ids and unitName values below match the response.
const FDC_MAP = {
  1003: 'protein_g', 1005: 'carbs_g', 1004: 'fat_g', // 1008 (kcal) is handled separately, see KCAL_IDS
  1258: 'grasa_sat_g', 1257: 'grasa_trans_g', 2000: 'azucar_g', 1235: 'azucar_anadido_g', 1079: 'fibra_g',
  1093: 'sodio_mg', 1092: 'potasio_mg', 1090: 'magnesio_mg', 1087: 'calcio_mg', 1089: 'hierro_mg',
  1051: 'agua_ml', 1018: 'alcohol_g', 1253: 'colesterol_mg',
  1106: 'vit_a_mcg', 1162: 'vit_c_mg', 1114: 'vit_d_mcg', 1109: 'vit_e_mg', 1185: 'vit_k_mcg',
  1165: 'vit_b1_mg', 1166: 'vit_b2_mg', 1167: 'vit_b3_mg', 1170: 'vit_b5_mg', 1175: 'vit_b6_mg',
  1176: 'vit_b7_mcg', 1177: 'vit_b9_mcg', 1178: 'vit_b12_mcg', 1180: 'colina_mg',
  1095: 'zinc_mg', 1091: 'fosforo_mg', 1103: 'selenio_mcg', 1098: 'cobre_mg', 1101: 'manganeso_mg',
  1100: 'yodo_mcg', 1096: 'cromo_mcg', 1102: 'molibdeno_mcg', 1099: 'fluoruro_mcg',
  1107: 'beta_caroteno_mcg', 1122: 'licopeno_mcg', 1123: 'luteina_zeaxantina_mcg',
  // --- Expansion (ids verified live against the FDC API) ---
  1007: 'ceniza_g', 1009: 'almidon_g',
  1010: 'sacarosa_g', 1011: 'glucosa_g', 1012: 'fructosa_g', 1075: 'galactosa_g', 1013: 'lactosa_g', 1014: 'maltosa_g',
  1057: 'cafeina_mg', 1058: 'teobromina_mg',
  1105: 'retinol_mcg', 1108: 'alfa_caroteno_mcg', 1120: 'beta_criptoxantina_mcg',
  1125: 'tocoferol_beta_mg', 1126: 'tocoferol_gamma_mg', 1127: 'tocoferol_delta_mg',
  1283: 'fitosteroles_mg',
  1292: 'grasa_mono_g', 1293: 'grasa_poli_g',
  1404: 'ala_g', 1278: 'epa_g', 1272: 'dha_g', 1269: 'la_g', 1271: 'aa_g',
  // Amino acids (FDC ids 1210-1228)
  1210: 'triptofano_g', 1211: 'treonina_g', 1212: 'isoleucina_g', 1213: 'leucina_g', 1214: 'lisina_g',
  1215: 'metionina_g', 1216: 'cistina_g', 1217: 'fenilalanina_g', 1218: 'tirosina_g', 1219: 'valina_g',
  1220: 'arginina_g', 1221: 'histidina_g', 1222: 'alanina_g', 1223: 'acido_aspartico_g', 1224: 'acido_glutamico_g',
  1225: 'glicina_g', 1226: 'prolina_g', 1227: 'serina_g', 1228: 'hidroxiprolina_g',
  // Total omega3_g/omega6_g and soluble/insoluble fiber: no single reliable FDC id →
  // left to label/Gemini/manual capture (not mapped here to avoid guessing).
};
// Foundation foods do NOT carry id 1008 (Energy), which SR Legacy does use — only
// the Atwater factors 2047/2048. All are accepted as kcal with priority: 1008 (direct)
// > 2048 (food-specific Atwater) > 2047 (generic 4-4-9 Atwater).
const KCAL_IDS = { 1008: 3, 2048: 2, 2047: 1 };
const NUMERIC_MACRO_KEYS = ['protein_g', 'carbs_g', 'fat_g'];
const EXPECTED_UNIT = {
  protein_g: 'g', carbs_g: 'g', fat_g: 'g',
  ...Object.fromEntries(MICROS.map((m) => [m.key, m.unit])),
};

// FDC returns water in g (unitName "g"); 1 g of water ≈ 1 ml, accepted 1:1.
export function toDomainUnit(amount, apiUnit, domainUnit) {
  if (apiUnit === domainUnit) return amount;
  if (apiUnit === 'g' && domainUnit === 'mg') return amount * 1000;
  if (apiUnit === 'mg' && domainUnit === 'µg') return amount * 1000;
  if (apiUnit === 'g' && domainUnit === 'ml') return amount;
  return null; // non-convertible unit: discarded, never stored in the wrong unit
}

// Generic foods only (Foundation/SR Legacy) — never branded products
// (Branded would return US variants, a loss of accuracy for Mexico).
export async function searchFDC(query) {
  if (!FDC_AVAILABLE) return [];
  let res;
  try {
    res = await fdcFetch('search', { query });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json();
  return (data.foods || []).map((f) => ({ fdcId: f.fdcId, description: f.description, dataType: f.dataType }));
}

// --- EN→ES translation (MyMemory, free, no key, open CORS) ---
// Visual aid only, to pick the correct USDA variant; it NEVER enters the DB
// (the food is saved with the Spanish name the flow already carries).
const _trCache = new Map();
export async function translateEnEs(text) {
  if (!text) return text;
  if (_trCache.has(text)) return _trCache.get(text);
  let out = text;
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`
    );
    if (res.ok) {
      const data = await res.json();
      const t = data?.responseData?.translatedText;
      if (t && data.responseStatus === 200) out = t;
    }
  } catch {
    // ponytail: MyMemory free tier is ~1000 words/day; falls back to English, upgrade to an own key if the quota becomes a problem
  }
  _trCache.set(text, out);
  return out;
}

export async function fetchFDC(fdcId) {
  if (!FDC_AVAILABLE) return null;
  let res;
  try {
    res = await fdcFetch('food', { fdcId });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  const out = { name: data.description || '', brand: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', micros: {} };
  let kcalPriority = 0;
  for (const fn of data.foodNutrients || []) {
    const id = fn.nutrient?.id;
    const kcalRank = KCAL_IDS[id];
    if (kcalRank) {
      if (kcalRank <= kcalPriority) continue;
      const converted = toDomainUnit(fn.amount, fn.nutrient.unitName, 'kcal');
      if (converted == null) continue;
      out.kcal = round(converted, 1);
      kcalPriority = kcalRank;
      continue;
    }
    const key = FDC_MAP[id];
    if (!key) continue;
    const converted = toDomainUnit(fn.amount, fn.nutrient.unitName, EXPECTED_UNIT[key]);
    if (converted == null) continue;
    if (NUMERIC_MACRO_KEYS.includes(key)) out[key] = round(converted, 2);
    else out.micros[key] = round(converted, 3);
  }
  return out;
}
