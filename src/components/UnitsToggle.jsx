import { Ruler } from 'lucide-react';
import { useUnits, setUnits, t } from '../lib/i18n.js';

const META = { metric: 'g · ml', us: 'oz · fl oz' };

// Un solo botón que cicla metric → us, gemelo de LangToggle.
export default function UnitsToggle({ showLabel = false, className }) {
  const units = useUnits();
  const next = units === 'metric' ? 'us' : 'metric';

  return (
    <button
      onClick={() => setUnits(next)}
      className={className}
      title={`${t('Unidades')}: ${META[units]}`}
      aria-label={`${t('Unidades')}: ${META[units]}. ${t('Cambiar a')} ${META[next]}.`}
    >
      <Ruler size={20} />
      {showLabel && <span className="text-sm">{t('Unidades')} · {META[units]}</span>}
    </button>
  );
}
