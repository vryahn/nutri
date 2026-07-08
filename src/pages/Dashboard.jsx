import { useEffect, useState } from 'react';
import { ComposedChart, Bar, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../lib/supabase.js';
import {
  MICROS,
  MICROS_DEFAULT,
  todayISO,
  addDaysISO,
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

export default function Dashboard() {
  const [preset, setPreset] = useState('semana');
  const [customStart, setCustomStart] = useState(addDaysISO(todayISO(), -6));
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [dailyTotals, setDailyTotals] = useState([]);
  const [targets, setTargets] = useState([]);
  const [favs, setFavs] = useState([]); // prefs.data.fav_micros
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
    const [{ data: dt }, { data: tg }, { data: pf }] = await Promise.all([
      supabase.from('daily_totals').select('*').gte('day', start).lte('day', end),
      supabase.from('targets').select('*'),
      supabase.from('prefs').select('data').maybeSingle(),
    ]);
    setDailyTotals(dt || []);
    setTargets(tg || []);
    setFavs(pf?.data?.fav_micros || []);
    setLoading(false);
  }

  if (loading) return <div className="px-4 py-4 text-text-2">Cargando…</div>;

  const dates = datesInRange(start, end);
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
    if (kcal > 0) diasRegistrados++;

    consumido.kcal += kcal;
    consumido.protein_g += Number(row?.protein_g || 0);
    consumido.carbs_g += Number(row?.carbs_g || 0);
    consumido.fat_g += Number(row?.fat_g || 0);
    sodioTotal += Number(row?.micros?.sodio_mg || 0);

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
      day: day.slice(5),
      kcal: kcal || null,
      targetKcal: target?.kcal ?? null,
    };
  });

  const promedio = {
    kcal: diasRegistrados ? consumido.kcal / diasRegistrados : 0,
    protein_g: diasRegistrados ? consumido.protein_g / diasRegistrados : 0,
    carbs_g: diasRegistrados ? consumido.carbs_g / diasRegistrados : 0,
    fat_g: diasRegistrados ? consumido.fat_g / diasRegistrados : 0,
  };

  const avgSodio = diasRegistrados ? sodioTotal / diasRegistrados : 0;

  const macroPie = [
    { name: 'Proteína', value: consumido.protein_g * 4, color: 'var(--d-prot)' },
    { name: 'Carbs', value: consumido.carbs_g * 4, color: 'var(--d-carb)' },
    { name: 'Grasa', value: consumido.fat_g * 9, color: 'var(--d-fat)' },
  ].filter((s) => s.value > 0);

  return (
    <div className="px-4 py-4 flex flex-col gap-6">
      <h1 className="font-display text-xl">Dashboard</h1>

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

      <div className="rounded-2xl bg-surface border border-border p-4 flex justify-between items-center">
        <span className="text-text-2">Días registrados</span>
        <span className="font-mono tabular-nums text-lg">
          {diasRegistrados} / {dates.length}
        </span>
      </div>

      <section className="rounded-2xl bg-surface border border-border p-4">
        <div className="flex justify-between items-baseline mb-2">
          <p className="text-sm text-text-3">Agua</p>
          <p className="font-mono tabular-nums text-sm text-d-carb">
            {Math.round(microsConsumido.agua_ml || 0)}
            {microsObjetivo.agua_ml > 0 ? ` / ${Math.round(microsObjetivo.agua_ml)}` : ''} ml
          </p>
        </div>
        {microsObjetivo.agua_ml > 0 && (
          <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full bg-d-carb rounded-full"
              style={{ width: `${Math.min(100, ((microsConsumido.agua_ml || 0) / microsObjetivo.agua_ml) * 100)}%` }}
            />
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <AdherenceCard label="Kcal" consumed={consumido.kcal} target={objetivo.kcal} kind="kcal" />
        <AdherenceCard label="Proteína" consumed={consumido.protein_g} target={objetivo.protein_g} kind="floor" />
        <InfoCard label="Carbs" consumed={consumido.carbs_g} target={objetivo.carbs_g} />
        <InfoCard label="Grasa" consumed={consumido.fat_g} target={objetivo.fat_g} />
      </section>

      <section className="rounded-2xl bg-surface border border-border p-4">
        <p className="text-sm text-text-3 mb-2">Promedio diario (÷ días registrados)</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Kcal" value={promedio.kcal} color="text-d-kcal" />
          <Stat label="Prot" value={promedio.protein_g} color="text-d-prot" />
          <Stat label="Carbs" value={promedio.carbs_g} color="text-d-carb" />
          <Stat label="Grasa" value={promedio.fat_g} color="text-d-fat" />
        </div>
      </section>

      <section className="rounded-2xl bg-surface border border-border p-4">
        <p className="text-sm text-text-3 mb-2">Kcal por día</p>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="day" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={32} />
            <Tooltip contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <Bar dataKey="kcal" fill="var(--d-kcal)" radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} />
            {objetivo.kcal > 0 && (
              <Line dataKey="targetKcal" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      {macroPie.length > 0 && (
        <section className="rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Distribución de macros (kcal)</p>
          <ResponsiveContainer width="100%" height={200}>
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

      <MicrosTable
        favs={favs}
        microsConsumido={microsConsumido}
        microsObjetivo={microsObjetivo}
        avgSodio={avgSodio}
        diasRegistrados={diasRegistrados}
      />
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
            <tbody>{hidden.map(renderRow)}</tbody>
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

function AdherenceCard({ label, consumed, target, kind }) {
  const status = kind === 'kcal' ? classifyKcal(consumed, target) : classifyFloor(consumed, target);
  const color = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[status] || 'text-text';
  return (
    <div className="rounded-2xl bg-surface border border-border p-4">
      <p className="text-sm text-text-3">{label}</p>
      <p className={`font-mono tabular-nums text-lg ${color}`}>{Math.round(consumed * 10) / 10}</p>
      {target > 0 && <p className="text-xs text-text-3">objetivo {Math.round(target * 10) / 10}</p>}
    </div>
  );
}

function InfoCard({ label, consumed, target }) {
  const pct = target > 0 ? Math.round((consumed / target) * 100) : null;
  return (
    <div className="rounded-2xl bg-surface border border-border p-4">
      <p className="text-sm text-text-3">{label}</p>
      <p className="font-mono tabular-nums text-lg">{Math.round(consumed * 10) / 10}</p>
      {pct != null && <p className="text-xs text-text-3">{pct}% del objetivo</p>}
    </div>
  );
}
