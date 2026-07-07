import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { MICROS, DOW_NAMES, todayISO, resolveTarget } from '../lib/domain.js';

const BLANK_ROW = () => ({ kcal: '', protein_g: '', carbs_g: '', fat_g: '', micros: {} });

export default function Targets() {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingWeek, setEditingWeek] = useState(false);
  const [weekRows, setWeekRows] = useState(() => DOW_NAMES.map(BLANK_ROW));
  const [validFrom, setValidFrom] = useState(todayISO());
  const [phaseLabel, setPhaseLabel] = useState('');
  const [addingOverride, setAddingOverride] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('targets').select('*');
    setTargets(data || []);
    setLoading(false);
  }

  const today = todayISO();
  const currentWeek = DOW_NAMES.map((_, dow) => {
    const rows = targets.filter((t) => t.dow === dow && t.valid_from <= today);
    if (rows.length === 0) return null;
    return rows.reduce((best, t) => (t.valid_from > best.valid_from ? t : best));
  });

  const overrides = targets.filter((t) => t.day != null).sort((a, b) => (a.day < b.day ? -1 : 1));

  // Versiones de semana = filas dow agrupadas por valid_from. Una "fase" es una
  // versión con label (y su semana de restauración al terminar, fin+1).
  const versionsMap = new Map();
  for (const t of targets) {
    if (t.dow == null) continue;
    const v = versionsMap.get(t.valid_from) || { valid_from: t.valid_from, label: null };
    if (t.label) v.label = t.label;
    versionsMap.set(t.valid_from, v);
  }
  const weekVersions = [...versionsMap.values()].sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  const vigenteFrom = weekVersions.find((v) => v.valid_from <= today)?.valid_from;
  const currentPhaseLabel = currentWeek.find((t) => t?.label)?.label;

  async function deleteWeekVersion(vf) {
    if (!confirm(`¿Borrar la semana que aplica desde ${vf}?`)) return;
    // solo filas dow: los overrides por fecha también tienen valid_from (default)
    await supabase.from('targets').delete().eq('valid_from', vf).not('dow', 'is', null);
    load();
  }

  function startWeekEditor(duplicateCurrent) {
    setWeekRows(
      DOW_NAMES.map((_, dow) => {
        const cur = duplicateCurrent ? currentWeek[dow] : null;
        return cur
          ? {
              kcal: cur.kcal ?? '',
              protein_g: cur.protein_g ?? '',
              carbs_g: cur.carbs_g ?? '',
              fat_g: cur.fat_g ?? '',
              micros: cur.micros || {},
            }
          : BLANK_ROW();
      })
    );
    setValidFrom(today);
    setPhaseLabel('');
    setEditingWeek(true);
  }

  function setRowField(dow, key, value) {
    setWeekRows((rows) => rows.map((r, i) => (i === dow ? { ...r, [key]: value } : r)));
  }

  function setRowMicro(dow, key, value) {
    setWeekRows((rows) =>
      rows.map((r, i) => {
        if (i !== dow) return r;
        const micros = { ...r.micros };
        if (value === '') delete micros[key];
        else micros[key] = Number(value);
        return { ...r, micros };
      })
    );
  }

  async function saveWeek() {
    const payload = weekRows.map((r, dow) => ({
      dow,
      valid_from: validFrom,
      label: phaseLabel.trim() || null,
      kcal: r.kcal === '' ? null : Number(r.kcal),
      protein_g: r.protein_g === '' ? null : Number(r.protein_g),
      carbs_g: r.carbs_g === '' ? null : Number(r.carbs_g),
      fat_g: r.fat_g === '' ? null : Number(r.fat_g),
      micros: r.micros,
    }));
    const { error } = await supabase.from('targets').insert(payload);
    if (error) {
      alert('Ya existe una semana con ese "aplica desde". Elige otra fecha.');
      return;
    }
    setEditingWeek(false);
    load();
  }

  async function deleteOverride(id) {
    if (!confirm('¿Borrar este objetivo puntual?')) return;
    await supabase.from('targets').delete().eq('id', id);
    load();
  }

  if (loading) return <div className="px-4 py-4 text-text-2">Cargando…</div>;

  return (
    <div className="px-4 py-4 flex flex-col gap-6">
      <h1 className="font-display text-xl">Objetivos</h1>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">
            Semana tipo
            {currentPhaseLabel && <span className="text-sm text-accent font-normal"> · {currentPhaseLabel}</span>}
          </h2>
          {!editingWeek && (
            <div className="flex gap-2">
              <button onClick={() => startWeekEditor(true)} className="text-sm text-accent">
                Duplicar vigente
              </button>
              <button onClick={() => startWeekEditor(false)} className="text-sm text-accent">
                Nueva
              </button>
            </div>
          )}
        </div>

        {!editingWeek && (
          <div className="grid grid-cols-1 gap-2">
            {DOW_NAMES.map((name, dow) => {
              const t = currentWeek[dow];
              return (
                <div key={dow} className="rounded-xl bg-surface border border-border p-3 flex justify-between items-center">
                  <span className="text-text-2">{name}</span>
                  {t ? (
                    <span className="font-mono tabular-nums text-sm">
                      {t.kcal ?? '–'} kcal · P{t.protein_g ?? '–'} · C{t.carbs_g ?? '–'} · G{t.fat_g ?? '–'}
                    </span>
                  ) : (
                    <span className="text-text-3 text-sm">sin objetivo</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!editingWeek && weekVersions.length > 0 && (
          <details className="rounded-xl bg-surface border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm text-text-2 py-1">Versiones y fases ({weekVersions.length})</summary>
            <div className="flex flex-col gap-2 pt-2 pb-1">
              {weekVersions.map((v) => (
                <div key={v.valid_from} className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-mono tabular-nums text-sm">{v.valid_from}</p>
                    <p className="text-xs text-text-3">
                      {v.label || 'Sin nombre'}
                      {v.valid_from === vigenteFrom && <span className="text-ok"> · vigente</span>}
                      {v.valid_from > today && <span className="text-warn"> · próxima</span>}
                    </p>
                  </div>
                  {v.valid_from > today && (
                    <button
                      onClick={() => deleteWeekVersion(v.valid_from)}
                      className="p-2 text-danger active:scale-[0.98] transition-transform duration-150"
                      aria-label={`Borrar semana del ${v.valid_from}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {editingWeek && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-text-2">Aplica desde</label>
              <input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-text-2">Nombre de fase (opcional)</label>
              <input
                value={phaseLabel}
                onChange={(e) => setPhaseLabel(e.target.value)}
                placeholder="p. ej. Mini bulk"
                className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {DOW_NAMES.map((name, dow) => (
              <div key={dow} className="rounded-xl bg-surface border border-border p-3 flex flex-col gap-2">
                <p className="font-medium">{name}</p>
                <div className="grid grid-cols-4 gap-2">
                  <MiniNumberField label="Kcal" value={weekRows[dow].kcal} onChange={(v) => setRowField(dow, 'kcal', v)} />
                  <MiniNumberField label="Prot" value={weekRows[dow].protein_g} onChange={(v) => setRowField(dow, 'protein_g', v)} />
                  <MiniNumberField label="Carbs" value={weekRows[dow].carbs_g} onChange={(v) => setRowField(dow, 'carbs_g', v)} />
                  <MiniNumberField label="Grasa" value={weekRows[dow].fat_g} onChange={(v) => setRowField(dow, 'fat_g', v)} />
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-text-3">Micros</summary>
                  <div className="grid grid-cols-4 gap-2 pt-2">
                    {MICROS.map((m) => (
                      <MiniNumberField
                        key={m.key}
                        label={m.label}
                        value={weekRows[dow].micros[m.key] ?? ''}
                        onChange={(v) => setRowMicro(dow, m.key, v)}
                      />
                    ))}
                  </div>
                </details>
              </div>
            ))}

            <div className="flex gap-2">
              <button
                onClick={() => setEditingWeek(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-border text-text-2 active:scale-[0.98] transition-transform duration-150"
              >
                Cancelar
              </button>
              <button
                onClick={saveWeek}
                className="flex-1 min-h-[44px] rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150"
              >
                Guardar
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Fechas específicas</h2>
          <button onClick={() => setAddingOverride(true)} className="p-2 text-accent" aria-label="Añadir override">
            <Plus size={20} />
          </button>
        </div>

        {overrides.length === 0 && !addingOverride && <p className="text-text-2 text-sm">Sin overrides aún</p>}

        <div className="flex flex-col gap-2">
          {overrides.map((t) => (
            <div key={t.id} className="rounded-xl bg-surface border border-border p-3 flex justify-between items-center">
              <div>
                <p className="font-medium">{t.day}</p>
                <p className="font-mono tabular-nums text-sm text-text-2">
                  {t.kcal ?? '–'} kcal · P{t.protein_g ?? '–'} · C{t.carbs_g ?? '–'} · G{t.fat_g ?? '–'}
                </p>
              </div>
              <button onClick={() => deleteOverride(t.id)} className="p-1 text-danger" aria-label="Borrar">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        {addingOverride && (
          <OverrideForm
            onCancel={() => setAddingOverride(false)}
            onSaved={() => {
              setAddingOverride(false);
              load();
            }}
          />
        )}
      </section>
    </div>
  );
}

function OverrideForm({ onCancel, onSaved }) {
  const [day, setDay] = useState(todayISO());
  const [row, setRow] = useState(BLANK_ROW());

  function setField(key, value) {
    setRow((r) => ({ ...r, [key]: value }));
  }

  function setMicro(key, value) {
    setRow((r) => {
      const micros = { ...r.micros };
      if (value === '') delete micros[key];
      else micros[key] = Number(value);
      return { ...r, micros };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      day,
      kcal: row.kcal === '' ? null : Number(row.kcal),
      protein_g: row.protein_g === '' ? null : Number(row.protein_g),
      carbs_g: row.carbs_g === '' ? null : Number(row.carbs_g),
      fat_g: row.fat_g === '' ? null : Number(row.fat_g),
      micros: row.micros,
    };
    const { error } = await supabase.from('targets').insert(payload);
    if (error) {
      alert('Ya existe un override para esa fecha.');
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-surface border border-border p-3 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">Fecha</label>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <MiniNumberField label="Kcal" value={row.kcal} onChange={(v) => setField('kcal', v)} />
        <MiniNumberField label="Prot" value={row.protein_g} onChange={(v) => setField('protein_g', v)} />
        <MiniNumberField label="Carbs" value={row.carbs_g} onChange={(v) => setField('carbs_g', v)} />
        <MiniNumberField label="Grasa" value={row.fat_g} onChange={(v) => setField('fat_g', v)} />
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-text-3">Micros</summary>
        <div className="grid grid-cols-4 gap-2 pt-2">
          {MICROS.map((m) => (
            <MiniNumberField key={m.key} label={m.label} value={row.micros[m.key] ?? ''} onChange={(v) => setMicro(m.key, v)} />
          ))}
        </div>
      </details>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 min-h-[44px] rounded-xl border border-border text-text-2 active:scale-[0.98] transition-transform duration-150"
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="flex-1 min-h-[44px] rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150"
        >
          Guardar
        </button>
      </div>
    </form>
  );
}

function MiniNumberField({ label, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-3">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] rounded-lg bg-surface-2 border border-border px-2 text-text font-mono tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}
