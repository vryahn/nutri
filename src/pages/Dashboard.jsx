import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2 } from 'lucide-react';
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
import { GEMINI_KEY, planAskQuery, formatAskContext, askAnswer } from '../lib/ai.js';
import Hint from '../components/Hint.jsx';
import PageSkeleton from '../components/PageSkeleton.jsx';
import UndoToast from '../components/UndoToast.jsx';
import CustomCharts from '../components/CustomChart.jsx';
import Sheet from '../components/Sheet.jsx';
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

// Unified calculation set for the selector (Part A). 'suma'/'promedio' are always
// available with ≥1 registered day; the advanced ones require more days.
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

// Reason (string) why a calculation option is disabled, or null if it applies.
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
  // mediana, stddev, tendencia — immune to phase mixing: computed over the current phase if the range spans >1.
  if (ctx.diasCompletosPhase < opt.minDias) {
    return ctx.crossesPhases
      ? t('Necesitas al menos %n días completos en la fase actual. Llevas %a.')
          .replace('%n', opt.minDias).replace('%a', ctx.diasCompletosPhase)
      : t('Necesitas al menos %n días completos. Llevas %a completos y %b incompletos.')
          .replace('%n', opt.minDias).replace('%a', ctx.diasCompletosPhase).replace('%b', ctx.diasParcialesPhase);
  }
  return null;
}

// Statistics for a metric (macro or micro). Sum/Average over all registered
// days in the range (unchanged semantics); median/σ/trend over
// `advancedDays` (complete days, and from the current phase when applicable — Fix 5).
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

// Daily objective resolved for `key` over the days in the range that have a
// target with that value defined (Fix 1). n=0 ⇒ there is truly no objective.
function objectiveStatsOf(vals) {
  const n = vals.length;
  return { sum: sum(vals), avg: n ? sum(vals) / n : 0, median: n ? median(vals) : null, n };
}
function computeObjectiveStats(chartData, key) {
  const withKey = chartData.filter((d) => d.targetMicros != null && d.targetMicros[key] != null);
  return objectiveStatsOf(withKey.map((d) => Number(d.targetMicros[key])));
}

// [value, detail, objective, %] of the summary CSV for a metric, using the
// SAME ms/objStats/bayes the screen renders — only the format changes:
// bare numbers (the unit goes in its own column) so the CSV is
// parseable in a spreadsheet. Empty cell = no data, same as the '–' in the UI.
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

// Macros for the summary CSV: their objective lives in flat fields of chartData
// (not in targetMicros like the micros).
const SUMMARY_MACROS = [
  { key: 'kcal', label: 'Kcal', unit: 'kcal', field: 'targetKcal' },
  { key: 'protein_g', label: 'Proteína', unit: 'g', field: 'proteinFloor' },
  { key: 'carbs_g', label: 'Carbohidratos', unit: 'g', field: 'targetCarbs' },
  { key: 'fat_g', label: 'Grasa', unit: 'g', field: 'targetFat' },
];

// Fix 3: structural zeros — an exact 0 almost always means "no data for
// this micro in the food", not "zero intake".
function structuralZeroInfo(registeredDays, key) {
  const m = registeredDays.length;
  if (!m) return { warn: false, n: 0, m: 0 };
  const n = registeredDays.filter((d) => Number(d.values[key] || 0) === 0).length;
  return { warn: n / m > STRUCTURAL_ZERO_FRACTION, n, m };
}

// `chartData` field holding the daily objective for each two-tailed metric.
const BAYES_TARGET_FIELD = { kcal: 'targetKcal', carbs_g: 'targetCarbs', fat_g: 'targetFat' };

// Bayesian adherence (Fix 4, Fix 1): kcal/carbs/fat with the two-tailed
// tolerance BAYES_KCAL_TOL; protein and micros with a resolved daily objective
// are treated as a floor (≥); sodium with its fixed floor. `days` arrives already
// filtered to complete days (it does not call `registrado`/completeness here).
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
    // Dual: the day complies if sodium falls within the medical range [floor, ceiling].
    applicable = days.map((d) => d.values.sodio_mg >= SODIUM_FLOOR_MG && d.values.sodio_mg <= SODIUM_CEILING_MG);
  } else {
    const withTarget = days.filter((d) => d.targetMicros != null && d.targetMicros[key] != null);
    if (!withTarget.length) return null;
    // 'techo' (ceiling — sat. fat, trans, added sugar, alcohol, cholesterol): complies if it
    // does NOT exceed the objective; the remaining micros are a floor (reach or surpass).
    const isCeiling = nutrientKind(key) === 'techo';
    applicable = withTarget.map((d) => {
      const v = Number(d.values[key] || 0);
      const tgt = Number(d.targetMicros[key]);
      return isCeiling ? v <= tgt : v >= tgt;
    });
  }
  return bayesAdherence(applicable.filter(Boolean).length, applicable.length);
}

