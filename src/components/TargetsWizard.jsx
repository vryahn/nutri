import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import {
  todayISO, PHASE_GOALS, goalLabel, draftToRows, numOrNull,
  SODIUM_FLOOR_MG, SODIUM_CEILING_MG,
} from '../lib/domain.js';
import { t, useLang, getLang, locale } from '../lib/i18n.js';
import Sheet from './Sheet.jsx';
import ConfirmSheet from './ConfirmSheet.jsx';

// Step-by-step wizard to configure a targets phase (7 dow rows) + special
// dates (overrides). Reuses draftToRows/domain.js: it produces EXACTLY the
// same rows as the Targets editor. It does not configure adherence margins
// (those are derived from `goal` in classifyBullseye) — it only explains them.

const STEP_COUNT = 8; // 0..7

// dow 0=Sunday (column contract). Visual order Mon→Sun.
const VISUAL_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_SHORT_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const DOW_SHORT_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dowShort = (d) => (getLang() === 'en' ? DOW_SHORT_EN : DOW_SHORT_ES)[d];

// Colors for the 3 day types: existing data tokens (theme-aware), used only
// as a visual differentiator within the wizard (they are not persisted).
const GROUP_COLORS = ['var(--d-prot)', 'var(--d-carb)', 'var(--d-fat)'];

// Water/electrolytes prefilled per regime (editable). Reference values, not dogma.
const ELECTRO_DEFAULTS = {
  deficit: { agua_ml: 3500, potasio_mg: 3200, magnesio_mg: 350 },
  volumen: { agua_ml: 3200, potasio_mg: 3000, magnesio_mg: 350 },
  _: { agua_ml: 3000, potasio_mg: 3000, magnesio_mg: 350 },
};
const electroFor = (goal) => ELECTRO_DEFAULTS[goal] || ELECTRO_DEFAULTS._;

// Regime nuance on the margins (classifyBullseye adjusts them automatically).
const goalNuance = (goal) =>
  goal === 'deficit'
    ? t('En déficit tolera menos el exceso de calorías.')
    : goal === 'volumen'
      ? t('En volumen tolera menos el defecto de calorías.')
      : t('Bandas simétricas alrededor de tu objetivo.');

function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
}

