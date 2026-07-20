import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Plus, ChevronLeft, Search, Star, AlertTriangle, Trash2, Upload,
} from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { useToast } from '../lib/useToast.js';
import {
  MICROS, MICROS_DEFAULT, microGroups, round, kcalFromMacros, kcalSuspicious, macrosImplausible,
  componentsInconsistent, isWaterSentinel, eanChecksumValid, mergeFoodResults, normalizeTo100,
} from '../lib/domain.js';
import { fetchOFF, searchFDC, fetchFDC } from '../lib/sources.js';
import { GEMINI_KEY, DENSITY_PRESETS, estimateFood, embedText } from '../lib/ai.js';
import { t, useLang, useUnits, gToOz, mlToFlOz } from '../lib/i18n.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import UndoToast from '../components/UndoToast.jsx';
import SortTh from '../components/SortTh.jsx';
import AiDataCard from '../components/AiDataCard.jsx';
import ImportSheet from '../components/ImportSheet.jsx';
import PortionsEditor from '../components/PortionsEditor.jsx';

// ponytail: matchMedia instead of a custom resize observer; same pattern as Today.jsx.
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

function hasWarning(f) {
  return kcalSuspicious(f) || macrosImplausible(f) || componentsInconsistent(f);
}

// The ⚠ warning is only rendered if the user has NOT reviewed it: `reviewed_at` does not
// disable the computation (it remains in the form), it merely stops flagging it in the list.
// Saving the food clears it (see handleSave), so any edit of the values re-exposes the warning.
// Base-catalog foods (owner null) NEVER warn: the user cannot edit them in place
// (marking them "reviewed" would only create a copy and leave the base food still
// warning), and they trigger false positives (e.g. cocoa at 228 kcal, correct, but Atwater
// overestimates due to the fiber). The user's own copy does participate in the review flow.
function pendingWarning(f) {
  return f.owner != null && hasWarning(f) && !f.reviewed_at;
}

const SOURCE_LABELS = { manual: 'Manual', etiqueta: 'Etiqueta', gemini: 'IA', off: 'OFF', usda: 'USDA', cronometer: 'Cronometer', ia_personal: 'IA personal' };
function sourceLabel(s) {
  return t(SOURCE_LABELS[s] || s);
}

const EMPTY_FOOD = {
  name: '', brand: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '',
  micros: {}, portions: [], density_g_ml: '', source: 'manual',
};

