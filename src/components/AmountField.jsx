import { useState } from 'react';
import { round } from '../lib/domain.js';

// Cantidad de un registro: siempre reporta GRAMOS via onGrams (la DB solo conoce gramos).
// Si el food tiene densidad, permite capturar en ml (ml × densidad → g).
// Cada chip de porción SUMA sus gramos (2 taps de «vaso» = 2 vasos).
// `placeholder` (opcional): gramos ya registrados, para editar sin perder el valor si
// el campo se deja vacío. `required` (default true): AddEntrySheet no tiene valor
// previo que conservar, así que sigue exigiendo el campo.
export default function AmountField({ grams, onGrams, meta, placeholder, required = true }) {
  const [unit, setUnit] = useState('g');
  const [ml, setMl] = useState('');
  const density = Number(meta?.density_g_ml) || 0;
  const portions = meta?.portions || [];
  const mlPlaceholder = placeholder != null && density > 0 ? String(round(Number(placeholder) / density, 1)) : undefined;

  function typeAmount(v) {
    if (unit === 'ml') {
      setMl(v);
      onGrams(v === '' ? '' : String(round(Number(v) * density, 1)));
    } else {
      onGrams(v);
    }
  }

  function switchUnit(u) {
    if (u === unit) return;
    setUnit(u);
    if (u === 'ml') setMl(grams === '' ? '' : String(round(Number(grams) / density, 1)));
  }

  function addPortion(p) {
    const g = round((Number(grams) || 0) + Number(p.grams), 1);
    onGrams(String(g));
    if (unit === 'ml') setMl(String(round(g / density, 1)));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-text-2">{unit === 'ml' ? 'Mililitros' : 'Gramos'}</label>
        {density > 0 && (
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {['g', 'ml'].map((u) => (
              <button
                type="button"
                key={u}
                onClick={() => switchUnit(u)}
                className={`px-4 py-1.5 ${unit === u ? 'bg-accent text-bg font-medium' : 'bg-surface-2 text-text-2'}`}
              >
                {u}
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
        value={unit === 'ml' ? ml : grams}
        onChange={(e) => typeAmount(e.target.value)}
        placeholder={unit === 'ml' ? mlPlaceholder : placeholder}
        className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-text-3"
      />
      {unit === 'ml' && grams !== '' && (
        <p className="text-xs text-text-3 font-mono tabular-nums">≈ {grams} g (densidad {density} g/ml)</p>
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
              + {p.name} ({p.grams} g)
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
