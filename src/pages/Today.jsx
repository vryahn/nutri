import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { todayISO, addDaysISO, resolveTarget, classifyKcal, classifyFloor, sodiumIsLow, SODIUM_FLOOR_MG, reorderLabels } from '../lib/domain.js';

export default function Today() {
  const [date, setDate] = useState(todayISO());
  const [entries, setEntries] = useState([]);
  const [labels, setLabels] = useState([]);
  const [recent, setRecent] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null); // { labelId } | null
  const [editing, setEditing] = useState(null); // entry being edited
  const [toast, setToast] = useState('');

  useEffect(() => {
    loadDay();
  }, [date]);

  useEffect(() => {
    loadLabels();
    loadRecent();
    loadTargets();
  }, []);

  async function loadTargets() {
    const { data } = await supabase.from('targets').select('*');
    setTargets(data || []);
  }

  async function loadDay() {
    setLoading(true);
    const { data } = await supabase
      .from('entry_nutrients')
      .select('*')
      .eq('day', date)
      .order('created_at');
    setEntries(data || []);
    setLoading(false);
  }

  async function loadLabels() {
    const { data } = await supabase.from('meal_labels').select('*').order('sort_order');
    setLabels(data || []);
  }

  async function loadRecent() {
    const { data } = await supabase
      .from('entry_nutrients')
      .select('food_id, recipe_id, item, grams')
      .order('created_at', { ascending: false })
      .limit(40);
    if (!data) return;
    const seen = new Set();
    const uniques = [];
    for (const e of data) {
      const key = e.food_id || e.recipe_id;
      if (seen.has(key)) continue;
      seen.add(key);
      uniques.push(e);
      if (uniques.length >= 8) break;
    }
    setRecent(uniques);
  }

  async function moveLabel(index, dir) {
    const updates = reorderLabels(labels, index, dir);
    if (updates.length === 0) return;
    await Promise.all(updates.map((u) => supabase.from('meal_labels').update({ sort_order: u.sort_order }).eq('id', u.id)));
    loadLabels();
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleDelete(id) {
    if (!confirm('¿Borrar este registro?')) return;
    await supabase.from('entries').delete().eq('id', id);
    loadDay();
  }

  async function handleCopyPrevDay() {
    const prevDay = addDaysISO(date, -1);
    const { data: prevEntries } = await supabase
      .from('entries')
      .select('meal_label_id, food_id, recipe_id, grams')
      .eq('day', prevDay);
    if (!prevEntries || prevEntries.length === 0) {
      showToast('El día anterior no tiene registros.');
      return;
    }
    const rows = prevEntries.map((e) => ({ ...e, day: date }));
    const { error } = await supabase.from('entries').insert(rows);
    if (error) {
      showToast('Error al copiar.');
      return;
    }
    showToast(`${rows.length} registros copiados.`);
    loadDay();
    loadRecent();
  }

  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + Number(e.kcal),
      protein_g: acc.protein_g + Number(e.protein_g),
      carbs_g: acc.carbs_g + Number(e.carbs_g),
      fat_g: acc.fat_g + Number(e.fat_g),
      sodio_mg: acc.sodio_mg + Number(e.micros?.sodio_mg || 0),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodio_mg: 0 }
  );

  const target = resolveTarget(targets, date);
  const kcalStatus = classifyKcal(totals.kcal, target?.kcal);
  const proteinStatus = classifyFloor(totals.protein_g, target?.protein_g);
  const statusColor = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' };
  const sodiumLow = sodiumIsLow(totals.sodio_mg, entries.length > 0);

  const groups = groupByLabel(entries, labels);

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setDate(addDaysISO(date, -1))} className="p-2 active:scale-[0.98] transition-transform duration-150" aria-label="Día anterior">
          <ChevronLeft size={22} />
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-transparent text-center font-display text-lg focus:outline-none"
        />
        <button onClick={() => setDate(addDaysISO(date, 1))} className="p-2 active:scale-[0.98] transition-transform duration-150" aria-label="Día siguiente">
          <ChevronRight size={22} />
        </button>
      </div>

      <div className="rounded-2xl bg-surface border border-border p-4 grid grid-cols-4 gap-2 text-center">
        <Stat label="Kcal" value={totals.kcal} color={statusColor[kcalStatus] || 'text-d-kcal'} target={target?.kcal} />
        <Stat label="Prot" value={totals.protein_g} color={statusColor[proteinStatus] || 'text-d-prot'} target={target?.protein_g} />
        <Stat label="Carbs" value={totals.carbs_g} color="text-d-carb" target={target?.carbs_g} />
        <Stat label="Grasa" value={totals.fat_g} color="text-d-fat" target={target?.fat_g} />
      </div>

      {sodiumLow && (
        <p className="text-sm text-danger" role="status" aria-live="polite">
          ⚠ sodio &lt; {SODIUM_FLOOR_MG} mg
        </p>
      )}

      <button
        onClick={handleCopyPrevDay}
        className="min-h-[44px] rounded-xl border border-border text-text-2 active:scale-[0.98] transition-transform duration-150"
      >
        Copiar día anterior
      </button>

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && labels.length === 0 && (
        <p className="text-text-2 text-center py-6">Sin registros este día</p>
      )}

      {!loading &&
        groups.map((g, i) => (
          <div key={g.id ?? 'none'} className="flex flex-col gap-2">
            <div className="flex items-center justify-between min-h-[44px]">
              <h2 className="text-sm text-text-3">{g.name}</h2>
              {g.id != null && (
                <div className="flex items-center -mr-2.5">
                  <button
                    onClick={() => moveLabel(i, -1)}
                    disabled={i === 0}
                    className="p-2.5 text-text-3 disabled:opacity-30 active:scale-[0.98] transition-transform duration-150"
                    aria-label={`Subir ${g.name}`}
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    onClick={() => moveLabel(i, 1)}
                    disabled={i === labels.length - 1}
                    className="p-2.5 text-text-3 disabled:opacity-30 active:scale-[0.98] transition-transform duration-150"
                    aria-label={`Bajar ${g.name}`}
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button
                    onClick={() => setAdding({ labelId: g.id })}
                    className="p-2.5 text-accent active:scale-[0.98] transition-transform duration-150"
                    aria-label={`Añadir a ${g.name}`}
                  >
                    <Plus size={20} />
                  </button>
                </div>
              )}
            </div>
            {g.items.map((e) => (
              <button
                key={e.id}
                onClick={() => setEditing(e)}
                className="text-left rounded-2xl bg-surface border border-border p-3 flex justify-between items-center active:scale-[0.98] transition-transform duration-150"
              >
                <div>
                  <p className="font-medium">{e.item}</p>
                  <p className="text-sm text-text-3 font-mono tabular-nums">{e.grams} g</p>
                </div>
                <span className="font-mono tabular-nums text-text-2">{e.kcal} kcal</span>
              </button>
            ))}
          </div>
        ))}

      <button
        onClick={() => setAdding({ labelId: null })}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-text flex items-center justify-center active:scale-[0.98] transition-transform duration-150"
        aria-label="Añadir registro"
      >
        <Plus size={24} />
      </button>

      {adding && (
        <AddEntrySheet
          date={date}
          labels={labels}
          recent={recent}
          initialLabelId={adding.labelId}
          onClose={() => setAdding(null)}
          onAdded={() => {
            setAdding(null);
            loadDay();
            loadRecent();
          }}
        />
      )}

      {editing && (
        <EditEntrySheet
          entry={editing}
          labels={labels}
          onClose={() => setEditing(null)}
          onDelete={() => {
            handleDelete(editing.id);
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            loadDay();
          }}
        />
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 text-center text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

// Una sección por cada etiqueta (aunque esté vacía), en el orden de `labels`
// (ya vienen por sort_order); "Sin etiqueta" al final solo si tiene items.
function groupByLabel(entries, labels) {
  const groups = labels.map((l) => ({ id: l.id, name: l.name, items: [] }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const none = { id: null, name: 'Sin etiqueta', items: [] };
  for (const e of entries) {
    (byId.get(e.meal_label_id) ?? none).items.push(e);
  }
  return none.items.length > 0 ? [...groups, none] : groups;
}

function Stat({ label, value, color, target }) {
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg ${color}`}>{Math.round(value * 10) / 10}</p>
      <p className="text-xs text-text-3">{label}</p>
      {target > 0 && <p className="text-xs text-text-3 font-mono tabular-nums">/{target}</p>}
    </div>
  );
}

function AddEntrySheet({ date, labels, recent, initialLabelId, onClose, onAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null); // { id, name, type }
  const [grams, setGrams] = useState('');
  const [labelId, setLabelId] = useState(initialLabelId || '');

  useEffect(() => {
    if (!query.trim() || selected) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const [{ data: foods }, { data: recipes }] = await Promise.all([
        supabase.from('foods').select('id,name').ilike('name', `%${query.trim()}%`).limit(8),
        supabase.from('recipes').select('id,name').ilike('name', `%${query.trim()}%`).limit(8),
      ]);
      setResults([
        ...(foods || []).map((f) => ({ ...f, type: 'food' })),
        ...(recipes || []).map((r) => ({ ...r, type: 'recipe' })),
      ]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function pick(item, presetGrams) {
    setSelected(item);
    setQuery(item.name);
    setResults([]);
    if (presetGrams) setGrams(String(presetGrams));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selected || !grams) return;
    const payload = {
      day: date,
      grams: Number(grams),
      meal_label_id: labelId || null,
      food_id: selected.type === 'food' ? selected.id : null,
      recipe_id: selected.type === 'recipe' ? selected.id : null,
    };
    const { error } = await supabase.from('entries').insert(payload);
    if (!error) onAdded();
  }

  return (
    <Sheet title="Añadir registro" onClose={onClose}>
      {!selected && recent.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-3">Recientes</p>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <button
                key={(r.food_id || r.recipe_id) + r.item}
                onClick={() => pick({ id: r.food_id || r.recipe_id, name: r.item, type: r.food_id ? 'food' : 'recipe' }, r.grams)}
                className="px-3 py-2 rounded-full bg-surface-2 border border-border text-sm active:scale-[0.98] transition-transform duration-150"
              >
                {r.item}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">Alimento o receta</label>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Buscar…"
          className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {results.length > 0 && (
          <div className="rounded-xl bg-surface-2 border border-border overflow-hidden">
            {results.map((r) => (
              <button
                key={r.type + r.id}
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 flex justify-between active:bg-surface-3"
              >
                <span>{r.name}</span>
                {r.type === 'recipe' && <span className="text-xs text-text-3">receta</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-2">Gramos</label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              required
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-2">Etiqueta</label>
            <select
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Sin etiqueta</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150"
          >
            Registrar
          </button>
        </form>
      )}
    </Sheet>
  );
}

function EditEntrySheet({ entry, labels, onClose, onDelete, onSaved }) {
  const [grams, setGrams] = useState(String(entry.grams));
  const [labelId, setLabelId] = useState(entry.meal_label_id || '');

  async function handleSubmit(e) {
    e.preventDefault();
    const { error } = await supabase
      .from('entries')
      .update({ grams: Number(grams), meal_label_id: labelId || null })
      .eq('id', entry.id);
    if (!error) onSaved();
  }

  return (
    <Sheet title={entry.item} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm text-text-2">Gramos</label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            required
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm text-text-2">Etiqueta</label>
          <select
            value={labelId}
            onChange={(e) => setLabelId(e.target.value)}
            className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Sin etiqueta</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="min-h-[44px] rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150">
          Guardar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="min-h-[44px] rounded-xl border border-danger text-danger font-medium active:scale-[0.98] transition-transform duration-150"
        >
          Borrar
        </button>
      </form>
    </Sheet>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="w-full sm:max-w-sm bg-surface-3 rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">{title}</h2>
          <button onClick={onClose} className="p-2 -mr-2 active:scale-[0.98] transition-transform duration-150" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
