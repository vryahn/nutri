import { useEffect, useState } from 'react';
import {
  ComposedChart,
  AreaChart,
  Area,
  Bar,
  Line,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase.js';
import Hint from '../components/Hint.jsx';
import {
  MICROS,
  MICROS_DEFAULT,
  microGroups,
  todayISO,
  addDaysISO,
  weekdayOf,
  resolveTarget,
  classifyKcal,
  classifyFloor,
  sodiumIsLow,
  SODIUM_FLOOR_MG,
  round,
  sum,
  median,
  quantile,
  stddev,
  cv,
  olsSlope,
  bayesAdherence,
  MIN_DIAS_MEDIANA,
  MIN_DIAS_STDDEV,
  MIN_DIAS_TENDENCIA,
  MIN_DIAS_BAYES,
  STRUCTURAL_ZERO_FRACTION,
  BAYES_KCAL_TOL,
  dayCompleteness,
  targetPhases,
} from '../lib/domain.js';

// Calculo homologado del selector (Parte A). 'suma'/'promedio' siempre
// disponibles con ≥1 día registrado; los avanzados requieren más días.
const CALC_BASIC = [
  { key: 'suma', label: 'Suma' },
  { key: 'promedio', label: 'Promedio' },
];
const CALC_ADVANCED = [
  {
    key: 'mediana',
    label: 'Mediana + IQR',
    desc: 'Tu día típico: la mediana ignora los días atípicos (fiestas, ayunos) que distorsionan el promedio. IQR = P25–P75.',
    minDias: MIN_DIAS_MEDIANA,
  },
  {
    key: 'stddev',
    label: 'Desv. estándar + CV',
    desc: 'Qué tan consistente eres día a día. El CV (%) permite comparar la variabilidad de kcal contra micros de escalas distintas.',
    minDias: MIN_DIAS_STDDEV,
  },
  {
    key: 'tendencia',
    label: 'Tendencia',
    desc: 'Pendiente de regresión lineal simple en unidades/día: ¿tu ingesta sube o baja a lo largo del rango?',
    minDias: MIN_DIAS_TENDENCIA,
  },
  {
    key: 'bayes',
    label: 'Adherencia bayesiana',
    desc: 'Probabilidad de que un día cualquiera cumplas tu objetivo, con intervalo de credibilidad del 95 %. Con pocos días registrados el intervalo es ancho: honesta por diseño.',
    minDias: MIN_DIAS_BAYES,
    needsObjetivo: true,
  },
];
const CALC_ALL = [...CALC_BASIC, ...CALC_ADVANCED];

// Motivo (string) por el que una opción de cálculo está deshabilitada, o null si aplica.
// ctx: { diasRegistrados, diasConObjetivo, diasCompletosFull, diasParcialesFull,
//        diasCompletosPhase, diasParcialesPhase, crossesPhases }
function calcDisabledReason(opt, ctx) {
  if (opt.key === 'suma' || opt.key === 'promedio') {
    return ctx.diasRegistrados >= 1 ? null : 'Sin registros en el rango';
  }
  if (opt.key === 'bayes') {
    if (ctx.diasCompletosFull < opt.minDias) {
      return `Requiere ≥${opt.minDias} días completos (tienes ${ctx.diasCompletosFull} completos y ${ctx.diasParcialesFull} parciales)`;
    }
    if (opt.needsObjetivo && ctx.diasConObjetivo < 1) return 'Requiere objetivos en Metas';
    return null;
  }
  // mediana, stddev, tendencia — inmunes a fases: sobre la fase vigente si el rango cruza >1.
  if (ctx.diasCompletosPhase < opt.minDias) {
    return ctx.crossesPhases
      ? `Requiere ≥${opt.minDias} días completos en la fase actual (tienes ${ctx.diasCompletosPhase})`
      : `Requiere ≥${opt.minDias} días completos (tienes ${ctx.diasCompletosPhase} completos y ${ctx.diasParcialesPhase} parciales)`;
  }
  return null;
}

// Estadísticos de una métrica (macro o micro). Suma/Promedio sobre todos los
// días registrados del rango (semántica sin cambios); mediana/σ/tendencia
// sobre `advancedDays` (días completos, y de la fase vigente si aplica — Fix 5).
function computeMetricStats(registeredDays, advancedDays, key) {
  const xsAll = registeredDays.map((d) => d.values[key]);
  const n = xsAll.length;
  const total = sum(xsAll);

  const advXs = advancedDays.map((d) => d.values[key]);
  const advN = advXs.length;
  const points = advancedDays.map((d) => ({ x: d.dayIndex, y: d.values[key] }));

  return {
    sum: total,
    avg: n ? total / n : 0,
    n,
    median: advN ? median(advXs) : null,
    p25: advN ? quantile(advXs, 0.25) : null,
    p75: advN ? quantile(advXs, 0.75) : null,
    sd: stddev(advXs),
    cv: cv(advXs),
    slope: olsSlope(points),
  };
}

// Objetivo diario resuelto para `key` sobre los días del rango que tienen un
// target con ese valor definido (Fix 1). n=0 ⇒ de verdad no hay objetivo.
function computeObjectiveStats(chartData, key) {
  const withKey = chartData.filter((d) => d.targetMicros != null && d.targetMicros[key] != null);
  const vals = withKey.map((d) => Number(d.targetMicros[key]));
  const n = vals.length;
  return { sum: sum(vals), avg: n ? sum(vals) / n : 0, median: n ? median(vals) : null, n };
}

// Fix 3: ceros estructurales — un 0 exacto casi siempre significa "sin dato
// de este micro en el alimento", no "consumo cero".
function structuralZeroInfo(registeredDays, key) {
  const m = registeredDays.length;
  if (!m) return { warn: false, n: 0, m: 0 };
  const n = registeredDays.filter((d) => Number(d.values[key] || 0) === 0).length;
  return { warn: n / m > STRUCTURAL_ZERO_FRACTION, n, m };
}

// Adherencia bayesiana (Fix 4): kcal con tolerancia BAYES_KCAL_TOL; cualquier
// métrica con objetivo diario resuelto se trata como piso (≥); sodio con su
// piso fijo; carbs/grasa sin criterio direccional. `days` ya viene filtrado a
// días completos (no llama a `registrado`/completitud aquí).
function bayesForMetric(days, key) {
  let applicable;
  if (key === 'kcal') {
    const withTarget = days.filter((d) => d.targetKcal != null);
    if (!withTarget.length) return null;
    applicable = withTarget.map((d) => Math.abs(d.values.kcal - d.targetKcal) / d.targetKcal <= BAYES_KCAL_TOL);
  } else if (key === 'carbs_g' || key === 'fat_g') {
    return null;
  } else if (key === 'protein_g') {
    const withTarget = days.filter((d) => d.proteinFloor != null);
    if (!withTarget.length) return null;
    applicable = withTarget.map((d) => d.values.protein_g >= d.proteinFloor);
  } else if (key === 'sodio_mg') {
    if (!days.length) return null;
    applicable = days.map((d) => d.values.sodio_mg >= SODIUM_FLOOR_MG);
  } else {
    const withTarget = days.filter((d) => d.targetMicros != null && d.targetMicros[key] != null);
    if (!withTarget.length) return null;
    applicable = withTarget.map((d) => Number(d.values[key] || 0) >= Number(d.targetMicros[key]));
  }
  return bayesAdherence(applicable.filter(Boolean).length, applicable.length);
}

// Motivo por el que bayesForMetric devolvió null, para el Hint de la celda.
function bayesUnavailableReason(days, key) {
  if (key === 'carbs_g' || key === 'fat_g') return 'Sin criterio de adherencia definido para esta métrica';
  if (!days.length) return 'Sin registros en el rango';
  if (key === 'kcal') return days.some((d) => d.targetKcal != null) ? null : 'Sin objetivo para este nutriente — regístralo en Metas';
  if (key === 'protein_g') return days.some((d) => d.proteinFloor != null) ? null : 'Sin objetivo para este nutriente — regístralo en Metas';
  if (key === 'sodio_mg') return null;
  return days.some((d) => d.targetMicros?.[key] != null) ? null : 'Sin objetivo para este nutriente — regístralo en Metas';
}

// { text, hint } de la celda de adherencia bayesiana para una métrica.
function bayesCell(days, key) {
  const b = bayesForMetric(days, key);
  if (b) return { text: `${round(b.mean * 100, 0)}% (${round(b.lower * 100, 0)}–${round(b.upper * 100, 0)}%)`, hint: null };
  const reason = bayesUnavailableReason(days, key);
  const text = reason.startsWith('Sin criterio') ? 'Sin criterio' : reason.startsWith('Sin objetivo') ? 'Sin objetivo' : '–';
  return { text, hint: reason };
}

// Formatea el valor de una métrica según el cálculo elegido. unit incluye el
// espacio inicial (ej. ' mg') o '' si no aplica.
function formatMetric(calcMode, ms, unit, decimals) {
  switch (calcMode) {
    case 'suma':
      return `${round(ms.sum, decimals)}${unit}`;
    case 'promedio':
      return `${round(ms.avg, decimals)}${unit}`;
    case 'mediana':
      return ms.median == null ? '–' : `${round(ms.median, decimals)} (${round(ms.p25, decimals)}–${round(ms.p75, decimals)})${unit}`;
    case 'stddev':
      return ms.sd == null ? '–' : `${round(ms.sd, decimals)}${unit} (CV ${ms.cv == null ? '–' : round(ms.cv, 0) + '%'})`;
    case 'tendencia':
      return ms.slope == null ? '–' : `${ms.slope >= 0 ? '+' : ''}${round(ms.slope, decimals)}${unit}/día`;
    default:
      return '';
  }
}

// Valor mostrado para una métrica: en modo bayes usa la celda de adherencia
// (con su Hint si está degradada), en el resto delega en formatMetric.
function metricDisplay(calcMode, ms, bayesInfo, unit, decimals) {
  if (calcMode === 'bayes') {
    if (!bayesInfo) return '–';
    return bayesInfo.hint ? <Hint text={bayesInfo.hint}>{bayesInfo.text}</Hint> : bayesInfo.text;
  }
  return formatMetric(calcMode, ms, unit, decimals);
}

// Objetivo mostrado en la tabla de micros, según el modo (Fix 1).
function objetivoCell(calcMode, objStats, unit) {
  if (objStats.n === 0) {
    return <Hint text="Sin objetivo para este nutriente — regístralo en Metas">Sin objetivo</Hint>;
  }
  if (calcMode === 'stddev' || calcMode === 'tendencia') return '–';
  if (calcMode === 'suma') return `${round(objStats.sum, 1)} ${unit}`;
  if (calcMode === 'promedio' || calcMode === 'bayes') return `${round(objStats.avg, 1)} ${unit}`;
  if (calcMode === 'mediana') return objStats.median != null ? `${round(objStats.median, 1)} ${unit}` : '–';
  return '–';
}

// % mostrado en la tabla de micros, según el modo (Fix 1). Bayes ya ES un %.
function pctCell(calcMode, ms, objStats) {
  if (calcMode === 'suma') return objStats.n && objStats.sum > 0 ? `${Math.round((ms.sum / objStats.sum) * 100)}%` : '–';
  if (calcMode === 'promedio') return objStats.n && objStats.avg > 0 ? `${Math.round((ms.avg / objStats.avg) * 100)}%` : '–';
  if (calcMode === 'mediana') return objStats.median > 0 && ms.median != null ? `${Math.round((ms.median / objStats.median) * 100)}%` : '–';
  return '–';
}

const CALC_TITLES = {
  suma: 'Suma del rango',
  promedio: 'Promedio diario (÷ días registrados)',
  mediana: 'Mediana (P25–P75)',
  stddev: 'Desviación estándar (CV)',
  tendencia: 'Tendencia (unidades/día)',
  bayes: 'Adherencia bayesiana (IC 95%)',
};
const CALC_HEADERS = {
  suma: 'Suma',
  promedio: 'Promedio',
  mediana: 'Mediana (IQR)',
  stddev: 'σ (CV%)',
  tendencia: 'Tendencia',
  bayes: 'Adherencia',
};

const PRESETS = [
  { key: 'hoy', label: 'Hoy', days: 1 },
  { key: 'semana', label: 'Semana', days: 7 },
  { key: 'mes', label: 'Mes', days: 30 },
  { key: 'trimestre', label: 'Trimestre', days: 90 },
  { key: 'año', label: 'Año', days: 365 },
];

const STATUS_BG = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' };
const DOW_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function datesInRange(start, end) {
  const dates = [];
  let d = start;
  while (d <= end) {
    dates.push(d);
    d = addDaysISO(d, 1);
  }
  return dates;
}

// Rango previo de igual longitud, inmediatamente anterior a [start, end].
function prevRangeOf(start, end) {
  const length = datesInRange(start, end).length;
  const prevEnd = addDaysISO(start, -1);
  const prevStart = addDaysISO(prevEnd, -(length - 1));
  return { prevStart, prevEnd };
}

// Claves de micros a 0 por defecto (un micro ausente del jsonb pesa 0);
// agua_ml se excluye porque tiene su propia sección y no entra al selector.
const MICROS_ZERO = Object.fromEntries(MICROS.filter((m) => m.key !== 'agua_ml').map((m) => [m.key, 0]));

// Totales/promedios/serie diaria para un rango. Pura: se usa dos veces
// (rango actual y rango previo para las deltas de las KPI).
function computeStats(dates, dailyTotals, targets) {
  const byDay = new Map(dailyTotals.map((d) => [d.day, d]));
  const consumido = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const objetivo = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  const microsConsumido = {};
  const microsObjetivo = {};
  let diasRegistrados = 0;
  let sodioTotal = 0;

  const chartData = dates.map((day, dayIndex) => {
    const row = byDay.get(day);
    const target = resolveTarget(targets, day);
    const kcal = Number(row?.kcal || 0);
    const registrado = kcal > 0;
    if (registrado) diasRegistrados++;

    consumido.kcal += kcal;
    consumido.protein_g += Number(row?.protein_g || 0);
    consumido.carbs_g += Number(row?.carbs_g || 0);
    consumido.fat_g += Number(row?.fat_g || 0);
    const sodio = Number(row?.micros?.sodio_mg || 0);
    sodioTotal += sodio;

    for (const [k, v] of Object.entries(row?.micros || {})) {
      microsConsumido[k] = (microsConsumido[k] || 0) + Number(v);
    }
    if (target) {
      objetivo.kcal += Number(target.kcal || 0);
      objetivo.protein_g += Number(target.protein_g || 0);
      objetivo.carbs_g += Number(target.carbs_g || 0);
      objetivo.fat_g += Number(target.fat_g || 0);
      for (const [k, v] of Object.entries(target.micros || {})) {
        microsObjetivo[k] = (microsObjetivo[k] || 0) + Number(v);
      }
    }

    const protein_g = Number(row?.protein_g || 0);
    const carbs_g = Number(row?.carbs_g || 0);
    const fat_g = Number(row?.fat_g || 0);

    return {
      day,
      dayIndex,
      label: day.slice(5),
      kcal: registrado ? kcal : null,
      targetKcal: target?.kcal ?? null,
      targetMicros: target?.micros ?? null,
      protein: registrado ? protein_g : null,
      proteinFloor: target?.protein_g ?? null,
      sodio: registrado ? sodio : null,
      registrado,
      // Serie plana por métrica (macros + micros), para los cálculos avanzados
      // del selector (Parte A). null si el día no tiene registro.
      values: registrado ? { kcal, protein_g, carbs_g, fat_g, ...MICROS_ZERO, ...(row?.micros || {}) } : null,
    };
  });

  const promedio = {
    kcal: diasRegistrados ? consumido.kcal / diasRegistrados : 0,
    protein_g: diasRegistrados ? consumido.protein_g / diasRegistrados : 0,
    carbs_g: diasRegistrados ? consumido.carbs_g / diasRegistrados : 0,
    fat_g: diasRegistrados ? consumido.fat_g / diasRegistrados : 0,
  };
  const avgSodio = diasRegistrados ? sodioTotal / diasRegistrados : 0;

  return { consumido, objetivo, microsConsumido, microsObjetivo, diasRegistrados, avgSodio, promedio, chartData };
}

// MA-7: ventana de 7 días calendario, promediada solo entre los días con
// registro dentro de esa ventana (los sin registro no cuentan ni como 0).
function withMovingAverage(chartData) {
  return chartData.map((d, i) => {
    const windowSlice = chartData.slice(Math.max(0, i - 6), i + 1);
    const registrados = windowSlice.filter((w) => w.kcal != null);
    const ma7 = registrados.length ? registrados.reduce((s, w) => s + w.kcal, 0) / registrados.length : null;
    return { ...d, ma7 };
  });
}

// Semanas lun–dom que cubren [start, end] (puede sobresalir por ambos lados).
function buildWeeks(start, end) {
  const startDow = weekdayOf(start); // 0=domingo..6=sábado
  const offset = startDow === 0 ? 6 : startDow - 1;
  let cursor = addDaysISO(start, -offset);
  const weeks = [];
  while (cursor <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = addDaysISO(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function weeklyProteinData(weeks, start, end, dayInfo) {
  return weeks.map((week, i) => {
    let sum = 0, count = 0, floorSum = 0, floorCount = 0;
    for (const d of week) {
      if (d < start || d > end) continue;
      const info = dayInfo.get(d);
      if (info?.registrado) {
        sum += info.protein;
        count++;
      }
      if (info?.proteinFloor != null) {
        floorSum += info.proteinFloor;
        floorCount++;
      }
    }
    return {
      week: `S${i + 1}`,
      protein: count ? sum / count : null,
      floor: floorCount ? floorSum / floorCount : null,
    };
  });
}

function topItems(rows, waterFoodId, metric) {
  const map = new Map();
  for (const r of rows) {
    if (r.food_id && r.food_id === waterFoodId) continue;
    const key = r.food_id || r.recipe_id;
    if (!key) continue;
    const cur = map.get(key) || { name: r.item, kcal: 0, protein_g: 0 };
    cur.kcal += Number(r.kcal || 0);
    cur.protein_g += Number(r.protein_g || 0);
    map.set(key, cur);
  }
  return [...map.values()]
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, 8);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pctDelta(curr, prev) {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

export default function Dashboard() {
  const [preset, setPreset] = useState('semana');
  const [customStart, setCustomStart] = useState(addDaysISO(todayISO(), -6));
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [dailyTotals, setDailyTotals] = useState([]);
  const [prevDailyTotals, setPrevDailyTotals] = useState([]);
  const [historyTotals, setHistoryTotals] = useState([]); // daily_totals(day,kcal) últimos 90 días, para completitud
  const [targets, setTargets] = useState([]);
  const [favs, setFavs] = useState([]); // prefs.data.fav_micros
  const [waterFoodId, setWaterFoodId] = useState(null);
  const [itemRows, setItemRows] = useState([]); // entry_nutrients del rango, para "Top alimentos"
  const [topMetric, setTopMetric] = useState('kcal');
  const [csvNotice, setCsvNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [calcMode, setCalcMode] = useState('promedio');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const today = todayISO();
  const presetDef = PRESETS.find((p) => p.key === preset);
  const start = preset === 'custom' ? customStart : addDaysISO(today, -(presetDef.days - 1));
  const end = preset === 'custom' ? customEnd : today;

  useEffect(() => {
    load();
  }, [start, end]);

  async function load() {
    setLoading(true);
    setCsvNotice('');
    const { prevStart, prevEnd } = prevRangeOf(start, end);
    const historyStart = addDaysISO(todayISO(), -89);
    const [{ data: dt }, { data: prevDt }, { data: hist }, { data: tg }, { data: pf }, { data: items }] = await Promise.all([
      supabase.from('daily_totals').select('*').gte('day', start).lte('day', end),
      supabase.from('daily_totals').select('*').gte('day', prevStart).lte('day', prevEnd),
      supabase.from('daily_totals').select('day,kcal').gte('day', historyStart).lte('day', todayISO()),
      supabase.from('targets').select('*'),
      supabase.from('prefs').select('data').maybeSingle(),
      supabase.from('entry_nutrients').select('day,meal,food_id,recipe_id,item,kcal,protein_g').gte('day', start).lte('day', end),
    ]);
    setDailyTotals(dt || []);
    setPrevDailyTotals(prevDt || []);
    setHistoryTotals(hist || []);
    setTargets(tg || []);
    setFavs(pf?.data?.fav_micros || []);
    setWaterFoodId(pf?.data?.water_food_id || null);
    setItemRows(items || []);
    setLoading(false);
  }

  async function exportCSV() {
    setCsvNotice('');
    const { data: rows } = await supabase
      .from('entry_nutrients')
      .select('day,meal,item,food_id,recipe_id,grams,kcal,protein_g,carbs_g,fat_g,micros')
      .gte('day', start)
      .lte('day', end)
      .order('day');
    if (!rows || rows.length === 0) {
      setCsvNotice('Sin registros en el rango');
      return;
    }
    const header = ['day', 'meal_label', 'tipo', 'item', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', ...MICROS.map((m) => m.key)];
    const lines = [header.join(',')];
    for (const r of rows) {
      const cells = [
        r.day,
        r.meal || 'Sin etiqueta',
        r.food_id ? 'food' : 'recipe',
        r.item,
        r.grams,
        r.kcal,
        r.protein_g,
        r.carbs_g,
        r.fat_g,
        ...MICROS.map((m) => r.micros?.[m.key] ?? ''),
      ];
      lines.push(cells.map(csvCell).join(','));
    }
    const csv = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nutri_entries_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const dates = datesInRange(start, end);
  const stats = computeStats(dates, dailyTotals, targets);
  const diasConObjetivo = dates.filter((d) => resolveTarget(targets, d)).length;

  // Completitud de día inferida (tri-estado, al vuelo): etiquetas distintas
  // por día (para el atracón único) y mediana de kcal de los últimos 90 días
  // (umbral robusto personal).
  const mealsCountByDay = new Map();
  for (const r of itemRows) {
    const s = mealsCountByDay.get(r.day) || new Set();
    s.add(r.meal || 'Sin etiqueta');
    mealsCountByDay.set(r.day, s);
  }
  const registradosBase = stats.chartData.filter((d) => d.registrado);
  const mealsCounts = registradosBase.map((d) => mealsCountByDay.get(d.day)?.size || 0);
  const typicalMeals = mealsCounts.length ? median(mealsCounts) : 0;
  const historyKcals = historyTotals.map((h) => Number(h.kcal || 0));
  const chartData = stats.chartData.map((d) => ({
    ...d,
    completeness: dayCompleteness({
      kcal: d.kcal ?? 0,
      targetKcal: d.targetKcal,
      historyKcals,
      mealsCount: mealsCountByDay.get(d.day)?.size || 0,
      typicalMeals,
    }),
  }));

  // Fases de objetivo (Fix 5): si el rango cruza >1 fase, los cálculos
  // avanzados (mediana/σ/tendencia, NO bayes) se restringen a la fase vigente.
  const phaseSegments = targetPhases(targets, dates);
  const realPhases = phaseSegments.filter((p) => p.vf != null);
  const crossesPhases = realPhases.length > 1;
  const activePhaseDays = crossesPhases ? new Set(realPhases[realPhases.length - 1].days) : null;

  const registeredDays = chartData.filter((d) => d.registrado);
  const completeDaysFull = registeredDays.filter((d) => d.completeness !== 'parcial');
  const advancedDays = completeDaysFull.filter((d) => !activePhaseDays || activePhaseDays.has(d.day));
  const diasParcialesFull = registeredDays.length - completeDaysFull.length;
  const diasParcialesPhase = activePhaseDays
    ? registeredDays.filter((d) => activePhaseDays.has(d.day) && d.completeness === 'parcial').length
    : diasParcialesFull;

  const calcCtx = {
    diasRegistrados: stats.diasRegistrados,
    diasConObjetivo,
    diasCompletosFull: completeDaysFull.length,
    diasParcialesFull,
    diasCompletosPhase: advancedDays.length,
    diasParcialesPhase,
    crossesPhases,
  };

  // Si el cálculo activo deja de cumplir su mínimo al cambiar de rango, cae
  // automáticamente a Promedio (o Suma si tampoco cumple). Se ignora mientras
  // carga (dailyTotals aún vacío) para no confundir "sin datos todavía" con
  // "rango sin registros".
  useEffect(() => {
    if (loading) return;
    const opt = CALC_ALL.find((o) => o.key === calcMode);
    if (calcDisabledReason(opt, calcCtx)) {
      setCalcMode(calcDisabledReason(CALC_BASIC[1], calcCtx) ? 'suma' : 'promedio');
    }
  }, [loading, calcMode, calcCtx.diasRegistrados, calcCtx.diasConObjetivo, calcCtx.diasCompletosFull, calcCtx.diasCompletosPhase]);

  if (loading) return <div className="px-4 py-4 text-text-2">Cargando…</div>;

  const { prevStart, prevEnd } = prevRangeOf(start, end);
  const prevStats = computeStats(datesInRange(prevStart, prevEnd), prevDailyTotals, targets);
  const showDelta = prevStats.diasRegistrados >= 1 && (calcMode === 'suma' || calcMode === 'promedio');

  const kcalChart = withMovingAverage(chartData);
  const dayInfo = new Map(chartData.map((d) => [d.day, d]));
  const weeks = buildWeeks(start, end);
  const proteinWeekly = weeklyProteinData(weeks, start, end, dayInfo);
  const top = topItems(itemRows, waterFoodId, topMetric);
  const maxTop = top.length ? top[0][topMetric] : 0;

  const msKcal = computeMetricStats(registeredDays, advancedDays, 'kcal');
  const msProtein = computeMetricStats(registeredDays, advancedDays, 'protein_g');
  const msCarbs = computeMetricStats(registeredDays, advancedDays, 'carbs_g');
  const msFat = computeMetricStats(registeredDays, advancedDays, 'fat_g');
  const msSodio = computeMetricStats(registeredDays, advancedDays, 'sodio_mg');
  const bKcal = calcMode === 'bayes' ? bayesCell(completeDaysFull, 'kcal') : null;
  const bProtein = calcMode === 'bayes' ? bayesCell(completeDaysFull, 'protein_g') : null;
  const bCarbs = calcMode === 'bayes' ? bayesCell(completeDaysFull, 'carbs_g') : null;
  const bFat = calcMode === 'bayes' ? bayesCell(completeDaysFull, 'fat_g') : null;
  const bSodio = calcMode === 'bayes' ? bayesCell(completeDaysFull, 'sodio_mg') : null;
  const phaseHintText = crossesPhases
    ? `El rango cruza ${realPhases.length} fases de objetivo; calculado sobre la fase actual (${advancedDays.length} días) para no mezclar regímenes`
    : null;
  const isPhaseScopedMode = calcMode === 'mediana' || calcMode === 'stddev' || calcMode === 'tendencia';

  // Streamgraph de macros (kcal por macro, por día); fallback de barra 100%
  // apilada cuando el rango tiene <3 días con registro.
  const macroStreamData = chartData.map((d) => ({
    label: d.label,
    prot: d.values ? d.values.protein_g * 4 : 0,
    carb: d.values ? d.values.carbs_g * 4 : 0,
    fat: d.values ? d.values.fat_g * 9 : 0,
  }));
  const macroTotalKcal = stats.consumido.protein_g * 4 + stats.consumido.carbs_g * 4 + stats.consumido.fat_g * 9;

  // Radar "huella nutricional": micros de MICROS_DEFAULT con objetivo > 0,
  // % del objetivo según Suma-vs-objetivo del rango (fijo, no cambia con el selector).
  const radarData = MICROS.slice(0, MICROS_DEFAULT)
    .filter((m) => m.key !== 'agua_ml' && stats.microsObjetivo[m.key] > 0)
    .map((m) => ({
      label: m.label,
      value: Math.min(150, ((stats.microsConsumido[m.key] || 0) / stats.microsObjetivo[m.key]) * 100),
    }));

  const sodioVals = chartData.map((d) => d.sodio).filter((v) => v != null);
  const sodioMax = sodioVals.length ? Math.max(...sodioVals, SODIUM_FLOOR_MG) : SODIUM_FLOOR_MG + 1;
  const sodioMin = sodioVals.length ? Math.min(...sodioVals, SODIUM_FLOOR_MG) : 0;
  const sodioOffset = sodioMax > sodioMin ? Math.min(1, Math.max(0, (sodioMax - SODIUM_FLOOR_MG) / (sodioMax - sodioMin))) : 0.5;

  const targetDays = chartData.filter((d) => d.targetKcal != null);
  const avgTargetKcal = targetDays.length ? targetDays.reduce((s, d) => s + d.targetKcal, 0) / targetDays.length : null;

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl">Dashboard</h1>
        <button
          onClick={exportCSV}
          className="px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap bg-surface-2 border border-border text-text-2 active:scale-[0.98] transition-transform duration-150"
        >
          Exportar CSV
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-3 py-2 rounded-full text-sm whitespace-nowrap active:scale-[0.98] transition-transform duration-150 ${
              preset === p.key ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPreset('custom')}
          className={`px-3 py-2 rounded-full text-sm whitespace-nowrap active:scale-[0.98] transition-transform duration-150 ${
            preset === 'custom' ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
          }`}
        >
          Custom
        </button>
      </div>

      {preset === 'custom' && (
        <div className="flex gap-2">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="flex-1 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="flex-1 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {CALC_BASIC.map((opt) => {
          const reason = calcDisabledReason(opt, calcCtx);
          return (
            <button
              key={opt.key}
              disabled={!!reason}
              onClick={() => setCalcMode(opt.key)}
              title={reason || ''}
              className={`px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap active:scale-[0.98] transition-transform duration-150 ${
                reason
                  ? 'bg-surface-2 text-text-3 opacity-50 cursor-not-allowed'
                  : calcMode === opt.key
                    ? 'bg-accent text-bg font-medium'
                    : 'bg-surface-2 text-text-2 border border-border'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className={`px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap active:scale-[0.98] transition-transform duration-150 ${
            CALC_ADVANCED.some((o) => o.key === calcMode) ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
          }`}
        >
          Avanzadas {advancedOpen ? '▴' : '▾'}
        </button>
      </div>

      {advancedOpen && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {CALC_ADVANCED.map((opt) => {
            const reason = calcDisabledReason(opt, calcCtx);
            return (
              <button
                key={opt.key}
                disabled={!!reason}
                onClick={() => setCalcMode(opt.key)}
                className={`text-left rounded-2xl border p-3 min-h-[44px] transition-transform duration-150 ${
                  reason
                    ? 'bg-surface-2 border-border opacity-50 cursor-not-allowed'
                    : calcMode === opt.key
                      ? 'bg-surface-3 border-accent active:scale-[0.98]'
                      : 'bg-surface border-border active:scale-[0.98]'
                }`}
              >
                <p className="text-sm font-medium">{opt.label}</p>
                <p className={`text-xs mt-1 ${reason ? 'text-text-3' : 'text-text-2'}`}>{reason || opt.desc}</p>
              </button>
            );
          })}
        </div>
      )}

      {csvNotice && <p className="text-sm text-warn">{csvNotice}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 grid-flow-dense">
        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <div className="flex justify-between items-baseline mb-2">
            <p className="text-sm text-text-3">Agua</p>
            <p className="font-mono tabular-nums text-sm text-d-carb">
              {Math.round(stats.microsConsumido.agua_ml || 0)}
              {stats.microsObjetivo.agua_ml > 0 ? ` / ${Math.round(stats.microsObjetivo.agua_ml)}` : ''} ml
            </p>
          </div>
          {stats.microsObjetivo.agua_ml > 0 && (
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full bg-d-carb rounded-full"
                style={{ width: `${Math.min(100, ((stats.microsConsumido.agua_ml || 0) / stats.microsObjetivo.agua_ml) * 100)}%` }}
              />
            </div>
          )}
        </section>

        <section className="md:col-span-2 lg:col-span-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Kcal"
            display={metricDisplay(calcMode, msKcal, bKcal, '', 1)}
            delta={showDelta ? pctDelta(stats.promedio.kcal, prevStats.promedio.kcal) : null}
            status={classifyKcal(stats.consumido.kcal, stats.objetivo.kcal)}
            sparkline={chartData.map((d) => d.kcal)}
            sparkColor="var(--d-kcal)"
          />
          <KpiCard
            label="Proteína"
            display={metricDisplay(calcMode, msProtein, bProtein, ' g', 1)}
            delta={showDelta ? pctDelta(stats.promedio.protein_g, prevStats.promedio.protein_g) : null}
            status={classifyFloor(stats.consumido.protein_g, stats.objetivo.protein_g)}
            sparkline={chartData.map((d) => d.protein)}
            sparkColor="var(--d-prot)"
          />
          <KpiCard
            label="Carbs"
            display={metricDisplay(calcMode, msCarbs, bCarbs, ' g', 1)}
            delta={showDelta ? pctDelta(stats.promedio.carbs_g, prevStats.promedio.carbs_g) : null}
            sparkline={chartData.map((d) => (d.values ? d.values.carbs_g : null))}
            sparkColor="var(--d-carb)"
          />
          <KpiCard
            label="Grasa"
            display={metricDisplay(calcMode, msFat, bFat, ' g', 1)}
            delta={showDelta ? pctDelta(stats.promedio.fat_g, prevStats.promedio.fat_g) : null}
            sparkline={chartData.map((d) => (d.values ? d.values.fat_g : null))}
            sparkColor="var(--d-fat)"
          />
          <KpiCard
            label="Sodio"
            display={metricDisplay(calcMode, msSodio, bSodio, ' mg', 0)}
            delta={showDelta ? pctDelta(stats.avgSodio, prevStats.avgSodio) : null}
            status={sodiumIsLow(stats.avgSodio, stats.diasRegistrados > 0) ? 'danger' : null}
            sparkline={chartData.map((d) => d.sodio)}
            sparkColor="var(--d-carb)"
          />
          <KpiCard
            label="Días"
            display={
              <Hint
                text={`${calcCtx.diasCompletosFull} completos, ${diasParcialesFull} parciales (registro incompleto inferido), ${dates.length} días en el rango`}
              >
                {calcCtx.diasCompletosFull}
                {diasParcialesFull > 0 ? ` +${diasParcialesFull}p` : ''}
              </Hint>
            }
            delta={showDelta ? pctDelta(stats.diasRegistrados, prevStats.diasRegistrados) : null}
            suffix={` / ${dates.length}`}
          />
        </section>

        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2 flex items-center gap-1">
            {CALC_TITLES[calcMode]}
            {isPhaseScopedMode && phaseHintText && <Hint text={phaseHintText}>ⓘ</Hint>}
          </p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Kcal" display={metricDisplay(calcMode, msKcal, bKcal, '', 1)} color="text-d-kcal" />
            <Stat label="Prot" display={metricDisplay(calcMode, msProtein, bProtein, ' g', 1)} color="text-d-prot" />
            <Stat label="Carbs" display={metricDisplay(calcMode, msCarbs, bCarbs, ' g', 1)} color="text-d-carb" />
            <Stat label="Grasa" display={metricDisplay(calcMode, msFat, bFat, ' g', 1)} color="text-d-fat" />
          </div>
        </section>

        <section className="lg:col-span-8 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Kcal por día</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={kcalChart}>
              <defs>
                <linearGradient id="kcalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--d-kcal)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--d-kcal)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={32} />
              <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3)' }} />
              {avgTargetKcal != null && (
                <ReferenceArea y1={avgTargetKcal * 0.9} y2={avgTargetKcal * 1.1} fill="var(--accent)" fillOpacity={0.08} strokeOpacity={0} />
              )}
              <Area type="monotone" dataKey="kcal" name="Kcal" stroke="var(--d-kcal)" strokeWidth={2} fill="url(#kcalGrad)" isAnimationActive={!reducedMotion} />
              {stats.objetivo.kcal > 0 && (
                <Line dataKey="targetKcal" name="Objetivo" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
              )}
              <Line dataKey="ma7" name="MA-7" stroke="var(--d-carb)" strokeDasharray="4 3" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section className="lg:col-span-4 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Distribución de macros (kcal)</p>
          {macroTotalKcal <= 0 ? (
            <p className="text-sm text-text-2 py-8 text-center">Sin registros en el rango</p>
          ) : stats.diasRegistrados >= 3 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={macroStreamData} stackOffset="silhouette">
                <defs>
                  <linearGradient id="protGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--d-prot)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--d-prot)" stopOpacity={0.1} />
                  </linearGradient>
                  <linearGradient id="carbGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--d-carb)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--d-carb)" stopOpacity={0.1} />
                  </linearGradient>
                  <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--d-fat)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--d-fat)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                <Area type="monotone" dataKey="prot" name="Proteína" stackId="1" stroke="var(--d-prot)" fill="url(#protGrad)" isAnimationActive={!reducedMotion} />
                <Area type="monotone" dataKey="carb" name="Carbs" stackId="1" stroke="var(--d-carb)" fill="url(#carbGrad)" isAnimationActive={!reducedMotion} />
                <Area type="monotone" dataKey="fat" name="Grasa" stackId="1" stroke="var(--d-fat)" fill="url(#fatGrad)" isAnimationActive={!reducedMotion} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col gap-2 py-4">
              <div className="h-4 rounded-full overflow-hidden flex">
                <div className="h-full bg-d-prot" style={{ width: `${(stats.consumido.protein_g * 4 * 100) / macroTotalKcal}%` }} />
                <div className="h-full bg-d-carb" style={{ width: `${(stats.consumido.carbs_g * 4 * 100) / macroTotalKcal}%` }} />
                <div className="h-full bg-d-fat" style={{ width: `${(stats.consumido.fat_g * 9 * 100) / macroTotalKcal}%` }} />
              </div>
              <div className="flex justify-between text-xs text-text-2">
                <span className="text-d-prot">Prot {Math.round((stats.consumido.protein_g * 4 * 100) / macroTotalKcal)}%</span>
                <span className="text-d-carb">Carbs {Math.round((stats.consumido.carbs_g * 4 * 100) / macroTotalKcal)}%</span>
                <span className="text-d-fat">Grasa {Math.round((stats.consumido.fat_g * 9 * 100) / macroTotalKcal)}%</span>
              </div>
            </div>
          )}
        </section>

        <section className={`${dates.length > 7 ? 'lg:col-span-6' : 'lg:col-span-12'} rounded-2xl bg-surface border border-border p-4`}>
          <p className="text-sm text-text-3 mb-3">Huella nutricional (micros vs. objetivo)</p>
          {radarData.length === 0 ? (
            <p className="text-sm text-text-2 py-8 text-center">Registra objetivos de micros en Metas</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 150]} tick={false} axisLine={false} />
                <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.35} isAnimationActive={!reducedMotion} />
                <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </section>

        {dates.length > 7 && (
          <section className="lg:col-span-6 rounded-2xl bg-surface border border-border p-4">
            <p className="text-sm text-text-3 mb-3">Adherencia (kcal por día)</p>
            <AdherenceHeatmap weeks={weeks} start={start} end={end} dayInfo={dayInfo} />
          </section>
        )}

        <section className="lg:col-span-6 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Proteína semanal vs piso</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={proteinWeekly}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={32} />
              <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <Bar dataKey="protein" name="Proteína" radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion}>
                {proteinWeekly.map((w, i) => (
                  <Cell key={i} fill={`var(--${classifyFloor(w.protein, w.floor) || 'd-prot'})`} />
                ))}
              </Bar>
              <Line dataKey="floor" name="Piso" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section className="lg:col-span-6 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Sodio diario vs piso</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id="sodioGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={0} stopColor="var(--d-carb)" stopOpacity={0.45} />
                  <stop offset={sodioOffset} stopColor="var(--d-carb)" stopOpacity={0.45} />
                  <stop offset={sodioOffset} stopColor="var(--danger)" stopOpacity={0.45} />
                  <stop offset={1} stopColor="var(--danger)" stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={40} />
              <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <ReferenceLine y={SODIUM_FLOOR_MG} stroke="var(--danger)" strokeDasharray="4 3" />
              <Area
                type="monotone"
                dataKey="sodio"
                name="Sodio"
                stroke="var(--d-carb)"
                strokeWidth={2}
                fill="url(#sodioGrad)"
                dot={(props) => {
                  const { cx, cy, payload, index } = props;
                  if (payload.sodio == null) return <g key={`dot-${index}`} />;
                  const danger = payload.sodio < SODIUM_FLOOR_MG;
                  return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={danger ? 'var(--danger)' : 'var(--d-carb)'} />;
                }}
                isAnimationActive={!reducedMotion}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-text-3">Top alimentos</p>
            <div className="flex gap-1">
              <button
                onClick={() => setTopMetric('kcal')}
                className={`px-2 py-1 min-h-[32px] rounded-full text-xs ${topMetric === 'kcal' ? 'bg-accent text-bg' : 'bg-surface-2 text-text-2'}`}
              >
                Kcal
              </button>
              <button
                onClick={() => setTopMetric('protein_g')}
                className={`px-2 py-1 min-h-[32px] rounded-full text-xs ${topMetric === 'protein_g' ? 'bg-accent text-bg' : 'bg-surface-2 text-text-2'}`}
              >
                Proteína
              </button>
            </div>
          </div>
          {top.length === 0 ? (
            <p className="text-sm text-text-2">Sin registros en el rango</p>
          ) : (
            <div className="flex flex-col gap-2">
              {top.map((it) => (
                <div key={it.name} className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <span className="truncate">{it.name}</span>
                    <span className="font-mono tabular-nums text-text-2 shrink-0 ml-2">
                      {Math.round(it[topMetric] * 10) / 10}
                      {topMetric === 'protein_g' ? ' g' : ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${maxTop > 0 ? (it[topMetric] / maxTop) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="md:col-span-2 lg:col-span-12">
          <MicrosTable
            favs={favs}
            microsConsumido={stats.microsConsumido}
            microsObjetivo={stats.microsObjetivo}
            avgSodio={stats.avgSodio}
            diasRegistrados={stats.diasRegistrados}
            chartData={chartData}
            registeredDays={registeredDays}
            advancedDays={advancedDays}
            completeDaysFull={completeDaysFull}
            calcMode={calcMode}
            phaseHintText={isPhaseScopedMode ? phaseHintText : null}
          />
        </div>
      </div>
    </div>
  );
}

function AdherenceHeatmap({ weeks, start, end, dayInfo }) {
  return (
    <div className="flex gap-1 overflow-x-auto">
      <div className="grid grid-rows-7 gap-1 text-[10px] text-text-3 pr-1">
        {DOW_SHORT.map((d, i) => (
          <div key={i} className="h-3.5 flex items-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-1">
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => {
            const outOfRange = day < start || day > end;
            if (outOfRange) return <div key={`${wi}-${di}`} className="w-3.5 h-3.5" />;
            const info = dayInfo.get(day);
            let cls = 'bg-surface-2';
            if (info?.registrado) {
              const status = classifyKcal(info.kcal, info.targetKcal);
              cls = status ? STATUS_BG[status] : 'bg-surface-3';
            }
            const parcial = info?.completeness === 'parcial';
            const parcialSuffix = parcial ? ' (parcial: registro incompleto inferido)' : '';
            return (
              <div
                key={`${wi}-${di}`}
                title={`${day}: ${info?.kcal != null ? Math.round(info.kcal) : 0} kcal${parcialSuffix}`}
                className={`w-3.5 h-3.5 rounded ${cls} ${parcial ? 'opacity-50' : ''}`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// Visibles: los MICROS_DEFAULT primeros + favoritos (prefs). El resto solo si
// tienen dato consumido u objetivo, plegados en "Más micros". El agua nunca
// va aquí: tiene su propia sección arriba.
function MicrosTable({
  favs,
  microsConsumido,
  microsObjetivo,
  avgSodio,
  diasRegistrados,
  chartData,
  registeredDays,
  advancedDays,
  completeDaysFull,
  calcMode,
  phaseHintText,
}) {
  const visible = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favs.includes(m.key)) && m.key !== 'agua_ml');
  const hidden = MICROS.filter(
    (m, i) =>
      i >= MICROS_DEFAULT &&
      !favs.includes(m.key) &&
      m.key !== 'agua_ml' &&
      ((microsConsumido[m.key] || 0) > 0 || (microsObjetivo[m.key] || 0) > 0)
  );

  const renderRow = (m) => {
    const ms = computeMetricStats(registeredDays, advancedDays, m.key);
    const objStats = computeObjectiveStats(chartData, m.key);
    const zero = structuralZeroInfo(registeredDays, m.key);
    const bayesInfo = calcMode === 'bayes' ? bayesCell(completeDaysFull, m.key) : null;
    const consumidoDisplay = metricDisplay(calcMode, ms, bayesInfo, ` ${m.unit}`, 1);
    const sodiumDanger = m.key === 'sodio_mg' && sodiumIsLow(avgSodio, diasRegistrados > 0);
    const degraded = bayesInfo?.hint != null;
    return (
      <tr key={m.key} className="border-t border-border">
        <td className="py-2">{m.label}</td>
        <td className={`py-2 text-right font-mono tabular-nums ${sodiumDanger ? 'text-danger' : ''} ${degraded ? 'text-text-3' : ''}`}>
          {consumidoDisplay}
          {zero.warn && (
            <Hint text={`${zero.n} de ${zero.m} días sin dato de este micro: el 0 puede significar 'sin registro', no 'consumo 0'`}>
              {' '}
              ⚠
            </Hint>
          )}
        </td>
        <td className="py-2 text-right font-mono tabular-nums text-text-2">{objetivoCell(calcMode, objStats, m.unit)}</td>
        <td className="py-2 text-right font-mono tabular-nums text-text-2">{pctCell(calcMode, ms, objStats)}</td>
      </tr>
    );
  };

  return (
    <section className="rounded-2xl bg-surface border border-border p-4">
      <p className="text-sm text-text-3 mb-3">Micros</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-text-3 text-left">
            <th className="font-normal pb-2">Nutriente</th>
            <th className="font-normal pb-2 text-right">
              <span className="inline-flex items-center gap-1 justify-end">
                {CALC_HEADERS[calcMode]}
                {phaseHintText && <Hint text={phaseHintText}>ⓘ</Hint>}
              </span>
            </th>
            <th className="font-normal pb-2 text-right">Objetivo</th>
            <th className="font-normal pb-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>{visible.map(renderRow)}</tbody>
      </table>
      {hidden.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-text-2 py-2">Más micros ({hidden.length})</summary>
          <table className="w-full text-sm">
            <tbody>
              {microGroups(hidden).flatMap(({ cat, items }) => [
                <tr key={cat}>
                  <td colSpan={4} className="pt-3 pb-1 text-xs uppercase tracking-wide text-text-3">
                    {cat}
                  </td>
                </tr>,
                ...items.map(renderRow),
              ])}
            </tbody>
          </table>
        </details>
      )}
      {sodiumIsLow(avgSodio, diasRegistrados > 0) && (
        <p className="mt-3 text-sm text-danger">⚠ sodio promedio &lt; {SODIUM_FLOOR_MG} mg</p>
      )}
    </section>
  );
}

function Stat({ label, value, display, color }) {
  return (
    <div>
      <p className={`font-mono tabular-nums text-sm sm:text-lg whitespace-nowrap ${color}`}>{display ?? Math.round(value * 10) / 10}</p>
      <p className="text-xs text-text-3">{label}</p>
    </div>
  );
}

// Mini-sparkline SVG propio (sin Recharts, evita ResponsiveContainers extra).
// null si hay <2 puntos con dato.
function Sparkline({ values, color }) {
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null);
  if (pts.length < 2) return null;
  const w = 100, h = 28;
  const xs = pts.map((p) => p.i);
  const ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const sx = (x) => ((x - minX) / rangeX) * w;
  const sy = (y) => h - ((y - minY) / rangeY) * h;
  const line = pts.map((p) => `${sx(p.i)},${sy(p.v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7 mt-1" preserveAspectRatio="none">
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} opacity="0.15" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function KpiCard({ label, value, display, delta, status, unit = '', decimals = 1, suffix = '', sparkline, sparkColor }) {
  const f = 10 ** decimals;
  const color = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[status] || 'text-text';
  return (
    <div className="rounded-2xl bg-surface border border-border p-3">
      <p className="text-xs text-text-3">{label}</p>
      <p className={`font-mono tabular-nums text-lg ${color}`}>
        {display ?? `${Math.round(value * f) / f}${unit ? ` ${unit}` : ''}`}
        {suffix}
      </p>
      {delta != null && (
        <p className="text-xs text-text-2">
          {delta > 0 ? '+' : ''}
          {Math.round(delta)}% vs. anterior
        </p>
      )}
      {sparkline && <Sparkline values={sparkline} color={sparkColor} />}
    </div>
  );
}
