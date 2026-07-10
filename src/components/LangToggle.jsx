import { Languages } from 'lucide-react';
import { useLang, setLang, t } from '../lib/i18n.js';

const META = { es: 'ES', en: 'EN' };

// Un solo botón que cicla ES → EN, gemelo de ThemeToggle.
export default function LangToggle({ showLabel = false, className }) {
  const lang = useLang();
  const next = lang === 'es' ? 'en' : 'es';

  return (
    <button
      onClick={() => setLang(next)}
      className={className}
      title={`${t('Idioma')}: ${META[lang]}`}
      aria-label={`${t('Idioma')}: ${META[lang]}. ${t('Cambiar a')} ${META[next]}.`}
    >
      <Languages size={20} />
      {showLabel && <span className="text-sm">{t('Idioma')} · {META[lang]}</span>}
    </button>
  );
}
