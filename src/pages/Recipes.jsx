import { useEffect, useRef, useState } from 'react';
import { Plus, ChevronLeft, Trash2, Search, X, Save } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { computeRecipePer100g, MICROS, MICROS_DEFAULT, round, isWaterSentinel } from '../lib/domain.js';
import { useToast } from '../lib/useToast.js';
import { GEMINI_KEY, estimateRecipe, parseAmount, snapDensity } from '../lib/ai.js';
import { searchFDC, fetchFDC, translateEnEs } from '../lib/sources.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import UndoToast from '../components/UndoToast.jsx';
import AmountField from '../components/AmountField.jsx';
import SortTh from '../components/SortTh.jsx';
import AiDataCard from '../components/AiDataCard.jsx';
import { t, useLang, useUnits, fmtG, gToOz, ozToG } from '../lib/i18n.js';
import { fetchFoodsForImport, parseIngredientLines } from '../lib/importer.js';

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
  useLang();
  // SWR: pinta el cache de sesión al instante y el load() de fondo refresca.
  const [recipes, setRecipes] = useState(() => cacheGet('recipes') || []);
  const [loading, setLoading] = useState(() => !cacheGet('recipes'));
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
    // Solo se cachea la lista base (sin búsqueda): es la vista con la que se
    // llega al tab. El skeleton solo aparece si no hay nada que pintar.
    const isBase = !query.trim();
    if (!(isBase && cacheGet('recipes'))) setLoading(true);
    let req = supabase.from('recipes').select('*').order('name');
    if (!isBase) req = req.ilike('name', `%${query.trim()}%`);
    const [{ data: rs, error: rsError }, { data: per100, error: per100Error }] = await Promise.all([
      req,
      supabase.from('recipe_per_100g').select('recipe_id, kcal'),
    ]);
    if (rsError || per100Error) {
      showToast(t('No se pudieron cargar las recetas — revisa tu conexión.'));
      setLoading(false);
      return;
    }
    const kcalById = new Map((per100 || []).map((p) => [p.recipe_id, p.kcal]));
    const list = (rs || []).map((r) => ({ ...r, kcal100: kcalById.get(r.id) }));
    setRecipes(isBase ? cacheSet('recipes', list) : list);
    setLoading(false);
  }

  async function openEditor(recipe) {
    if (!recipe.id) {
      setEditing({ name: '', cooked_weight_g: '', ingredients: [], source: 'manual' });
      return;
    }
    const { data: items } = await supabase
      .from('recipe_items')
      .select('grams, food_id, foods(id, name, kcal, protein_g, carbs_g, fat_g, micros, density_g_ml, portions)')
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
        showToast(t('Error al guardar los ingredientes.'));
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
      showToast(t('Tiene registros asociados, no se puede borrar.'));
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
        <h1 className="font-display text-xl">{t('Recetas')}</h1>

        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Buscar…')}
              className="w-full min-h-[44px] rounded-xl bg-surface-2 border border-border pl-10 pr-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="hidden lg:flex gap-2">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">{t('Todos')}</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>{t(SOURCE_LABELS[s] || s)}</option>
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
            <p className="text-text-2">{t('Sin recetas aún')}</p>
            <button
              onClick={() => openEditor({})}
              className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
            >
              {t('Crear la primera')}
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
                  {r.source === 'gemini' && <span className="ml-1.5 text-[10px] text-accent align-middle">≈ {t('IA')}</span>}
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
                  <SortTh label={t('Nombre')} sortKey="name" active={sortKey} dir={sortDir} onSort={toggleSort} />
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
                          {r.source === 'gemini' && `≈ ${t('IA')}`}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(r.id);
                          }}
                          className="p-1.5 text-text-2 hover:text-danger opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          aria-label={`${t('Borrar')} ${r.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleRecipes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-text-2">{t('Sin resultados con estos filtros.')}</td>
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
            <p className="text-text-2">{t('Selecciona una receta o crea una nueva')}</p>
            <button
              onClick={() => openEditor({})}
              className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
            >
              ＋ {t('Nueva receta')}
            </button>
          </div>
        )}
      </div>

      {!loading && recipes.length > 0 && (
        <button
          onClick={() => openEditor({})}
          className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-on-accent flex items-center justify-center press lg:hidden"
          aria-label={t('Añadir receta')}
        >
          <Plus size={24} />
        </button>
      )}

      {undoData && <UndoToast message={t('Receta borrada')} onUndo={handleUndo} />}

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
function mergeIngredient(ingredients, food, grams, procedencia, isNew = false, fromAi = false) {
  const idx = ingredients.findIndex((i) => i.food.id === food.id);
  if (idx === -1) return [...ingredients, { food, grams, procedencia, isNew, fromAi }];
  const next = [...ingredients];
  next[idx] = { ...next[idx], grams: (Number(next[idx].grams) || 0) + (Number(grams) || 0) };
  return next;
}

