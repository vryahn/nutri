import { X } from 'lucide-react';
import { t, useUnits, gToOz, ozToG } from '../lib/i18n.js';
import { round } from '../lib/domain.js';

// Editor de porciones custom [{name, grams}] — chips que SUMAN gramos al registrar.
// Compartido por FoodForm (Alimentos) y RecipeForm (Recetas). La DB solo conoce gramos;
// en unidades US se captura/muestra en oz (peso, densidad-independiente) y se convierte a
// gramos aquí, igual que AmountField los muestra en oz al consumir. Sin round-trip contra
// el per-100 g del alimento, así que la conversión no toca la precisión de los nutrientes.
export default function PortionsEditor({ portions, onChange }) {
  const isUS = useUnits() === 'us';
  const dispAmt = (g) => (g === '' || g == null ? '' : isUS ? round(gToOz(g), 2) : g);
  const toGrams = (v) => (v === '' ? '' : isUS ? round(ozToG(Number(v)), 1) : v);
  const set = (i, patch) => onChange(portions.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-2">{t('Porciones (opcional)')}</p>
      {portions.map((p, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={p.name}
            onChange={(e) => set(i, { name: e.target.value })}
            placeholder={t('vaso, cucharada, rebanada…')}
            className="flex-1 min-w-0 input"
            aria-label={`${t('Nombre de la porción')} ${i + 1}`}
          />
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={dispAmt(p.grams)}
            onChange={(e) => set(i, { grams: toGrams(e.target.value) })}
            placeholder={isUS ? 'oz' : 'g'}
            className="w-24 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
            aria-label={`${t('Cantidad de la porción')} (${isUS ? 'oz' : 'g'}) ${i + 1}`}
          />
          <button
            type="button"
            onClick={() => onChange(portions.filter((_, j) => j !== i))}
            className="min-w-[44px] min-h-[44px] rounded-xl border border-border flex items-center justify-center text-text-2 press"
            aria-label={`${t('Quitar porción')} ${i + 1}`}
          >
            <X size={18} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...portions, { name: '', grams: '' }])}
        className="min-h-[44px] rounded-xl border border-border text-text-2 press"
      >
        + {t('Añadir porción')}
      </button>
    </div>
  );
}
