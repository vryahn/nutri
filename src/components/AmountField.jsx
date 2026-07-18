import { useState } from 'react';
import { round } from '../lib/domain.js';
import { t, useLang, useUnits, gToOz, ozToG, mlToFlOz, flOzToMl } from '../lib/i18n.js';

// Amount for an entry: always reports GRAMS via onGrams (the DB only knows grams).
// If the food has a density, it allows capturing in ml (ml × density → g).
// With units='us' the same two bases are captured in oz / fl oz (same onGrams contract).
// Each portion chip ADDS its grams (2 taps on «vaso» = 2 glasses).
// `placeholder` (optional): grams already logged, so editing does not lose the value if
// the field is left empty. `required` (default true): AddEntrySheet has no previous
// value to preserve, so it keeps requiring the field.
export default function AmountField({ grams, onGrams, meta, placeholder, required = true }) {
  useLang();
  const units = useUnits();
  const isUS = units === 'us';
  const [unit, setUnit] = useState(isUS ? 'oz' : 'g');
  const [alt, setAlt] = useState(''); // value captured in ml or fl oz
  const density = Number(meta?.density_g_ml) || 0;
  const portions = meta?.portions || [];
  const usesAlt = unit === 'ml' || unit === 'floz';
  const altFromG = (g, u = unit) => (u === 'ml' ? round(g / density, 1) : round(mlToFlOz(g / density), 2));
  const altPlaceholder = placeholder != null && density > 0 && usesAlt ? String(altFromG(Number(placeholder))) : undefined;

  function gramsFromUnit(v, u) {
    if (v === '') return '';
    const n = Number(v);
    if (u === 'oz') return String(round(ozToG(n), 1));
    if (u === 'ml') return String(round(n * density, 1));
    if (u === 'floz') return String(round(flOzToMl(n) * density, 1));
    return v;
  }

  function typeAmount(v) {
    if (usesAlt) {
      setAlt(v);
      onGrams(gramsFromUnit(v, unit));
    } else {
      onGrams(unit === 'oz' ? gramsFromUnit(v, 'oz') : v);
    }
  }

  function switchUnit(u) {
    if (u === unit) return;
    setUnit(u);
    if (u === 'ml' || u === 'floz') setAlt(grams === '' ? '' : String(altFromG(Number(grams), u)));
  }

  function addPortion(p) {
    const g = round((Number(grams) || 0) + Number(p.grams), 1);
    onGrams(String(g));
    if (usesAlt) setAlt(String(altFromG(g)));
  }

  const unitOptions = isUS ? (density > 0 ? ['oz', 'floz'] : ['oz']) : (density > 0 ? ['g', 'ml'] : []);
  const ozValue = grams === '' ? '' : String(round(gToOz(Number(grams)), 2));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-text-2">
          {unit === 'ml' ? t('Mililitros') : unit === 'floz' ? 'Fl oz' : unit === 'oz' ? 'Oz' : t('Gramos')}
        </label>
        {unitOptions.length > 1 && (
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {unitOptions.map((u) => (
              <button
                type="button"
                key={u}
                onClick={() => switchUnit(u)}
                className={`px-4 py-1.5 ${unit === u ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2'}`}
              >
                {u === 'floz' ? 'fl oz' : u}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        required={required}
        value={unit === 'oz' ? ozValue : usesAlt ? alt : grams}
        onChange={(e) => typeAmount(e.target.value)}
        placeholder={unit === 'oz' ? (placeholder != null ? String(round(gToOz(Number(placeholder)), 2)) : undefined) : usesAlt ? altPlaceholder : placeholder}
        className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-text-3"
      />
      {usesAlt && grams !== '' && (
        <p className="text-xs text-text-3 font-mono tabular-nums">
          ≈ {grams} g ({t('densidad')} {density} g/ml)
        </p>
      )}
      {unit === 'oz' && grams !== '' && (
        <p className="text-xs text-text-3 font-mono tabular-nums">≈ {grams} g</p>
      )}
      {portions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {portions.map((p) => (
            <button
              type="button"
              key={p.name}
              onClick={() => addPortion(p)}
              className="px-3 py-2 rounded-full bg-surface-2 border border-border text-sm press"
            >
              + {p.name} ({isUS ? `${round(gToOz(p.grams), 1)} oz` : `${p.grams} g`})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
