import { useState, useEffect } from 'react';
import { AlertTriangle, Upload, FileDown } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { t, getLang } from '../lib/i18n.js';
import {
  parseCSV, foodsFromCSV, entriesFromCSV, bodyMetricsFromCSV, fetchFoodsForImport,
  FOODS_TEMPLATE_HEADERS, BODY_TEMPLATE_HEADERS, BODY_TEMPLATE_HEADERS_EN, BODY_HEADERS_EN,
} from '../lib/importer.js';

// Carga en bloque desde CSV pegado o archivo. kind='foods'|'entries'|'body'. Vista
// previa con ⚠ por fila antes de commitear (regla de precisión: nada se guarda en
// silencio). Cierra al tocar fuera (scrim onClose + stopPropagation en la card).
const PLACEHOLDER = {
  foods: 'name,kcal,protein_g,carbs_g,fat_g,sodio_mg\nAvena,389,17,66,7,2',
  entries: 'day,meal,food,grams\n2026-07-07,Desayuno,Avena,60',
};
const TEMPLATE = {
  foods: { headers: FOODS_TEMPLATE_HEADERS, file: 'nutri_alimentos_plantilla.csv' },
  body: { headers: BODY_TEMPLATE_HEADERS, file: 'nutri_medidas_plantilla.csv' },
};

// Columnas de ejemplo del copy y el placeholder de medidas. Se derivan de UNA
// fuente: la clave canónica en ES, su alias inglés (BODY_HEADERS_EN) en EN. Así
// los ejemplos nunca se desincronizan de la plantilla real ni se hardcodean por idioma.
const BODY_EXAMPLE_KEYS = ['peso_kg', 'grasa_pct', 'cintura_cm'];
const bodyHeader = (key, en) => (en ? BODY_HEADERS_EN[key] || key : key);

