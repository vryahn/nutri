// Cliente Gemini y helpers compartidos entre Foods.jsx y Recipes.jsx ("Datos con IA").
import { MICROS } from './domain.js';

export const GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY;
export const GEMINI_MODEL = 'gemini-3.5-flash';

// Líquidos más consumidos con su densidad (g/ml). El usuario elige de aquí y solo
// teclea manualmente con "Otro…". Gemini recibe estos valores canónicos y su
// estimación se ajusta al preset más cercano (±0.015) para caer en la opción correcta.
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

// Comprime la foto antes de mandarla inline (una foto de móvil sin comprimir pesa varios MB).
export async function toJpegBase64(file, maxSide = 1024) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

// Jerarquía: etiqueta transcrita > EAN legible > estimación tipo USDA priorizando México.
function geminiPrompt() {
  const units = MICROS.map((m) => `${m.key} (${m.unit})`).join(', ');
  return `Eres un asistente de nutrición para México. Devuelve SIEMPRE los valores por 100 gramos de porción comestible. Sigue esta jerarquía, en orden:
1. Si la imagen contiene una etiqueta nutrimental (NOM-051 o similar) legible: TRANSCRIBE los valores declarados, NO estimes. Normaliza a 100 g con el tamaño de porción declarado (p. ej. porción de 30 g → multiplica cada valor por 100/30). mode = "etiqueta".
2. Si hay un código de barras con dígitos impresos legibles, devuélvelos en "ean" (solo dígitos, 8-14 caracteres). Si no se leen completos y sin ambigüedad, ean = null — nunca adivines dígitos.
3. Si no hay etiqueta legible: estima con base tipo USDA FoodData Central, priorizando productos y preparaciones comunes en México. mode = "estimacion".
Unidades: kcal en kcal; protein_g, carbs_g y fat_g en gramos; micros: ${units}.
OBLIGATORIOS: kcal, protein_g, carbs_g, fat_g, sodio_mg, potasio_mg y magnesio_mg deben traer SIEMPRE la mejor estimación disponible, aunque sea aproximada. Devuelve null SOLO si es imposible dar una cifra mínimamente fundada — nunca rellenes con 0 inventado ni omitas por pereza.
El resto de los micros (incluida grasa saturada/trans, azúcares y fibra): SOLO con dato fiable de etiqueta o base tipo USDA; si no, null. Un 0 real (p. ej. grasa trans en una manzana) sí es válido cuando el valor real es cero.
Si el alimento es genérico y SIN marca (nunca para productos empaquetados, que devolverían variantes de EE. UU.), da "usda_query": su nombre en inglés apto para buscar en USDA FoodData Central; si no aplica, null.
Si es líquido o bebida, da "density_g_ml" usando estos valores canónicos cuando el tipo coincida: ${DENSITY_PRESETS.map((p) => `${p.label.toLowerCase()} ${p.value}`).join(', ')}; para otro líquido, tu mejor estimación; si no es líquido, null.
"confidence": "alta"|"media"|"baja" según qué tan fundada está tu respuesta. "name" corto en español. "brand" solo si es identificable.`;
}

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mode: { type: 'STRING' },
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
    },
  },
  required: ['mode', 'name'],
};

export async function estimateFood(text, imageFile) {
  const parts = [{ text: text.trim() || 'Analiza la imagen.' }];
  if (imageFile) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(imageFile) } });
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: geminiPrompt() }] },
      contents: [{ parts }],
      generationConfig: { response_mime_type: 'application/json', response_schema: GEMINI_SCHEMA },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const out = JSON.parse(data.candidates[0].content.parts[0].text);
  const micros = {};
  for (const m of MICROS) {
    const v = out.micros?.[m.key];
    if (v != null) micros[m.key] = v;
  }
  return {
    mode: out.mode,
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
  };
}
