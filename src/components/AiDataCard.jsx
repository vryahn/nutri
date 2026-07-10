import { Sparkles, ImagePlus, X } from 'lucide-react';
import { t, useLang } from '../lib/i18n.js';

// Card "Datos con IA" compartida por FoodForm y RecipeForm: texto/foto → botón
// "Obtener datos". `children` = líneas de resultado específicas de cada form
// (badge, avisos), renderizadas entre el error y el hint de cierre.
export default function AiDataCard({
  text, onText, file, onFile, loading, error, onSubmit, placeholder, hint, children,
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
        <label className="flex-1 min-h-[44px] rounded-xl bg-surface-3 border border-border px-3 flex items-center gap-2 text-sm text-text-2 cursor-pointer press">
          <ImagePlus size={18} />
          <span className="truncate">{file ? file.name : t('Foto (etiqueta o platillo)')}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files[0] || null)}
          />
        </label>
        {file && (
          <button
            type="button"
            onClick={() => onFile(null)}
            className="min-w-[44px] min-h-[44px] rounded-xl bg-surface-3 border border-border flex items-center justify-center text-text-2"
            aria-label={t('Quitar foto')}
          >
            <X size={18} />
          </button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || (!text.trim() && !file)}
          className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium disabled:opacity-40 press"
        >
          {loading ? t('Obteniendo…') : t('Obtener datos')}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {children}
      {hint && <p className="text-xs text-text-3">{hint}</p>}
    </div>
  );
}
