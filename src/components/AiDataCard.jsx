import { useEffect, useMemo, useState } from 'react';
import { Sparkles, ImagePlus, X, Loader2 } from 'lucide-react';
import { t, useLang } from '../lib/i18n.js';

// Card "Datos con IA" compartida por FoodForm y RecipeForm: texto/fotos (hasta 2:
// p. ej. frente del empaque + tabla nutrimental) → botón "Obtener datos".
// La fila de fotos se parte en mitades: cada foto tomada es una miniatura
// (tap = quitarla) y, mientras quepa otra, la mitad restante es el botón de
// añadir; con el cupo lleno el botón desaparece — el límite se ve, no se dice.
// `children` = líneas de resultado específicas de cada form (badge, avisos),
// renderizadas entre el error y el hint de cierre.
const MAX_PHOTOS = 2;

export default function AiDataCard({
  text, onText, files, onFiles, loading, error, onSubmit, placeholder, hint, children,
}) {
  useLang();
  const [dragOver, setDragOver] = useState(false);
  const thumbs = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);
  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (loading) return; // petición en curso: card bloqueada
    const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) onFiles([...files, ...imgs].slice(0, MAX_PHOTOS));
  }
  const border = loading ? 'border-accent-deep' : dragOver ? 'border-accent-deep ring-1 ring-accent-deep' : 'border-border';
  return (
    <div
      aria-busy={loading}
      onDragOver={(e) => { e.preventDefault(); if (!loading) setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
      onDrop={onDrop}
      className={`rounded-xl bg-surface-2 border p-3 flex flex-col gap-2 ${border}`}
    >
      <p className="text-sm text-text-2 flex items-center gap-2">
        <Sparkles size={16} className="text-accent" /> {t('Datos con IA')}
      </p>
      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={2}
        placeholder={placeholder}
        disabled={loading}
        className="rounded-xl bg-surface-3 border border-border px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-accent resize-none disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <div className="flex gap-2 items-center">
        <div className={`flex-1 min-w-0 flex gap-2 ${loading ? 'opacity-50' : ''}`}>
          {files.map((f, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onFiles(files.filter((_, j) => j !== i))}
              disabled={loading}
              className="relative flex-1 min-w-0 min-h-[44px] rounded-xl border border-border overflow-hidden press disabled:cursor-not-allowed"
              aria-label={t('Quitar foto')}
            >
              <img src={thumbs[i]} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                <X size={16} />
              </span>
            </button>
          ))}
          {files.length < MAX_PHOTOS && (
            <label
              className={`flex-1 min-w-0 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 flex items-center justify-center gap-2 text-sm text-text-2 press ${loading ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}`}
              aria-label={files.length === 0 ? undefined : t('Otra foto')}
            >
              <ImagePlus size={18} className="shrink-0" />
              {files.length === 0 && (
                <span className="min-w-0 truncate">{t('Foto (etiqueta o platillo)')}</span>
              )}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={loading}
                className="hidden"
                onChange={(e) => {
                  onFiles([...files, ...Array.from(e.target.files)].slice(0, MAX_PHOTOS));
                  e.target.value = ''; // permite re-elegir el mismo archivo tras quitarlo
                }}
              />
            </label>
          )}
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || (!text.trim() && files.length === 0)}
          className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium disabled:opacity-40 press flex items-center gap-2"
        >
          {loading && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />}
          {loading ? t('Obteniendo…') : t('Obtener datos')}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {children}
      {hint && <p className="text-xs text-text-3">{hint}</p>}
    </div>
  );
}
