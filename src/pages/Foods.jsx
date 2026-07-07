import { useEffect, useState } from 'react';
import { Plus, ChevronLeft, Search, Barcode } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { MICROS, mapOffProduct, mapUsdaFood } from '../lib/domain.js';

const USDA_KEY = import.meta.env.VITE_USDA_KEY;

const EMPTY_FOOD = { name: '', brand: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', micros: {}, source: 'manual' };

export default function Foods() {
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null = list view, object = form view
  const [toast, setToast] = useState('');

  useEffect(() => {
    load();
  }, [query]);

  async function load() {
    setLoading(true);
    let req = supabase.from('foods').select('*').order('name');
    if (query.trim()) req = req.ilike('name', `%${query.trim()}%`);
    const { data, error } = await req;
    if (!error) setFoods(data);
    setLoading(false);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleSave(food) {
    const payload = {
      name: food.name,
      brand: food.brand || null,
      kcal: Number(food.kcal) || 0,
      protein_g: Number(food.protein_g) || 0,
      carbs_g: Number(food.carbs_g) || 0,
      fat_g: Number(food.fat_g) || 0,
      micros: food.micros,
      source: food.source,
    };
    const { error } = food.id
      ? await supabase.from('foods').update(payload).eq('id', food.id)
      : await supabase.from('foods').insert(payload);

    if (error) {
      showToast('Error al guardar.');
      return;
    }
    showToast('Guardado.');
    setEditing(null);
    load();
  }

  async function handleDelete(id) {
    if (!confirm('¿Borrar este alimento?')) return;
    const { error } = await supabase.from('foods').delete().eq('id', id);
    if (error) {
      showToast('Tiene registros asociados, no se puede borrar.');
      return;
    }
    showToast('Borrado.');
    setEditing(null);
    load();
  }

  if (editing) {
    return (
      <FoodForm
        food={editing}
        onCancel={() => setEditing(null)}
        onSave={handleSave}
        onDelete={editing.id ? () => handleDelete(editing.id) : null}
      />
    );
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <h1 className="font-display text-xl">Alimentos</h1>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar…"
          className="w-full min-h-[44px] rounded-xl bg-surface-2 border border-border pl-10 pr-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && foods.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-text-2">Sin alimentos aún</p>
          <button
            onClick={() => setEditing(EMPTY_FOOD)}
            className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150"
          >
            Crear el primero
          </button>
        </div>
      )}

      {!loading &&
        foods.map((f) => (
          <button
            key={f.id}
            onClick={() => setEditing(f)}
            className="text-left rounded-2xl bg-surface border border-border p-4 active:scale-[0.98] transition-transform duration-150"
          >
            <div className="flex justify-between items-baseline">
              <span className="font-medium">{f.name}</span>
              <span className="font-mono tabular-nums text-text-2 text-sm">{f.kcal} kcal</span>
            </div>
            {f.brand && <span className="text-sm text-text-3">{f.brand}</span>}
          </button>
        ))}

      {!loading && foods.length > 0 && (
        <button
          onClick={() => setEditing(EMPTY_FOOD)}
          className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-text flex items-center justify-center active:scale-[0.98] transition-transform duration-150"
          aria-label="Añadir alimento"
        >
          <Plus size={24} />
        </button>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 text-center text-sm"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

async function searchOff(query) {
  const isBarcode = /^\d{8,14}$/.test(query.trim());
  if (isBarcode) {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${query.trim()}.json?fields=product_name,brands,nutriments`);
    const data = await res.json();
    return data.status === 1 ? [data.product] : [];
  }
  const res = await fetch(
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query.trim())}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,nutriments`
  );
  const data = await res.json();
  return (data.products || []).filter((p) => p.product_name);
}

async function searchUsda(query) {
  const res = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_KEY}&query=${encodeURIComponent(query.trim())}&pageSize=5`
  );
  const data = await res.json();
  return data.foods || [];
}

function FoodForm({ food, onCancel, onSave, onDelete }) {
  const [form, setForm] = useState(food);
  const [offQuery, setOffQuery] = useState('');
  const [offResults, setOffResults] = useState([]);
  const [offLoading, setOffLoading] = useState(false);
  const [offError, setOffError] = useState('');
  const [usdaQuery, setUsdaQuery] = useState('');
  const [usdaResults, setUsdaResults] = useState([]);
  const [usdaLoading, setUsdaLoading] = useState(false);
  const [usdaError, setUsdaError] = useState('');

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleOffSearch(e) {
    e.preventDefault();
    if (!offQuery.trim()) return;
    setOffLoading(true);
    setOffError('');
    try {
      const results = await searchOff(offQuery);
      if (results.length === 0) setOffError('Sin resultados.');
      setOffResults(results);
    } catch {
      setOffError('Error al buscar en Open Food Facts.');
    }
    setOffLoading(false);
  }

  function pickOffProduct(product) {
    setForm((f) => ({ ...f, ...mapOffProduct(product) }));
    setOffResults([]);
    setOffQuery('');
  }

  async function handleUsdaSearch(e) {
    e.preventDefault();
    if (!usdaQuery.trim()) return;
    setUsdaLoading(true);
    setUsdaError('');
    try {
      const results = await searchUsda(usdaQuery);
      if (results.length === 0) setUsdaError('Sin resultados.');
      setUsdaResults(results);
    } catch {
      setUsdaError('Error al buscar en USDA.');
    }
    setUsdaLoading(false);
  }

  function pickUsdaFood(food) {
    setForm((f) => ({ ...f, ...mapUsdaFood(food) }));
    setUsdaResults([]);
    setUsdaQuery('');
  }

  function setMicro(key, value) {
    setForm((f) => {
      const micros = { ...f.micros };
      if (value === '') delete micros[key];
      else micros[key] = Number(value);
      return { ...f, micros };
    });
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 active:scale-[0.98] transition-transform duration-150" aria-label="Volver">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl">{form.id ? 'Editar alimento' : 'Nuevo alimento'}</h1>
      </div>

      {!form.id && (
        <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
          <form onSubmit={handleOffSearch} className="flex gap-2">
            <input
              value={offQuery}
              onChange={(e) => setOffQuery(e.target.value)}
              placeholder="Buscar en Open Food Facts (nombre o código de barras)"
              className="flex-1 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-surface-3 border border-border flex items-center justify-center text-text-2 active:scale-[0.98] transition-transform duration-150"
              aria-label="Buscar en Open Food Facts"
            >
              <Barcode size={20} />
            </button>
          </form>
          {offLoading && <p className="text-sm text-text-3">Buscando…</p>}
          {offError && <p className="text-sm text-danger">{offError}</p>}
          {offResults.length > 0 && (
            <div className="rounded-xl bg-surface-3 border border-border overflow-hidden">
              {offResults.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickOffProduct(p)}
                  className="w-full text-left px-3 py-2 active:bg-surface-2 border-b border-border last:border-b-0"
                >
                  <p>{p.product_name}</p>
                  {p.brands && <p className="text-xs text-text-3">{p.brands}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!form.id && USDA_KEY && (
        <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
          <form onSubmit={handleUsdaSearch} className="flex gap-2">
            <input
              value={usdaQuery}
              onChange={(e) => setUsdaQuery(e.target.value)}
              placeholder="Buscar en USDA FoodData Central"
              className="flex-1 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              className="min-h-[44px] px-3 rounded-xl bg-surface-3 border border-border text-text-2 text-sm active:scale-[0.98] transition-transform duration-150"
            >
              Buscar
            </button>
          </form>
          {usdaLoading && <p className="text-sm text-text-3">Buscando…</p>}
          {usdaError && <p className="text-sm text-danger">{usdaError}</p>}
          {usdaResults.length > 0 && (
            <div className="rounded-xl bg-surface-3 border border-border overflow-hidden">
              {usdaResults.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickUsdaFood(f)}
                  className="w-full text-left px-3 py-2 active:bg-surface-2 border-b border-border last:border-b-0"
                >
                  <p>{f.description}</p>
                  {f.brandName && <p className="text-xs text-text-3">{f.brandName}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Nombre" required>
          <input
            required
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>

        <Field label="Marca">
          <input
            value={form.brand || ''}
            onChange={(e) => setField('brand', e.target.value)}
            className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>

        <p className="text-sm text-text-3">Valores por 100 g</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Kcal" value={form.kcal} onChange={(v) => setField('kcal', v)} />
          <NumberField label="Proteína (g)" value={form.protein_g} onChange={(v) => setField('protein_g', v)} />
          <NumberField label="Carbs (g)" value={form.carbs_g} onChange={(v) => setField('carbs_g', v)} />
          <NumberField label="Grasa (g)" value={form.fat_g} onChange={(v) => setField('fat_g', v)} />
        </div>

        <details className="rounded-xl bg-surface-2 border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm text-text-2 py-1">Micros (opcional)</summary>
          <div className="grid grid-cols-2 gap-3 pt-3">
            {MICROS.map((m) => (
              <NumberField
                key={m.key}
                label={`${m.label} (${m.unit})`}
                value={form.micros[m.key] ?? ''}
                onChange={(v) => setMicro(m.key, v)}
              />
            ))}
          </div>
        </details>

        <Field label="Fuente">
          <select
            value={form.source}
            onChange={(e) => setField('source', e.target.value)}
            className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="manual">Manual</option>
            <option value="off">Open Food Facts</option>
            <option value="usda">USDA</option>
          </select>
        </Field>

        <button
          type="submit"
          className="min-h-[44px] rounded-xl bg-accent-deep text-text font-medium active:scale-[0.98] transition-transform duration-150"
        >
          Guardar
        </button>

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="min-h-[44px] rounded-xl border border-danger text-danger font-medium active:scale-[0.98] transition-transform duration-150"
          >
            Borrar
          </button>
        )}
      </form>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-text-2">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </Field>
  );
}
