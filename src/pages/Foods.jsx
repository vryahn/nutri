import { useEffect, useState } from 'react';
import { Plus, ChevronLeft, Search, Sparkles, ImagePlus, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { MICROS, MICROS_DEFAULT, round } from '../lib/domain.js';

const GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY;

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

const GEMINI_PROMPT = `Eres un asistente de nutrición. Estima la información nutrimental de un alimento, producto o platillo y devuélvela SIEMPRE por 100 gramos de porción comestible. Prioriza productos y platillos comunes en México (marcas y preparaciones mexicanas). Si no hay etiqueta, basa la estimación en datos tipo USDA FoodData Central. Si la imagen es una etiqueta nutrimental, lee los valores declarados y normalízalos a 100 g usando el tamaño de porción declarado (p. ej. porción de 30 g → multiplica cada valor por 100/30). Si la imagen es un platillo, estima a partir de los ingredientes visibles y su proporción. Unidades: kcal en kcal; protein_g, carbs_g, fat_g, grasa_sat_g, grasa_trans_g, azucar_g, azucar_anadido_g, fibra_g y alcohol_g en gramos; sodio_mg, potasio_mg, magnesio_mg, calcio_mg y hierro_mg en miligramos; agua_ml en mililitros. Omite (null) los micros que no puedas estimar con confianza razonable; no inventes. "name" corto en español; "brand" solo si es identificable.`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    brand: { type: 'STRING', nullable: true },
    kcal: { type: 'NUMBER' },
    protein_g: { type: 'NUMBER' },
    carbs_g: { type: 'NUMBER' },
    fat_g: { type: 'NUMBER' },
    micros: {
      type: 'OBJECT',
      properties: Object.fromEntries(MICROS.map((m) => [m.key, { type: 'NUMBER', nullable: true }])),
    },
  },
  required: ['name', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'micros'],
};

// Comprime la foto antes de mandarla inline (una foto de móvil sin comprimir pesa varios MB).
async function toJpegBase64(file, maxSide = 1024) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

async function estimateFood(text, imageFile) {
  const parts = [{ text: text.trim() || 'Analiza la imagen.' }];
  if (imageFile) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegBase64(imageFile) } });
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: GEMINI_PROMPT }] },
      contents: [{ parts }],
      generationConfig: { response_mime_type: 'application/json', response_schema: GEMINI_SCHEMA },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const out = JSON.parse(data.candidates[0].content.parts[0].text);
  const micros = Object.fromEntries(
    Object.entries(out.micros || {}).filter(([k, v]) => v != null && MICROS.some((m) => m.key === k))
  );
  return {
    name: out.name || '',
    brand: out.brand || '',
    kcal: out.kcal ?? '',
    protein_g: out.protein_g ?? '',
    carbs_g: out.carbs_g ?? '',
    fat_g: out.fat_g ?? '',
    micros,
    source: 'gemini',
  };
}

function FoodForm({ food, onCancel, onSave, onDelete }) {
  const [form, setForm] = useState(food);
  const [basis, setBasis] = useState('100'); // gramos a los que refieren los valores capturados

  // La DB siempre guarda por 100 g: si el usuario capturó por otra base, se escala al guardar.
  function normalizeTo100(f) {
    const b = Number(basis);
    if (!b || b <= 0 || b === 100) return f;
    const s = 100 / b;
    const scale = (v, d) => (v === '' || v == null ? v : round(Number(v) * s, d));
    return {
      ...f,
      kcal: scale(f.kcal, 1),
      protein_g: scale(f.protein_g, 2),
      carbs_g: scale(f.carbs_g, 2),
      fat_g: scale(f.fat_g, 2),
      micros: Object.fromEntries(Object.entries(f.micros).map(([k, v]) => [k, round(Number(v) * s, 3)])),
    };
  }
  const [aiText, setAiText] = useState('');
  const [aiFile, setAiFile] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleEstimate() {
    if (!aiText.trim() && !aiFile) return;
    setAiLoading(true);
    setAiError('');
    try {
      const estimated = await estimateFood(aiText, aiFile);
      setForm((f) => ({ ...f, ...estimated }));
      setBasis('100'); // Gemini devuelve por 100 g
    } catch {
      setAiError('No se pudo estimar. Revisa la conexión o intenta con otra descripción/foto.');
    }
    setAiLoading(false);
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

      {!form.id && GEMINI_KEY && (
        <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
          <p className="text-sm text-text-2 flex items-center gap-2">
            <Sparkles size={16} className="text-accent" /> Estimar con IA
          </p>
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={2}
            placeholder="Describe el alimento… p. ej. «tortilla de maíz» o «3 tacos al pastor con piña»"
            className="rounded-xl bg-surface-3 border border-border px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          />
          <div className="flex gap-2 items-center">
            <label className="flex-1 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 flex items-center gap-2 text-sm text-text-2 cursor-pointer active:scale-[0.98] transition-transform duration-150">
              <ImagePlus size={18} />
              <span className="truncate">{aiFile ? aiFile.name : 'Foto (etiqueta o platillo)'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setAiFile(e.target.files[0] || null)}
              />
            </label>
            {aiFile && (
              <button
                type="button"
                onClick={() => setAiFile(null)}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-surface-3 border border-border flex items-center justify-center text-text-2"
                aria-label="Quitar foto"
              >
                <X size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={handleEstimate}
              disabled={aiLoading || (!aiText.trim() && !aiFile)}
              className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-text font-medium disabled:opacity-40 active:scale-[0.98] transition-transform duration-150"
            >
              {aiLoading ? 'Estimando…' : 'Estimar'}
            </button>
          </div>
          {aiError && <p className="text-sm text-danger">{aiError}</p>}
          <p className="text-xs text-text-3">Valores por 100 g, priorizando México. Revisa antes de guardar.</p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(normalizeTo100(form));
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

        <div className="flex items-center gap-2 text-sm text-text-3">
          <span>Valores por</span>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="any"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            className="w-20 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-center text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            aria-label="Base en gramos de los valores capturados"
          />
          <span>g</span>
          {Number(basis) !== 100 && Number(basis) > 0 && (
            <span className="text-xs text-accent">se convertirá a 100 g al guardar</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Kcal" value={form.kcal} onChange={(v) => setField('kcal', v)} />
          <NumberField label="Proteína (g)" value={form.protein_g} onChange={(v) => setField('protein_g', v)} />
          <NumberField label="Carbs (g)" value={form.carbs_g} onChange={(v) => setField('carbs_g', v)} />
          <NumberField label="Grasa (g)" value={form.fat_g} onChange={(v) => setField('fat_g', v)} />
          {MICROS.slice(0, MICROS_DEFAULT).map((m) => (
            <NumberField
              key={m.key}
              label={`${m.label} (${m.unit})`}
              value={form.micros[m.key] ?? ''}
              onChange={(v) => setMicro(m.key, v)}
            />
          ))}
        </div>

        <details className="rounded-xl bg-surface-2 border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm text-text-2 py-1">Más micros (opcional)</summary>
          <div className="grid grid-cols-2 gap-3 pt-3">
            {MICROS.slice(MICROS_DEFAULT).map((m) => (
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
            <option value="gemini">IA (Gemini)</option>
            {/* legado: hay foods existentes con estas fuentes */}
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
