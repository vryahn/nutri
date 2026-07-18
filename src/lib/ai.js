// Gemini client and helpers shared between Foods.jsx and Recipes.jsx ("Datos con IA").
import { MICROS } from './domain.js';
import { getLang } from './i18n.js';

// "name" in the user's active language, not always Spanish (the rest of the
// prompt remains in Spanish — Gemini understands the instruction all the same).
function nameLangInstruction() {
  return getLang() === 'en' ? 'in English' : 'en español';
}

export const GEMINI_KEY = import.meta.env?.VITE_GEMINI_KEY;
export const MISTRAL_KEY = import.meta.env?.VITE_MISTRAL_KEY;

// Fallback cascade on error/quota exhaustion: Gemini 3.5 → Gemini 2.5 → Mistral.
// Each step is skipped if its key is not configured; see callAI.
const AI_CHAIN = [
  { kind: 'gemini', model: 'gemini-3.5-flash' },
  { kind: 'gemini', model: 'gemini-2.5-flash' },
  { kind: 'mistral', model: 'mistral-small-latest' },
];

// Most commonly consumed liquids with their density (g/ml). The user picks from this
// list and only types a value manually via "Otro…". Gemini receives these canonical
// values and its estimate is snapped to the nearest preset (±0.015) to land on the correct option.
export const DENSITY_PRESETS = [
  { label: 'Agua, café, té o caldo', value: 1 },
  { label: 'Leche', value: 1.03 },
  { label: 'Jugo o refresco', value: 1.04 },
  { label: 'Yogur bebible o licuado', value: 1.05 },
  { label: 'Bebida alcohólica', value: 0.99 },
  { label: 'Aceite', value: 0.92 },
  { label: 'Miel o jarabe', value: 1.4 },
];

export function snapDensity(v) {
  const n = Number(v);
  if (!(n > 0)) return '';
  const near = DENSITY_PRESETS.find((p) => Math.abs(p.value - n) <= 0.015);
  return near ? near.value : n;
}

