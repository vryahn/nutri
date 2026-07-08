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
];

export const MICROS_DEFAULT = 8; // grasa sat/trans, azúcares, fibra, sodio, potasio, magnesio

// Orden de despliegue de los grupos de micros ocultos.
const CAT_ORDER = ['Lípidos', 'Carbohidratos', 'Vitaminas', 'Minerales', 'Antioxidantes', 'Otros'];

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
  return Math.round(
    4 * Number(f.protein_g || 0) +
      4 * Number(f.carbs_g || 0) +
      9 * Number(f.fat_g || 0) +
      7 * Number(f.micros?.alcohol_g || 0) -
      2 * Number(f.micros?.fibra_g || 0)
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

  if (satTrans != null && fat != null && satTrans > fat + 0.5) return true;
  if (azucar != null && carbs != null && azucar > carbs + 0.5) return true;
  if (azucarAnadido != null && azucar != null && azucarAnadido > azucar + 0.5) return true;
  if (fibra != null && carbs != null && fibra > carbs + 0.5) return true;
  return false;
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

export const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

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
