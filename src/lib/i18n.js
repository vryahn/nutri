import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// El string en español ES la clave — así una traducción faltante cae al
// español (nunca rompe, nunca muestra "undefined"). Interpolación: la clave
// lleva el marcador literal %n / %s y el caller hace .replace() tras t().
const EN = {
  // Nav (App.jsx)
  Hoy: 'Today',
  Alimentos: 'Foods',
  Recetas: 'Recipes',
  Objetivos: 'Targets',
  Dashboard: 'Dashboard',
  'Más opciones': 'More options',
  Etiquetas: 'Labels',
  'Cerrar sesión': 'Log out',

  // Today.jsx — cabecera y resumen
  'Día anterior': 'Previous day',
  'Día siguiente': 'Next day',
  'Elegir fecha': 'Choose date',
  'Estado actual': 'Current status',
  'Ver objetivos': 'View targets',
  'Ver estado actual': 'View current status',
  Kcal: 'Kcal',
  Prot: 'Prot',
  Carbs: 'Carbs',
  Grasa: 'Fat',
  Sodio: 'Sodium',
  Potasio: 'Potassium',
  'en meta': 'on target',
  'sin meta de kcal': 'no kcal target',
  'al piso': 'to floor',
  piso: 'floor',
  meta: 'target',
  de: 'of',

  // Water card
  Agua: 'Water',
  'Ajustes de agua': 'Water settings',
  'Cantidad (ml)': 'Amount (ml)',
  Añadir: 'Add',
  'Quitar último registro de agua': 'Remove last water entry',
  'Añadir vaso de %n ml': 'Add %n ml glass',
  'Tamaño de vaso (ml)': 'Glass size (ml)',
  Guardar: 'Save',

  // Sodium warning
  '⚠ sodio < %n mg': '⚠ sodium < %n mg',

  // Entry sections / cards
  'Sin etiqueta': 'No label',
  Expandir: 'Expand',
  Contraer: 'Collapse',
  'Añadir a %n': 'Add to %n',
  Editar: 'Edit',
  Borrar: 'Delete',
  'Añadir registro': 'Add entry',
  'Registro borrado': 'Entry deleted',
  Deshacer: 'Undo',
  Cerrar: 'Close',

  // Add/edit entry form
  'Elementos frecuentes': 'Frequent items',
  'Alimento o receta': 'Food or recipe',
  'Buscar…': 'Search…',
  receta: 'recipe',
  Etiqueta: 'Label',
  Cancelar: 'Cancel',
  Registrar: 'Log',
  Aporta: 'Provides',
  'Más micros (%n)': 'More micros (%n)',
  g: 'g',

  // Section menu (Ayer/Copiar/Pegar/Borrar día)
  Ayer: 'Yesterday',
  Copiar: 'Copy',
  'Pegar %n': 'Paste %n',
  'Borrar día': 'Delete day',
  'Día copiado.': 'Day copied.',
  'Ese día no tiene registros.': 'That day has no entries.',
  'Error al copiar.': 'Error copying.',
  '%n registros copiados.': '%n entries copied.',
  'Este día no tiene alimentos.': 'This day has no foods.',
  '¿Borrar los %n registros de alimentos de este día? No se puede deshacer.':
    'Delete the %n food entries for this day? This cannot be undone.',
  'Error al borrar.': 'Error deleting.',
  '%n registros borrados.': '%n entries deleted.',
  'Error al registrar agua.': 'Error logging water.',
  'Alto en sodio': 'High in sodium',
  'Alto en potasio': 'High in potassium',
  G: 'F', // abreviatura de Grasa/Fat en las cards de Hoy

  // MICROS (domain.js) — etiquetas traducidas en el punto de render (t(m.label)),
  // la constante y sus claves de jsonb no se tocan.
  'Grasa sat.': 'Sat. fat',
  'Grasa trans': 'Trans fat',
  Azúcar: 'Sugar',
  'Azúcar añadido': 'Added sugar',
  Fibra: 'Fiber',
  Magnesio: 'Magnesium',
  Calcio: 'Calcium',
  Hierro: 'Iron',
  Alcohol: 'Alcohol',
  Colesterol: 'Cholesterol',
  'Vit. A': 'Vit. A',
  'Vit. C': 'Vit. C',
  'Vit. D': 'Vit. D',
  'Vit. E': 'Vit. E',
  'Vit. K': 'Vit. K',
  'B1 Tiamina': 'B1 Thiamine',
  'B2 Riboflavina': 'B2 Riboflavin',
  'B3 Niacina': 'B3 Niacin',
  'B5 Ác. pantoténico': 'B5 Pantothenic acid',
  B6: 'B6',
  'B7 Biotina': 'B7 Biotin',
  'B9 Folato': 'B9 Folate',
  B12: 'B12',
  Colina: 'Choline',
  Zinc: 'Zinc',
  Fósforo: 'Phosphorus',
  Selenio: 'Selenium',
  Cobre: 'Copper',
  Manganeso: 'Manganese',
  Yodo: 'Iodine',
  Cromo: 'Chromium',
  Molibdeno: 'Molybdenum',
  'β-caroteno': 'β-carotene',
  Licopeno: 'Lycopene',
  'Luteína + Zeaxantina': 'Lutein + Zeaxanthin',

  // Categorías de MICROS (microGroups)
  Lípidos: 'Lipids',
  Carbohidratos: 'Carbohydrates',
  Vitaminas: 'Vitamins',
  Minerales: 'Minerals',
  Antioxidantes: 'Antioxidants',
  Otros: 'Other',
};

const LANG_KEY = 'nutri-lang';
const VALID = ['es', 'en'];

function detect() {
  const raw = localStorage.getItem(LANG_KEY);
  if (VALID.includes(raw)) return raw;
  return navigator.language?.startsWith('es') ? 'es' : 'en';
}

let lang = detect();
let userId = null;
const subs = new Set();

export function getLang() {
  return lang;
}

// patch-merge sobre prefs.data: es un jsonb compartido con otras prefs
// (water_glass_ml, today_view, …), así que un upsert directo con solo
// { lang } las borraría.
async function persistLang(next) {
  if (!userId) return;
  const { data } = await supabase.from('prefs').select('data').maybeSingle();
  await supabase.from('prefs').upsert({ owner: userId, data: { ...(data?.data || {}), lang: next } });
}

export function setLang(next, { persist = true } = {}) {
  if (!VALID.includes(next) || next === lang) return;
  lang = next;
  localStorage.setItem(LANG_KEY, next);
  subs.forEach((fn) => fn(lang));
  if (persist) persistLang(next);
}

// Registra el usuario autenticado (para poder persistir en prefs) y aplica
// prefs.data.lang si difiere de localStorage — gana prefs (cross-device),
// pero sin re-escribirlo (persist:false, ya viene de ahí).
export function registerLangUser(uid, prefLang) {
  userId = uid;
  if (VALID.includes(prefLang) && prefLang !== lang) setLang(prefLang, { persist: false });
}

export function locale() {
  return lang === 'en' ? 'en-US' : 'es-MX';
}

export function t(str) {
  if (lang !== 'en') return str;
  return EN[str] ?? str;
}

export function useLang() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  return lang;
}
