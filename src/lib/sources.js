// Clients for external nutrition data sources, per 100 g, mapped to the EXACT
// MICROS keys (src/lib/domain.js). fetch only, no new dependencies.
import { MICROS, round } from './domain.js';

const FDC_KEY = import.meta.env.VITE_FDC_KEY;

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

  if (n['energy-kcal_100g'] != null) out.kcal = round(n['energy-kcal_100g'], 1);
  else if (n.energy_100g != null) out.kcal = round(n.energy_100g / 4.184, 1);
  if (n.proteins_100g != null) out.protein_g = round(n.proteins_100g, 2);
  if (n.carbohydrates_100g != null) out.carbs_g = round(n.carbohydrates_100g, 2);
  if (n.fat_100g != null) out.fat_g = round(n.fat_100g, 2);

  const m = out.micros;
  if (n['saturated-fat_100g'] != null) m.grasa_sat_g = round(n['saturated-fat_100g'], 2);
  if (n['trans-fat_100g'] != null) m.grasa_trans_g = round(n['trans-fat_100g'], 2);
  if (n.sugars_100g != null) m.azucar_g = round(n.sugars_100g, 2);
  if (n.fiber_100g != null) m.fibra_g = round(n.fiber_100g, 2);
  // OFF normalizes sodium/potassium/magnesium/calcium/iron to grams (field *_unit = "g").
  if (n.sodium_100g != null) m.sodio_mg = round(n.sodium_100g * 1000, 1);
  else if (n.salt_100g != null) m.sodio_mg = round((n.salt_100g / 2.5) * 1000, 1);
  if (n.potassium_100g != null) m.potasio_mg = round(n.potassium_100g * 1000, 1);
  if (n.magnesium_100g != null) m.magnesio_mg = round(n.magnesium_100g * 1000, 1);
  if (n.calcium_100g != null) m.calcio_mg = round(n.calcium_100g * 1000, 1);
  if (n.iron_100g != null) m.hierro_mg = round(n.iron_100g * 1000, 2);
  // OFF reports caffeine in grams (verified live: caffeine_unit "g"), like the minerals.
  if (n.caffeine_100g != null) m.cafeina_mg = round(n.caffeine_100g * 1000, 1);
  // Extended OFF fields, already in the domain unit (grams). Sparsely populated:
  // an absent key is simply not assigned (a wrong value is never stored).
  if (n.polyols_100g != null) m.polioles_g = round(n.polyols_100g, 2);
  if (n.starch_100g != null) m.almidon_g = round(n.starch_100g, 2);
  if (n.fructose_100g != null) m.fructosa_g = round(n.fructose_100g, 2);
  if (n.glucose_100g != null) m.glucosa_g = round(n.glucose_100g, 2);
  if (n.sucrose_100g != null) m.sacarosa_g = round(n.sucrose_100g, 2);
  if (n.maltose_100g != null) m.maltosa_g = round(n.maltose_100g, 2);
  if (n.lactose_100g != null) m.lactosa_g = round(n.lactose_100g, 2);
  if (n['monounsaturated-fat_100g'] != null) m.grasa_mono_g = round(n['monounsaturated-fat_100g'], 2);
  if (n['polyunsaturated-fat_100g'] != null) m.grasa_poli_g = round(n['polyunsaturated-fat_100g'], 2);
  if (n['omega-3-fat_100g'] != null) m.omega3_g = round(n['omega-3-fat_100g'], 3);
  if (n['omega-6-fat_100g'] != null) m.omega6_g = round(n['omega-6-fat_100g'], 3);

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
  if (!FDC_KEY) return [];
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy&pageSize=6&api_key=${FDC_KEY}`;
  let res;
  try {
    res = await fetch(url);
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
  if (!FDC_KEY) return null;
  let res;
  try {
    res = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${FDC_KEY}`);
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
