// Claves EXACTAS del jsonb `micros` (claves libres fragmentarían las sumas).
// El orden es contrato de UI: los primeros MICROS_DEFAULT visibles en FoodForm
// y orden de la tabla del Dashboard. Las claves jamás se renombran.
// `cat` agrupa los micros ocultos al desplegarlos (FoodForm y Dashboard).
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
  // — ocultos por defecto; el usuario los promueve con prefs.data.fav_micros —
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

  // --- Ampliación paridad Cronometer + seguimiento médico (todas ocultas por
  // defecto, promovibles como favorito igual que el resto). Las vistas SQL suman
  // el jsonb genéricamente (jsonb_each_text): claves nuevas NO requieren migración. ---

  // Carbohidratos detallados
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

  // Edulcorantes — polialcoholes (declarados en g en la etiqueta)
  { key: 'polioles_g', label: 'Polialcoholes (total)', unit: 'g', cat: 'Edulcorantes' },
  { key: 'eritritol_g', label: 'Eritritol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'xilitol_g', label: 'Xilitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'sorbitol_g', label: 'Sorbitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'maltitol_g', label: 'Maltitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'manitol_g', label: 'Manitol', unit: 'g', cat: 'Edulcorantes' },
  { key: 'isomalt_g', label: 'Isomalt', unit: 'g', cat: 'Edulcorantes' },
  { key: 'lactitol_g', label: 'Lactitol', unit: 'g', cat: 'Edulcorantes' },
  // Edulcorantes — alta intensidad (mg; solo con dato declarado/publicado, nunca estimado)
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

  // Lípidos detallados
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

  // Vitaminas detalladas
  { key: 'retinol_mcg', label: 'Retinol', unit: 'µg', cat: 'Vitaminas' },
  { key: 'tocoferol_beta_mg', label: 'β-tocoferol', unit: 'mg', cat: 'Vitaminas' },
  { key: 'tocoferol_gamma_mg', label: 'γ-tocoferol', unit: 'mg', cat: 'Vitaminas' },
  { key: 'tocoferol_delta_mg', label: 'δ-tocoferol', unit: 'mg', cat: 'Vitaminas' },

  // Antioxidantes
  { key: 'alfa_caroteno_mcg', label: 'α-caroteno', unit: 'µg', cat: 'Antioxidantes' },
  { key: 'beta_criptoxantina_mcg', label: 'β-criptoxantina', unit: 'µg', cat: 'Antioxidantes' },

  // Minerales
  { key: 'fluoruro_mcg', label: 'Fluoruro', unit: 'µg', cat: 'Minerales' },

  // Otros
  { key: 'cafeina_mg', label: 'Cafeína', unit: 'mg', cat: 'Otros' },
  { key: 'teobromina_mg', label: 'Teobromina', unit: 'mg', cat: 'Otros' },
  { key: 'ceniza_g', label: 'Ceniza', unit: 'g', cat: 'Otros' },
  { key: 'beta_hidroxibutirato_g', label: 'β-hidroxibutirato', unit: 'g', cat: 'Otros' },
  { key: 'oxalato_mg', label: 'Oxalato', unit: 'mg', cat: 'Otros' },
  { key: 'fitato_mg', label: 'Fitato', unit: 'mg', cat: 'Otros' },

  // Aminoácidos
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

export const MICROS_DEFAULT = 8; // grasa sat/trans, azúcares, fibra, sodio, potasio, magnesio

// Orden de despliegue de los grupos de micros ocultos.
const CAT_ORDER = ['Lípidos', 'Carbohidratos', 'Edulcorantes', 'Vitaminas', 'Minerales', 'Antioxidantes', 'Aminoácidos', 'Otros'];

// Agrupa una lista de micros por categoría, en CAT_ORDER y sin grupos vacíos.
// Devuelve [{ cat, items }]. Usada por FoodForm y la tabla del Dashboard.
export function microGroups(list) {
  return CAT_ORDER.flatMap((cat) => {
    const items = list.filter((m) => m.cat === cat);
    return items.length ? [{ cat, items }] : [];
  });
}