// Compresses the photo onto a JPEG canvas (an uncompressed phone photo weighs several MB).
async function toJpegCanvas(file, maxSide) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Decodes a URL (e.g. an objectURL) into a ready HTMLImageElement, with naturalWidth/Height.
// Used by the avatar cropper (ProfileSheet): it needs the element for previewing and for drawImage.
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Inline base64 for the AI prompts (Gemini/Mistral).
export async function toJpegBase64(file, maxSide = 1024) {
  const canvas = await toJpegCanvas(file, maxSide);
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

// Blob to upload to Storage (body progress photos). maxSide 1280 preserves
// somewhat more detail than the AI ones; ~200-500 KB after compression.
export async function toJpegBlob(file, maxSide = 1280) {
  const canvas = await toJpegCanvas(file, maxSide);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}

// Hierarchy: transcribed label > readable EAN > USDA-style estimate prioritizing Mexico.
function geminiPrompt() {
  const units = MICROS.map((m) => `${m.key} (${m.unit})`).join(', ');
  return `Eres un asistente de nutrición para México. Devuelve SIEMPRE los valores por 100 unidades de porción comestible (100 g, o 100 ml si el alimento es líquido y la etiqueta declara por ml).
Puedes recibir hasta dos imágenes del MISMO producto (p. ej. frente del empaque con nombre/marca/código de barras y tabla nutrimental): combínalas como una sola fuente. Si ambas muestran etiqueta nutrimental, transcribe solo la más legible — nunca promedies valores entre imágenes.
Sigue esta jerarquía, en orden:
1. Si alguna imagen contiene una etiqueta nutrimental (NOM-051 o similar) legible: TRANSCRIBE los valores declarados, NO estimes. Si la etiqueta declara por gramos, normaliza a 100 g con el tamaño de porción declarado (p. ej. porción de 30 g → multiplica cada valor por 100/30) y basis = "100g". Si la etiqueta declara por mililitros (p. ej. "por 100 ml" o "por porción de 240 ml"), normaliza a 100 ml de la MISMA forma pero sin convertir a gramos — nunca inventes una densidad — y basis = "100ml". mode = "etiqueta".
2. Si hay un código de barras con dígitos impresos legibles, devuélvelos en "ean" (solo dígitos, 8-14 caracteres). Si no se leen completos y sin ambigüedad, ean = null — nunca adivines dígitos.
3. Si no hay etiqueta legible: estima con base tipo USDA FoodData Central, priorizando productos y preparaciones comunes en México, siempre por 100 g (basis = "100g"). mode = "estimacion".
Unidades: kcal en kcal; protein_g, carbs_g y fat_g en gramos; micros: ${units}.
OBLIGATORIOS: kcal, protein_g, carbs_g, fat_g, sodio_mg, potasio_mg y magnesio_mg deben traer SIEMPRE la mejor estimación disponible, aunque sea aproximada. Devuelve null SOLO si es imposible dar una cifra mínimamente fundada — nunca rellenes con 0 inventado ni omitas por pereza.
El resto de los micros (incluida grasa saturada/trans, azúcares y fibra): SOLO con dato fiable de etiqueta o base tipo USDA; si no, null. Un 0 real (p. ej. grasa trans en una manzana) sí es válido cuando el valor real es cero.
COMPLETITUD (crítico): NO omitas ningún valor que la etiqueta o tu fuente declare. Si la etiqueta lista polialcoholes/edulcorantes (eritritol, xilitol, sorbitol, maltitol, sucralosa, aspartamo, acesulfamo K, glucósidos de esteviol, etc.), azúcares individuales (glucosa, fructosa, sacarosa…), tipos de grasa (mono/poliinsaturada, omega-3/6, ALA/EPA/DHA), aminoácidos, cafeína u otros micros de la lista, TRANSCRÍBELOS todos a su clave. Los edulcorantes de alta intensidad (en mg) solo si la etiqueta declara la cantidad — nunca los estimes; si solo mencionan su presencia sin cifra, déjalos en null.
Si el alimento es genérico y SIN marca (nunca para productos empaquetados, que devolverían variantes de EE. UU.), da "usda_query": su nombre en inglés apto para buscar en USDA FoodData Central; si no aplica, null.
Si es líquido o bebida, da "density_g_ml" usando estos valores canónicos cuando el tipo coincida: ${DENSITY_PRESETS.map((p) => `${p.label.toLowerCase()} ${p.value}`).join(', ')}; para otro líquido, tu mejor estimación; si no es líquido, null.
"confidence": "alta"|"media"|"baja" según qué tan fundada está tu respuesta. "name" corto, ${nameLangInstruction()}. "brand" solo si es identificable.`;
}

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mode: { type: 'STRING' },
    basis: { type: 'STRING' },
    ean: { type: 'STRING', nullable: true },
    confidence: { type: 'STRING' },
    usda_query: { type: 'STRING', nullable: true },
    name: { type: 'STRING' },
    brand: { type: 'STRING', nullable: true },
    kcal: { type: 'NUMBER', nullable: true },
    protein_g: { type: 'NUMBER', nullable: true },
    carbs_g: { type: 'NUMBER', nullable: true },
    fat_g: { type: 'NUMBER', nullable: true },
    density_g_ml: { type: 'NUMBER', nullable: true },
    micros: {
      type: 'OBJECT',
      properties: Object.fromEntries(MICROS.map((m) => [m.key, { type: 'NUMBER', nullable: true }])),
      // Without required, Gemini omits keys (constrained decoding) and the flash
      // models return an empty micros object even with a readable label; required + nullable
      // forces every key (null when there is no data). 'micros' also goes in the top-level
      // required: without that, the model omits the entire object and the inner
      // required never applies (verified live). RECIPE_SCHEMA is left without required
      // on purpose: 108 keys × 15 ingredients would inflate the output, and there they are a fallback.
      required: MICROS.map((m) => m.key),
    },
  },
  required: ['mode', 'name', 'micros'],
};

