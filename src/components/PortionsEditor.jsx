import { X } from 'lucide-react';
import { t, useUnits, gToOz, ozToG, mlToFlOz, flOzToMl } from '../lib/i18n.js';
import { round } from '../lib/domain.js';

// Editor for custom portions [{name, grams}] — chips that ADD grams when logging.
// Shared by FoodForm (Alimentos) and RecipeForm (Recetas). The DB only knows grams;
// `density` (g/ml of the food itself, 0 if not applicable) enables a per-row unit toggle
// (g/ml in metric, oz/fl oz in US), same as AmountField — without density, the behavior
// is identical to the historical one (weight: g in metric, oz in US, no toggle). Each row
// carries the transient fields `unit`/`amount` (string exactly as typed, so the input is
// not rewritten by conversion while typing); `grams` remains the only canonical field —
// the caller discards the transients unit/amount when saving.
export default function PortionsEditor({ portions, onChange, density = 0 }) {
  const isUS = useUnits() === 'us';
  const hasVol = Number(density) > 0;
  const defaultUnit = isUS ? 'oz' : 'g';
  const unitOptions = isUS ? ['oz', 'floz'] : ['g', 'ml'];

  function toGrams(v, unit) {
    if (v === '') return '';
    const n = Number(v);
    if (unit === 'oz') return round(ozToG(n), 1);
    if (unit === 'ml') return round(n * density, 1);
    if (unit === 'floz') return round(flOzToMl(n) * density, 1);
    return v;
  }
  function fromGrams(g, unit) {
    if (g === '' || g == null) return '';
    const n = Number(g);
    if (unit === 'oz') return round(gToOz(n), 2);
    if (unit === 'ml') return round(n / density, 1);
    if (unit === 'floz') return round(mlToFlOz(n / density), 2);
    return n;
  }

  const set = (i, patch) => onChange(portions.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-2">{t('Porciones (opcional)')}</p>
      {portions.map((p, i) => {
        const unit = hasVol ? p.unit || defaultUnit : defaultUnit;
        const isVolUnit = unit === 'ml' || unit === 'floz';
        const value = p.amount ?? fromGrams(p.grams, unit);
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <input
                value={p.name}
                onChange={(e) => set(i, { name: e.target.value })}
                placeholder={t('vaso, cucharada, rebanada…')}
                className="flex-1 min-w-0 input"
                aria-label={`${t('Nombre de la porción')} ${i + 1}`}
              />
              {hasVol && (
                <div className="flex rounded-lg border border-border overflow-hidden text-sm shrink-0">
                  {unitOptions.map((u) => (
                    <button
                      type="button"
                      key={u}
                      onClick={() => set(i, { unit: u, amount: fromGrams(p.grams, u) })}
                      className={`px-2.5 min-h-[44px] ${unit === u ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2'}`}
                    >
                      {u === 'floz' ? 'fl oz' : u}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={value}
                onChange={(e) => set(i, { amount: e.target.value, grams: toGrams(e.target.value, unit) })}
                placeholder={unit === 'floz' ? 'fl oz' : unit}
                className={`${hasVol ? 'w-20' : 'w-24'} min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent`}
                aria-label={`${t('Cantidad de la porción')} (${unit === 'floz' ? 'fl oz' : unit}) ${i + 1}`}
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
            {isVolUnit && p.grams !== '' && (
              <p className="text-xs text-text-3 font-mono tabular-nums">≈ {p.grams} g</p>
            )}
          </div>
        );
      })}
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
