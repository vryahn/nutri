import { useState } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import Sheet from './Sheet.jsx';
import Hint from './Hint.jsx';
import { useOutsideClose } from '../lib/useOutsideClose.js';
import {
  DASH_VARS,
  DASH_VARS_BY_KEY,
  DASH_MAX_VARS,
  DASH_MAX_UNITS,
  axisUnits,
  buildDashSeries,
  bucketRows,
  resolveAgg,
  dashVarTarget,
  resolveTarget,
  round,
} from '../lib/domain.js';
import { t } from '../lib/i18n.js';

// Rotación de colores de datos (nunca --accent: reservado para la línea de
// objetivo). 4 tokens = DASH_MAX_VARS, así ninguna serie repite color.
const SERIES_COLORS = ['var(--d-prot)', 'var(--d-carb)', 'var(--d-kcal)', 'var(--d-fat)'];

const AGG_LABELS = { dia: 'Día', semana: 'Semana', mes: 'Mes' };
const RED_LABELS = { promedio: 'Promedio', suma: 'Suma', mediana: 'Mediana' };

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Agrupa DASH_VARS por categoría preservando el orden de aparición
// (Macros → micros → medidas → derivadas).
function groupByCat(vars) {
  const m = new Map();
  for (const v of vars) {
    if (!m.has(v.cat)) m.set(v.cat, []);
    m.get(v.cat).push(v);
  }
  return [...m.entries()].map(([cat, items]) => ({ cat, items }));
}

const varsOf = (keys) => keys.map((k) => DASH_VARS_BY_KEY[k]).filter(Boolean);
const defaultTitle = (keys) => varsOf(keys).map((v) => t(v.label)).join(' + ');

