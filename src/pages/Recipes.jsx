import { useEffect, useState } from 'react';
import { Plus, ChevronLeft, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { computeRecipePer100g } from '../lib/domain.js';
import { useToast } from '../lib/useToast.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import UndoToast from '../components/UndoToast.jsx';

export default function Recipes() {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | {} | recipe
  const [toast, showToast] = useToast();
  const [undoData, setUndoData] = useState(null); // { recipe, items, timer } tras un borrado, para "Deshacer"

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: rs }, { data: per100 }] = await Promise.all([
      supabase.from('recipes').select('*').order('name'),
      supabase.from('recipe_per_100g').select('recipe_id, kcal'),
    ]);
    const kcalById = new Map((per100 || []).map((p) => [p.recipe_id, p.kcal]));
    setRecipes((rs || []).map((r) => ({ ...r, kcal100: kcalById.get(r.id) })));
    setLoading(false);
  }

  async function openEditor(recipe) {
    if (!recipe.id) {
      setEditing({ name: '', cooked_weight_g: '', ingredients: [] });
      return;
    }
    const { data: items } = await supabase
      .from('recipe_items')
      .select('grams, food_id, foods(id, name, kcal, protein_g, carbs_g, fat_g, micros)')
      .eq('recipe_id', recipe.id);
    setEditing({
      ...recipe,
      cooked_weight_g: recipe.cooked_weight_g ?? '',
      ingredients: (items || []).map((i) => ({ food: i.foods, grams: i.grams })),
    });
  }

  async function handleSave(form) {
    const payload = { name: form.name, cooked_weight_g: form.cooked_weight_g || null };
    let recipeId = form.id;
    if (recipeId) {
      await supabase.from('recipes').update(payload).eq('id', recipeId);
      await supabase.from('recipe_items').delete().eq('recipe_id', recipeId);
    } else {
      const { data, error } = await supabase.from('recipes').insert(payload).select().single();
      if (error) return;
      recipeId = data.id;
    }
    if (form.ingredients.length > 0) {
      await supabase.from('recipe_items').insert(
        form.ingredients.map((i) => ({ recipe_id: recipeId, food_id: i.food.id, grams: Number(i.grams) }))
      );
    }
    setEditing(null);
    load();
  }

  // Borrado sin confirmación (swipe y botón "Borrar"): optimista + "Deshacer" 5 s
  // que reinserta la receta y sus ingredientes. Homologado con Hoy.
  async function handleDelete(id) {
    const recipe = recipes.find((r) => r.id === id);
    const { data: items } = await supabase.from('recipe_items').select('food_id, grams').eq('recipe_id', id);
    setEditing(null);
    setRecipes((rs) => rs.filter((r) => r.id !== id));
    const { error } = await supabase.from('recipes').delete().eq('id', id);
    if (error) {
      load();
      showToast('Tiene registros asociados, no se puede borrar.');
      return;
    }
    setUndoData((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndoData(null), 5000);
      return { recipe, items: items || [], timer };
    });
  }

  async function handleUndo() {
    if (!undoData) return;
    clearTimeout(undoData.timer);
    const { recipe, items } = undoData;
    setUndoData(null);
    const { data, error } = await supabase
      .from('recipes')
      .insert({ name: recipe.name, cooked_weight_g: recipe.cooked_weight_g })
      .select()
      .single();
    if (error) return;
    if (items.length > 0) {
      await supabase.from('recipe_items').insert(items.map((i) => ({ ...i, recipe_id: data.id })));
    }
    load();
  }

  if (editing) {
    return (
      <RecipeForm
        recipe={editing}
        onCancel={() => setEditing(null)}
        onSave={handleSave}
        onDelete={editing.id ? () => handleDelete(editing.id) : null}
      />
    );
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <h1 className="font-display text-xl">Recetas</h1>

      {loading && (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && recipes.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-text-2">Sin recetas aún</p>
          <button
            onClick={() => openEditor({})}
            className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-text font-medium press"
          >
            Crear la primera
          </button>
        </div>
      )}

      {!loading &&
        recipes.map((r) => (
          <SwipeToDelete
            key={r.id}
            onTap={() => openEditor(r)}
            onDelete={() => handleDelete(r.id)}
            className="rounded-2xl bg-surface border border-border p-4 flex justify-between items-center"
          >
            <span className="font-medium">{r.name}</span>
            {r.kcal100 != null && <span className="font-mono tabular-nums text-text-2 text-sm">{r.kcal100} kcal/100g</span>}
          </SwipeToDelete>
        ))}

      {!loading && recipes.length > 0 && (
        <button
          onClick={() => openEditor({})}
          className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-text flex items-center justify-center press"
          aria-label="Añadir receta"
        >
          <Plus size={24} />
        </button>
      )}

      {undoData && <UndoToast message="Receta borrada" onUndo={handleUndo} />}

      {!undoData && toast && (
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

function RecipeForm({ recipe, onCancel, onSave, onDelete }) {
  const [form, setForm] = useState(recipe);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('foods')
        .select('id, name, kcal, protein_g, carbs_g, fat_g, micros')
        .ilike('name', `%${query.trim()}%`)
        .limit(8);
      setResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function addIngredient(food) {
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { food, grams: '' }] }));
    setQuery('');
    setResults([]);
  }

  function setIngredientGrams(index, grams) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((ing, i) => (i === index ? { ...ing, grams } : ing)),
    }));
  }

  function removeIngredient(index) {
    setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== index) }));
  }

  const preview = computeRecipePer100g(form.ingredients, form.cooked_weight_g);

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 press" aria-label="Volver">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl">{form.id ? 'Editar receta' : 'Nueva receta'}</h1>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">Nombre</label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="input"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-2">Ingredientes</p>
        {form.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 border border-border px-3 py-2">
            <span className="flex-1">{ing.food.name}</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={ing.grams}
              onChange={(e) => setIngredientGrams(i, e.target.value)}
              placeholder="g"
              className="w-20 min-h-[44px] rounded-lg bg-surface-3 border border-border px-2 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button onClick={() => removeIngredient(i)} className="p-1 text-danger" aria-label="Quitar ingrediente">
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Añadir ingrediente…"
          className="input"
        />
        {results.length > 0 && (
          <div className="rounded-xl bg-surface-2 border border-border overflow-hidden">
            {results.map((f) => (
              <button key={f.id} onClick={() => addIngredient(f)} className="w-full text-left px-3 py-2 active:bg-surface-3">
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">Peso cocido (g)</label>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={form.cooked_weight_g}
          onChange={(e) => setForm((f) => ({ ...f, cooked_weight_g: e.target.value }))}
          className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-text-3">vacío = suma de ingredientes</p>
      </div>

      {preview && (
        <div className="rounded-2xl bg-surface border border-border p-4">
          <p className="text-sm text-text-3 mb-2">Preview por 100 g</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <PreviewStat label="Kcal" value={preview.kcal} color="text-d-kcal" />
            <PreviewStat label="Prot" value={preview.protein_g} color="text-d-prot" />
            <PreviewStat label="Carbs" value={preview.carbs_g} color="text-d-carb" />
            <PreviewStat label="Grasa" value={preview.fat_g} color="text-d-fat" />
          </div>
        </div>
      )}

      <button
        onClick={() => onSave(form)}
        disabled={!form.name || form.ingredients.length === 0}
        className="min-h-[44px] rounded-xl bg-accent-deep text-text font-medium press disabled:opacity-50"
      >
        Guardar
      </button>

      {onDelete && (
        <button
          onClick={onDelete}
          className="min-h-[44px] rounded-xl border border-danger text-danger font-medium press"
        >
          Borrar
        </button>
      )}
    </div>
  );
}

function PreviewStat({ label, value, color }) {
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg ${color}`}>{value}</p>
      <p className="text-xs text-text-3">{label}</p>
    </div>
  );
}