// Ingredient-decomposition prompt: in addition to names/grams/db_match/usda_query,
// Gemini returns for EACH ingredient its per-100 g values as a reviewable FALLBACK (prefill,
// never a silent save: each ingredient without a catalog match is shown as an editable
// card with individual save). Precision priority in the UI: catalog > USDA > AI.
function recipePrompt(catalogNames) {
  const units = MICROS.map((m) => `${m.key} (${m.unit})`).join(', ');
  return `Eres un asistente de nutrición para México. El usuario describe un platillo, bebida o receta (texto y/o hasta dos fotos; si hay dos, son del MISMO platillo — combínalas). Descompón en ingredientes con su cantidad en GRAMOS tal como van en la preparación.
Prefiere pocos ingredientes compuestos ("leche entera", no "leche + grasa"). Máximo 15.
Se te da la lista EXACTA de alimentos del catálogo del usuario. Para cada ingrediente, si uno de esos nombres corresponde claramente al ingrediente, devuelve ese nombre LITERAL en "db_match"; si no hay correspondencia clara, "db_match" = null. Nunca inventes nombres que no estén en la lista.
Catálogo del usuario: ${catalogNames.length ? catalogNames.join(', ') : '(vacío)'}
Para ingredientes genéricos sin match, da "usda_query" (nombre en inglés apto para buscar en USDA FoodData Central); si no aplica, null.
Para CADA ingrediente da además sus valores nutricionales por 100 g de porción comestible, como respaldo revisable (base tipo USDA priorizando México). OBLIGATORIOS siempre con tu mejor estimación disponible: kcal, protein_g, carbs_g, fat_g, sodio_mg, potasio_mg, magnesio_mg (null SOLO si es imposible fundarlo, nunca 0 inventado). Resto de micros: solo con dato fiable, si no null. Unidades: kcal en kcal; protein_g/carbs_g/fat_g en gramos; micros: ${units}.
Si el usuario indica tamaño total (p. ej. "350ml"), conviértelo a gramos con densidad razonable y devuélvelo en "total_weight_g"; si no lo indica, tu mejor estimación del peso total preparado; null si imposible.
"kcal_total_estimate": tu estimación gruesa de kcal TOTALES del platillo completo (solo para verificación cruzada, jamás se persiste); null si no puedes fundarla.
"name": nombre corto de la receta, ${nameLangInstruction()}. "confidence": "alta"|"media"|"baja".`;
}

const RECIPE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    confidence: { type: 'STRING' },
    total_weight_g: { type: 'NUMBER', nullable: true },
    kcal_total_estimate: { type: 'NUMBER', nullable: true },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name_es: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          db_match: { type: 'STRING', nullable: true },
          usda_query: { type: 'STRING', nullable: true },
          kcal: { type: 'NUMBER', nullable: true },
          protein_g: { type: 'NUMBER', nullable: true },
          carbs_g: { type: 'NUMBER', nullable: true },
          fat_g: { type: 'NUMBER', nullable: true },
          micros: {
            type: 'OBJECT',
            properties: Object.fromEntries(MICROS.map((m) => [m.key, { type: 'NUMBER', nullable: true }])),
          },
        },
        required: ['name_es', 'grams'],
      },
    },
  },
  required: ['name', 'ingredients'],
};

// Translates the Gemini-style schema (UPPERCASE types) into standard JSON Schema (Mistral, strict mode).
export function toJsonSchema(g) {
  const t = { OBJECT: 'object', STRING: 'string', NUMBER: 'number', ARRAY: 'array' }[g.type] || String(g.type).toLowerCase();
  const node = { type: g.nullable ? [t, 'null'] : t };
  if (g.properties) {
    node.properties = Object.fromEntries(Object.entries(g.properties).map(([k, v]) => [k, toJsonSchema(v)]));
    node.required = Object.keys(g.properties); // Mistral's strict mode requires every key in required
    node.additionalProperties = false;
  }
  if (g.items) node.items = toJsonSchema(g.items);
  return node;
}

// L2 normalization. gemini-embedding-001 only returns normalized output at 3072 dims;
// at 768 it must be re-normalized so that <=> is a valid cosine distance.
export function l2normalize(v) {
  if (!Array.isArray(v) || v.length === 0) return null;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (!n || !Number.isFinite(n)) return null;
  return v.map((x) => x / n);
}

// Embedding for the catalog's semantic search. null on any failure (never throws).
export async function embedText(text) {
  if (!GEMINI_KEY || !text?.trim()) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({ content: { parts: [{ text: text.trim() }] }, outputDimensionality: 768 }),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return l2normalize(json?.embedding?.values);
  } catch {
    return null;
  }
}