function RecipeForm({ recipe, favMicros, onCancel, onSave, onDelete, onSelectRecipe }) {
  useLang();
  const units = useUnits();
  const [form, setForm] = useState(recipe);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [userId, setUserId] = useState(null);

  const [aiText, setAiText] = useState('');
  const [aiFiles, setAiFiles] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState(null); // { confidence, kcalTotalEstimate }
  const [dupMatches, setDupMatches] = useState([]);
  const [confirmNew, setConfirmNew] = useState(false); // gate de guardado: confirmar alta de alimentos staged
  const [saveError, setSaveError] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');

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
        .select('id, name, kcal, protein_g, carbs_g, fat_g, micros, density_g_ml, portions')
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

  // Pega varias líneas ("200 g arroz") y añade en bloque las que emparejan con el
  // catálogo; las sin coincidencia se reportan para agregarlas a mano arriba.
  async function addPastedIngredients() {
    const catalog = (await fetchFoodsForImport()).filter((f) => !isWaterSentinel(f));
    const parsed = parseIngredientLines(pasteText, catalog);
    const ok = parsed.filter((p) => p.valid);
    if (ok.length) {
      setForm((f) => ({ ...f, ingredients: [...f.ingredients, ...ok.map((p) => ({ food: p.food, grams: p.grams }))] }));
    }
    const missed = parsed.length - ok.length;
    setPasteText('');
    setPasteMsg(
      missed > 0
        ? t('%n añadidos · %m sin coincidencia (agrégalos arriba)').replace('%n', ok.length).replace('%m', missed)
        : t('%n añadidos').replace('%n', ok.length)
    );
  }

  // --- Datos con IA: descomposición en ingredientes ---

  async function handleAiSubmit() {
    if (!aiText.trim() && aiFiles.length === 0) return;
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
        supabase.from('foods').select('id, name, kcal, protein_g, carbs_g, fat_g, micros, density_g_ml, portions'),
        supabase.from('prefs').select('data').maybeSingle(),
      ]);
      const catalogFoods = (foods || []).filter((f) => !isWaterSentinel(f));
      const aliases = prefsRow?.data?.ingredient_aliases || {};
      const catalogNames = catalogFoods.map((f) => f.name);
      const result = await estimateRecipe(aiText, aiFiles, catalogNames);
      applyEstimate(result, catalogFoods, aliases);
    } catch (e) {
      setAiError(e.message || t('No se pudo obtener datos. Revisa la conexión o intenta con otra descripción/foto.'));
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

    // Ingredientes con match de catálogo/alias → food real (fila compacta). Sin match →
    // card staged (isNew) prefilleada con los nutrientes de respaldo de la IA, editable y
    // con guardado individual. Prioridad: alias/catálogo > IA (la card ofrece USDA como swap).
    let aiCatalog = [];
    const staged = [];
    for (const ing of result.ingredients) {
      const norm = ing.name_es.trim().toLowerCase();
      const aliasFood = norm && aliases[norm] ? catalogFoods.find((f) => f.id === aliases[norm]) : null;
      if (aliasFood) {
        aiCatalog = mergeIngredient(aiCatalog, aliasFood, ing.grams, 'alias', false, true);
        continue;
      }
      const dbFood = ing.db_match
        ? catalogFoods.find((f) => f.name.trim().toLowerCase() === ing.db_match.trim().toLowerCase())
        : null;
      if (dbFood) {
        aiCatalog = mergeIngredient(aiCatalog, dbFood, ing.grams, t('catálogo'), false, true);
        continue;
      }
      staged.push({
        food: {
          name: ing.name_es,
          kcal: ing.kcal,
          protein_g: ing.protein_g,
          carbs_g: ing.carbs_g,
          fat_g: ing.fat_g,
          micros: ing.micros || {},
          id: crypto.randomUUID(),
          source: 'gemini',
        },
        grams: ing.grams,
        procedencia: t('IA'),
        isNew: true,
        fromAi: true,
        name_es: ing.name_es,
        usda_query: ing.usda_query,
      });
    }

    // Re-ejecutar "Obtener datos" REEMPLAZA lo derivado de IA (fromAi); solo sobrevive lo
    // añadido a mano por el usuario. Evita la acumulación al presionar varias veces.
    // ponytail: lo guardado individualmente conserva fromAi, así el re-tap también lo
    // reemplaza (queda en el catálogo, no se pierde) y no hay doble conteo de gramos.
    setForm((f) => {
      let next = f.ingredients.filter((i) => !i.fromAi);
      for (const r of aiCatalog) next = mergeIngredient(next, r.food, r.grams, r.procedencia, false, true);
      return {
        ...f,
        name: f.name || result.name,
        cooked_weight_g: totalG ?? f.cooked_weight_g,
        ingredients: [...next, ...staged],
        source: 'gemini',
      };
    });
    setAiResult({ confidence: result.confidence, kcalTotalEstimate: result.kcal_total_estimate });
  }

  async function learnAlias(nameEs, foodId) {
    const norm = nameEs.trim().toLowerCase();
    if (!norm || !userId) return;
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    const aliases = { ...(data?.data?.ingredient_aliases || {}), [norm]: foodId };
    await supabase.from('prefs').upsert({ owner: userId, data: { ...(data?.data || {}), ingredient_aliases: aliases } });
  }

  // Edición inline de una card staged (nombre/kcal/macros); el preview reacciona al vuelo.
  function setIngredientFood(index, patch) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((x, i) => (i === index ? { ...x, food: { ...x.food, ...patch } } : x)),
    }));
  }

  // Swap de una card staged a un alimento REAL del catálogo: sale de modo edición (fila
  // compacta). Aprende alias del nombre original. Conserva fromAi (lo derivado de IA).
  function swapIngredientToCatalog(index, food, learn) {
    const nameEs = form.ingredients[index]?.name_es;
    setForm((f) => {
      const item = f.ingredients[index];
      const rest = f.ingredients.filter((_, i) => i !== index);
      return { ...f, ingredients: mergeIngredient(rest, food, item.grams || '', t('catálogo'), false, item.fromAi) };
    });
    if (learn && nameEs) learnAlias(nameEs, food.id);
  }

  // Swap a datos USDA: sigue staged (isNew) y editable, prefill con valores por 100 g de
  // USDA; el nombre en español del flujo se conserva.
  function swapIngredientToUsda(index, detail) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((x, i) =>
        i === index ? { ...x, food: { ...detail, name: x.name_es, id: crypto.randomUUID(), source: 'usda' } } : x
      ),
    }));
  }

  // Inserta un alimento staged (sin id) y devuelve la fila real. Compartido por el
  // guardado individual y el guardado de la receta. Null si falla el insert.
  async function persistNewFood(food) {
    const payload = {
      name: food.name,
      kcal: Number(food.kcal) || 0,
      protein_g: Number(food.protein_g) || 0,
      carbs_g: Number(food.carbs_g) || 0,
      fat_g: Number(food.fat_g) || 0,
      micros: food.micros || {},
      source: food.source || 'gemini',
    };
    const { data, error } = await supabase.from('foods').insert(payload).select().single();
    return error ? null : data;
  }

  async function saveIngredientNow(index) {
    const ing = form.ingredients[index];
    const saved = await persistNewFood(ing.food);
    if (!saved) {
      setSaveError(t('No se pudo guardar el alimento. Intenta de nuevo.'));
      return;
    }
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((x, i) =>
        i === index ? { food: saved, grams: x.grams, procedencia: x.procedencia, fromAi: x.fromAi } : x
      ),
    }));
  }

  const preview = computeRecipePer100g(form.ingredients, form.cooked_weight_g);
  const previewMicros = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favMicros.includes(m.key)) && m.key !== 'agua_ml');

  // Avisos deterministas del flujo IA, nunca bloqueantes.
  const sumGrams = form.ingredients.reduce((s, i) => s + (Number(i.grams) || 0), 0);
  const totalGNum = Number(form.cooked_weight_g) || 0;
  const massDiffRatio = totalGNum > 0 && sumGrams > 0 ? Math.abs(sumGrams - totalGNum) / totalGNum : 0;
  const showAdjustButton = massDiffRatio > 0.05;
  const massWarn = massDiffRatio > 0.2;
  const adjustFactor = showAdjustButton ? round(totalGNum / sumGrams, 2) : null;

  const calcKcalTotal = preview && totalGNum > 0 ? round((preview.kcal * totalGNum) / 100, 0) : null;
  const kcalTotalEstimate = aiResult?.kcalTotalEstimate;
  const kcalMismatch =
    form.ingredients.every((i) => !i.isNew) &&
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

  // Alimentos staged (elegidos de USDA/IA) aún no persistidos. Se crean al confirmar
  // el guardado de la receta; el usuario también puede guardarlos uno a uno antes.
  const newFoods = form.ingredients.filter((i) => i.isNew);

  async function handleSaveClick() {
    if (newFoods.length > 0 && !confirmNew) {
      setConfirmNew(true);
      return;
    }
    setSaveError('');
    const resolved = [];
    for (let idx = 0; idx < form.ingredients.length; idx++) {
      const ing = form.ingredients[idx];
      if (!ing.isNew) {
        resolved.push(ing);
        continue;
      }
      const saved = await persistNewFood(ing.food);
      if (!saved) {
        // Conserva los ya creados como no-nuevos para que un reintento no los duplique.
        setForm((f) => ({ ...f, ingredients: [...resolved, ...f.ingredients.slice(idx)] }));
        setSaveError(t('No se pudo crear un alimento nuevo. Intenta de nuevo.'));
        return;
      }
      resolved.push({ food: saved, grams: ing.grams, procedencia: ing.procedencia });
    }
    onSave({ ...form, ingredients: resolved });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 press" aria-label={t('Volver')}>
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl">{form.id ? t('Editar receta') : t('Nueva receta')}</h1>
      </div>

      {!form.id && GEMINI_KEY && (
        <AiDataCard
          text={aiText}
          onText={setAiText}
          files={aiFiles}
          onFiles={setAiFiles}
          loading={aiLoading}
          error={aiError}
          onSubmit={handleAiSubmit}
          placeholder={t('Describe el platillo o bebida (p. ej. «Caramel Macchiato 350ml») o adjunta una foto')}
          hint={t('Gemini descompone en ingredientes con nutrientes de respaldo (prefill revisable). Cada alimento nuevo se edita y guarda por separado; prioridad: catálogo › USDA › IA.')}
        >
          {dupMatches.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-text-2">{t('Ya la tienes:')}</p>
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
                  {t('Continuar de todos modos')}
                </button>
              </div>
            </div>
          )}
          {aiResult && (
            <p className="text-xs text-text-2">
              ≈ {t('Ingredientes por IA (confianza %n) — revisa cantidades y nutrientes; guarda cada alimento nuevo.')
                .replace('%n', t(aiResult.confidence) || '—')}
            </p>
          )}
        </AiDataCard>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-2">{t('Nombre')}</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="input"
            />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-2">{t('Ingredientes')}</p>
            {form.ingredients.map((ing, i) =>
              ing.isNew ? (
                <StagedIngredientCard
                  key={ing.food.id}
                  ing={ing}
                  onFood={(patch) => setIngredientFood(i, patch)}
                  onGrams={(v) => setIngredientGrams(i, v)}
                  onSave={() => saveIngredientNow(i)}
                  onRemove={() => removeIngredient(i)}
                  onSwapCatalog={(food, learn) => swapIngredientToCatalog(i, food, learn)}
                  onSwapUsda={(detail) => swapIngredientToUsda(i, detail)}
                />
              ) : (
                <div key={ing.food.id} className="flex flex-col gap-2 rounded-xl bg-surface-2 border border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex flex-col min-w-0">
                      <span className="truncate">{ing.food.name}</span>
                      {ing.procedencia && <span className="text-xs text-text-3">{ing.procedencia}</span>}
                    </div>
                    <button onClick={() => removeIngredient(i)} className="p-1 text-danger" aria-label={t('Quitar ingrediente')}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <AmountField
                    grams={ing.grams === '' || ing.grams == null ? '' : String(ing.grams)}
                    onGrams={(v) => setIngredientGrams(i, v)}
                    meta={ing.food}
                    required={false}
                  />
                </div>
              )
            )}

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Añadir ingrediente…')}
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

            <details className="rounded-xl border border-border">
              <summary className="px-3 py-2 text-sm text-text-2 cursor-pointer select-none">{t('Pegar lista de ingredientes')}</summary>
              <div className="p-3 flex flex-col gap-2">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'200 g arroz\n15 ml aceite de oliva\npechuga de pollo, 120'}
                  rows={4}
                  className="w-full rounded-xl bg-surface-2 border border-border p-2 text-sm font-mono resize-y"
                />
                <button
                  type="button"
                  onClick={addPastedIngredients}
                  disabled={!pasteText.trim()}
                  className="min-h-[40px] rounded-xl border border-border text-text-2 press disabled:opacity-60"
                >
                  {t('Añadir del texto')}
                </button>
                {pasteMsg && <p className="text-xs text-text-3" style={{ margin: 0 }}>{pasteMsg}</p>}
              </div>
            </details>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-2">{t('Peso cocido')} ({units === 'us' ? 'oz' : 'g'})</label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={units === 'us' ? (form.cooked_weight_g === '' ? '' : String(round(gToOz(Number(form.cooked_weight_g)), 2))) : form.cooked_weight_g}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => ({ ...f, cooked_weight_g: v === '' ? '' : units === 'us' ? String(round(ozToG(Number(v)), 1)) : v }));
              }}
              className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-text-3">{t('vacío = suma de ingredientes')}</p>
          </div>

          {newFoods.length > 0 && (
            <p className="text-sm text-text-3" role="status">
              {t('%n alimento%s nuevo%s sin guardar — se crea%n2 al guardar la receta, o guárdalo con ⤓.')
                .replace('%n', newFoods.length)
                .replace(/%s/g, newFoods.length === 1 ? '' : 's')
                .replace('%n2', newFoods.length === 1 ? '' : 'n')}
            </p>
          )}
          {showAdjustButton && (
            <div className="flex flex-col gap-2">
              {massWarn && (
                <p className="text-sm text-warn" role="status">
                  ⚠ {t('La suma de ingredientes (%a) no cuadra con el total (%b).')
                    .replace('%a', fmtG(sumGrams)).replace('%b', fmtG(totalGNum))}
                </p>
              )}
              <button
                type="button"
                onClick={handleAdjustMass}
                className="self-start min-h-[44px] px-3 rounded-xl border border-border text-text-2 press"
              >
                {t('Ajustar ingredientes al total (×%n)').replace('%n', adjustFactor)}
              </button>
            </div>
          )}
          {kcalMismatch && (
            <p className="text-sm text-warn" role="status">
              ⚠ {t('Las kcal calculadas (%a) difieren de la estimación del platillo (%b) — revisa cantidades.')
                .replace('%a', calcKcalTotal).replace('%b', kcalTotalEstimate)}
            </p>
          )}
          {densityOutOfRange && (
            <p className="text-sm text-warn" role="status">
              ⚠ {t('Densidad calórica fuera de rango físico.')}
            </p>
          )}

          {/* <lg: preview solo macros, en flujo normal debajo del form. */}
          {preview && (
            <div className="lg:hidden rounded-2xl bg-surface border border-border p-4">
              <p className="text-sm text-text-3 mb-2">{t('Preview por 100 g')}</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <PreviewStat label={t('Kcal')} value={preview.kcal} color="text-d-kcal" />
                <PreviewStat label={t('Prot')} value={preview.protein_g} color="text-d-prot" />
                <PreviewStat label={t('Carbs')} value={preview.carbs_g} color="text-d-carb" />
                <PreviewStat label={t('Grasa')} value={preview.fat_g} color="text-d-fat" />
              </div>
            </div>
          )}
        </div>

        {/* lg+: preview sticky a la derecha, extendido con micros visibles/favoritos. */}
        {preview && (
          <div className="hidden lg:block lg:sticky lg:top-6 rounded-2xl bg-surface border border-border p-4">
            <p className="text-sm text-text-3 mb-2">{t('Preview por 100 g')}</p>
            <div className="grid grid-cols-4 gap-2 text-center pb-3 border-b border-border">
              <PreviewStat label={t('Kcal')} value={preview.kcal} color="text-d-kcal" />
              <PreviewStat label={t('Prot')} value={preview.protein_g} color="text-d-prot" />
              <PreviewStat label={t('Carbs')} value={preview.carbs_g} color="text-d-carb" />
              <PreviewStat label={t('Grasa')} value={preview.fat_g} color="text-d-fat" />
            </div>
            {previewMicros.map((m) => {
              const v = preview.micros?.[m.key] ?? 0;
              return (
                <div key={m.key} className="flex justify-between py-1.5 border-t border-border text-sm">
                  <span className="text-text-2">{t(m.label)}</span>
                  <span className={`font-mono tabular-nums ${v === 0 ? 'text-text-3' : ''}`}>
                    {round(v, 2)} {m.unit}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmNew && newFoods.length > 0 && (
        <div className="rounded-2xl bg-surface-2 border border-border p-4 flex flex-col gap-3">
          <p className="text-sm text-text-2">
            {t('Se crearán %n alimento%s nuevo%s en tu catálogo:')
              .replace('%n', newFoods.length)
              .replace(/%s/g, newFoods.length === 1 ? '' : 's')}
          </p>
          <ul className="text-sm list-disc pl-5 flex flex-col gap-0.5">
            {newFoods.map((i, idx) => (
              <li key={idx}>{i.food.name}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveClick}
              className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
            >
              {t('Confirmar y guardar')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmNew(false)}
              className="min-h-[44px] px-4 rounded-xl border border-border text-text-2 press"
            >
              {t('Cancelar')}
            </button>
          </div>
        </div>
      )}

      {saveError && <p className="text-sm text-danger" role="status">{saveError}</p>}

      <button
        onClick={handleSaveClick}
        disabled={!form.name || form.ingredients.length === 0}
        className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-50"
      >
        {t('Guardar')}
      </button>

      {onDelete && (
        <button
          onClick={onDelete}
          className="min-h-[44px] rounded-xl border border-danger text-danger font-medium press"
        >
          {t('Borrar')}
        </button>
      )}
    </div>
  );
}

// Card de un alimento nuevo (staged, isNew) del flujo IA: permanece en modo edición
// —nombre, kcal y macros por 100 g editables (prefill de respaldo)— hasta que el usuario
// lo guarda con ⤓ (queda como fila compacta). USDA se busca y traduce de inmediato al
// montar y se ofrece como swap; el catálogo (match manual) tiene prioridad sobre la IA.
function StagedIngredientCard({ ing, onFood, onGrams, onSave, onRemove, onSwapCatalog, onSwapUsda }) {
  useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [fdcChips, setFdcChips] = useState([]);
  const [translated, setTranslated] = useState({}); // { [fdcId]: descripción_es }
  const [saving, setSaving] = useState(false);
  const { food } = ing;

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('foods')
        .select('id, name, kcal, protein_g, carbs_g, fat_g, micros, density_g_ml, portions')
        .ilike('name', `%${query.trim()}%`)
        .limit(8);
      setResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // USDA de inmediato al montar: busca y traduce sin que el usuario lo pida.
  useEffect(() => {
    if (!ing.usda_query || !FDC_KEY) return;
    let alive = true;
    searchFDC(ing.usda_query).then(async (chips) => {
      if (!alive) return;
      setFdcChips(chips);
      const entries = await Promise.all(chips.map(async (c) => [c.fdcId, await translateEnEs(c.description)]));
      if (alive) setTranslated(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [ing.usda_query]);

  async function handleUsdaPick(fdcId) {
    const detail = await fetchFDC(fdcId);
    if (detail) onSwapUsda(detail);
  }

  async function handleSave() {
    setSaving(true);
    await onSave();
    setSaving(false);
  }

  const num = (v) => (v === '' || v == null ? '' : v);
  const units = useUnits();
  const isUS = units === 'us';
  const gramsDisplay = isUS ? (ing.grams === '' || ing.grams == null ? '' : String(round(gToOz(Number(ing.grams)), 2))) : ing.grams;

  return (
    <div className="rounded-xl bg-surface-2 border border-warn p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={food.name}
          onChange={(e) => onFood({ name: e.target.value })}
          placeholder={t('Nombre del alimento')}
          className="flex-1 min-w-0 min-h-[44px] rounded-lg bg-surface-3 border border-border px-2 text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={gramsDisplay}
          onChange={(e) => {
            const v = e.target.value;
            onGrams(v === '' ? '' : isUS ? String(round(ozToG(Number(v)), 1)) : v);
          }}
          placeholder={isUS ? 'oz' : 'g'}
          className="w-16 min-h-[44px] rounded-lg bg-surface-3 border border-border px-2 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !food.name}
          className="p-1.5 text-text-2 hover:text-accent disabled:opacity-40"
          title={t('Guardar alimento')}
          aria-label={`${t('Guardar')} ${food.name}`}
        >
          <Save size={16} />
        </button>
        <button type="button" onClick={onRemove} className="p-1 text-danger" aria-label={`${t('Quitar')} ${food.name}`}>
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-text-3">{ing.procedencia || t('IA')} · {t('sin guardar')} · {t('valores por 100 g')}</p>
      <div className="grid grid-cols-4 gap-2">
        {[
          ['kcal', t('Kcal')],
          ['protein_g', t('Prot')],
          ['carbs_g', t('Carbs')],
          ['fat_g', t('Grasa')],
        ].map(([key, label]) => (
          <label key={key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-text-3">{label}</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={num(food[key])}
              onChange={(e) => onFood({ [key]: e.target.value })}
              placeholder="—"
              className="min-h-[44px] rounded-lg bg-surface-3 border border-border px-2 text-text font-mono tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('¿Ya está en tu catálogo? Búscalo…')}
        className="input text-sm"
      />
      {results.length > 0 && (
        <div className="rounded-xl bg-surface-3 border border-border overflow-hidden">
          {results.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onSwapCatalog(f, true)}
              className="w-full text-left px-3 py-2 text-sm active:bg-surface-2"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      {fdcChips.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {fdcChips.map((c) => (
            <button
              key={c.fdcId}
              type="button"
              onClick={() => handleUsdaPick(c.fdcId)}
              className="text-xs min-h-[36px] px-3 rounded-full bg-surface-3 border border-border text-text-2 press"
            >
              USDA: {translated[c.fdcId] || c.description}
            </button>
          ))}
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