export default function Foods() {
  useLang();
  // SWR: paints the session cache instantly while the background load() refreshes it.
  const [foods, setFoods] = useState(() => cacheGet('foods') || []);
  const [loading, setLoading] = useState(() => !cacheGet('foods'));
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const location = useLocation();
  // creation initiated from Today: /foods with state.newFood opens the form pre-filled
  const [editing, setEditing] = useState(() =>
    location.state?.newFood ? { ...EMPTY_FOOD, ...location.state.newFood } : null
  ); // null = list view, object = form view
  const [toast, showToast] = useToast();
  const [userId, setUserId] = useState(null);
  const [favs, setFavs] = useState([]); // prefs.data.fav_micros: micros promoted out of "Más micros"
  const [undoData, setUndoData] = useState(null); // { food, timer } after a deletion, for "Undo"
  const isLg = useIsLgUp();
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filterSource, setFilterSource] = useState('');
  const [warnOnly, setWarnOnly] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [query]);

  // ponytail: clears the history state so that a refresh does not reopen the form
  useEffect(() => {
    if (location.state?.newFood) window.history.replaceState({}, '');
  }, []);

  // lg+ shortcuts: "/" focuses the search box (if focus is not on an input), Esc closes the panel.
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

  useEffect(() => {
    loadPrefs();
  }, []);

  async function loadPrefs() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    if (data?.data?.fav_micros) setFavs(data.data.fav_micros);
  }

  async function toggleFav(key) {
    const next = favs.includes(key) ? favs.filter((k) => k !== key) : [...favs, key];
    setFavs(next);
    // merge over the existing data so as not to overwrite water_glass_ml and other prefs
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    await supabase.from('prefs').upsert({ owner: userId, data: { ...(data?.data || {}), fav_micros: next } });
  }

  async function load() {
    // Only the base list (no search) is cached: it is the view shown when landing
    // on the tab. The skeleton only appears when there is nothing to paint.
    const isBase = !query.trim();
    if (!(isBase && cacheGet('foods'))) setLoading(true);
    let req = supabase.from('foods').select('id,name,brand,kcal,protein_g,carbs_g,fat_g,micros,portions,density_g_ml,source,owner,reviewed_at').order('name');
    if (!isBase) req = req.ilike('name', `%${query.trim()}%`);
    const { data, error } = await req;
    if (error) { showToast(t('No se pudieron cargar los alimentos — revisa tu conexión.')); setLoading(false); return; }
    let hits = data;
    // Semantic fallback search: only when ilike yields few hits. It must never
    // break the normal search — embedText already returns null on any failure.
    if (!isBase && GEMINI_KEY && query.trim().length >= 3 && data.length < 8) {
      try {
        const vec = await embedText(query.trim());
        if (vec) {
          const { data: semantic } = await supabase.rpc('match_foods', { q: JSON.stringify(vec), n: 8 });
          hits = mergeFoodResults(hits, semantic, 8);
        }
      } catch {
        // ignored: keeps the ilike hits
      }
    }
    const list = hits.filter((f) => !isWaterSentinel(f));
    setFoods(isBase ? cacheSet('foods', list) : list);
    setLoading(false);
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
      portions: (food.portions || [])
        .filter((p) => p.name.trim() && Number(p.grams) > 0)
        .map((p) => ({ name: p.name.trim(), grams: Number(p.grams) })),
      density_g_ml: Number(food.density_g_ml) > 0 ? Number(food.density_g_ml) : null,
      source: food.source,
      // Only the form's "Marcar revisado" button sends a timestamp; any other
      // save leaves it null and the ⚠ warning reappears.
      reviewed_at: food.reviewed_at || null,
    };
    const { data: saved, error } = food.id
      ? await supabase.from('foods').update(payload).eq('id', food.id).select().single()
      : await supabase.from('foods').insert(payload).select().single();

    if (error) {
      showToast(t('Error al guardar.'));
      return;
    }
    showToast(t('Guardado.'));
    setEditing(null);
    load();
    // Embedding for semantic search: fire-and-forget, never blocks the save.
    embedText(saved.name.trim() + (saved.brand?.trim() ? ' ' + saved.brand.trim() : '')).then((e) => {
      if (e) supabase.from('foods').update({ embedding: JSON.stringify(e) }).eq('id', saved.id);
    });
  }

  // Deletion without confirmation (swipe in the list and the form's "Borrar" button):
  // optimistic + 5 s "Undo" toast that re-inserts the food. Consistent with Today.
  async function handleDelete(id) {
    const food = foods.find((f) => f.id === id);
    setEditing(null);
    setFoods((fs) => fs.filter((f) => f.id !== id));
    const { data, error } = await supabase.from('foods').delete().eq('id', id).select('id');
    if (error) {
      load();
      showToast(t('Tiene registros asociados, no se puede borrar.'));
      return;
    }
    if (!data || data.length === 0) {
      load();
      showToast(t('Solo puedes borrar tus propios alimentos.'));
      return;
    }
    setUndoData((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndoData(null), 5000);
      return { food, timer };
    });
  }

  async function handleUndo() {
    if (!undoData) return;
    clearTimeout(undoData.timer);
    const { id, ...rest } = undoData.food; // re-insert without the id; nothing references it (it was deletable → no entries)
    setUndoData(null);
    const { error } = await supabase.from('foods').insert(rest);
    if (!error) load();
  }

  // <lg: full-page replacement, unchanged from the existing behavior.
  if (editing && !isLg) {
    return (
      <div className="px-4 py-4">
        <FoodForm
          food={editing}
          favs={favs}
          onToggleFav={toggleFav}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
          onDelete={editing.id && editing.owner ? () => handleDelete(editing.id) : null}
        />
      </div>
    );
  }

  function toggleSort(key) {
    setSortDir((d) => (sortKey === key ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
  }

  // Only sources with at least one food: do not offer filters that would yield an empty list.
  const sourceOptions = [...new Set(foods.map((f) => f.source).filter(Boolean))].sort();

  let visibleFoods = foods;
  if (filterSource) visibleFoods = visibleFoods.filter((f) => f.source === filterSource);
  if (warnOnly) visibleFoods = visibleFoods.filter(pendingWarning);
  if (sortKey) {
    visibleFoods = [...visibleFoods].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  } else if (query.trim()) {
    // base catalog (usda) last, only with an active search and no explicit sort
    visibleFoods = [...visibleFoods].sort((a, b) => (a.source === 'usda') - (b.source === 'usda'));
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:items-start">
      {importing && (
        <ImportSheet
          kind="foods"
          onClose={() => setImporting(false)}
          onDone={(n) => { setImporting(false); showToast(t('%n alimentos importados.').replace('%n', n)); load(); }}
        />
      )}
      <div className="flex flex-col gap-4 lg:col-start-1">
        {/* On lg+ creation goes through the right panel ("＋ Nuevo alimento" in the empty state);
            on <lg through the FAB. No header button, to avoid duplication. */}
        <h1 className="font-display text-xl">{t('Alimentos')}</h1>

        {/* Search box on its own row; on lg+ the master column (5/12) lacks the width
            for search + import + 2 filters on a single line (they were getting clipped). */}
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Buscar…')}
              className="w-full min-h-[44px] rounded-xl bg-surface-2 border border-border pl-10 pr-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="min-h-[44px] px-3 rounded-xl border border-border bg-surface-2 text-text-2 press whitespace-nowrap inline-flex items-center justify-center gap-1.5 flex-1 lg:flex-none"
            >
              <Upload size={16} /> {t('Importar')}
            </button>
            <div className="flex gap-2 flex-1">
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="min-h-[44px] flex-1 min-w-0 rounded-xl bg-surface-2 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">{t('Todos')}</option>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>{sourceLabel(s)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setWarnOnly((w) => !w)}
                aria-pressed={warnOnly}
                aria-label={t('Solo alimentos con avisos')}
                title={t('Solo alimentos con avisos')}
                className={`min-h-[44px] w-[44px] shrink-0 rounded-xl border press inline-flex items-center justify-center ${
                  warnOnly ? 'bg-warn/20 border-warn text-warn' : 'border-border text-text-3'
                }`}
              >
                <AlertTriangle size={18} />
              </button>
            </div>
          </div>
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
            {query.trim() && cacheGet('foods')?.length > 0 ? (
              <p className="text-text-2">{t('Sin coincidencias con tu búsqueda')}</p>
            ) : (
              <>
                <p className="text-text-2">{t('Sin alimentos aún')}</p>
                <button
                  onClick={() => setEditing(EMPTY_FOOD)}
                  className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
                >
                  {t('Crear el primero')}
                </button>
              </>
            )}
          </div>
        )}

        {/* <lg: cards + swipe. Same filtered/sorted list as the lg+ table (visibleFoods). */}
        {!loading && foods.length > 0 && (
          <div className="flex flex-col gap-4 lg:hidden">
            {visibleFoods.map((f) => (
              <SwipeToDelete
                key={f.id}
                onTap={() => setEditing(f)}
                onDelete={f.owner ? () => handleDelete(f.id) : undefined}
                className="rounded-2xl bg-surface border border-border p-4"
              >
                <div className="flex justify-between items-baseline gap-2">
                  <span className="font-medium">
                    {f.name}
                    {pendingWarning(f) && (
                      <AlertTriangle
                        size={14}
                        className="inline ml-1.5 -mt-0.5 text-warn"
                        aria-label={t('Valores nutricionales requieren revisión')}
                      />
                    )}
                  </span>
                  <span className="font-mono tabular-nums text-text-2 text-sm shrink-0">{f.kcal} kcal</span>
                </div>
                {f.brand && <span className="text-sm text-text-3">{f.brand}</span>}
              </SwipeToDelete>
            ))}
            {visibleFoods.length === 0 && (
              <p className="px-3 py-6 text-center text-text-2">{t('Sin resultados con estos filtros.')}</p>
            )}
          </div>
        )}

        {/* lg+: sortable table with hover actions. */}
        {!loading && foods.length > 0 && (
          <div className="hidden lg:block rounded-2xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-text-2 text-left">
                  <SortTh label={t('Nombre')} sortKey="name" active={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortTh label={t('Kcal')} sortKey="kcal" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label={t('P')} sortKey="protein_g" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label={t('C')} sortKey="carbs_g" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <SortTh label={t('G')} sortKey="fat_g" active={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  {/* Source is kept out of the table: even with the master column at 50% there is
                      no width for 7 columns. The source is visible in the panel's detail card. */}
                  <th className="px-3 py-2 text-center w-16">⚠</th>
                </tr>
              </thead>
              <tbody>
                {visibleFoods.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => setEditing(f)}
                    className={`group relative border-t border-border cursor-pointer hover:bg-surface-2 ${
                      editing?.id === f.id ? 'bg-surface-2 ring-1 ring-inset ring-accent' : ''
                    }`}
                  >
                    {/* max-w-0 + w-full: the column absorbs the leftover width. line-clamp-2:
                        1 line when there is width, at most 2 as it narrows (full name in
                        the panel's detail card and in title) — never 6 lines. */}
                    <td className="px-3 py-2 max-w-0 w-full">
                      <div className="font-medium line-clamp-2" title={f.name}>{f.name}</div>
                      {f.brand && <div className="text-xs text-text-3 truncate" title={f.brand}>{f.brand}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{f.kcal}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{f.protein_g}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{f.carbs_g}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{f.fat_g}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <span className="w-4 flex justify-center">
                          {pendingWarning(f) && (
                            <AlertTriangle size={14} className="text-warn" aria-label={t('Valores nutricionales requieren revisión')} />
                          )}
                        </span>
                        {f.owner && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(f.id);
                            }}
                            className="p-1.5 text-text-2 hover:text-danger opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={`${t('Borrar')} ${f.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleFoods.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-text-2">{t('Sin resultados con estos filtros.')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Right panel (lg+): detail card/editor, master-detail. */}
      <div className="hidden lg:block lg:col-start-2 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        {editing ? (
          <div className="rounded-2xl bg-surface border border-border p-6">
            <FoodForm
              food={editing}
              favs={favs}
              onToggleFav={toggleFav}
              onCancel={() => setEditing(null)}
              onSave={handleSave}
              onDelete={editing.id && editing.owner ? () => handleDelete(editing.id) : null}
            />
          </div>
        ) : (
          <div className="rounded-2xl bg-surface border border-border p-10 flex flex-col items-center gap-3 text-center">
            <p className="text-text-2">{t('Selecciona un alimento o crea uno nuevo')}</p>
            <button
              onClick={() => setEditing(EMPTY_FOOD)}
              className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
            >
              ＋ {t('Nuevo alimento')}
            </button>
          </div>
        )}
      </div>

      {!loading && foods.length > 0 && (
        <button
          onClick={() => setEditing(EMPTY_FOOD)}
          className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-on-accent flex items-center justify-center press lg:hidden"
          aria-label={t('Añadir alimento')}
        >
          <Plus size={24} />
        </button>
      )}

      {undoData && <UndoToast message={t('Alimento borrado')} onUndo={handleUndo} />}

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

// Required fields are ALWAYS filled with the best available estimate (null only when a
// well-founded figure is impossible). The remaining micros: only with reliable data, otherwise null.
const REQUIRED_MICROS = ['sodio_mg', 'potasio_mg', 'magnesio_mg'];
const REQUIRED_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', ...REQUIRED_MICROS];
const MACRO_LABELS = { kcal: 'Kcal', protein_g: 'Proteína', carbs_g: 'Carbs', fat_g: 'Grasa' };

function labelFor(key) {
  return t(MACRO_LABELS[key] || MICROS.find((m) => m.key === key)?.label || key);
}

const NUMERIC_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];

// winner wins on every field it carries; filler only fills in what winner lacks.
function fillAll(winner, filler) {
  if (!filler) return winner;
  const out = { ...winner, micros: { ...filler.micros, ...winner.micros } };
  for (const k of NUMERIC_KEYS) {
    if (out[k] === '' || out[k] == null) out[k] = filler[k] ?? '';
  }
  if (!out.name) out.name = filler.name || '';
  if (!out.brand) out.brand = filler.brand || '';
  return out;
}

// winner wins on everything it carries; filler only fills in the missing REQUIRED fields
// (no other speculative micros from filler are let through when winner is authoritative).
function fillRequired(winner, filler) {
  if (!filler) return winner;
  const out = { ...winner, micros: { ...winner.micros } };
  for (const k of NUMERIC_KEYS) {
    if ((out[k] === '' || out[k] == null) && filler[k] != null && filler[k] !== '') out[k] = filler[k];
  }
  for (const mk of REQUIRED_MICROS) {
    if (out.micros[mk] == null && filler.micros?.[mk] != null) out.micros[mk] = filler.micros[mk];
  }
  if (!out.name) out.name = filler.name || '';
  if (!out.brand) out.brand = filler.brand || '';
  return out;
}

// Fields where a and b (both with numeric data) differ by >25% relative to the larger one.
// Only counts if both exceed DISCREPANCY_MIN (avoids flagging 0.2 vs 0.3). Ephemeral,
// solely for the label-vs-OFF UI warning — none of this is persisted.
const DISCREPANCY_MIN = 5;

function findDiscrepancies(a, b) {
  if (!a || !b) return [];
  const keys = [...NUMERIC_KEYS, ...MICROS.map((m) => m.key)];
  const out = [];
  for (const k of keys) {
    const av = NUMERIC_KEYS.includes(k) ? a[k] : a.micros?.[k];
    const bv = NUMERIC_KEYS.includes(k) ? b[k] : b.micros?.[k];
    if (av === '' || av == null || bv === '' || bv == null) continue;
    const an = Number(av);
    const bn = Number(bv);
    if (an <= DISCREPANCY_MIN || bn <= DISCREPANCY_MIN) continue;
    if (Math.abs(an - bn) / Math.max(an, bn) > 0.25) out.push(labelFor(k));
  }
  return out;
}

function missingRequired(obj) {
  return REQUIRED_KEYS.filter((k) => {
    const v = NUMERIC_KEYS.includes(k) ? obj[k] : obj.micros?.[k];
    return v === '' || v == null;
  }).map(labelFor);
}

// A 0 returned by the source does not fill the input (visual anti-spam): empty field +
// placeholder "0". Semantically identical to omitting it (an absent micro weighs 0).
function stripZeros(obj) {
  const zeros = new Set();
  const cleaned = { ...obj, micros: { ...obj.micros } };
  for (const k of NUMERIC_KEYS) {
    if (cleaned[k] === 0) {
      zeros.add(k);
      cleaned[k] = '';
    }
  }
  for (const [k, v] of Object.entries(cleaned.micros)) {
    if (v === 0) {
      zeros.add(k);
      delete cleaned.micros[k];
    }
  }
  return { cleaned, zeros };
}

function extractEan(text) {
  const digits = text.replace(/[\s-]/g, '');
  return /^\d{8,14}$/.test(digits) ? digits : null;
}

function resultBadgeText(r) {
  if (!r) return '';
  if (r.source === 'etiqueta') return `📋 ${t('Etiqueta transcrita')}`;
  if (r.source === 'off') return `✔ Open Food Facts: ${r.name || ''}`;
  if (r.source === 'usda') return `USDA: ${r.name || ''}`;
  return `≈ ${t('Estimación IA')} (${t('confianza')} ${t(r.confidence) || '—'})`;
}

function FoodForm({ food, favs, onToggleFav, onCancel, onSave, onDelete }) {
  useLang();
  // density from the DB (numeric) may arrive as a string: it is normalized so the select matches.
  // When editing, stored 0s (kcal/macros/micros) start out empty with placeholder "0" (same
  // pattern as the AI prefill): a 0 adds no new information, and this way it is visible what remains to review.
  const { cleaned: initialForm, zeros: initialZeros } = stripZeros({
    ...EMPTY_FOOD,
    ...food,
    density_g_ml: food.density_g_ml > 0 ? Number(food.density_g_ml) : '',
    portions: food.portions || [],
  });
  const [form, setForm] = useState(initialForm);
  const [basis, setBasis] = useState('100'); // amount (in basisUnit) that the captured values refer to
  const [basisUnit, setBasisUnit] = useState('g'); // 'g'|'ml' — the form's basis, 1 g/ml is NEVER assumed

  // true = the user chose "Otro…" for liquid (manual density even if empty)
  const [densityOther, setDensityOther] = useState(
    food.density_g_ml > 0 && !DENSITY_PRESETS.some((p) => p.value === Number(food.density_g_ml))
  );
  const [aiText, setAiText] = useState('');
  const [aiFiles, setAiFiles] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiZeros, setAiZeros] = useState(initialZeros); // keys whose value (initial or from AI prefill) was 0 → placeholder, not a value
  const [aiResult, setAiResult] = useState(null); // { source, name, confidence } for the result line
  const [aiMissing, setAiMissing] = useState([]); // labels of required fields lacking reliable data
  const [fdcChips, setFdcChips] = useState([]); // up to 6 FDC matches (from usda_query or manual search)
  const [labelMismatch, setLabelMismatch] = useState([]); // labels where the nutrition label and OFF differ by >25%, UI only
  const [sweeteners, setSweeteners] = useState([]); // sweeteners detected by OFF (presence, not amount), UI only

  // Touching any field invalidates the prior review: the values are no longer the ones the
  // user confirmed, so the ⚠ warning re-arms immediately (and handleSave persists it).
  function setField(key, value) {
    setForm((f) => ({ ...f, reviewed_at: null, [key]: value }));
  }

  function applyPrefill(merged, source, resultName, confidence, prefillBasisUnit = 'g') {
    const missing = missingRequired(merged);
    const { cleaned, zeros } = stripZeros(merged);
    setAiZeros(zeros);
    setAiMissing(missing);
    setForm((f) => ({
      ...f,
      name: cleaned.name || f.name,
      brand: cleaned.brand || f.brand,
      kcal: cleaned.kcal,
      protein_g: cleaned.protein_g,
      carbs_g: cleaned.carbs_g,
      fat_g: cleaned.fat_g,
      micros: cleaned.micros,
      density_g_ml: cleaned.density_g_ml ?? f.density_g_ml,
      source,
    }));
    setDensityOther(cleaned.density_g_ml > 0 && !DENSITY_PRESETS.some((p) => p.value === cleaned.density_g_ml));
    setBasis('100');
    setBasisUnit(prefillBasisUnit);
    setAiResult({ source, name: resultName, confidence });
  }

  // If the basis is 100 ml: the form stays in ml basis with the declared numbers as-is
  // (verifiable against the packaging); Gemini's density only pre-selects the dropdown.
  // The conversion to 100 g happens on save (normalizeTo100); without a density the save
  // remains blocked until the user chooses one.
  function applyPrefillWithBasis(merged, source, resultName, confidence, basisStr, densityHint) {
    if (basisStr === '100ml') {
      const density = Number(densityHint) > 0 ? Number(densityHint) : 0;
      applyPrefill(density > 0 ? { ...merged, density_g_ml: density } : merged, source, resultName, confidence, 'ml');
    } else {
      applyPrefill(merged, source, resultName, confidence);
    }
  }

  async function handleFetchData() {
    if (!aiText.trim() && aiFiles.length === 0) return;
    setAiLoading(true);
    setAiError('');
    setFdcChips([]);
    setAiResult(null);
    setAiMissing([]);
    setLabelMismatch([]);
    setSweeteners([]);
    try {
      const eanTyped = extractEan(aiText);
      if (eanTyped) {
        if (!eanChecksumValid(eanTyped)) {
          throw new Error(t('Código de barras inválido: dígito verificador no coincide, revísalo'));
        }
        const off = await fetchOFF(eanTyped);
        if (!off) throw new Error(t('EAN no encontrado en Open Food Facts.'));
        setSweeteners(off.sweeteners || []);
        // EAN typed in directly: without Gemini there is no known density, so an OFF
        // product per 100 ml can only leave the form in ml basis, waiting for the
        // user to choose a density (see normalizeTo100).
        applyPrefillWithBasis(off, 'off', off.name, null, off.per, null);
      } else {
        const gemini = await estimateFood(aiText, aiFiles);
        const eanFromGemini = gemini.ean && eanChecksumValid(gemini.ean) ? gemini.ean : null;
        const [off, fdcMatches] = await Promise.all([
          eanFromGemini ? fetchOFF(eanFromGemini) : Promise.resolve(null),
          gemini.usda_query ? searchFDC(gemini.usda_query) : Promise.resolve([]),
        ]);
        setFdcChips(fdcMatches);
        setSweeteners(off?.sweeteners || []);
        if (gemini.mode === 'etiqueta') {
          // Compare label vs OFF only if both are on the same basis; otherwise it is skipped
          // (never compared cross-basis g vs ml).
          setLabelMismatch(off && gemini.basis === off.per ? findDiscrepancies(gemini, off) : []);
          applyPrefillWithBasis(fillAll(gemini, off), 'etiqueta', null, gemini.confidence, gemini.basis, gemini.density_g_ml);
        } else if (off) {
          applyPrefillWithBasis(fillRequired(off, gemini), 'off', off.name, null, off.per, gemini.density_g_ml);
        } else {
          applyPrefillWithBasis(gemini, 'gemini', null, gemini.confidence, gemini.basis, gemini.density_g_ml);
        }
      }
    } catch (e) {
      setAiError(e.message || t('No se pudo obtener datos. Revisa la conexión o intenta con otra descripción/foto.'));
    }
    setAiLoading(false);
  }

  async function handleFdcChip(fdcId, description) {
    setAiLoading(true);
    setAiError('');
    try {
      const detail = await fetchFDC(fdcId);
      if (!detail) throw new Error(t('No se pudo obtener el detalle de USDA.'));
      applyPrefill(detail, 'usda', description, null);
    } catch (e) {
      setAiError(e.message);
    }
    setAiLoading(false);
  }

  function setMicro(key, value) {
    setForm((f) => {
      const micros = { ...f.micros };
      if (value === '') delete micros[key];
      else micros[key] = Number(value);
      return { ...f, reviewed_at: null, micros };
    });
  }

  const kcalCalc = kcalFromMacros(form);
  const hasMacros = form.protein_g !== '' || form.carbs_g !== '' || form.fat_g !== '';
  const suspicious = form.kcal !== '' && hasMacros && kcalSuspicious(form);
  // Plausibility is ALWAYS evaluated on values normalized to 100 g: with a basis ≠ 100 g
  // (e.g. "per 30 g" or per 100 ml) the absolute thresholds would be mis-scaled.
  const normForCheck = normalizeTo100(form, basis, basisUnit) ?? form;
  const implausible = macrosImplausible(normForCheck);
  const inconsistent = componentsInconsistent(normForCheck);
  const warned = Boolean(suspicious || implausible || inconsistent);
  // empty kcal → the macro-based computation (the placeholder the user sees) is saved
  const submitValues = () => normalizeTo100({ ...form, kcal: form.kcal === '' ? kcalCalc : form.kcal }, basis, basisUnit);
  // Base-catalog food (owner null): saving ALWAYS creates the user's own copy
  // (no id → handleSave takes the insert branch; the server assigns owner = auth.uid()).
  const isBaseFood = food.owner === null;
  const save = (values) => onSave(isBaseFood ? { ...values, id: undefined } : values);
  const hiddenMicros = MICROS.slice(MICROS_DEFAULT);
  const basisDensity = Number(form.density_g_ml) || 0;
  const basisBlocked = basisUnit === 'ml' && !(basisDensity > 0);
  // Silent hint with the US-units equivalent: composition is captured in g/ml (labeling
  // standard), but the US user is shown what their basis is equivalent to. Display only.
  const isUS = useUnits() === 'us';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="p-2 -ml-2 press" aria-label={t('Volver')}>
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl">{form.id ? t('Editar alimento') : t('Nuevo alimento')}</h1>
      </div>

      {food.owner === null && (
        <p className="text-sm text-accent">
          {t('Alimento del catálogo base — al guardar se creará tu propia copia.')}
        </p>
      )}

      {GEMINI_KEY && (
        <AiDataCard
          text={aiText}
          onText={setAiText}
          files={aiFiles}
          onFiles={setAiFiles}
          loading={aiLoading}
          error={aiError}
          onSubmit={handleFetchData}
          placeholder={t('Describe el alimento, pega un código de barras (EAN) o adjunta una foto de etiqueta/platillo')}
          hint={t('Etiqueta legible → se transcribe. EAN → Open Food Facts. Si no, estimación IA con chips USDA para genéricos. Siempre por 100 g; revisa antes de guardar.')}
        >
          {aiResult && <p className="text-xs text-text-2">{resultBadgeText(aiResult)}</p>}
          {aiMissing.length > 0 && (
            <p className="text-xs text-warn" role="status">{t('Sin dato fiable de:')} {aiMissing.join(', ')}</p>
          )}
          {labelMismatch.length > 0 && (
            <p className="text-xs text-warn" role="status">
              ⚠ {t('La etiqueta y Open Food Facts difieren en:')} {labelMismatch.join(', ')}.
            </p>
          )}
          {sweeteners.length > 0 && (
            <p className="text-xs text-text-2" role="status">
              {t('Open Food Facts reporta edulcorantes:')}{' '}
              {sweeteners.map((s) => `${s.name} (${s.code})`).join(', ')}.{' '}
              {t('La cantidad casi nunca se declara; captúrala en su micro si la conoces.')}
            </p>
          )}
        </AiDataCard>
      )}

      {fdcChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fdcChips.map((c) => (
            <button
              key={c.fdcId}
              type="button"
              onClick={() => handleFdcChip(c.fdcId, c.description)}
              className="text-xs min-h-[44px] px-3 rounded-full bg-surface-3 border border-border text-text-2 press"
            >
              USDA: {c.description}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (basisBlocked) return; // button already disabled; safeguard in case the submit arrives via Enter
          save(submitValues());
        }}
        className="flex flex-col gap-4"
      >
        <Field label={t('Nombre')} required>
          <input
            required
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            className="input"
          />
        </Field>

        <Field label={t('Marca')}>
          <input
            value={form.brand || ''}
            onChange={(e) => setField('brand', e.target.value)}
            className="input"
          />
        </Field>

        <div className="flex flex-col gap-1 text-sm text-text-3">
          <div className="flex items-center gap-2">
            <span>{t('Valores por')}</span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              step="any"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              className="w-20 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-center text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label={t('Base de los valores capturados')}
            />
            <div className="flex rounded-lg border border-border overflow-hidden text-sm">
              {['g', 'ml'].map((u) => (
                <button
                  type="button"
                  key={u}
                  onClick={() => setBasisUnit(u)}
                  className={`px-3 py-1.5 ${basisUnit === u ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2'}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          {basisUnit === 'g' && Number(basis) !== 100 && Number(basis) > 0 && (
            <span className="text-xs text-accent">{t('se convertirá a 100 g al guardar')}</span>
          )}
          {basisUnit === 'ml' && basisDensity > 0 && Number(basis) > 0 && (
            <span className="text-xs text-accent">
              {basis} ml × {basisDensity} = {round(Number(basis) * basisDensity, 1)} g → {t('se convertirá a 100 g al guardar')}
            </span>
          )}
          {basisBlocked && (
            <span className="text-xs text-warn" role="status">
              {t('Elige el tipo de líquido para convertir ml a gramos')}
            </span>
          )}
          {isUS && Number(basis) > 0 && (
            <span className="text-xs text-text-3 font-mono tabular-nums">
              ≈ {basisUnit === 'ml' ? `${round(mlToFlOz(Number(basis)), 2)} fl oz` : `${round(gToOz(Number(basis)), 2)} oz`}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:hidden">
          <NumberField
            label={t('Kcal')}
            value={form.kcal}
            onChange={(v) => setField('kcal', v)}
            placeholder={aiZeros.has('kcal') ? '0' : hasMacros ? `≈ ${kcalCalc}` : ''}
          />
          <NumberField
            label={`${t('Proteína')} (g)`}
            value={form.protein_g}
            onChange={(v) => setField('protein_g', v)}
            placeholder={aiZeros.has('protein_g') ? '0' : ''}
          />
          <NumberField
            label={`${t('Carbs')} (g)`}
            value={form.carbs_g}
            onChange={(v) => setField('carbs_g', v)}
            placeholder={aiZeros.has('carbs_g') ? '0' : ''}
          />
          <NumberField
            label={`${t('Grasa')} (g)`}
            value={form.fat_g}
            onChange={(v) => setField('fat_g', v)}
            placeholder={aiZeros.has('fat_g') ? '0' : ''}
          />
          {MICROS.slice(0, MICROS_DEFAULT).map((m) => (
            <NumberField
              key={m.key}
              label={`${t(m.label)} (${m.unit})`}
              value={form.micros[m.key] ?? ''}
              onChange={(v) => setMicro(m.key, v)}
              placeholder={aiZeros.has(m.key) ? '0' : ''}
            />
          ))}
          {hiddenMicros.filter((m) => favs.includes(m.key)).map((m) => (
            <MicroField
              key={m.key}
              m={m}
              fav
              value={form.micros[m.key] ?? ''}
              onChange={(v) => setMicro(m.key, v)}
              onToggleFav={() => onToggleFav(m.key)}
              placeholder={aiZeros.has(m.key) ? '0' : ''}
            />
          ))}
        </div>

        {/* lg+: required fields full-width on top, remaining micros by category in balanced columns (CSS masonry), no accordion. */}
        <div className="hidden lg:block">
          <p className="text-xs text-text-3 pb-3">{t('★ = favorito, se promueve arriba en móvil.')}</p>
          <div className="grid grid-cols-3 xl:grid-cols-4 gap-3">
            <NumberField
              label={t('Kcal')}
              value={form.kcal}
              onChange={(v) => setField('kcal', v)}
              placeholder={aiZeros.has('kcal') ? '0' : hasMacros ? `≈ ${kcalCalc}` : ''}
            />
            <NumberField
              label={`${t('Proteína')} (g)`}
              value={form.protein_g}
              onChange={(v) => setField('protein_g', v)}
              placeholder={aiZeros.has('protein_g') ? '0' : ''}
            />
            <NumberField
              label={`${t('Carbs')} (g)`}
              value={form.carbs_g}
              onChange={(v) => setField('carbs_g', v)}
              placeholder={aiZeros.has('carbs_g') ? '0' : ''}
            />
            <NumberField
              label={`${t('Grasa')} (g)`}
              value={form.fat_g}
              onChange={(v) => setField('fat_g', v)}
              placeholder={aiZeros.has('fat_g') ? '0' : ''}
            />
            {MICROS.filter((m) => REQUIRED_MICROS.includes(m.key)).map((m) => (
              <NumberField
                key={m.key}
                label={`${t(m.label)} (${m.unit})`}
                value={form.micros[m.key] ?? ''}
                onChange={(v) => setMicro(m.key, v)}
                placeholder={aiZeros.has(m.key) ? '0' : ''}
              />
            ))}
          </div>
          {/* Full-width category + fields in a grid. Per-group masonry
              (`columns-2` + `break-inside-avoid`) left one huge column and the other
              nearly empty: with Vitamins (18), Sweeteners (18) and Amino acids (19) the
              group cannot be split and the columns never balance. */}
          <div className="mt-4 flex flex-col gap-4">
            {microGroups(MICROS.filter((m) => !REQUIRED_MICROS.includes(m.key))).map(({ cat, items }) => (
              <div key={cat}>
                <p className="text-xs uppercase tracking-wide text-text-3 pb-1">{t(cat)}</p>
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                  {items.map((m) => (
                    <MicroField
                      key={m.key}
                      m={m}
                      fav={favs.includes(m.key)}
                      value={form.micros[m.key] ?? ''}
                      onChange={(v) => setMicro(m.key, v)}
                      onToggleFav={() => onToggleFav(m.key)}
                      placeholder={aiZeros.has(m.key) ? '0' : ''}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {form.kcal === '' && hasMacros && (
          <p className="text-xs text-text-3">{t('Si dejas Kcal vacío, se guardará el cálculo por macros (≈ %n).').replace('%n', kcalCalc)}</p>
        )}
        {/* ⚠ warnings: if the user has already reviewed these values and accepted them, they
            degrade to a muted line (they never disappear entirely). Touching any field
            clears reviewed_at and restores them to their full form. */}
        {!form.reviewed_at && suspicious && (
          <p className="text-sm text-warn" role="status">
            ⚠ {t('%n kcal no cuadran con los macros (≈ %m kcal por Atwater). El alimento quedará marcado para revisión.')
              .replace('%n', form.kcal).replace('%m', kcalCalc)}
          </p>
        )}
        {!form.reviewed_at && implausible && (
          <p className="text-sm text-warn" role="status">
            ⚠ {t('Valores inusualmente altos para 100 g. Revisa antes de guardar.')}
          </p>
        )}
        {!form.reviewed_at && inconsistent && (
          <p className="text-sm text-warn" role="status">
            ⚠ {t('Componente inconsistente')}: {t(inconsistent)}. {t('Revisa antes de guardar.')}
          </p>
        )}
        {form.id && !isBaseFood && warned && !form.reviewed_at && (
          <button
            type="button"
            disabled={basisBlocked}
            onClick={() => save({ ...submitValues(), reviewed_at: new Date().toISOString() })}
            className="self-start min-h-[44px] px-4 rounded-xl border border-warn text-warn font-medium press disabled:opacity-40"
          >
            {t('Marcar revisado')}
          </button>
        )}
        {warned && form.reviewed_at && (
          <p className="text-xs text-text-3" role="status">
            {t('Valores atípicos, ya revisados por ti. El aviso vuelve si cambias los valores.')}
          </p>
        )}

        <details className="lg:hidden rounded-xl bg-surface-2 border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm text-text-2 py-1">{t('Más micros (opcional)')}</summary>
          <p className="text-xs text-text-3 pt-2">{t('★ = favorito: aparece arriba junto a los principales.')}</p>
          {microGroups(hiddenMicros.filter((m) => !favs.includes(m.key))).map(({ cat, items }) => (
            <div key={cat}>
              <p className="text-xs uppercase tracking-wide text-text-3 pt-4 pb-1">{t(cat)}</p>
              <div className="grid grid-cols-2 gap-3">
                {items.map((m) => (
                  <MicroField
                    key={m.key}
                    m={m}
                    fav={false}
                    value={form.micros[m.key] ?? ''}
                    onChange={(v) => setMicro(m.key, v)}
                    onToggleFav={() => onToggleFav(m.key)}
                    placeholder={aiZeros.has(m.key) ? '0' : ''}
                  />
                ))}
              </div>
            </div>
          ))}
        </details>

        <Field label={t('Líquido')}>
          <select
            value={densityOther ? 'otro' : String(form.density_g_ml ?? '')}
            onChange={(e) => {
              const v = e.target.value;
              setDensityOther(v === 'otro');
              if (v !== 'otro') setField('density_g_ml', v);
            }}
            className="input"
          >
            <option value="">{t('No es líquido')}</option>
            {DENSITY_PRESETS.map((p) => (
              <option key={p.value} value={String(p.value)}>
                {t(p.label)} ({p.value} g/ml)
              </option>
            ))}
            <option value="otro">{t('Otro…')}</option>
          </select>
          {densityOther && (
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={form.density_g_ml}
              onChange={(e) => setField('density_g_ml', e.target.value)}
              placeholder={t('densidad en g/ml')}
              className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-text-3"
              aria-label={t('Densidad en g/ml')}
            />
          )}
          <p className="text-xs text-text-3">{t('Si es líquido, al registrar podrás capturar en ml y se convierte a gramos.')}</p>
        </Field>

        <PortionsEditor
          portions={form.portions}
          onChange={(portions) => setForm((f) => ({ ...f, portions }))}
          density={Number(form.density_g_ml) || 0}
        />

        <Field label={t('Fuente')}>
          <select
            value={form.source}
            onChange={(e) => setField('source', e.target.value)}
            className="input"
          >
            <option value="manual">{t('Manual')}</option>
            <option value="etiqueta">{t('Etiqueta')}</option>
            <option value="gemini">{t('IA (Gemini)')}</option>
            <option value="off">Open Food Facts</option>
            <option value="usda">USDA</option>
          </select>
        </Field>

        <button
          type="submit"
          disabled={basisBlocked}
          className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-40"
        >
          {isBaseFood ? t('Guardar copia') : t('Guardar')}
        </button>

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="min-h-[44px] rounded-xl border border-danger text-danger font-medium press"
          >
            {t('Borrar')}
          </button>
        )}
      </form>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-text-2 min-h-[24px] flex items-center">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

function NumberField({ label, value, onChange, placeholder }) {
  return (
    <Field label={label}>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-text-3"
      />
    </Field>
  );
}

// Hidden/favorite micro: numeric field with a star to promote it out of "Más micros".
function MicroField({ m, fav, value, onChange, onToggleFav, placeholder }) {
  const label = t(m.label);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between min-h-[24px]">
        <label className="text-sm text-text-2 truncate">{label} ({m.unit})</label>
        <button
          type="button"
          onClick={onToggleFav}
          className="p-3 -my-3 -mr-2 shrink-0 press"
          aria-label={fav ? `${t('Quitar')} ${label} ${t('de favoritos')}` : `${t('Marcar')} ${label} ${t('como favorito')}`}
        >
          <Star size={16} className={fav ? 'text-accent' : 'text-text-3'} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-text-3"
      />
    </div>
  );
}
