import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, X, GlassWater, Settings, Pencil, Trash2, Check, History, Copy, ClipboardPaste } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { setSectionMenu } from '../lib/sectionMenu.js';
import { useToast } from '../lib/useToast.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import AmountField from '../components/AmountField.jsx';
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
  round,
  MICROS,
  MICROS_DEFAULT,
  microGroups,
} from '../lib/domain.js';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, closestCenter, closestCorners, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';

// ponytail: matchMedia en vez de un resize-observer propio, ya cubre el único
// breakpoint que nos interesa (lg = layout de 2 zonas vs. flujo móvil).
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

export default function Today() {
  const [date, setDate] = useState(todayISO());
  const [entries, setEntries] = useState([]);
  const [labels, setLabels] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null); // { labelId } | null
  const [editing, setEditing] = useState(null); // entry being edited
  const [toast, showToast] = useToast();
  const [userId, setUserId] = useState(null);
  const [prefs, setPrefs] = useState({ water_glass_ml: 1000, water_food_id: null });
  const [waterSettingsOpen, setWaterSettingsOpen] = useState(false);
  const [undoData, setUndoData] = useState(null); // { entry, timer } tras un borrado, para "Deshacer"
  const [activeEntry, setActiveEntry] = useState(null); // entry en arrastre (para el fantasma de DragOverlay)
  const [dragOverSection, setDragOverSection] = useState(null); // id de etiqueta (o 'none') bajo una card en arrastre
  const [quickAddKey, setQuickAddKey] = useState(0); // bump para resetear el quick-add inline tras registrar
  const [quickAddInitialLabel, setQuickAddInitialLabel] = useState(null);
  const quickAddInputRef = useRef(null);
  const isLg = useIsLgUp();
  // Día copiado para "Pegar" (localStorage: sobrevive cambio de fecha y recarga).
  const [copiedDay, setCopiedDay] = useState(() => localStorage.getItem('nutri.today.copiedDay') || null);
  // Secciones contraídas: Set de claves (String(labelId) o 'none'), persistido en
  // localStorage — sobrevive reload sin escritura remota (ponytail: no DB).
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nutri.today.collapsed') || '[]')); }
    catch { return new Set(); }
  });
  // Al soltar una sección, el navegador dispara un click sobre el elemento donde
  // quedó el puntero — si el drag arrancó en la zona del toggle, ese click fantasma
  // contraería la sección recién reordenada. Ventana de gracia tras cada drag.
  const lastSectionDragRef = useRef(0);
  function toggleCollapsed(key) {
    if (Date.now() - lastSectionDragRef.current < 250) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('nutri.today.collapsed', JSON.stringify([...next]));
      return next;
    });
  }

  // MouseSensor + TouchSensor, NO PointerSensor: con touch-action pan-y (necesario
  // para el swipe-borrar) PointerSensor no puede bloquear el scroll y iOS cancela el
  // drag con pointercancel; TouchSensor sí hace preventDefault del touchmove al activar.
  const DRAG_ACTIVATION = { delay: 150, tolerance: 8 };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: DRAG_ACTIVATION })
  );

  useEffect(() => {
    loadDay();
  }, [date]);

  useEffect(() => {
    loadLabels();
    loadTargets();
    loadPrefs();
    // LabelsModal vive en App.jsx encima de esta página: sin remount, avisa por evento.
    window.addEventListener('labels-changed', loadLabels);
    return () => window.removeEventListener('labels-changed', loadLabels);
  }, []);

  // Atajos de teclado lg+: ←/→ cambian de día, "/" enfoca el quick-add, Esc
  // cierra panel/sheet — inactivos si el foco está en un campo de formulario.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (editing) setEditing(null);
        else if (adding) setAdding(null);
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setDate((d) => addDaysISO(d, -1));
      else if (e.key === 'ArrowRight') setDate((d) => addDaysISO(d, 1));
      else if (e.key === '/') {
        e.preventDefault();
        quickAddInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, adding]);

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
      .order('sort_order')
      .order('created_at');
    setEntries(data || []);
    setLoading(false);
  }

  async function loadLabels() {
    const { data } = await supabase.from('meal_labels').select('*').order('sort_order');
    setLabels(data || []);
  }

  async function persistLabelOrder(reordered) {
    setLabels(reordered);
    await Promise.all(reordered.map((l, i) => supabase.from('meal_labels').update({ sort_order: i }).eq('id', l.id)));
    loadLabels();
  }

  function handleDragStart({ active }) {
    if (active.data.current?.type === 'card') {
      setActiveEntry(foodEntries.find((e) => e.id === active.data.current.entryId) || null);
    }
  }

  function handleDragOver({ active, over }) {
    if (active?.data?.current?.type !== 'card') return;
    if (!over) {
      setDragOverSection(null);
      return;
    }
    const labelId = over.data.current?.labelId;
    setDragOverSection(labelId == null ? 'none' : labelId);
  }

  async function handleDragEnd({ active, over }) {
    setActiveEntry(null);
    setDragOverSection(null);
    if (active.data.current?.type === 'section') lastSectionDragRef.current = Date.now();
    if (!over) return;
    const data = active.data.current;
    if (data?.type === 'section') {
      if (active.id === over.id) return;
      const oldIndex = labels.findIndex((l) => `section-${l.id}` === active.id);
      const newIndex = labels.findIndex((l) => `section-${l.id}` === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      persistLabelOrder(arrayMove(labels, oldIndex, newIndex));
      return;
    }
    if (data?.type !== 'card') return;
    const overId = String(over.id);
    if (overId === active.id) return; // soltó sobre sí misma
    const moving = entries.find((e) => e.id === data.entryId);
    if (!moving) return;
    // Etiqueta destino: sección directa (contenedor) o la de la card sobre la que se soltó.
    const overLabel = overId.startsWith('section-')
      ? (overId === 'section-none' ? null : overId.slice('section-'.length))
      : (entries.find((e) => `card-${e.id}` === overId)?.meal_label_id ?? null);
    // Nuevo orden global: quitar la card y reinsertarla en la posición destino.
    // groupByLabel agrupa por meal_label_id preservando el orden del array, así que
    // el orden global dentro de un grupo == orden visual de la sección.
    const others = entries.filter((e) => e.id !== moving.id);
    let idx;
    if (overId.startsWith('section-')) {
      let last = -1; // insertar tras la última card de esa etiqueta (fin de sección)
      others.forEach((e, i) => { if ((e.meal_label_id ?? null) === overLabel) last = i; });
      idx = last + 1;
    } else {
      idx = others.findIndex((e) => `card-${e.id}` === overId);
      if (idx === -1) idx = others.length;
    }
    const movedEntry = { ...moving, meal_label_id: overLabel };
    const next = [...others.slice(0, idx), movedEntry, ...others.slice(idx)];
    setEntries(next); // optimista (render usa orden del array + meal_label_id)
    // Persistir: renumerar sort_order de las secciones afectadas (origen y destino)
    // y el meal_label_id de la card movida.
    const affected = new Set([moving.meal_label_id ?? null, overLabel]);
    const counters = new Map();
    const updates = [];
    for (const e of next) {
      const L = e.meal_label_id ?? null;
      const so = counters.get(L) ?? 0;
      counters.set(L, so + 1);
      if (affected.has(L)) updates.push({ id: e.id, meal_label_id: e.meal_label_id, sort_order: so });
    }
    const results = await Promise.all(
      updates.map((u) => supabase.from('entries').update({ meal_label_id: u.meal_label_id, sort_order: u.sort_order }).eq('id', u.id))
    );
    if (results.some((r) => r.error)) loadDay();
  }

  function handleDragCancel() {
    setActiveEntry(null);
    setDragOverSection(null);
    lastSectionDragRef.current = Date.now();
  }

  // Borrado unificado (swipe/hover-icon en Hoy y botón "Borrar" del editor): UI
  // optimista + toast con "Deshacer" 5 s que reinserta el registro tal cual estaba.
  async function deleteEntry(entry) {
    setEntries((es) => es.filter((x) => x.id !== entry.id));
    const { error } = await supabase.from('entries').delete().eq('id', entry.id);
    if (error) {
      loadDay();
      showToast('Error al borrar.');
      return;
    }
    setUndoData((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndoData(null), 5000);
      return { entry, timer };
    });
  }

  async function handleUndo() {
    if (!undoData) return;
    clearTimeout(undoData.timer);
    const { day, grams, meal_label_id, food_id, recipe_id } = undoData.entry;
    setUndoData(null);
    const { error } = await supabase.from('entries').insert({ day, grams, meal_label_id, food_id, recipe_id });
    if (!error) loadDay();
  }

  // Inserta en la fecha actual los registros de `sourceDay`. Reusado por "Ayer"
  // (sourceDay = date-1) y "Pegar" (sourceDay = copiedDay). El agua no se copia:
  // se registra con los vasos del día.
  async function copyEntriesFrom(sourceDay) {
    const { data: srcEntries } = await supabase
      .from('entries')
      .select('meal_label_id, food_id, recipe_id, grams')
      .eq('day', sourceDay);
    const toCopy = srcEntries?.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id)) || [];
    if (toCopy.length === 0) {
      showToast('Ese día no tiene registros.');
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
  }

  function handleCopyDay() {
    setCopiedDay(date);
    localStorage.setItem('nutri.today.copiedDay', date);
    showToast('Día copiado.');
  }

  // Borra los alimentos del día (no el agua, que se lleva por vasos). Destructivo
  // e irreversible: confirma antes.
  async function handleDeleteDay() {
    const foods = entries.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id));
    if (foods.length === 0) {
      showToast('Este día no tiene alimentos.');
      return;
    }
    if (!window.confirm(`¿Borrar los ${foods.length} registros de alimentos de este día? No se puede deshacer.`)) return;
    const { error } = await supabase.from('entries').delete().in('id', foods.map((e) => e.id));
    if (error) {
      showToast('Error al borrar.');
      return;
    }
    showToast(`${foods.length} registros borrados.`);
    loadDay();
  }

  // Publica Ayer/Copiar/Pegar en el botón "Más opciones" del layout (App.jsx).
  // "Ayer" solo con la fecha en hoy; "Pegar" solo con un día copiado.
  useEffect(() => {
    const actions = [];
    if (date === todayISO()) {
      actions.push({ key: 'ayer', label: 'Ayer', icon: History, onClick: () => copyEntriesFrom(addDaysISO(date, -1)) });
    }
    actions.push({ key: 'copiar', label: 'Copiar', icon: Copy, onClick: handleCopyDay });
    if (copiedDay) {
      actions.push({
        key: 'pegar',
        label: `Pegar ${new Date(copiedDay + 'T00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`,
        icon: ClipboardPaste,
        onClick: () => copyEntriesFrom(copiedDay),
      });
    }
    actions.push({ key: 'borrar', label: 'Borrar día', icon: Trash2, onClick: handleDeleteDay });
    setSectionMenu(actions);
    return () => setSectionMenu([]);
  }, [date, copiedDay, prefs.water_food_id, entries]);

  // Sección "+": en lg+ no abre el sheet (reemplazado por el quick-add inline),
  // solo prellena su etiqueta y remonta el form (foco vía autoFocus); en <lg
  // conserva el sheet actual.
  function handleSectionAdd(labelId) {
    if (isLg) {
      setQuickAddInitialLabel(labelId);
      setQuickAddKey((k) => k + 1);
    } else {
      setAdding({ labelId });
    }
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
  const kcalPct = target?.kcal > 0 ? Math.round((totals.kcal / target.kcal) * 100) : null;
  // Anillo de kcal (rail desktop): circunferencia de r=52, arco = fracción de la meta (tope 100%).
  const kcalArc = kcalPct != null ? 326.726 * (1 - Math.min(1, kcalPct / 100)) : null;
  const potassiumPct = target?.micros?.potasio_mg > 0
    ? Math.round((totals.potasio_mg / target.micros.potasio_mg) * 100) : null;
  const proteinStatus = classifyFloor(totals.protein_g, target?.protein_g);
  const statusColor = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' };
  const sodiumLow = sodiumIsLow(totals.sodio_mg, foodEntries.length > 0);

  const groups = groupByLabel(foodEntries, labels, activeEntry != null);

  return (
    <div className="px-4 pt-4 pb-20 grid grid-cols-1 gap-4 lg:gap-x-6 lg:grid-cols-[1fr_320px] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start">
      <div className="flex items-center justify-between lg:col-start-1">
        <button onClick={() => setDate(addDaysISO(date, -1))} className="p-2 press" aria-label="Día anterior">
          <ChevronLeft size={22} />
        </button>
        <div className="relative flex-1 flex justify-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            aria-label="Elegir fecha"
          />
          <span className="pointer-events-none font-display text-lg">
            {date === todayISO()
              ? 'Hoy'
              : new Date(date + 'T00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>
        <button onClick={() => setDate(addDaysISO(date, 1))} className="p-2 press" aria-label="Día siguiente">
          <ChevronRight size={22} />
        </button>
      </div>

      {/* Quick-add inline: solo lg+, reemplaza el flujo FAB+sheet. */}
      <div className="hidden lg:block lg:col-start-1">
        <div className="rounded-2xl bg-surface border border-border p-4">
          <AddEntryForm
            key={quickAddKey}
            date={date}
            labels={labels}
            waterFoodId={prefs.water_food_id}
            initialLabelId={quickAddInitialLabel}
            inputRef={quickAddInputRef}
            autoFocus={quickAddKey > 0}
            onAdded={() => {
              setQuickAddKey((k) => k + 1);
              setQuickAddInitialLabel(null);
              loadDay();
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-surface border border-border p-4 grid grid-cols-3 gap-2 text-center lg:hidden">
        <Stat label="Kcal" value={totals.kcal} color={statusColor[kcalStatus] || 'text-d-kcal'} target={target?.kcal} />
        <Stat label="Prot" value={totals.protein_g} color={statusColor[proteinStatus] || 'text-d-prot'} target={target?.protein_g} />
        <Stat label="Carbs" value={totals.carbs_g} color="text-d-carb" target={target?.carbs_g} />
        <Stat label="Grasa" value={totals.fat_g} color="text-d-fat" target={target?.fat_g} />
        <Stat label="Sodio" value={totals.sodio_mg} color="text-danger" target={target?.micros?.sodio_mg} decimals={0} />
        <Stat label="Potasio" value={totals.potasio_mg} color="text-warn" target={target?.micros?.potasio_mg} decimals={0} />
      </div>

      {/* Rail derecho (lg+): sticky, muestra el resumen del día o el editor de la entry activa. */}
      {/* El rail abarca las 4 filas de col-1 (grid-rows-[auto_auto_auto_1fr] en el contenedor).
          Sin esas filas explícitas, `1/-1` colapsa a span-1 e infla la fila 1 con la altura
          del rail (hueco en col-1). La fila 1fr absorbe el excedente del rail por abajo. */}
      <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:[grid-row:1/-1] lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
        {isLg && editing ? (
          <div className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg">{editing.item}{editing.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{editing.brand}</span>}</h2>
              <button onClick={() => setEditing(null)} className="p-2 -mr-2 press" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <EditEntryForm
              entry={editing}
              labels={labels}
              favMicros={prefs.fav_micros || []}
              onDelete={() => {
                deleteEntry(editing);
                setEditing(null);
              }}
              onSaved={() => {
                setEditing(null);
                loadDay();
              }}
            />
          </div>
        ) : (
          <>
            <div className="hidden lg:flex lg:flex-col lg:gap-4 rounded-2xl bg-surface border border-border p-5">
              {/* Hero kcal: anillo (color = adherencia classifyKcal) + % y meta. */}
              <div className="flex items-center gap-4">
                <div className={`relative w-[104px] h-[104px] flex-none ${statusColor[kcalStatus] || 'text-d-kcal'}`}>
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-2)" strokeWidth="11" />
                    {kcalArc != null && (
                      <circle
                        cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round"
                        strokeDasharray="326.726" strokeDashoffset={kcalArc}
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono tabular-nums text-2xl leading-none text-text">{round(totals.kcal, 0)}</span>
                    <span className="text-[10px] text-text-3 mt-0.5">kcal</span>
                  </div>
                </div>
                <div className={`min-w-0 ${statusColor[kcalStatus] || 'text-d-kcal'}`}>
                  {kcalPct != null ? (
                    kcalStatus === 'ok' ? (
                      <>
                        <p className="flex items-center gap-1.5 text-lg"><Check size={18} />en meta</p>
                        <p className="text-xs text-text-3 mt-2">meta {round(target.kcal, 0)} kcal</p>
                      </>
                    ) : (
                      <>
                        <p className="font-mono tabular-nums text-2xl leading-none">
                          {totals.kcal < target.kcal ? '−' : '+'}{Math.abs(round(totals.kcal - target.kcal, 0))}
                        </p>
                        <p className="text-xs text-text-3 mt-2">kcal · meta {round(target.kcal, 0)}</p>
                      </>
                    )
                  ) : (
                    <p className="text-xs text-text-3">sin meta de kcal</p>
                  )}
                </div>
              </div>
              <div className="h-px bg-border" />
              <div className="flex flex-col gap-3">
                <RailStat label="Prot" value={totals.protein_g} color={statusColor[proteinStatus] || 'text-d-prot'} target={target?.protein_g} />
                <RailStat label="Carbs" value={totals.carbs_g} color="text-d-carb" target={target?.carbs_g} />
                <RailStat label="Grasa" value={totals.fat_g} color="text-d-fat" target={target?.fat_g} />
              </div>
              <div className="h-px bg-border" />
              {/* Minerales aparte de los macros. Sodio: acotado por piso médico (no meta a alcanzar);
                  delta rojo sólo hacia el piso 1500. Potasio: meta a alcanzar, delta ámbar. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-3">Sodio</p>
                  <p className="font-mono tabular-nums text-lg text-danger mt-1">{round(totals.sodio_mg, 0)}</p>
                  {sodiumLow ? (
                    <p className="font-mono tabular-nums text-[11px] text-danger mt-0.5">−{round(SODIUM_FLOOR_MG - totals.sodio_mg, 0)} al piso</p>
                  ) : (
                    <p className="text-[10px] text-text-3 mt-0.5">mg · piso {SODIUM_FLOOR_MG}</p>
                  )}
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-3">Potasio</p>
                  <p className={`font-mono tabular-nums text-lg mt-1 ${potassiumPct != null && totals.potasio_mg >= target.micros.potasio_mg ? 'text-ok' : 'text-warn'}`}>{round(totals.potasio_mg, 0)}</p>
                  {potassiumPct == null ? (
                    <p className="text-[10px] text-text-3 mt-0.5">mg</p>
                  ) : totals.potasio_mg >= target.micros.potasio_mg ? (
                    <p className="flex items-center gap-1 text-[11px] text-ok mt-0.5"><Check size={12} />meta</p>
                  ) : (
                    <p className="font-mono tabular-nums text-[11px] text-warn mt-0.5">−{round(target.micros.potasio_mg - totals.potasio_mg, 0)} de {round(target.micros.potasio_mg, 0)}</p>
                  )}
                </div>
              </div>
            </div>

            {sodiumLow && (
              <p className="text-sm text-danger" role="status" aria-live="polite">
                ⚠ sodio &lt; {SODIUM_FLOOR_MG} mg
              </p>
            )}

            <WaterCard
              waterMl={waterMl}
              goalMl={Number(target?.micros?.agua_ml) || 0}
              glassMl={prefs.water_glass_ml}
              onGlass={() => addWater(prefs.water_glass_ml)}
              onUndo={undoWater}
              onCustom={addWater}
              onSettings={() => setWaterSettingsOpen(true)}
            />

          </>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-2 lg:col-start-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && labels.length === 0 && (
        <p className="text-text-2 text-center py-6 lg:col-start-1">Sin registros este día</p>
      )}

      {!loading && (
        <div className="flex flex-col gap-4 lg:col-start-1">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={labels.map((l) => `section-${l.id}`)} strategy={verticalListSortingStrategy}>
              {groups.map((g) =>
                g.id != null ? (
                  <SortableSection
                    key={g.id}
                    group={g}
                    isOver={dragOverSection === g.id}
                    editingId={editing?.id}
                    collapsed={collapsed.has(String(g.id))}
                    onToggle={() => toggleCollapsed(String(g.id))}
                    onAdd={() => handleSectionAdd(g.id)}
                    onEditEntry={setEditing}
                    onDeleteEntry={deleteEntry}
                  />
                ) : (
                  <DropOnlySection
                    key="none"
                    group={g}
                    isOver={dragOverSection === 'none'}
                    editingId={editing?.id}
                    collapsed={collapsed.has('none')}
                    onToggle={() => toggleCollapsed('none')}
                    onEditEntry={setEditing}
                    onDeleteEntry={deleteEntry}
                  />
                )
              )}
            </SortableContext>
            <DragOverlay>
              {activeEntry && (
                <div className="rounded-2xl bg-surface border border-border p-3 flex justify-between items-center gap-3 shadow-lg scale-[1.02]">
                  <CardBody entry={activeEntry} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      <button
        onClick={() => setAdding({ labelId: null })}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-on-accent flex items-center justify-center press lg:hidden"
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
          waterFoodId={prefs.water_food_id}
          initialLabelId={adding.labelId}
          onClose={() => setAdding(null)}
          onAdded={() => {
            setAdding(null);
            loadDay();
          }}
        />
      )}

      {editing && !isLg && (
        <EditEntrySheet
          entry={editing}
          labels={labels}
          favMicros={prefs.fav_micros || []}
          onClose={() => setEditing(null)}
          onDelete={() => {
            deleteEntry(editing);
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            loadDay();
          }}
        />
      )}

      {undoData && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 flex items-center justify-between gap-3 lg:left-auto lg:right-6 lg:bottom-6"
        >
          <span className="text-sm">Registro borrado</span>
          <button
            onClick={handleUndo}
            className="min-h-[44px] px-3 text-accent font-medium press"
          >
            Deshacer
          </button>
        </div>
      )}

      {!undoData && toast && (
        <div role="status" aria-live="polite" className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 text-center text-sm lg:left-auto lg:right-6 lg:bottom-6">
          {toast}
        </div>
      )}
    </div>
  );
}

// Al arrastrar una sección solo debe colisionar con otras secciones (si no,
// closestCorners resolvería `over` a una card interna y el reorden fallaría).
// Al arrastrar una card, closestCorners resuelve a la card hermana o al contenedor.
function collisionDetectionStrategy(args) {
  if (args.active?.data?.current?.type === 'section') {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith('section-')),
    });
  }
  return closestCorners(args);
}

// Una sección por cada etiqueta (aunque esté vacía), en el orden de `labels`
// (ya vienen por sort_order); "Sin etiqueta" al final si tiene items, o mientras
// se arrastra una card (para poder soltarla ahí y quitarle la etiqueta).
function groupByLabel(entries, labels, showEmptyNone) {
  const groups = labels.map((l) => ({ id: l.id, name: l.name, items: [] }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const none = { id: null, name: 'Sin etiqueta', items: [] };
  for (const e of entries) {
    (byId.get(e.meal_label_id) ?? none).items.push(e);
  }
  return none.items.length > 0 || showEmptyNone ? [...groups, none] : groups;
}

function sectionTotals(items) {
  return items.reduce((a, e) => ({
    kcal: a.kcal + Number(e.kcal),
    protein_g: a.protein_g + Number(e.protein_g),
    carbs_g: a.carbs_g + Number(e.carbs_g),
    fat_g: a.fat_g + Number(e.fat_g),
    sodio_mg: a.sodio_mg + Number(e.micros?.sodio_mg || 0),
    potasio_mg: a.potasio_mg + Number(e.micros?.potasio_mg || 0),
    magnesio_mg: a.magnesio_mg + Number(e.micros?.magnesio_mg || 0),
  }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodio_mg: 0, potasio_mg: 0, magnesio_mg: 0 });
}

// Barra resumen = nivel 1 (total de la sección): fondo neutro; con registros, el
// título y el borde pasan a lima (recolor discreto que la distingue de una sección
// vacía). Macros con color + micros (Na/K/Mg, solo lg) y kcal grande a la derecha.
// Click en la zona izquierda contrae/expande. `dragProps` = listeners de dnd-kit
// (long-press 150 ms sobre la barra arrastra la sección; "+" hace stopPropagation).
function SectionBar({ name, items, isOver, collapsed, onToggle, onAdd, dragProps, dragging }) {
  const t = sectionTotals(items);
  const has = items.length > 0;
  const label = (
    <>
      <span className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold ${has ? 'text-accent' : 'text-text-2'}`}>
        {has && <ChevronDown size={13} className={`transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`} />}
        {name}
      </span>
      {has && (
        <span className="mt-0.5 text-[13px] font-mono tabular-nums font-medium flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {t.protein_g > 0 && <span className="text-d-prot">P {round(t.protein_g, 1)}</span>}
          {t.carbs_g > 0 && <span className="text-d-carb">C {round(t.carbs_g, 1)}</span>}
          {t.fat_g > 0 && <span className="text-d-fat">G {round(t.fat_g, 1)}</span>}
          {t.sodio_mg > 0 && <span className="hidden lg:inline text-text-3">Na {round(t.sodio_mg, 0)}</span>}
          {t.potasio_mg > 0 && <span className="hidden lg:inline text-text-3">K {round(t.potasio_mg, 0)}</span>}
          {t.magnesio_mg > 0 && <span className="hidden lg:inline text-text-3">Mg {round(t.magnesio_mg, 0)}</span>}
        </span>
      )}
    </>
  );
  return (
    <div
      {...dragProps}
      className={`flex items-center justify-between gap-2 rounded-xl border bg-surface-2 px-3 py-2.5 min-h-[44px] transition-colors ${dragging ? 'shadow-lg' : ''}`}
      style={{
        borderColor: isOver
          ? 'color-mix(in srgb, var(--accent) 55%, transparent)'
          : has
          ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
          : 'var(--border)',
      }}
    >
      {has ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expandir' : 'Contraer'} ${name}`}
          className="min-w-0 flex-1 flex flex-col text-left"
        >
          {label}
        </button>
      ) : (
        <div className="min-w-0 flex-1 flex flex-col">{label}</div>
      )}
      <div className="flex items-center gap-1 flex-none -mr-1">
        {has && (
          <span className="font-mono tabular-nums text-xl font-semibold text-text leading-none">
            {round(t.kcal, 0)}<span className="text-xs font-normal text-text-2 ml-0.5">kcal</span>
          </span>
        )}
        {onAdd && (
          <button
            onClick={onAdd}
            onMouseDown={(ev) => ev.stopPropagation()}
            onTouchStart={(ev) => ev.stopPropagation()}
            className="p-2.5 text-accent press"
            aria-label={`Añadir a ${name}`}
          >
            <Plus size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

// Sección de una etiqueta real: reordenable (long-press en su barra) y droppable
// (cards de otras secciones). Al arrastrar se "levanta": scale + sombra en la barra,
// las vecinas animan el hueco vía la transition de useSortable.
function SortableSection({ group: g, isOver, editingId, collapsed, onToggle, onAdd, onEditEntry, onDeleteEntry }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `section-${g.id}`,
    data: { type: 'section', labelId: g.id },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)${isDragging ? ' scale(1.02)' : ''}`, transition }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col gap-2 rounded-2xl ${isDragging ? 'relative z-10 opacity-95' : ''}`}
    >
      <SectionBar
        name={g.name}
        items={g.items}
        isOver={isOver}
        collapsed={collapsed}
        onToggle={onToggle}
        onAdd={onAdd}
        dragProps={listeners}
        dragging={isDragging}
      />
      {!collapsed && (
        <SortableContext items={g.items.map((e) => `card-${e.id}`)} strategy={verticalListSortingStrategy}>
          {g.items.map((e) => (
            <SwipeCard key={e.id} entry={e} labelId={g.id} editing={e.id === editingId} onEdit={() => onEditEntry(e)} onDelete={() => onDeleteEntry(e)} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

// "Sin etiqueta": no reordenable la sección, pero sus cards sí; droppable para cross-sección.
function DropOnlySection({ group: g, isOver, editingId, collapsed, onToggle, onEditEntry, onDeleteEntry }) {
  const { setNodeRef } = useDroppable({ id: 'section-none', data: { type: 'section', labelId: null } });
  return (
    <div ref={setNodeRef} className="flex flex-col gap-2 rounded-2xl">
      <SectionBar name={g.name} items={g.items} isOver={isOver} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <SortableContext items={g.items.map((e) => `card-${e.id}`)} strategy={verticalListSortingStrategy}>
          {g.items.map((e) => (
            <SwipeCard key={e.id} entry={e} labelId={g.id} editing={e.id === editingId} onEdit={() => onEditEntry(e)} onDelete={() => onDeleteEntry(e)} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

// Card de una ingesta: tap → editar, arrastre horizontal inmediato → swipe (borrar),
// long-press 150 ms sin moverse → drag entre secciones (dnd-kit). El swipe vive en
// SwipeToDelete (compartido con Objetivos); su umbral de movimiento (8 px) coincide con
// la tolerance de dnd-kit para que ambos gestos se "auto-cancelen" de forma consistente.
// En lg+ con puntero (hover/focus-within), iconos ✎/✕ aparecen a la derecha — capa
// aparte (no dentro del <button> del swipe: anidar <button> rompe el HTML).
function SwipeCard({ entry: e, labelId, editing, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${e.id}`,
    data: { type: 'card', entryId: e.id, labelId },
  });
  // Transform de sortable → las cards vecinas "hacen hueco". La card activa la
  // pinta el DragOverlay, así que no la movemos aquí (!isDragging).
  const style = transform && !isDragging ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition } : undefined;
  return (
    <div style={style} className="relative group rounded-2xl">
      {editing && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-accent" />}
      <SwipeToDelete
        onDelete={onDelete}
        onTap={onEdit}
        dragDisabled={isDragging}
        dragListeners={listeners}
        nodeRef={setNodeRef}
        dragAttributes={attributes}
        className={`${editing ? 'bg-surface-2' : 'bg-surface'} border border-border p-3 flex justify-between items-center gap-3 ${isDragging ? 'opacity-30' : ''}`}
      >
        <CardBody entry={e} />
      </SwipeToDelete>
      <div className="hidden lg:group-hover:flex lg:group-focus-within:flex absolute right-3 top-1/2 -translate-y-1/2 gap-1 bg-surface rounded-lg">
        <button
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => {
            ev.stopPropagation();
            onEdit();
          }}
          className="p-1.5 text-text-2 hover:text-accent"
          aria-label="Editar"
        >
          <Pencil size={16} />
        </button>
        <button
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete();
          }}
          className="p-1.5 text-text-2 hover:text-danger"
          aria-label="Borrar"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// Contenido interno de una card, compartido entre SwipeCard y el fantasma de DragOverlay.
function CardBody({ entry: e }) {
  const highNa = Number(e.micros?.sodio_mg || 0) >= SODIUM_HIGH_MG;
  const highK = Number(e.micros?.potasio_mg || 0) >= POTASSIUM_HIGH_MG;
  return (
    <>
      <div className="min-w-0">
        <p className="font-medium">{e.item}{e.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{e.brand}</span>}</p>
        <div className="text-sm font-mono tabular-nums mt-0.5 text-text-2 flex flex-wrap items-center gap-y-0.5 [&>.sep]:text-text-3 [&>.sep]:mx-1.5">
          <span>{e.grams}g</span>
          {Number(e.protein_g) > 0 && <><span className="sep">|</span><span>P {round(Number(e.protein_g), 1)}</span></>}
          {Number(e.carbs_g) > 0 && <><span className="sep">|</span><span>C {round(Number(e.carbs_g), 1)}</span></>}
          {Number(e.fat_g) > 0 && <><span className="sep">|</span><span>G {round(Number(e.fat_g), 1)}</span></>}
          {Number(e.micros?.sodio_mg) > 0 && <><span className="sep hidden lg:inline">|</span><span className="hidden lg:inline">Na {round(Number(e.micros.sodio_mg), 0)}</span></>}
          {Number(e.micros?.potasio_mg) > 0 && <><span className="sep hidden lg:inline">|</span><span className="hidden lg:inline">K {round(Number(e.micros.potasio_mg), 0)}</span></>}
          {Number(e.micros?.magnesio_mg) > 0 && <><span className="sep hidden lg:inline">|</span><span className="hidden lg:inline">Mg {round(Number(e.micros.magnesio_mg), 0)}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {highNa && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-danger/20 text-danger">Na</span>}
        {highK && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-warn/20 text-warn">K</span>}
        <span className="font-mono tabular-nums text-text-2">{e.kcal} kcal</span>
      </div>
    </>
  );
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
          className="p-2 -mr-2 text-text-3 press"
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
              className={`relative w-11 h-11 rounded-xl border border-border flex items-center justify-center press ${
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
          placeholder="Cantidad (ml)"
          className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          className="min-h-[44px] px-4 rounded-xl border border-border text-text-2 press"
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
        className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press"
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

// Fila del rail derecho (lg+): protagoniza el delta a la meta (−N g = lo que resta,
// en el color del macro). Cumplida la meta → check + fila atenuada; el tramo vacío
// de la barra va en el propio color del macro (tenue) = "esto te falta, en su tono".
function RailStat({ label, value, color, target, decimals = 1 }) {
  const has = target > 0;
  const pct = has ? Math.round((value / target) * 100) : null;
  const met = has && value >= target;
  return (
    <div className={`${color}${met ? ' opacity-60' : ''}`}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-sm bg-current" />
          <span className="text-text-3">{label}</span>
        </span>
        <span className="flex items-baseline gap-2 font-mono tabular-nums">
          {met ? (
            <Check size={14} className="self-center" />
          ) : has ? (
            <span>−{round(target - value, decimals)} g</span>
          ) : (
            <span>{round(value, decimals)} g</span>
          )}
          {has && <span className="text-text-3 text-xs">{round(value, decimals)}/{round(target, decimals)}</span>}
        </span>
      </div>
      {has && (
        <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, currentColor 16%, transparent)' }}>
          <div className="h-full bg-current rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
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

// Núcleo de "añadir registro": buscador con recientes, cantidad y etiqueta.
// Reutilizado por AddEntrySheet (sheet, <lg) y el quick-add inline (rail, lg+).
// Navegación por teclado en resultados: ↓/↑ mueve la selección, Enter la confirma.
function AddEntryForm({ date, labels, waterFoodId, initialLabelId, onAdded, inputRef, autoFocus }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState(null); // { id, name, type }
  const [grams, setGrams] = useState('');
  const [presetGrams, setPresetGrams] = useState(null);
  const [labelId, setLabelId] = useState(initialLabelId || '');
  const [frequent, setFrequent] = useState([]);
  const foodMeta = useFoodMeta(selected?.type === 'food' ? selected.id : null, selected?.type === 'recipe' ? selected.id : null);

  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  // Top 8 más registrados (dedup food/receta, gramos default = moda), filtrando
  // agua; si hay etiqueta activa, acota el historial a esa etiqueta.
  async function loadFrequent() {
    let q = supabase
      .from('entry_nutrients')
      .select('food_id, recipe_id, item, brand, grams, meal_label_id')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (initialLabelId) q = q.eq('meal_label_id', initialLabelId);
    const { data } = await q;
    if (!data) return;
    const byKey = new Map();
    for (const e of data) {
      const key = e.food_id || e.recipe_id;
      let rec = byKey.get(key);
      if (!rec) { rec = { food_id: e.food_id, recipe_id: e.recipe_id, item: e.item, brand: e.brand, freq: 0, counts: new Map() }; byKey.set(key, rec); }
      rec.freq++;
      const g = Number(e.grams);
      rec.counts.set(g, (rec.counts.get(g) || 0) + 1);
    }
    const uniques = [...byKey.values()]
      .filter((r) => !(r.food_id && r.food_id === waterFoodId))
      .sort((a, b) => b.freq - a.freq)
      .slice(0, 8)
      .map((r) => {
        let best = null, bestCount = 0;
        for (const [g, c] of r.counts) if (c > bestCount) { best = g; bestCount = c; }
        return { food_id: r.food_id, recipe_id: r.recipe_id, item: r.item, brand: r.brand, grams: best };
      });
    setFrequent(uniques);
  }

  useEffect(() => {
    loadFrequent();
  }, [initialLabelId, waterFoodId]);

  useEffect(() => {
    if (!query.trim() || selected) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const q = query.trim().replace(/[,()]/g, ' ');
      const [{ data: foods }, { data: recipes }] = await Promise.all([
        supabase.from('foods').select('id,name,brand').or(`name.ilike.%${q}%,brand.ilike.%${q}%`).limit(8),
        supabase.from('recipes').select('id,name').ilike('name', `%${q}%`).limit(8),
      ]);
      setResults([
        // el Agua se registra desde su tarjeta, no como comida
        ...(foods || []).filter((f) => f.id !== waterFoodId).map((f) => ({ ...f, type: 'food' })),
        ...(recipes || []).map((r) => ({ ...r, type: 'recipe' })),
      ]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function pick(item, preset) {
    setSelected(item);
    setQuery(item.name);
    setResults([]);
    setGrams('');
    setPresetGrams(preset != null ? String(preset) : null);
  }

  function reset() {
    setSelected(null);
    setQuery('');
    setResults([]);
    setGrams('');
    setPresetGrams(null);
    setLabelId(initialLabelId || '');
  }

  function handleQueryKeyDown(e) {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pick(results[activeIndex]);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const finalGrams = grams === '' ? presetGrams : grams;
    if (!selected || !finalGrams) return;
    const payload = {
      day: date,
      grams: Number(finalGrams),
      meal_label_id: labelId || null,
      food_id: selected.type === 'food' ? selected.id : null,
      recipe_id: selected.type === 'recipe' ? selected.id : null,
    };
    const { error } = await supabase.from('entries').insert(payload);
    if (!error) {
      onAdded();
      loadFrequent();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!selected && frequent.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-3">Elementos frecuentes</p>
          <div className="flex flex-wrap gap-2">
            {frequent.map((r) => (
              <button
                key={(r.food_id || r.recipe_id) + r.item}
                onClick={() => pick({ id: r.food_id || r.recipe_id, name: r.item, type: r.food_id ? 'food' : 'recipe' }, r.grams)}
                className="px-3 py-2 rounded-full bg-surface-2 border border-border text-sm press"
              >
                {r.item}{r.brand && <span className="text-text-3 text-xs font-normal ml-1">{r.brand}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">Alimento o receta</label>
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          onKeyDown={handleQueryKeyDown}
          placeholder="Buscar…"
          className="input"
        />
        {results.length > 0 && (
          <div className="rounded-xl bg-surface-2 border border-border overflow-hidden">
            {results.map((r, i) => (
              <button
                key={r.type + r.id}
                onClick={() => pick(r)}
                className={`w-full text-left px-3 py-2 flex justify-between ${i === activeIndex ? 'bg-surface-3' : 'active:bg-surface-3'}`}
              >
                <span>{r.name}{r.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{r.brand}</span>}</span>
                {r.type === 'recipe' && <span className="text-xs text-text-3">receta</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AmountField grams={grams} onGrams={setGrams} meta={foodMeta} placeholder={presetGrams ?? undefined} required={presetGrams == null} />

          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-2">Etiqueta</label>
            <select
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
              className="input"
            >
              <option value="">Sin etiqueta</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={reset} className="min-h-[44px] flex-1 rounded-xl border border-border text-text-2 press">Cancelar</button>
            <button type="submit" className="min-h-[44px] flex-1 rounded-xl bg-accent-deep text-on-accent font-medium press">Registrar</button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddEntrySheet({ date, labels, waterFoodId, initialLabelId, onClose, onAdded }) {
  return (
    <Sheet title="Añadir registro" onClose={onClose}>
      <AddEntryForm
        date={date}
        labels={labels}
        waterFoodId={waterFoodId}
        initialLabelId={initialLabelId}
        onAdded={onAdded}
        autoFocus
      />
    </Sheet>
  );
}

// Núcleo de "editar registro": cantidad, etiqueta y el panel "Aporta". Reutilizado
// por EditEntrySheet (sheet, <lg) y el panel de edición inline (rail, lg+).
function EditEntryForm({ entry, labels, favMicros, onDelete, onSaved }) {
  const [grams, setGrams] = useState('');
  const [labelId, setLabelId] = useState(entry.meal_label_id || '');
  const foodMeta = useFoodMeta(entry.food_id, entry.recipe_id);

  async function handleSubmit(e) {
    e.preventDefault();
    const finalGrams = grams === '' ? entry.grams : Number(grams);
    const { error } = await supabase
      .from('entries')
      .update({ grams: finalGrams, meal_label_id: labelId || null })
      .eq('id', entry.id);
    if (!error) onSaved();
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AmountField grams={grams} onGrams={setGrams} meta={foodMeta} placeholder={String(entry.grams)} required={false} />

        <div className="flex flex-col gap-1">
          <label className="text-sm text-text-2">Etiqueta</label>
          <select
            value={labelId}
            onChange={(e) => setLabelId(e.target.value)}
            className="input"
          >
            <option value="">Sin etiqueta</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press">
          Guardar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="min-h-[44px] rounded-xl border border-danger text-danger font-medium press"
        >
          Borrar
        </button>
      </form>

      <AportaPanel grams={grams || entry.grams} meta={foodMeta} favMicros={favMicros} />
    </>
  );
}

function EditEntrySheet({ entry, labels, favMicros, onClose, onDelete, onSaved }) {
  return (
    <Sheet title={<>{entry.item}{entry.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{entry.brand}</span>}</>} onClose={onClose}>
      <EditEntryForm entry={entry} labels={labels} favMicros={favMicros} onDelete={onDelete} onSaved={onSaved} />
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
  // Backdrop cierra al tocar fuera (patrón del Sheet de Objetivos); la ✕ sería
  // redundante aquí, así que se omite — la del editor inline (riel lg+, sin
  // backdrop) sí se conserva porque ahí no hay tap-fuera.
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-surface-3 rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4 max-h-[85dvh] overflow-y-auto">
        <h2 className="font-display text-lg">{title}</h2>
        {children}
      </div>
    </div>
  );
}
