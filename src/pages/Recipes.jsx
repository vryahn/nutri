import { useEffect, useRef, useState } from 'react';
import { Plus, ChevronLeft, Trash2, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { computeRecipePer100g, MICROS, MICROS_DEFAULT, round, isWaterSentinel } from '../lib/domain.js';
import { useToast } from '../lib/useToast.js';
import { GEMINI_KEY, estimateRecipe, estimateFood, parseAmount, snapDensity } from '../lib/ai.js';
import { searchFDC, fetchFDC } from '../lib/sources.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import UndoToast from '../components/UndoToast.jsx';
import SortTh from '../components/SortTh.jsx';
import AiDataCard from '../components/AiDataCard.jsx';

const FDC_KEY = import.meta.env.VITE_FDC_KEY;
const SOURCE_LABELS = { manual: 'Manual', gemini: 'IA' };

// ponytail: matchMedia en vez de resize-observer propio; mismo patrón que Today.jsx.
function useIsLgUp() {
  const [isLg, setIsLg] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = () => setIsLg(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isLg;
}

export default function Recipes() {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | {} | recipe
  const [toast, showToast] = useToast();
  const [undoData, setUndoData] = useState(null); // { recipe, items, timer } tras un borrado, para "Deshacer"
  const [favMicros, setFavMicros] = useState([]); // prefs.data.fav_micros, para el preview extendido lg+
  const isLg = useIsLgUp();
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filterSource, setFilterSource] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    loadPrefs();
  }, []);

  // Atajos lg+: "/" enfoca el buscador (si el foco no está en un input), Esc cierra el panel.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (editing) setEditing(null);
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing]);

  async function loadPrefs() {
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    if (data?.data?.fav_micros) setFavMicros(data.data.fav_micros);
  }

  async function load() {
    setLoading(true);
    let req = supabase.from('recipes').select('*').order('name');
    if (query.trim()) req = req.ilike('name', `%${query.trim()}%`);
    const [{ data: rs }, { data: per100 }] = await Promise.all([
      req,
      supabase.from('recipe_per_100g').select('recipe_id, kcal'),
    ]);
    const kcalById = new Map((per100 || []).map((p) => [p.recipe_id, p.kcal]));
    setRecipes((rs || []).map((r) => ({ ...r, kcal100: kcalById.get(r.id) })));
    setLoading(false);
  }

  async function openEditor(recipe) {
    if (!recipe.id) {
      setEditing({ name: '', cooked_weight_g: '', ingredients: [], source: 'manual' });
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
    const payload = {
      name: form.name,
      cooked_weight_g: form.cooked_weight_g || null,
      source: form.source || 'manual',
    };
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
      const { error } = await supabase.from('recipe_items').insert(
        form.ingredients.map((i) => ({ recipe_id: recipeId, food_id: i.food.id, grams: Number(i.grams) }))
      );
      if (error) {
        showToast('Error al guardar los ingredientes.');
        return;
      }
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
      .insert({ name: recipe.name, cooked_weight_g: recipe.cooked_weight_g, source: recipe.source })
      .select()
      .single();
    if (error) return;
    if (items.length > 0) {
      await supabase.from('recipe_items').insert(items.map((i) => ({ ...i, recipe_id: data.id })));
    }
    load();
  }

  // <lg: reemplazo de página completa, sin cambios respecto a lo existente.
  if (editing && !isLg) {
    return (
      <div className="px-4 py-4">
        <RecipeForm
          recipe={editing}
          favMicros={favMicros}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
          onDelete={editing.id ? () => handleDelete(editing.id) : null}
          onSelectRecipe={openEditor}
        />
      </div>
    );
  }

  function toggleSort(key) {
    setSortDir((d) => (sortKey === key ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
  }

  const sourceOptions = [...new Set(['manual', 'gemini', ...recipes.map((r) => r.source).filter(Boolean)])];

  let visibleRecipes = recipes;
  if (filterSource) visibleRecipes = visibleRecipes.filter((r) => r.source === filterSource);
  if (sortKey) {
    visibleRecipes = [...visibleRecipes].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      // null siempre al final, sin importar la dirección (kcal100 puede faltar).
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6 lg:items-start">
      <div className="flex flex-col gap-4 lg:col-start-1">
        {/* En lg+ el alta va por el panel derecho ("＋ Nueva receta" del estado vacío);
            en <lg por el FAB. Sin botón de cabecera para no duplicar. */}
        <h1 className="font-display text-xl">Recetas</h1>

        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="w-full min-h-[44px] rounded-xl bg-surface-2 border border-border pl-10 pr-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="hidden lg:flex gap-2">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Todos</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>
              ))}
            </select>
          </div>
        </div>

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

        {/* <lg: cards + swipe. Sin filtro por fuente (control solo lg+), la búsqueda ya filtra. */}
        {!loading && recipes.length > 0 && (
          <div className="flex flex-col gap-4 lg:hidden">
            {recipes.map((r) => (
              <SwipeToDelete
                key={r.id}
                onTap={() => openEditor(r)}
                onDelete={() => handleDelete(r.id)}
                className={`rounded-2xl bg-surface border p-4 flex justify-between items-center ${
                  editing?.id === r.id ? 'border-accent ring-1 ring-accent' : 'border-border'
                }`}
              >
                <span className="font-medium">
                  {r.name}
                  {r.source === 'gemini' && <span className="ml-1.5 text-[10px] text-accent align-middle">≈ IA</span>}
                </span>
                {r.kcal100 != null && <span className="font-mono tabular-nums text-text-2 text-sm">{r.kcal100} kcal/100g</span>}
              </SwipeToDelete>
            ))}
          </div>
        )}

        {/* lg+: tabla ordenable con hover-actions, homóloga a Alimentos. */}
        {!loading && recipes.length > 0 && (
          <div className="hidden lg:block rounded-2xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-text-2 text-left">
                  <SortTh label="Nombre" sortKey="name" active={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortTh label="Kcal/100g" sortKey="kcal100" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <th className="px-3 py-2 text-center w-20">⚠</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecipes.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openEditor(r)}
                    className={`group relative border-t border-border cursor-pointer hover:bg-surface-2 ${
                      editing?.id === r.id ? 'bg-surface-2 ring-1 ring-inset ring-accent' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.kcal100 ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <span className="w-10 flex justify-center text-[10px] text-accent">
                          {r.source === 'gemini' && '≈ IA'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(r.id);
                          }}
                          className="p-1.5 text-text-2 hover:text-danger opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          aria-label={`Borrar ${r.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleRecipes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-text-2">Sin resultados con estos filtros.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Panel derecho (lg+): editor, master-detail. */}
      <div className="hidden lg:block lg:col-start-2 lg:sticky lg:top-6">
        {editing ? (
          <div className="rounded-2xl bg-surface border border-border p-6">
            <RecipeForm
              recipe={editing}
              favMicros={favMicros}
              onCancel={() => setEditing(null)}
              onSave={handleSave}
              onDelete={editing.id ? () => handleDelete(editing.id) : null}
              onSelectRecipe={openEditor}
            />
          </div>
        ) : (
          <div className="rounded-2xl bg-surface border border-border p-10 flex flex-col items-center gap-3 text-center">
            <p className="text-text-2">Selecciona una receta o crea una nueva</p>
            <button
              onClick={() => openEditor({})}
              className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-text font-medium press"
            >
              ＋ Nueva receta
            </button>
          </div>
        )}
      </div>

      {!loading && recipes.length > 0 && (
        <button
          onClick={() => openEditor({})}
          className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-text flex items-center justify-center press lg:hidden"
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
          className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 text-center text-sm lg:left-auto lg:right-6 lg:bottom-6"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// Quita la cantidad tecleada (si hay) del texto, para el cortocircuito anti-duplicados
// y para no ensuciar el nombre buscado con "350ml" etc.
function stripAmountText(text) {
  return text.replace(/\d+(?:[.,]\d+)?\s*(ml|l|g|gr|kg)\b/i, '').trim();
}

// recipe_items tiene PK compuesta (recipe_id, food_id): dos ingredientes de texto
// distinto pueden resolver al mismo alimento (alias + db_match, o dos búsquedas
// manuales). Sumar gramos en vez de duplicar evita el 409 al guardar.
function mergeIngredient(ingredients, food, grams, procedencia) {
  const idx = ingredients.findIndex((i) => i.food.id === food.id);
  if (idx === -1) return [...ingredients, { food, grams, procedencia }];
  const next = [...ingredients];
  next[idx] = { ...next[idx], grams: (Number(next[idx].grams) || 0) + (Number(grams) || 0) };
  return next;
}

function RecipeForm({ recipe, favMicros, onCancel, onSave, onDelete, onSelectRecipe }) {
  const [form, setForm] = useState(recipe);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [userId, setUserId] = useState(null);

  const [aiText, setAiText] = useState('');
  const [aiFile, setAiFile] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState(null); // { confidence, kcalTotalEstimate }
  const [dupMatches, setDupMatches] = useState([]);
  const [pendingIngredients, setPendingIngredients] = useState([]); // [{ name_es, grams, usda_query }]

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUserId(session.user.id);
    });
  }, []);

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

  // --- Datos con IA: descomposición en ingredientes ---

  async function handleAiSubmit() {
    if (!aiText.trim() && !aiFile) return;
    setAiError('');
    setDupMatches([]);
    setAiResult(null);
    const dedupQuery = stripAmountText(aiText);
    if (dedupQuery) {
      const { data: matches } = await supabase.from('recipes').select('*').ilike('name', `%${dedupQuery}%`).limit(5);
      if (matches && matches.length > 0) {
        setDupMatches(matches);
        return;
      }
    }
    await runEstimate();
  }

  async function runEstimate() {
    setAiLoading(true);
    setAiError('');
    try {
      const [{ data: foods }, { data: prefsRow }] = await Promise.all([
        supabase.from('foods').select('id, name, kcal, protein_g, carbs_g, fat_g, micros'),
        supabase.from('prefs').select('data').maybeSingle(),
      ]);
      const catalogFoods = (foods || []).filter((f) => !isWaterSentinel(f));
      const aliases = prefsRow?.data?.ingredient_aliases || {};
      const catalogNames = catalogFoods.map((f) => f.name);
      const result = await estimateRecipe(aiText, aiFile, catalogNames);
      applyEstimate(result, catalogFoods, aliases);
    } catch (e) {
      setAiError(e.message || 'No se pudo obtener datos. Revisa la conexión o intenta con otra descripción/foto.');
    }
    setAiLoading(false);
  }

  function applyEstimate(result, catalogFoods, aliases) {
    const parsed = parseAmount(aiText);
    let totalG = null;
    if (parsed) {
      if (parsed.unit === 'g') {
        totalG = parsed.value;
      } else {
        let density = 1;
        if (Number(result.total_weight_g) > 0) {
          const implied = Number(result.total_weight_g) / parsed.value;
          if (implied > 0.5 && implied < 2) density = snapDensity(implied);
        }
        totalG = Math.round(parsed.value * density);
      }
    } else if (Number(result.total_weight_g) > 0) {
      totalG = Number(result.total_weight_g);
    }

    let resolved = [];
    const pending = [];
    for (const ing of result.ingredients) {
      const norm = ing.name_es.trim().toLowerCase();
      const aliasFood = norm && aliases[norm] ? catalogFoods.find((f) => f.id === aliases[norm]) : null;
      if (aliasFood) {
        resolved = mergeIngredient(resolved, aliasFood, ing.grams, 'alias');
        continue;
      }
      const dbFood = ing.db_match
        ? catalogFoods.find((f) => f.name.trim().toLowerCase() === ing.db_match.trim().toLowerCase())
        : null;
      if (dbFood) {
        resolved = mergeIngredient(resolved, dbFood, ing.grams, 'catálogo');
        continue;
      }
      pending.push({ name_es: ing.name_es, grams: ing.grams, usda_query: ing.usda_query });
    }

    setForm((f) => ({
      ...f,
      name: f.name || result.name,
      cooked_weight_g: totalG ?? f.cooked_weight_g,
      ingredients: resolved.reduce((acc, r) => mergeIngredient(acc, r.food, r.grams, r.procedencia), f.ingredients),
      source: 'gemini',
    }));
    setPendingIngredients((p) => [...p, ...pending]);
    setAiResult({ confidence: result.confidence, kcalTotalEstimate: result.kcal_total_estimate });
  }

  async function learnAlias(nameEs, foodId) {
    const norm = nameEs.trim().toLowerCase();
    if (!norm || !userId) return;
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    const aliases = { ...(data?.data?.ingredient_aliases || {}), [norm]: foodId };
    await supabase.from('prefs').upsert({ owner: userId, data: { ...(data?.data || {}), ingredient_aliases: aliases } });
  }

  function resolvePendingIngredient(index, food, procedencia, learn) {
    const item = pendingIngredients[index];
    setForm((f) => ({ ...f, ingredients: mergeIngredient(f.ingredients, food, item.grams || '', procedencia) }));
    setPendingIngredients((p) => p.filter((_, i) => i !== index));
    if (learn) learnAlias(item.name_es, food.id);
  }

  function setPendingGrams(index, grams) {
    setPendingIngredients((p) => p.map((it, i) => (i === index ? { ...it, grams } : it)));
  }

  function removePendingIngredient(index) {
    setPendingIngredients((p) => p.filter((_, i) => i !== index));
  }

  const preview = computeRecipePer100g(form.ingredients, form.cooked_weight_g);
  const previewMicros = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favMicros.includes(m.key)) && m.key !== 'agua_ml');

  // Avisos deterministas del flujo IA: nunca bloqueantes salvo pendientes (esos sí
  // bloquean Guardar, se resuelven en la línea de arriba de este componente).
  const sumGrams = form.ingredients.reduce((s, i) => s + (Number(i.grams) || 0), 0);
  const totalGNum = Number(form.cooked_weight_g) || 0;
  const massDiffRatio = totalGNum > 0 && sumGrams > 0 ? Math.abs(sumGrams - totalGNum) / totalGNum : 0;
  const showAdjustButton = massDiffRatio > 0.05;
  const massWarn = massDiffRatio > 0.2;
  const adjustFactor = showAdjustButton ? round(totalGNum / sumGrams, 2) : null;

  const calcKcalTotal = preview && totalGNum > 0 ? round((preview.kcal * totalGNum) / 100, 0) : null;
  const kcalTotalEstimate = aiResult?.kcalTotalEstimate;
  const kcalMismatch =
    pendingIngredients.length === 0 &&
    kcalTotalEstimate != null &&
    calcKcalTotal != null &&
    calcKcalTotal >= 50 &&
    kcalTotalEstimate >= 50 &&
    Math.abs(calcKcalTotal - kcalTotalEstimate) / Math.max(calcKcalTotal, kcalTotalEstimate) > 0.25;
  const densityOutOfRange = preview && preview.kcal > 900;

  function handleAdjustMass() {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((ing) => ({ ...ing, grams: Math.round(Number(ing.grams) * adjustFactor) })),
    }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 press" aria-label="Volver">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl">{form.id ? 'Editar receta' : 'Nueva receta'}</h1>
      </div>

      {!form.id && GEMINI_KEY && (
        <AiDataCard
          text={aiText}
          onText={setAiText}
          file={aiFile}
          onFile={setAiFile}
          loading={aiLoading}
          error={aiError}
          onSubmit={handleAiSubmit}
          placeholder="Describe el platillo o bebida (p. ej. «Caramel Macchiato 350ml») o adjunta una foto"
          hint="Gemini descompone en ingredientes y gramos; nunca estima nutrientes. Revisa cantidades antes de guardar."
        >
          {dupMatches.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-text-2">Ya la tienes:</p>
              <div className="flex flex-wrap gap-2">
                {dupMatches.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onSelectRecipe(r)}
                    className="text-xs min-h-[44px] px-3 rounded-full bg-surface-3 border border-border text-text-2 press"
                  >
                    {r.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setDupMatches([]);
                    runEstimate();
                  }}
                  className="text-xs min-h-[44px] px-3 rounded-full border border-border text-text-2 press"
                >
                  Continuar de todos modos
                </button>
              </div>
            </div>
          )}
          {aiResult && (
            <p className="text-xs text-text-2">
              ≈ Ingredientes estimados por IA (confianza {aiResult.confidence || '—'}) — revisa cantidades antes de guardar.
            </p>
          )}
        </AiDataCard>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
        <div className="flex flex-col gap-4">
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
                <div className="flex-1 flex flex-col min-w-0">
                  <span className="truncate">{ing.food.name}</span>
                  {ing.procedencia && <span className="text-xs text-text-3">{ing.procedencia}</span>}
                </div>
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

            {pendingIngredients.map((item, i) => (
              <PendingIngredientRow
                key={`${item.name_es}-${i}`}
                item={item}
                onResolve={(food, procedencia, learn) => resolvePendingIngredient(i, food, procedencia, learn)}
                onRemove={() => removePendingIngredient(i)}
                onGramsChange={(v) => setPendingGrams(i, v)}
              />
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

          {pendingIngredients.length > 0 && (
            <p className="text-sm text-warn" role="status">
              ⚠ {pendingIngredients.length} ingrediente{pendingIngredients.length === 1 ? '' : 's'} sin resolver.
            </p>
          )}
          {showAdjustButton && (
            <div className="flex items-center gap-2">
              {massWarn && (
                <p className="text-sm text-warn flex-1" role="status">
                  ⚠ La suma de ingredientes ({sumGrams} g) no cuadra con el total ({totalGNum} g).
                </p>
              )}
              <button
                type="button"
                onClick={handleAdjustMass}
                className="min-h-[44px] px-3 rounded-xl border border-border text-text-2 press whitespace-nowrap"
              >
                Ajustar ingredientes al total (×{adjustFactor})
              </button>
            </div>
          )}
          {kcalMismatch && (
            <p className="text-sm text-warn" role="status">
              ⚠ Las kcal calculadas ({calcKcalTotal}) difieren de la estimación del platillo ({kcalTotalEstimate}) — revisa cantidades.
            </p>
          )}
          {densityOutOfRange && (
            <p className="text-sm text-warn" role="status">
              ⚠ Densidad calórica fuera de rango físico.
            </p>
          )}

          {/* <lg: preview solo macros, en flujo normal debajo del form. */}
          {preview && (
            <div className="lg:hidden rounded-2xl bg-surface border border-border p-4">
              <p className="text-sm text-text-3 mb-2">Preview por 100 g</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <PreviewStat label="Kcal" value={preview.kcal} color="text-d-kcal" />
                <PreviewStat label="Prot" value={preview.protein_g} color="text-d-prot" />
                <PreviewStat label="Carbs" value={preview.carbs_g} color="text-d-carb" />
                <PreviewStat label="Grasa" value={preview.fat_g} color="text-d-fat" />
              </div>
            </div>
          )}
        </div>

        {/* lg+: preview sticky a la derecha, extendido con micros visibles/favoritos. */}
        {preview && (
          <div className="hidden lg:block lg:sticky lg:top-6 rounded-2xl bg-surface border border-border p-4">
            <p className="text-sm text-text-3 mb-2">Preview por 100 g</p>
            <div className="grid grid-cols-4 gap-2 text-center pb-3 border-b border-border">
              <PreviewStat label="Kcal" value={preview.kcal} color="text-d-kcal" />
              <PreviewStat label="Prot" value={preview.protein_g} color="text-d-prot" />
              <PreviewStat label="Carbs" value={preview.carbs_g} color="text-d-carb" />
              <PreviewStat label="Grasa" value={preview.fat_g} color="text-d-fat" />
            </div>
            {previewMicros.map((m) => {
              const v = preview.micros?.[m.key] ?? 0;
              return (
                <div key={m.key} className="flex justify-between py-1.5 border-t border-border text-sm">
                  <span className="text-text-2">{m.label}</span>
                  <span className={`font-mono tabular-nums ${v === 0 ? 'text-text-3' : ''}`}>
                    {round(v, 2)} {m.unit}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={() => onSave(form)}
        disabled={!form.name || form.ingredients.length === 0 || pendingIngredients.length > 0}
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

// Ingrediente sin resolver: buscador inline (aprende alias al usarse), chips USDA
// opcionales y estimación IA opt-in. Resuelto = sale de la lista de pendientes.
function PendingIngredientRow({ item, onResolve, onRemove, onGramsChange }) {
  const [query, setQuery] = useState(item.name_es);
  const [results, setResults] = useState([]);
  const [fdcChips, setFdcChips] = useState([]);
  const [fdcLoading, setFdcLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPreview, setAiPreview] = useState(null);

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

  async function handleUsdaSearch() {
    if (!item.usda_query) return;
    setFdcLoading(true);
    const matches = await searchFDC(item.usda_query);
    setFdcChips(matches);
    setFdcLoading(false);
  }

  async function handleUsdaPick(fdcId, description) {
    const detail = await fetchFDC(fdcId);
    if (!detail) return;
    const { data, error } = await supabase.from('foods').insert({ ...detail, source: 'usda' }).select().single();
    if (!error) onResolve(data, 'USDA', false);
  }

  async function handleAiEstimate() {
    setAiLoading(true);
    setAiError('');
    try {
      const est = await estimateFood(item.name_es, null);
      setAiPreview(est);
    } catch (e) {
      setAiError(e.message || 'No se pudo estimar.');
    }
    setAiLoading(false);
  }

  async function handleAiCreate() {
    const payload = {
      name: aiPreview.name || item.name_es,
      kcal: Number(aiPreview.kcal) || 0,
      protein_g: Number(aiPreview.protein_g) || 0,
      carbs_g: Number(aiPreview.carbs_g) || 0,
      fat_g: Number(aiPreview.fat_g) || 0,
      micros: aiPreview.micros,
      source: 'gemini',
    };
    const { data, error } = await supabase.from('foods').insert(payload).select().single();
    if (!error) onResolve(data, 'IA', false);
  }

  return (
    <div className="rounded-xl bg-surface-2 border border-warn p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm truncate">{item.name_es}</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={item.grams}
          onChange={(e) => onGramsChange(e.target.value)}
          placeholder="g"
          className="w-20 min-h-[44px] rounded-lg bg-surface-3 border border-border px-2 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button type="button" onClick={onRemove} className="p-1 text-danger" aria-label={`Quitar ${item.name_es}`}>
          <X size={16} />
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar en tu catálogo…"
        className="input text-sm"
      />
      {results.length > 0 && (
        <div className="rounded-xl bg-surface-3 border border-border overflow-hidden">
          {results.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onResolve(f, 'catálogo', true)}
              className="w-full text-left px-3 py-2 text-sm active:bg-surface-2"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {item.usda_query && FDC_KEY && (
          <button
            type="button"
            onClick={handleUsdaSearch}
            disabled={fdcLoading}
            className="text-xs min-h-[36px] px-3 rounded-full border border-border text-text-2 press"
          >
            {fdcLoading ? 'Buscando…' : 'Buscar en USDA'}
          </button>
        )}
        {fdcChips.map((c) => (
          <button
            key={c.fdcId}
            type="button"
            onClick={() => handleUsdaPick(c.fdcId, c.description)}
            className="text-xs min-h-[36px] px-3 rounded-full bg-surface-3 border border-border text-text-2 press"
          >
            USDA: {c.description}
          </button>
        ))}
        {GEMINI_KEY && !aiPreview && (
          <button
            type="button"
            onClick={handleAiEstimate}
            disabled={aiLoading}
            className="text-xs min-h-[36px] px-3 rounded-full border border-border text-text-2 press"
          >
            {aiLoading ? 'Estimando…' : 'Estimar con IA'}
          </button>
        )}
      </div>

      {aiError && <p className="text-xs text-danger">{aiError}</p>}
      {aiPreview && (
        <div className="rounded-lg bg-surface-3 border border-border p-2 flex flex-col gap-1 text-xs">
          <span>
            {aiPreview.name || item.name_es}: {aiPreview.kcal || 0} kcal · P {aiPreview.protein_g || 0} · C {aiPreview.carbs_g || 0} · G {aiPreview.fat_g || 0}
          </span>
          <button
            type="button"
            onClick={handleAiCreate}
            className="self-start min-h-[36px] px-3 rounded-full bg-accent-deep text-text press"
          >
            Crear alimento y añadir
          </button>
        </div>
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
