import { Check } from 'lucide-react';
import { t, useLang, setLang, useUnits, setUnits, fmtG, fmtMl } from '../lib/i18n.js';
import Sheet from './Sheet.jsx';

const LANGS = [{ key: 'es', flag: '🇲🇽', label: 'Español' }, { key: 'en', flag: '🇺🇸', label: 'English' }];

// Idioma y unidades. Aplican al instante (setLang/setUnits ya persisten en
// prefs y notifican a toda la app) — no hace falta botón Guardar.
export default function RegionSheet({ onClose }) {
  const lang = useLang();
  const units = useUnits();
  return (
    <Sheet
      title={t('Idioma y unidades')}
      onClose={onClose}
      footer={<button onClick={onClose} className="w-full min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press">{t('Listo')}</button>}
    >
      <p className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{t('Idioma')}</p>
      <div className="flex flex-col gap-2">
        {LANGS.map((l) => {
          const on = lang === l.key;
          return (
            <button
              key={l.key}
              onClick={() => setLang(l.key)}
              className={`flex items-center gap-3 h-[46px] rounded-xl border px-4 text-sm press ${on ? 'border-accent-deep bg-accent-deep/10 text-text' : 'border-border bg-black/20 text-text-2'}`}
            >
              <span className="text-lg">{l.flag}</span>
              {l.label}
              {on && <Check size={18} className="ml-auto text-accent-glass" />}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] uppercase tracking-wide text-text-3 font-medium mt-2">{t('Sistema de unidades')}</p>
      <div className="flex gap-1.5 p-1 rounded-xl bg-black/25 border border-border">
        {[{ key: 'metric', label: 'Métrico · g · ml' }, { key: 'us', label: 'Imperial · oz · fl oz' }].map((u) => (
          <button
            key={u.key}
            onClick={() => setUnits(u.key)}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium press ${units === u.key ? 'bg-accent-deep text-on-accent' : 'text-text-2'}`}
          >
            {t(u.label)}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-black/20 px-4 h-[42px] font-mono text-[13px] text-text-2">
        <span>{fmtG(150)} · {fmtMl(250)}</span>
        <span className="text-accent-glass">{units === 'us' ? t('imperial') : t('métrico')}</span>
      </div>
    </Sheet>
  );
}
