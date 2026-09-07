// EXACT keys of the `micros` jsonb (free-form keys would fragment the sums).
// The order is a UI contract: the first MICROS_DEFAULT are visible in FoodForm
// and set the order of the Dashboard table. The keys are never renamed.
// `cat` groups the hidden micros when they are expanded (FoodForm and Dashboard).
export const MICROS = [
  { key: 'grasa_sat_g', label: 'Grasa sat.', unit: 'g', cat: 'Lípidos' },
  { key: 'grasa_trans_g', label: 'Grasa trans', unit: 'g', cat: 'Lípidos' },
  { key: 'azucar_g', label: 'Azúcar', unit: 'g', cat: 'Carbohidratos' },
  { key: 'azucar_anadido_g', label: 'Azúcar añadido', unit: 'g', cat: 'Carbohidratos' },
  { key: 'fibra_g', label: 'Fibra', unit: 'g', cat: 'Carbohidratos' },
  { key: 'sodio_mg', label: 'Sodio', unit: 'mg', cat: 'Minerales' },
  { key: 'potasio_mg', label: 'Potasio', unit: 'mg', cat: 'Minerales' },
  { key: 'magnesio_mg', label: 'Magnesio', unit: 'mg', cat: 'Minerales' },
  { key: 'calcio_mg', label: 'Calcio', unit: 'mg', cat: 'Minerales' },
  { key: 'hierro_mg', label: 'Hierro', unit: 'mg', cat: 'Minerales' },
  { key: 'agua_ml', label: 'Agua', unit: 'ml', cat: 'Otros' },
  { key: 'alcohol_g', label: 'Alcohol', unit: 'g', cat: 'Otros' },
  // — hidden by default; the user promotes them via prefs.data.fav_micros —
  { key: 'colesterol_mg', label: 'Colesterol', unit: 'mg', cat: 'Lípidos' },
  { key: 'vit_a_mcg', label: 'Vit. A', unit: 'µg', cat: 'Vitaminas' },
  { key: 'vit_c_mg', label: 'Vit. C', unit: 'mg', cat: 'Vitaminas' },
  { key: 'vit_d_mcg', label: 'Vit. D', unit: 'µg', cat: 'Vitaminas' },
  { key: 'vit_e_mg', label: 'Vit. E', unit: 'mg', cat: 'Vitaminas' },
  { key: 'vit_k_mcg', label: 'Vit. K', unit: 'µg', cat: 'Vitaminas' },
  { key: 'vit_b1_mg', label: 'B1 Tiamina', unit: 'mg', cat: 'Vitaminas' },
  { key: 'vit_b2_mg', label: 'B2 Riboflavina', unit: 'mg', cat: 'Vitaminas' },
  { key: 'vit_b3_mg', label: 'B3 Niacina', unit: 'mg', cat: 'Vitaminas' },
  { key: 'vit_b5_mg', label: 'B5 Ác. pantoténico', unit: 'mg', cat: 'Vitaminas' },
  { key: 'vit_b6_mg', label: 'B6', unit: 'mg', cat: 'Vitaminas' },
  { key: 'vit_b7_mcg', label: 'B7 Biotina', unit: 'µg', cat: 'Vitaminas' },
  { key: 'vit_b9_mcg', label: 'B9 Folato', unit: 'µg', cat: 'Vitaminas' },
  { key: 'vit_b12_mcg', label: 'B12', unit: 'µg', cat: 'Vitaminas' },
  { key: 'colina_mg', label: 'Colina', unit: 'mg', cat: 'Vitaminas' },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg', cat: 'Minerales' },
  { key: 'fosforo_mg', label: 'Fósforo', unit: 'mg', cat: 'Minerales' },
  { key: 'selenio_mcg', label: 'Selenio', unit: 'µg', cat: 'Minerales' },
  { key: 'cobre_mg', label: 'Cobre', unit: 'mg', cat: 'Minerales' },
  { key: 'manganeso_mg', label: 'Manganeso', unit: 'mg', cat: 'Minerales' },
  { key: 'yodo_mcg', label: 'Yodo', unit: 'µg', cat: 'Minerales' },
  { key: 'cromo_mcg', label: 'Cromo', unit: 'µg', cat: 'Minerales' },
  { key: 'molibdeno_mcg', label: 'Molibdeno', unit: 'µg', cat: 'Minerales' },
  { key: 'beta_caroteno_mcg', label: 'β-caroteno', unit: 'µg', cat: 'Antioxidantes' },
  { key: 'licopeno_mcg', label: 'Licopeno', unit: 'µg', cat: 'Antioxidantes' },
  { key: 'luteina_zeaxantina_mcg', label: 'Luteína + Zeaxantina', unit: 'µg', cat: 'Antioxidantes' },

  // --- Expansion for Cronometer parity + medical tracking (all hidden by
  // default, promotable as favorites like the rest). The SQL views sum the
  // jsonb generically (jsonb_each_text): new keys do NOT require a migration. ---

  // Detailed carbohydrates
  { key: 'fibra_soluble_g', label: 'Fibra soluble', unit: 'g', cat: 'Carbohidratos' },
  { key: 'fibra_insoluble_g', label: 'Fibra insoluble', unit: 'g', cat: 'Carbohidratos' },
  { key: 'almidon_g', label: 'Almidón', unit: 'g', cat: 'Carbohidratos' },
  { key: 'sacarosa_g', label: 'Sacarosa', unit: 'g', cat: 'Carbohidratos' },
  { key: 'glucosa_g', label: 'Glucosa', unit: 'g', cat: 'Carbohidratos' },
  { key: 'fructosa_g', label: 'Fructosa', unit: 'g', cat: 'Carbohidratos' },
  { key: 'galactosa_g', label: 'Galactosa', unit: 'g', cat: 'Carbohidratos' },
  { key: 'lactosa_g', label: 'Lactosa', unit: 'g', cat: 'Carbohidratos' },
  { key: 'maltosa_g', label: 'Maltosa', unit: 'g', cat: 'Carbohidratos' },
  { key: 'alulosa_g', label: 'Alulosa', unit: 'g', cat: 'Carbohidratos' },

  // Sweeteners — polyols (declared in g on the label)
  { key: 'polioles_g', label: 'Polialcoholes (total)', unit: 'g', cat: 'Edulcorantes' },
  { key: 'eritritol_g', label: 'Eritritol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'xilitol_g', label: 'Xilitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'sorbitol_g', label: 'Sorbitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'maltitol_g', label: 'Maltitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'manitol_g', label: 'Manitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'isomalt_g', label: 'Isomalt', unit: 'g', cat: 'Edulcorantes' },
  { key: 'lactitol_g', label: 'Lactitol', unit: 'g', cat: 'Edulcorantes' },
  // Sweeteners — high-intensity (mg; only with declared/published data, never estimated)
  { key: 'aspartame_mg', label: 'Aspartamo', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'sucralosa_mg', label: 'Sucralosa', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'acesulfame_k_mg', label: 'Acesulfamo K', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'sacarina_mg', label: 'Sacarina', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'ciclamato_mg', label: 'Ciclamato', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'glucosidos_esteviol_mg', label: 'Glucósidos de esteviol', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'mogrosidos_mg', label: 'Mogrósidos (fruto del monje)', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'neotame_mg', label: 'Neotamo', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'advantame_mg', label: 'Advantamo', unit: 'mg', cat: 'Edulcorantes' },
  { key: 'taumatina_mg', label: 'Taumatina', unit: 'mg', cat: 'Edulcorantes' },

  // Detailed lipids
  { key: 'grasa_mono_g', label: 'Grasa monoinsaturada', unit: 'g', cat: 'Lípidos' },
  { key: 'grasa_poli_g', label: 'Grasa poliinsaturada', unit: 'g', cat: 'Lípidos' },
  { key: 'omega3_g', label: 'Omega-3', unit: 'g', cat: 'Lípidos' },
  { key: 'ala_g', label: 'ALA (omega-3)', unit: 'g', cat: 'Lípidos' },
  { key: 'epa_g', label: 'EPA (omega-3)', unit: 'g', cat: 'Lípidos' },
  { key: 'dha_g', label: 'DHA (omega-3)', unit: 'g', cat: 'Lípidos' },
  { key: 'omega6_g', label: 'Omega-6', unit: 'g', cat: 'Lípidos' },
  { key: 'la_g', label: 'LA (omega-6)', unit: 'g', cat: 'Lípidos' },
  { key: 'aa_g', label: 'AA (omega-6)', unit: 'g', cat: 'Lípidos' },
  { key: 'fitosteroles_mg', label: 'Fitosteroles', unit: 'mg', cat: 'Lípidos' },

  // Detailed vitamins
  { key: 'retinol_mcg', label: 'Retinol', unit: 'µg', cat: 'Vitaminas' },
  { key: 'tocoferol_beta_mg', label: 'β-tocoferol', unit: 'mg', cat: 'Vitaminas' },
  { key: 'tocoferol_gamma_mg', label: 'γ-tocoferol', unit: 'mg', cat: 'Vitaminas' },
  { key: 'tocoferol_delta_mg', label: 'δ-tocoferol', unit: 'mg', cat: 'Vitaminas' },

  // Antioxidants
  { key: 'alfa_caroteno_mcg', label: 'α-caroteno', unit: 'µg', cat: 'Antioxidantes' },
  { key: 'beta_criptoxantina_mcg', label: 'β-criptoxantina', unit: 'µg', cat: 'Antioxidantes' },

  // Minerals
  { key: 'fluoruro_mcg', label: 'Fluoruro', unit: 'µg', cat: 'Minerales' },

  // Others
  { key: 'cafeina_mg', label: 'Cafeína', unit: 'mg', cat: 'Otros' },
  { key: 'teobromina_mg', label: 'Teobromina', unit: 'mg', cat: 'Otros' },
  { key: 'ceniza_g', label: 'Ceniza', unit: 'g', cat: 'Otros' },
  { key: 'beta_hidroxibutirato_g', label: 'β-hidroxibutirato', unit: 'g', cat: 'Otros' },
  { key: 'oxalato_mg', label: 'Oxalato', unit: 'mg', cat: 'Otros' },
  { key: 'fitato_mg', label: 'Fitato', unit: 'mg', cat: 'Otros' },

  // Amino acids
  { key: 'triptofano_g', label: 'Triptófano', unit: 'g', cat: 'Aminoácidos' },
  { key: 'treonina_g', label: 'Treonina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'isoleucina_g', label: 'Isoleucina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'leucina_g', label: 'Leucina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'lisina_g', label: 'Lisina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'metionina_g', label: 'Metionina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'cistina_g', label: 'Cistina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'fenilalanina_g', label: 'Fenilalanina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'tirosina_g', label: 'Tirosina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'valina_g', label: 'Valina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'arginina_g', label: 'Arginina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'histidina_g', label: 'Histidina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'alanina_g', label: 'Alanina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'acido_aspartico_g', label: 'Ácido aspártico', unit: 'g', cat: 'Aminoácidos' },
  { key: 'acido_glutamico_g', label: 'Ácido glutámico', unit: 'g', cat: 'Aminoácidos' },
  { key: 'glicina_g', label: 'Glicina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'prolina_g', label: 'Prolina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'serina_g', label: 'Serina', unit: 'g', cat: 'Aminoácidos' },
  { key: 'hidroxiprolina_g', label: 'Hidroxiprolina', unit: 'g', cat: 'Aminoácidos' },
];

export const MICROS_DEFAULT = 8; // sat/trans fat, sugars, fiber, sodium, potassium, magnesium

// Display order of the hidden micro groups.
const CAT_ORDER = ['Lípidos', 'Carbohidratos', 'Edulcorantes', 'Vitaminas', 'Minerales', 'Antioxidantes', 'Aminoácidos', 'Otros'];

// Groups a list of micros by category, in CAT_ORDER order and with no empty groups.
// Returns [{ cat, items }]. Used by FoodForm and the Dashboard table.
export function microGroups(list) {
  return CAT_ORDER.flatMap((cat) => {
    const items = list.filter((m) => m.cat === cat);
    return items.length ? [{ cat, items }] : [];
  });
}

// Theoretical kcal: Atwater (protein 4 + carbs 4 + fat 9 + alcohol 7) with fiber
// at 2 kcal/g (NOM-051/EU): carbs_g is the TOTAL (includes fiber), so 2 kcal are
// subtracted per gram of fiber. Placeholder and default of the kcal field in FoodForm.
export function kcalFromMacros(f) {
  const m = f.micros || {};
  // Polyols provide ~2.4 kcal/g, not 4: carbs_g (total) already counts them at 4,
  // so the difference (1.6 kcal/g) is corrected. Without this, a sugar-free product
  // sweetened with polyols triggers a false kcal ⚠. Uses the declared total or,
  // if it is missing, the sum of the individual polyols.
  // ponytail: real erythritol is ~0 kcal/g; it is treated at 2.4 like the rest — the
  // kcalSuspicious tolerance (25 %) absorbs the difference except in nearly pure
  // erythritol products, which are uncommon; refine to 0 if the case arises.
  const polyols = Number(m.polioles_g || 0) ||
    (Number(m.eritritol_g || 0) + Number(m.xilitol_g || 0) + Number(m.sorbitol_g || 0) +
      Number(m.maltitol_g || 0) + Number(m.manitol_g || 0) + Number(m.isomalt_g || 0) +
      Number(m.lactitol_g || 0));
  return Math.round(
    4 * Number(f.protein_g || 0) +
      4 * Number(f.carbs_g || 0) +
      9 * Number(f.fat_g || 0) +
      7 * Number(m.alcohol_g || 0) -
      2 * Number(m.fibra_g || 0) -
      1.6 * polyols
  );
}

// Declared kcal incompatible with the macros → the food requires review
// (auditable later by the user or an AI via the API; computed on the fly, not persisted).
// Tolerance: 25 % or 20 kcal — covers label rounding, fiber and polyols.
export function kcalSuspicious(f) {
  const expected = kcalFromMacros(f);
  return Math.abs(Number(f.kcal || 0) - expected) > Math.max(20, expected * 0.25);
}

// Maximum physiological bounds per micro, per 100 g (~1.5x the densest known
// food): they catch ONLY ×1000 unit errors, not legitimately high values
// nor fortified foods. Keys absent from the table = no bound.
export const MICRO_MAX = {
  sodio_mg: 40000, potasio_mg: 16000, magnesio_mg: 1200, calcio_mg: 3500,
  hierro_mg: 190, zinc_mg: 120, fosforo_mg: 3000, selenio_mcg: 3000,
  cobre_mg: 25, manganeso_mg: 90,
  colesterol_mg: 4700,
  vit_a_mcg: 15000, vit_c_mg: 3000, vit_d_mcg: 400, vit_e_mg: 250, vit_k_mcg: 2600,
  vit_b12_mcg: 160, vit_b9_mcg: 6000,
  // Never sold in pure form as food: a generous bound only catches the ×1000
  // unit error, without flagging legitimately high values (spinach ~1000 mg
  // oxalate/100 g, bran ~5000 mg phytate/100 g). Sweeteners and caffeine CAN
  // come nearly pure (tabletop sweetener, caffeine powder): they are left without
  // a bound on purpose — a false ⚠ on medical data is worse than not flagging.
  oxalato_mg: 20000, fitato_mg: 20000,
};

// EXACT keys of the `body_metrics.metrics` jsonb (body measurements, migration 012).
// Same contract as MICROS: the order is a UI contract (the first
// BODY_METRICS_DEFAULT are visible; the rest hidden except the user's favorites in
// prefs.data.fav_body, following the fav_micros pattern); the keys are never renamed.
// Numeric values; `cat` groups the extended section. `type:'check'` = boolean
// checkpoint (Sleep): the hour threshold in use is stored as the value (making the
// flag self-explanatory if the threshold changes later), NEVER a bare 1; absent = not checked.
export const BODY_METRICS = [
  { key: 'peso_kg', label: 'Peso', unit: 'kg', cat: 'Composición' },
  { key: 'sueno_corto', label: 'Sueño', type: 'check', cat: 'Composición' },
  // — hidden (the user promotes them to favorites, fav_micros pattern) —
  { key: 'grasa_pct', label: 'Grasa corporal', unit: '%', cat: 'Composición' },
  { key: 'musculo_kg', label: 'Masa muscular', unit: 'kg', cat: 'Composición' },
  { key: 'agua_pct', label: 'Agua corporal', unit: '%', cat: 'Composición' },
  { key: 'agua_l', label: 'Agua corporal (L)', unit: 'L', cat: 'Composición' },
  { key: 'hueso_kg', label: 'Masa ósea', unit: 'kg', cat: 'Composición' },
  { key: 'grasa_visceral', label: 'Grasa visceral', unit: 'nivel', cat: 'Composición' },
  { key: 'metabolismo_basal_kcal', label: 'Metabolismo basal', unit: 'kcal', cat: 'Composición' },
  { key: 'cintura_cm', label: 'Cintura', unit: 'cm', cat: 'Circunferencias' },
  { key: 'cadera_cm', label: 'Cadera', unit: 'cm', cat: 'Circunferencias' },
  { key: 'pecho_cm', label: 'Pecho', unit: 'cm', cat: 'Circunferencias' },
  { key: 'cuello_cm', label: 'Cuello', unit: 'cm', cat: 'Circunferencias' },
  { key: 'biceps_der_cm', label: 'Bíceps derecho', unit: 'cm', cat: 'Circunferencias' },
  { key: 'biceps_izq_cm', label: 'Bíceps izquierdo', unit: 'cm', cat: 'Circunferencias' },
  { key: 'pierna_izq_cm', label: 'Pierna izquierda', unit: 'cm', cat: 'Circunferencias' },
  { key: 'pierna_der_cm', label: 'Pierna derecha', unit: 'cm', cat: 'Circunferencias' },
  { key: 'pantorrilla_izq_cm', label: 'Pantorrilla izquierda', unit: 'cm', cat: 'Circunferencias' },
  { key: 'pantorrilla_der_cm', label: 'Pantorrilla derecha', unit: 'cm', cat: 'Circunferencias' },
  // — segmental (bioimpedance): lean mass and fat per segment, not derivable —
  { key: 'magra_tronco_kg', label: 'Magra tronco', unit: 'kg', cat: 'Segmental' },
  { key: 'magra_brazo_izq_kg', label: 'Magra brazo izq.', unit: 'kg', cat: 'Segmental' },
  { key: 'magra_brazo_der_kg', label: 'Magra brazo der.', unit: 'kg', cat: 'Segmental' },
  { key: 'magra_pierna_izq_kg', label: 'Magra pierna izq.', unit: 'kg', cat: 'Segmental' },
  { key: 'magra_pierna_der_kg', label: 'Magra pierna der.', unit: 'kg', cat: 'Segmental' },
  { key: 'grasa_tronco_kg', label: 'Grasa tronco', unit: 'kg', cat: 'Segmental' },
  { key: 'grasa_brazo_izq_kg', label: 'Grasa brazo izq.', unit: 'kg', cat: 'Segmental' },
  { key: 'grasa_brazo_der_kg', label: 'Grasa brazo der.', unit: 'kg', cat: 'Segmental' },
  { key: 'grasa_pierna_izq_kg', label: 'Grasa pierna izq.', unit: 'kg', cat: 'Segmental' },
  { key: 'grasa_pierna_der_kg', label: 'Grasa pierna der.', unit: 'kg', cat: 'Segmental' },
];
export const BODY_METRICS_DEFAULT = 2; // weight + sleep always visible

// Cleans a {key: value} map down to only finite numbers ≥ 0 (for persisting body
// measurements): '' or garbage is discarded — an invented value is never stored.
export function cleanNumericMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === '' || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

// Maximum physiological bounds per measurement: they catch typing errors (kg↔g,
// decimal point), not legitimately high values. Absent key = no bound. On the fly, not persisted.
export const BODY_METRIC_MAX = {
  peso_kg: 500, grasa_pct: 80, musculo_kg: 120, agua_pct: 90, hueso_kg: 12,
  grasa_visceral: 60, metabolismo_basal_kcal: 6000, agua_l: 80,
  cintura_cm: 300, cadera_cm: 300, pecho_cm: 300, cuello_cm: 120,
  biceps_der_cm: 120, biceps_izq_cm: 120, pierna_izq_cm: 150, pierna_der_cm: 150,
  pantorrilla_izq_cm: 100, pantorrilla_der_cm: 100,
  magra_tronco_kg: 60, magra_brazo_izq_kg: 30, magra_brazo_der_kg: 30,
  magra_pierna_izq_kg: 30, magra_pierna_der_kg: 30,
  grasa_tronco_kg: 40, grasa_brazo_izq_kg: 20, grasa_brazo_der_kg: 20,
  grasa_pierna_izq_kg: 20, grasa_pierna_der_kg: 20,
};

// Body composition derived from weight/fat (from the measurement) + height (from the
// Profile, prefs.data.profile.height_cm — height is NOT a daily measurement): computed
// on the fly, NEVER persisted (same policy as kcal). Read-only in the Medidas tab.
// `formula` feeds the "?" Hint. derivedBodyMetrics returns null per key when its
// inputs are missing.
export const DERIVED_BODY = [
  { key: 'ffm_kg', label: 'Masa libre de grasa', unit: 'kg', formula: 'peso × (1 − grasa% / 100)' },
  { key: 'imc', label: 'IMC', unit: 'kg/m²', formula: 'peso / altura² (altura del Perfil, en m)' },
  { key: 'ffmi', label: 'FFMI', unit: 'kg/m²', formula: 'masa libre de grasa / altura² (altura del Perfil, en m)' },
];

export function derivedBodyMetrics(m, heightCm) {
  const n = (v) => (v === '' || v == null || !(Number(v) >= 0) ? null : Number(v));
  const weightKg = n(m?.peso_kg), bodyFatPct = n(m?.grasa_pct), alt = n(heightCm);
  const hm = alt > 0 ? alt / 100 : null;
  const ffm = weightKg != null && bodyFatPct != null ? weightKg * (1 - bodyFatPct / 100) : null;
  return {
    ffm_kg: ffm != null ? round(ffm, 2) : null,
    imc: weightKg != null && hm ? round(weightKg / (hm * hm), 1) : null,
    ffmi: ffm != null && hm ? round(ffm / (hm * hm), 1) : null,
  };
}

// ── Dashboard custom charts ──────────────────────────────────────────────────
// Unified catalog of variables plottable over time: nutrition
// (daily_totals: macros as columns + micros in the `micros` jsonb), body
// measurements (body_metrics.metrics jsonb) and derived ones (IMC/FFM/FFMI, on the fly).
// `source` states where the series comes from; `unit` groups into axes. Requires NO
// migration: reuses MICROS/BODY_METRICS/DERIVED_BODY. Sleep (type:'check') is not
// a numeric series → it is excluded. All keys are unique across sources.
// kind: 'flow' = accumulable intake (nutrition: summing makes sense) · 'stock' =
// level/state (measurements and derived: summing weight/waist means nothing). Governs
// which reducers the builder offers (Sum only for pure-flow).
export const DASH_VAR_MACROS = [
  { key: 'kcal', label: 'Kcal', unit: 'kcal', source: 'nut', cat: 'Macros', kind: 'flow' },
  { key: 'protein_g', label: 'Proteína', unit: 'g', source: 'nut', cat: 'Macros', kind: 'flow' },
  { key: 'carbs_g', label: 'Carbohidratos', unit: 'g', source: 'nut', cat: 'Macros', kind: 'flow' },
  { key: 'fat_g', label: 'Grasa', unit: 'g', source: 'nut', cat: 'Macros', kind: 'flow' },
];
export const DASH_VARS = [
  ...DASH_VAR_MACROS,
  ...MICROS.filter((m) => m.key !== 'agua_ml').map((m) => ({ ...m, source: 'nutMicro', kind: 'flow' })),
  ...BODY_METRICS.filter((m) => m.type !== 'check').map((m) => ({ ...m, source: 'body', kind: 'stock' })),
  ...DERIVED_BODY.map((m) => ({ key: m.key, label: m.label, unit: m.unit, source: 'derived', cat: 'Derivadas', kind: 'stock' })),
];
export const DASH_VARS_BY_KEY = Object.fromEntries(DASH_VARS.map((v) => [v.key, v]));

export const DASH_MAX_VARS = 4; // readability: more than 4 series turn into noise
export const DASH_MAX_UNITS = 2; // 2 axes (left/right), as in Cronometer (weight kg + waist cm)

// Distinct units of a set of variables, in order of appearance and
// trimmed to DASH_MAX_UNITS: [leftUnit, rightUnit?]. The builder blocks a
// 3rd unit; here, for robustness, the extra one falls back to the left axis.
export function axisUnits(vars) {
  const units = [];
  for (const v of vars) if (v && !units.includes(v.unit)) units.push(v.unit);
  return units.slice(0, DASH_MAX_UNITS);
}

// Value of a variable for a given day. Nutrition: null if the day was not logged
// (kcal ≤ 0) — a false 0 is not plotted; a real 0 on a logged day does count.
// Measurements: null if there was no measurement that day (sparse series → connectNulls).
export function dashVarValue(v, nut, registered, body, derived) {
  if (!v) return null;
  if (v.source === 'nut') return registered ? Number(nut?.[v.key] || 0) : null;
  if (v.source === 'nutMicro') return registered ? Number(nut?.micros?.[v.key] || 0) : null;
  if (v.source === 'body') { const x = body?.metrics?.[v.key]; return x == null ? null : Number(x); }
  if (v.source === 'derived') return derived?.[v.key] ?? null;
  return null;
}

// Target of the day for a variable (only nutrition has one). Body/derived → null.
export function dashVarTarget(v, target) {
  if (!v || !target) return null;
  if (v.source === 'nut') return target[v.key] ?? null;
  if (v.source === 'nutMicro') return target.micros?.[v.key] ?? null;
  return null;
}

// ── Temporal aggregation of the custom charts ────────────────────────────────
// The global modes (Sum/Average/…) summarize the range into ONE scalar and govern
// the standard analysis. A time series is aggregated by BUCKET (day, ISO week
// or month), reducing each bucket. 'auto' derives the bucket from the range length
// so that a year does not paint 365 points of noise.
export const DASH_AGGS = ['auto', 'dia', 'semana', 'mes'];
export const DASH_REDUCERS = ['promedio', 'suma', 'mediana'];

export function autoAgg(rangeLen) {
  if (rangeLen <= 45) return 'dia';
  if (rangeLen <= 182) return 'semana';
  return 'mes';
}
export function resolveAgg(agg, rangeLen) {
  return !agg || agg === 'auto' ? autoAgg(rangeLen) : agg;
}

// ISO Monday of the week containing `iso` (weekdayOf: 0=Sunday).
function mondayOf(iso) {
  const d = weekdayOf(iso);
  return addDaysISO(iso, d === 0 ? -6 : 1 - d);
}
function bucketKey(day, agg) {
  if (agg === 'mes') return day.slice(0, 7); // YYYY-MM
  if (agg === 'semana') return mondayOf(day); // ISO Monday (YYYY-MM-DD)
  return day;
}
function bucketLabel(key, agg) {
  return agg === 'mes' ? key : key.slice(5); // YYYY-MM or MM-DD
}

// Reduces the non-null values of a bucket. Bucket without data → null (connectNulls).
export function reduceBucket(vals, reducer) {
  const xs = vals.filter((v) => v != null).map(Number);
  if (xs.length === 0) return null;
  if (reducer === 'suma') return round(sum(xs), 2);
  if (reducer === 'mediana') return round(median(xs), 2);
  return round(sum(xs) / xs.length, 2); // average ('promedio')
}

// Groups daily rows [{day, [key]}] into buckets and reduces them. agg='dia' passes
// straight through (only re-labels). All bucket keys sort lexicographically.
// Used for the data series and for the target series (same bucketing).
export function bucketRows(dailyRows, keys, agg, reducer) {
  if (agg === 'dia') return dailyRows.map((r) => ({ ...r, label: r.day.slice(5) }));
  const buckets = new Map();
  for (const r of dailyRows) {
    const k = bucketKey(r.day, agg);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  return [...buckets.keys()].sort().map((k) => {
    const rows = buckets.get(k);
    const out = { day: k, label: bucketLabel(k, agg) };
    for (const kk of keys) out[kk] = reduceBucket(rows.map((r) => r[kk]), reducer);
    return out;
  });
}

// Time series for a custom chart, already aggregated: rows {day, label,
// [key]:value|null} per variable. agg='dia' = one row per day of the range (default,
// preserves the previous semantics); week/month group and reduce. nutByDay/bodyByDay
// are Map(day→row).
export function buildDashSeries(dates, vars, nutByDay, bodyByDay, agg = 'dia', reducer = 'promedio', heightCm = null) {
  const daily = dates.map((day) => {
    const nut = nutByDay.get(day);
    const registered = Number(nut?.kcal || 0) > 0;
    const body = bodyByDay.get(day);
    const derived = body ? derivedBodyMetrics(body.metrics, heightCm) : null;
    const row = { day };
    for (const v of vars) row[v.key] = dashVarValue(v, nut, registered, body, derived);
    return row;
  });
  return bucketRows(daily, vars.map((v) => v.key), agg, reducer);
}

// Coarse physical check per 100 g: protein+carbs+fat+alcohol+water cannot
// exceed ~105 g (100 g of portion + rounding/label margin); no individual macro
// may exceed 100 g; no micro may exceed its bound in MICRO_MAX.
// Computed on the fly (like kcalSuspicious), not persisted.
export function macrosImplausible(f) {
  const p = Number(f.protein_g || 0);
  const c = Number(f.carbs_g || 0);
  const g = Number(f.fat_g || 0);
  const alcohol = Number(f.micros?.alcohol_g || 0);
  const water = Number(f.micros?.agua_ml || 0);
  if (p + c + g + alcohol + water > 105) return true;
  if (p > 100 || c > 100 || g > 100) return true;
  const m = f.micros || {};
  for (const [key, max] of Object.entries(MICRO_MAX)) {
    if (m[key] != null && Number(m[key]) > max) return true;
  }
  return false;
}

// Composition inequalities between micros and macros (+0.5 g slack for rounding).
// An inequality is only evaluated when BOTH operands are numeric — a missing datum
// does not count as 0, to avoid flagging false positives. On the fly, never persisted.
// Returns the PHRASE of the first broken inequality (to show it to the user) or null.
// String → truthy, null → falsy: boolean-style usages keep working unchanged.
// ponytail: no amino-acids-vs-protein check — the sum of amino acids almost always
// clashes with Kjeldahl protein (N×6.25) or is declared per 100 g of protein, not of
// product; it was a guaranteed false positive on every protein powder. Reactivate only
// if the amino acid basis is normalized to that of the product.
export function componentsInconsistent(f) {
  const m = f.micros || {};
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const fat = num(f.fat_g);
  const carbs = num(f.carbs_g);
  const satTrans = m.grasa_sat_g != null || m.grasa_trans_g != null
    ? Number(m.grasa_sat_g || 0) + Number(m.grasa_trans_g || 0)
    : null;
  const sugar = num(m.azucar_g);
  const addedSugar = num(m.azucar_anadido_g);
  const fiber = num(m.fibra_g);

  // Sum of the keys present (null if none): a missing datum does not count as 0,
  // so a partial sum always stays below the total and is never a false positive.
  const sumPresent = (...ks) => {
    const vals = ks.map((k) => num(m[k])).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const polyols = num(m.polioles_g);
  const polyolParts = sumPresent('eritritol_g', 'xilitol_g', 'sorbitol_g', 'maltitol_g', 'manitol_g', 'isomalt_g', 'lactitol_g');
  const sugarParts = sumPresent('glucosa_g', 'fructosa_g', 'galactosa_g', 'lactosa_g', 'maltosa_g', 'sacarosa_g');
  const fiberParts = sumPresent('fibra_soluble_g', 'fibra_insoluble_g');
  const fatParts = sumPresent('grasa_sat_g', 'grasa_trans_g', 'grasa_mono_g', 'grasa_poli_g');
  const omega3 = num(m.omega3_g);
  const omega3Parts = sumPresent('ala_g', 'epa_g', 'dha_g');
  const omega6 = num(m.omega6_g);
  const omega6Parts = sumPresent('la_g', 'aa_g');

  const over = (a, b) => a != null && b != null && a > b + 0.5;
  if (over(satTrans, fat)) return 'grasa saturada + trans supera la grasa total';
  if (over(sugar, carbs)) return 'azúcar supera los carbohidratos';
  if (over(addedSugar, sugar)) return 'azúcar añadido supera el azúcar total';
  if (over(fiber, carbs)) return 'fibra supera los carbohidratos';
  if (over(polyols, carbs)) return 'polialcoholes superan los carbohidratos';
  if (over(polyolParts, polyols)) return 'los polialcoholes desglosados superan su total';
  if (over(sugarParts, sugar)) return 'los azúcares desglosados superan el azúcar total';
  if (over(fiberParts, fiber)) return 'fibra soluble + insoluble supera la fibra total';
  if (over(fatParts, fat)) return 'los tipos de grasa superan la grasa total';
  if (over(omega3Parts, omega3)) return 'ALA + EPA + DHA superan el omega-3 total';
  if (over(omega6Parts, omega6)) return 'LA + AA superan el omega-6 total';
  return null;
}

// Moves the label at `index` one position (dir -1|1) and returns the
// {id, sort_order} rows to persist, reindexing 0..n-1. Reindexing (instead of swapping)
// fixes labels created by the log_entry RPC, which all end up with sort_order 0.
export function reorderLabels(labels, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= labels.length) return [];
  const next = [...labels];
  [next[index], next[j]] = [next[j], next[index]];
  return next.flatMap((l, i) => (l.sort_order === i ? [] : [{ id: l.id, sort_order: i }]));
}

export function todayISO() {
  return new Date().toLocaleDateString('sv-SE'); // yyyy-mm-dd in local time
}

export function addDaysISO(iso, delta) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('sv-SE');
}

// Window for the "mode of grams" of Recents in Today: if there is a target phase
// in force and it has run for ≥7 consecutive days, the window is limited to the phase
// (reflects the current portion pattern); before that week there is not enough
// sample → 40-day window.
// phaseVfs = distinct valid_from values of dow rows; today = ISO yyyy-mm-dd.
export function recentWindowStart(phaseVfs, today) {
  const currentVf = [...phaseVfs].filter((vf) => vf <= today).sort().pop() || null;
  if (currentVf && addDaysISO(currentVf, 7) <= today) return currentVf;
  return addDaysISO(today, -40);
}

export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00`).getDay(); // 0=Sunday, matches dow
}

// Target resolution for a date (§4.4): the per-day override if it exists;
// otherwise, the dow=weekday(F) row with the highest valid_from <= F.
export function resolveTarget(targets, dateISO) {
  const exact = targets.find((t) => t.day === dateISO);
  if (exact) return exact;
  const dow = weekdayOf(dateISO);
  const candidates = targets.filter((t) => t.dow === dow && t.valid_from <= dateISO);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, t) => (t.valid_from > best.valid_from ? t : best));
}

// —— Phase row construction (targets) ————————————————————————————————
// Moved out of Targets.jsx for reuse in the goals wizard
// (TargetsWizard). Identical behavior: null-safe, sorted micros.
export const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

export function cleanMicros(m) {
  const out = {};
  for (const k of Object.keys(m || {}).sort()) {
    const v = m[k];
    if (v === '' || v == null) continue;
    out[k] = Number(v);
  }
  return out;
}

// targets.bounds: { key: { min?, max? } }. Drops empty sides and keys with no
// side; sodium's floor is medical (SODIUM_FLOOR_MG) and cannot be lowered.
export function cleanBounds(b) {
  const out = {};
  for (const k of Object.keys(b || {}).sort()) {
    const min = numOrNull(b[k]?.min);
    const max = numOrNull(b[k]?.max);
    const o = {};
    if (min != null) o.min = k === 'sodio_mg' ? Math.max(min, SODIUM_FLOOR_MG) : min;
    if (max != null) o.max = max;
    if (Object.keys(o).length) out[k] = o;
  }
  return out;
}

// —— Phase rules (targets.rules, migration 021) ——————————————————————
// rules = { paused_until?, kcal_min?, kcal_max?, items: [...] }. Each item adjusts
// carbs (± delta_carbs_g × scope of dows) when a weight-trend signal fires; kcal is
// recalculated as delta × 4. See evalRules below for the full evaluation.
const RULE_KINDS = ['ritmo_alto', 'estancamiento', 'techo_peso', 'ritmo_lento'];

// Hardcoded guardrail (§spec): when the phase goal is 'deficit' it is ALWAYS
// evaluated first, is not an editable item, and is never configurable — same
// pattern as SODIUM_FLOOR_MG.
export const DEFICIT_RATE_CAP = { pctWk: 0.5, weeks: 2, deltaCarbsG: 25 };
export const ADHERENCE_TOL = 0.07;

function ruleNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Normalizes a raw `rules` object: drops items with an unknown kind or missing/
// non-numeric required fields. Never throws on garbage input.
export function cleanRules(r) {
  const out = { items: [] };
  const kcalMin = ruleNum(r?.kcal_min);
  const kcalMax = ruleNum(r?.kcal_max);
  if (kcalMin != null) out.kcal_min = kcalMin;
  if (kcalMax != null) out.kcal_max = kcalMax;
  if (r?.paused_until) out.paused_until = r.paused_until;
  for (const raw of r?.items || []) {
    if (!RULE_KINDS.includes(raw?.kind)) continue;
    const item = { id: raw.id != null ? String(raw.id) : '', kind: raw.kind, auto: !!raw.auto };
    if (raw.kind === 'estancamiento') {
      const days = ruleNum(raw.days);
      if (days == null) continue;
      item.days = days;
    } else {
      const value = ruleNum(raw.value);
      if (value == null) continue;
      item.value = value;
      if (raw.kind !== 'techo_peso') {
        const weeks = ruleNum(raw.weeks);
        if (weeks == null) continue;
        item.weeks = weeks;
      }
    }
    if (raw.kind !== 'techo_peso') {
      const dcg = ruleNum(raw.delta_carbs_g);
      if (dcg != null) item.delta_carbs_g = dcg;
      item.scope = Array.isArray(raw.scope) ? raw.scope.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : null;
    }
    out.items.push(item);
  }
  return out;
}

// Expands the draft groups into the 7 dow rows (always 7). groups:
// [{ dows:[0-6], values:{ kcal, protein_g, carbs_g, fat_g, micros, bounds } }].
export function draftToRows(groups, { validFrom, label, description, goal, owner, rules }) {
  const byDow = {};
  for (const g of groups) {
    const row = {
      kcal: numOrNull(g.values.kcal),
      protein_g: numOrNull(g.values.protein_g),
      carbs_g: numOrNull(g.values.carbs_g),
      fat_g: numOrNull(g.values.fat_g),
      micros: cleanMicros(g.values.micros),
      bounds: cleanBounds(g.values.bounds),
    };
    for (const dow of g.dows) byDow[dow] = row;
  }
  const rulesClean = cleanRules(rules);
  const rows = [];
  for (let dow = 0; dow < 7; dow++) {
    rows.push({
      owner,
      dow,
      valid_from: validFrom,
      label: (label || '').trim() || null,
      description: (description || '').trim() || null,
      goal: goal || null,
      rules: rulesClean,
      ...(byDow[dow] || { kcal: null, protein_g: null, carbs_g: null, fat_g: null, micros: {}, bounds: {} }),
    });
  }
  return rows;
}

function fmtSigned(n, decimals) {
  const v = round(n, decimals);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
}

// 7-day moving average of peso_kg ending at `endISO` (inclusive). Requires ≥5
// weigh-ins in that window; otherwise null (insufficient data — never averages a thin sample).
function weightMA7(weightByDay, endISO) {
  let total = 0, n = 0;
  for (let i = 0; i < 7; i++) {
    const w = weightByDay.get(addDaysISO(endISO, -i));
    if (w != null) { total += w; n++; }
  }
  return n >= 5 ? total / n : null;
}

// Adherence guard: ≥5 registered days (daily_totals.kcal > 0) per 7-day block in the
// window, AND the mean consumed kcal (of the registered days) within ADHERENCE_TOL of
// the mean resolved target kcal for those same days.
function adherenceCheck(dailyTotals, targets, today, windowDays) {
  const byDay = new Map((dailyTotals || []).map((r) => [r.day, r]));
  const consumed = [];
  const targetVals = [];
  for (let i = 0; i < windowDays; i++) {
    const day = addDaysISO(today, -i);
    const kcal = Number(byDay.get(day)?.kcal || 0);
    if (kcal <= 0) continue;
    consumed.push(kcal);
    const tgt = resolveTarget(targets, day);
    if (tgt?.kcal != null) targetVals.push(Number(tgt.kcal));
  }
  const minRegistered = Math.round((windowDays / 7) * 5);
  if (consumed.length < minRegistered || !targetVals.length) return { ok: false, pct: null };
  const meanConsumed = sum(consumed) / consumed.length;
  const meanTarget = sum(targetVals) / targetVals.length;
  if (!(meanTarget > 0)) return { ok: false, pct: null };
  const pct = Math.abs(meanConsumed - meanTarget) / meanTarget;
  return { ok: pct <= ADHERENCE_TOL, pct: round(pct * 100, 1) };
}

// Builds the 7 new dow rows for a carbs-delta action (copy of the vigente phase's
// rows, with carbs/kcal adjusted for the rows in `scope`, clamped to kcal_min/max).
// Returns null if the clamp cancels the change on every affected row (§spec: no fire).
function buildScopedRows(phaseRows, scope, deltaCarbsG, rulesCfg, validFrom, appliedRule) {
  let changed = false;
  const rows = [];
  for (let dow = 0; dow < 7; dow++) {
    const src = phaseRows[dow];
    if (!src) continue;
    const inScope = !scope || scope.includes(dow);
    let carbs = src.carbs_g, kcal = src.kcal;
    if (inScope && carbs != null && kcal != null) {
      const newCarbs = round(carbs + deltaCarbsG, 2);
      let newKcal = round(kcal + deltaCarbsG * 4, 1);
      if (rulesCfg.kcal_min != null) newKcal = Math.max(newKcal, rulesCfg.kcal_min);
      if (rulesCfg.kcal_max != null) newKcal = Math.min(newKcal, rulesCfg.kcal_max);
      if (newKcal !== kcal) changed = true;
      carbs = newCarbs; kcal = newKcal;
    }
    rows.push({
      owner: src.owner, dow, valid_from: validFrom,
      label: src.label, description: src.description, goal: src.goal,
      kcal, protein_g: src.protein_g, carbs_g: carbs, fat_g: src.fat_g,
      micros: src.micros, bounds: src.bounds, rules: src.rules, applied_rule: appliedRule,
    });
  }
  return changed ? rows : null;
}

function evalRitmoOrEstancamiento(item, ctx) {
  const { weightByDay, dailyTotals, today, vigenteVf, targets, phaseRows, rulesCfg } = ctx;
  const windowDays = item.kind === 'estancamiento' ? item.days : item.weeks * 7;
  if (!(vigenteVf && vigenteVf <= addDaysISO(today, -windowDays))) return null; // ventana incompleta
  const cooldownActive = targets.some((r) => r.dow != null && typeof r.applied_rule === 'string' &&
    r.applied_rule.startsWith(`${item.id} `) && r.valid_from > addDaysISO(today, -windowDays));
  if (cooldownActive) return null;
  const adh = adherenceCheck(dailyTotals, targets, today, windowDays);
  if (!adh.ok) return null;

  let ritmo = null;
  let ma7Now;
  if (item.kind === 'estancamiento') {
    ma7Now = weightMA7(weightByDay, today);
    const ma7Past = weightMA7(weightByDay, addDaysISO(today, -item.days));
    if (ma7Now == null || ma7Past == null) return null; // pesajes insuficientes
    if (!(ma7Now <= ma7Past + 0.1)) return null;
  } else {
    ma7Now = weightMA7(weightByDay, today);
    const ma7Past = weightMA7(weightByDay, addDaysISO(today, -windowDays));
    if (ma7Now == null || ma7Past == null) return null; // pesajes insuficientes
    ritmo = (ma7Now - ma7Past) / item.weeks;
    if (item.kind === 'ritmo_alto' && !(ritmo > item.value)) return null;
    if (item.kind === 'ritmo_lento' && !(-ritmo < item.value)) return null;
  }
  if (item.delta_carbs_g == null) return null;

  const tomorrow = addDaysISO(today, 1);
  const whyText = item.kind === 'estancamiento'
    ? `estancamiento ${item.days} días · ${fmtSigned(item.delta_carbs_g, 0)} g carbs`
    : `${fmtSigned(ritmo, 2)} kg/sem × ${item.weeks} sem · ${fmtSigned(item.delta_carbs_g, 0)} g carbs`;
  const appliedRule = `${item.id} · ${whyText}`;
  const rows = buildScopedRows(phaseRows, item.scope, item.delta_carbs_g, rulesCfg, tomorrow, appliedRule);
  if (!rows) return null;
  return {
    rule: item.kind,
    auto: !!item.auto,
    why: { text: whyText, ritmoKgSem: ritmo != null ? round(ritmo, 3) : null, pctWk: null, ma7: ma7Now, adherencePct: adh.pct },
    rows,
  };
}

// ponytail: the spec gives techo_peso no weeks/days field, so it has no natural
// window for "maintenance kcal" or cooldown. Reuses the 2-week granularity of the
// other rules (same order of magnitude as DEFICIT_RATE_CAP.weeks) for both; revisit
// if a configurable window is ever requested.
const TECHO_WINDOW_DAYS = 14;

function evalTechoPeso(item, ctx) {
  const { weightByDay, dailyTotals, today, vigenteVf, targets, phaseRows } = ctx;
  const ma7Now = weightMA7(weightByDay, today);
  if (ma7Now == null || ma7Now < item.value) return null;
  if (!(vigenteVf && vigenteVf <= addDaysISO(today, -TECHO_WINDOW_DAYS))) return null;
  const cooldownActive = targets.some((r) => r.dow != null && typeof r.applied_rule === 'string' &&
    r.applied_rule.startsWith(`${item.id} `) && r.valid_from > addDaysISO(today, -TECHO_WINDOW_DAYS));
  if (cooldownActive) return null;
  const ma7Past = weightMA7(weightByDay, addDaysISO(today, -TECHO_WINDOW_DAYS));
  if (ma7Past == null) return null; // pesajes insuficientes
  const ritmo = (ma7Now - ma7Past) / (TECHO_WINDOW_DAYS / 7);

  const byDay = new Map(dailyTotals.map((r) => [r.day, r]));
  const consumed = [];
  for (let i = 0; i < TECHO_WINDOW_DAYS; i++) {
    const kcal = Number(byDay.get(addDaysISO(today, -i))?.kcal || 0);
    if (kcal > 0) consumed.push(kcal);
  }
  if (!consumed.length) return null;
  const mantenimiento = Math.round((sum(consumed) / consumed.length - ritmo * 1100) / 10) * 10;

  const tomorrow = addDaysISO(today, 1);
  const whyText = `techo de peso alcanzado · mantenimiento ${mantenimiento} kcal`;
  const appliedRule = `${item.id} · ${whyText}`;
  let changed = false;
  const rows = [];
  for (let dow = 0; dow < 7; dow++) {
    const src = phaseRows[dow];
    if (!src) continue;
    if (src.kcal !== mantenimiento) changed = true;
    const carbsDelta = src.kcal != null ? round((mantenimiento - src.kcal) / 4, 2) : 0;
    rows.push({
      owner: src.owner, dow, valid_from: tomorrow,
      label: src.label, description: src.description, goal: 'mantenimiento',
      kcal: mantenimiento, protein_g: src.protein_g,
      carbs_g: src.carbs_g != null ? round(src.carbs_g + carbsDelta, 2) : src.carbs_g,
      fat_g: src.fat_g, micros: src.micros, bounds: src.bounds, rules: src.rules, applied_rule: appliedRule,
    });
  }
  if (!changed) return null;
  return {
    rule: item.kind,
    auto: !!item.auto,
    why: { text: whyText, ritmoKgSem: round(ritmo, 3), pctWk: null, ma7: ma7Now, mantenimiento, adherencePct: null },
    rows,
  };
}

// Hardcoded deficit-protection guardrail (id 'proteccion-ritmo', not user-editable):
// loss > DEFICIT_RATE_CAP.pctWk %/week of bodyweight sustained for its `weeks` → +carbs.
function evalProteccion(ctx) {
  const { weightByDay, dailyTotals, today, vigenteVf, targets, phaseRows, rulesCfg } = ctx;
  const windowDays = DEFICIT_RATE_CAP.weeks * 7;
  const id = 'proteccion-ritmo';
  if (!(vigenteVf && vigenteVf <= addDaysISO(today, -windowDays))) return null;
  const cooldownActive = targets.some((r) => r.dow != null && typeof r.applied_rule === 'string' &&
    r.applied_rule.startsWith(`${id} `) && r.valid_from > addDaysISO(today, -windowDays));
  if (cooldownActive) return null;
  const adh = adherenceCheck(dailyTotals, targets, today, windowDays);
  if (!adh.ok) return null;
  const ma7Now = weightMA7(weightByDay, today);
  const ma7Past = weightMA7(weightByDay, addDaysISO(today, -windowDays));
  if (ma7Now == null || ma7Past == null) return null;
  const ritmo = (ma7Now - ma7Past) / DEFICIT_RATE_CAP.weeks;
  const pctWk = (ritmo / ma7Now) * 100;
  if (!(pctWk <= -DEFICIT_RATE_CAP.pctWk)) return null;

  const tomorrow = addDaysISO(today, 1);
  const whyText = `${fmtSigned(pctWk, 2)} %/sem × ${DEFICIT_RATE_CAP.weeks} sem · ${fmtSigned(DEFICIT_RATE_CAP.deltaCarbsG, 0)} g carbs`;
  const appliedRule = `${id} · ${whyText}`;
  const rows = buildScopedRows(phaseRows, null, DEFICIT_RATE_CAP.deltaCarbsG, rulesCfg, tomorrow, appliedRule);
  if (!rows) return null;
  return {
    rule: 'proteccion-ritmo',
    auto: true,
    why: { text: whyText, ritmoKgSem: round(ritmo, 3), pctWk: round(pctWk, 2), ma7: ma7Now, adherencePct: adh.pct },
    rows,
  };
}

// Evaluates the vigente phase's rules against recent weight/adherence signals.
// Returns null (nothing fires, or a guard blocks it) or { rule, why, rows } — rows are
// the 7 ready-to-insert dow rows for the new version (valid_from = tomorrow).
// ponytail: guard failures are not surfaced with a reason (why.blocked) — every guard
// simply skips to the next item. The UI only needs "fired or not"; a blocked-reason
// string per guard would triple this function for a "Reglas: <motivo>" line that the
// spec itself marks optional. Add if that line is ever built.
export function evalRules({ targets, bodyMetrics, dailyTotals, todayISO: today }) {
  const dowRows = (targets || []).filter((r) => r.dow != null);
  const vfs = [...new Set(dowRows.map((r) => r.valid_from))].sort();
  const vigenteVf = [...vfs].filter((vf) => vf <= today).pop() || null;
  if (!vigenteVf) return null;
  const phaseRows = Array(7).fill(null);
  for (const r of dowRows) if (r.valid_from === vigenteVf) phaseRows[r.dow] = r;
  const cfgRow = phaseRows.find((r) => r);
  if (!cfgRow) return null;
  const rulesCfg = cleanRules(cfgRow.rules);
  if (rulesCfg.paused_until && rulesCfg.paused_until >= today) return null;

  const weightByDay = new Map(
    (bodyMetrics || []).filter((b) => b.metrics?.peso_kg != null).map((b) => [b.day, Number(b.metrics.peso_kg)])
  );
  const ctx = { targets: targets || [], weightByDay, dailyTotals: dailyTotals || [], today, vigenteVf, phaseRows, rulesCfg };

  const list = cfgRow.goal === 'deficit' ? [{ proteccion: true }, ...rulesCfg.items] : rulesCfg.items;
  for (const item of list) {
    const result = item.proteccion
      ? evalProteccion(ctx)
      : item.kind === 'techo_peso'
        ? evalTechoPeso(item, ctx)
        : evalRitmoOrEstancamiento(item, ctx);
    if (result) return result;
  }
  return null;
}

// —— Nutritional adherence semantics —————————————————————————————————
// The grace range is NOT symmetric nor identical for every nutrient. Each one falls
// into an archetype (nutrientKind) that decides its color and "met" status:
//   diana  — target with a grace band; the regimen skews it ('deficit' penalizes
//            the excess, 'volumen' the shortfall). Only kcal.
//   piso   — minimum to reach; excess is harmless, shortfall = danger. Protein.
//   rango  — symmetric band on both sides of the target. Carbs and fat (a split,
//            not a caloric target): laxer than kcal.
//   techo  — maximum not to exceed; shortfall is harmless, excess = danger. Saturated/
//            trans fat, added sugar, alcohol, cholesterol.
//   sodio  — dual: fixed medical floor (SODIUM_FLOOR_MG) + ceiling (SODIUM_CEILING_MG).
//   meta   — default (rest of the micros): reach the RDA; warn if <, excess harmless.
export const NUTRIENT_KIND = {
  kcal: 'diana',
  protein_g: 'piso',
  carbs_g: 'rango',
  fat_g: 'rango',
  grasa_sat_g: 'techo',
  grasa_trans_g: 'techo',
  azucar_anadido_g: 'techo',
  alcohol_g: 'techo',
  colesterol_mg: 'techo',
  sodio_mg: 'sodio',
};
export function nutrientKind(key) {
  return NUTRIENT_KIND[key] || 'meta';
}

// Grace band widths, as a fraction of the target. Default (clinical)
// values; designed so a future user menu can override them — that is
// why they live as a named constant and not as numbers embedded in each
// classifier. Changing them here recolors the whole app (color is computed on the fly).
export const ADHERENCE_BANDS = {
  // diana (kcal): signed tolerances [shortfall, excess] per regimen. Without a regimen
  // it keeps the historical strict band (±5 ok / ±15 warn) so as not to change the
  // established meaning when the phase declares no goal.
  diana: {
    default: { okUnder: 0.05, okOver: 0.05, warnUnder: 0.15, warnOver: 0.15 },
    mantenimiento: { okUnder: 0.10, okOver: 0.10, warnUnder: 0.20, warnOver: 0.20 },
    recomposicion: { okUnder: 0.10, okOver: 0.10, warnUnder: 0.20, warnOver: 0.20 },
    deficit: { okUnder: 0.15, okOver: 0.08, warnUnder: 0.25, warnOver: 0.18 },
    volumen: { okUnder: 0.08, okOver: 0.15, warnUnder: 0.18, warnOver: 0.25 },
  },
  // rango (carbs, fat): symmetric band around the target.
  rango: { ok: 0.15, warn: 0.30 },
  // techo: slack above the limit before warn / danger.
  techo: { warn: 0.10 },
};

// Active bands: the DEFAULTs above, or the user's if they have an override
// (Settings menu → prefs.data.adherence_bands). Pure module-level state (no
// React or supabase, so as not to pollute domain.js): the UI layer persists and
// notifies. Classifiers ALWAYS read `activeBands`, so editing in
// Settings recolors Today and Dashboard without touching each call site.
let activeBands = ADHERENCE_BANDS;
const bandSubs = new Set();

function mergeDeep(base, ov) {
  if (ov == null || typeof ov !== 'object') return base;
  const out = { ...base };
  for (const k of Object.keys(ov)) {
    out[k] = base[k] && typeof base[k] === 'object' && ov[k] && typeof ov[k] === 'object'
      ? mergeDeep(base[k], ov[k])
      : ov[k];
  }
  return out;
}

// Applies partial overrides on top of the DEFAULTs (null/empty = back to default).
export function setActiveBands(overrides) {
  activeBands = overrides && Object.keys(overrides).length ? mergeDeep(ADHERENCE_BANDS, overrides) : ADHERENCE_BANDS;
  bandSubs.forEach((fn) => fn());
}
export function getActiveBands() {
  return activeBands;
}
export function subscribeBands(fn) {
  bandSubs.add(fn);
  return () => bandSubs.delete(fn);
}

// diana: target with an asymmetric grace band according to the phase regimen.
export function classifyBullseye(consumed, target, goal) {
  if (!target) return null;
  const b = activeBands.diana[goal] || activeBands.diana.default;
  const diff = (consumed - target) / target; // signed: + = excess, − = shortfall
  if (diff >= -b.okUnder && diff <= b.okOver) return 'ok';
  if (diff >= -b.warnUnder && diff <= b.warnOver) return 'warn';
  return 'danger';
}

// Compat: kcal without a known regimen = historical strict band (diana default).
export function classifyKcal(consumed, target) {
  return classifyBullseye(consumed, target, null);
}

// piso: minimum to reach (protein). Excess harmless, shortfall = danger.
export function classifyFloor(consumed, target) {
  if (!target) return null;
  return consumed >= target ? 'ok' : 'danger';
}

// rango: symmetric band on both sides of the target (carbs, fat).
export function classifyBand(consumed, target) {
  if (!target) return null;
  const diff = Math.abs(consumed - target) / target;
  if (diff <= activeBands.rango.ok) return 'ok';
  if (diff <= activeBands.rango.warn) return 'warn';
  return 'danger';
}

// techo: the target is a maximum not to exceed (saturated fat, trans fat, added sugar,
// alcohol, cholesterol; and the sodium ceiling). Below the ceiling = ok; excess counts.
export function classifyCeiling(consumed, ceiling) {
  if (!ceiling) return null;
  if (consumed <= ceiling) return 'ok';
  if (consumed <= ceiling * (1 + activeBands.techo.warn)) return 'warn';
  return 'danger';
}

export const SODIUM_FLOOR_MG = 1500;
export const SODIUM_CEILING_MG = 2300; // UL / daily reference value (FDA).

export function sodiumIsLow(sodiumMg, hasEntries) {
  return hasEntries && sodiumMg < SODIUM_FLOOR_MG;
}

// The ceiling can be raised/lowered by an explicit bound (targets.bounds.sodio_mg.max);
// the floor never (medical rule).
export function sodiumIsHigh(sodiumMg, hasEntries, ceiling = SODIUM_CEILING_MG) {
  return hasEntries && sodiumMg > ceiling;
}

// Dual sodium traffic light: danger outside the [floor, ceiling] range, ok inside.
export function classifySodium(sodiumMg, hasEntries) {
  if (!hasEntries) return null;
  return sodiumMg < SODIUM_FLOOR_MG || sodiumMg > SODIUM_CEILING_MG ? 'danger' : 'ok';
}

// —— Explicit bounds (targets.bounds) ————————————————————————————————
// A bound is a user-declared [min, max] for one nutrient (either side optional).
// It WINS over the archetype: nutrientKind decides only when no bound exists.
export function hasBound(b) {
  return !!b && (b.min != null || b.max != null);
}

// ok inside [min, max]; outside by ≤ techo.warn (10 %) = warn; beyond = danger.
export function classifyBounds(value, b) {
  if (!hasBound(b)) return null;
  const slack = activeBands.techo.warn;
  if (b.min != null && value < b.min) return value < b.min * (1 - slack) ? 'danger' : 'warn';
  if (b.max != null && value > b.max) return value > b.max * (1 + slack) ? 'danger' : 'warn';
  return 'ok';
}

// The bounds the app assumes TODAY for a nutrient without an explicit bound
// (from its archetype + active bands). Shown as placeholders in the Targets editor
// so the user sees the default and only overrides what differs. null side = open.
export function impliedBounds(key, target, goal) {
  const kind = nutrientKind(key);
  if (kind === 'sodio') return { min: SODIUM_FLOOR_MG, max: SODIUM_CEILING_MG };
  if (!(target > 0)) return { min: null, max: null };
  const r = (x) => Math.round(x * 100) / 100;
  if (kind === 'diana') {
    const b = activeBands.diana[goal] || activeBands.diana.default;
    return { min: r(target * (1 - b.okUnder)), max: r(target * (1 + b.okOver)) };
  }
  if (kind === 'rango') return { min: r(target * (1 - activeBands.rango.ok)), max: r(target * (1 + activeBands.rango.ok)) };
  if (kind === 'techo') return { min: null, max: target };
  return { min: target, max: null }; // piso, meta
}

// Effective bound = explicit sides + implied ones for the sides left empty (what
// the editor shows greyed as placeholder is exactly what applies). null when there
// is no explicit bound at all. Sodium: the floor is always the medical one.
export function effectiveBound(key, target, goal, bounds) {
  if (!hasBound(bounds)) return null;
  const imp = impliedBounds(key, target, goal);
  const b = { min: bounds.min ?? imp.min, max: bounds.max ?? imp.max };
  if (nutrientKind(key) === 'sodio') b.min = SODIUM_FLOOR_MG;
  return b;
}

// Single dispatcher for Hoy and Dashboard: explicit bound first, then archetype.
// Sodium below the medical floor is ALWAYS danger (bounds cannot relax it); a
// sodium bound may only move the ceiling.
export function classifyNutrient(key, value, target, { goal = null, hasFood = true, bounds = null } = {}) {
  const kind = nutrientKind(key);
  if (kind === 'sodio' && !hasFood) return null;
  if (kind === 'sodio' && value < SODIUM_FLOOR_MG) return 'danger';
  const eff = effectiveBound(key, target, goal, bounds);
  if (eff) return classifyBounds(value, eff);
  if (kind === 'diana') return classifyBullseye(value, target, goal);
  if (kind === 'piso') return classifyFloor(value, target);
  if (kind === 'rango') return classifyBand(value, target);
  if (kind === 'techo') return classifyCeiling(value, target);
  if (kind === 'sodio') return classifySodium(value, hasFood);
  if (!(target > 0)) return null;
  return value >= target ? 'ok' : 'warn'; // meta: reach the RDA, excess harmless
}

// "High in" per entry (FDA criterion: ≥20% of the daily reference value).
export const SODIUM_HIGH_MG = 460;
export const POTASSIUM_HIGH_MG = 940;

// Water sentinel food (see Today.jsx): kcal 0 and micros = only {agua_ml}. It is
// hidden from the Foods CRUD and managed only from the water card in Today.
export function isWaterSentinel(f) {
  const keys = Object.keys(f.micros || {});
  return f.kcal === 0 && keys.length === 1 && keys[0] === 'agua_ml';
}

export function round(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// Values are always stored per 100 g: if the user captured against another basis, it is
// scaled on save. If the basis is ml it is first converted to grams with the chosen
// density (1 g/ml is NEVER assumed). Portions and density are absolute, not scaled.
// Returns null = blocked, the basis is ml and there is no density.
export function normalizeTo100(f, basis, basisUnit) {
  const b = Number(basis);
  if (!b || b <= 0) return f;
  let baseGrams = b;
  if (basisUnit === 'ml') {
    const density = Number(f.density_g_ml) || 0;
    if (!(density > 0)) return null;
    baseGrams = b * density;
  }
  if (baseGrams === 100) return f;
  const s = 100 / baseGrams;
  const scale = (v, d) => (v === '' || v == null ? v : round(Number(v) * s, d));
  return {
    ...f,
    kcal: scale(f.kcal, 1),
    protein_g: scale(f.protein_g, 2),
    carbs_g: scale(f.carbs_g, 2),
    fat_g: scale(f.fat_g, 2),
    micros: Object.fromEntries(Object.entries(f.micros).map(([k, v]) => [k, round(Number(v) * s, 3)])),
  };
}

// Minimum numbers of logged days required to enable each advanced Dashboard
// calculation (named constants, no magic numbers in the JSX).
export const MIN_DAYS_MEDIAN = 3;
export const MIN_DAYS_STDDEV = 2;
export const MIN_DAYS_TREND = 3;
export const MIN_DAYS_BAYES = 3;

// A logged day counts as "no data" (structural 0) for a micro if more
// than this fraction of the days used carries exactly 0 — the 0 almost
// always means "the food lacked that datum", not "zero intake".
export const STRUCTURAL_ZERO_FRACTION = 0.5;

// Kcal success tolerance for Bayesian adherence (laxer than the classifyKcal
// ±5% traffic light, which is intentionally strict for the UI).
export const BAYES_KCAL_TOL = 0.10;

// Inferred day completeness (§ prompt): personal robust threshold.
export const KCAL_HARD_FLOOR = 500; // NHANES: <500 kcal = always partial
export const COMPLETE_RATIO = 0.6; // fraction of the median (or of the target)
export const HIST_MIN_DAYS = 7; // minimum history to use the median
export const MIN_MEALS_SIGNAL = 3; // meals signal only if the typical count is ≥3

// Tri-state completeness of a day: 'completo' | 'parcial' | 'sin_registro'
// | 'sin_evaluar'. Pure, nothing is persisted — it recalibrates retroactively for free.
// historyKcals: kcal from daily_totals for the last 90 days (may include 0s).
// mealsCount: distinct labels that day. typicalMeals: median of distinct
// labels/day among the logged days of the range.
export function dayCompleteness({ kcal, targetKcal, historyKcals, mealsCount, typicalMeals }) {
  if (kcal <= 0) return 'sin_registro';
  if (kcal < KCAL_HARD_FLOOR) return 'parcial';
  const kcalHistory = (historyKcals || []).filter((k) => k > 0);
  if (kcalHistory.length >= HIST_MIN_DAYS) {
    const med = median(kcalHistory);
    const bingeOverride = typicalMeals >= MIN_MEALS_SIGNAL && mealsCount <= 1;
    if (bingeOverride) return 'parcial';
    return kcal >= COMPLETE_RATIO * med ? 'completo' : 'parcial';
  }
  if (targetKcal != null) {
    return kcal >= COMPLETE_RATIO * targetKcal ? 'completo' : 'parcial';
  }
  return 'sin_evaluar';
}

// Goal (regimen) of a phase. The keys are the CHECK of `targets.goal`
// (migration 010); a phase without a marked goal has goal = null.
export const PHASE_GOALS = [
  { key: 'deficit', label: 'Déficit' },
  { key: 'volumen', label: 'Volumen' },
  { key: 'recomposicion', label: 'Recomposición' },
  { key: 'mantenimiento', label: 'Mantenimiento' },
];

export const goalLabel = (goal) => PHASE_GOALS.find((g) => g.key === goal)?.label || null;

// Target phases as closed intervals: [{ vf, end, label, goal }] in
// chronological order. `end` = the day before the next valid_from, or null in the
// last one (open-ended). label/goal are written identically in the 7 dow rows of
// the phase, so the first row carrying them suffices.
export function phaseList(targets) {
  const rows = targets.filter((t) => t.dow != null);
  const vfs = [...new Set(rows.map((t) => t.valid_from))].sort();
  return vfs.map((vf, i) => ({
    vf,
    end: i + 1 < vfs.length ? addDaysISO(vfs[i + 1], -1) : null,
    label: rows.find((t) => t.valid_from === vf && t.label)?.label || '',
    goal: rows.find((t) => t.valid_from === vf && t.goal)?.goal || null,
  }));
}

// Segments `dates` into target phases by valid_from generation of the dow
// rows of `targets` (§Fix 5) — NOT by change of the daily target value:
// a weekly carb-cycling cycle shares a single valid_from and is
// therefore ONE phase even though the daily value varies by weekday.
// One-off day=F rows (overrides) are ignored for this segmentation.
// Returns [{ vf, days }] in chronological order; vf is null for the stretch
// (if any) preceding the first applicable dow row.
export function targetPhases(targets, dates) {
  const vfs = [...new Set(targets.filter((t) => t.dow != null).map((t) => t.valid_from))].sort();
  const activeVF = (day) => {
    let best = null;
    for (const vf of vfs) {
      if (vf <= day) best = vf;
      else break;
    }
    return best;
  };
  const segments = [];
  for (const day of dates) {
    const vf = activeVF(day);
    const last = segments[segments.length - 1];
    if (last && last.vf === vf) last.days.push(day);
    else segments.push({ vf, days: [day] });
  }
  return segments;
}

export function sum(xs) {
  return xs.reduce((s, x) => s + x, 0);
}

export function quantile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(xs) {
  return quantile(xs, 0.5);
}

// Sample standard deviation (n−1). Requires ≥2 points.
export function stddev(xs) {
  if (xs.length < 2) return null;
  const mean = sum(xs) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// Coefficient of variation (%). null if <2 points or mean 0.
export function cv(xs) {
  if (xs.length < 2) return null;
  const mean = sum(xs) / xs.length;
  if (mean === 0) return null;
  return (stddev(xs) / mean) * 100;
}

// Simple linear regression slope (least squares) over {x, y} pairs
// with x = calendar-day offset (not the consecutive log index):
// with gaps (Mon, Tue, Sat) Saturday is x=2, not x=2 after compacting gaps.
export function olsSlope(points) {
  const n = points.length;
  if (n < 2) return null;
  const xMean = sum(points.map((p) => p.x)) / n;
  const yMean = sum(points.map((p) => p.y)) / n;
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.x - xMean) * (p.y - yMean);
    den += (p.x - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// Lanczos approximation of ln(Gamma(x)) — used by the incomplete beta.
function logGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction of the incomplete beta (Numerical Recipes).
function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-7, FPMIN = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Regularized incomplete beta function I_x(a,b), deterministic, dependency-free.
function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// Inverse of I_x(a,b) by bisection: the p quantile of a Beta(a,b).
function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Bayesian adherence: Beta(1,1) prior, Beta(1+s, 1+n−s) posterior.
// Closed-form posterior mean + 95% credible interval (P2.5–P97.5).
export function bayesAdherence(successes, n) {
  const a = 1 + successes;
  const b = 1 + n - successes;
  return {
    mean: a / (a + b),
    lower: betaQuantile(0.025, a, b),
    upper: betaQuantile(0.975, a, b),
  };
}

// GS1 check digit (EAN-8/12/13/14): from the right, weights 1,3,1,3…
// (the check digit itself weighs 1). The total sum must be a multiple of 10.
// Lengths outside this set (allowed by extractEan in Foods.jsx) pass without checking.
const EAN_CHECKSUM_LENGTHS = [8, 12, 13, 14];

export function eanChecksumValid(digits) {
  if (!EAN_CHECKSUM_LENGTHS.includes(digits.length)) return true;
  const arr = digits.split('').map(Number);
  const sum = arr.reduce((s, d, i) => s + d * ((arr.length - 1 - i) % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

// Client-side replica of the SQL view nutri.entry_nutrients for ONE row: an entry that
// is still queued in the outbox renders with the same numbers the view will return once
// it syncs. If you change the view, change this (same rule as computeRecipePer100g).
// `meta` is the food's (or recipe's) per-100 g row; without it the nutrients stay null
// rather than inventing zeros — the card shows the amount and a "pending" mark.
export function entryNutrients(entry, meta, extra = {}) {
  const f = Number(entry.grams) / 100;
  const scale = (v, d) => (v == null ? null : round(Number(v) * f, d));
  return {
    ...entry,
    item: extra.item ?? null,
    brand: extra.brand ?? null,
    meal: extra.meal ?? null,
    sort_order: null,
    kcal: meta ? scale(meta.kcal, 1) : null,
    protein_g: meta ? scale(meta.protein_g, 2) : null,
    carbs_g: meta ? scale(meta.carbs_g, 2) : null,
    fat_g: meta ? scale(meta.fat_g, 2) : null,
    // jsonb_scale rounds to 3 decimals
    micros: Object.fromEntries(
      Object.entries(meta?.micros || {}).map(([k, v]) => [k, round(Number(v) * f, 3)])
    ),
  };
}

// Client-side replica of the SQL view nutri.recipe_per_100g (§4.3).
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

// Merges ilike search results (primary) with those from match_foods (semantic):
// primary keeps its order and goes first, semantic only contributes new ids, trimmed to max.
export function mergeFoodResults(primary, semantic, max = 8) {
  const seen = new Set((primary || []).map((f) => f.id));
  const extra = (semantic || []).filter((f) => !seen.has(f.id));
  return [...(primary || []), ...extra].slice(0, max);
}