async function callGemini(model, systemPrompt, parts, schema, temperature) {
  const generationConfig = { response_mime_type: 'application/json', response_schema: schema };
  if (temperature != null) generationConfig.temperature = temperature; // only used by the eval (temp 0 = reproducible)
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts }],
      generationConfig,
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${model} ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

async function callMistral(model, systemPrompt, parts, schema, temperature) {
  const content = parts.map((p) => (p.text != null
    ? { type: 'text', text: p.text }
    : { type: 'image_url', image_url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` }));
  const body = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content }],
    response_format: { type: 'json_schema', json_schema: { name: 'nutri', strict: true, schema: toJsonSchema(schema) } },
  };
  if (temperature != null) body.temperature = temperature; // only used by the eval
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mistral ${model} ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// Tries each model in AI_CHAIN in order; on ANY error it moves on to the next.
// Skips a step if its key is not configured. Propagates the last error if all fail.
// Returns { data, model } — model = "kind:model" of the step that responded (for the eval harness).
async function callAI(systemPrompt, parts, schema) {
  let lastErr;
  for (const step of AI_CHAIN) {
    if (step.kind === 'gemini' && !GEMINI_KEY) continue;
    if (step.kind === 'mistral' && !MISTRAL_KEY) continue;
    try {
      const data = step.kind === 'gemini'
        ? await callGemini(step.model, systemPrompt, parts, schema)
        : await callMistral(step.model, systemPrompt, parts, schema);
      return { data, model: `${step.kind}:${step.model}` };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Sin proveedor de IA configurado');
}

export async function estimateRecipe(text, imageFiles, catalogNames) {
  const parts = [{ text: text.trim() || 'Analiza las imágenes.' }];
  for (const f of imageFiles || []) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(f) } });
  }
  const { data: out } = await callAI(recipePrompt(catalogNames), parts, RECIPE_SCHEMA);
  // grams outside a reasonable physical range → empty grams, the ingredient is not discarded
  // (the user enters it by hand). Truncated to 15. Nutrients = per-100 g fallback (prefill);
  // null micros are discarded just as in estimateFood.
  const ingredients = (out.ingredients || []).slice(0, 15).map((i) => {
    const micros = {};
    for (const m of MICROS) {
      const v = i.micros?.[m.key];
      if (v != null) micros[m.key] = v;
    }
    return {
      name_es: i.name_es || '',
      grams: i.grams > 0 && i.grams <= 2000 ? i.grams : '',
      db_match: i.db_match || null,
      usda_query: i.usda_query || null,
      kcal: i.kcal ?? '',
      protein_g: i.protein_g ?? '',
      carbs_g: i.carbs_g ?? '',
      fat_g: i.fat_g ?? '',
      micros,
    };
  });
  return {
    name: out.name || '',
    confidence: out.confidence || null,
    total_weight_g: out.total_weight_g ?? null,
    kcal_total_estimate: out.kcal_total_estimate ?? null,
    ingredients,
  };
}

// An amount typed by the user ALWAYS wins over the one estimated by Gemini. Extracts
// the first amount (ml|l|g|gr|kg, case-insensitive) from the text and normalizes to ml or g
// (l→×1000, kg→×1000). null if the text carries no amount.
export function parseAmount(text) {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|gr|kg)\b/i);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (unit === 'l') return { unit: 'ml', value: value * 1000 };
  if (unit === 'kg') return { unit: 'g', value: value * 1000 };
  if (unit === 'gr') return { unit: 'g', value };
  return { unit, value }; // 'ml' | 'g'
}

export async function estimateFood(text, imageFiles) {
  const parts = [{ text: text.trim() || 'Analiza las imágenes.' }];
  for (const f of imageFiles || []) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(f) } });
  }
  return estimateFoodFromParts(parts);
}

// Portion of the pipeline that runs after `parts` is built (no canvas/DOM): calls the cascade
// and normalizes. Used by estimateFood (browser, with toJpegBase64) and by the eval harness (node,
// which reads the photos from disk). `ai_model` = which model responded; Foods.jsx ignores it.
// opts (eval only): { model, temperature } pins ONE model (no cascade) so that the gate
// does not depend on which model happened to answer due to a 503; Foods.jsx calls without opts and uses the cascade.
// —— "Pregúntale a tu bitácora": structured 3-step RAG (planner → SQL
// in the caller → generation with citations). Entirely gated by GEMINI_KEY in the caller.

const ASK_NUTRIENT_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', ...MICROS.map((m) => m.key)];
const ASK_DEFAULT_NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];
const ASK_MAX_RANGE_DAYS = 92;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(s) {
  return typeof s === 'string' && ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`));
}

function addDaysISOLocal(iso, delta) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('sv-SE');
}

