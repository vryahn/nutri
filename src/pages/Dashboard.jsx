import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { cacheGet, cacheSet } from '../lib/cache.js';
import { useOutsideClose } from '../lib/useOutsideClose.js';
import { useToast } from '../lib/useToast.js';
import Hint from '../components/Hint.jsx';
import PageSkeleton from '../components/PageSkeleton.jsx';
import CustomCharts from '../components/CustomChart.jsx';
import {
  MICROS,
  MICROS_DEFAULT,
  microGroups,
  todayISO,
  addDaysISO,
  weekdayOf,
  resolveTarget,
  nutrientKind,
  classifyDiana,
  classifyFloor,
  classifyBand,
  classifyCeiling,
  classifySodium,
  sodiumIsLow,
  sodiumIsHigh,
  SODIUM_FLOOR_MG,
  SODIUM_CEILING_MG,
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
  phaseList,
  PHASE_GOALS,
  goalLabel,
} from '../lib/domain.js';
import { t, useLang, getLang, useUnits, fmtMl, useAdherenceBands } from '../lib/i18n.js';

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
    desc: 'Tu día típico. A diferencia del promedio, no la mueven los días raros (una fiesta, un ayuno). El paréntesis es el rango donde cae la mitad de tus días.',
    minDias: MIN_DIAS_MEDIANA,
  },
  {
    key: 'stddev',
    label: 'Desv. estándar + CV',
    desc: 'Qué tan parejo comes de un día a otro. Número chico = días parecidos. El % permite comparar kcal contra micros aunque midan cosas distintas.',
    minDias: MIN_DIAS_STDDEV,
  },
  {
    key: 'tendencia',
    label: 'Tendencia',
    desc: 'Cuánto sube o baja tu consumo cada día, en promedio, a lo largo del periodo.',
    minDias: MIN_DIAS_TENDENCIA,
  },
  {
    key: 'bayes',
    label: 'Adherencia bayesiana',
    desc: 'Qué tan seguido cumples tu objetivo, y qué tan confiable es esa cifra. Con pocos días el rango sale ancho: es honestidad, no un error.',
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
    return ctx.diasRegistrados >= 1 ? null : t('No registraste nada en este periodo.');
  }
  if (opt.key === 'bayes') {
    if (ctx.diasCompletosFull < opt.minDias) {
      return t('Necesitas al menos %n días completos. Llevas %a completos y %b incompletos.')
        .replace('%n', opt.minDias).replace('%a', ctx.diasCompletosFull).replace('%b', ctx.diasParcialesFull);
    }
    if (opt.needsObjetivo && ctx.diasConObjetivo < 1) return t('Primero fija tus objetivos en Metas.');
    return null;
  }
  // mediana, stddev, tendencia — inmunes a fases: sobre la fase vigente si el rango cruza >1.
  if (ctx.diasCompletosPhase < opt.minDias) {
    return ctx.crossesPhases
      ? t('Necesitas al menos %n días completos en la fase actual. Llevas %a.')
          .replace('%n', opt.minDias).replace('%a', ctx.diasCompletosPhase)
      : t('Necesitas al menos %n días completos. Llevas %a completos y %b incompletos.')
          .replace('%n', opt.minDias).replace('%a', ctx.diasCompletosPhase).replace('%b', ctx.diasParcialesPhase);
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
function objectiveStatsOf(vals) {
  const n = vals.length;
  return { sum: sum(vals), avg: n ? sum(vals) / n : 0, median: n ? median(vals) : null, n };
}
function computeObjectiveStats(chartData, key) {
  const withKey = chartData.filter((d) => d.targetMicros != null && d.targetMicros[key] != null);
  return objectiveStatsOf(withKey.map((d) => Number(d.targetMicros[key])));
}

// [valor, detalle, objetivo, %] del CSV de resumen para una métrica, con los
// MISMOS ms/objStats/bayes que pinta la pantalla — solo cambia el formato:
// números pelones (la unidad va en su propia columna) para que el CSV sea
// parseable en hoja de cálculo. Celda vacía = sin dato, igual que el '–' en UI.
function summaryCells(calcMode, ms, objStats, b) {
  const pct = (num, den) => (num != null && objStats.n && den > 0 ? `${Math.round((num / den) * 100)}%` : '');
  const obj = (v) => (objStats.n && v != null ? round(v, 2) : '');
  switch (calcMode) {
    case 'suma':
      return [round(ms.sum, 2), '', obj(objStats.sum), pct(ms.sum, objStats.sum)];
    case 'promedio':
      return [round(ms.avg, 2), '', obj(objStats.avg), pct(ms.avg, objStats.avg)];
    case 'mediana':
      return ms.median == null
        ? ['', '', obj(objStats.median), '']
        : [round(ms.median, 2), `P25–P75: ${round(ms.p25, 2)}–${round(ms.p75, 2)}`, obj(objStats.median), pct(ms.median, objStats.median)];
    case 'stddev':
      return ms.sd == null ? ['', '', '', ''] : [round(ms.sd, 2), ms.cv == null ? '' : `CV ${round(ms.cv, 0)}%`, '', ''];
    case 'tendencia':
      return ms.slope == null ? ['', '', '', ''] : [round(ms.slope, 2), '', '', ''];
    case 'bayes':
      return b == null
        ? ['', '', obj(objStats.avg), '']
        : [`${round(b.mean * 100, 0)}%`, `IC95: ${round(b.lower * 100, 0)}–${round(b.upper * 100, 0)}%`, obj(objStats.avg), ''];
    default:
      return ['', '', '', ''];
  }
}

// Macros del CSV de resumen: su objetivo vive en campos planos de chartData
// (no en targetMicros como los micros).
const SUMMARY_MACROS = [
  { key: 'kcal', label: 'Kcal', unit: 'kcal', field: 'targetKcal' },
  { key: 'protein_g', label: 'Proteína', unit: 'g', field: 'proteinFloor' },
  { key: 'carbs_g', label: 'Carbohidratos', unit: 'g', field: 'targetCarbs' },
  { key: 'fat_g', label: 'Grasa', unit: 'g', field: 'targetFat' },
];

// Fix 3: ceros estructurales — un 0 exacto casi siempre significa "sin dato
// de este micro en el alimento", no "consumo cero".
function structuralZeroInfo(registeredDays, key) {
  const m = registeredDays.length;
  if (!m) return { warn: false, n: 0, m: 0 };
  const n = registeredDays.filter((d) => Number(d.values[key] || 0) === 0).length;
  return { warn: n / m > STRUCTURAL_ZERO_FRACTION, n, m };
}

// Campo de `chartData` con el objetivo diario de cada métrica de dos colas.
const BAYES_TARGET_FIELD = { kcal: 'targetKcal', carbs_g: 'targetCarbs', fat_g: 'targetFat' };

// Adherencia bayesiana (Fix 4, Fix 1): kcal/carbs/grasa con tolerancia de dos
// colas BAYES_KCAL_TOL; proteína y micros con objetivo diario resuelto se
// tratan como piso (≥); sodio con su piso fijo. `days` ya viene filtrado a
// días completos (no llama a `registrado`/completitud aquí).
function bayesForMetric(days, key) {
  let applicable;
  if (key === 'kcal' || key === 'carbs_g' || key === 'fat_g') {
    const field = BAYES_TARGET_FIELD[key];
    const withTarget = days.filter((d) => d[field] != null);
    if (!withTarget.length) return null;
    applicable = withTarget.map((d) => Math.abs(d.values[key] - d[field]) / d[field] <= BAYES_KCAL_TOL);
  } else if (key === 'protein_g') {
    const withTarget = days.filter((d) => d.proteinFloor != null);
    if (!withTarget.length) return null;
    applicable = withTarget.map((d) => d.values.protein_g >= d.proteinFloor);
  } else if (key === 'sodio_mg') {
    if (!days.length) return null;
    // Dual: cumple el día si el sodio cae en el rango médico [piso, techo].
    applicable = days.map((d) => d.values.sodio_mg >= SODIUM_FLOOR_MG && d.values.sodio_mg <= SODIUM_CEILING_MG);
  } else {
    const withTarget = days.filter((d) => d.targetMicros != null && d.targetMicros[key] != null);
    if (!withTarget.length) return null;
    // techo (grasa sat., trans, azúcar añadido, alcohol, colesterol): cumple si NO
    // rebasa el objetivo; el resto de micros es piso (llegar o pasar).
    const isCeiling = nutrientKind(key) === 'techo';
    applicable = withTarget.map((d) => {
      const v = Number(d.values[key] || 0);
      const tgt = Number(d.targetMicros[key]);
      return isCeiling ? v <= tgt : v >= tgt;
    });
  }
  return bayesAdherence(applicable.filter(Boolean).length, applicable.length);
}

// Texto único de "falta el objetivo": bayesCell lo compara para decidir el primary.
const NO_TARGET_HINT_ES = 'Aún no tienes objetivo para este nutriente. Ponlo en la pestaña Metas.';
const NO_TARGET_HINT = () => t(NO_TARGET_HINT_ES);

// Motivo por el que bayesForMetric devolvió null, para el Hint de la celda.
function bayesUnavailableReason(days, key) {
  if (!days.length) return t('No registraste nada en este periodo.');
  if (key === 'kcal' || key === 'carbs_g' || key === 'fat_g') {
    const field = BAYES_TARGET_FIELD[key];
    return days.some((d) => d[field] != null) ? null : NO_TARGET_HINT();
  }
  if (key === 'protein_g') return days.some((d) => d.proteinFloor != null) ? null : NO_TARGET_HINT();
  if (key === 'sodio_mg') return null;
  return days.some((d) => d.targetMicros?.[key] != null) ? null : NO_TARGET_HINT();
}

// Criterio de éxito de un día, declarado para que el % de adherencia sea auditable.
function bayesCriterionHint(key) {
  if (key === 'sodio_mg') {
    const loc = getLang() === 'en' ? 'en-US' : 'es-MX';
    return t('Cuenta como día cumplido si el sodio quedó entre %a y %b mg.')
      .replace('%a', SODIUM_FLOOR_MG.toLocaleString(loc))
      .replace('%b', SODIUM_CEILING_MG.toLocaleString(loc));
  }
  if (key === 'kcal' || key === 'carbs_g' || key === 'fat_g') {
    return t('Cuenta como día cumplido si quedaste a ±%n% de tu objetivo.').replace('%n', round(BAYES_KCAL_TOL * 100, 0));
  }
  if (nutrientKind(key) === 'techo') {
    return t('Cuenta como día cumplido si te quedaste en o bajo tu objetivo.');
  }
  return t('Cuenta como día cumplido si llegaste a tu objetivo o lo pasaste.');
}

// { primary, secondary, hint, degraded } de la celda de adherencia bayesiana.
// hint siempre declara el criterio de éxito (disponible) o la causa concreta (no disponible).
function bayesCell(days, key) {
  const b = bayesForMetric(days, key);
  if (b) {
    return {
      primary: `${round(b.mean * 100, 0)}%`,
      secondary: t('probablemente entre %a y %b%').replace('%a', round(b.lower * 100, 0)).replace('%b', round(b.upper * 100, 0)),
      hint: bayesCriterionHint(key),
      degraded: false,
    };
  }
  const reason = bayesUnavailableReason(days, key);
  return { primary: reason === NO_TARGET_HINT() ? t('Sin objetivo') : '–', secondary: null, hint: reason, degraded: true };
}

// { primary, secondary } de una métrica según el cálculo elegido. unit incluye
// el espacio inicial (ej. ' mg') o '' si no aplica. secondary es null si el
// modo no tiene un segundo valor (suma/promedio/tendencia) o si no hay dato.
function formatMetric(calcMode, ms, unit, decimals) {
  switch (calcMode) {
    case 'suma':
      return { primary: `${round(ms.sum, decimals)}${unit}`, secondary: null };
    case 'promedio':
      return { primary: `${round(ms.avg, decimals)}${unit}`, secondary: null };
    case 'mediana':
      return ms.median == null
        ? { primary: '–', secondary: null }
        : { primary: `${round(ms.median, decimals)}${unit}`, secondary: `P25–P75: ${round(ms.p25, decimals)}–${round(ms.p75, decimals)}` };
    case 'stddev':
      return ms.sd == null
        ? { primary: '–', secondary: null }
        : { primary: `σ ${round(ms.sd, decimals)}${unit}`, secondary: ms.cv == null ? null : `CV ${round(ms.cv, 0)}%` };
    case 'tendencia':
      return ms.slope == null
        ? { primary: '–', secondary: null }
        : { primary: `${ms.slope >= 0 ? '+' : ''}${round(ms.slope, decimals)}${unit}/${t('día')}`, secondary: null };
    default:
      return { primary: '', secondary: null };
  }
}

// { primary, secondary, hint, degraded } mostrado para una métrica: en modo
// bayes usa la celda de adherencia (hint siempre declara el criterio o la
// causa), en el resto delega en formatMetric (sin hint).
function metricDisplay(calcMode, ms, bayesInfo, unit, decimals) {
  if (calcMode === 'bayes') {
    if (!bayesInfo) return { primary: '–', secondary: null, hint: null, degraded: false };
    return bayesInfo;
  }
  return { ...formatMetric(calcMode, ms, unit, decimals), hint: null, degraded: false };
}

// Agua para la tarjeta/informe del Dashboard: mismo cálculo por modo que
// macros/micros (computeMetricStats/bayesCell), pero formateado con fmtMl
// (respeta unidades US) y conservando su barra de progreso. Devuelve
// { primary, secondary, targetStr, barWidth }. Los modos de nivel
// (suma/promedio/mediana) traen objetivo comparable y barra; σ/tendencia son
// dispersión (sin objetivo ni barra); bayes ya es un % (barra = adherencia).
function waterView(calcMode, ms, objStats, b) {
  const mk = (primary, secondary, targetStr, barWidth) => ({ primary, secondary, targetStr, barWidth });
  const tgtStr = (tgt) => (objStats.n > 0 && tgt != null ? fmtMl(tgt) : null);
  const bar = (cons, tgt) => (objStats.n > 0 && tgt > 0 && cons != null ? Math.min(100, (cons / tgt) * 100) : null);
  switch (calcMode) {
    case 'suma':
      return mk(fmtMl(ms.sum), null, tgtStr(objStats.sum), bar(ms.sum, objStats.sum));
    case 'promedio':
      return mk(fmtMl(ms.avg), null, tgtStr(objStats.avg), bar(ms.avg, objStats.avg));
    case 'mediana':
      return ms.median == null
        ? mk('–', null, tgtStr(objStats.median), null)
        : mk(fmtMl(ms.median), `P25–P75: ${fmtMl(ms.p25)}–${fmtMl(ms.p75)}`, tgtStr(objStats.median), bar(ms.median, objStats.median));
    case 'stddev':
      return ms.sd == null ? mk('–', null, null, null) : mk(`σ ${fmtMl(ms.sd)}`, ms.cv == null ? null : `CV ${round(ms.cv, 0)}%`, null, null);
    case 'tendencia':
      return ms.slope == null ? mk('–', null, null, null) : mk(`${ms.slope >= 0 ? '+' : ''}${fmtMl(ms.slope)}/${t('día')}`, null, null, null);
    case 'bayes': {
      if (!b) return mk('–', null, null, null);
      const w = parseFloat(b.primary);
      return mk(b.primary, b.secondary, null, Number.isFinite(w) ? Math.max(0, Math.min(100, w)) : null);
    }
    default:
      return mk('', null, null, null);
  }
}

// Frase interpretativa en lenguaje llano para la card de resumen, basada en
// kcal (representativa de las 4 métricas mostradas ahí). null = no renderizar
// nada (stat sin dato todavía, o modo sin lectura propia como suma/promedio).
function plainLanguage(calcMode, ms, bayesInfo) {
  if (calcMode === 'mediana') {
    if (ms.median == null) return null;
    return t('Tu día típico: %n kcal (la mitad de tus días cae entre %a y %b)')
      .replace('%n', round(ms.median, 0)).replace('%a', round(ms.p25, 0)).replace('%b', round(ms.p75, 0));
  }
  if (calcMode === 'stddev') {
    if (ms.sd == null) return null;
    const cv = ms.cv;
    const consistencia = cv == null ? null : cv < 10 ? t('consistencia alta') : cv < 25 ? t('consistencia media') : t('consistencia baja');
    const base = t('Varías ±%n kcal entre días').replace('%n', round(ms.sd, 0));
    return consistencia ? `${base} — ${consistencia} (CV ${round(cv, 0)}%)` : base;
  }
  if (calcMode === 'tendencia') {
    if (ms.slope == null) return null;
    const verbo = ms.slope >= 0 ? t('Subes') : t('Bajas');
    return t('%v ~%n kcal por día ≈ %m por semana')
      .replace('%v', verbo).replace('%n', round(Math.abs(ms.slope), 0)).replace('%m', round(Math.abs(ms.slope) * 7, 0));
  }
  if (calcMode === 'bayes') {
    if (!bayesInfo || bayesInfo.degraded) return null;
    const n = Math.round((parseFloat(bayesInfo.primary) / 100) * 10);
    return t('Cumples tu objetivo ~%n de cada 10 días').replace('%n', n);
  }
  return null;
}

// Texto de una celda { primary, secondary, hint } para la tabla de micros:
// una sola cadena "primary (secondary)", el paréntesis en un span sin salto
// para que, si envuelve, parta en el espacio antes de "(" y no a media cifra.
function MetricCellText({ display }) {
  const { primary, secondary, hint } = display;
  const primaryEl = hint ? <Hint text={hint}>{primary}</Hint> : primary;
  if (!secondary) return primaryEl;
  return (
    <>
      {primaryEl} <span className="whitespace-nowrap">({secondary})</span>
    </>
  );
}

// Primary + secondary en dos líneas, para KPI cards y la card de resumen.
function MetricLines({ display, className = '' }) {
  const { primary, secondary, hint } = display;
  return (
    <>
      <p className={className}>{hint ? <Hint text={hint}>{primary}</Hint> : primary}</p>
      {secondary && <p className="text-xs text-text-3 font-mono">{secondary}</p>}
    </>
  );
}

// Objetivo mostrado en la tabla de micros, según el modo (Fix 1).
function objetivoCell(calcMode, objStats, unit) {
  if (objStats.n === 0) {
    return <Hint text={NO_TARGET_HINT()}>–</Hint>;
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

const CALC_TITLES_ES = {
  suma: 'Suma del rango',
  promedio: 'Promedio diario (÷ días registrados)',
  mediana: 'Mediana (P25–P75)',
  stddev: 'Desviación estándar (CV)',
  tendencia: 'Tendencia (unidades/día)',
  bayes: 'Adherencia bayesiana (IC 95%)',
};
const calcTitle = (mode) => t(CALC_TITLES_ES[mode]);
const CALC_HEADERS_ES = {
  suma: 'Suma',
  promedio: 'Promedio',
  mediana: 'Día típico (rango medio)',
  stddev: 'Variabilidad',
  tendencia: 'Tendencia',
  bayes: 'Adherencia',
};
const calcHeader = (mode) => t(CALC_HEADERS_ES[mode]);

const PRESETS = [
  { key: 'hoy', label: 'Hoy', days: 1 },
  { key: 'semana', label: 'Semana', days: 7 },
  { key: 'mes', label: 'Mes', days: 30 },
  { key: 'trimestre', label: 'Trimestre', days: 90 },
  { key: 'año', label: 'Año', days: 365 },
];

const STATUS_BG = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' };
const DOW_SHORT_ES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DOW_SHORT_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dowShort = () => (getLang() === 'en' ? DOW_SHORT_EN : DOW_SHORT_ES);

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

// Nutrientes graficables en la card "Tendencia por nutriente" (macros + todos los
// micros). `tgt(d)` extrae el objetivo diario del punto de chartData: los macros
// viven en campos planos, los micros en targetMicros. `unit` incluye el espacio inicial.
const TREND_NUTRIENTS = [
  { key: 'kcal', label: 'Kcal', unit: '', dec: 0, tgt: (d) => d.targetKcal },
  { key: 'protein_g', label: 'Proteína', unit: ' g', dec: 0, tgt: (d) => d.proteinFloor },
  { key: 'carbs_g', label: 'Carbohidratos', unit: ' g', dec: 0, tgt: (d) => d.targetCarbs },
  { key: 'fat_g', label: 'Grasa', unit: ' g', dec: 0, tgt: (d) => d.targetFat },
  ...MICROS.filter((m) => m.key !== 'agua_ml').map((m) => ({
    key: m.key,
    label: m.label,
    unit: ` ${m.unit}`,
    dec: m.unit === 'g' ? 1 : 0,
    tgt: (d) => d.targetMicros?.[m.key] ?? null,
  })),
];

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
      targetCarbs: target?.carbs_g ?? null,
      targetFat: target?.fat_g ?? null,
      targetMicros: target?.micros ?? null,
      goal: target?.goal ?? null, // régimen del día: sesga la banda de kcal (diana)
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

function weeklyProteinData(weeks, dateSet, dayInfo) {
  return weeks.map((week, i) => {
    let sum = 0, count = 0, floorSum = 0, floorCount = 0;
    for (const d of week) {
      if (!dateSet.has(d)) continue;
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
      week: `${getLang() === 'en' ? 'W' : 'S'}${i + 1}`,
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

// Descarga `lines` como CSV (BOM para que Excel abra UTF-8 sin preguntar).
function downloadCSV(lines, filename) {
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pctDelta(curr, prev) {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

// Estado de vista persistido en localStorage (por dispositivo, no en prefs):
// sobrevive recarga sin escritura remota. `initial` se usa si no hay nada
// guardado o el JSON está corrupto.
function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

const PRESET_LABELS_EN = { hoy: 'Today', semana: 'Week', mes: 'Month', trimestre: 'Quarter', año: 'Year' };
const presetLabel = (p) => (getLang() === 'en' ? PRESET_LABELS_EN[p.key] : p.label);

export default function Dashboard() {
  useLang();
  useUnits();
  useAdherenceBands(); // re-pinta al cambiar las bandas en Configuración
  const [preset, setPreset] = usePersistentState('nutri.dash.preset', 'semana'); // 'hoy'|…|'año'|'custom'|'fase'
  const [phaseSel, setPhaseSel] = usePersistentState('nutri.dash.phaseSel', { kind: 'actual' }); // {kind:'actual'|'previa'} | {kind:'goal', goal}
  const [customStart, setCustomStart] = usePersistentState('nutri.dash.customStart', addDaysISO(todayISO(), -6));
  const [customEnd, setCustomEnd] = usePersistentState('nutri.dash.customEnd', todayISO());
  const [dailyTotals, setDailyTotals] = useState([]);
  const [prevDailyTotals, setPrevDailyTotals] = useState([]);
  const [historyTotals, setHistoryTotals] = useState([]); // daily_totals(day,kcal) últimos 90 días, para completitud
  const [bodyRows, setBodyRows] = useState([]); // body_metrics(day,metrics) del rango, para "Mis gráficas"
  const [targets, setTargets] = useState([]);
  const [favs, setFavs] = useState([]); // prefs.data.fav_micros
  const [dashboards, setDashboards] = useState([]); // prefs.data.dashboards: gráficas personalizadas
  const [stdOpen, setStdOpen] = usePersistentState('nutri.dash.stdOpen', true); // plegar el análisis estándar
  const [waterFoodId, setWaterFoodId] = useState(null);
  const [itemRows, setItemRows] = useState([]); // entry_nutrients del rango, para "Top alimentos"
  const [topMetric, setTopMetric] = useState('kcal');
  const [csvNotice, setCsvNotice] = useState('');
  const [toast, showToast] = useToast();
  const [loading, setLoading] = useState(true);
  const [calcMode, setCalcMode] = usePersistentState('nutri.dash.calcMode', 'promedio');
  const [trendKey, setTrendKey] = usePersistentState('nutri.dash.trendKey', 'protein_g');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [printing, setPrinting] = useState(false); // monta #print-report y dispara window.print()

  const today = todayISO();
  // El Dashboard analiza días TERMINADOS: el día en curso (a medias hasta la
  // cena) contaminaría promedios, completitud y la card Días. Solo el preset
  // 'hoy' lee el día actual; todo lo demás ancla en ayer.
  const lastClosed = addDaysISO(today, -1);
  const presetDef = PRESETS.find((p) => p.key === preset) || PRESETS[1]; // 'custom'/'fase' caen a semana

  // Fases con al menos un día cerrado, con el fin recortado a ayer. Las
  // programadas o iniciadas hoy no tienen días cerrados: no entran al selector.
  const phases = phaseList(targets)
    .filter((p) => p.vf <= lastClosed)
    .map((p) => ({ ...p, ongoing: !p.end || p.end >= today, end: p.end && p.end < lastClosed ? p.end : lastClosed }));

  // Selección de fase → conjunto de días. 'actual'/'previa' son un intervalo
  // contiguo; una meta es la UNIÓN de todas sus fases (no contigua).
  const selectedPhases =
    preset !== 'fase'
      ? []
      : phaseSel.kind === 'actual'
        ? phases.slice(-1)
        : phaseSel.kind === 'previa'
          ? phases.slice(-2, -1)
          : phases.filter((p) => p.goal === phaseSel.goal);
  const phaseMode = preset === 'fase' && selectedPhases.length > 0;
  const unionMode = phaseMode && selectedPhases.length > 1;
  const phaseDays = phaseMode ? selectedPhases.flatMap((p) => datesInRange(p.vf, p.end)) : [];
  const selectionLabel = !phaseMode
    ? null
    : phaseSel.kind === 'goal'
      ? t(goalLabel(phaseSel.goal))
      : phaseSel.kind === 'actual'
        ? t('Fase actual')
        : t('Fase previa');

  const anchor = preset === 'hoy' ? today : lastClosed;
  const clampedCustomEnd = customEnd > lastClosed ? lastClosed : customEnd;
  const start = phaseMode ? phaseDays[0] : preset === 'custom' ? customStart : addDaysISO(anchor, -(presetDef.days - 1));
  const end = phaseMode ? phaseDays[phaseDays.length - 1] : preset === 'custom' ? clampedCustomEnd : anchor;
  // Recorte explícito de una selección del usuario → se declara la causa.
  const excludesToday =
    preset === 'custom' ? customEnd >= today : phaseMode ? selectedPhases.some((p) => p.ongoing) : false;

  useEffect(() => {
    // SWR: si este rango ya se vio en la sesión, pinta el cache al instante
    // (sin skeleton) y el load() de fondo actualiza al llegar.
    const cached = cacheGet(`dash:${start}:${end}`);
    if (cached) applyData(cached);
    load();
  }, [start, end]);

  function applyData(d) {
    setDailyTotals(d.dt);
    setPrevDailyTotals(d.prevDt);
    setHistoryTotals(d.hist);
    setBodyRows(d.body);
    setTargets(d.tg);
    setFavs(d.favs);
    setDashboards(d.dashboards);
    setWaterFoodId(d.waterFoodId);
    setItemRows(d.items);
    setLoading(false);
  }

  // Persiste las gráficas personalizadas en prefs.data.dashboards vía merge_prefs
  // (migración 014): merge atómico server-side en 1 round-trip con auth.uid() —
  // sin depender del userId del cliente (getUser por red podía dejarlo null y
  // descartar el guardado en silencio) y sin read-modify-write que pise otras claves.
  async function saveDashboards(next) {
    setDashboards(next);
    cacheSet(`dash:${start}:${end}`, { ...(cacheGet(`dash:${start}:${end}`) || {}), dashboards: next });
    const { error } = await supabase.rpc('merge_prefs', { patch: { dashboards: next } });
    if (error) showToast(t('No se pudo guardar la gráfica — reintenta.'));
  }

  async function load() {
    if (!cacheGet(`dash:${start}:${end}`)) setLoading(true);
    setCsvNotice('');
    const { prevStart, prevEnd } = prevRangeOf(start, end);
    const historyEnd = addDaysISO(todayISO(), -1); // hoy a medias no entra a la mediana de completitud
    const historyStart = addDaysISO(historyEnd, -89);
    const results = await Promise.all([
      supabase.from('daily_totals').select('*').gte('day', start).lte('day', end),
      supabase.from('daily_totals').select('*').gte('day', prevStart).lte('day', prevEnd),
      supabase.from('daily_totals').select('day,kcal').gte('day', historyStart).lte('day', historyEnd),
      supabase.from('targets').select('*'),
      supabase.from('prefs').select('data').maybeSingle(),
      supabase.from('entry_nutrients').select('day,meal,food_id,recipe_id,item,kcal,protein_g').gte('day', start).lte('day', end),
      supabase.from('body_metrics').select('day,metrics').gte('day', start).lte('day', end),
    ]);
    if (results.some((r) => r.error)) {
      showToast(t('No se pudo cargar el Dashboard — revisa tu conexión.'));
      setLoading(false);
      return;
    }
    const [{ data: dt }, { data: prevDt }, { data: hist }, { data: tg }, { data: pf }, { data: items }, { data: body }] = results;
    applyData(cacheSet(`dash:${start}:${end}`, {
      dt: dt || [],
      prevDt: prevDt || [],
      hist: hist || [],
      body: body || [],
      tg: tg || [],
      favs: pf?.data?.fav_micros || [],
      dashboards: pf?.data?.dashboards || [],
      waterFoodId: pf?.data?.water_food_id || null,
      items: items || [],
    }));
  }

  async function exportCSV() {
    setCsvNotice('');
    const { data: all } = await supabase
      .from('entry_nutrients')
      .select('day,meal,item,food_id,recipe_id,grams,kcal,protein_g,carbs_g,fat_g,micros')
      .gte('day', start)
      .lte('day', end)
      .order('day');
    const rows = phaseMode ? (all || []).filter((r) => dateSet.has(r.day)) : all;
    if (!rows || rows.length === 0) {
      setCsvNotice(t('Sin registros en el rango'));
      return;
    }
    const header = ['day', 'meal_label', 'tipo', 'item', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', ...MICROS.map((m) => m.key)];
    const lines = [header.join(',')];
    for (const r of rows) {
      const cells = [
        r.day,
        r.meal || t('Sin etiqueta'),
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
    downloadCSV(lines, `nutri_entries_${rangeSlug()}.csv`);
  }

  // Sufijo de archivo compartido por ambos exports: fase seleccionada o rango.
  function rangeSlug() {
    return phaseMode ? `fase_${phaseSel.kind === 'goal' ? phaseSel.goal : phaseSel.kind}` : `${start}_${end}`;
  }

  // Resumen procesado del periodo: una fila por métrica con la operación
  // ACTIVA del selector — los mismos números que pinta la pantalla (mismos
  // ms/objStats vía computeMetricStats/computeObjectiveStats/bayesForMetric).
  // Sin agua_ml: igual que la tabla de micros, el agua no va en esta lista.
  function exportResumenCSV() {
    setCsvNotice('');
    if (!registeredDays.length) {
      setCsvNotice(t('Sin registros en el rango'));
      return;
    }
    const header = ['nutriente', 'clave', 'unidad', calcTitle(calcMode), 'detalle', 'objetivo', '%_objetivo'];
    const lines = [header.map(csvCell).join(',')];
    const pushRow = (label, key, unit, objStats) => {
      const ms = computeMetricStats(registeredDays, advancedDays, key);
      const b = calcMode === 'bayes' ? bayesForMetric(completeDaysFull, key) : null;
      lines.push([label, key, unit, ...summaryCells(calcMode, ms, objStats, b)].map(csvCell).join(','));
    };
    for (const m of SUMMARY_MACROS) {
      pushRow(t(m.label), m.key, m.unit, objectiveStatsOf(chartData.filter((d) => d[m.field] != null).map((d) => Number(d[m.field]))));
    }
    for (const m of MICROS.filter((m) => m.key !== 'agua_ml')) {
      pushRow(t(m.label), m.key, m.unit, computeObjectiveStats(chartData, m.key));
    }
    downloadCSV(lines, `nutri_resumen_${calcMode}_${rangeSlug()}.csv`);
  }

  // Informe PDF: mismo guard que los CSV; el PDF lo genera el navegador
  // ("Guardar como PDF" del diálogo de impresión) — cero dependencias.
  function exportInforme() {
    setCsvNotice('');
    if (!registeredDays.length) {
      setCsvNotice(t('Sin registros en el rango'));
      return;
    }
    setPrinting(true);
  }

  // Mientras la vista previa del informe está abierta: tema claro (papel) y
  // nombre del archivo en document.title (el diálogo lo usa al guardar el
  // PDF). El flip es en <html> entero; el scrim opaco (bg-black) oculta la app
  // de fondo volteada a claro. La impresión NO es automática: el usuario revisa
  // y toca "Guardar PDF".
  useEffect(() => {
    if (!printing) return;
    const html = document.documentElement;
    const prevTheme = html.getAttribute('data-theme');
    const prevTitle = document.title;
    html.setAttribute('data-theme', 'light');
    document.title = `nutri_informe_${calcMode}_${rangeSlug()}`;
    return () => {
      if (prevTheme) html.setAttribute('data-theme', prevTheme);
      else html.removeAttribute('data-theme');
      document.title = prevTitle;
    };
  }, [printing]);

  // En modo fase `dates` puede ser no contiguo (unión de fases con la misma
  // meta): las queries siguen siendo por [start, end] y `dateSet` recorta en
  // cliente todo lo que se indexa por día suelto (items, semanas, heatmap).
  const dates = phaseMode ? phaseDays : datesInRange(start, end);
  const dateSet = new Set(dates);
  // Mapas day→fila para las gráficas personalizadas (nutrición densa, medidas dispersas).
  const nutByDay = new Map(dailyTotals.map((d) => [d.day, d]));
  const bodyByDay = new Map(bodyRows.map((d) => [d.day, d]));
  const rangeItems = phaseMode ? itemRows.filter((r) => dateSet.has(r.day)) : itemRows;
  const stats = computeStats(dates, dailyTotals, targets);
  const diasConObjetivo = dates.filter((d) => resolveTarget(targets, d)).length;

  // Completitud de día inferida (tri-estado, al vuelo): etiquetas distintas
  // por día (para el atracón único) y mediana de kcal de los últimos 90 días
  // (umbral robusto personal).
  const mealsCountByDay = new Map();
  for (const r of rangeItems) {
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
  // En modo fase el recorte NO aplica: el usuario pidió explícitamente ese
  // conjunto de fases, recortarlo a la última vaciaría el filtro. El Hint
  // declara que las fases unidas tienen objetivos distintos.
  const phaseSegments = targetPhases(targets, dates);
  const realPhases = phaseSegments.filter((p) => p.vf != null);
  const crossesPhases = realPhases.length > 1;
  const activePhaseDays = crossesPhases && !phaseMode ? new Set(realPhases[realPhases.length - 1].days) : null;

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
    crossesPhases: activePhaseDays != null, // solo cuando el recorte a la fase vigente está activo
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

  if (loading) return <PageSkeleton blocks={4} />;

  const { prevStart, prevEnd } = prevRangeOf(start, end);
  const prevStats = computeStats(datesInRange(prevStart, prevEnd), prevDailyTotals, targets);
  // Unir varias fases no deja un "periodo previo" con sentido: la ventana
  // anterior al primer día cae dentro de otro régimen. Se oculta la delta.
  const showDelta = !unionMode && prevStats.diasRegistrados >= 1 && (calcMode === 'suma' || calcMode === 'promedio');

  const kcalChart = withMovingAverage(chartData);

  // Card "Tendencia por nutriente": serie diaria de la métrica elegida + su
  // objetivo diario (si existe). connectNulls salta los días sin registro.
  const trendMeta = TREND_NUTRIENTS.find((n) => n.key === trendKey) || TREND_NUTRIENTS[1];
  const trendData = chartData.map((d) => {
    const tg = trendMeta.tgt(d);
    return {
      label: d.label,
      val: d.registrado ? round(Number(d.values[trendMeta.key] ?? 0), trendMeta.dec) : null,
      target: tg != null ? Number(tg) : null,
    };
  });
  const trendHasData = trendData.some((d) => d.val != null);
  const trendHasTarget = trendData.some((d) => d.target != null);
  const dayInfo = new Map(chartData.map((d) => [d.day, d]));
  // Régimen del periodo para sesgar la banda de kcal (diana): el del último día
  // del rango seleccionado (la fase/meta vigente en él). null = banda estricta.
  const periodGoal = chartData.length ? chartData[chartData.length - 1].goal : null;
  const weeks = buildWeeks(start, end).filter((w) => w.some((d) => dateSet.has(d)));
  const proteinWeekly = weeklyProteinData(weeks, dateSet, dayInfo);
  const top = topItems(rangeItems, waterFoodId, topMetric);
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
  const aguaView = waterView(
    calcMode,
    computeMetricStats(registeredDays, advancedDays, 'agua_ml'),
    computeObjectiveStats(chartData, 'agua_ml'),
    calcMode === 'bayes' ? bayesCell(completeDaysFull, 'agua_ml') : null
  );
  const phaseHintText = unionMode
    ? `Estás viendo ${selectedPhases.length} fases de ${selectionLabel}, cada una con sus propios objetivos. El cálculo usa sus ${advancedDays.length} días completos.`
    : crossesPhases
      ? `El periodo abarca ${realPhases.length} fases con objetivos distintos. Para no mezclarlas, el cálculo usa solo la fase actual (${advancedDays.length} días).`
      : null;
  const isPhaseScopedMode = calcMode === 'mediana' || calcMode === 'stddev' || calcMode === 'tendencia';
  const plainKcalPhrase = plainLanguage(calcMode, msKcal, bKcal);

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

  // Fila del informe PDF: mismos ms/objStats/bayes que pantalla y CSV de
  // resumen (summaryCells), solo cambia el formato. Celda vacía → '—' con su
  // causa declarada en el pie del informe, nunca un guion mudo.
  function informeRow(m) {
    const ms = computeMetricStats(registeredDays, advancedDays, m.key);
    const objStats = m.field
      ? objectiveStatsOf(chartData.filter((d) => d[m.field] != null).map((d) => Number(d[m.field])))
      : computeObjectiveStats(chartData, m.key);
    const b = calcMode === 'bayes' ? bayesForMetric(completeDaysFull, m.key) : null;
    const [val, det, obj, pct] = summaryCells(calcMode, ms, objStats, b);
    const zero = structuralZeroInfo(registeredDays, m.key);
    const danger = m.key === 'sodio_mg' && (sodiumIsLow(stats.avgSodio, stats.diasRegistrados > 0) || sodiumIsHigh(stats.avgSodio, stats.diasRegistrados > 0));
    const unit = calcMode === 'bayes' ? '' : ` ${m.unit}`;
    return (
      <tr key={m.key} className="border-t border-border">
        <td className="py-1">{t(m.label)}{zero.warn ? ' ⚠' : ''}</td>
        <td className={`py-1 text-right font-mono tabular-nums ${danger ? 'text-danger' : ''}`}>
          {val === '' ? '—' : `${val}${unit}`}
        </td>
        <td className="py-1 text-right font-mono tabular-nums text-text-2">{det}</td>
        <td className="py-1 text-right font-mono tabular-nums text-text-2">{obj === '' ? '—' : `${obj} ${m.unit}`}</td>
        <td className="py-1 text-right font-mono tabular-nums text-text-2">{pct === '' ? '—' : pct}</td>
      </tr>
    );
  }

  const informeHead = (
    <thead>
      <tr className="text-text-3 text-left">
        <th className="font-normal py-1">{t('Nutriente')}</th>
        <th className="font-normal py-1 text-right">{calcHeader(calcMode)}</th>
        <th className="font-normal py-1 text-right">{t('Detalle')}</th>
        <th className="font-normal py-1 text-right">{t('Objetivo')}</th>
        <th className="font-normal py-1 text-right">%</th>
      </tr>
    </thead>
  );

  // Informe PDF (portal a <body>, hermano de #root: en @media print se oculta
  // la app entera sin ocultar el informe). Se abre como vista previa en
  // pantalla — el usuario revisa el papel ANTES de guardar; "Guardar PDF"
  // llama window.print(). Los Hints de pantalla no existen en papel: sus
  // causas van como notas al pie. Sin hint en los Stat por lo mismo.
  const noHint = (d) => ({ ...d, hint: null });
  function renderInforme() {
    const visibles = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favs.includes(m.key)) && m.key !== 'agua_ml');
    const anyZeroWarn = visibles.some((m) => structuralZeroInfo(registeredDays, m.key).warn);
    const sodiumLow = sodiumIsLow(stats.avgSodio, stats.diasRegistrados > 0);
    const sodiumHigh = sodiumIsHigh(stats.avgSodio, stats.diasRegistrados > 0);
    return (
      // Sin backdrop-blur en el scrim: backdrop-filter convertiría al overlay
      // en containing block de la barra fixed y la barra panearía con el papel.
      // Scrim opaco (bg-black): el JS voltea data-theme='light' en <html> entero
      // para que el informe salga en claro (papel); un scrim translúcido dejaba
      // asomar la app de fondo volteada a claro. Opaco = preview de impresión
      // limpio, sin filtración.
      <div
        id="print-overlay"
        onClick={() => setPrinting(false)}
        className="fixed inset-0 z-50 overflow-auto bg-black backdrop-in"
      >
        {/* Barra de acciones anclada al viewport (fixed dentro del overlay, que
            cubre toda la pantalla): visible aunque el papel panee en móvil. */}
        <div
          id="print-actions"
          onClick={(e) => e.stopPropagation()}
          className="fixed top-0 inset-x-0 z-10 flex justify-end gap-2 p-3"
        >
          <button
            onClick={() => setPrinting(false)}
            className="px-4 py-2 min-h-[44px] rounded-full text-sm bg-surface-2 border border-border text-text-2 press"
          >
            {t('Cerrar')}
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 min-h-[44px] rounded-full text-sm bg-accent-deep text-on-accent font-medium press"
          >
            {t('Guardar PDF')}
          </button>
        </div>
        {/* w-fit + mx-auto: centrado en desktop; en móvil (papel 720px > viewport)
            el overlay panea horizontal — es un documento, no una página de la app. */}
        <div onClick={(e) => e.stopPropagation()} className="w-fit mx-auto mt-16 mb-4 px-4">
          <div id="print-report" className="text-text">
        <header className="flex items-center gap-3 pb-3 border-b-2 border-accent">
          <img src="/icon.svg" alt="" className="w-10 h-10 rounded-xl" />
          <div className="flex-1">
            <p className="font-display text-2xl leading-tight">nutrimetry</p>
            <p className="text-sm text-text-2">
              {t('Informe del periodo')} — {calcTitle(calcMode)}
            </p>
          </div>
          <div className="text-right text-xs text-text-3">
            <p className="font-mono">{start} → {end}</p>
            {phaseMode && (
              <p>{selectionLabel}{selectedPhases.length > 1 ? ` · ${selectedPhases.length} ${t('fases')}` : ''}</p>
            )}
            <p>{t('Generado el %n').replace('%n', todayISO())}</p>
          </div>
        </header>

        <section className="mt-4">
          <p className="text-sm text-text-2">
            {t('%a de %b días registrados · %c completos')
              .replace('%a', stats.diasRegistrados)
              .replace('%b', dates.length)
              .replace('%c', completeDaysFull.length)}
            {diasParcialesFull > 0 ? ` (+${diasParcialesFull}p)` : ''}
          </p>
          {plainKcalPhrase && <p className="text-sm text-text-2 mt-1">{plainKcalPhrase}</p>}
          {(stats.microsConsumido.agua_ml > 0 || stats.microsObjetivo.agua_ml > 0) && (
            <p className="text-sm text-text-2 mt-1">
              {t('Agua')}: {aguaView.primary}
              {aguaView.targetStr ? ` / ${aguaView.targetStr}` : ''}
              {aguaView.secondary ? ` (${aguaView.secondary})` : ''}
            </p>
          )}
          {sodiumLow && (
            <p className="text-sm text-danger mt-1">⚠ {t('sodio promedio')} &lt; {SODIUM_FLOOR_MG} mg</p>
          )}
          {sodiumHigh && (
            <p className="text-sm text-danger mt-1">⚠ {t('sodio promedio')} &gt; {SODIUM_CEILING_MG} mg</p>
          )}
          <div className="grid grid-cols-4 gap-2 text-center mt-3 rounded-xl border border-border p-3">
            <Stat label={t('Kcal')} display={noHint(metricDisplay(calcMode, msKcal, bKcal, '', 1))} color="text-d-kcal" />
            <Stat label={t('Prot')} display={noHint(metricDisplay(calcMode, msProtein, bProtein, ' g', 1))} color="text-d-prot" />
            <Stat label={t('Carbs')} display={noHint(metricDisplay(calcMode, msCarbs, bCarbs, ' g', 1))} color="text-d-carb" />
            <Stat label={t('Grasa')} display={noHint(metricDisplay(calcMode, msFat, bFat, ' g', 1))} color="text-d-fat" />
          </div>
        </section>

        {/* Mediana/Bayes son estadísticos de distribución/adherencia: el heatmap
            (adherencia por día, mismo componente que la pantalla) los cuenta
            mejor que la línea de magnitud. Suma/Promedio/σ/tendencia son
            magnitud/dispersión/dirección del valor crudo → línea. */}
        {calcMode === 'mediana' || calcMode === 'bayes' ? (
          <section className="mt-4">
            <p className="text-sm text-text-3 mb-2">{t('Adherencia (kcal por día)')}</p>
            <AdherenceHeatmap weeks={weeks} dateSet={dateSet} dayInfo={dayInfo} />
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-text-3">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-ok" />{t('en meta (±5%)')}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-warn" />{t('cerca (±15%)')}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-danger" />{t('lejos (>15%)')}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-surface-2 border border-border" />{t('sin registro')}</span>
            </div>
          </section>
        ) : (
          <section className="mt-4">
            <p className="text-sm text-text-3 mb-1">{t('Kcal por día')}</p>
            <ComposedChart width={660} height={230} data={kcalChart}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={36} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3)' }} />
              {avgTargetKcal != null && (
                <ReferenceArea y1={avgTargetKcal * 0.9} y2={avgTargetKcal * 1.1} fill="var(--accent)" fillOpacity={0.08} strokeOpacity={0} />
              )}
              <Area type="monotone" dataKey="kcal" name={t('Kcal')} stroke="var(--d-kcal)" strokeWidth={2} fill="var(--d-kcal)" fillOpacity={0.15} isAnimationActive={false} />
              {stats.objetivo.kcal > 0 && (
                <Line dataKey="targetKcal" name={t('Objetivo')} stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
              )}
              <Line dataKey="ma7" name={t('Promedio 7 días')} stroke="var(--d-carb)" strokeDasharray="4 3" dot={false} strokeWidth={2} isAnimationActive={false} />
            </ComposedChart>
          </section>
        )}

        <section className="mt-4">
          <p className="text-sm text-text-3">{t('Macronutrientes')}</p>
          <table className="w-full text-sm">
            {informeHead}
            <tbody>{SUMMARY_MACROS.map(informeRow)}</tbody>
          </table>
        </section>

        <section className="mt-4">
          <p className="text-sm text-text-3">{t('Micronutrientes visibles')}</p>
          <table className="w-full text-sm">
            {informeHead}
            <tbody>{visibles.map(informeRow)}</tbody>
          </table>
        </section>

        <footer className="mt-4 pt-2 border-t border-border text-xs text-text-3">
          <p>{t('— = sin dato o sin objetivo en el rango.')}</p>
          {anyZeroWarn && <p>{t('⚠ = micro en 0 la mayoría de los días: puede significar "no anotado", no "no consumido".')}</p>}
          {isPhaseScopedMode && phaseHintText && <p>{phaseHintText}</p>}
          {calcMode === 'bayes' && (
            <p>
              {t('Kcal')}/{t('Carbs')}/{t('Grasa')}: {bayesCriterionHint('kcal')} · {t('Proteína')}/micros: {bayesCriterionHint('protein_g')}
            </p>
          )}
          <p className="font-mono mt-1">nutrimetry · nutri.vryahn.com</p>
        </footer>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl">{t('Dashboard')}</h1>
        <ExportMenu calcLabel={calcHeader(calcMode)} onRaw={exportCSV} onResumen={exportResumenCSV} onInforme={exportInforme} />
      </div>

      {/* El botón de fases vive FUERA del scroller: su popover no puede quedar
          recortado por el overflow-x de la fila de presets. */}
      <div className="flex items-center gap-2">
        {/* Fade en el borde derecho: sin él, los pills se rebanan en seco contra el
            botón Fases y el corte lee como un recuadro. El pr-6 da aire al final del
            scroll para que el último pill no quede bajo el degradado. */}
        <div
          className="flex gap-2 overflow-x-auto pb-1 pr-6 flex-1 min-w-0"
          style={{ maskImage: 'linear-gradient(to right, #000 calc(100% - 24px), transparent)' }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-2 rounded-full text-sm whitespace-nowrap press ${
                preset === p.key ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
              }`}
            >
              {presetLabel(p)}
            </button>
          ))}
          <button
            onClick={() => setPreset('custom')}
            className={`px-3 py-2 rounded-full text-sm whitespace-nowrap press ${
              preset === 'custom' ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
            }`}
          >
            {t('Custom')}
          </button>
        </div>
        <PhaseMenu
          phases={phases}
          selection={phaseSel}
          active={preset === 'fase'}
          label={selectionLabel || t('Fases')}
          onSelect={(sel) => {
            setPhaseSel(sel);
            setPreset('fase');
          }}
        />
      </div>

      {preset === 'fase' && !phaseMode && (
        <p className="text-sm text-warn">{t('La fase seleccionada ya no tiene días registrados — mostrando la última semana.')}</p>
      )}

      {excludesToday && (
        <p className="text-xs text-text-3">
          {t('El día en curso no se incluye: el Dashboard analiza días terminados. Para hoy usa el rango "Hoy".')}
        </p>
      )}

      {unionMode && (
        <p className="text-xs text-text-3">
          {t('%n fases de %s · %d días.').replace('%n', selectedPhases.length).replace('%s', selectionLabel).replace('%d', dates.length)}{' '}
          <Hint text={t('No hay periodo anterior con qué comparar: los días antes del %n eran de otra fase, con otros objetivos.').replace('%n', start)}>
            {t('Sin comparación vs periodo previo')}
          </Hint>
        </p>
      )}

      {preset === 'custom' && (
        <div className="flex gap-2">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="flex-1 input"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="flex-1 input"
          />
        </div>
      )}

      <CustomCharts
        dashboards={dashboards}
        onChange={saveDashboards}
        dates={dates}
        nutByDay={nutByDay}
        bodyByDay={bodyByDay}
        targets={targets}
      />

      <button
        onClick={() => setStdOpen((v) => !v)}
        className="flex items-center justify-between w-full rounded-xl bg-surface border border-border px-4 py-3 text-sm text-text-2 press"
      >
        <span>
          {t('Análisis estándar')}{' '}
          <span className="text-text-3">— {t('radar micros · adherencia · sodio · Bayes')}</span>
        </span>
        <span className="text-accent">{stdOpen ? t('Ocultar ▴') : t('Mostrar ▾')}</span>
      </button>

      {stdOpen && (
      <>
      {/* Fila de cálculo: gobierna SOLO el análisis estándar (KPIs, resumen,
          micros, export) — por eso vive dentro de esta sección, no arriba de las
          gráficas custom (que tienen su propia agregación por gráfica). */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CALC_BASIC.map((opt) => {
          const reason = calcDisabledReason(opt, calcCtx);
          return (
            <button
              key={opt.key}
              disabled={!!reason}
              onClick={() => setCalcMode(opt.key)}
              title={reason || ''}
              className={`px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap press ${
                reason
                  ? 'bg-surface-2 text-text-3 opacity-50 cursor-not-allowed'
                  : calcMode === opt.key
                    ? 'bg-accent text-bg font-medium'
                    : 'bg-surface-2 text-text-2 border border-border'
              }`}
            >
              {t(opt.label)}
            </button>
          );
        })}
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className={`px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap press ${
            CALC_ADVANCED.some((o) => o.key === calcMode) ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
          }`}
        >
          {t('Avanzadas')} {advancedOpen ? '▴' : '▾'}
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
                <p className="text-sm font-medium">{t(opt.label)}</p>
                <p className={`text-xs mt-1 ${reason ? 'text-text-3' : 'text-text-2'}`}>{reason || t(opt.desc)}</p>
              </button>
            );
          })}
        </div>
      )}

      {csvNotice && <p className="text-sm text-warn">{csvNotice}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 grid-flow-dense">
        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <div className="flex justify-between items-baseline mb-2">
            <p className="text-sm text-text-3">{t('Agua')}</p>
            <p className="font-mono tabular-nums text-sm text-d-carb">
              {aguaView.primary}
              {aguaView.targetStr ? ` / ${aguaView.targetStr}` : ''}
              {aguaView.secondary ? <span className="text-text-3"> ({aguaView.secondary})</span> : ''}
            </p>
          </div>
          {aguaView.barWidth != null && (
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-d-carb rounded-full" style={{ width: `${aguaView.barWidth}%` }} />
            </div>
          )}
        </section>

        <section className="md:col-span-2 lg:col-span-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label={t("Kcal")}
            display={metricDisplay(calcMode, msKcal, bKcal, '', 1)}
            delta={showDelta ? pctDelta(stats.promedio.kcal, prevStats.promedio.kcal) : null}
            status={classifyDiana(stats.consumido.kcal, stats.objetivo.kcal, periodGoal)}
            sparkline={chartData.map((d) => d.kcal)}
            sparkColor="var(--d-kcal)"
          />
          <KpiCard
            label={t("Proteína")}
            display={metricDisplay(calcMode, msProtein, bProtein, ' g', 1)}
            delta={showDelta ? pctDelta(stats.promedio.protein_g, prevStats.promedio.protein_g) : null}
            status={classifyFloor(stats.consumido.protein_g, stats.objetivo.protein_g)}
            sparkline={chartData.map((d) => d.protein)}
            sparkColor="var(--d-prot)"
          />
          <KpiCard
            label={t("Carbs")}
            display={metricDisplay(calcMode, msCarbs, bCarbs, ' g', 1)}
            delta={showDelta ? pctDelta(stats.promedio.carbs_g, prevStats.promedio.carbs_g) : null}
            status={classifyBand(stats.consumido.carbs_g, stats.objetivo.carbs_g)}
            sparkline={chartData.map((d) => (d.values ? d.values.carbs_g : null))}
            sparkColor="var(--d-carb)"
          />
          <KpiCard
            label={t("Grasa")}
            display={metricDisplay(calcMode, msFat, bFat, ' g', 1)}
            delta={showDelta ? pctDelta(stats.promedio.fat_g, prevStats.promedio.fat_g) : null}
            status={classifyBand(stats.consumido.fat_g, stats.objetivo.fat_g)}
            sparkline={chartData.map((d) => (d.values ? d.values.fat_g : null))}
            sparkColor="var(--d-fat)"
          />
          <KpiCard
            label={t("Sodio")}
            display={metricDisplay(calcMode, msSodio, bSodio, ' mg', 0)}
            delta={showDelta ? pctDelta(stats.avgSodio, prevStats.avgSodio) : null}
            status={classifySodium(stats.avgSodio, stats.diasRegistrados > 0)}
            sparkline={chartData.map((d) => d.sodio)}
            sparkColor="var(--d-carb)"
          />
          <KpiCard
            label={t("Días")}
            display={{
              primary: `${calcCtx.diasCompletosFull}${diasParcialesFull > 0 ? ` +${diasParcialesFull}p` : ''}`,
              secondary: null,
              hint: t('%a días con todo registrado y %b a los que parece faltarles comidas, de %c días del periodo.')
                .replace('%a', calcCtx.diasCompletosFull).replace('%b', diasParcialesFull).replace('%c', dates.length),
            }}
            delta={showDelta ? pctDelta(stats.diasRegistrados, prevStats.diasRegistrados) : null}
            suffix={` / ${dates.length}`}
          />
        </section>

        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2 flex items-center gap-1">
            {calcTitle(calcMode)}
            {isPhaseScopedMode && phaseHintText && <Hint text={phaseHintText}>ⓘ</Hint>}
          </p>
          {plainKcalPhrase && <p className="text-xs text-text-3 -mt-1 mb-2">{plainKcalPhrase}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label={t("Kcal")} display={metricDisplay(calcMode, msKcal, bKcal, '', 1)} color="text-d-kcal" />
            <Stat label={t("Prot")} display={metricDisplay(calcMode, msProtein, bProtein, ' g', 1)} color="text-d-prot" />
            <Stat label={t("Carbs")} display={metricDisplay(calcMode, msCarbs, bCarbs, ' g', 1)} color="text-d-carb" />
            <Stat label={t("Grasa")} display={metricDisplay(calcMode, msFat, bFat, ' g', 1)} color="text-d-fat" />
          </div>
        </section>

        <section className="lg:col-span-8 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2 flex items-center gap-1">
            {t('Kcal por día')}
            <Hint text={t('La línea sólida es lo que comiste cada día. La punteada suaviza esos altibajos con el promedio de los últimos 7 días, para ver la tendencia sin el ruido diario. La banda tenue marca ±10% de tu objetivo.')}>
              ⓘ
            </Hint>
          </p>
          <div className="h-[220px] lg:h-80">
          <ResponsiveContainer width="100%" height="100%">
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
              <Area type="monotone" dataKey="kcal" name={t("Kcal")} stroke="var(--d-kcal)" strokeWidth={2} fill="url(#kcalGrad)" isAnimationActive={!reducedMotion} />
              {stats.objetivo.kcal > 0 && (
                <Line dataKey="targetKcal" name={t("Objetivo")} stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
              )}
              <Line dataKey="ma7" name={t("Promedio 7 días")} stroke="var(--d-carb)" strokeDasharray="4 3" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </section>

        <section className="lg:col-span-4 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2 flex items-center gap-1">
            {t('Distribución de macros (kcal)')}
            <Hint text={t('Cada franja es un macronutriente (proteína, carbos, grasa) y su grosor es cuánto pesó ese día en tus calorías. Lee el ancho de cada color, no la altura total del área.')}>
              ⓘ
            </Hint>
          </p>
          {macroTotalKcal <= 0 ? (
            <p className="text-sm text-text-2 py-8 text-center">{t('Sin registros en el rango')}</p>
          ) : stats.diasRegistrados >= 3 ? (
            <div className="h-[220px] lg:h-80">
            <ResponsiveContainer width="100%" height="100%">
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
                <Area type="monotone" dataKey="prot" name={t("Proteína")} stackId="1" stroke="var(--d-prot)" fill="url(#protGrad)" isAnimationActive={!reducedMotion} />
                <Area type="monotone" dataKey="carb" name={t("Carbs")} stackId="1" stroke="var(--d-carb)" fill="url(#carbGrad)" isAnimationActive={!reducedMotion} />
                <Area type="monotone" dataKey="fat" name={t("Grasa")} stackId="1" stroke="var(--d-fat)" fill="url(#fatGrad)" isAnimationActive={!reducedMotion} />
              </AreaChart>
            </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col gap-2 py-4">
              <div className="h-4 rounded-full overflow-hidden flex">
                <div className="h-full bg-d-prot" style={{ width: `${(stats.consumido.protein_g * 4 * 100) / macroTotalKcal}%` }} />
                <div className="h-full bg-d-carb" style={{ width: `${(stats.consumido.carbs_g * 4 * 100) / macroTotalKcal}%` }} />
                <div className="h-full bg-d-fat" style={{ width: `${(stats.consumido.fat_g * 9 * 100) / macroTotalKcal}%` }} />
              </div>
              <div className="flex justify-between text-xs text-text-2">
                <span className="text-d-prot">{t('Prot')} {Math.round((stats.consumido.protein_g * 4 * 100) / macroTotalKcal)}%</span>
                <span className="text-d-carb">{t('Carbs')} {Math.round((stats.consumido.carbs_g * 4 * 100) / macroTotalKcal)}%</span>
                <span className="text-d-fat">{t('Grasa')} {Math.round((stats.consumido.fat_g * 9 * 100) / macroTotalKcal)}%</span>
              </div>
            </div>
          )}
        </section>

        <section className={`${dates.length > 7 ? 'lg:col-span-6' : 'lg:col-span-12'} rounded-2xl bg-surface border border-border p-4`}>
          <p className="text-sm text-text-3 mb-3 flex items-center gap-1">
            {t('Huella nutricional (micros vs. objetivo)')}
            <Hint text={t('Cada punta es un micronutriente. Cuanto más lejos del centro, más cerca (o por encima) llegaste de tu objetivo ese periodo — el borde del gráfico es 150%.')}>
              ⓘ
            </Hint>
          </p>
          {radarData.length === 0 ? (
            <p className="text-sm text-text-2 py-8 text-center">{t('Registra objetivos de micros en Metas')}</p>
          ) : (
            <div className="h-[220px] lg:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 150]} tick={false} axisLine={false} />
                <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.35} isAnimationActive={!reducedMotion} />
                <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              </RadarChart>
            </ResponsiveContainer>
            </div>
          )}
        </section>

        {dates.length > 7 && (
          <section className="lg:col-span-6 rounded-2xl bg-surface border border-border p-4">
            <p className="text-sm text-text-3 mb-3">{t('Adherencia (kcal por día)')}</p>
            <AdherenceHeatmap weeks={weeks} dateSet={dateSet} dayInfo={dayInfo} />
          </section>
        )}

        <section className="lg:col-span-6 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">{t('Proteína semanal vs piso')}</p>
          <div className="h-[200px] lg:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={proteinWeekly}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={32} />
              <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <Bar dataKey="protein" name={t("Proteína")} radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion}>
                {proteinWeekly.map((w, i) => (
                  <Cell key={i} fill={`var(--${classifyFloor(w.protein, w.floor) || 'd-prot'})`} />
                ))}
              </Bar>
              <Line dataKey="floor" name={t("Piso")} stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </section>

        <section className="lg:col-span-6 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">{t('Sodio diario vs piso y techo')}</p>
          <div className="h-[200px] lg:h-80">
          <ResponsiveContainer width="100%" height="100%">
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
              <ReferenceLine y={SODIUM_CEILING_MG} stroke="var(--danger)" strokeDasharray="4 3" />
              <Area
                type="monotone"
                dataKey="sodio"
                name={t("Sodio")}
                stroke="var(--d-carb)"
                strokeWidth={2}
                fill="url(#sodioGrad)"
                dot={(props) => {
                  const { cx, cy, payload, index } = props;
                  if (payload.sodio == null) return <g key={`dot-${index}`} />;
                  const danger = payload.sodio < SODIUM_FLOOR_MG || payload.sodio > SODIUM_CEILING_MG;
                  return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={danger ? 'var(--danger)' : 'var(--d-carb)'} />;
                }}
                isAnimationActive={!reducedMotion}
              />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </section>

        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <div className="flex justify-between items-center gap-2 mb-2">
            <p className="text-sm text-text-3 flex items-center gap-1">
              {t('Tendencia por nutriente')}
              <Hint text={t('Elige cualquier nutriente y ve su valor día a día en el rango. La línea punteada es tu objetivo diario, si lo tienes en Metas.')}>ⓘ</Hint>
            </p>
            <select
              value={trendKey}
              onChange={(e) => setTrendKey(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm min-h-[36px] max-w-[55%]"
              aria-label={t('Nutriente a graficar')}
            >
              <optgroup label={t('Macros')}>
                {TREND_NUTRIENTS.slice(0, 4).map((n) => (
                  <option key={n.key} value={n.key}>{t(n.label)}</option>
                ))}
              </optgroup>
              {microGroups(MICROS.filter((m) => m.key !== 'agua_ml')).map((g) => (
                <optgroup key={g.cat} label={t(g.cat)}>
                  {g.items.map((m) => (
                    <option key={m.key} value={m.key}>{t(m.label)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {trendHasData ? (
            <div className="h-[220px] lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={40} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
                    formatter={(v) => [`${round(Number(v), trendMeta.dec)}${trendMeta.unit}`, t(trendMeta.label)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3)' }} />
                  <Line type="monotone" dataKey="val" name={t(trendMeta.label)} stroke="var(--d-prot)" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={!reducedMotion} />
                  {trendHasTarget && (
                    <Line dataKey="target" name={t('Objetivo')} stroke="var(--accent)" strokeDasharray="4 3" dot={false} strokeWidth={2} connectNulls isAnimationActive={!reducedMotion} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-text-2 py-8 text-center">{t('Sin registros en el rango')}</p>
          )}
        </section>

        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-text-3">{t('Top alimentos')}</p>
            <div className="flex gap-1">
              <button
                onClick={() => setTopMetric('kcal')}
                className={`px-2 py-1 min-h-[32px] rounded-full text-xs ${topMetric === 'kcal' ? 'bg-accent text-bg' : 'bg-surface-2 text-text-2'}`}
              >
                {t('Kcal')}
              </button>
              <button
                onClick={() => setTopMetric('protein_g')}
                className={`px-2 py-1 min-h-[32px] rounded-full text-xs ${topMetric === 'protein_g' ? 'bg-accent text-bg' : 'bg-surface-2 text-text-2'}`}
              >
                {t('Proteína')}
              </button>
            </div>
          </div>
          {top.length === 0 ? (
            <p className="text-sm text-text-2">{t('Sin registros en el rango')}</p>
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
      </>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 text-center text-sm lg:left-auto lg:right-6 lg:bottom-6"
        >
          {toast}
        </div>
      )}

      {printing && createPortal(renderInforme(), document.body)}
    </div>
  );
}

// Selector de fases: 'actual'/'previa' (un intervalo) y las 4 metas (unión de
// todas las fases con esa meta). Flota sobre el contenido → `.glass`, y el
// acento sobre glass es --accent-glass, nunca --accent. Toda opción sin datos
// se deshabilita con su causa concreta, nunca desaparece.
// Menú de exportación: dos alcances (registros crudos vs resumen procesado).
// El subtítulo de cada opción declara si la operación del selector participa
// — siempre visible, no detrás de hover (mobile-first) — y el título del
// resumen la nombra ("Resumen del periodo — Promedio").
function ExportMenu({ calcLabel, onRaw, onResumen, onInforme }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, setOpen);
  const items = [
    {
      key: 'raw',
      label: `${t('Registros día por día')} (CSV)`,
      sub: t('Cada alimento del rango con sus macros y micros. No aplica la operación seleccionada.'),
      run: onRaw,
    },
    {
      key: 'resumen',
      label: `${t('Resumen del periodo')} — ${calcLabel} (CSV)`,
      sub: t('Una fila por métrica con valor según la operación activa, objetivo y % de adherencia.'),
      run: onResumen,
    },
    {
      key: 'informe',
      label: `${t('Informe del periodo')} — ${calcLabel} (PDF)`,
      sub: t('Resumen ejecutivo con gráfica y tablas, listo para guardar como PDF.'),
      run: onInforme,
    },
  ];
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap bg-surface-2 border border-border text-text-2 press"
      >
        {t('Exportar')} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="absolute z-50 top-full right-0 mt-1 w-72 rounded-xl border border-border p-1 shadow-lg glass">
          {items.map((it) => (
            <button
              key={it.key}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
              className="w-full text-left rounded-lg px-3 py-2 min-h-[44px] hover:bg-surface-2 press text-text-2"
            >
              <span className="block text-sm">{it.label}</span>
              <span className="block text-xs text-text-3 mt-0.5">{it.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PhaseMenu({ phases, selection, active, label, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, setOpen);
  const actual = phases[phases.length - 1] || null;
  const previa = phases[phases.length - 2] || null;
  const fmt = (p) => `${p.label || t('Sin nombre')} · ${p.vf.slice(5)} → ${p.end.slice(5)}`; // MM-DD, como el eje de los charts

  const items = [
    {
      key: 'actual',
      sel: { kind: 'actual' },
      label: t('Fase actual'),
      sub: actual ? fmt(actual) : null,
      reason: actual ? null : t('Todavía no tienes una fase en curso. Créala en Metas.'),
    },
    {
      key: 'previa',
      sel: { kind: 'previa' },
      label: t('Fase previa'),
      sub: previa ? fmt(previa) : null,
      reason: previa ? null : t('Solo llevas una fase. La anterior aparecerá cuando empieces la siguiente.'),
    },
    ...PHASE_GOALS.map((g) => {
      const n = phases.filter((p) => p.goal === g.key).length;
      const gLabel = t(g.label);
      return {
        key: g.key,
        sel: { kind: 'goal', goal: g.key },
        label: gLabel,
        sub: n ? `${n} ${n === 1 ? t('fase') : t('fases')} ${t('en el histórico')}` : null,
        reason: n ? null : t('No has marcado ninguna fase como %n. Puedes hacerlo en Metas.').replace('%n', gLabel),
        divider: g.key === PHASE_GOALS[0].key,
      };
    }),
  ];
  const isSel = (it) =>
    active && it.sel.kind === selection.kind && (it.sel.kind !== 'goal' || it.sel.goal === selection.goal);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap press ${
          active ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
        }`}
      >
        {label} {open ? '▴' : '▾'}
      </button>
      {open && (
          <div className="absolute z-50 top-full right-0 mt-1 w-64 rounded-xl border border-border p-1 shadow-lg glass">
            {items.map((it) => (
              <div key={it.key} className={it.divider ? 'border-t border-border mt-1 pt-1' : ''}>
                {it.reason ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 min-h-[44px] text-sm text-text-3">
                    <span>{it.label}</span>
                    <Hint text={it.reason}>ⓘ</Hint>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setOpen(false);
                      onSelect(it.sel);
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2 min-h-[44px] hover:bg-surface-2 press ${
                      isSel(it) ? 'text-accent-glass font-medium' : 'text-text-2'
                    }`}
                  >
                    <span className="block text-sm">{it.label}</span>
                    {it.sub && <span className="block font-mono text-[11px] text-text-3">{it.sub}</span>}
                  </button>
                )}
              </div>
            ))}
          </div>
      )}
    </div>
  );
}

function AdherenceHeatmap({ weeks, dateSet, dayInfo }) {
  return (
    <div className="flex gap-1 overflow-x-auto">
      <div className="grid grid-rows-7 gap-1 text-[10px] text-text-3 pr-1">
        {dowShort().map((d, i) => (
          <div key={i} className="h-3.5 flex items-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-1">
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => {
            if (!dateSet.has(day)) return <div key={`${wi}-${di}`} className="w-3.5 h-3.5" />;
            const info = dayInfo.get(day);
            let cls = 'bg-surface-2';
            if (info?.registrado) {
              const status = classifyDiana(info.kcal, info.targetKcal, info.goal);
              cls = status ? STATUS_BG[status] : 'bg-surface-3';
            }
            const parcial = info?.completeness === 'parcial';
            const parcialSuffix = parcial ? ` (${t('día incompleto: parece que faltaron comidas')})` : '';
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
    const sodiumDanger = m.key === 'sodio_mg' && (sodiumIsLow(avgSodio, diasRegistrados > 0) || sodiumIsHigh(avgSodio, diasRegistrados > 0));
    const degraded = consumidoDisplay.degraded;
    // Semáforo de fila: techo (no rebasar) y piso (alcanzar), solo en modos con
    // par consumido/objetivo comparable. Sodio va por su ruta dual (sodiumDanger);
    // el resto de micros ('meta') queda neutro — tabla de datos, no todo semáforo.
    const kind = nutrientKind(m.key);
    const cmpPair = { suma: [ms.sum, objStats.sum], promedio: [ms.avg, objStats.avg], mediana: [ms.median, objStats.median] }[calcMode];
    let rowStatus = null;
    if (!degraded && !sodiumDanger && objStats.n && cmpPair && (kind === 'techo' || kind === 'piso')) {
      const [val, tgt] = cmpPair;
      if (val != null && tgt > 0) rowStatus = kind === 'techo' ? classifyCeiling(val, tgt) : classifyFloor(val, tgt);
    }
    const statusText = rowStatus ? { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[rowStatus] : '';
    return (
      <tr key={m.key} className="border-t border-border">
        <td className="py-2">{t(m.label)}</td>
        <td className={`py-2 text-right whitespace-normal font-mono tabular-nums ${sodiumDanger ? 'text-danger' : statusText} ${degraded ? 'text-text-3' : ''}`}>
          <MetricCellText display={consumidoDisplay} />
          {zero.warn && (
            <Hint text={t('En %a de %b días no registraste este nutriente. El 0 puede significar \'no lo anotaste\', no \'no lo comiste\'.').replace('%a', zero.n).replace('%b', zero.m)}>
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
      <p className="text-sm text-text-3 mb-3">{t('Micros')}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-text-3 text-left">
            <th className="font-normal pb-2">{t('Nutriente')}</th>
            <th className="font-normal pb-2 text-right">
              <span className="inline-flex items-center gap-1 justify-end">
                {calcHeader(calcMode)}
                {phaseHintText && <Hint text={phaseHintText}>ⓘ</Hint>}
              </span>
            </th>
            <th className="font-normal pb-2 text-right">{t('Objetivo')}</th>
            <th className="font-normal pb-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>{visible.map(renderRow)}</tbody>
      </table>
      {hidden.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-text-2 py-2">{t('Más micros (%n)').replace('%n', hidden.length)}</summary>
          <table className="w-full text-sm">
            <tbody>
              {microGroups(hidden).flatMap(({ cat, items }) => [
                <tr key={cat}>
                  <td colSpan={4} className="pt-3 pb-1 text-xs uppercase tracking-wide text-text-3">
                    {t(cat)}
                  </td>
                </tr>,
                ...items.map(renderRow),
              ])}
            </tbody>
          </table>
        </details>
      )}
      {sodiumIsLow(avgSodio, diasRegistrados > 0) && (
        <p className="mt-3 text-sm text-danger">⚠ {t('sodio promedio')} &lt; {SODIUM_FLOOR_MG} mg</p>
      )}
      {sodiumIsHigh(avgSodio, diasRegistrados > 0) && (
        <p className="mt-3 text-sm text-danger">⚠ {t('sodio promedio')} &gt; {SODIUM_CEILING_MG} mg</p>
      )}
    </section>
  );
}

function Stat({ label, display, color }) {
  return (
    <div className="min-w-0">
      <MetricLines display={display} className={`font-mono tabular-nums text-sm sm:text-lg ${color}`} />
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

function KpiCard({ label, display, delta, status, suffix = '', sparkline, sparkColor }) {
  const color = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[status] || 'text-text';
  return (
    <div className="rounded-2xl bg-surface border border-border p-3 min-w-0">
      <p className="text-xs text-text-3">{label}</p>
      <p className={`font-mono tabular-nums text-lg ${color}`}>
        {display.hint ? <Hint text={display.hint}>{display.primary}</Hint> : display.primary}
        {suffix}
      </p>
      {display.secondary && <p className="text-xs text-text-3 font-mono">{display.secondary}</p>}
      {delta != null && (
        <p className="text-xs text-text-2">
          {delta > 0 ? '+' : ''}
          {Math.round(delta)}% {t('vs. anterior')}
        </p>
      )}
      {sparkline && <Sparkline values={sparkline} color={sparkColor} />}
    </div>
  );
}
