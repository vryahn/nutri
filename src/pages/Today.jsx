import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, X, GlassWater, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import {
  todayISO,
  addDaysISO,
  resolveTarget,
  classifyKcal,
  classifyFloor,
  sodiumIsLow,
  SODIUM_FLOOR_MG,
  SODIUM_HIGH_MG,
  POTASSIUM_HIGH_MG,
  reorderLabels,
  round,
  MICROS,
  MICROS_DEFAULT,
  microGroups,
} from '../lib/domain.js';

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
  const [userId, setUserId] = useState(null);
  const [prefs, setPrefs] = useState({ water_glass_ml: 1000, water_food_id: null });
  const [waterSettingsOpen, setWaterSettingsOpen] = useState(false);

  useEffect(() => {
    loadDay();
  }, [date]);

  useEffect(() => {
    loadLabels();
    loadRecent();
    loadTargets();
    loadPrefs();
    // LabelsModal vive en App.jsx encima de esta página: sin remount, avisa por evento.
    window.addEventListener('labels-changed', loadLabels);
    return () => window.removeEventListener('labels-changed', loadLabels);
  }, []);

  async function loadPrefs() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    if (data?.data) setPrefs((p) => ({ ...p, ...data.data }));
  }

  async function savePrefs(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await supabase.from('prefs').upsert({ owner: userId, data: next });
    return next;
  }

  // El agua se registra como entries de un food "Agua" propio (micros {agua_ml:100},
  // grams = ml). Find-or-create filtrando por owner: el catálogo es compartido en
  // lectura y el "Agua" del otro usuario no sería editable por este.
  async function getWaterFoodId() {
    // Validar el cache: un import/limpieza del catálogo pudo borrar el food y
    // dejar el id muerto (los inserts fallarían por FK en silencio).
    if (prefs.water_food_id) {
      const { data } = await supabase.from('foods').select('id').eq('id', prefs.water_food_id).maybeSingle();
      if (data) return data.id;
    }
    let { data: food } = await supabase.from('foods').select('id').eq('name', 'Agua').eq('owner', userId).maybeSingle();
    if (!food) {
      ({ data: food } = await supabase
        .from('foods')
        .insert({ name: 'Agua', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, micros: { agua_ml: 100 }, source: 'manual' })
        .select('id')
        .single());
    }
    await savePrefs({ water_food_id: food.id });
    return food.id;
  }

  async function addWater(ml) {
    if (!userId || !(ml > 0)) return;
    const foodId = await getWaterFoodId();
    const { error } = await supabase.from('entries').insert({ day: date, grams: ml, food_id: foodId });
    if (error) {
      showToast('Error al registrar agua.');
      return;
    }
    loadDay();
  }

  async function undoWater() {
    const last = waterEntries[waterEntries.length - 1];
    if (!last) return;
    await supabase.from('entries').delete().eq('id', last.id);
    loadDay();
  }

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
    // El agua no se copia: se registra con los vasos del día.
    const toCopy = prevEntries?.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id)) || [];
    if (toCopy.length === 0) {
      showToast('El día anterior no tiene registros.');
      return;
    }
    const rows = toCopy.map((e) => ({ ...e, day: date }));
    const { error } = await supabase.from('entries').insert(rows);
    if (error) {
      showToast('Error al copiar.');
      return;
    }
    showToast(`${rows.length} registros copiados.`);
    loadDay();
    loadRecent();
  }

  const waterEntries = entries.filter((e) => e.food_id && e.food_id === prefs.water_food_id);
  const foodEntries = entries.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id));
  const waterMl = waterEntries.reduce((s, e) => s + Number(e.grams), 0); // densidad 1: grams = ml

  const totals = foodEntries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + Number(e.kcal),
      protein_g: acc.protein_g + Number(e.protein_g),
      carbs_g: acc.carbs_g + Number(e.carbs_g),
      fat_g: acc.fat_g + Number(e.fat_g),
      sodio_mg: acc.sodio_mg + Number(e.micros?.sodio_mg || 0),
      potasio_mg: acc.potasio_mg + Number(e.micros?.potasio_mg || 0),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodio_mg: 0, potasio_mg: 0 }
  );

  const target = resolveTarget(targets, date);
  const kcalStatus = classifyKcal(totals.kcal, target?.kcal);
  const proteinStatus = classifyFloor(totals.protein_g, target?.protein_g);
  const statusColor = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' };
  const sodiumLow = sodiumIsLow(totals.sodio_mg, foodEntries.length > 0);

  const groups = groupByLabel(foodEntries, labels);

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

      <WaterCard
        waterMl={waterMl}
        goalMl={Number(target?.micros?.agua_ml) || 0}
        glassMl={prefs.water_glass_ml}
        onGlass={() => addWater(prefs.water_glass_ml)}
        onUndo={undoWater}
        onCustom={addWater}
        onSettings={() => setWaterSettingsOpen(true)}
      />

      <div className="rounded-2xl bg-surface border border-border p-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Kcal" value={totals.kcal} color={statusColor[kcalStatus] || 'text-d-kcal'} target={target?.kcal} />
        <Stat label="Prot" value={totals.protein_g} color={statusColor[proteinStatus] || 'text-d-prot'} target={target?.protein_g} />
        <Stat label="Carbs" value={totals.carbs_g} color="text-d-carb" target={target?.carbs_g} />
        <Stat label="Grasa" value={totals.fat_g} color="text-d-fat" target={target?.fat_g} />
        <Stat label="Sodio" value={totals.sodio_mg} color="text-danger" target={target?.micros?.sodio_mg} decimals={0} />
        <Stat label="Potasio" value={totals.potasio_mg} color="text-warn" target={target?.micros?.potasio_mg} decimals={0} />
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
            {g.items.map((e) => {
              const macros = [
                Number(e.protein_g) > 0 && `P ${round(Number(e.protein_g), 1)}`,
                Number(e.carbs_g) > 0 && `C ${round(Number(e.carbs_g), 1)}`,
                Number(e.fat_g) > 0 && `G ${round(Number(e.fat_g), 1)}`,
              ].filter(Boolean);
              const highNa = Number(e.micros?.sodio_mg || 0) >= SODIUM_HIGH_MG;
              const highK = Number(e.micros?.potasio_mg || 0) >= POTASSIUM_HIGH_MG;
              return (
                <button
                  key={e.id}
                  onClick={() => setEditing(e)}
                  className="text-left rounded-2xl bg-surface border border-border p-3 flex justify-between items-center active:scale-[0.98] transition-transform duration-150"
                >
                  <div>
                    <p className="font-medium">{e.item}</p>
                    <p className="text-sm text-text-3 font-mono tabular-nums">
                      {e.grams} g{macros.length > 0 ? ` · ${macros.join(' ')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {highNa && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-danger/20 text-danger">Na</span>}
                    {highK && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-warn/20 text-warn">K</span>}
                    <span className="font-mono tabular-nums text-text-2">{e.kcal} kcal</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}

      <button
        onClick={() => setAdding({ labelId: null })}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-text flex items-center justify-center active:scale-[0.98] transition-transform duration-150"
        aria-label="Añadir registro"
      >
        <Plus size={24} />
      </button>

      {waterSettingsOpen && (
        <Sheet title="Ajustes de agua" onClose={() => setWaterSettingsOpen(false)}>
          <WaterSettingsForm
            glassMl={prefs.water_glass_ml}
            onSave={(ml) => {
              savePrefs({ water_glass_ml: ml });
              setWaterSettingsOpen(false);
            }}
          />
        </Sheet>
      )}

      {adding && (
        <AddEntrySheet
          date={date}
          labels={labels}
          recent={recent}
          waterFoodId={prefs.water_food_id}
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
          favMicros={prefs.fav_micros || []}
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

function WaterCard({ waterMl, goalMl, glassMl, onGlass, onUndo, onCustom, onSettings }) {
  const [customMl, setCustomMl] = useState('');
  const filled = glassMl > 0 ? Math.floor(waterMl / glassMl) : 0;
  // ponytail: tope de 16 vasos por si el objetivo/vaso da un número absurdo
  const count = Math.min(Math.max(goalMl > 0 ? Math.ceil(goalMl / glassMl) : 3, filled + 1), 16);
  const pct = goalMl > 0 ? Math.min(100, (waterMl / goalMl) * 100) : 0;

  return (
    <section className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          Agua{' '}
          <span className="text-sm text-text-3 font-mono tabular-nums">
            {Math.round(waterMl)}{goalMl > 0 ? ` / ${goalMl}` : ''} ml
          </span>
        </h2>
        <button
          onClick={onSettings}
          className="p-2 -mr-2 text-text-3 active:scale-[0.98] transition-transform duration-150"
          aria-label="Ajustes de agua"
        >
          <Settings size={18} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: count }, (_, i) => {
          const isFilled = i < filled;
          return (
            <button
              key={i}
              onClick={() => (isFilled ? onUndo() : onGlass())}
              className={`relative w-11 h-11 rounded-xl border border-border flex items-center justify-center active:scale-[0.98] transition-transform duration-150 ${
                isFilled ? 'bg-surface-2 text-d-carb' : 'text-text-3'
              }`}
              aria-label={isFilled ? 'Quitar último registro de agua' : `Añadir vaso de ${glassMl} ml`}
            >
              <GlassWater size={22} />
              {i === filled && <Plus size={11} className="absolute top-1 right-1 text-text-2" />}
            </button>
          );
        })}
      </div>

      {goalMl > 0 && (
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
          <div className="h-full bg-d-carb rounded-full" style={{ width: `${pct}%` }} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (Number(customMl) > 0) {
            onCustom(Number(customMl));
            setCustomMl('');
          }
        }}
        className="flex gap-2"
      >
        <input
          type="number"
          inputMode="decimal"
          min="1"
          step="any"
          value={customMl}
          onChange={(e) => setCustomMl(e.target.value)}
          placeholder="Cantidad personalizada (ml)"
          className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          className="min-h-[44px] px-4 rounded-xl border border-border text-text-2 active:scale-[0.98] transition-transform duration-150"
        >
          Añadir
        </button>
      </form>
    </section>
  );
}

function WaterSettingsForm({ glassMl, onSave }) {
  const [ml, setMl] = useState(String(glassMl));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (Number(ml) > 0) onSave(Number(ml));
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">Tamaño de vaso (ml)</label>
        <input
          type="number"
          inputMode="decimal"
          min="1"
          step="any"
          required
          value={ml}
          onChange={(e) => setMl(e.target.value)}
          className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <button
        type="submit"
        className="min-h-[44px] rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150"
      >
        Guardar
      </button>
    </form>
  );
}

function Stat({ label, value, color, target, decimals = 1 }) {
  const pct = target > 0 ? Math.round((value / target) * 100) : null;
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg ${color}`}>{round(value, decimals)}</p>
      <p className="text-xs text-text-3">{label}</p>
      {target > 0 && (
        <p className="text-xs text-text-3 font-mono tabular-nums">
          /{round(target, decimals)} · {pct}%
        </p>
      )}
    </div>
  );
}

// Valores por 100 g (kcal, macros, micros) + porciones/densidad (solo foods,
// para chips y toggle g/ml) del food o receta seleccionado.
function useFoodMeta(foodId, recipeId) {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    if (!foodId && !recipeId) {
      setMeta(null);
      return;
    }
    if (foodId) {
      supabase
        .from('foods')
        .select('kcal, protein_g, carbs_g, fat_g, micros, portions, density_g_ml')
        .eq('id', foodId)
        .maybeSingle()
        .then(({ data }) => setMeta(data));
    } else {
      supabase
        .from('recipe_per_100g')
        .select('kcal, protein_g, carbs_g, fat_g, micros')
        .eq('recipe_id', recipeId)
        .maybeSingle()
        .then(({ data }) => setMeta(data));
    }
  }, [foodId, recipeId]);
  return meta;
}