// Pure: normalizes the planner's plan into a range and a set of nutrients that are safe
// to query. See the rules in the worktree prompt (the task's CLAUDE.md).
export function sanitizeAskPlan(plan, todayStr, validNutrients) {
  let dateFrom = plan?.date_from;
  let dateTo = plan?.date_to;
  if (!isValidISODate(dateFrom) || !isValidISODate(dateTo)) {
    dateTo = todayStr;
    dateFrom = addDaysISOLocal(todayStr, -29);
  }
  if (dateTo > todayStr) dateTo = todayStr;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  let clamped = false;
  const spanDays = Math.round((Date.parse(`${dateTo}T00:00:00`) - Date.parse(`${dateFrom}T00:00:00`)) / 86400000) + 1;
  if (spanDays > ASK_MAX_RANGE_DAYS) {
    dateFrom = addDaysISOLocal(dateTo, -91);
    clamped = true;
  }
  const validSet = new Set(validNutrients);
  let nutrients = Array.isArray(plan?.nutrients) ? plan.nutrients.filter((n) => validSet.has(n)) : [];
  if (!nutrients.length) nutrients = ASK_DEFAULT_NUTRIENTS;
  return { date_from: dateFrom, date_to: dateTo, need_detail: !!plan?.need_detail, nutrients, clamped };
}

const ASK_PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    date_from: { type: 'STRING' },
    date_to: { type: 'STRING' },
    need_detail: { type: 'BOOLEAN' },
    nutrients: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['date_from', 'date_to', 'need_detail', 'nutrients'],
};

function askPlanPrompt(todayStr) {
  return `Dada una pregunta del usuario sobre su registro nutricional y la fecha de hoy (${todayStr}, formato YYYY-MM-DD), decide el rango de fechas a consultar (date_from, date_to, formato YYYY-MM-DD), si hacen falta alimentos individuales (need_detail: true cuando la pregunta pide causas, alimentos concretos o "qué comí") y qué nutrientes están implicados (nutrients: claves EXACTAS de esta lista, nunca inventes otras): ${ASK_NUTRIENT_KEYS.join(', ')}.`;
}

