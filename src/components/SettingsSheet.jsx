import { useState } from 'react';
import { Lock, Tags, RotateCcw, Moon, Minus, Plus } from 'lucide-react';
import { ADHERENCE_BANDS, getActiveBands, SODIUM_FLOOR_MG, SODIUM_CEILING_MG } from '../lib/domain.js';
import { t, saveAdherenceBands, getSleepThreshold, setSleepThreshold } from '../lib/i18n.js';
import Sheet from './Sheet.jsx';
import LabelsModal from './LabelsModal.jsx';

const REGIMENES = [
  { key: 'default', label: 'Sin régimen' },
  { key: 'deficit', label: 'Déficit' },
  { key: 'volumen', label: 'Volumen' },
  { key: 'mantenimiento', label: 'Mant.' },
  { key: 'recomposicion', label: 'Recomp.' },
];

const pct = (f) => Math.round(f * 100);

function Slider({ label, value, min = 0, max = 50, onChange }) {
  return (
    <div>
      <div className="flex justify-between items-baseline text-[13px] mb-0.5">
        <span className="text-text-2">{label}</span>
        <span className="font-mono text-text">±{value}%</span>
      </div>
      <input
        type="range" min={min} max={max} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-[var(--accent)]"
        aria-label={label}
      />
    </div>
  );
}