// Cantidad de un registro: siempre reporta GRAMOS via onGrams (la DB solo conoce gramos).
// Si el food tiene densidad, permite capturar en ml (ml × densidad → g).
// Cada chip de porción SUMA sus gramos (2 taps de «vaso» = 2 vasos).
function AmountField({ grams, onGrams, meta }) {
  const [unit, setUnit] = useState('g');
  const [ml, setMl] = useState('');
  const density = Number(meta?.density_g_ml) || 0;
  const portions = meta?.portions || [];

  function typeAmount(v) {
    if (unit === 'ml') {
      setMl(v);
      onGrams(v === '' ? '' : String(round(Number(v) * density, 1)));
    } else {
      onGrams(v);
    }
  }

  function switchUnit(u) {
    if (u === unit) return;
    setUnit(u);
    if (u === 'ml') setMl(grams === '' ? '' : String(round(Number(grams) / density, 1)));
  }

  function addPortion(p) {
    const g = round((Number(grams) || 0) + Number(p.grams), 1);
    onGrams(String(g));
    if (unit === 'ml') setMl(String(round(g / density, 1)));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-text-2">{unit === 'ml' ? 'Mililitros' : 'Gramos'}</label>
        {density > 0 && (
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {['g', 'ml'].map((u) => (
              <button
                type="button"
                key={u}
                onClick={() => switchUnit(u)}
                className={`px-4 py-1.5 ${unit === u ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2'}`}
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        required
        value={unit === 'ml' ? ml : grams}
        onChange={(e) => typeAmount(e.target.value)}
        className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {unit === 'ml' && grams !== '' && (
        <p className="text-xs text-text-3 font-mono tabular-nums">≈ {grams} g (densidad {density} g/ml)</p>
      )}
      {portions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {portions.map((p) => (
            <button
              type="button"
              key={p.name}
              onClick={() => addPortion(p)}
              className="px-3 py-2 rounded-full bg-surface-2 border border-border text-sm active:scale-[0.98] transition-transform duration-150"
            >
              + {p.name} ({p.grams} g)
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddEntrySheet({ date, labels, recent, waterFoodId, initialLabelId, onClose, onAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null); // { id, name, type }
  const [grams, setGrams] = useState('');
  const [labelId, setLabelId] = useState(initialLabelId || '');
  const foodMeta = useFoodMeta(selected?.type === 'food' ? selected.id : null);

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
        // el Agua se registra desde su tarjeta, no como comida
        ...(foods || []).filter((f) => f.id !== waterFoodId).map((f) => ({ ...f, type: 'food' })),
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
      {!selected && recent.filter((r) => !(r.food_id && r.food_id === waterFoodId)).length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-3">Recientes</p>
          <div className="flex flex-wrap gap-2">
            {recent.filter((r) => !(r.food_id && r.food_id === waterFoodId)).map((r) => (
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
          <AmountField grams={grams} onGrams={setGrams} meta={foodMeta} />

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

function EditEntrySheet({ entry, labels, favMicros, onClose, onDelete, onSaved }) {
  const [grams, setGrams] = useState(String(entry.grams));
  const [labelId, setLabelId] = useState(entry.meal_label_id || '');
  const foodMeta = useFoodMeta(entry.food_id, entry.recipe_id);

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
        <AmountField grams={grams} onGrams={setGrams} meta={foodMeta} />

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

      <AportaPanel grams={grams} meta={foodMeta} favMicros={favMicros} />
    </Sheet>
  );
}

// Panel read-only: kcal/macros/micros que aporta la cantidad actual (grams),
// escalando los valores por 100 g del food/receta. Nunca se persiste.
function AportaPanel({ grams, meta, favMicros }) {
  if (!meta) return null;
  const factor = (Number(grams) || 0) / 100;
  const scale = (v, decimals) => round(Number(v || 0) * factor, decimals);

  const visible = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favMicros.includes(m.key)) && m.key !== 'agua_ml');
  const hidden = MICROS.filter((m, i) => i >= MICROS_DEFAULT && !favMicros.includes(m.key) && m.key !== 'agua_ml');

  const microRow = (m) => {
    const v = scale(meta.micros?.[m.key], 2);
    return (
      <div key={m.key} className="flex justify-between py-1.5 border-t border-border text-sm">
        <span className="text-text-2">{m.label}</span>
        <span className={`font-mono tabular-nums ${v === 0 ? 'text-text-3' : ''}`}>
          {v} {m.unit}
        </span>
      </div>
    );
  };

  return (
    <section className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col">
      <p className="text-sm text-text-3 mb-2">Aporta</p>
      <div className="grid grid-cols-4 gap-2 text-center pb-3 border-b border-border">
        <AportaStat label="Kcal" value={scale(meta.kcal, 1)} color="text-d-kcal" />
        <AportaStat label="Prot" value={scale(meta.protein_g, 1)} color="text-d-prot" unit="g" />
        <AportaStat label="Carbs" value={scale(meta.carbs_g, 1)} color="text-d-carb" unit="g" />
        <AportaStat label="Grasa" value={scale(meta.fat_g, 1)} color="text-d-fat" unit="g" />
      </div>
      {visible.map(microRow)}
      {hidden.length > 0 && (
        <details className="mt-1">
          <summary className="min-h-[44px] flex items-center cursor-pointer text-sm text-text-2">Más micros ({hidden.length})</summary>
          {microGroups(hidden).flatMap(({ cat, items }) => [
            <p key={cat} className="pt-3 pb-1 text-xs uppercase tracking-wide text-text-3">
              {cat}
            </p>,
            ...items.map(microRow),
          ])}
        </details>
      )}
    </section>
  );
}

function AportaStat({ label, value, color, unit }) {
  const isZero = value === 0;
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg ${isZero ? 'text-text-3' : color}`}>
        {value}
        {unit ? ` ${unit}` : ''}
      </p>
      <p className="text-xs text-text-3">{label}</p>
    </div>
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
