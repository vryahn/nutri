import { useState } from 'react';
import { t, useLang } from '../lib/i18n.js';
import UndoToast from './UndoToast.jsx';

// Editor for targets.rules (migration 021): phase-adjustment rules evaluated
// client-side by domain.js evalRules. Used in 2 places — TargetsWizard (new-phase
// step) and Targets.jsx PhaseCard ("Editar reglas" on the vigente phase) — so it
// lives here per the ≥2-uses rule for extracted components.
let _rid = 0;
const newId = () => `r${Date.now().toString(36)}${++_rid}`;

const TEMPLATES = [
  { kind: 'ritmo_alto', label: 'Ritmo alto' },
  { kind: 'estancamiento', label: 'Estancamiento' },
  { kind: 'techo_peso', label: 'Techo de peso' },
  { kind: 'ritmo_lento', label: 'Ritmo lento' },
];

function defaultsFor(kind) {
  if (kind === 'ritmo_alto') return { value: 0.3, weeks: 2, delta_carbs_g: -25 };
  if (kind === 'ritmo_lento') return { value: 0.2, weeks: 2, delta_carbs_g: -25 };
  if (kind === 'estancamiento') return { days: 10, delta_carbs_g: 25 };
  return { value: 90 }; // techo_peso
}

function fmtSigned(n) {
  const v = Number(n);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
}

// One-line prose help, built from the item's own (possibly still-empty) values —
// so the user sees exactly what they are configuring, not a generic template.
function helpText(item) {
  const dcg = item.delta_carbs_g;
  const dcgTxt = dcg === '' || dcg == null ? t('ajusta los carbos') : `${fmtSigned(dcg)} g ${t('de carbs')}`;
  if (item.kind === 'ritmo_alto') {
    return t('Si el peso sube más de %v kg/sem durante %w semanas, %d.')
      .replace('%v', item.value ?? '–').replace('%w', item.weeks ?? '–').replace('%d', dcgTxt);
  }
  if (item.kind === 'ritmo_lento') {
    return t('Si el peso baja menos de %v kg/sem durante %w semanas, %d.')
      .replace('%v', item.value ?? '–').replace('%w', item.weeks ?? '–').replace('%d', dcgTxt);
  }
  if (item.kind === 'estancamiento') {
    return t('Si el peso no baja en %n días, %d.').replace('%n', item.days ?? '–').replace('%d', dcgTxt);
  }
  return t('Si el peso llega a %v kg, tus kcal pasan a mantenimiento.').replace('%v', item.value ?? '–');
}

// rules: { paused_until?, kcal_min?, kcal_max?, items: [] } (raw/editable shape —
// cleanRules() normalizes it on save). scopeOptions: [{ label, dows:[0-6] }], the
// day-type chips of the phase being edited (from the wizard's groups or the
// existing week's groupWeek) — "Todos" (scope null) is always offered besides them.
export default function RulesEditor({ rules, onChange, scopeOptions = [] }) {
  useLang();
  const items = rules.items || [];
  const [undo, setUndo] = useState(null); // { item, index, timer }

  const patch = (p) => onChange({ ...rules, ...p });
  const setItems = (next) => patch({ items: next });

  function addItem(kind) {
    setItems([...items, { id: newId(), kind, auto: false, scope: null, ...defaultsFor(kind) }]);
  }
  function updateItem(id, p) {
    setItems(items.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }
  function removeItem(id) {
    const index = items.findIndex((it) => it.id === id);
    if (index < 0) return;
    const item = items[index];
    setItems(items.filter((it) => it.id !== id));
    setUndo((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndo(null), 5000);
      return { item, index, timer };
    });
  }
  function undoRemove() {
    if (!undo) return;
    clearTimeout(undo.timer);
    const next = [...items];
    next.splice(undo.index, 0, undo.item);
    setUndo(null);
    setItems(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{t('Añadir regla')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.kind}
              type="button"
              onClick={() => addItem(tpl.kind)}
              className="min-h-[44px] px-3.5 rounded-full text-[13px] font-medium press border border-border text-text-2"
            >
              + {t(tpl.label)}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 && (
        <p className="text-[12.5px] text-text-2" style={{ margin: 0 }}>{t('Sin reglas configuradas.')}</p>
      )}

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <RuleItemCard key={item.id} item={item} scopeOptions={scopeOptions} onChange={(p) => updateItem(item.id, p)} onRemove={() => removeItem(item.id)} />
        ))}
      </div>

      <div className="border-t border-border pt-3 flex flex-col gap-2">
        <Label>{t('Límites de la fase')}</Label>
        <div className="grid grid-cols-2 gap-2">
          <NumField label={t('Kcal mín.')} value={rules.kcal_min ?? ''} onChange={(v) => patch({ kcal_min: v })} />
          <NumField label={t('Kcal máx.')} value={rules.kcal_max ?? ''} onChange={(v) => patch({ kcal_max: v })} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-3">{t('Pausar reglas hasta')}</label>
          <input type="date" value={rules.paused_until || ''} onChange={(e) => patch({ paused_until: e.target.value })} className="input" />
        </div>
      </div>

      {undo && <UndoToast message={t('Regla borrada')} onUndo={undoRemove} />}
    </div>
  );
}