// Kcal teóricas: Atwater (prot 4 + carbs 4 + grasa 9 + alcohol 7) con la fibra
// a 2 kcal/g (NOM-051/UE): carbs_g es TOTAL (incluye fibra), así que se resta
// 2 kcal por gramo de fibra. Placeholder y default del campo kcal en FoodForm.
export function kcalFromMacros(f) {
  const m = f.micros || {};
  // Polialcoholes aportan ~2.4 kcal/g, no 4: carbs_g (total) ya los cuenta a 4, así
  // que se corrige la diferencia (1.6 kcal/g). Sin esto, un producto sin azúcar
  // endulzado con polioles dispara un falso ⚠ de kcal. Usa el total declarado o,
  // si falta, la suma de los polioles individuales.
  // ponytail: eritritol real es ~0 kcal/g; se trata a 2.4 como el resto — la
  // tolerancia de kcalSuspicious (25 %) absorbe la diferencia salvo en productos
  // casi puros de eritritol, poco comunes; afinar a 0 si aparece el caso.
  const polioles = Number(m.polioles_g || 0) ||
    (Number(m.eritritol_g || 0) + Number(m.xilitol_g || 0) + Number(m.sorbitol_g || 0) +
      Number(m.maltitol_g || 0) + Number(m.manitol_g || 0) + Number(m.isomalt_g || 0) +
      Number(m.lactitol_g || 0));
  return Math.round(
    4 * Number(f.protein_g || 0) +
      4 * Number(f.carbs_g || 0) +
      9 * Number(f.fat_g || 0) +
      7 * Number(m.alcohol_g || 0) -
      2 * Number(m.fibra_g || 0) -
      1.6 * polioles
  );
}

// Kcal declaradas incompatibles con los macros → el alimento requiere revisión
// (auditable después por el usuario o una IA vía API; se calcula al vuelo, no se persiste).
// Tolerancia: 25 % o 20 kcal — cubre redondeos de etiqueta, fibra y polioles.
export function kcalSuspicious(f) {
  const expected = kcalFromMacros(f);
  return Math.abs(Number(f.kcal || 0) - expected) > Math.max(20, expected * 0.25);
}

// Cotas fisiológicas máximas por micro, por 100 g (~1.5x el alimento más denso
// conocido): atrapan SOLO errores de unidades ×1000, no valores altos legítimos
// ni alimentos fortificados. Claves ausentes de la tabla = sin cota.
export const MICRO_MAX = {
  sodio_mg: 40000, potasio_mg: 16000, magnesio_mg: 1200, calcio_mg: 3500,
  hierro_mg: 190, zinc_mg: 120, fosforo_mg: 3000, selenio_mcg: 3000,
  cobre_mg: 25, manganeso_mg: 90,
  colesterol_mg: 4700,
  vit_a_mcg: 15000, vit_c_mg: 3000, vit_d_mcg: 400, vit_e_mg: 250, vit_k_mcg: 2600,
  vit_b12_mcg: 160, vit_b9_mcg: 6000,
  // Nunca se venden en forma pura como alimento: una cota generosa solo atrapa el
  // error de unidades ×1000, sin marcar valores altos legítimos (espinaca ~1000 mg
  // oxalato/100 g, salvado ~5000 mg fitato/100 g). Los edulcorantes y la cafeína SÍ
  // pueden venir casi puros (endulzante de mesa, cafeína en polvo): se dejan sin
  // cota adrede — un ⚠ falso sobre un dato médico es peor que no marcar.
  oxalato_mg: 20000, fitato_mg: 20000,
};

