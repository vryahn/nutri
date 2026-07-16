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
  componentsInconsistent, isWaterSentinel, eanChecksumValid,
} from '../lib/domain.js';
import { fetchOFF, searchFDC, fetchFDC } from '../lib/sources.js';
import { GEMINI_KEY, DENSITY_PRESETS, snapDensity, estimateFood } from '../lib/ai.js';
import { t, useLang, useUnits, gToOz, mlToFlOz } from '../lib/i18n.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import UndoToast from '../components/UndoToast.jsx';
import SortTh from '../components/SortTh.jsx';
import AiDataCard from '../components/AiDataCard.jsx';
import ImportSheet from '../components/ImportSheet.jsx';
import PortionsEditor from '../components/PortionsEditor.jsx';

const FDC_KEY = import.meta.env.VITE_FDC_KEY;

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

function hasWarning(f) {
  return kcalSuspicious(f) || macrosImplausible(f) || componentsInconsistent(f);
}

// El aviso ⚠ solo se pinta si el usuario NO lo ha revisado: `reviewed_at` no apaga el
// cálculo (sigue en el form), solo deja de gritar en la lista. Guardar el alimento lo
// limpia (ver handleSave), así una edición de valores vuelve a exponer el aviso.
function pendingWarning(f) {
  return hasWarning(f) && !f.reviewed_at;
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
  // SWR: pinta el cache de sesión al instante y el load() de fondo refresca.
  const [foods, setFoods] = useState(() => cacheGet('foods') || []);
  const [loading, setLoading] = useState(() => !cacheGet('foods'));
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const location = useLocation();
  // alta desde Hoy: /foods con state.newFood abre el form ya prellenado
  const [editing, setEditing] = useState(() =>
    location.state?.newFood ? { ...EMPTY_FOOD, ...location.state.newFood } : null
  ); // null = list view, object = form view
  const [toast, showToast] = useToast();
  const [userId, setUserId] = useState(null);
  const [favs, setFavs] = useState([]); // prefs.data.fav_micros: micros promovidos fuera de "Más micros"
  const [undoData, setUndoData] = useState(null); // { food, timer } tras un borrado, para "Deshacer"
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

  // ponytail: limpia el history state para que un refresh no reabra el form
  useEffect(() => {
    if (location.state?.newFood) window.history.replaceState({}, '');
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
    // merge sobre data existente para no pisar water_glass_ml y demás prefs
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    await supabase.from('prefs').upsert({ owner: userId, data: { ...(data?.data || {}), fav_micros: next } });
  }

  async function load() {
    // Solo se cachea la lista base (sin búsqueda): es la vista con la que se
    // llega al tab. El skeleton solo aparece si no hay nada que pintar.
    const isBase = !query.trim();
    if (!(isBase && cacheGet('foods'))) setLoading(true);
    let req = supabase.from('foods').select('*').order('name');
    if (!isBase) req = req.ilike('name', `%${query.trim()}%`);
    const { data, error } = await req;
    if (error) { showToast(t('No se pudieron cargar los alimentos — revisa tu conexión.')); setLoading(false); return; }
    const list = data.filter((f) => !isWaterSentinel(f));
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
      // Solo el botón "Marcar revisado" del form manda un timestamp; cualquier otro
      // guardado lo deja en null y el aviso ⚠ vuelve a aparecer.
      reviewed_at: food.reviewed_at || null,
    };
    const { error } = food.id
      ? await supabase.from('foods').update(payload).eq('id', food.id)
      : await supabase.from('foods').insert(payload);

    if (error) {
      showToast(t('Error al guardar.'));
      return;
    }
    showToast(t('Guardado.'));
    setEditing(null);
    load();
  }

  // Borrado sin confirmación (swipe en la lista y botón "Borrar" del form):
  // optimista + toast "Deshacer" 5 s que reinserta el alimento. Homologado con Hoy.
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
    const { id, ...rest } = undoData.food; // reinsertar sin el id; nada lo referencia (era borrable → sin registros)
    setUndoData(null);
    const { error } = await supabase.from('foods').insert(rest);
    if (!error) load();
  }

  // <lg: reemplazo de página completa, sin cambios respecto a lo existente.
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

  // Solo sources con al menos un alimento: no ofrecer filtros que darían lista vacía.
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
    // catálogo base (usda) al final, solo con búsqueda activa y sin sort explícito
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
        {/* En lg+ el alta va por el panel derecho ("＋ Nuevo alimento" del estado vacío);
            en <lg por el FAB. Sin botón de cabecera para no duplicar. */}
        <h1 className="font-display text-xl">{t('Alimentos')}</h1>

        {/* Buscador en su propia fila; en lg+ la columna maestra (5/12) no da ancho
            para search + importar + 2 filtros en una sola línea (se recortaban). */}
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

        {/* <lg: cards + swipe. Misma lista filtrada/ordenada que la tabla lg+ (visibleFoods). */}
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

        {/* lg+: tabla ordenable con hover-actions. */}
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
                  {/* Origen fuera de la tabla: aun con la columna maestra al 50% no hay
                      ancho para 7 columnas. El origen se ve en la ficha del panel. */}
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
                    {/* max-w-0 + w-full: la columna absorbe el sobrante. line-clamp-2:
                        1 línea cuando hay ancho, 2 como máximo al estrecharse (nombre
                        completo en la ficha del panel y en title) — nunca 6 líneas. */}
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

      {/* Panel derecho (lg+): ficha/editor, master-detail. */}
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