export default function TargetsWizard({ onClose }) {
  useLang();
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Existing phases and overrides (for the step 0 summary and to detect overwrites).
  const [existing, setExisting] = useState({ phases: [], vfs: new Set(), days: new Set() });

  // Step 1
  const [goal, setGoal] = useState('');
  const [label, setLabel] = useState('');
  const [validFrom, setValidFrom] = useState(todayISO());
  const [description, setDescription] = useState('');

  // Step 2: each dow → group index 0..2 (all start at 0).
  const [dayGroup, setDayGroup] = useState(() => ({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }));
  const [groupNames, setGroupNames] = useState(() => [t('Entreno'), t('Entreno largo'), t('Descanso')]);

  // Step 3
  const [groupValues, setGroupValues] = useState(() => ({
    0: { kcal: '', protein_g: '', carbs_g: '', fat_g: '' },
    1: { kcal: '', protein_g: '', carbs_g: '', fat_g: '' },
    2: { kcal: '', protein_g: '', carbs_g: '', fat_g: '' },
  }));

  // Steps 4 and 5 (micros applied to ALL day types)
  const [electro, setElectro] = useState(() => ({ ...electroFor('') }));
  const [ceilings, setCeilings] = useState({ grasa_sat_g: '', azucar_anadido_g: '', alcohol_g: '' });

  // Step 6: overrides
  const [overrides, setOverrides] = useState([]); // { day, label, kcal, protein_g, carbs_g, fat_g }

  // Carga inicial de fases/overrides existentes.
  useEffect(() => {
    let alive = true;
    supabase.from('targets').select('*').then(({ data }) => {
      if (!alive) return;
      const rows = data || [];
      const dowRows = rows.filter((r) => r.dow != null);
      const vfs = [...new Set(dowRows.map((r) => r.valid_from))].sort();
      const phases = vfs.map((vf) => ({
        vf,
        label: dowRows.find((r) => r.valid_from === vf && r.label)?.label || '',
        goal: dowRows.find((r) => r.valid_from === vf && r.goal)?.goal || null,
      }));
      setExisting({ phases, vfs: new Set(vfs), days: new Set(rows.filter((r) => r.day != null).map((r) => r.day)) });
    });
    return () => { alive = false; };
  }, []);

  // Prefill water/electrolytes when a regime is chosen (overwrites: the regime sets the default).
  useEffect(() => { setElectro({ ...electroFor(goal) }); }, [goal]);

  const daysInGroup = (gi) => VISUAL_ORDER.filter((d) => dayGroup[d] === gi);
  const activeGroupIdxs = useMemo(
    () => [0, 1, 2].filter((gi) => VISUAL_ORDER.some((d) => dayGroup[d] === gi)),
    [dayGroup]
  );

  const today = todayISO();
  const vigenteVf = useMemo(
    () => [...existing.vfs].filter((vf) => vf <= today).sort().pop() || null,
    [existing.vfs, today]
  );

  // Final rows (memoized to reuse them in the summary and on save).
  const microsRaw = { ...electro, ...ceilings }; // strings; cleanMicros drops empties and coerces to numbers
  const groups = activeGroupIdxs.map((gi) => ({
    dows: daysInGroup(gi),
    values: { ...groupValues[gi], micros: microsRaw },
  }));
  const overridePayloads = overrides
    .filter((o) => o.day)
    .map((o) => ({
      day: o.day,
      label: (o.label || '').trim() || null,
      kcal: numOrNull(o.kcal),
      protein_g: numOrNull(o.protein_g),
      carbs_g: numOrNull(o.carbs_g),
      fat_g: numOrNull(o.fat_g),
      micros: {},
    }));

  const overrideConflicts = overridePayloads.filter((o) => existing.days.has(o.day));
  const phaseConflict = existing.vfs.has(validFrom);
  const needsConfirm = phaseConflict || overrideConflicts.length > 0;

  // Minimal validation to advance.
  const canNext = () => {
    if (step === 1) return !!validFrom;
    if (step === 3) return activeGroupIdxs.every((gi) => Number(groupValues[gi].kcal) > 0);
    return true;
  };

  const next = () => {
    if (!canNext()) {
      setError(step === 3 ? t('Cada tipo de día necesita kcal mayores a 0.') : t('Elige una fecha de inicio válida.'));
      return;
    }
    setError('');
    setStep((s) => Math.min(STEP_COUNT - 1, s + 1));
  };
  const back = () => { setError(''); setStep((s) => Math.max(0, s - 1)); };

  const setGV = (gi, key, val) =>
    setGroupValues((gvs) => ({ ...gvs, [gi]: { ...gvs[gi], [key]: val } }));

  async function doSave() {
    setConfirmOpen(false);
    setBusy(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const owner = session?.user?.id;
    if (!owner) { setError(t('No se pudo guardar.')); setBusy(false); return; }

    const rows = draftToRows(groups, { validFrom, label, description, goal, owner });
    const phaseErr = phaseConflict
      ? (await supabase.from('targets').upsert(rows, { onConflict: 'owner,dow,valid_from' })).error
      : (await supabase.from('targets').insert(rows)).error;
    if (phaseErr) { setError(t('No se pudo guardar la fase.')); setBusy(false); return; }

    const newOvs = overridePayloads.filter((o) => !existing.days.has(o.day)).map((o) => ({ owner, ...o }));
    const dupOvs = overridePayloads.filter((o) => existing.days.has(o.day)).map((o) => ({ owner, ...o }));
    if (newOvs.length) {
      const { error: e } = await supabase.from('targets').insert(newOvs);
      if (e) { setError(t('No se pudo guardar.')); setBusy(false); return; }
    }
    if (dupOvs.length) {
      const { error: e } = await supabase.from('targets').upsert(dupOvs, { onConflict: 'owner,day' });
      if (e) { setError(t('No se pudo guardar.')); setBusy(false); return; }
    }
    setBusy(false);
    setSaved(true);
  }

  const onSaveClick = () => (needsConfirm ? setConfirmOpen(true) : doSave());

  // ---- Per-step footer ----
  const footer = saved ? (
    <button onClick={onClose} className="w-full min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press">
      {t('Cerrar')}
    </button>
  ) : (
    <div className="flex gap-2">
      <button
        onClick={step === 0 ? onClose : back}
        className="min-h-[46px] px-4 rounded-xl border border-border text-text-2 press"
      >
        {step === 0 ? t('Cancelar') : t('Atrás')}
      </button>
      {step < STEP_COUNT - 1 ? (
        <button onClick={next} className="flex-1 min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press">
          {step === 0 ? t('Comenzar') : t('Siguiente')}
        </button>
      ) : (
        <button
          onClick={onSaveClick}
          disabled={busy}
          className="flex-1 min-h-[46px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60"
        >
          {busy ? t('Guardando…') : t('Guardar configuración')}
        </button>
      )}
    </div>
  );

  return (
    <Sheet title={t('Asistente de metas')} onClose={onClose} footer={footer}>
      {!saved && <StepDots step={step} />}

      {saved ? (
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <span className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--ok) 18%, transparent)' }}>
            <Check size={28} className="text-ok" />
          </span>
          <h3 className="font-display text-[19px]">{t('Configuración guardada')}</h3>
          <p className="text-sm text-text-2" style={{ margin: 0 }}>{t('Tu fase y fechas especiales ya están en Metas.')}</p>
        </div>
      ) : (
        <>
          {step === 0 && <StepIntro phases={existing.phases} vigenteVf={vigenteVf} />}
          {step === 1 && (
            <StepRegime
              goal={goal} setGoal={setGoal}
              label={label} setLabel={setLabel}
              validFrom={validFrom} setValidFrom={setValidFrom}
              description={description} setDescription={setDescription}
            />
          )}
          {step === 2 && (
            <StepPattern
              dayGroup={dayGroup} setDayGroup={setDayGroup}
              groupNames={groupNames} setGroupNames={setGroupNames}
              activeGroupIdxs={activeGroupIdxs}
            />
          )}
          {step === 3 && (
            <StepMacros
              activeGroupIdxs={activeGroupIdxs} daysInGroup={daysInGroup}
              groupNames={groupNames} groupValues={groupValues} setGV={setGV}
            />
          )}
          {step === 4 && <StepWater electro={electro} setElectro={setElectro} />}
          {step === 5 && <StepCeilings ceilings={ceilings} setCeilings={setCeilings} />}
          {step === 6 && <StepSpecialDates overrides={overrides} setOverrides={setOverrides} />}
          {step === 7 && (
            <StepSummary
              label={label} goal={goal} validFrom={validFrom} description={description}
              activeGroupIdxs={activeGroupIdxs} daysInGroup={daysInGroup}
              groupNames={groupNames} groupValues={groupValues}
              electro={electro} ceilings={ceilings} overridePayloads={overridePayloads}
              phaseConflict={phaseConflict}
            />
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </>
      )}

      {confirmOpen && (
        <ConfirmSheet
          title={t('¿Sobrescribir lo existente?')}
          body={[
            phaseConflict ? t('Ya hay una fase que aplica desde el %n; se reemplazará.').replace('%n', fmtDate(validFrom)) : '',
            overrideConflicts.length ? t('%n fecha(s) especial(es) ya existen y se reemplazarán.').replace('%n', overrideConflicts.length) : '',
          ].filter(Boolean).join(' ')}
          confirmLabel={t('Sobrescribir y guardar')}
          danger={false}
          onConfirm={doSave}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </Sheet>
  );
}

// ===== Indicador de progreso =====
function StepDots({ step }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: STEP_COUNT }).map((_, i) => (
        <span
          key={i}
          className="h-1 flex-1 rounded-full"
          style={{ background: i <= step ? 'var(--accent)' : 'var(--surface-3)' }}
        />
      ))}
    </div>
  );
}