// Single "objective missing" text: bayesCell compares against it to decide the primary.
const NO_TARGET_HINT_ES = 'Aún no tienes objetivo para este nutriente. Ponlo en la pestaña Metas.';
const NO_TARGET_HINT = () => t(NO_TARGET_HINT_ES);

// Reason why bayesForMetric returned null, for the cell's Hint.
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

// Success criterion for a day, stated so the adherence % is auditable.
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

// { primary, secondary, hint, degraded } for the Bayesian adherence cell.
// hint always states the success criterion (available) or the concrete cause (unavailable).
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

// { primary, secondary } for a metric according to the chosen calculation. unit includes
// the leading space (e.g. ' mg') or '' if not applicable. secondary is null if the
// mode has no second value (suma/promedio/tendencia) or if there is no data.
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

// { primary, secondary, hint, degraded } displayed for a metric: in bayes
// mode it uses the adherence cell (hint always states the criterion or the
// cause); in the other modes it delegates to formatMetric (no hint).
function metricDisplay(calcMode, ms, bayesInfo, unit, decimals) {
  if (calcMode === 'bayes') {
    if (!bayesInfo) return { primary: '–', secondary: null, hint: null, degraded: false };
    return bayesInfo;
  }
  return { ...formatMetric(calcMode, ms, unit, decimals), hint: null, degraded: false };
}

// Water for the Dashboard card/report: same per-mode calculation as
// macros/micros (computeMetricStats/bayesCell), but formatted with fmtMl
// (honors US units) and keeping its progress bar. Returns
// { primary, secondary, targetStr, barWidth }. The level modes
// (suma/promedio/mediana) carry a comparable objective and a bar; σ/trend are
// dispersion (no objective, no bar); bayes is already a % (bar = adherence).
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

// Plain-language interpretive sentence for the summary card, based on
// kcal (representative of the 4 metrics shown there). null = render nothing
// (stat with no data yet, or a mode with no reading of its own such as suma/promedio).
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

// Text of a { primary, secondary, hint } cell for the micros table:
// a single "primary (secondary)" string, the parenthetical in a no-wrap span
// so that, if it wraps, it breaks at the space before "(" and not mid-figure.
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

// Primary + secondary on two lines, for the KPI cards and the summary card.
function MetricLines({ display, className = '' }) {
  const { primary, secondary, hint } = display;
  return (
    <>
      <p className={className}>{hint ? <Hint text={hint}>{primary}</Hint> : primary}</p>
      {secondary && <p className="text-xs text-text-3 font-mono">{secondary}</p>}
    </>
  );
}

// Objective shown in the micros table, according to the mode (Fix 1).
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

// % shown in the micros table, according to the mode (Fix 1). Bayes already IS a %.
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

// ponytail: 5-year cap. Typing the year into the custom range date input
// passes through valid-but-absurd dates ('0202-07-01'): without a bound, the loop
// generates hundreds of thousands of days and freezes the tab. Invalid or impossible
// range = empty, never truncated: half a page of silently incomplete data would be worse.
const MAX_RANGE_DAYS = 1830;
function datesInRange(start, end) {
  if (!start || !end || start > end) return [];
  const span = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (!Number.isFinite(span) || span > MAX_RANGE_DAYS) return [];
  const dates = [];
  let d = start;
  while (d <= end) {
    dates.push(d);
    d = addDaysISO(d, 1);
  }
  return dates;
}

// Previous range of equal length, immediately preceding [start, end].
function prevRangeOf(start, end) {
  const length = datesInRange(start, end).length;
  const prevEnd = addDaysISO(start, -1);
  const prevStart = addDaysISO(prevEnd, -(length - 1));
  return { prevStart, prevEnd };
}

// Micro keys defaulted to 0 (a micro absent from the jsonb weighs 0);
// agua_ml is excluded because it has its own section and does not enter the selector.
const MICROS_ZERO = Object.fromEntries(MICROS.filter((m) => m.key !== 'agua_ml').map((m) => [m.key, 0]));

// Nutrients plottable in the "Tendencia por nutriente" card (macros + all
// micros). `tgt(d)` extracts the daily objective from the chartData point: macros
// live in flat fields, micros in targetMicros. `unit` includes the leading space.
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

// Totals/averages/daily series for a range. Pure: it is used twice
// (current range and previous range for the KPI deltas).
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
      goal: target?.goal ?? null, // day's regimen: biases the kcal band (diana)
      protein: registrado ? protein_g : null,
      proteinFloor: target?.protein_g ?? null,
      sodio: registrado ? sodio : null,
      registrado,
      // Flat per-metric series (macros + micros), for the selector's advanced
      // calculations (Part A). null if the day has no record.
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

// MA-7: 7-calendar-day window, averaged only over the days with a record
// inside that window (days without a record do not count even as 0).
function withMovingAverage(chartData) {
  return chartData.map((d, i) => {
    const windowSlice = chartData.slice(Math.max(0, i - 6), i + 1);
    const registrados = windowSlice.filter((w) => w.kcal != null);
    const ma7 = registrados.length ? registrados.reduce((s, w) => s + w.kcal, 0) / registrados.length : null;
    return { ...d, ma7 };
  });
}