// Requeridos SIEMPRE con la mejor estimación disponible (null solo si es imposible
// dar cifra fundada). El resto de micros: solo con dato fiable, si no null.
const REQUIRED_MICROS = ['sodio_mg', 'potasio_mg', 'magnesio_mg'];
const REQUIRED_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', ...REQUIRED_MICROS];
const MACRO_LABELS = { kcal: 'Kcal', protein_g: 'Proteína', carbs_g: 'Carbs', fat_g: 'Grasa' };

function labelFor(key) {
  return t(MACRO_LABELS[key] || MICROS.find((m) => m.key === key)?.label || key);
}

const NUMERIC_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];

// winner gana en todo campo que traiga; filler solo rellena lo que winner no tenga.
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

// winner gana en todo lo que traiga; filler solo rellena los REQUERIDOS que falten
// (no se dejan pasar otros micros especulativos de filler cuando winner es autoritativo).
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

// Campos donde a y b (ambos con dato numérico) difieren >25% relativo al mayor.
// Solo cuenta si ambos superan DISCREPANCY_MIN (evita marcar 0.2 vs 0.3). Efímero,
// solo para el aviso UI de etiqueta vs OFF — nada de esto se persiste.
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

// Un 0 devuelto por la fuente no llena el input (anti-spam visual): campo vacío +
// placeholder "0". Semánticamente idéntico a omitirlo (un micro ausente pesa 0).
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
  // density de la DB (numeric) puede venir como string: se normaliza para que el select matchee.
  // Al editar, los 0 almacenados (kcal/macros/micros) arrancan vacíos con placeholder "0" (mismo
  // patrón que el prefill de IA): un 0 no aporta info nueva y así se ve qué falta por revisar.
  const { cleaned: initialForm, zeros: initialZeros } = stripZeros({
    ...EMPTY_FOOD,
    ...food,
    density_g_ml: food.density_g_ml > 0 ? Number(food.density_g_ml) : '',
    portions: food.portions || [],
  });
  const [form, setForm] = useState(initialForm);
  const [basis, setBasis] = useState('100'); // cantidad (en basisUnit) a la que refieren los valores capturados
  const [basisUnit, setBasisUnit] = useState('g'); // 'g'|'ml' — base del formulario, NUNCA se asume 1 g/ml

  // La DB siempre guarda por 100 g: si el usuario capturó por otra base, se escala al guardar.
  // Si la base es ml, primero se convierte a gramos con la densidad elegida (nunca supuesta).
  // Porciones y densidad son absolutas, no se escalan. null = bloqueado, falta densidad.
  function normalizeTo100(f) {
    const b = Number(basis);
    if (!b || b <= 0) return f;
    let baseGrams = b;
    if (basisUnit === 'ml') {
      const density = Number(f.density_g_ml) || 0;
      if (!(density > 0)) return null;
      baseGrams = b * density;
    }
    if (baseGrams === 100) return f;
    const s = 100 / baseGrams;
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
  // true = el usuario eligió "Otro…" en líquido (densidad manual aunque esté vacía)
  const [densityOther, setDensityOther] = useState(
    food.density_g_ml > 0 && !DENSITY_PRESETS.some((p) => p.value === Number(food.density_g_ml))
  );
  const [aiText, setAiText] = useState('');
  const [aiFiles, setAiFiles] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiZeros, setAiZeros] = useState(initialZeros); // claves cuyo valor (inicial o de prefill IA) fue 0 → placeholder, no valor
  const [aiResult, setAiResult] = useState(null); // { source, name, confidence } para la línea de resultado
  const [aiMissing, setAiMissing] = useState([]); // labels de requeridos sin dato fiable
  const [fdcChips, setFdcChips] = useState([]); // hasta 6 coincidencias FDC (de usda_query o búsqueda manual)
  const [usdaQuery, setUsdaQuery] = useState('');
  const [usdaLoading, setUsdaLoading] = useState(false);
  const [usdaError, setUsdaError] = useState('');
  const [labelMismatch, setLabelMismatch] = useState([]); // labels donde etiqueta y OFF difieren >25%, solo UI
  const [sweeteners, setSweeteners] = useState([]); // edulcorantes detectados por OFF (presencia, no cantidad), solo UI

  // Tocar cualquier campo invalida la revisión previa: los valores ya no son los que el
  // usuario confirmó, así que el aviso ⚠ se re-arma en el acto (y handleSave lo persiste).
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

  // Si la base es 100 ml: el form se queda en base ml con los números declarados tal
  // cual (verificables contra el envase); la densidad de Gemini solo prefija el select.
  // La conversión a 100 g ocurre al guardar (normalizeTo100); sin densidad el guardado
  // queda bloqueado hasta que el usuario elija una.
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
        // EAN tecleado directo: sin Gemini no hay densidad conocida, así que un OFF
        // por 100 ml solo puede dejar el form en base ml a la espera de que el
        // usuario elija densidad (ver normalizeTo100).
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
          // Comparar etiqueta vs OFF solo si ambas están en la misma base; si no, se omite
          // (nunca se compara cruzado g vs ml).
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

  async function handleUsdaSearch() {
    if (!usdaQuery.trim()) return;
    setUsdaLoading(true);
    setUsdaError('');
    const matches = await searchFDC(usdaQuery.trim());
    setFdcChips(matches);
    if (matches.length === 0) setUsdaError(t('Sin resultados en USDA.'));
    setUsdaLoading(false);
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
  // Plausibilidad SIEMPRE sobre valores normalizados a 100 g: con base ≠ 100 g
  // (p. ej. "por 30 g" o por 100 ml) los umbrales absolutos quedarían mal escalados.
  const normForCheck = normalizeTo100(form) ?? form;
  const implausible = macrosImplausible(normForCheck);
  const inconsistent = componentsInconsistent(normForCheck);
  const warned = Boolean(suspicious || implausible || inconsistent);
  // kcal vacío → se guarda el cálculo por macros (el placeholder que ve el usuario)
  const submitValues = () => normalizeTo100({ ...form, kcal: form.kcal === '' ? kcalCalc : form.kcal });
  // Alimento del catálogo base (owner null): guardar SIEMPRE crea una copia propia
  // (sin id → handleSave toma la rama insert; el server asigna owner = auth.uid()).
  const isBaseFood = food.owner === null;
  const save = (values) => onSave(isBaseFood ? { ...values, id: undefined } : values);
  const hiddenMicros = MICROS.slice(MICROS_DEFAULT);
  const basisDensity = Number(form.density_g_ml) || 0;
  const basisBlocked = basisUnit === 'ml' && !(basisDensity > 0);
  // Hint mudo del equivalente en unidades US: la composición se captura en g/ml (estándar
  // de etiquetas), pero al usuario US le mostramos a cuánto equivale su base. Solo display.
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

      {/* ponytail: buscador manual de USDA desactivado a petición del usuario. Los chips
          USDA de `usda_query` (Gemini) siguen activos. Para reactivarlo, descomentar.
      {!form.id && FDC_KEY && (
        <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
          <p className="text-sm text-text-2 flex items-center gap-2">
            <Search size={16} className="text-accent" /> Buscar en USDA <span className="text-text-3">· en inglés</span>
          </p>
          {GEMINI_KEY && (
            <p className="text-xs text-text-3">¿Prefieres español? Usa “Datos con IA” arriba.</p>
          )}
          <div className="flex gap-2">
            <input
              value={usdaQuery}
              onChange={(e) => setUsdaQuery(e.target.value)}
              placeholder="p. ej. egg, scrambled"
              className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 text-text focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={handleUsdaSearch}
              disabled={usdaLoading || !usdaQuery.trim()}
              className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium disabled:opacity-40 press"
            >
              {usdaLoading ? 'Buscando…' : 'Buscar en USDA'}
            </button>
          </div>
          {usdaError && <p className="text-sm text-danger">{usdaError}</p>}
        </div>
      )}
      */}

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
          if (basisBlocked) return; // botón ya deshabilitado; guarda por si el submit llega por Enter
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

        {/* lg+: obligatorios full-width arriba, resto de micros por categoría en columnas balanceadas (masonry CSS), sin acordeón. */}
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
          {/* Categoría a ancho completo + campos en rejilla. El masonry por grupo
              (`columns-2` + `break-inside-avoid`) dejaba una columna enorme y la otra
              casi vacía: con Vitaminas (18), Edulcorantes (18) y Aminoácidos (19) el
              grupo no puede partirse y las columnas nunca se balancean. */}
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
        {/* Avisos ⚠: si el usuario ya revisó estos valores y los dio por buenos, se
            degradan a una línea muda (nunca desaparecen del todo). Tocar cualquier campo
            limpia reviewed_at y los devuelve a su forma completa. */}
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
        {form.id && warned && !form.reviewed_at && (
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

// Micro oculto/favorito: campo numérico con estrella para promoverlo fuera de "Más micros".
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
