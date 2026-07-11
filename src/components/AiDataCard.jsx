import { Sparkles, ImagePlus, X } from 'lucide-react';
import { t, useLang } from '../lib/i18n.js';

// Card "Datos con IA" compartida por FoodForm y RecipeForm: texto/fotos (máx. 2:
// p. ej. frente del empaque + tabla nutrimental) → botón "Obtener datos".
// `children` = líneas de resultado específicas de cada form (badge, avisos),
// renderizadas entre el error y el hint de cierre.
const MAX_PHOTOS = 2;

export default function AiDataCard({
  text, onText, files, onFiles, loading, error, onSubmit, placeholder, hint, children,
}) {
  useLang();
  return (
    <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
      <p className="text-sm text-text-2 flex items-center gap-2">
        <Sparkles size={16} className="text-accent" /> {t('Datos con IA')}
      </p>
      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={2}
        placeholder={placeholder}
        className="rounded-xl bg-surface-3 border border-border px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-accent resize-none"
      />
      <div className="flex gap-2 items-center">
        <label
          className={`flex-1 min-w-0 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 flex items-center gap-2 text-sm text-text-2 ${
            files.length >= MAX_PHOTOS ? 'opacity-40' : 'cursor-pointer press'
          }`}
        >
          <ImagePlus size={18} className="shrink-0" />
          <span className="min-w-0 truncate">
            {files.length >= MAX_PHOTOS ? t('Máximo 2 fotos') : t('Fotos (etiqueta y/o producto, máx. 2)')}
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={files.length >= MAX_PHOTOS}
            className="hidden"
            onChange={(e) => {
              onFiles([...files, ...Array.from(e.target.files)].slice(0, MAX_PHOTOS));
              e.target.value = ''; // permite re-elegir el mismo archivo tras quitarlo
            }}
          />
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || (!text.trim() && files.length === 0)}
          className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium disabled:opacity-40 press"
        >
          {loading ? t('Obteniendo…') : t('Obtener datos')}
        </button>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span
              key={i}
              className="flex items-center gap-1 min-h-[44px] max-w-full rounded-full bg-surface-3 border border-border pl-3 text-xs text-text-2"
            >
              <span className="truncate max-w-[200px]">{f.name}</span>
              <button
                type="button"
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center press"
                aria-label={t('Quitar foto')}
              >
                <X size={16} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {children}
      {hint && <p className="text-xs text-text-3">{hint}</p>}
    </div>
  );
}