// Step 1 of the RAG: decides the date range, whether per-food detail is needed
// and which nutrients to query. Returns the plan already sanitized (sanitizeAskPlan).
export async function planAskQuery(question, todayStr, lang) {
  const langInstr = lang === 'en' ? 'Answer only via the schema fields.' : 'Responde solo con los campos del schema.';
  const { data } = await callAI(`${askPlanPrompt(todayStr)} ${langInstr}`, [{ text: question }], ASK_PLAN_SCHEMA);
  return sanitizeAskPlan(data, todayStr, ASK_NUTRIENT_KEYS);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function roundTo1(v) {
  return Math.round(Number(v) * 10) / 10;
}

// kcal/protein_g/carbs_g/fat_g live in flat fields of the row (daily_totals
// / targets); the remaining nutrients live in its `micros` jsonb.
function nutrientValue(row, key) {
  if (row == null) return null;
  if (key === 'kcal' || key === 'protein_g' || key === 'carbs_g' || key === 'fat_g') return row[key] ?? null;
  return row.micros?.[key] ?? null;
}

const ASK_ENTRIES_LIMIT = 400;

// Pure: builds the compact CSV context for the generation step. `days` =
// daily_totals rows for the range; `targetByDay` = { day: targetOrResolvedRow
// | null } (resolveTarget already applied by the caller); `entries` =
// entry_nutrients rows for the range, or null if need_detail was false.
export function formatAskContext({ days, targetByDay, entries, nutrients }) {
  const sortedDays = [...(days || [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const nutrientRow = (day, row) => [day, ...nutrients.map((k) => { const v = nutrientValue(row, k); return v == null ? '' : roundTo1(v); })].map(csvCell).join(',');

  const lines = [
    '# Totales diarios (unidades: kcal, g o mg segun la clave)',
    ['day', ...nutrients].map(csvCell).join(','),
    ...sortedDays.map((d) => nutrientRow(d.day, d)),
    '# Objetivo del día (mismas columnas; vacío si no hay)',
    ['day', ...nutrients].map(csvCell).join(','),
    ...sortedDays.map((d) => nutrientRow(d.day, targetByDay?.[d.day] ?? null)),
  ];

  if (entries != null) {
    const total = entries.length;
    const rows = total > ASK_ENTRIES_LIMIT
      ? [...entries].sort((a, b) => Number(b.kcal || 0) - Number(a.kcal || 0)).slice(0, ASK_ENTRIES_LIMIT)
      : entries;
    // Extra columns = the question's nutrients: without them the answer cannot
    // attribute a micro (e.g. sodium) to specific foods.
    const extra = nutrients.filter((k) => k !== 'kcal');
    lines.push('# Alimentos', ['day', 'item', 'grams', 'kcal', ...extra].map(csvCell).join(','));
    for (const r of rows) {
      const vals = extra.map((k) => { const v = nutrientValue(r, k); return v == null ? '' : roundTo1(v); });
      lines.push([r.day, r.item, roundTo1(r.grams), roundTo1(r.kcal), ...vals].map(csvCell).join(','));
    }
    if (total > ASK_ENTRIES_LIMIT) lines.push(`(recortado a ${ASK_ENTRIES_LIMIT} alimentos de ${total})`);
  }

  return lines.join('\n');
}

const ASK_ANSWER_SCHEMA = { type: 'OBJECT', properties: { answer: { type: 'STRING' } }, required: ['answer'] };

function askAnswerPrompt(lang) {
  const idioma = lang === 'en' ? 'inglés' : 'español';
  return `Eres el asistente de datos de una app de registro nutricional personal. Responde la pregunta usando EXCLUSIVAMENTE las cifras del contexto; nunca inventes ni extrapoles valores. Cita días y alimentos concretos (ej. "El 12 jul: 2,890 mg de sodio, principalmente Chilaquiles 320 g"). Describe los datos, no prescribas ni des consejo médico. Responde en ${idioma}, conciso, en texto plano sin markdown.`;
}

// Step 3 of the RAG: generates the natural-language answer from the
// already-built context (formatAskContext). There is no true free-form schema — GEMINI_SCHEMA
// requires one, so a single-field object is used and `answer` is extracted.
export async function askAnswer(question, contextStr, lang) {
  const parts = [{ text: `Contexto:\n${contextStr}\n\nPregunta: ${question}` }];
  const { data } = await callAI(askAnswerPrompt(lang), parts, ASK_ANSWER_SCHEMA);
  return data.answer || '';
}

export async function estimateFoodFromParts(parts, opts = {}) {
  let out, model;
  if (opts.model) {
    const mistral = opts.model.startsWith('mistral');
    const call = mistral ? callMistral : callGemini;
    out = await call(opts.model, geminiPrompt(), parts, GEMINI_SCHEMA, opts.temperature);
    model = `${mistral ? 'mistral' : 'gemini'}:${opts.model}`;
  } else {
    ({ data: out, model } = await callAI(geminiPrompt(), parts, GEMINI_SCHEMA));
  }
  const micros = {};
  for (const m of MICROS) {
    const v = out.micros?.[m.key];
    if (v != null) micros[m.key] = v;
  }
  return {
    mode: out.mode,
    basis: out.basis === '100ml' ? '100ml' : '100g',
    ean: out.ean || null,
    confidence: out.confidence || null,
    usda_query: out.usda_query || null,
    name: out.name || '',
    brand: out.brand || '',
    kcal: out.kcal ?? '',
    protein_g: out.protein_g ?? '',
    carbs_g: out.carbs_g ?? '',
    fat_g: out.fat_g ?? '',
    micros,
    density_g_ml: snapDensity(out.density_g_ml),
    ai_model: model,
  };
}
