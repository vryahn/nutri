import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Upload, Camera, X, Star, Moon, HelpCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../lib/supabase.js';
import { toJpegBlob } from '../lib/ai.js';
import { setSectionMenu } from '../lib/sectionMenu.js';
import { useToast } from '../lib/useToast.js';
import ImportSheet from '../components/ImportSheet.jsx';
import Hint from '../components/Hint.jsx';
import ConfirmSheet from '../components/ConfirmSheet.jsx';
import UndoToast from '../components/UndoToast.jsx';
import { t, useLang, locale, useSleepThreshold } from '../lib/i18n.js';
import {
  todayISO,
  addDaysISO,
  round,
  cleanNumericMap,
  BODY_METRICS,
  BODY_METRICS_DEFAULT,
  BODY_METRIC_MAX,
  DERIVED_BODY,
  derivedBodyMetrics,
} from '../lib/domain.js';

const HISTORY_DAYS = 180;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Persistencia por dispositivo (localStorage), igual que el Dashboard: sobrevive
// recarga sin escritura remota.
function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

const GROUPS = ['Composición', 'Circunferencias', 'Segmental'];

export default function Body() {
  useLang();
  const sleepH = useSleepThreshold();
  const [date, setDate] = useState(todayISO());
  const [userId, setUserId] = useState(null);
  const [favs, setFavs] = useState([]); // prefs.data.fav_body: medidas promovidas fuera de "Más medidas"
  const [values, setValues] = useState({}); // strings por clave, para los inputs
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]); // rutas en el bucket body-photos del día
  const [photoUrls, setPhotoUrls] = useState({}); // ruta -> signed URL (efímera)
  const [uploading, setUploading] = useState(false);
  const [photoDrag, setPhotoDrag] = useState(false);
  const [history, setHistory] = useState([]); // filas {day, metrics} últimos HISTORY_DAYS
  const [showMore, setShowMore] = useState(false);
  const [trendKey, setTrendKey] = usePersistentState('nutri.body.trendKey', 'peso_kg');
  const [savedFlash, setSavedFlash] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, showToast] = useToast();
  const [confirmPhoto, setConfirmPhoto] = useState(null); // path de la foto pendiente de confirmar su borrado
  const [undoRow, setUndoRow] = useState(null); // { day, row: {metrics,note,photo_paths}, timer }: fila borrada al vaciar todos sus campos

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    supabase.from('prefs').select('data').maybeSingle().then(({ data }) => {
      if (data?.data?.fav_body) setFavs(data.data.fav_body);
    });
  }, []);

  // Promueve/retira una medida de "Más medidas" (patrón fav_micros). Merge sobre
  // data existente para no pisar el resto de prefs.
  async function toggleFav(key) {
    const next = favs.includes(key) ? favs.filter((k) => k !== key) : [...favs, key];
    setFavs(next);
    if (!userId) return;
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    await supabase.from('prefs').upsert({ owner: userId, data: { ...(data?.data || {}), fav_body: next } });
  }

  // Publica "Importar" en el menú "Más opciones" del layout (mismo patrón que Hoy).
  useEffect(() => {
    setSectionMenu([{ key: 'importar', label: t('Importar'), icon: Upload, onClick: () => setImporting(true) }]);
    return () => setSectionMenu([]);
  }, []);

  // Carga la fila del día seleccionado (reloadKey la refresca tras importar).
  useEffect(() => {
    let alive = true;
    supabase
      .from('body_metrics')
      .select('metrics, note, photo_paths')
      .eq('day', date)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const m = data?.metrics || {};
        setValues(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])));
        setNote(data?.note || '');
        setPhotos(data?.photo_paths || []);
      });
    return () => {
      alive = false;
    };
  }, [date, reloadKey]);

  // Signed URLs para las miniaturas (bucket privado: sin URL firmada no se ven).
  // Se regeneran al cambiar el set de fotos o de día.
  useEffect(() => {
    let alive = true;
    if (!photos.length) {
      setPhotoUrls({});
      return;
    }
    supabase.storage
      .from('body-photos')
      .createSignedUrls(photos, 3600)
      .then(({ data }) => {
        if (!alive || !data) return;
        const map = {};
        data.forEach((d) => {
          if (d.signedUrl) map[d.path] = d.signedUrl;
        });
        setPhotoUrls(map);
      });
    return () => {
      alive = false;
    };
  }, [photos]);

  function loadHistory() {
    const start = addDaysISO(todayISO(), -(HISTORY_DAYS - 1));
    supabase
      .from('body_metrics')
      .select('day, metrics')
      .gte('day', start)
      .order('day')
      .then(({ data }) => setHistory(data || []));
  }
  useEffect(loadHistory, []);

  async function persist(nextValues, nextNote, nextPhotos) {
    if (!userId) return;
    const metrics = cleanNumericMap(nextValues);
    const noteTrim = (nextNote ?? '').trim();
    const photoPaths = nextPhotos ?? [];
    // Sin medidas, nota ni fotos → no dejar una fila vacía en la DB. Borrado de UN
    // registro = optimista + Undo (política de borrado del proyecto): se captura la
    // fila antes de borrarla para poder reinsertarla tal cual.
    if (Object.keys(metrics).length === 0 && !noteTrim && photoPaths.length === 0) {
      const { data: prevRow } = await supabase
        .from('body_metrics')
        .select('metrics, note, photo_paths')
        .eq('day', date)
        .maybeSingle();
      const { error } = await supabase.from('body_metrics').delete().eq('day', date);
      if (!error && prevRow) {
        setUndoRow((prev) => {
          if (prev?.timer) clearTimeout(prev.timer);
          const timer = setTimeout(() => setUndoRow(null), 5000);
          return { day: date, row: prevRow, timer };
        });
      }
    } else {
      await supabase.from('body_metrics').upsert(
        { owner: userId, day: date, metrics, note: noteTrim || null, photo_paths: photoPaths },
        { onConflict: 'owner,day' },
      );
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
    loadHistory();
  }

  // Reinserta la fila capturada por persist() antes de borrarla. Si sigue en el
  // mismo día, también refresca el formulario visible (si no, solo la DB/historial).
  async function undoDeleteRow() {
    if (!undoRow) return;
    clearTimeout(undoRow.timer);
    const { day, row } = undoRow;
    setUndoRow(null);
    const { error } = await supabase.from('body_metrics').upsert(
      { owner: userId, day, metrics: row.metrics || {}, note: row.note || null, photo_paths: row.photo_paths || [] },
      { onConflict: 'owner,day' },
    );
    if (error) {
      showToast(t('No se pudo deshacer.'));
      return;
    }
    if (day === date) {
      setValues(Object.fromEntries(Object.entries(row.metrics || {}).map(([k, v]) => [k, String(v)])));
      setNote(row.note || '');
      setPhotos(row.photo_paths || []);
    }
    loadHistory();
  }

  const setField = (key, raw) => setValues((v) => ({ ...v, [key]: raw }));
  const commit = () => persist(values, note, photos);

  // Checkpoint booleano (Sueño): marcar guarda el umbral vigente como valor (el flag
  // se autoexplica si el umbral cambia luego); desmarcar lo borra. Persiste al toque
  // — el <button> no tiene onBlur, así que se envía el mapa nuevo, no el de la closure.
  const toggleCheck = (m) => {
    const on = !((values[m.key] ?? '') !== '' && Number(values[m.key]) > 0);
    const next = { ...values, [m.key]: on ? String(sleepH) : '' };
    setValues(next);
    persist(next, note, photos);
  };

  // Comprime cliente (JPEG ~1280px) y sube al bucket privado en {uid}/{uuid}.jpg —
  // el primer segmento = uid es lo que aísla al usuario en el RLS de storage.objects.
  async function uploadPhotos(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !userId) return;
    setUploading(true);
    const added = [];
    try {
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const blob = await toJpegBlob(f);
        const path = `${userId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage
          .from('body-photos')
          .upload(path, blob, { contentType: 'image/jpeg' });
        if (!error) added.push(path);
      }
      if (added.length) {
        const next = [...photos, ...added];
        setPhotos(next);
        await persist(values, note, next);
      }
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(path) {
    await supabase.storage.from('body-photos').remove([path]);
    const next = photos.filter((p) => p !== path);
    setPhotos(next);
    await persist(values, note, next);
  }

  const trendMeta = BODY_METRICS.find((m) => m.key === trendKey) || BODY_METRICS[0];
  const trendData = history
    .filter((r) => r.metrics && r.metrics[trendKey] != null && Number.isFinite(Number(r.metrics[trendKey])))
    .map((r) => ({ label: r.day.slice(5), val: Number(r.metrics[trendKey]) }));

  const isToday = date === todayISO();

  // Función que devuelve JSX (NO un componente): usarlo como <Field/> lo remontaría
  // en cada tecleo (nueva identidad de función por render) y el input perdería foco.
  const fieldFor = (m, showStar = false) => {
    const raw = values[m.key] ?? '';
    const isFav = favs.includes(m.key);
    const star = showStar && (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); toggleFav(m.key); }}
        className="p-2 -m-2 shrink-0 press"
        aria-label={isFav ? `${t('Quitar')} ${t(m.label)} ${t('de favoritos')}` : `${t('Marcar')} ${t(m.label)} ${t('como favorito')}`}
      >
        <Star size={14} className={isFav ? 'text-accent' : 'text-text-3'} fill={isFav ? 'currentColor' : 'none'} />
      </button>
    );

    if (m.type === 'check') {
      const on = raw !== '' && Number(raw) > 0;
      return (
        <div key={m.key} className="flex flex-col gap-1">
          <span className="text-xs text-text-3 flex items-center justify-between gap-1">
            {t(m.label)}
            {star}
          </span>
          <button
            type="button"
            onClick={() => toggleCheck(m)}
            aria-pressed={on}
            className={`flex items-center gap-2 rounded-xl border px-3 min-h-[44px] press text-left ${on ? 'border-accent-deep bg-accent-deep/15' : 'border-border bg-surface-2'}`}
          >
            <Moon size={16} className={on ? 'text-accent' : 'text-text-3'} />
            <span className="text-xs leading-tight">{t('Dormí menos de %n h').replace('%n', sleepH)}</span>
          </button>
        </div>
      );
    }

    const over = raw !== '' && Number(raw) > (BODY_METRIC_MAX[m.key] ?? Infinity);
    return (
      <label key={m.key} className="flex flex-col gap-1">
        <span className="text-xs text-text-3 flex items-center justify-between gap-1">
          <span className="flex items-center gap-1">
            {t(m.label)}
            {over && <span className="text-danger" title={t('Valor fuera de rango — revísalo')}>⚠</span>}
          </span>
          {star}
        </span>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-2 px-3 min-h-[44px]">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={raw}
            onChange={(e) => setField(m.key, e.target.value)}
            onBlur={commit}
            placeholder="–"
            className="w-full bg-transparent tabular-nums outline-none"
            aria-label={t(m.label)}
          />
          <span className="text-xs text-text-3 shrink-0">{m.unit}</span>
        </div>
      </label>
    );
  };

  const defaults = BODY_METRICS.slice(0, BODY_METRICS_DEFAULT);
  const extra = BODY_METRICS.slice(BODY_METRICS_DEFAULT);
  const favMetrics = extra.filter((m) => favs.includes(m.key));
  // Altura y grasa% solo se capturan en días de bioimpedancia; para que las
  // derivadas salgan en cualquier día pesado, se arrastra la última lectura
  // conocida del historial cuando el día no la trae (no se persiste, solo alimenta
  // el cálculo con el peso del día). El caption declara qué insumos se heredaron.
  const lastOf = (key) => [...history].reverse().find((r) => r.metrics?.[key] != null)?.metrics[key] ?? null;
  const inherit = (key) => ((values[key] ?? '') !== '' ? values[key] : lastOf(key));
  const derived = derivedBodyMetrics({ ...values, altura_cm: inherit('altura_cm'), grasa_pct: inherit('grasa_pct') });
  const heredadas = [
    (values.grasa_pct ?? '') === '' && lastOf('grasa_pct') != null ? `${t('grasa')} ${lastOf('grasa_pct')} %` : null,
    (values.altura_cm ?? '') === '' && lastOf('altura_cm') != null ? `${t('altura')} ${lastOf('altura_cm')} cm` : null,
  ].filter(Boolean);
  const showDerived = (values.peso_kg ?? '') !== '';

  return (
    <div className="px-4 pt-4 pb-20 flex flex-col gap-4 lg:max-w-3xl lg:mx-auto">
      {/* Navegación de fecha (mismo patrón que Hoy) */}
      <div className="flex items-center justify-between">
        <button onClick={() => setDate(addDaysISO(date, -1))} className="p-2 press" aria-label={t('Día anterior')}>
          <ChevronLeft size={22} />
        </button>
        <div className="relative flex-1 flex justify-center">
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            aria-label={t('Elegir fecha')}
          />
          <span className="pointer-events-none font-display text-lg">
            {isToday
              ? t('Hoy')
              : new Date(date + 'T00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>
        <button onClick={() => setDate(addDaysISO(date, 1))} className="p-2 press" aria-label={t('Día siguiente')}>
          <ChevronRight size={22} />
        </button>
      </div>

      {/* Captura del día */}
      <section className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-3">{t('Medidas del día')}</p>
          {savedFlash && <span className="text-xs text-accent">{t('Guardado.')}</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {defaults.map((m) => fieldFor(m))}
          {favMetrics.map((m) => fieldFor(m, true))}
        </div>

        {/* Derivadas de solo lectura: se calculan de peso/grasa/altura, no se guardan. */}
        {showDerived && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-3 pt-1">{t('Derivadas')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {DERIVED_BODY.map((d) => (
                <div key={d.key} className="flex flex-col gap-1">
                  <span className="text-xs text-text-3 flex items-center gap-1">
                    {t(d.label)}
                    <Hint text={`${t(d.label)} = ${t(d.formula)}`}>
                      <HelpCircle size={12} className="text-text-3" aria-label={t('Ver fórmula')} />
                    </Hint>
                  </span>
                  <div className="flex items-center gap-1 rounded-xl border border-border border-dashed bg-surface-2 px-3 min-h-[44px]">
                    <span className="w-full tabular-nums text-text-2">{derived[d.key] != null ? derived[d.key] : '–'}</span>
                    <span className="text-xs text-text-3 shrink-0">{d.unit}</span>
                  </div>
                </div>
              ))}
            </div>
            {heredadas.length > 0 && (
              <p className="text-[11px] text-text-3" style={{ margin: 0 }}>
                {t('Se calculan con tu peso del día y tu última %s registrada.').replace('%s', heredadas.join(` ${t('y')} `))}
              </p>
            )}
          </div>
        )}

        {showMore && (
          <>
            <p className="text-xs text-text-3">{t('★ = favorito: aparece arriba junto a los principales.')}</p>
            {GROUPS.map((cat) => {
              const items = extra.filter((m) => m.cat === cat && !favs.includes(m.key));
              if (!items.length) return null;
              return (
                <div key={cat} className="flex flex-col gap-2">
                  <p className="text-xs text-text-3 pt-1">{t(cat)}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{items.map((m) => fieldFor(m, true))}</div>
                </div>
              );
            })}
          </>
        )}

        <button
          onClick={() => setShowMore((s) => !s)}
          className="self-start text-xs text-accent min-h-[44px] press"
        >
          {showMore ? t('Menos medidas ▴') : t('Más medidas ▾')}
        </button>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-3">{t('Nota')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={commit}
            rows={2}
            placeholder={t('Contexto del día (opcional)')}
            className="rounded-xl border border-border bg-surface-2 px-3 py-2 outline-none resize-y"
          />
        </label>
      </section>

      {/* Fotos de progreso */}
      <section
        onDragOver={(e) => { e.preventDefault(); setPhotoDrag(true); }}
        onDragLeave={(e) => { e.preventDefault(); setPhotoDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setPhotoDrag(false); uploadPhotos(e.dataTransfer.files); }}
        className={`rounded-2xl bg-surface border p-4 flex flex-col gap-3 ${photoDrag ? 'border-accent-deep ring-1 ring-accent-deep' : 'border-border'}`}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-3">{t('Fotos de progreso')}</p>
          {uploading && <span className="text-xs text-accent">{t('Subiendo…')}</span>}
        </div>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p} className="relative aspect-square rounded-xl overflow-hidden bg-surface-2">
                {photoUrls[p] && (
                  <a href={photoUrls[p]} target="_blank" rel="noreferrer" className="block w-full h-full">
                    <img src={photoUrls[p]} alt={t('Foto de progreso')} className="w-full h-full object-cover" />
                  </a>
                )}
                <button
                  onClick={() => setConfirmPhoto(p)}
                  aria-label={t('Eliminar foto')}
                  className="absolute top-1 right-1 h-11 w-11 flex items-center justify-center rounded-full bg-black/55 text-white press"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="self-start inline-flex items-center gap-2 text-sm text-accent min-h-[44px] press cursor-pointer">
          <Camera size={18} />
          {t('Añadir fotos')}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              uploadPhotos(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </section>

      {/* Tendencia */}
      <section className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-text-3">{t('Tendencia')}</p>
          <select
            value={trendKey}
            onChange={(e) => setTrendKey(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm min-h-[36px]"
            aria-label={t('Medida a graficar')}
          >
            {GROUPS.map((cat) => (
              <optgroup key={cat} label={t(cat)}>
                {BODY_METRICS.filter((m) => m.cat === cat && m.type !== 'check').map((m) => (
                  <option key={m.key} value={m.key}>
                    {t(m.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {trendData.length >= 2 ? (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} width={40} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  formatter={(v) => [`${round(v, 1)} ${trendMeta.unit}`, t(trendMeta.label)]}
                />
                <Line
                  type="monotone"
                  dataKey="val"
                  name={t(trendMeta.label)}
                  stroke="var(--d-prot)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={!reducedMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-text-2 py-8 text-center">
            {t('Registra esta medida en 2+ días para ver su tendencia.')}
          </p>
        )}
      </section>

      {importing && (
        <ImportSheet
          kind="body"
          onClose={() => setImporting(false)}
          onDone={(n) => {
            setImporting(false);
            showToast(t('%n días importados.').replace('%n', n));
            loadHistory();
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {confirmPhoto && (
        <ConfirmSheet
          title={t('¿Eliminar la foto?')}
          body={t('Se borra del almacenamiento y no se puede deshacer.')}
          confirmLabel={t('Eliminar foto')}
          onConfirm={() => {
            const p = confirmPhoto;
            setConfirmPhoto(null);
            removePhoto(p);
          }}
          onClose={() => setConfirmPhoto(null)}
        />
      )}
      {undoRow && <UndoToast message={t('Medida borrada')} onUndo={undoDeleteRow} />}
      {toast}
    </div>
  );
}