// ── Una gráfica ──────────────────────────────────────────────────────────────
function CustomChart({ def, dates, nutByDay, bodyByDay, targets, onEdit, onRemove, onMove, canUp, canDown }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useOutsideClose(menu, setMenu);

  const vars = varsOf(def.vars);
  const units = axisUnits(vars);
  const leftUnit = units[0];
  const rightUnit = units[1];

  const agg = resolveAgg(def.agg, dates.length); // 'auto' → día/semana/mes según rango
  const hasStock = vars.some((v) => v.kind === 'stock');
  // Suma sin sentido en medidas: si hay stock cae a promedio (el constructor ya
  // la deshabilita; esto blinda defs viejos o editados a mano).
  const reducer = def.reducer === 'suma' && hasStock ? 'promedio' : def.reducer || 'promedio';
  const series = buildDashSeries(dates, vars, nutByDay, bodyByDay, agg, reducer);

  // Objetivo solo con UNA variable de nutrición que lo tenga. Se agrega con el
  // MISMO bucket/reductor que los datos para que línea y objetivo sean comparables.
  const single = vars.length === 1 ? vars[0] : null;
  let withTarget = series;
  let hasTarget = false;
  if (single) {
    const dailyT = dates.map((day) => ({ day, __target: dashVarTarget(single, resolveTarget(targets, day)) }));
    const tByKey = new Map(bucketRows(dailyT, ['__target'], agg, reducer).map((r) => [r.day, r.__target]));
    withTarget = series.map((row) => {
      const tg = tByKey.get(row.day) ?? null;
      if (tg != null) hasTarget = true;
      return { ...row, __target: tg };
    });
  }

  const hasData = series.some((row) => vars.some((v) => row[v.key] != null));
  const axisId = (v) => (rightUnit && v.unit === rightUnit ? 'right' : 'left');
  const fmtTip = (val, name) => {
    const v = vars.find((x) => t(x.label) === name);
    return [`${round(Number(val), v?.unit === 'g' || v?.unit === '%' ? 1 : 0)}${v ? ` ${v.unit}` : ''}`, name];
  };

  return (
    <section className="rounded-2xl bg-surface border border-border p-4">
      <div className="flex justify-between items-start gap-2 mb-2">
        <p className="text-sm font-medium truncate">{def.title || defaultTitle(def.vars)}</p>
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center text-text-3 press rounded-lg"
            aria-label={t('Opciones de la gráfica')}
          >
            ⋯
          </button>
          {menu && (
            <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl bg-surface-3 border border-border py-1 shadow-lg text-sm">
              <button className="w-full text-left px-3 py-2 press hover:bg-surface-2" onClick={() => { setMenu(false); onEdit(); }}>
                {t('Editar')}
              </button>
              {canUp && (
                <button className="w-full text-left px-3 py-2 press hover:bg-surface-2" onClick={() => { setMenu(false); onMove(-1); }}>
                  {t('Subir')}
                </button>
              )}
              {canDown && (
                <button className="w-full text-left px-3 py-2 press hover:bg-surface-2" onClick={() => { setMenu(false); onMove(1); }}>
                  {t('Bajar')}
                </button>
              )}
              <button className="w-full text-left px-3 py-2 press hover:bg-surface-2 text-danger" onClick={() => { setMenu(false); onRemove(); }}>
                {t('Eliminar')}
              </button>
            </div>
          )}
        </div>
      </div>

      {!hasData ? (
        <p className="text-sm text-text-2 py-8 text-center">{t('Sin datos en el rango')}</p>
      ) : (
        <div className="h-[220px] lg:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={withTarget}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={40} domain={['auto', 'auto']} />
              {rightUnit && (
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={40} domain={['auto', 'auto']} />
              )}
              <Tooltip
                contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
                formatter={fmtTip}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-3)' }} />
              {def.type === 'bar'
                ? vars.map((v, i) => (
                    <Bar key={v.key} yAxisId={axisId(v)} dataKey={v.key} name={t(v.label)} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} isAnimationActive={!reduced} />
                  ))
                : vars.map((v, i) => (
                    <Line key={v.key} yAxisId={axisId(v)} type="monotone" dataKey={v.key} name={t(v.label)} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={!reduced} />
                  ))}
              {hasTarget && (
                <Line yAxisId="left" dataKey="__target" name={t('Objetivo')} stroke="var(--accent)" strokeDasharray="4 3" dot={false} strokeWidth={2} connectNulls isAnimationActive={!reduced} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {(agg !== 'dia' || rightUnit) && (
        <p className="text-[11px] text-text-3 mt-2">
          {agg === 'dia' ? t('Día') : `${t(AGG_LABELS[agg])} · ${t(RED_LABELS[reducer])}`}
          {rightUnit ? ` · ${t('Eje izq: %l · Eje der: %r').replace('%l', leftUnit).replace('%r', rightUnit)}` : ''}
        </p>
      )}
    </section>
  );
}

// ── Constructor (hoja modal) ─────────────────────────────────────────────────
function CustomChartSheet({ initial, onSave, onClose }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [type, setType] = useState(initial?.type || 'line');
  const [keys, setKeys] = useState(initial?.vars || []);
  const [agg, setAgg] = useState(initial?.agg || 'auto');
  const [reducer, setReducer] = useState(initial?.reducer || 'promedio');

  const selected = varsOf(keys);
  const units = [...new Set(selected.map((v) => v.unit))];
  const hasStock = selected.some((v) => v.kind === 'stock');
  // Suma solo en flow-puro. Con stock presente, el reductor efectivo es promedio
  // (conserva la intención 'suma' en el estado por si el usuario quita la medida).
  const effReducer = reducer === 'suma' && hasStock ? 'promedio' : reducer;
  const groups = groupByCat(DASH_VARS);

  function toggle(v) {
    if (keys.includes(v.key)) {
      setKeys(keys.filter((k) => k !== v.key));
      return;
    }
    if (keys.length >= DASH_MAX_VARS) return;
    if (!units.includes(v.unit) && units.length >= DASH_MAX_UNITS) return;
    setKeys([...keys, v.key]);
  }

  const disabledReason = (v) => {
    if (keys.includes(v.key)) return null;
    if (keys.length >= DASH_MAX_VARS) return t('Máximo %n variables').replace('%n', DASH_MAX_VARS);
    if (!units.includes(v.unit) && units.length >= DASH_MAX_UNITS)
      return t('Máximo %n unidades por gráfica').replace('%n', DASH_MAX_UNITS);
    return null;
  };

  const canSave = keys.length > 0;
  function save() {
    if (!canSave) return;
    onSave({
      id: initial?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      title: title.trim() || defaultTitle(keys),
      type,
      vars: keys,
      agg,
      reducer: effReducer,
    });
  }

  return (
    <Sheet
      title={initial ? t('Editar gráfica') : t('Nueva gráfica')}
      onClose={onClose}
      footer={
        <button
          onClick={save}
          disabled={!canSave}
          className={`w-full rounded-xl py-3 text-sm font-medium press ${canSave ? 'bg-accent-deep text-on-accent' : 'bg-surface-2 text-text-3 cursor-not-allowed'}`}
        >
          {t('Guardar gráfica')}
        </button>
      }
    >
      <label className="text-xs text-text-3">{t('Título')}</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={keys.length ? defaultTitle(keys) : t('Opcional')}
        className="input"
      />

      <label className="text-xs text-text-3 mt-1">{t('Tipo')}</label>
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-1">
        {[['line', 'Línea'], ['bar', 'Barras']].map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setType(k)}
            className={`flex-1 py-2 rounded-lg text-sm press ${type === k ? 'bg-accent text-bg font-medium' : 'text-text-2'}`}
          >
            {t(lbl)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 mt-1">
        <label className="text-xs text-text-3">{t('Granularidad')}</label>
        <Hint text={t('Cómo se agrupan los días en el tiempo. Auto lo decide por el rango: hasta ~mes → día, hasta ~medio año → semana, más → mes. Así un año no pinta 365 puntos.')}>
          ⓘ
        </Hint>
      </div>
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-1">
        {[['auto', 'Auto'], ['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']].map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setAgg(k)}
            className={`flex-1 py-2 rounded-lg text-xs press ${agg === k ? 'bg-accent text-bg font-medium' : 'text-text-2'}`}
          >
            {t(lbl)}
          </button>
        ))}
      </div>

      <label className="text-xs text-text-3 mt-1">{t('Reductor por bucket')}</label>
      <div className="flex bg-surface-2 border border-border rounded-xl p-1 gap-1">
        {[['promedio', 'Promedio'], ['suma', 'Suma'], ['mediana', 'Mediana']].map(([k, lbl]) => {
          const disabled = k === 'suma' && hasStock;
          return (
            <button
              key={k}
              onClick={() => setReducer(k)}
              disabled={disabled}
              title={disabled ? t('Sumar medidas no tiene sentido; usa Promedio o Mediana') : ''}
              className={`flex-1 py-2 rounded-lg text-xs press ${
                disabled ? 'text-text-3 opacity-45 cursor-not-allowed' : effReducer === k ? 'bg-accent text-bg font-medium' : 'text-text-2'
              }`}
            >
              {t(lbl)}
            </button>
          );
        })}
      </div>
      {hasStock && (
        <p className="text-[11px] text-text-3">
          {t('Suma deshabilitada: la gráfica incluye una medida (peso/circunferencia/derivada). Usa Promedio o Mediana.')}
        </p>
      )}
      {agg === 'dia' && (
        <p className="text-[11px] text-text-3">{t('En granularidad Día el reductor no aplica (un punto por día).')}</p>
      )}

      <div className="flex items-center gap-1 mt-1">
        <label className="text-xs text-text-3">
          {t('Variables')} · {keys.length}/{DASH_MAX_VARS}
        </label>
        <Hint text={t('Elige de 1 a %v variables. Con 2 unidades distintas se usan 2 ejes (izquierda y derecha), como Peso (kg) + Cintura (cm). Para una 3ª unidad, crea otra gráfica.').replace('%v', DASH_MAX_VARS)}>
          ⓘ
        </Hint>
      </div>

      {groups.map((g) => (
        <div key={g.cat}>
          <p className="text-[11px] text-text-3 mb-1 mt-1">{t(g.cat)}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((v) => {
              const on = keys.includes(v.key);
              const reason = disabledReason(v);
              return (
                <button
                  key={v.key}
                  onClick={() => toggle(v)}
                  disabled={!!reason}
                  title={reason || ''}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border press ${
                    on
                      ? 'border-accent bg-surface-3 text-text'
                      : reason
                        ? 'border-border bg-surface-2 text-text-3 opacity-45 cursor-not-allowed'
                        : 'border-border bg-surface-2 text-text-2'
                  }`}
                >
                  {t(v.label)} {on && '✕'}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

// ── Sección "Mis gráficas" ───────────────────────────────────────────────────
export default function CustomCharts({ dashboards, onChange, dates, nutByDay, bodyByDay, targets }) {
  const [editing, setEditing] = useState(null); // def a editar | 'new' | null

  const save = (def) => {
    const exists = dashboards.some((d) => d.id === def.id);
    onChange(exists ? dashboards.map((d) => (d.id === def.id ? def : d)) : [...dashboards, def]);
    setEditing(null);
  };
  const remove = (id) => onChange(dashboards.filter((d) => d.id !== id));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= dashboards.length) return;
    const next = [...dashboards];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex-1" />
        <button onClick={() => setEditing('new')} className="text-sm text-accent press">
          + {t('Nueva')}
        </button>
      </div>

      {dashboards.length === 0 ? (
        <button
          onClick={() => setEditing('new')}
          className="w-full rounded-2xl border border-dashed border-border p-6 text-center text-text-3 press"
        >
          <span className="block text-2xl text-accent mb-1">+</span>
          <span className="text-sm">{t('Crea una gráfica para cruzar cualquier variable en el tiempo')}</span>
          <span className="block text-xs text-text-3 mt-1">{t('peso, medidas, macros, micros o derivadas — línea o barras')}</span>
        </button>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dashboards.map((def, i) => (
            <CustomChart
              key={def.id}
              def={def}
              dates={dates}
              nutByDay={nutByDay}
              bodyByDay={bodyByDay}
              targets={targets}
              onEdit={() => setEditing(def)}
              onRemove={() => remove(def.id)}
              onMove={(dir) => move(i, dir)}
              canUp={i > 0}
              canDown={i < dashboards.length - 1}
            />
          ))}
        </div>
      )}

      {editing && (
        <CustomChartSheet
          initial={editing === 'new' ? null : editing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
