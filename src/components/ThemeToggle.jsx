import { useState } from 'react';
import { Monitor, Sun, Moon } from 'lucide-react';
import { MODES, getMode, setMode } from '../lib/theme.js';
import { t, useLang } from '../lib/i18n.js';

const META = {
  system: { icon: Monitor, label: 'Auto' },
  light: { icon: Sun, label: 'Claro' },
  dark: { icon: Moon, label: 'Oscuro' },
};

// Un solo botón que cicla Auto → Claro → Oscuro. El ícono ES el estado, así que
// no hace falta un switch binario (que además perdería el modo 'system').
export default function ThemeToggle({ showLabel = false, className }) {
  useLang();
  const [mode, setLocal] = useState(getMode);
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  const { icon: Icon, label } = META[mode];

  return (
    <button
      onClick={() => {
        setMode(next);
        setLocal(next);
      }}
      className={className}
      title={`${t('Tema')}: ${t(label)}`}
      aria-label={`${t('Tema')}: ${t(label)}. ${t('Cambiar a')} ${t(META[next].label).toLowerCase()}.`}
    >
      <Icon size={20} />
      {showLabel && <span className="text-sm">{t('Tema')} · {t(label)}</span>}
    </button>
  );
}