// ===== Step 0: intro + existing phases =====
function StepIntro({ phases, vigenteVf }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-[18px]">{t('Configura tus metas paso a paso')}</h3>
      <p className="text-sm text-text-2" style={{ margin: 0 }}>
        {t('Te guiaré para crear una fase: régimen, patrón semanal (entreno / descanso), kcal y macros por tipo de día, agua y electrolitos, y fechas especiales.')}
      </p>
      {phases.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{t('Fases existentes')}</p>
          {phases.map((p) => (
            <div key={p.vf} className="rounded-xl bg-surface-2 border border-border px-3 py-2 flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium truncate">{p.label || t('Sin nombre')}</span>
                <span className="block font-mono text-[11px] text-text-3 mt-0.5">{fmtDate(p.vf)}</span>
              </span>
              <span className="shrink-0 flex items-center gap-1.5">
                {p.goal && <Badge text={t(goalLabel(p.goal))} />}
                <Badge text={p.vf <= vigenteVf ? t('vigente') : t('programada')} tone={p.vf <= vigenteVf ? 'ok' : 'accent'} />
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[12px] text-text-3" style={{ margin: 0 }}>
        {t('Escribir una fase en una fecha ya ocupada la sobrescribe.')}
      </p>
    </div>
  );
}

// ===== Step 1: regime and dates =====
function StepRegime({ goal, setGoal, label, setLabel, validFrom, setValidFrom, description, setDescription }) {
  const chips = [{ key: '', label: 'Sin régimen' }, ...PHASE_GOALS];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{t('Régimen')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const on = goal === c.key;
            return (
              <button
                key={c.key || 'none'}
                onClick={() => setGoal(c.key)}
                className={`min-h-[44px] px-3.5 rounded-full text-[13px] font-medium press border ${on ? 'bg-accent-deep text-on-accent border-transparent' : 'border-border text-text-2'}`}
                aria-pressed={on}
              >
                {t(c.label)}
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-text-3" style={{ margin: 0 }}>
          {t('Tus márgenes de cumplimiento se ajustan solos a este régimen.')} {goalNuance(goal)}
        </p>
      </div>
      <Field label={t('Nombre de fase')}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('p. ej. Bulk único')} className="input placeholder:text-text-3" />
      </Field>
      <Field label={t('Aplica desde')}>
        <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="input" />
      </Field>
      <Field label={t('Descripción')}>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Objetivo de la fase')} className="input placeholder:text-text-3" />
      </Field>
    </div>
  );
}

// ===== Step 2: weekly pattern =====
function StepPattern({ dayGroup, setDayGroup, groupNames, setGroupNames, activeGroupIdxs }) {
  const cycle = (d) => setDayGroup((dg) => ({ ...dg, [d]: (dg[d] + 1) % 3 }));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-2" style={{ margin: 0 }}>
        {t('Toca cada día para asignarlo a un tipo. Un tipo sin días se descarta.')}
      </p>
      <div className="grid grid-cols-7 gap-1.5">
        {VISUAL_ORDER.map((d) => {
          const gi = dayGroup[d];
          return (
            <button
              key={d}
              onClick={() => cycle(d)}
              className="min-h-[52px] rounded-xl border border-border flex flex-col items-center justify-center gap-1 press"
              aria-label={dowShort(d)}
            >
              <span className="text-[11px] font-mono text-text-2">{dowShort(d)}</span>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: GROUP_COLORS[gi] }} />
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <Label>{t('Tipos de día')}</Label>
        {[0, 1, 2].map((gi) => {
          const count = VISUAL_ORDER.filter((d) => dayGroup[d] === gi).length;
          return (
            <div key={gi} className={`flex items-center gap-2 ${activeGroupIdxs.includes(gi) ? '' : 'opacity-45'}`}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: GROUP_COLORS[gi] }} />
              <input
                value={groupNames[gi]}
                onChange={(e) => setGroupNames((n) => n.map((x, i) => (i === gi ? e.target.value : x)))}
                className="input flex-1"
                aria-label={t('Nombre del tipo de día')}
              />
              <span className="text-[11px] font-mono text-text-3 w-16 text-right shrink-0">
                {count} {count === 1 ? t('día') : t('días')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Step 3: kcal and macros per day type =====
function StepMacros({ activeGroupIdxs, daysInGroup, groupNames, groupValues, setGV }) {
  return (
    <div className="flex flex-col gap-3">
      {activeGroupIdxs.map((gi) => (
        <div key={gi} className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: GROUP_COLORS[gi] }} />
            <span className="text-[13.5px] font-medium truncate">{groupNames[gi] || t('Tipo de día')}</span>
            <span className="text-[11px] font-mono text-text-3 ml-auto">
              {daysInGroup(gi).map(dowShort).join(' ')}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <NumField label={t('Kcal')} value={groupValues[gi].kcal} onChange={(v) => setGV(gi, 'kcal', v)} />
            <NumField label={t('Prot')} value={groupValues[gi].protein_g} onChange={(v) => setGV(gi, 'protein_g', v)} />
            <NumField label={t('Carbs')} value={groupValues[gi].carbs_g} onChange={(v) => setGV(gi, 'carbs_g', v)} />
            <NumField label={t('Grasa')} value={groupValues[gi].fat_g} onChange={(v) => setGV(gi, 'fat_g', v)} />
          </div>
        </div>
      ))}
      <p className="text-[12px] text-text-3" style={{ margin: 0 }}>
        {t('Referencia de proteína: 1.6–2.7 g por kg de peso corporal.')}
      </p>
    </div>
  );
}

// ===== Step 4: water and electrolytes =====
function StepWater({ electro, setElectro }) {
  const set = (k, v) => setElectro((e) => ({ ...e, [k]: v }));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-2" style={{ margin: 0 }}>
        {t('Se aplican a todos los tipos de día. Valores de referencia — ajústalos a tu plan.')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <NumField label={t('Agua (ml)')} value={electro.agua_ml} onChange={(v) => set('agua_ml', v)} />
        <NumField label={t('Potasio (mg)')} value={electro.potasio_mg} onChange={(v) => set('potasio_mg', v)} />
        <NumField label={t('Magnesio (mg)')} value={electro.magnesio_mg} onChange={(v) => set('magnesio_mg', v)} />
      </div>
      <p className="text-[12px] text-text-3" style={{ margin: 0 }}>
        {t('Sodio: piso médico %f mg y techo %c mg, fijos en la app.')
          .replace('%f', SODIUM_FLOOR_MG.toLocaleString(locale()))
          .replace('%c', SODIUM_CEILING_MG.toLocaleString(locale()))}
      </p>
    </div>
  );
}

// ===== Step 5: optional ceilings =====
function StepCeilings({ ceilings, setCeilings }) {
  const set = (k, v) => setCeilings((c) => ({ ...c, [k]: v }));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-2" style={{ margin: 0 }}>
        {t('Máximos a no rebasar. Opcionales: déjalos vacíos si no los usas.')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <NumField label={t('Grasa sat. (g)')} value={ceilings.grasa_sat_g} onChange={(v) => set('grasa_sat_g', v)} />
        <NumField label={t('Az. añadido (g)')} value={ceilings.azucar_anadido_g} onChange={(v) => set('azucar_anadido_g', v)} />
        <NumField label={t('Alcohol (g)')} value={ceilings.alcohol_g} onChange={(v) => set('alcohol_g', v)} />
      </div>
      <button
        onClick={() => setCeilings({ grasa_sat_g: '', azucar_anadido_g: '', alcohol_g: '' })}
        className="self-start text-[13px] text-accent min-h-[44px] press"
      >
        {t('Omitir (dejar sin techos)')}
      </button>
    </div>
  );
}

// ===== Step 6: special dates =====
function StepSpecialDates({ overrides, setOverrides }) {
  const today = todayISO();
  const add = () => setOverrides((o) => [...o, { day: today, label: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '' }]);
  const remove = (i) => setOverrides((o) => o.filter((_, j) => j !== i));
  const set = (i, k, v) => setOverrides((o) => o.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-2" style={{ margin: 0 }}>
        {t('Días que sustituyen a la fase (cumpleaños, día pico…). Opcional.')}
      </p>
      {overrides.map((o, i) => (
        <div key={i} className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input type="date" value={o.day} onChange={(e) => set(i, 'day', e.target.value)} className="input flex-1" />
            <button onClick={() => remove(i)} className="min-h-[44px] px-3 rounded-lg border border-border text-text-2 press" aria-label={t('Quitar')}>✕</button>
          </div>
          <input value={o.label} onChange={(e) => set(i, 'label', e.target.value)} placeholder={t('p. ej. Cumpleaños')} className="input placeholder:text-text-3" />
          <div className="grid grid-cols-4 gap-2">
            <NumField label={t('Kcal')} value={o.kcal} onChange={(v) => set(i, 'kcal', v)} />
            <NumField label={t('Prot')} value={o.protein_g} onChange={(v) => set(i, 'protein_g', v)} />
            <NumField label={t('Carbs')} value={o.carbs_g} onChange={(v) => set(i, 'carbs_g', v)} />
            <NumField label={t('Grasa')} value={o.fat_g} onChange={(v) => set(i, 'fat_g', v)} />
          </div>
        </div>
      ))}
      <button onClick={add} className="self-start min-h-[44px] px-4 rounded-xl border border-border text-accent text-[13px] press">
        + {t('Añadir fecha especial')}
      </button>
    </div>
  );
}

// ===== Step 7: summary =====
function StepSummary({ label, goal, validFrom, description, activeGroupIdxs, daysInGroup, groupNames, groupValues, electro, ceilings, overridePayloads, phaseConflict }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-surface-2 border border-border p-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-[16px]">{label || t('Sin nombre')}</span>
          {goal && <Badge text={t(goalLabel(goal))} />}
        </div>
        <span className="font-mono text-[11.5px] text-text-3">{t('Aplica desde')} {fmtDate(validFrom)}</span>
        {description && <span className="text-[12px] text-text-2">{description}</span>}
        {phaseConflict && <span className="text-[12px] text-warn">{t('Sobrescribe la fase existente de esa fecha.')}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t('Tipos de día')}</Label>
        {activeGroupIdxs.map((gi) => (
          <div key={gi} className="rounded-xl bg-surface-2 border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: GROUP_COLORS[gi] }} />
              <span className="text-[13px] font-medium truncate">{groupNames[gi] || t('Tipo de día')}</span>
              <span className="text-[11px] font-mono text-text-3 ml-auto">{daysInGroup(gi).map(dowShort).join(' ')}</span>
            </div>
            <p className="font-mono text-[11.5px] text-text-2 mt-1" style={{ margin: '4px 0 0' }}>
              {groupValues[gi].kcal || '–'} kcal · P {groupValues[gi].protein_g || '–'} · C {groupValues[gi].carbs_g || '–'} · G {groupValues[gi].fat_g || '–'}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-surface-2 border border-border px-3 py-2">
        <Label>{t('Agua y electrolitos')}</Label>
        <p className="font-mono text-[11.5px] text-text-2 mt-1" style={{ margin: '4px 0 0' }}>
          {t('Agua')} {electro.agua_ml || '–'} ml · K {electro.potasio_mg || '–'} mg · Mg {electro.magnesio_mg || '–'} mg
        </p>
        {(ceilings.grasa_sat_g || ceilings.azucar_anadido_g || ceilings.alcohol_g) && (
          <p className="font-mono text-[11.5px] text-text-3" style={{ margin: '4px 0 0' }}>
            {t('Techos')}: {[
              ceilings.grasa_sat_g && `${t('Grasa sat.')} ${ceilings.grasa_sat_g} g`,
              ceilings.azucar_anadido_g && `${t('Az. añadido')} ${ceilings.azucar_anadido_g} g`,
              ceilings.alcohol_g && `${t('Alcohol')} ${ceilings.alcohol_g} g`,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {overridePayloads.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>{t('Fechas especiales')} ({overridePayloads.length})</Label>
          {overridePayloads.map((o, i) => (
            <div key={i} className="rounded-xl bg-surface-2 border border-border px-3 py-2 flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium truncate">{o.label || t('Sin motivo')}</span>
                <span className="block font-mono text-[11px] text-text-3">{fmtDate(o.day)}</span>
              </span>
              <span className="font-mono text-[12px] text-text-2 shrink-0">{o.kcal == null ? '–' : o.kcal} kcal</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Átomos =====
function Label({ children }) {
  return <span className="text-[11px] uppercase tracking-wide text-text-3 font-medium">{children}</span>;
}
function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
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
function Badge({ text, tone }) {
  const cls = tone === 'ok' ? 'text-ok' : tone === 'accent' ? 'text-accent' : 'text-text-2';
  return <span className={`px-2 py-0.5 rounded-full bg-surface-3 text-[10.5px] whitespace-nowrap ${cls}`}>{text}</span>;
}