function RuleItemCard({ item, scopeOptions, onChange, onRemove }) {
  const tpl = TEMPLATES.find((x) => x.kind === item.kind);
  return (
    <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13.5px] font-medium">{t(tpl?.label || item.kind)}</span>
        <button type="button" onClick={onRemove} className="min-h-[44px] px-2 text-text-2 press" aria-label={t('Borrar regla')}>✕</button>
      </div>
      <p className="text-[11.5px] text-text-3" style={{ margin: 0 }}>{helpText(item)}</p>
      <div className="grid grid-cols-3 gap-2">
        {item.kind === 'estancamiento' ? (
          <NumField label={t('Días')} value={item.days ?? ''} onChange={(v) => onChange({ days: v })} />
        ) : (
          <>
            <NumField label={item.kind === 'techo_peso' ? t('Peso (kg)') : t('kg/sem')} value={item.value ?? ''} onChange={(v) => onChange({ value: v })} />
            {item.kind !== 'techo_peso' && <NumField label={t('Semanas')} value={item.weeks ?? ''} onChange={(v) => onChange({ weeks: v })} />}
          </>
        )}
        {item.kind !== 'techo_peso' && <NumField label={t('Δ carbs (g)')} value={item.delta_carbs_g ?? ''} onChange={(v) => onChange({ delta_carbs_g: v })} />}
      </div>
      {item.kind !== 'techo_peso' && scopeOptions.length > 0 && (
        <ScopePicker scope={item.scope} options={scopeOptions} onChange={(scope) => onChange({ scope })} />
      )}
      <label className="flex items-center gap-2 text-[12.5px] text-text-2 min-h-[44px]">
        <input type="checkbox" checked={!!item.auto} onChange={(e) => onChange({ auto: e.target.checked })} className="w-[18px] h-[18px]" />
        {t('Aplicar automáticamente')}
      </label>
    </div>
  );
}

function ScopePicker({ scope, options, onChange }) {
  const allOn = scope == null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`min-h-[44px] px-3 rounded-full text-[12px] press border ${allOn ? 'bg-accent-deep text-on-accent border-transparent' : 'border-border text-text-2'}`}
      >
        {t('Todos')}
      </button>
      {options.map((opt) => {
        const on = !allOn && opt.dows.every((d) => scope.includes(d));
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => {
              const cur = allOn ? [] : scope;
              const has = opt.dows.every((d) => cur.includes(d));
              const next = has ? cur.filter((d) => !opt.dows.includes(d)) : [...new Set([...cur, ...opt.dows])];
              onChange(next.length ? next.sort((a, b) => a - b) : null);
            }}
            className={`min-h-[44px] px-3 rounded-full text-[12px] press border ${on ? 'bg-accent-deep text-on-accent border-transparent' : 'border-border text-text-2'}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Label({ children }) {
  return <span className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{children}</span>;
}
function NumField({ label, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-text-3">{label}</label>
      <input
        type="number" inputMode="decimal" step="any" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="min-h-[44px] rounded-lg bg-surface-2 border border-border px-2 text-text font-mono tabular-nums text-sm placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}