// Claves EXACTAS del jsonb `body_metrics.metrics` (medidas corporales, migración 012).
// Mismo contrato que MICROS: el orden es contrato de UI (los primeros
// BODY_METRICS_DEFAULT visibles, el resto tras "más medidas"); las claves jamás se
// renombran. Valores numéricos; `cat` agrupa la sección extendida.
export const BODY_METRICS = [
  { key: 'peso_kg', label: 'Peso', unit: 'kg', cat: 'Composición' },
  { key: 'grasa_pct', label: 'Grasa corporal', unit: '%', cat: 'Composición' },
  { key: 'musculo_kg', label: 'Masa muscular', unit: 'kg', cat: 'Composición' },
  // — extendidas (ocultas tras "más medidas") —
  { key: 'agua_pct', label: 'Agua corporal', unit: '%', cat: 'Composición' },
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
  // — segmental (bioimpedancia): masa magra y grasa por segmento, no derivable —
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
export const BODY_METRICS_DEFAULT = 3; // peso, grasa, músculo siempre visibles

// Limpia un mapa {clave: valor} a solo números finitos ≥ 0 (para persistir medidas
// corporales): '' o basura se descartan — nunca se guarda un dato inventado.
export function cleanNumericMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === '' || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

// Cotas fisiológicas máximas por medida: atrapan errores de dedo (kg↔g, punto
// decimal), no valores altos legítimos. Clave ausente = sin cota. Al vuelo, no persistida.
export const BODY_METRIC_MAX = {
  peso_kg: 500, grasa_pct: 80, musculo_kg: 120, agua_pct: 90, hueso_kg: 12,
  grasa_visceral: 60, metabolismo_basal_kcal: 6000,
  cintura_cm: 300, cadera_cm: 300, pecho_cm: 300, cuello_cm: 120,
  biceps_der_cm: 120, biceps_izq_cm: 120, pierna_izq_cm: 150, pierna_der_cm: 150,
  pantorrilla_izq_cm: 100, pantorrilla_der_cm: 100,
  magra_tronco_kg: 60, magra_brazo_izq_kg: 30, magra_brazo_der_kg: 30,
  magra_pierna_izq_kg: 30, magra_pierna_der_kg: 30,
  grasa_tronco_kg: 40, grasa_brazo_izq_kg: 20, grasa_brazo_der_kg: 20,
  grasa_pierna_izq_kg: 20, grasa_pierna_der_kg: 20,
};

// Chequeo físico grueso por 100 g: proteína+carbs+grasa+alcohol+agua no pueden
// superar ~105 g (100 g de porción + margen de redondeo/etiqueta); ningún macro
// por separado puede superar 100 g; ningún micro puede superar su cota en MICRO_MAX.
// Se calcula al vuelo (como kcalSuspicious), no se persiste.
export function macrosImplausible(f) {
  const p = Number(f.protein_g || 0);
  const c = Number(f.carbs_g || 0);
  const g = Number(f.fat_g || 0);
  const alcohol = Number(f.micros?.alcohol_g || 0);
  const agua = Number(f.micros?.agua_ml || 0);
  if (p + c + g + alcohol + agua > 105) return true;
  if (p > 100 || c > 100 || g > 100) return true;
  const m = f.micros || {};
  for (const [key, max] of Object.entries(MICRO_MAX)) {
    if (m[key] != null && Number(m[key]) > max) return true;
  }
  return false;
}

// Desigualdades de composición entre micros y macros (holgura +0.5 g por redondeos).
// Solo evalúa una desigualdad cuando AMBOS operandos son numéricos — un dato ausente
// no cuenta como 0, para no marcar falsos positivos. Al vuelo, nunca persistida.
// Devuelve la FRASE de la primera desigualdad rota (para mostrarla al usuario) o null.
// Cadena → truthy, null → falsy: los usos como booleano siguen funcionando igual.
// ponytail: sin check de aminoácidos vs proteína — la suma de aminoácidos casi siempre
// choca con la proteína Kjeldahl (N×6.25) o viene declarada por 100 g de proteína, no de
// producto; era falso positivo garantizado en toda proteína en polvo. Reactivar solo si
// se normaliza la base de los aminoácidos a la del producto.
export function componentsInconsistent(f) {
  const m = f.micros || {};
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const fat = num(f.fat_g);
  const carbs = num(f.carbs_g);
  const satTrans = m.grasa_sat_g != null || m.grasa_trans_g != null
    ? Number(m.grasa_sat_g || 0) + Number(m.grasa_trans_g || 0)
    : null;
  const azucar = num(m.azucar_g);
  const azucarAnadido = num(m.azucar_anadido_g);
  const fibra = num(m.fibra_g);

  // Suma de las claves presentes (null si ninguna): un dato ausente no cuenta como 0,
  // así una suma parcial siempre queda por debajo del total y nunca es falso positivo.
  const sumPresent = (...ks) => {
    const vals = ks.map((k) => num(m[k])).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const polioles = num(m.polioles_g);
  const poliolPartes = sumPresent('eritritol_g', 'xilitol_g', 'sorbitol_g', 'maltitol_g', 'manitol_g', 'isomalt_g', 'lactitol_g');
  const azucarPartes = sumPresent('glucosa_g', 'fructosa_g', 'galactosa_g', 'lactosa_g', 'maltosa_g', 'sacarosa_g');
  const fibraPartes = sumPresent('fibra_soluble_g', 'fibra_insoluble_g');
  const grasaPartes = sumPresent('grasa_sat_g', 'grasa_trans_g', 'grasa_mono_g', 'grasa_poli_g');
  const omega3 = num(m.omega3_g);
  const omega3Partes = sumPresent('ala_g', 'epa_g', 'dha_g');
  const omega6 = num(m.omega6_g);
  const omega6Partes = sumPresent('la_g', 'aa_g');

  const over = (a, b) => a != null && b != null && a > b + 0.5;
  if (over(satTrans, fat)) return 'grasa saturada + trans supera la grasa total';
  if (over(azucar, carbs)) return 'azúcar supera los carbohidratos';
  if (over(azucarAnadido, azucar)) return 'azúcar añadido supera el azúcar total';
  if (over(fibra, carbs)) return 'fibra supera los carbohidratos';
  if (over(polioles, carbs)) return 'polialcoholes superan los carbohidratos';
  if (over(poliolPartes, polioles)) return 'los polialcoholes desglosados superan su total';
  if (over(azucarPartes, azucar)) return 'los azúcares desglosados superan el azúcar total';
  if (over(fibraPartes, fibra)) return 'fibra soluble + insoluble supera la fibra total';
  if (over(grasaPartes, fat)) return 'los tipos de grasa superan la grasa total';
  if (over(omega3Partes, omega3)) return 'ALA + EPA + DHA superan el omega-3 total';
  if (over(omega6Partes, omega6)) return 'LA + AA superan el omega-6 total';
  return null;
}

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

// Ventana para la "moda de gramos" de Recientes en Hoy: si hay fase de objetivos
// vigente y lleva ≥7 días corridos, se limita a la fase (refleja el patrón actual
// de porciones); antes de esa semana no hay muestra suficiente → ventana de 40 días.
// phaseVfs = valid_from distintos de filas dow; today = ISO yyyy-mm-dd.
export function recentWindowStart(phaseVfs, today) {
  const vigente = [...phaseVfs].filter((vf) => vf <= today).sort().pop() || null;
  if (vigente && addDaysISO(vigente, 7) <= today) return vigente;
  return addDaysISO(today, -40);
}

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

// "Alto en" por registro (criterio FDA: ≥20% del valor diario de referencia).
export const SODIUM_HIGH_MG = 460;
export const POTASSIUM_HIGH_MG = 940;

// Alimento-centinela de agua (ver Today.jsx): kcal 0 y micros = solo {agua_ml}. Se
// oculta del CRUD de Alimentos, se gestiona solo desde la tarjeta de agua en Hoy.
export function isWaterSentinel(f) {
  const keys = Object.keys(f.micros || {});
  return f.kcal === 0 && keys.length === 1 && keys[0] === 'agua_ml';
}

export function round(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// Mínimos de días registrados para habilitar cada cálculo avanzado del
// Dashboard (constantes nombradas, no números mágicos en el JSX).
export const MIN_DIAS_MEDIANA = 3;
export const MIN_DIAS_STDDEV = 2;
export const MIN_DIAS_TENDENCIA = 3;
export const MIN_DIAS_BAYES = 3;

// Un día registrado cuenta como "sin dato" (0 estructural) para un micro si
// más de esta fracción de los días usados trae exactamente 0 — el 0 casi
// siempre significa "el alimento no traía ese dato", no "consumo cero".
export const STRUCTURAL_ZERO_FRACTION = 0.5;

// Tolerancia de éxito de kcal para adherencia bayesiana (más laxa que el
// semáforo classifyKcal ±5%, que es intencionalmente estricto para la UI).
export const BAYES_KCAL_TOL = 0.10;

// Completitud de día inferida (§ prompt): umbral robusto personal.
export const KCAL_HARD_FLOOR = 500; // NHANES: <500 kcal = parcial siempre
export const COMPLETE_RATIO = 0.6; // fracción de la mediana (o del objetivo)
export const HIST_MIN_DAYS = 7; // mínimo de historial para usar la mediana
export const MIN_MEALS_SIGNAL = 3; // señal de comidas solo si lo típico es ≥3

// Tri-estado de completitud de un día: 'completo' | 'parcial' | 'sin_registro'
// | 'sin_evaluar'. Pura, nada se persiste — recalibra retroactivamente gratis.
// historyKcals: kcal de daily_totals de los últimos 90 días (puede incluir 0s).
// mealsCount: etiquetas distintas ese día. typicalMeals: mediana de etiquetas
// distintas/día entre los días registrados del rango.
export function dayCompleteness({ kcal, targetKcal, historyKcals, mealsCount, typicalMeals }) {
  if (kcal <= 0) return 'sin_registro';
  if (kcal < KCAL_HARD_FLOOR) return 'parcial';
  const historial = (historyKcals || []).filter((k) => k > 0);
  if (historial.length >= HIST_MIN_DAYS) {
    const med = median(historial);
    const bingeOverride = typicalMeals >= MIN_MEALS_SIGNAL && mealsCount <= 1;
    if (bingeOverride) return 'parcial';
    return kcal >= COMPLETE_RATIO * med ? 'completo' : 'parcial';
  }
  if (targetKcal != null) {
    return kcal >= COMPLETE_RATIO * targetKcal ? 'completo' : 'parcial';
  }
  return 'sin_evaluar';
}

// Meta (régimen) de una fase. Las claves son el CHECK de `targets.goal`
// (migración 010); una fase sin meta marcada tiene goal = null.
export const PHASE_GOALS = [
  { key: 'deficit', label: 'Déficit' },
  { key: 'volumen', label: 'Volumen' },
  { key: 'recomposicion', label: 'Recomposición' },
  { key: 'mantenimiento', label: 'Mantenimiento' },
];

export const goalLabel = (goal) => PHASE_GOALS.find((g) => g.key === goal)?.label || null;

// Fases de objetivo como intervalos cerrados: [{ vf, end, label, goal }] en
// orden cronológico. `end` = día antes del siguiente valid_from, o null en la
// última (abierta). label/goal se escriben iguales en las 7 filas dow de la
// fase, así que basta la primera fila que los traiga.
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

// Segmenta `dates` en fases de objetivo por generación de valid_from de las
// filas dow de `targets` (§Fix 5) — NO por cambio del valor diario del
// objetivo: un ciclo semanal de carb cycling comparte un único valid_from y
// por lo tanto es UNA fase aunque el valor diario varíe por día de semana.
// Las filas day=F puntuales (overrides) se ignoran para esta segmentación.
// Devuelve [{ vf, days }] en orden cronológico; vf es null para el tramo
// (si existe) anterior a la primera fila dow aplicable.
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

// Desviación estándar muestral (n−1). Requiere ≥2 puntos.
export function stddev(xs) {
  if (xs.length < 2) return null;
  const mean = sum(xs) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// Coeficiente de variación (%). null si <2 puntos o media 0.
export function cv(xs) {
  if (xs.length < 2) return null;
  const mean = sum(xs) / xs.length;
  if (mean === 0) return null;
  return (stddev(xs) / mean) * 100;
}

// Pendiente de regresión lineal simple (mínimos cuadrados) sobre pares
// {x, y} con x = offset de día calendario (no índice consecutivo de registro):
// con huecos (lun, mar, sáb) el sábado es x=2, no x=2 tras compactar huecos.
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

// Aproximación de Lanczos para ln(Gamma(x)) — usada por la beta incompleta.
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

// Fracción continua de la beta incompleta (Numerical Recipes).
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

// Función beta incompleta regularizada I_x(a,b), determinista, sin dependencias.
function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// Inversa de I_x(a,b) por bisección: el cuantil p de una Beta(a,b).
function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Adherencia bayesiana: prior Beta(1,1), posterior Beta(1+s, 1+n−s).
// Media posterior cerrada + intervalo de credibilidad 95% (P2.5–P97.5).
export function bayesAdherence(successes, n) {
  const a = 1 + successes;
  const b = 1 + n - successes;
  return {
    mean: a / (a + b),
    lower: betaQuantile(0.025, a, b),
    upper: betaQuantile(0.975, a, b),
  };
}

// Dígito verificador GS1 (EAN-8/12/13/14): desde la derecha, peso 1,3,1,3…
// (el propio dígito de control pesa 1). Suma total debe ser múltiplo de 10.
// Longitudes fuera de este set (permitidas por extractEan en Foods.jsx) pasan sin chequeo.
const EAN_CHECKSUM_LENGTHS = [8, 12, 13, 14];

export function eanChecksumValid(digits) {
  if (!EAN_CHECKSUM_LENGTHS.includes(digits.length)) return true;
  const arr = digits.split('').map(Number);
  const sum = arr.reduce((s, d, i) => s + d * ((arr.length - 1 - i) % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
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