// Mon–Sun weeks covering [start, end] (may overhang on both sides).
function buildWeeks(start, end) {
  const startDow = weekdayOf(start); // 0=Sunday..6=Saturday
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

// Downloads `lines` as CSV (BOM so Excel opens UTF-8 without prompting).
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

// View state persisted in localStorage (per device, not in prefs):
// survives a reload without a remote write. `initial` is used if nothing is
// stored or the JSON is corrupted.
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

// Identity of a saved range. Ranges already living in localStorage carry no id:
// they fall back to their old key (dates), which for them is still unique.
const rangeId = (r) => r.id ?? `${r.start}_${r.end}`;

export default function Dashboard() {
  useLang();
  useUnits();
  useAdherenceBands(); // re-renders when the bands change in Settings
  const [preset, setPreset] = usePersistentState('nutri.dash.preset', 'semana'); // 'hoy'|…|'año'|'custom'|'fase'
  const [phaseSel, setPhaseSel] = usePersistentState('nutri.dash.phaseSel', { kind: 'actual' }); // {kind:'actual'|'previa'} | {kind:'goal', goal}
  const [customStart, setCustomStart] = usePersistentState('nutri.dash.customStart', addDaysISO(todayISO(), -6));
  const [customEnd, setCustomEnd] = usePersistentState('nutri.dash.customEnd', todayISO());
  // Saved ranges: [{id,start,end,name?}]. end:null = OPEN-ENDED (up to today) — a
  // date cannot be frozen or the range would silently grow stale.
  const [savedRanges, setSavedRanges] = usePersistentState('nutri.dash.savedRanges', []);
  const [activeRangeId, setActiveRangeId] = usePersistentState('nutri.dash.activeRangeId', null); // currently open saved range; null = manual custom
  const [rangeName, setRangeName] = useState(''); // optional name when saving a range
  const [editKey, setEditKey] = useState(null); // id of the range being edited; null = not editing
  const [rollingEnd, setRollingEnd] = useState(false); // form's "Hasta hoy" (up to today) checkbox
  const [undoRange, setUndoRange] = useState(null); // { range, index, prevActiveId, timer } after a delete, for "Deshacer" (undo)
  const [dailyTotals, setDailyTotals] = useState([]);
  const [prevDailyTotals, setPrevDailyTotals] = useState([]);
  const [historyTotals, setHistoryTotals] = useState([]); // daily_totals(day,kcal) for the last 90 days, for completeness
  const [bodyRows, setBodyRows] = useState([]); // body_metrics(day,metrics) for the range, for "Mis gráficas"
  const [targets, setTargets] = useState([]);
  const [favs, setFavs] = useState([]); // prefs.data.fav_micros
  const [dashboards, setDashboards] = useState([]); // prefs.data.dashboards: custom charts
  const [tab, setTab] = usePersistentState('nutri.dash.tab', 'estandar'); // 'estandar' | 'graficas' — active tab
  const [waterFoodId, setWaterFoodId] = useState(null);
  const [itemRows, setItemRows] = useState([]); // entry_nutrients for the range, for "Top alimentos"
  const [topMetric, setTopMetric] = useState('kcal');
  const [csvNotice, setCsvNotice] = useState('');
  const [toast, showToast] = useToast();
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  // Skeleton only on the 1st load: changing the range must not unmount the page
  // (it used to unmount the range's own form and close the date picker).
  const loadedOnce = useRef(false);
  const [calcMode, setCalcMode] = usePersistentState('nutri.dash.calcMode', 'promedio');
  const [trendKey, setTrendKey] = usePersistentState('nutri.dash.trendKey', 'protein_g');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [printing, setPrinting] = useState(false); // mounts #print-report and triggers window.print()
  const [askOpen, setAskOpen] = useState(false);
  const [askHistory, setAskHistory] = useState([]); // [{q,a,clamped}], memory only — no conversational thread
  const [askQuestion, setAskQuestion] = useState('');
  const [askLoading, setAskLoading] = useState(false);

  const today = todayISO();
  // The Dashboard analyzes FINISHED days: the day in progress (halfway through
  // until dinner) would contaminate averages, completeness, and the Días card. Only the
  // 'hoy' preset reads the current day; everything else anchors on yesterday.
  const lastClosed = addDaysISO(today, -1);
  const presetDef = PRESETS.find((p) => p.key === preset) || PRESETS[1]; // 'custom'/'fase' fall back to 'semana'

  // Open saved range (if any). Without one, the custom range is manual and the
  // form is the only possible view: otherwise there would be no way to edit it.
  const activeRange = savedRanges.find((r) => rangeId(r) === activeRangeId) || null;
  const showRangeForm = !activeRange || editKey !== null;
  // The open end is RESOLVED on every render, not read from disk: that's why the
  // same range is worth one more day tomorrow.
  const openEnded = showRangeForm ? rollingEnd : activeRange.end == null;
  const effectiveEnd = openEnded ? today : customEnd;

  // Phases with at least one closed day, with the end trimmed to yesterday. Phases
  // scheduled or started today have no closed days: they do not enter the selector.
  const phases = phaseList(targets)
    .filter((p) => p.vf <= lastClosed)
    .map((p) => ({ ...p, ongoing: !p.end || p.end >= today, end: p.end && p.end < lastClosed ? p.end : lastClosed }));

  // Phase selection → set of days. 'actual'/'previa' are a contiguous interval;
  // a goal is the UNION of all its phases (non-contiguous).
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
  const clampedCustomEnd = effectiveEnd > lastClosed ? lastClosed : effectiveEnd;
  const start = phaseMode ? phaseDays[0] : preset === 'custom' ? customStart : addDaysISO(anchor, -(presetDef.days - 1));
  const end = phaseMode ? phaseDays[phaseDays.length - 1] : preset === 'custom' ? clampedCustomEnd : anchor;
  // Explicit trimming of a user selection → the cause is declared.
  const excludesToday =
    preset === 'custom' ? effectiveEnd >= today : phaseMode ? selectedPhases.some((p) => p.ongoing) : false;

  useEffect(() => {
    // SWR: if this range has already been seen in the session, paint the cache
    // instantly (no skeleton) and the background load() updates it on arrival.
    const cached = cacheGet(`dash:${start}:${end}`);
    if (cached) applyData(cached);
    // Typing a date into the custom range passes through valid intermediate dates
    // (0202-…, 2020-…): without debounce, each one triggers load()'s 7 queries.
    const timer = setTimeout(load, cached || !loadedOnce.current ? 0 : 250);
    return () => clearTimeout(timer);
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
    loadedOnce.current = true;
    setLoading(false);
    setRefetching(false);
  }

  // Persists the custom charts to prefs.data.dashboards via merge_prefs
  // (migration 014): an atomic server-side merge in 1 round-trip with auth.uid() —
  // without depending on the client's userId (a network getUser could leave it null and
  // silently drop the save) and without a read-modify-write that would clobber other keys.
  async function saveDashboards(next) {
    setDashboards(next);
    cacheSet(`dash:${start}:${end}`, { ...(cacheGet(`dash:${start}:${end}`) || {}), dashboards: next });
    const { error } = await supabase.rpc('merge_prefs', { patch: { dashboards: next } });
    if (error) showToast(t('No se pudo guardar la gráfica — reintenta.'));
  }

  // Saved custom ranges (localStorage, per-device just like the custom range itself).
  const rangeInvalid = !rollingEnd && customStart > customEnd;
  function saveCurrentRange() {
    if (rangeInvalid) return;
    const name = rangeName.trim();
    const data = { start: customStart, end: rollingEnd ? null : customEnd, ...(name ? { name } : {}) };
    const id = editKey ?? crypto.randomUUID();
    setSavedRanges(
      editKey ? savedRanges.map((r) => (rangeId(r) === editKey ? { ...data, id } : r)) : [...savedRanges, { ...data, id }],
    );
    setActiveRangeId(id);
    setEditKey(null);
  }
  // Apply = open in read-only mode. customEnd stores the date that would be used
  // to edit it if the range is open-ended: the End input needs a value.
  function applyRange(r) {
    setCustomStart(r.start);
    setCustomEnd(r.end ?? lastClosed);
    setRollingEnd(r.end == null);
    setRangeName(r.name || '');
    setActiveRangeId(rangeId(r));
    setEditKey(null);
    setPreset('custom');
  }
  function editRange(r) {
    applyRange(r);
    setEditKey(rangeId(r));
  }
  // Manual custom: with no active range, showRangeForm stays true on its own.
  function newRange() {
    setActiveRangeId(null);
    setEditKey(null);
    setRangeName('');
    setRollingEnd(false);
    setPreset('custom');
  }
  // Delete is immediate + "Deshacer" (undo) for 5 s (same pattern as Foods/Recipes): a
  // confirmation would charge a toll on every correct delete; the undo only costs on the mistaken ones.
  function deleteRange(r) {
    const index = savedRanges.findIndex((x) => rangeId(x) === rangeId(r));
    if (index < 0) return;
    if (undoRange) clearTimeout(undoRange.timer); // a delete right after another overwrites the previous one
    setSavedRanges(savedRanges.filter((x) => rangeId(x) !== rangeId(r)));
    setUndoRange({
      range: r,
      index,
      prevActiveId: activeRangeId,
      timer: setTimeout(() => setUndoRange(null), 5000),
    });
    if (activeRangeId === rangeId(r)) newRange();
  }

  function undoDeleteRange() {
    if (!undoRange) return;
    clearTimeout(undoRange.timer);
    const next = [...savedRanges];
    next.splice(undoRange.index, 0, undoRange.range); // goes back to ITS OWN position, not to the end
    setSavedRanges(next);
    if (undoRange.prevActiveId === rangeId(undoRange.range)) applyRange(undoRange.range);
    setUndoRange(null);
  }

  async function load() {
    if (!loadedOnce.current) setLoading(true);
    else if (!cacheGet(`dash:${start}:${end}`)) setRefetching(true);
    setCsvNotice('');
    const { prevStart, prevEnd } = prevRangeOf(start, end);
    const historyEnd = addDaysISO(todayISO(), -1); // today, only half-elapsed, does not enter the completeness median
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
      setRefetching(false);
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

  // "Pregúntale a tu bitácora" (ask your log): planner (AI) → SQL (Supabase) → generation
  // (AI) with citations. Each question is independent (no conversational thread);
  // the pair is appended to the sheet's in-memory history. It never throws: any
  // pipeline failure falls back to the error message as the pair's answer.
  async function submitAsk() {
    const q = askQuestion.trim();
    if (!q || askLoading) return;
    setAskQuestion('');
    setAskLoading(true);
    try {
      const lang = getLang();
      const plan = await planAskQuery(q, todayISO(), lang);
      const [{ data: dt, error: e1 }, { data: items, error: e2 }] = await Promise.all([
        supabase.from('daily_totals').select('*').gte('day', plan.date_from).lte('day', plan.date_to),
        plan.need_detail
          ? supabase.from('entry_nutrients').select('day,item,grams,kcal,protein_g,carbs_g,fat_g,micros').gte('day', plan.date_from).lte('day', plan.date_to)
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (e1 || e2) throw e1 || e2;
      // targets is already loaded with no date filter (load()'s query): resolving
      // it here avoids an extra round-trip identical to the one the Dashboard already made.
      const targetByDay = Object.fromEntries(
        datesInRange(plan.date_from, plan.date_to).map((d) => [d, resolveTarget(targets, d)]),
      );
      const contextStr = formatAskContext({ days: dt || [], targetByDay, entries: items, nutrients: plan.nutrients, lang });
      const answer = await askAnswer(q, contextStr, lang);
      setAskHistory((h) => [...h, { q, a: answer, clamped: plan.clamped }]);
    } catch {
      setAskHistory((h) => [...h, { q, a: t('No se pudo responder — intenta de nuevo'), clamped: false }]);
    } finally {
      setAskLoading(false);
    }
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

  // File suffix shared by both exports: selected phase or range.
  function rangeSlug() {
    return phaseMode ? `fase_${phaseSel.kind === 'goal' ? phaseSel.goal : phaseSel.kind}` : `${start}_${end}`;
  }

  // Processed period summary: one row per metric with the selector's ACTIVE
  // operation — the same numbers the screen renders (same
  // ms/objStats via computeMetricStats/computeObjectiveStats/bayesForMetric).
  // Without agua_ml: just like the micros table, water does not go in this list.
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

  // PDF report: same guard as the CSVs; the PDF is generated by the browser
  // ("Guardar como PDF" in the print dialog) — zero dependencies.
  function exportInforme() {
    setCsvNotice('');
    if (!registeredDays.length) {
      setCsvNotice(t('Sin registros en el rango'));
      return;
    }
    setPrinting(true);
  }

  // While the report's preview is open: light theme (paper) and the
  // file name in document.title (the dialog uses it when saving the
  // PDF). The flip applies to the entire <html>; the opaque scrim (bg-black) hides the
  // background app flipped to light. Printing is NOT automatic: the user reviews
  // and taps "Guardar PDF".
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

  // In phase mode `dates` can be non-contiguous (union of phases with the same
  // goal): the queries are still by [start, end], and `dateSet` trims client-side
  // everything indexed by individual day (items, weeks, heatmap).
  const dates = phaseMode ? phaseDays : datesInRange(start, end);
  const dateSet = new Set(dates);
  // day→row maps for the custom charts (dense nutrition data, sparse measurements).
  const nutByDay = new Map(dailyTotals.map((d) => [d.day, d]));
  const bodyByDay = new Map(bodyRows.map((d) => [d.day, d]));
  const rangeItems = phaseMode ? itemRows.filter((r) => dateSet.has(r.day)) : itemRows;
  const stats = computeStats(dates, dailyTotals, targets);
  const diasConObjetivo = dates.filter((d) => resolveTarget(targets, d)).length;

  // Inferred day completeness (tri-state, on the fly): distinct labels
  // per day (for the one-off binge) and median kcal of the last 90 days
  // (personal robust threshold).
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

  // Target phases (Fix 5): if the range spans >1 phase, the advanced
  // calculations (mediana/σ/tendencia, NOT bayes) are restricted to the current phase.
  // In phase mode the trimming does NOT apply: the user explicitly asked for that
  // set of phases, trimming it to the last one would empty the filter. The Hint
  // states that the merged phases have different objectives.
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
    crossesPhases: activePhaseDays != null, // only when the trim to the current phase is active
  };

  // If the active calculation stops meeting its minimum when the range changes, it
  // automatically falls back to Promedio (or Suma if that doesn't qualify either).
  // This is ignored while loading (dailyTotals still empty), so as not to confuse "no
  // data yet" with "range with no records".
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
  // Merging several phases leaves no "periodo previo" (previous period) that makes sense: the
  // window before the first day falls within a different regimen. The delta is hidden.
  const showDelta = !unionMode && prevStats.diasRegistrados >= 1 && (calcMode === 'suma' || calcMode === 'promedio');

  const kcalChart = withMovingAverage(chartData);

  // "Tendencia por nutriente" card: daily series of the chosen metric + its
  // daily objective (if it exists). connectNulls skips days with no record.
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
  // Period regimen used to bias the kcal band (diana): the one from the last day
  // of the selected range (the phase/goal in effect on it). null = strict band.
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

  // Macro streamgraph (kcal per macro, per day); falls back to a 100%
  // stacked bar when the range has <3 days with a record.
  const macroStreamData = chartData.map((d) => ({
    label: d.label,
    prot: d.values ? d.values.protein_g * 4 : 0,
    carb: d.values ? d.values.carbs_g * 4 : 0,
    fat: d.values ? d.values.fat_g * 9 : 0,
  }));
  const macroTotalKcal = stats.consumido.protein_g * 4 + stats.consumido.carbs_g * 4 + stats.consumido.fat_g * 9;

  // "Huella nutricional" radar: MICROS_DEFAULT micros with objective > 0,
  // % of the objective per the range's Suma-vs-objective (fixed, does not change with the selector).
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

  // PDF report row: same ms/objStats/bayes as the screen and the summary
  // CSV (summaryCells), only the format changes. Empty cell → '—' with its
  // cause stated in the report's footer, never a silent dash.
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

  // PDF report (portal to <body>, sibling of #root: under @media print the
  // entire app is hidden without hiding the report). It opens as an on-screen
  // preview — the user reviews the paper BEFORE saving; "Guardar PDF"
  // calls window.print(). The on-screen Hints do not exist on paper: their
  // causes go as footnotes instead. No hint on the Stat components, for the same reason.
  const noHint = (d) => ({ ...d, hint: null });
  function renderInforme() {
    const visibles = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favs.includes(m.key)) && m.key !== 'agua_ml');
    const anyZeroWarn = visibles.some((m) => structuralZeroInfo(registeredDays, m.key).warn);
    const sodiumLow = sodiumIsLow(stats.avgSodio, stats.diasRegistrados > 0);
    const sodiumHigh = sodiumIsHigh(stats.avgSodio, stats.diasRegistrados > 0);
    return (
      // No backdrop-blur on the scrim: backdrop-filter would turn the overlay
      // into the containing block of the fixed bar, and the bar would pan along with the paper.
      // Opaque scrim (bg-black): the JS flips data-theme='light' on the entire <html>
      // so the report renders in light mode (paper); a translucent scrim let the
      // background app, flipped to light, show through. Opaque = a clean print
      // preview, with no bleed-through.
      <div
        id="print-overlay"
        onClick={() => setPrinting(false)}
        className="fixed inset-0 z-50 overflow-auto bg-black backdrop-in"
      >
        {/* Action bar anchored to the viewport (fixed inside the overlay, which
            covers the entire screen): visible even if the paper pans on mobile. */}
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
        {/* w-fit + mx-auto: centered on desktop; on mobile (720px paper > viewport)
            the overlay pans horizontally — it's a document, not an app page. */}
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

        {/* Mediana/Bayes are distribution/adherence statistics: the heatmap
            (adherence per day, the same component as the screen) captures them
            better than a magnitude line. Suma/Promedio/σ/tendencia are
            magnitude/dispersion/direction of the raw value → line chart. */}
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
    <div className={`px-4 py-4 flex flex-col gap-4 ${refetching ? 'opacity-60 transition-opacity' : ''}`} aria-busy={refetching}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl">{t('Dashboard')}</h1>
        <div className="flex items-center gap-2">
          {GEMINI_KEY && (
            <button
              onClick={() => setAskOpen(true)}
              className="shrink-0 px-3 py-2 min-h-[44px] rounded-full text-sm whitespace-nowrap bg-surface-2 border border-border text-text-2 press"
            >
              {t('Preguntar')}
            </button>
          )}
          <ExportMenu calcLabel={calcHeader(calcMode)} onRaw={exportCSV} onResumen={exportResumenCSV} onInforme={exportInforme} />
        </div>
      </div>

      {/* The phase button lives OUTSIDE the scroller: its popover must not get
          clipped by the preset row's overflow-x. */}
      <div className="flex items-center gap-2">
        {/* Fade on the right edge: without it, the pills get cut off sharply against the
            Fases button and the cut reads like a rectangle. The pr-6 gives breathing room at the end of the
            scroll so the last pill doesn't end up under the gradient. */}
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
        </div>
        <CustomMenu
          active={preset === 'custom'}
          label={(preset === 'custom' && activeRange?.name) || t('Custom')}
          savedRanges={savedRanges}
          activeId={activeRangeId}
          onPersonalizado={newRange}
          onApply={applyRange}
          onEdit={editRange}
          onDelete={deleteRange}
        />
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

      {/* Open saved range: read-only here. Editing and deleting live exclusively in
          the menu — managing the object is not the data view's job. */}
      {preset === 'custom' && !showRangeForm && (
        <p className="font-mono text-xs text-text-3">
          {customStart} → {clampedCustomEnd} · {t('%d días').replace('%d', dates.length)}
        </p>
      )}

      {preset === 'custom' && showRangeForm && (
        <div className="flex flex-col gap-2 max-w-xl">
          <div className="flex gap-2">
            <label className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="text-xs text-text-3">{t('Inicio')}</span>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="input" />
            </label>
            <label className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="text-xs text-text-3">{t('Fin')}</span>
              {rollingEnd ? (
                <div className="input flex items-center border-dashed bg-surface text-text-3">{t('Hoy')}</div>
              ) : (
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="input" />
              )}
            </label>
          </div>
          <label className="flex items-start gap-2 py-1 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              checked={rollingEnd}
              onChange={(e) => setRollingEnd(e.target.checked)}
              className="mt-1 w-5 h-5 shrink-0 accent-[var(--accent-deep)]"
            />
            <span>
              <span className="block text-sm">{t('Hasta hoy')}</span>
              <span className="block text-xs text-text-3">{t('El rango crece solo: mañana incluirá un día más.')}</span>
            </span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={rangeName}
              onChange={(e) => setRangeName(e.target.value)}
              placeholder={t('Nombre (opcional)')}
              maxLength={40}
              className="flex-1 min-w-0 input"
            />
            <button
              onClick={saveCurrentRange}
              disabled={rangeInvalid}
              className={`shrink-0 rounded-xl px-4 text-sm font-medium press ${
                rangeInvalid ? 'bg-surface-2 text-text-3 cursor-not-allowed' : 'bg-accent-deep text-on-accent'
              }`}
            >
              {editKey ? t('Guardar cambios') : t('Guardar rango')}
            </button>
          </div>
          {rangeInvalid && <p className="text-xs text-danger">{t('La fecha de inicio va después del fin.')}</p>}
          {editKey && (
            <button onClick={() => setEditKey(null)} className="self-end text-sm text-text-2 px-3 py-2 min-h-[44px] press">
              {t('Cancelar')}
            </button>
          )}
        </div>
      )}

      {/* Tabs: reorganize the two sections under the same time-range selector,
          which governs the range for both. One visible at a time. */}
      <div role="tablist" className="flex gap-2">
        {[
          { key: 'estandar', label: t('Análisis estándar') },
          { key: 'graficas', label: t('Mis gráficas') },
        ].map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={tab === s.key}
            onClick={() => setTab(s.key)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium press ${
              tab === s.key ? 'bg-accent text-bg' : 'bg-surface-2 text-text-2 border border-border'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {tab === 'graficas' && (
        <CustomCharts
          dashboards={dashboards}
          onChange={saveDashboards}
          dates={dates}
          nutByDay={nutByDay}
          bodyByDay={bodyByDay}
          targets={targets}
        />
      )}

      {tab === 'estandar' && (
      <>
      {/* Calculation row: governs ONLY the standard analysis (KPIs, summary,
          micros, export) — that's why it lives inside this section, not above the
          custom charts (which have their own per-chart aggregation). */}
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

      {undoRange && <UndoToast message={t('Rango borrado')} onUndo={undoDeleteRange} />}

      {!undoRange && toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 text-center text-sm lg:left-auto lg:right-6 lg:bottom-6"
        >
          {toast}
        </div>
      )}

      {printing && createPortal(renderInforme(), document.body)}

      {askOpen && (
        <AskLogSheet
          history={askHistory}
          question={askQuestion}
          onQuestion={setAskQuestion}
          onSubmit={submitAsk}
          loading={askLoading}
          onClose={() => setAskOpen(false)}
        />
      )}
    </div>
  );
}

// "Pregúntale a tu bitácora" sheet: list of the session's question/answer
// pairs (no conversational thread, each question is processed on its own) + input.
// Fixed AI notice in the shared Sheet's footer (repo rule: closing on outside
// tap + stopPropagation are already provided by Sheet.jsx).
function AskLogSheet({ history, question, onQuestion, onSubmit, loading, onClose }) {
  return (
    <Sheet
      title={t('Pregúntale a tu bitácora')}
      onClose={onClose}
      footer={<p className="text-xs text-text-3">{t('Respuesta generada por IA — verifica contra el Dashboard.')}</p>}
    >
      <div className="flex flex-col gap-3">
        {history.length === 0 && !loading && (
          <p className="text-sm text-text-3">{t('Pregunta algo sobre tus registros, p. ej. "¿Cuánto sodio comí esta semana?"')}</p>
        )}
        {history.map((pair, i) => (
          <div key={i} className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text">{pair.q}</p>
            <p className="text-sm text-text-2 whitespace-pre-wrap">{pair.a}</p>
            {pair.clamped && <p className="text-xs text-warn">{t('Rango recortado a 92 días')}</p>}
          </div>
        ))}
        {loading && <p className="text-sm text-text-3">{t('Pensando…')}</p>}
      </div>
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => onQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
          disabled={loading}
          placeholder={t('Escribe tu pregunta…')}
          className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
        />
        <button
          onClick={onSubmit}
          disabled={loading || !question.trim()}
          className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium disabled:opacity-40 press"
        >
          {t('Enviar')}
        </button>
      </div>
    </Sheet>
  );
}

// Phase selector: 'actual'/'previa' (one interval) and the 4 goals (union of
// all phases with that goal). It floats over the content → `.glass`, and the
// accent over glass is --accent-glass, never --accent. Every option with no data
// is disabled with its concrete cause, never removed.
// Export menu: two scopes (raw records vs. processed summary).
// Each option's subtitle states whether the selector's operation applies
// — always visible, never behind hover (mobile-first) — and the summary's
// title names it ("Resumen del periodo — Promedio").
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

// Custom Menu: activates the custom range and lists the saved ones. The ONLY place
// where a range is edited or deleted — the data view only reads them. Anchored with
// useOutsideClose + glass, outside the presets scroller (its overflow-x
// would clip the popover), just like PhaseMenu.
function CustomMenu({ active, label, savedRanges, activeId, onPersonalizado, onApply, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, setOpen);
  const fmt = (r) => `${r.start.slice(5)} → ${r.end ? r.end.slice(5) : t('Hoy')}`; // MM-DD, like the charts' axis

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-1 px-3 py-2 min-h-[44px] max-w-[10rem] rounded-full text-sm press ${
          active ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2 border border-border'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="shrink-0">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        // w-64 is the max that fits: the popover anchors to the trigger's right
        // edge (x≈264 at 375 px), and 288 px would spill off the left.
        <div className="absolute z-50 top-full right-0 mt-1 w-64 rounded-xl border border-border p-1 shadow-lg glass">
          <button
            onClick={() => {
              setOpen(false);
              onPersonalizado();
            }}
            className={`w-full text-left rounded-lg px-3 py-2 min-h-[44px] hover:bg-surface-2 press ${
              active && !activeId ? 'text-accent-glass font-medium' : 'text-text-2'
            }`}
          >
            <span className="block text-sm">{t('Personalizado…')}</span>
            <span className="block font-mono text-[11px] text-text-3">{t('Elige un rango de fechas')}</span>
          </button>
          <div className="border-t border-border mt-1 pt-1">
            {savedRanges.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-text-3">{t('Guarda un rango para reutilizarlo aquí.')}</p>
            ) : (
              savedRanges.map((r) => (
                <div key={rangeId(r)} className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setOpen(false);
                      onApply(r);
                    }}
                    className={`flex-1 min-w-0 text-left rounded-lg px-3 py-2 min-h-[44px] hover:bg-surface-2 press ${
                      rangeId(r) === activeId ? 'text-accent-glass font-medium' : 'text-text-2'
                    }`}
                  >
                    {r.name ? (
                      <>
                        <span className="block text-sm truncate">{r.name}</span>
                        <span className="block font-mono text-[11px] text-text-3">{fmt(r)}</span>
                      </>
                    ) : (
                      <span className="block font-mono text-sm">{fmt(r)}</span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setOpen(false);
                      onEdit(r);
                    }}
                    aria-label={t('Editar rango')}
                    className="w-11 h-11 shrink-0 flex items-center justify-center text-text-3 hover:text-text press rounded-lg"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => onDelete(r)}
                    aria-label={t('Eliminar rango')}
                    className="w-11 h-11 shrink-0 flex items-center justify-center text-text-3 hover:text-danger press rounded-lg"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
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
  const fmt = (p) => `${p.label || t('Sin nombre')} · ${p.vf.slice(5)} → ${p.end.slice(5)}`; // MM-DD, like the charts' axis

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

// Visible: the first MICROS_DEFAULT + favorites (prefs). The rest only if
// they have consumed data or an objective, collapsed under "Más micros". Water never
// goes here: it has its own section above.
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
    // Row status light: 'techo' (ceiling — must not be exceeded) and 'piso' (floor — must be reached), only in modes with
    // a comparable consumed/objective pair. Sodium follows its own dual route (sodiumDanger);
    // the rest of the micros ('meta') stay neutral — a data table, not everything needs a status light.
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

// Custom mini-sparkline SVG (no Recharts, avoids extra ResponsiveContainers).
// null if there are <2 points with data.
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