function Section({ tag, tagCls, title, children }) {
  return (
    <div className="rounded-2xl border border-border bg-black/15 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-display font-semibold text-[14px]">{title}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tagCls}`}>{tag}</span>
      </div>
      {children}
    </div>
  );
}

// Settings: editor for the adherence grace bands (the machinery built in
// domain.js). Saving applies instantly (setActiveBands notifies Hoy and
// Dashboard) and persists to prefs.data.adherence_bands. Sodium stays
// read-only: its 1500 mg floor is a medical rule, not configurable.
export default function SettingsSheet({ onClose }) {
  const [bands, setBands] = useState(() => structuredClone(getActiveBands()));
  const [reg, setReg] = useState('default');
  const [showLabels, setShowLabels] = useState(false);
  const [sleepH, setSleepH] = useState(() => getSleepThreshold());
  const d = bands.diana[reg];

  const updDiana = (key, p) => setBands((b) => {
    const n = structuredClone(b);
    const dd = n.diana[reg];
    dd[key] = p / 100;
    // warn never inside ok: warn band ⊇ ok band.
    dd.warnUnder = Math.max(dd.warnUnder, dd.okUnder);
    dd.warnOver = Math.max(dd.warnOver, dd.okOver);
    dd.okUnder = Math.min(dd.okUnder, dd.warnUnder);
    dd.okOver = Math.min(dd.okOver, dd.warnOver);
    return n;
  });
  const updRango = (key, p) => setBands((b) => {
    const n = structuredClone(b);
    n.rango[key] = p / 100;
    n.rango.warn = Math.max(n.rango.warn, n.rango.ok);
    n.rango.ok = Math.min(n.rango.ok, n.rango.warn);
    return n;
  });
  const updTecho = (p) => setBands((b) => ({ ...b, techo: { warn: p / 100 } }));

  const save = () => { saveAdherenceBands(bands); setSleepThreshold(sleepH); onClose(); };
  const bumpSleep = (delta) => setSleepH((h) => Math.min(12, Math.max(1, Math.round((h + delta) * 2) / 2)));
  const reset = () => setBands(structuredClone(ADHERENCE_BANDS));

  return (
    <Sheet
      title={t('Configuración')}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button onClick={reset} className="min-h-[46px] px-4 rounded-xl border border-border text-text-2 press flex items-center gap-2">
            <RotateCcw size={16} />{t('Restaurar')}
          </button>
          <button onClick={save} className="flex-1 min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press">{t('Guardar')}</button>
        </div>
      }
    >
      <p className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{t('Adherencia')}</p>
      <p className="text-xs text-text-3 -mt-1.5">{t('Rango de gracia por arquetipo. Afecta los colores de Hoy y Dashboard.')}</p>

      <Section title={t('Kcal')} tag={t('diana')} tagCls="bg-d-kcal/15 text-d-kcal">
        <div className="flex gap-1 p-1 rounded-xl bg-black/25 border border-border flex-wrap">
          {REGIMENES.map((r) => (
            <button
              key={r.key}
              onClick={() => setReg(r.key)}
              className={`flex-1 min-w-[54px] py-1.5 rounded-lg text-[11.5px] font-medium press ${reg === r.key ? 'bg-accent-deep text-on-accent' : 'text-text-2'}`}
            >
              {t(r.label)}
            </button>
          ))}
        </div>
        <Slider label={t('En meta · defecto')} value={pct(d.okUnder)} onChange={(p) => updDiana('okUnder', p)} />
        <Slider label={t('En meta · exceso')} value={pct(d.okOver)} onChange={(p) => updDiana('okOver', p)} />
        <Slider label={t('Aviso · defecto')} value={pct(d.warnUnder)} onChange={(p) => updDiana('warnUnder', p)} />
        <Slider label={t('Aviso · exceso')} value={pct(d.warnOver)} onChange={(p) => updDiana('warnOver', p)} />
      </Section>

      <Section title={t('Carbs · Grasa')} tag={t('rango')} tagCls="bg-d-carb/15 text-d-carb">
        <Slider label={t('En meta')} value={pct(bands.rango.ok)} onChange={(p) => updRango('ok', p)} />
        <Slider label={t('Aviso')} value={pct(bands.rango.warn)} max={60} onChange={(p) => updRango('warn', p)} />
      </Section>

      <Section title={t('Límites (grasa sat., azúcar añadido…)')} tag={t('techo')} tagCls="bg-danger/15 text-danger">
        <Slider label={t('Holgura sobre el techo antes del aviso')} value={pct(bands.techo.warn)} max={30} onChange={updTecho} />
      </Section>

      <div className="rounded-2xl border border-border bg-black/15 p-4 flex items-center gap-3">
        <Lock size={18} className="text-text-3 flex-none" />
        <div className="flex-1">
          <p className="text-[13px] text-text-2">{t('Sodio')} · <span className="font-mono">{SODIUM_FLOOR_MG}–{SODIUM_CEILING_MG} mg</span></p>
          <p className="text-[11px] text-text-3 mt-0.5">{t('Piso médico fijo, no configurable.')}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-black/15 p-4 flex items-center gap-3">
        <Moon size={18} className="text-text-3 flex-none" />
        <div className="flex-1">
          <p className="text-[13px] text-text-2">{t('Sueño')}</p>
          <p className="text-[11px] text-text-3 mt-0.5">{t('Umbral del checkpoint de Medidas: “dormí menos de N horas”.')}</p>
        </div>
        <div className="flex items-center gap-1 flex-none">
          <button onClick={() => bumpSleep(-0.5)} aria-label={t('Menos')} className="h-11 w-11 flex items-center justify-center rounded-xl border border-border press">
            <Minus size={16} />
          </button>
          <span className="font-mono tabular-nums text-text w-14 text-center">{sleepH} h</span>
          <button onClick={() => bumpSleep(0.5)} aria-label={t('Más')} className="h-11 w-11 flex items-center justify-center rounded-xl border border-border press">
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="h-px bg-border" />
      <button
        onClick={() => setShowLabels(true)}
        className="flex items-center gap-3 rounded-xl px-1 py-2 text-sm text-text press"
      >
        <Tags size={19} className="text-text-2" />
        <span>{t('Secciones de comida')}</span>
        <span className="ml-auto text-text-3">›</span>
      </button>

      {showLabels && <LabelsModal onClose={() => setShowLabels(false)} />}
    </Sheet>
  );
}
