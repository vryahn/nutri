import { useEffect, useRef, useState } from 'react';
import { History, ChevronLeft, ChevronDown, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { MICROS, PHASE_GOALS, goalLabel, todayISO, addDaysISO, resolveTarget } from '../lib/domain.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';

// ===== Helpers puros (agrupación §2.1, fechas §5) =====
// dow 0=domingo (contrato de la columna). Orden visual de despliegue Lun→Dom.
const DOW_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const VISUAL_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Tailwind v3 no genera clases de opacidad sobre tokens var() (bg-x/20 = no-op),
// así que los tintes con alfa van por color-mix inline.
const tint = (token, pct) => `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;

let _uid = 0;
const uid = () => `g${++_uid}`;

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

function cleanMicros(m) {
  const out = {};
  for (const k of Object.keys(m || {}).sort()) {
    const v = m[k];
    if (v === '' || v == null) continue;
    out[k] = Number(v);
  }
  return out;
}

// Firma de un día por igualdad profunda de {kcal, macros, micros} para agrupar.
function rowSig(r) {
  return JSON.stringify({
    kcal: numOrNull(r?.kcal),
    protein_g: numOrNull(r?.protein_g),
    carbs_g: numOrNull(r?.carbs_g),
    fat_g: numOrNull(r?.fat_g),
    micros: cleanMicros(r?.micros),
  });
}

// week: filas indexadas por dow 0..6 (o null). Agrupa recorriendo en orden
// visual Lun→Dom, así cada grupo trae `dows` ya ordenado para los chips.
function groupWeek(week) {
  const groups = [];
  for (const dow of VISUAL_ORDER) {
    const sig = rowSig(week[dow]);
    let g = groups.find((x) => x.sig === sig);
    if (!g) {
      g = { sig, dows: [], values: week[dow] };
      groups.push(g);
    }
    g.dows.push(dow);
  }
  return groups;
}

// Chips de un grupo: rango contiguo en orden visual → un chip «LUN – VIE»;
// si no, chips individuales. Sábado→Domingo es contiguo (VISUAL_ORDER acaba en 0).
function chipLabels(dows) {
  const idxs = dows.map((d) => VISUAL_ORDER.indexOf(d)).sort((a, b) => a - b);
  const contiguous = idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1);
  if (dows.length >= 2 && contiguous) {
    return [`${DOW_SHORT[VISUAL_ORDER[idxs[0]]]} – ${DOW_SHORT[VISUAL_ORDER[idxs[idxs.length - 1]]]}`];
  }
  return dows.map((d) => DOW_SHORT[d]);
}

function daysBetween(aIso, bIso) {
  return Math.round((new Date(bIso + 'T00:00:00') - new Date(aIso + 'T00:00:00')) / 86400000);
}

// «12 may» / «1 oct 2026» (año solo si difiere del actual). Date con T00:00:00
// para evitar el desfase UTC (patrón de weekdayOf).
function fmtShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  const s = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace(/\./g, '');
  const y = d.getFullYear();
  return y === new Date().getFullYear() ? s : `${s} ${y}`;
}

// «Mié 8 jul» para las cards de override.
function fmtDow(iso) {
  const d = new Date(iso + 'T00:00:00');
  let wd = d.toLocaleDateString('es-MX', { weekday: 'short' }).replace(/\./g, '');
  wd = wd.charAt(0).toUpperCase() + wd.slice(1);
  return `${wd} ${fmtShort(iso)}`;
}

// «Miércoles 8 de julio» (+ « de AAAA» si no es el año actual) para el meta del override.
function fmtFull(iso) {
  const d = new Date(iso + 'T00:00:00');
  let s = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  if (d.getFullYear() !== new Date().getFullYear()) s += ` de ${d.getFullYear()}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const relDaysLabel = (n) =>
  n === 0 ? 'hoy' : n > 0 ? `en ${n} ${n === 1 ? 'día' : 'días'}` : `hace ${-n} ${-n === 1 ? 'día' : 'días'}`;

// Valores de una fila DB → objeto editable (null → '' para los inputs).
function valuesOf(row) {
  return {
    kcal: row?.kcal ?? '',
    protein_g: row?.protein_g ?? '',
    carbs_g: row?.carbs_g ?? '',
    fat_g: row?.fat_g ?? '',
    micros: { ...(row?.micros || {}) },
  };
}

function draftFromWeek(week) {
  return groupWeek(week).map((g) => ({ id: uid(), dows: [...g.dows], values: valuesOf(g.values) }));
}

function emptyWeekGroups() {
  return [{ id: uid(), dows: [...VISUAL_ORDER], values: valuesOf(null) }];
}

function sortGroups(groups) {
  const key = (g) => Math.min(...g.dows.map((d) => VISUAL_ORDER.indexOf(d)));
  return [...groups].sort((a, b) => key(a) - key(b));
}

// Expande los grupos del draft a las 7 filas dow (§7.2d: siempre 7).
function draftToRows(groups, { validFrom, label, description, goal, owner }) {
  const byDow = {};
  for (const g of groups) {
    const row = {
      kcal: numOrNull(g.values.kcal),
      protein_g: numOrNull(g.values.protein_g),
      carbs_g: numOrNull(g.values.carbs_g),
      fat_g: numOrNull(g.values.fat_g),
      micros: cleanMicros(g.values.micros),
    };
    for (const dow of g.dows) byDow[dow] = row;
  }
  const rows = [];
  for (let dow = 0; dow < 7; dow++) {
    rows.push({
      owner,
      dow,
      valid_from: validFrom,
      label: label.trim() || null,
      description: description.trim() || null,
      goal: goal || null,
      ...(byDow[dow] || { kcal: null, protein_g: null, carbs_g: null, fat_g: null, micros: {} }),
    });
  }
  return rows;
}

function friendly(error, dupMsg) {
  if (!error) return null;
  if (error.code === '23505') return dupMsg;
  return error.message || 'No se pudo guardar.';
}

// lg+ cambia sheet→edición/alta inline (§A.2, §A.3 de la propuesta desktop).
function useLgUp() {
  const [lg, setLg] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e) => setLg(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return lg;
}

// ===== Página =====
export default function Targets() {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [sheet, setSheet] = useState(null); // unión discriminada por .type
  const [vigVer, setVigVer] = useState(0); // fuerza remontar la card vigente a lectura tras guardar
  const lgUp = useLgUp();
  const [expandedVf, setExpandedVf] = useState(null); // fase programada en edición inline (lg+)
  const [expandedOverrideId, setExpandedOverrideId] = useState(null); // override en edición inline (lg+)
  const [newOverrideInline, setNewOverrideInline] = useState(false); // alta de override inline (lg+)
  const programadaRowRefs = useRef(new Map());
  const overrideRowRefs = useRef(new Map());
  const newOverrideBtnRef = useRef(null);

  useEffect(() => {
    load();
  }, []);

  function collapseProgramada(vf) {
    setExpandedVf(null);
    requestAnimationFrame(() => programadaRowRefs.current.get(vf)?.focus());
  }
  function collapseOverride(id) {
    setExpandedOverrideId(null);
    requestAnimationFrame(() => overrideRowRefs.current.get(id)?.focus());
  }
  function collapseNewOverride() {
    setNewOverrideInline(false);
    requestAnimationFrame(() => newOverrideBtnRef.current?.focus());
  }

  // Esc colapsa la edición/alta inline (lg+) sin guardar; foco vuelve a la fila.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (expandedVf) collapseProgramada(expandedVf);
      else if (expandedOverrideId) collapseOverride(expandedOverrideId);
      else if (newOverrideInline) collapseNewOverride();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedVf, expandedOverrideId, newOverrideInline]);

  async function load() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    setUserId(session?.user?.id || null);
    const { data } = await supabase.from('targets').select('*');
    setTargets(data || []);
    setLoading(false);
  }

  const today = todayISO();
  const phaseRows = targets.filter((t) => t.dow != null);
  const overrides = targets.filter((t) => t.day != null).sort((a, b) => (a.day < b.day ? -1 : 1));
  const phaseVfs = [...new Set(phaseRows.map((t) => t.valid_from))].sort();
  const vigenteVf = [...phaseVfs].reverse().find((vf) => vf <= today) || null;
  const programadaVfs = phaseVfs.filter((vf) => vf > today);
  const previaVfs = vigenteVf ? phaseVfs.filter((vf) => vf < vigenteVf) : [];
  const nextVfOf = (vf) => phaseVfs.find((x) => x > vf) || null;

  const weekOf = (vf) => {
    const w = Array(7).fill(null);
    for (const t of phaseRows) if (t.valid_from === vf) w[t.dow] = t;
    return w;
  };
  const labelOf = (vf) => phaseRows.find((t) => t.valid_from === vf && t.label)?.label || '';
  const descOf = (vf) => phaseRows.find((t) => t.valid_from === vf && t.description)?.description || '';
  const goalOf = (vf) => phaseRows.find((t) => t.valid_from === vf && t.goal)?.goal || '';
  const faseFor = (day) => resolveTarget(phaseRows, day); // resolución sobre fase (excluye overrides)

  // ---- persistencia ----
  function afterVigenteSave() {
    setSheet(null);
    setVigVer((v) => v + 1);
    load();
  }

  async function corregirFase(draft) {
    const rows = draftToRows(draft.groups, { validFrom: vigenteVf, label: draft.label, description: draft.description, goal: draft.goal, owner: userId });
    const { error } = await supabase.from('targets').upsert(rows, { onConflict: 'owner,dow,valid_from' });
    if (error) return friendly(error, 'No se pudo corregir la fase.');
    afterVigenteSave();
    return null;
  }
  async function nuevaFaseDesdeHoy(draft) {
    const rows = draftToRows(draft.groups, { validFrom: today, label: draft.label, description: draft.description, goal: draft.goal, owner: userId });
    const { error } = await supabase.from('targets').insert(rows);
    if (error) return friendly(error, 'Ya existe una fase que aplica desde hoy.');
    afterVigenteSave();
    return null;
  }
  async function saveNewPhase(draft) {
    if (phaseVfs.includes(draft.validFrom)) return 'Ya existe una fase que aplica desde esa fecha.';
    const rows = draftToRows(draft.groups, { validFrom: draft.validFrom, label: draft.label, description: draft.description, goal: draft.goal, owner: userId });
    const { error } = await supabase.from('targets').insert(rows);
    if (error) return friendly(error, 'Ya existe una fase que aplica desde esa fecha.');
    setSheet(null);
    load();
    return null;
  }
  async function saveProgramada(oldVf, draft) {
    const newVf = draft.validFrom;
    if (newVf !== oldVf && phaseVfs.includes(newVf)) return 'Ya existe una fase que aplica desde esa fecha.';
    if (newVf !== oldVf) await supabase.from('targets').delete().eq('valid_from', oldVf).not('dow', 'is', null);
    const rows = draftToRows(draft.groups, { validFrom: newVf, label: draft.label, description: draft.description, goal: draft.goal, owner: userId });
    const { error } = await supabase.from('targets').upsert(rows, { onConflict: 'owner,dow,valid_from' });
    if (error) return friendly(error, 'No se pudo guardar la fase.');
    setSheet(null);
    load();
    return null;
  }
  // Única edición posible sobre una fase previa: su meta. Los valores no se
  // tocan (reescribirlos recalcularía la adherencia histórica), pero sin esto
  // el histórico nunca podría filtrarse por régimen en el Dashboard.
  async function saveGoal(vf, goal) {
    await supabase.from('targets').update({ goal: goal || null }).eq('valid_from', vf).not('dow', 'is', null);
    load();
  }
  async function deletePhase(vf) {
    await supabase.from('targets').delete().eq('valid_from', vf).not('dow', 'is', null);
    setSheet(null);
    load();
  }
  async function saveOverride(draft, id) {
    const payload = {
      day: draft.day,
      label: draft.label.trim() || null,
      kcal: numOrNull(draft.values.kcal),
      protein_g: numOrNull(draft.values.protein_g),
      carbs_g: numOrNull(draft.values.carbs_g),
      fat_g: numOrNull(draft.values.fat_g),
      micros: cleanMicros(draft.values.micros),
    };
    const { error } = id
      ? await supabase.from('targets').update(payload).eq('id', id)
      : await supabase.from('targets').insert({ owner: userId, ...payload });
    if (error) return friendly(error, 'Ya existe una fecha específica para ese día.');
    setSheet(null);
    load();
    return null;
  }
  async function deleteOverride(id) {
    setTargets((ts) => ts.filter((t) => t.id !== id)); // optimista, sin confirmación (§2.3)
    const { error } = await supabase.from('targets').delete().eq('id', id);
    if (error) load();
  }

  if (loading) return <div className="px-4 py-4 text-text-2">Cargando…</div>;

  return (
    <div className="px-4 py-4 flex flex-col gap-6">
      <h1 className="font-display text-xl">Objetivos</h1>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6 lg:items-start">
        <div className="flex flex-col gap-6">
          {/* Fase vigente (hero) */}
          {vigenteVf ? (
            <PhaseCard
              key={`vig-${vigenteVf}-${vigVer}`}
              variant="vigente"
              validFrom={vigenteVf}
              label={labelOf(vigenteVf)}
              description={descOf(vigenteVf)}
              goal={goalOf(vigenteVf)}
              week={weekOf(vigenteVf)}
              nextVf={nextVfOf(vigenteVf)}
              onSave={(draft) => {
                setSheet({ type: 'decision', draft });
                return null; // abre hoja de decisión; no persiste aún
              }}
            />
          ) : (
            <div className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-3">
              <Kicker variant="vigente" />
              <p className="text-text-2 text-sm">Sin fase vigente. Programa una fase para empezar.</p>
              <button
                onClick={() => setSheet({ type: 'newPhase' })}
                className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press"
              >
                Crear fase
              </button>
            </div>
          )}

          {/* Fases programadas */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Fases programadas</h2>
              <button
                onClick={() => setSheet({ type: 'newPhase' })}
                className="text-[13px] text-accent min-h-[44px] px-2 rounded-lg hover:bg-surface-2 press"
              >
                + Programar
              </button>
            </div>

            {programadaVfs.length === 0 ? (
              <p className="text-[13px] text-text-2">Sin fases programadas</p>
            ) : (
              <div className="flex flex-col gap-2">
                {programadaVfs.map((vf) => {
                  const nvf = nextVfOf(vf);
                  const d = daysBetween(today, vf);

                  if (lgUp && expandedVf === vf) {
                    return (
                      <PhaseCard
                        key={vf}
                        variant="programada"
                        validFrom={vf}
                        label={labelOf(vf)}
                        description={descOf(vf)}
                        goal={goalOf(vf)}
                        week={weekOf(vf)}
                        nextVf={nvf}
                        initialEditing
                        forceCollapse
                        onSave={async (draft) => {
                          const err = await saveProgramada(vf, draft);
                          if (!err) collapseProgramada(vf);
                          return err;
                        }}
                        onCancel={() => collapseProgramada(vf)}
                      />
                    );
                  }

                  return (
                    <div key={vf} className="relative group">
                      <SwipeToDelete
                        nodeRef={(node) => {
                          if (node) programadaRowRefs.current.set(vf, node);
                        }}
                        radius="rounded-xl"
                        resetOnDelete
                        onDelete={() => setSheet({ type: 'confirmDeletePhase', vf })}
                        onTap={() => (lgUp ? setExpandedVf(vf) : setSheet({ type: 'phase', vf }))}
                        className="rounded-xl bg-surface border border-border px-3.5 py-3.5"
                      >
                        <p className="font-medium text-sm leading-tight flex items-center gap-1.5" style={{ margin: 0 }}>
                          <span>{labelOf(vf) || 'Sin nombre'}</span>
                          {goalOf(vf) && <Chip text={goalLabel(goalOf(vf))} />}
                        </p>
                        <p className="font-mono text-[11.5px] text-text-3 mt-1" style={{ margin: 0 }}>
                          {fmtShort(vf)} → {nvf ? fmtShort(addDaysISO(nvf, -1)) : 'sin fin'} · en {d} {d === 1 ? 'día' : 'días'}
                        </p>
                      </SwipeToDelete>
                      <div className="hidden lg:group-hover:flex lg:group-focus-within:flex absolute right-3 top-1/2 -translate-y-1/2 gap-1 bg-surface rounded-lg">
                        <button
                          onPointerDown={(ev) => ev.stopPropagation()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSheet({ type: 'confirmDeletePhase', vf });
                          }}
                          className="p-1.5 text-text-2 hover:text-danger"
                          aria-label="Borrar fase"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {previaVfs.length > 0 && (
              <button
                onClick={() => setSheet({ type: 'previas' })}
                className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-border text-text-2 text-[13px] press"
              >
                <History size={15} /> Fases previas ({previaVfs.length})
              </button>
            )}
          </section>
        </div>

        {/* Fechas específicas */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Fechas específicas</h2>
            <button
              ref={newOverrideBtnRef}
              onClick={() => (lgUp ? setNewOverrideInline(true) : setSheet({ type: 'newOverride' }))}
              className="text-[13px] text-accent min-h-[44px] px-2 rounded-lg hover:bg-surface-2 press"
            >
              + Añadir
            </button>
          </div>

          {lgUp && newOverrideInline && (
            <OverrideCard
              variant="newOverride"
              override={null}
              faseFor={faseFor}
              initialEditing
              forceCollapse
              onSave={async (d) => {
                const err = await saveOverride(d, null);
                if (!err) collapseNewOverride();
                return err;
              }}
              onCancel={collapseNewOverride}
            />
          )}

          {overrides.length === 0 ? (
            <p className="text-[13px] text-text-2">Sin fechas específicas aún</p>
          ) : (
            <div className="flex flex-col gap-2">
              {overrides.map((ov) => {
                const fase = faseFor(ov.day);
                const delta = ov.kcal != null && fase?.kcal != null ? Number(ov.kcal) - Number(fase.kcal) : null;

                if (lgUp && expandedOverrideId === ov.id) {
                  return (
                    <OverrideCard
                      key={ov.id}
                      variant="override"
                      override={ov}
                      faseFor={faseFor}
                      initialEditing
                      forceCollapse
                      onSave={async (d) => {
                        const err = await saveOverride(d, ov.id);
                        if (!err) collapseOverride(ov.id);
                        return err;
                      }}
                      onCancel={() => collapseOverride(ov.id)}
                    />
                  );
                }

                return (
                  <div key={ov.id} className="relative group">
                    <SwipeToDelete
                      nodeRef={(node) => {
                        if (node) overrideRowRefs.current.set(ov.id, node);
                      }}
                      radius="rounded-xl"
                      onDelete={() => deleteOverride(ov.id)}
                      onTap={() => (lgUp ? setExpandedOverrideId(ov.id) : setSheet({ type: 'override', id: ov.id }))}
                      className="rounded-xl bg-surface border border-border px-3.5 py-3 flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium leading-tight truncate">
                          {fmtDow(ov.day)}
                          {ov.label ? <span className="text-text-2 font-normal"> · {ov.label}</span> : null}
                        </span>
                        <span className="block font-mono text-[11.5px] text-text-3 mt-0.5">{ov.kcal == null ? '–' : ov.kcal} kcal</span>
                      </span>
                      {delta != null && (
                        <span
                          className="shrink-0 font-mono text-[11px] px-2 py-1 rounded-md"
                          style={{ background: tint('--warn', 14), color: 'var(--warn)' }}
                        >
                          {delta > 0 ? '+' : '−'}
                          {Math.abs(delta)} vs fase
                        </span>
                      )}
                    </SwipeToDelete>
                    <div className="hidden lg:group-hover:flex lg:group-focus-within:flex absolute right-3 top-1/2 -translate-y-1/2 gap-1 bg-surface rounded-lg">
                      <button
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          deleteOverride(ov.id);
                        }}
                        className="p-1.5 text-text-2 hover:text-danger"
                        aria-label="Borrar fecha específica"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ===== Hojas ===== */}
      {sheet?.type === 'phase' && (
        <Sheet onClose={() => setSheet(null)}>
          <PhaseCard
            variant="programada"
            validFrom={sheet.vf}
            label={labelOf(sheet.vf)}
            description={descOf(sheet.vf)}
            goal={goalOf(sheet.vf)}
            week={weekOf(sheet.vf)}
            nextVf={nextVfOf(sheet.vf)}
            onSave={(draft) => saveProgramada(sheet.vf, draft)}
            onCancel={() => setSheet(null)}
          />
        </Sheet>
      )}

      {sheet?.type === 'newPhase' && (
        <Sheet onClose={() => setSheet(null)}>
          <PhaseCard
            variant="new"
            validFrom={addDaysISO(today, 1)}
            label=""
            description=""
            goal=""
            week={null}
            copyWeek={vigenteVf ? weekOf(vigenteVf) : null}
            initialEditing
            onSave={saveNewPhase}
            onCancel={() => setSheet(null)}
          />
        </Sheet>
      )}

      {sheet?.type === 'override' &&
        (() => {
          const ov = overrides.find((o) => o.id === sheet.id);
          if (!ov) return null;
          return (
            <Sheet onClose={() => setSheet(null)}>
              <OverrideCard variant="override" override={ov} faseFor={faseFor} onSave={(d) => saveOverride(d, ov.id)} onCancel={() => setSheet(null)} />
            </Sheet>
          );
        })()}

      {sheet?.type === 'newOverride' && (
        <Sheet onClose={() => setSheet(null)}>
          <OverrideCard variant="newOverride" override={null} faseFor={faseFor} initialEditing onSave={(d) => saveOverride(d, null)} onCancel={() => setSheet(null)} />
        </Sheet>
      )}

      {sheet?.type === 'decision' && (
        <DecisionSheet
          validFrom={vigenteVf}
          onCorregir={() => corregirFase(sheet.draft)}
          onNueva={() => nuevaFaseDesdeHoy(sheet.draft)}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.type === 'confirmDeletePhase' && (
        <ConfirmDeleteSheet name={labelOf(sheet.vf) || 'Sin nombre'} onConfirm={() => deletePhase(sheet.vf)} onClose={() => setSheet(null)} />
      )}

      {sheet?.type === 'previas' && (
        <PreviasSheet
          previaVfs={previaVfs}
          labelOf={labelOf}
          descOf={descOf}
          goalOf={goalOf}
          onGoalChange={saveGoal}
          weekOf={weekOf}
          nextVfOf={nextVfOf}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

// ===== Card de fase (lectura + edición), espejo entre vigente y hojas (§2.1, §3) =====
function PhaseCard({ variant, validFrom, label = '', description = '', goal = '', week, nextVf, copyWeek, initialEditing = false, forceCollapse = false, onSave, onCancel }) {
  const today = todayISO();
  const editable = variant === 'vigente' || variant === 'programada' || variant === 'new';
  const showValidFrom = variant === 'programada' || variant === 'new';
  const [editing, setEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(makeDraft);
  const [expanded, setExpanded] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  function makeDraft() {
    return {
      label: label || '',
      description: description || '',
      goal: goal || '',
      validFrom: validFrom || todayISO(),
      groups: week ? draftFromWeek(week) : emptyWeekGroups(),
    };
  }
  function startEdit() {
    setDraft(makeDraft());
    setExpanded(null);
    setSaveError('');
    setEditing(true);
  }
  function cancel() {
    if (variant === 'new' || forceCollapse) return onCancel?.();
    setEditing(false);
    setSaveError('');
  }
  async function save() {
    setBusy(true);
    const err = await onSave(draft);
    setBusy(false);
    if (err) setSaveError(typeof err === 'string' ? err : 'No se pudo guardar.');
  }

  const setGroups = (fn) => setDraft((d) => ({ ...d, groups: fn(d.groups) }));
  const setField = (gid, key, val) =>
    setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, values: { ...g.values, [key]: val } } : g)));
  const setMicro = (gid, key, val) =>
    setGroups((gs) =>
      gs.map((g) => {
        if (g.id !== gid) return g;
        const micros = { ...g.values.micros };
        if (val === '') delete micros[key];
        else micros[key] = val;
        return { ...g, values: { ...g.values, micros } };
      })
    );
  function splitDay(gid, dow) {
    setGroups((gs) => {
      const src = gs.find((g) => g.id === gid);
      const out = gs.map((g) => (g.id === gid ? { ...g, dows: g.dows.filter((d) => d !== dow) } : g));
      out.push({ id: uid(), dows: [dow], values: { ...src.values, micros: { ...src.values.micros } } });
      return sortGroups(out);
    });
    setExpanded(null);
  }
  const copyVigente = () => copyWeek && setDraft((d) => ({ ...d, groups: draftFromWeek(copyWeek) }));

  const groups = editing ? draft.groups : groupWeek(week || []);

  return (
    <div className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <Kicker variant={variant} />
        {editable && !editing && <EditPill onClick={startEdit} />}
      </div>

      {!editing ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="font-display text-[19px] leading-tight">{label || <span className="text-text-2">Sin nombre</span>}</h2>
            {goal && <Chip text={goalLabel(goal)} />}
          </div>
          {description && (
            <p className="text-[12.5px] text-text-2" style={{ margin: 0 }}>
              {description}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField label="Nombre de fase" value={draft.label} onChange={(v) => setDraft((d) => ({ ...d, label: v }))} placeholder="p. ej. Bulk único" />
          <TextField label="Descripción" value={draft.description} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} placeholder="Objetivo de la fase" />
          <GoalField value={draft.goal} onChange={(v) => setDraft((d) => ({ ...d, goal: v }))} />
          {showValidFrom && <DateField label="Aplica desde" value={draft.validFrom} onChange={(v) => setDraft((d) => ({ ...d, validFrom: v }))} />}
        </div>
      )}

      {!editing && <PhaseMeta variant={variant} validFrom={validFrom} nextVf={nextVf} today={today} />}

      <div className="border-t border-border pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-2">Semana de la fase</span>
          {editing ? (
            variant === 'new' && copyWeek ? (
              <button onClick={copyVigente} className="text-xs text-accent min-h-[44px] press">
                Copiar semana vigente
              </button>
            ) : null
          ) : (
            <span className="text-[11px] text-text-3">
              {groups.length} {groups.length === 1 ? 'tipo de día' : 'tipos de día'}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {!editing
            ? groups.map((g, i) => <GroupReadBlock key={i} values={g.values || {}} dows={g.dows} />)
            : draft.groups.map((g) => (
                <div key={g.id} className="rounded-xl" style={{ outline: `1.5px solid ${tint('--accent', 45)}`, outlineOffset: '-1.5px' }}>
                  <button type="button" onClick={() => setExpanded(expanded === g.id ? null : g.id)} className="w-full text-left">
                    <GroupReadBlock values={g.values} dows={g.dows} />
                  </button>
                  {expanded === g.id && (
                    <GroupEditor group={g} onField={(k, v) => setField(g.id, k, v)} onMicro={(k, v) => setMicro(g.id, k, v)} onSplit={(d) => splitDay(g.id, d)} />
                  )}
                </div>
              ))}
        </div>
      </div>

      {editing && (
        <>
          {saveError && <p className="text-xs text-danger">{saveError}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={cancel} className="flex-1 min-h-[44px] rounded-xl border border-border text-text-2 press">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60"
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ===== Card de fecha específica (override) =====
function OverrideCard({ variant, override, faseFor, initialEditing = false, forceCollapse = false, onSave, onCancel }) {
  const today = todayISO();
  const [editing, setEditing] = useState(initialEditing);
  const [draft, setDraft] = useState(() => ({ day: override?.day || today, label: override?.label || '', values: valuesOf(override) }));
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  function startEdit() {
    setDraft({ day: override?.day || today, label: override?.label || '', values: valuesOf(override) });
    setSaveError('');
    setEditing(true);
  }
  function cancel() {
    if (variant === 'newOverride' || forceCollapse) return onCancel?.();
    setEditing(false);
    setSaveError('');
  }
  async function save() {
    setBusy(true);
    const err = await onSave(draft);
    setBusy(false);
    if (err) setSaveError(typeof err === 'string' ? err : 'No se pudo guardar.');
  }
  const setVal = (k, v) => setDraft((d) => ({ ...d, values: { ...d.values, [k]: v } }));
  const setMicro = (k, v) =>
    setDraft((d) => {
      const micros = { ...d.values.micros };
      if (v === '') delete micros[k];
      else micros[k] = v;
      return { ...d, values: { ...d.values, micros } };
    });

  const day = editing ? draft.day : override?.day || today;
  const fase = faseFor(day);
  const kcalV = editing ? draft.values.kcal : override?.kcal;
  const delta = kcalV != null && kcalV !== '' && fase?.kcal != null ? Number(kcalV) - Number(fase.kcal) : null;

  return (
    <div className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <Kicker variant="override" />
        {!editing && <EditPill onClick={startEdit} />}
      </div>

      {!editing ? (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[19px] leading-tight">{override?.label || <span className="text-text-2">Sin motivo</span>}</h2>
            {fase && fase.kcal != null && (
              <p className="text-[12.5px] text-text-2" style={{ margin: 0 }}>
                Sustituye a “{fase.label || 'la fase'}” ese día ({fase.kcal} kcal)
              </p>
            )}
          </div>
          <p className="font-mono text-[11px] text-text-3" style={{ margin: 0 }}>
            {fmtFull(day)} · {relDaysLabel(daysBetween(today, day))}
          </p>
          <div className="border-t border-border pt-3">
            <div className="bg-surface-2 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <Chip text="DÍA ÚNICO" />
                <div className="flex items-center gap-2 shrink-0">
                  {delta != null && (
                    <span className="font-mono text-[11px] px-2 py-1 rounded-md" style={{ background: tint('--warn', 14), color: 'var(--warn)' }}>
                      {delta > 0 ? '+' : '−'}
                      {Math.abs(delta)} vs fase
                    </span>
                  )}
                  <span className="font-mono text-[15px]">{override?.kcal == null ? '–' : override.kcal}</span>
                </div>
              </div>
              <MacroBar p={override?.protein_g} c={override?.carbs_g} f={override?.fat_g} />
              <MacroLine p={override?.protein_g} c={override?.carbs_g} f={override?.fat_g} />
            </div>
          </div>
        </>
      ) : (
        <>
          <DateField label="Fecha" value={draft.day} onChange={(v) => setDraft((d) => ({ ...d, day: v }))} />
          <TextField label="Motivo" value={draft.label} onChange={(v) => setDraft((d) => ({ ...d, label: v }))} placeholder="p. ej. Cumpleaños" />
          <div className="grid grid-cols-4 gap-2">
            <MiniNumberField label="Kcal" value={draft.values.kcal} onChange={(v) => setVal('kcal', v)} />
            <MiniNumberField label="Prot" value={draft.values.protein_g} onChange={(v) => setVal('protein_g', v)} />
            <MiniNumberField label="Carbs" value={draft.values.carbs_g} onChange={(v) => setVal('carbs_g', v)} />
            <MiniNumberField label="Grasa" value={draft.values.fat_g} onChange={(v) => setVal('fat_g', v)} />
          </div>
          {delta != null && (
            <p className="font-mono text-[11px]" style={{ color: 'var(--warn)', margin: 0 }}>
              {delta > 0 ? '+' : '−'}
              {Math.abs(delta)} kcal vs fase ese día
            </p>
          )}
          <MicrosEditor micros={draft.values.micros} onMicro={setMicro} />
          {saveError && <p className="text-xs text-danger">{saveError}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={cancel} className="flex-1 min-h-[44px] rounded-xl border border-border text-text-2 press">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60"
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PhaseMeta({ variant, validFrom, nextVf, today }) {
  const start = fmtShort(validFrom);
  const endStr = nextVf ? fmtShort(addDaysISO(nextVf, -1)) : 'sin fin';

  if (variant === 'programada' || variant === 'new') {
    const d = daysBetween(today, validFrom);
    return (
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] text-text-3" style={{ margin: 0 }}>
          {start} → {endStr} · inicia en {d} {d === 1 ? 'día' : 'días'}
        </p>
        <ProgressBar pct={0} />
      </div>
    );
  }
  if (variant === 'previa') {
    const d = daysBetween(validFrom, nextVf);
    return (
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] text-text-3" style={{ margin: 0 }}>
          {start} → {endStr} · duró {d} {d === 1 ? 'día' : 'días'}
        </p>
        <ProgressBar pct={100} color="var(--text-3)" />
      </div>
    );
  }
  // vigente
  const N = daysBetween(validFrom, today) + 1;
  const M = nextVf ? daysBetween(validFrom, nextVf) : null;
  const pct = M ? Math.min(100, Math.max(0, (N / M) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-text-3" style={{ margin: 0 }}>
          {start} → {endStr}
        </p>
        <p className="font-mono text-[11px] text-text-3" style={{ margin: 0 }}>
          día {N}
          {M ? ` / ${M}` : ''}
        </p>
      </div>
      <ProgressBar pct={pct} />
    </div>
  );
}

function ProgressBar({ pct, color = 'var(--accent)' }) {
  return (
    <div className="h-[5px] rounded-full bg-surface-2 overflow-hidden">
      {pct > 0 && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />}
    </div>
  );
}

function GroupReadBlock({ values, dows }) {
  const kcal = values.kcal;
  return (
    <div className="bg-surface-2 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap gap-1.5">
          {chipLabels(dows).map((c) => (
            <Chip key={c} text={c} />
          ))}
        </span>
        <span className="font-mono text-[15px] shrink-0">{kcal == null || kcal === '' ? '–' : kcal}</span>
      </div>
      <MacroBar p={values.protein_g} c={values.carbs_g} f={values.fat_g} />
      <MacroLine p={values.protein_g} c={values.carbs_g} f={values.fat_g} />
    </div>
  );
}

function GroupEditor({ group, onField, onMicro, onSplit }) {
  const [splitting, setSplitting] = useState(false);
  return (
    <div className="bg-surface-3 rounded-b-xl p-3 flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        <MiniNumberField label="Kcal" value={group.values.kcal} onChange={(v) => onField('kcal', v)} />
        <MiniNumberField label="Prot" value={group.values.protein_g} onChange={(v) => onField('protein_g', v)} />
        <MiniNumberField label="Carbs" value={group.values.carbs_g} onChange={(v) => onField('carbs_g', v)} />
        <MiniNumberField label="Grasa" value={group.values.fat_g} onChange={(v) => onField('fat_g', v)} />
      </div>
      <MicrosEditor micros={group.values.micros} onMicro={onMicro} />
      {group.dows.length > 1 && (
        <div>
          <button type="button" onClick={() => setSplitting((s) => !s)} className="text-xs text-accent min-h-[44px] press">
            Separar un día
          </button>
          {splitting && (
            <div className="flex flex-wrap gap-2 pt-1">
              {group.dows.map((d) => (
                <button key={d} type="button" onClick={() => onSplit(d)} className="min-h-[44px] px-3 rounded-full bg-surface-2 border border-border text-xs">
                  {DOW_SHORT[d]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MicrosEditor({ micros, onMicro }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-text-3 min-h-[44px] flex items-center">Micros</summary>
      <div className="grid grid-cols-4 gap-2 pt-2">
        {MICROS.map((m) => (
          <MiniNumberField key={m.key} label={m.label} value={micros[m.key] ?? ''} onChange={(v) => onMicro(m.key, v)} />
        ))}
      </div>
    </details>
  );
}

function MacroBar({ p, c, f }) {
  if (p == null || p === '' || c == null || c === '' || f == null || f === '') return null;
  const pk = Number(p) * 4, ck = Number(c) * 4, fk = Number(f) * 9, tot = pk + ck + fk;
  if (!(tot > 0)) return null;
  const w = (x) => `${(x / tot) * 100}%`;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-3">
      <div className="bg-d-prot" style={{ width: w(pk) }} />
      <div className="bg-d-carb" style={{ width: w(ck) }} />
      <div className="bg-d-fat" style={{ width: w(fk) }} />
    </div>
  );
}

function MacroLine({ p, c, f }) {
  const val = (v) => (v == null || v === '' ? '–' : Number(v));
  return (
    <p className="font-mono text-[11.5px]" style={{ margin: 0 }}>
      <span className="text-d-prot">P {val(p)}</span>
      <span className="text-text-3"> · </span>
      <span className="text-d-carb">C {val(c)}</span>
      <span className="text-text-3"> · </span>
      <span className="text-d-fat">G {val(f)}</span>
    </p>
  );
}

function Chip({ text }) {
  return <span className="px-2 py-0.5 rounded-full bg-surface-3 text-[11px] text-text-2 whitespace-nowrap">{text}</span>;
}

function Kicker({ variant }) {
  const dot = {
    vigente: <span className="w-[7px] h-[7px] rounded-full bg-ok" />,
    programada: <span className="w-[7px] h-[7px] rounded-full border-[1.5px] border-accent" />,
    new: <span className="w-[7px] h-[7px] rounded-full border-[1.5px] border-accent" />,
    previa: <span className="w-[7px] h-[7px] rounded-full bg-text-3" />,
    override: <span className="w-[7px] h-[7px] rounded-full bg-warn" />,
    newOverride: <span className="w-[7px] h-[7px] rounded-full bg-warn" />,
  };
  const text = {
    vigente: 'FASE VIGENTE',
    programada: 'FASE PROGRAMADA',
    new: 'NUEVA FASE',
    previa: 'FASE PREVIA',
    override: 'FECHA ESPECÍFICA',
    newOverride: 'NUEVA FECHA',
  };
  return (
    <div className="flex items-center gap-1.5">
      {dot[variant] || dot.vigente}
      <span className="text-[11px] tracking-[0.14em] text-text-2 font-medium">{text[variant] || text.vigente}</span>
    </div>
  );
}

function EditPill({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ border: `1px solid ${tint('--accent', 55)}` }}
      className="shrink-0 min-h-[44px] px-4 inline-flex items-center rounded-full text-accent text-xs hover:bg-surface-2 press"
    >
      Editar
    </button>
  );
}

function MiniNumberField({ label, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-3">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] rounded-lg bg-surface-2 border border-border px-2 text-text font-mono tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-3">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input placeholder:text-text-3"
      />
    </div>
  );
}

// Meta de la fase: el filtro por régimen del Dashboard lee esta columna, así que
// "Sin especificar" ('' → null) es un valor legítimo, no un default silencioso.
function GoalField({ value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-3">Meta</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        <option value="">Sin especificar</option>
        {PHASE_GOALS.map((g) => (
          <option key={g.key} value={g.key}>
            {g.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-3">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    </div>
  );
}

// Bottom sheet (scrim ~72 %, borde superior 20 px, handle 36×4, cierre por tap en el scrim).
function Sheet({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md bg-bg rounded-t-[20px] sm:rounded-[20px] max-h-[88dvh] overflow-y-auto">
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-9 rounded-full bg-surface-3" />
        </div>
        <div className="px-4 pb-6 pt-1">{children}</div>
      </div>
    </div>
  );
}

function DecisionSheet({ validFrom, onCorregir, onNueva, onClose }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn) {
    setErr('');
    setBusy(true);
    const e = await fn();
    setBusy(false);
    if (e) setErr(e);
  }
  return (
    <Sheet onClose={onClose}>
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-[19px]">Guardar cambios</h2>
        <button onClick={() => run(onCorregir)} disabled={busy} className="text-left rounded-xl border border-border p-3.5 press disabled:opacity-60">
          <span className="block font-medium">Corregir la fase</span>
          <span className="block text-xs text-warn mt-1">Reescribe el objetivo desde el {fmtShort(validFrom)}. La adherencia pasada se recalcula.</span>
        </button>
        <button onClick={() => run(onNueva)} disabled={busy} className="text-left rounded-xl border border-border p-3.5 press disabled:opacity-60">
          <span className="block font-medium">Nueva fase desde hoy</span>
          <span className="block text-xs text-text-2 mt-1">Conserva el histórico intacto.</span>
        </button>
        {err && <p className="text-xs text-danger">{err}</p>}
        <button onClick={onClose} disabled={busy} className="min-h-[44px] rounded-xl text-text-2 press">
          Cancelar
        </button>
      </div>
    </Sheet>
  );
}

function ConfirmDeleteSheet({ name, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet onClose={onClose}>
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-[19px]">¿Borrar “{name}”?</h2>
        <p className="text-sm text-text-2" style={{ margin: 0 }}>
          Se eliminarán sus 7 objetivos diarios. Esta acción no se puede deshacer.
        </p>
        <button
          onClick={async () => {
            setBusy(true);
            await onConfirm();
          }}
          disabled={busy}
          className="min-h-[44px] rounded-xl bg-danger text-bg font-medium press disabled:opacity-60"
        >
          Borrar fase
        </button>
        <button onClick={onClose} disabled={busy} className="min-h-[44px] rounded-xl border border-border text-text-2 press">
          Cancelar
        </button>
      </div>
    </Sheet>
  );
}

function PreviasSheet({ previaVfs, labelOf, descOf, goalOf, onGoalChange, weekOf, nextVfOf, onClose }) {
  const [viewVf, setViewVf] = useState(null);

  if (viewVf) {
    return (
      <Sheet onClose={onClose}>
        <button onClick={() => setViewVf(null)} className="flex items-center gap-1 text-sm text-accent min-h-[44px] press">
          <ChevronLeft size={16} /> Fases previas
        </button>
        <div className="pt-2 flex flex-col gap-3">
          <PhaseCard variant="previa" validFrom={viewVf} label={labelOf(viewVf)} description={descOf(viewVf)} goal={goalOf(viewVf)} week={weekOf(viewVf)} nextVf={nextVfOf(viewVf)} />
          <GoalField value={goalOf(viewVf)} onChange={(v) => onGoalChange(viewVf, v)} />
        </div>
      </Sheet>
    );
  }

  const byYear = new Map();
  for (const vf of [...previaVfs].sort().reverse()) {
    const y = vf.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(vf);
  }
  const years = [...byYear.keys()].sort().reverse();
  const curYear = String(new Date().getFullYear());

  return (
    <Sheet onClose={onClose}>
      <h2 className="font-display text-[17px] mb-2">Fases previas</h2>
      <div className="flex flex-col gap-3">
        {years.map((y) => (
          <YearGroup key={y} year={y} vfs={byYear.get(y)} inert={y === curYear} labelOf={labelOf} nextVfOf={nextVfOf} onOpen={setViewVf} />
        ))}
      </div>
    </Sheet>
  );
}

function YearGroup({ year, vfs, inert, labelOf, nextVfOf, onOpen }) {
  const [open, setOpen] = useState(false);
  const showCards = inert || open;
  const counter = (
    <>
      <span className="font-mono text-xs font-medium text-text-2">{year}</span>
      <span className="text-[11px] text-text-3">
        {vfs.length} {vfs.length === 1 ? 'fase' : 'fases'}
      </span>
    </>
  );
  return (
    <div className="flex flex-col gap-2">
      {inert ? (
        <div className="flex items-center gap-2">{counter}</div>
      ) : (
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-h-[44px] press">
          <ChevronDown size={16} className={`text-text-3 transition-transform duration-150 ${open ? '' : '-rotate-90'}`} />
          {counter}
        </button>
      )}
      {showCards &&
        vfs.map((vf) => {
          const nvf = nextVfOf(vf);
          const d = daysBetween(vf, nvf);
          return (
            <button key={vf} onClick={() => onOpen(vf)} className="text-left rounded-xl bg-surface border border-border px-3.5 py-3 press">
              <span className="block font-medium text-sm">{labelOf(vf) || 'Sin nombre'}</span>
              <span className="block font-mono text-[11.5px] text-text-3 mt-1">
                {fmtShort(vf)} → {fmtShort(addDaysISO(nvf, -1))} · {d} {d === 1 ? 'día' : 'días'}
              </span>
            </button>
          );
        })}
    </div>
  );
}