export default function ImportSheet({ kind, onClose, onDone }) {
  const [text, setText] = useState('');
  const [foods, setFoods] = useState([]);
  const [labels, setLabels] = useState([]);
  const [existingDays, setExistingDays] = useState(new Set());
  const [bodyReplace, setBodyReplace] = useState(false); // false = complementar (default)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Registros necesitan el catálogo + etiquetas para emparejar por nombre.
  useEffect(() => {
    if (kind !== 'entries') return;
    let alive = true;
    (async () => {
      const [f, { data: l }] = await Promise.all([
        fetchFoodsForImport(),
        supabase.from('meal_labels').select('id, name').order('sort_order'),
      ]);
      if (!alive) return;
      setFoods(f);
      setLabels(l || []);
    })();
    return () => { alive = false; };
  }, [kind]);

  // Medidas: días ya registrados, para avisar coincidencias en la vista previa.
  useEffect(() => {
    if (kind !== 'body') return;
    let alive = true;
    supabase.from('body_metrics').select('day').then(({ data }) => {
      if (alive) setExistingDays(new Set((data || []).map((r) => r.day)));
    });
    return () => { alive = false; };
  }, [kind]);

  const { rows } = text.trim() ? parseCSV(text) : { rows: [] };
  const parsed =
    kind === 'foods' ? foodsFromCSV(rows)
      : kind === 'body' ? bodyMetricsFromCSV(rows)
        : entriesFromCSV(rows, foods, labels);
  const importable = parsed.filter((p) => p.valid);
  const warned = parsed.filter((p) => p.warnings.length);
  const collisions = kind === 'body' ? importable.filter((p) => existingDays.has(p.row.day)) : [];

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    readFile(e.dataTransfer.files?.[0]);
  }

  function downloadTemplate() {
    const tpl = TEMPLATE[kind];
    if (!tpl) return;
    // Plantilla en inglés para el lector EN: sus encabezados (weight, body_fat…)
    // vuelven a entrar por los alias del importer, así el round-trip es natural.
    const headers = kind === 'body' && getLang() === 'en' ? BODY_TEMPLATE_HEADERS_EN : tpl.headers;
    const blob = new Blob([headers.join(',') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tpl.file;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport() {
    if (!importable.length) return;
    setBusy(true);
    setError('');

    if (kind === 'body') {
      const { data: { user } } = await supabase.auth.getUser();
      let toWrite = importable.map((p) => ({ owner: user?.id, ...p.row }));
      // Complementar: mezcla las medidas existentes de los días en conflicto (el CSV
      // gana por clave). Una sola lectura de los días afectados; en Reemplazar el
      // upsert sustituye la fila entera.
      if (!bodyReplace && collisions.length) {
        const days = collisions.map((p) => p.row.day);
        const { data: existing } = await supabase.from('body_metrics').select('day, metrics, note').in('day', days);
        const byDay = new Map((existing || []).map((e) => [e.day, e]));
        toWrite = toWrite.map((row) => {
          const prev = byDay.get(row.day);
          return prev
            ? { ...row, metrics: { ...(prev.metrics || {}), ...row.metrics }, note: row.note ?? prev.note }
            : row;
        });
      }
      const { error: err } = await supabase.from('body_metrics').upsert(toWrite, { onConflict: 'owner,day' });
      if (err) {
        setError(err.message || t('Error al importar.'));
        setBusy(false);
        return;
      }
      onDone(toWrite.length);
      return;
    }

    const table = kind === 'foods' ? 'foods' : 'entries';
    const payloads = kind === 'foods' ? importable.map((p) => p.payload) : importable.map((p) => p.insert);
    const { error: err } = await supabase.from(table).insert(payloads);
    if (err) {
      setError(err.message || t('Error al importar.'));
      setBusy(false);
      return;
    }
    onDone(payloads.length);
  }

  const seg = (on) =>
    `flex-1 min-h-[36px] rounded-lg text-sm press ${on ? 'bg-accent-deep text-on-accent font-medium' : 'bg-surface-2 text-text-2'}`;

  const title = kind === 'foods' ? t('Importar alimentos') : kind === 'body' ? t('Importar medidas') : t('Importar registros');
  const desc =
    kind === 'foods'
      ? t('Pega o sube un CSV: una fila por alimento, valores por 100 g. Columnas: name, kcal, protein_g, carbs_g, fat_g y una por cada micro (p. ej. sodio_mg).')
      : kind === 'body'
        ? t('Sube o pega un CSV con una fila por día: una columna day (AAAA-MM-DD) y una columna por cada medida (%s…). Descarga la plantilla para ver los nombres exactos de las columnas.').replace('%s', BODY_EXAMPLE_KEYS.map((k) => bodyHeader(k, getLang() === 'en')).join(', '))
        : t('Pega o sube un CSV: una fila por registro. Columnas: day (AAAA-MM-DD), meal, food, grams. El alimento se empareja por nombre con tu catálogo.');

  // Ejemplo del textarea: encabezados derivados de la misma fuente (inglés en EN).
  const placeholder =
    kind === 'body'
      ? `${['day', ...BODY_EXAMPLE_KEYS].map((k) => bodyHeader(k, getLang() === 'en')).join(',')}\n2026-07-07,80.5,22,86`
      : PLACEHOLDER[kind];

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center backdrop-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={onDrop}
        className="glass w-full sm:max-w-lg border border-border rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 sheet-in max-h-[90vh]"
      >
        <h2 className="font-display text-[19px]">{title}</h2>
        <p className="text-sm text-text-2" style={{ margin: 0 }}>{desc}</p>

        <div className="flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl border border-border text-sm text-text-2 press cursor-pointer">
            <Upload size={15} /> {t('Subir archivo')}
            <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => readFile(e.target.files?.[0])} className="hidden" />
          </label>
          {TEMPLATE[kind] && (
            <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl border border-border text-sm text-text-2 press">
              <FileDown size={15} /> {t('Descargar plantilla')}
            </button>
          )}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={dragOver ? t('Suelta el CSV aquí') : placeholder}
          rows={5}
          className={`w-full rounded-xl bg-surface-2 border p-3 text-sm font-mono resize-y ${dragOver ? 'border-accent-deep ring-1 ring-accent-deep' : 'border-border'}`}
        />

        {kind === 'body' && collisions.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 p-2.5">
            <p className="text-xs text-text-2 flex items-center gap-1" style={{ margin: 0 }}>
              <AlertTriangle size={13} className="text-warn shrink-0" />
              {t('%n días del CSV ya tienen medidas registradas.').replace('%n', collisions.length)}
            </p>
            <div className="flex gap-1">
              <button onClick={() => setBodyReplace(false)} className={seg(!bodyReplace)}>{t('Complementar')}</button>
              <button onClick={() => setBodyReplace(true)} className={seg(bodyReplace)}>{t('Reemplazar')}</button>
            </div>
            <p className="text-[11px] text-text-3" style={{ margin: 0 }}>
              {bodyReplace
                ? t('Reemplazar: el CSV sustituye por completo las medidas de esos días.')
                : t('Complementar: conserva tus medidas y solo agrega o actualiza las del CSV.')}
            </p>
          </div>
        )}

        {parsed.length > 0 && (
          <>
            <div className="text-xs text-text-3">
              {t('%n filas · %v se importarán').replace('%n', parsed.length).replace('%v', importable.length)}
              {warned.length > 0 && ` · ${t('%w con ⚠').replace('%w', warned.length)}`}
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: '38vh' }}>
              {parsed.map((p, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm border ${
                    p.valid ? 'border-border' : 'border-danger/40 opacity-60'
                  }`}
                >
                  <span className="truncate">
                    {kind === 'foods'
                      ? `${p.payload.name || t('(sin nombre)')} · ${p.payload.kcal} kcal`
                      : kind === 'body'
                        ? `${p.display.day || '—'} · ${t('%n medidas').replace('%n', p.display.count)}`
                        : `${p.display.day || '—'} · ${p.display.meal || '—'} · ${p.display.food || '—'} · ${p.display.grams || 0} g`}
                  </span>
                  {p.warnings.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-warn shrink-0">
                      <AlertTriangle size={13} /> {p.warnings.map((w) => t(w)).join(', ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p className="text-sm text-danger" style={{ margin: 0 }}>{error}</p>}

        <button
          onClick={doImport}
          disabled={busy || importable.length === 0}
          className="min-h-[44px] rounded-xl font-medium press disabled:opacity-60 bg-accent-deep text-on-accent"
        >
          {t('Importar %n').replace('%n', importable.length)}
        </button>
        <button onClick={onClose} disabled={busy} className="min-h-[44px] rounded-xl border border-border text-text-2 press">
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}
