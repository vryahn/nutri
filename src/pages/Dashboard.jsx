import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase.js';
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
} from '../lib/domain.js';

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

  const chartData = dates.map((day) => {
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

    return {
      day,
      label: day.slice(5),
      kcal: registrado ? kcal : null,
      targetKcal: target?.kcal ?? null,
      protein: registrado ? Number(row?.protein_g || 0) : null,
      proteinFloor: target?.protein_g ?? null,
      sodio: registrado ? sodio : null,
      registrado,
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
  const [targets, setTargets] = useState([]);
  const [favs, setFavs] = useState([]); // prefs.data.fav_micros
  const [waterFoodId, setWaterFoodId] = useState(null);
  const [itemRows, setItemRows] = useState([]); // entry_nutrients del rango, para "Top alimentos"
  const [topMetric, setTopMetric] = useState('kcal');
  const [csvNotice, setCsvNotice] = useState('');
  const [loading, setLoading] = useState(true);

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
    const [{ data: dt }, { data: prevDt }, { data: tg }, { data: pf }, { data: items }] = await Promise.all([
      supabase.from('daily_totals').select('*').gte('day', start).lte('day', end),
      supabase.from('daily_totals').select('*').gte('day', prevStart).lte('day', prevEnd),
      supabase.from('targets').select('*'),
      supabase.from('prefs').select('data').maybeSingle(),
      supabase.from('entry_nutrients').select('food_id,recipe_id,item,kcal,protein_g').gte('day', start).lte('day', end),
    ]);
    setDailyTotals(dt || []);
    setPrevDailyTotals(prevDt || []);
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

  if (loading) return <div className="px-4 py-4 text-text-2">Cargando…</div>;

  const dates = datesInRange(start, end);
  const stats = computeStats(dates, dailyTotals, targets);
  const { prevStart, prevEnd } = prevRangeOf(start, end);
  const prevStats = computeStats(datesInRange(prevStart, prevEnd), prevDailyTotals, targets);
  const showDelta = prevStats.diasRegistrados >= 1;

  const kcalChart = withMovingAverage(stats.chartData);
  const dayInfo = new Map(stats.chartData.map((d) => [d.day, d]));
  const weeks = buildWeeks(start, end);
  const proteinWeekly = weeklyProteinData(weeks, start, end, dayInfo);
  const top = topItems(itemRows, waterFoodId, topMetric);
  const maxTop = top.length ? top[0][topMetric] : 0;

  const macroPie = [
    { name: 'Proteína', value: stats.consumido.protein_g * 4, color: 'var(--d-prot)' },
    { name: 'Carbs', value: stats.consumido.carbs_g * 4, color: 'var(--d-carb)' },
    { name: 'Grasa', value: stats.consumido.fat_g * 9, color: 'var(--d-fat)' },
  ].filter((s) => s.value > 0);

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

      {csvNotice && <p className="text-sm text-warn">{csvNotice}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
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
            value={stats.promedio.kcal}
            delta={showDelta ? pctDelta(stats.promedio.kcal, prevStats.promedio.kcal) : null}
            status={classifyKcal(stats.consumido.kcal, stats.objetivo.kcal)}
          />
          <KpiCard
            label="Proteína"
            value={stats.promedio.protein_g}
            delta={showDelta ? pctDelta(stats.promedio.protein_g, prevStats.promedio.protein_g) : null}
            status={classifyFloor(stats.consumido.protein_g, stats.objetivo.protein_g)}
          />
          <KpiCard
            label="Carbs"
            value={stats.promedio.carbs_g}
            delta={showDelta ? pctDelta(stats.promedio.carbs_g, prevStats.promedio.carbs_g) : null}
          />
          <KpiCard
            label="Grasa"
            value={stats.promedio.fat_g}
            delta={showDelta ? pctDelta(stats.promedio.fat_g, prevStats.promedio.fat_g) : null}
          />
          <KpiCard
            label="Sodio"
            value={stats.avgSodio}
            unit="mg"
            decimals={0}
            delta={showDelta ? pctDelta(stats.avgSodio, prevStats.avgSodio) : null}
            status={sodiumIsLow(stats.avgSodio, stats.diasRegistrados > 0) ? 'danger' : null}
          />
          <KpiCard
            label="Días"
            value={stats.diasRegistrados}
            decimals={0}
            delta={showDelta ? pctDelta(stats.diasRegistrados, prevStats.diasRegistrados) : null}
            suffix={` / ${dates.length}`}
          />
        </section>

        <section className="md:col-span-2 lg:col-span-12 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Promedio diario (÷ días registrados)</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Kcal" value={stats.promedio.kcal} color="text-d-kcal" />
            <Stat label="Prot" value={stats.promedio.protein_g} color="text-d-prot" />
            <Stat label="Carbs" value={stats.promedio.carbs_g} color="text-d-carb" />
            <Stat label="Grasa" value={stats.promedio.fat_g} color="text-d-fat" />
          </div>
        </section>

        <section className="lg:col-span-8 rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Kcal por día</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={kcalChart}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={32} />
              <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3)' }} />
              <Bar dataKey="kcal" name="Kcal" fill="var(--d-kcal)" radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} />
              {stats.objetivo.kcal > 0 && (
                <Line dataKey="targetKcal" name="Objetivo" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
              )}
              <Line dataKey="ma7" name="MA-7" stroke="var(--d-carb)" strokeDasharray="4 3" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        {macroPie.length > 0 && (
          <section className="lg:col-span-4 rounded-2xl bg-surface border border-border p-4">
            <p className="text-sm text-text-3 mb-2">Distribución de macros (kcal)</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={macroPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  label={(e) => e.name}
                  isAnimationActive={!reducedMotion}
                >
                  {macroPie.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              </PieChart>
            </ResponsiveContainer>
          </section>
        )}

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
            <ComposedChart data={stats.chartData}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={40} />
              <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              <ReferenceLine y={SODIUM_FLOOR_MG} stroke="var(--danger)" strokeDasharray="4 3" />
              <Line
                dataKey="sodio"
                name="Sodio"
                stroke="var(--d-carb)"
                strokeWidth={2}
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

        <section className="lg:col-span-6 rounded-2xl bg-surface border border-border p-4">
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
          <div key={i} className="h-3 flex items-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-1">
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => {
            const outOfRange = day < start || day > end;
            if (outOfRange) return <div key={`${wi}-${di}`} className="w-3 h-3" />;
            const info = dayInfo.get(day);
            let cls = 'bg-surface-2';
            if (info?.registrado) {
              const status = classifyKcal(info.kcal, info.targetKcal);
              cls = status ? STATUS_BG[status] : 'bg-surface-3';
            }
            return (
              <div
                key={`${wi}-${di}`}
                title={`${day}: ${info?.kcal != null ? Math.round(info.kcal) : 0} kcal`}
                className={`w-3 h-3 rounded-sm ${cls}`}
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
function MicrosTable({ favs, microsConsumido, microsObjetivo, avgSodio, diasRegistrados }) {
  const visible = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favs.includes(m.key)) && m.key !== 'agua_ml');
  const hidden = MICROS.filter(
    (m, i) =>
      i >= MICROS_DEFAULT &&
      !favs.includes(m.key) &&
      m.key !== 'agua_ml' &&
      ((microsConsumido[m.key] || 0) > 0 || (microsObjetivo[m.key] || 0) > 0)
  );

  const renderRow = (m) => {
    const c = microsConsumido[m.key] || 0;
    const o = microsObjetivo[m.key] || 0;
    const pct = o > 0 ? Math.round((c / o) * 100) : null;
    const sodiumDanger = m.key === 'sodio_mg' && sodiumIsLow(avgSodio, diasRegistrados > 0);
    return (
      <tr key={m.key} className="border-t border-border">
        <td className="py-2">{m.label}</td>
        <td className={`py-2 text-right font-mono tabular-nums ${sodiumDanger ? 'text-danger' : ''}`}>
          {Math.round(c * 10) / 10} {m.unit}
        </td>
        <td className="py-2 text-right font-mono tabular-nums text-text-2">{o ? `${Math.round(o * 10) / 10} ${m.unit}` : '–'}</td>
        <td className="py-2 text-right font-mono tabular-nums text-text-2">{pct != null ? `${pct}%` : '–'}</td>
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
            <th className="font-normal pb-2 text-right">Consumido</th>
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

function Stat({ label, value, color }) {
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg ${color}`}>{Math.round(value * 10) / 10}</p>
      <p className="text-xs text-text-3">{label}</p>
    </div>
  );
}

function KpiCard({ label, value, delta, status, unit = '', decimals = 1, suffix = '' }) {
  const f = 10 ** decimals;
  const color = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[status] || 'text-text';
  return (
    <div className="rounded-2xl bg-surface border border-border p-3">
      <p className="text-xs text-text-3">{label}</p>
      <p className={`font-mono tabular-nums text-lg ${color}`}>
        {Math.round(value * f) / f}
        {unit ? ` ${unit}` : ''}
        {suffix}
      </p>
      {delta != null && (
        <p className="text-xs text-text-2">
          {delta > 0 ? '+' : ''}
          {Math.round(delta)}% vs. anterior
        </p>
      )}
    </div>
  );
}
