import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Plus, X, GlassWater, Settings, Pencil, Trash2, Check, History, Copy, ClipboardPaste, ArrowLeftRight, Upload, Bookmark } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { setSectionMenu } from '../lib/sectionMenu.js';
import { prefetchFrequent, refreshFrequent, getFrequent } from '../lib/frequent.js';
import { useToast } from '../lib/useToast.js';
import { t, useLang, locale, useUnits, fmtG, fmtMl, mlToFlOz, flOzToMl, useAdherenceBands } from '../lib/i18n.js';
import SwipeToDelete from '../components/SwipeToDelete.jsx';
import ConfirmSheet from '../components/ConfirmSheet.jsx';
import UndoToast from '../components/UndoToast.jsx';
import AmountField from '../components/AmountField.jsx';
import ImportSheet from '../components/ImportSheet.jsx';
import {
  todayISO,
  addDaysISO,
  resolveTarget,
  nutrientKind,
  classifyBullseye,
  classifyFloor,
  classifyBand,
  classifyCeiling,
  classifySodium,
  sodiumIsLow,
  sodiumIsHigh,
  SODIUM_FLOOR_MG,
  SODIUM_CEILING_MG,
  SODIUM_HIGH_MG,
  POTASSIUM_HIGH_MG,
  round,
  MICROS,
  MICROS_DEFAULT,
  microGroups,
  mergeFoodResults,
} from '../lib/domain.js';
import { GEMINI_KEY, embedText } from '../lib/ai.js';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, closestCenter, closestCorners, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';

// ponytail: matchMedia instead of a custom resize observer; it already covers the only
// breakpoint we care about (lg = 2-zone layout vs. mobile flow).
function useIsLgUp() {
  const [isLg, setIsLg] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = () => setIsLg(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isLg;
}

const statusColor = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' };

// --- Summary card configuration (prefs.data.today_card) ---
// Three layouts ('estado' | 'objetivos' | 'mini'; the card's arrows cycle
// through them), each with its own config:
// - mode = the primary variable the layout features:
//   'delta' = absolute remainder (−N to the target), 'pct' = remainder in %,
//   'meta' = current value and its target, no delta.
// - items = nutrient keys in visual order (in 'objetivos' the position
//   assigns the slot: 1st ring, 2nd–4th bars, rest tiles).
// today_card.sync = true replicates every edit to all three layouts. When
// everything is absent, the defaults replicate the original layouts.
const BASE_ITEMS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodio_mg', 'potasio_mg'];
const CARD_DEFAULTS = {
  estado: { mode: 'meta', items: BASE_ITEMS },
  objetivos: { mode: 'delta', items: BASE_ITEMS },
  mini: { mode: 'delta', items: BASE_ITEMS },
};
const VIEW_CYCLE = ['estado', 'objetivos', 'mini'];
const VIEW_NAMES = { estado: 'Estado actual', objetivos: 'Objetivos', mini: 'Mini' };

function cardCfg(prefs, view) {
  return { ...CARD_DEFAULTS[view], ...(prefs.today_card?.[view] || {}) };
}

// Macro metadata (micros come from MICROS). The adherence archetype
// (diana/piso/rango/techo/sodio/meta) is NOT declared here: it is resolved by
// nutrientKind(key) in domain.js — single source, so that Hoy and the Dashboard
// do not diverge. nutrientMeta attaches it as `kind`.
const MACRO_META = {
  kcal: { key: 'kcal', label: 'Kcal', unit: 'kcal', decimals: 0, color: 'text-d-kcal' },
  protein_g: { key: 'protein_g', label: 'Prot', unit: 'g', decimals: 1, color: 'text-d-prot' },
  carbs_g: { key: 'carbs_g', label: 'Carbs', unit: 'g', decimals: 1, color: 'text-d-carb' },
  fat_g: { key: 'fat_g', label: 'Grasa', unit: 'g', decimals: 1, color: 'text-d-fat' },
};
// Short label for chips in the mini layout (chemical symbol where unambiguous;
// P/C/G = the section headers' convention). Everything else: full label.
const SHORT_LABEL = { kcal: 'kcal', protein_g: 'P', carbs_g: 'C', fat_g: 'G', sodio_mg: 'Na', potasio_mg: 'K', magnesio_mg: 'Mg', calcio_mg: 'Ca', hierro_mg: 'Fe', zinc_mg: 'Zn' };

function nutrientMeta(key) {
  const base = MACRO_META[key] || (() => {
    const m = MICROS.find((x) => x.key === key);
    if (!m) return null; // stale/unknown key in prefs: ignored, does not break
    return { key, label: m.label, unit: m.unit, decimals: m.unit === 'g' ? 1 : 0, color: null };
  })();
  return base && { ...base, kind: nutrientKind(key) };
}

function shortLabel(key) {
  return SHORT_LABEL[key] ? t(SHORT_LABEL[key]) : t(nutrientMeta(key)?.label || key);
}

function targetFor(key, target) {
  if (!target) return null;
  const v = MACRO_META[key] ? target[key] : target.micros?.[key];
  return v > 0 ? Number(v) : null;
}

// Renderable state of a nutrient: value, target, % and color per its archetype.
// The regimen (target.goal) biases the kcal band; hasFood avoids flagging sodium
// on an empty day.
function itemState(key, totals, target, hasFood) {
  const meta = nutrientMeta(key);
  if (!meta) return null;
  const goal = target?.goal ?? null;
  const value = Number(totals[key] || 0);
  const tgt = targetFor(key, target);
  const pct = tgt ? Math.round((value / tgt) * 100) : null;
  let color;
  if (meta.kind === 'diana') color = statusColor[classifyBullseye(value, tgt, goal)] || meta.color;
  else if (meta.kind === 'piso') color = statusColor[classifyFloor(value, tgt)] || meta.color;
  else if (meta.kind === 'rango') color = statusColor[classifyBand(value, tgt)] || meta.color;
  else if (meta.kind === 'techo') color = statusColor[classifyCeiling(value, tgt)] || meta.color;
  else if (meta.kind === 'sodio') color = statusColor[classifySodium(value, hasFood)] || 'text-text';
  else if (meta.color) color = meta.color;
  else color = tgt != null && value >= tgt ? 'text-ok' : 'text-warn';
  return { meta, value, tgt, pct, color, goal };
}

// "On target" per the archetype: within the band (diana/rango), at or above the
// floor (piso/meta), at or below the ceiling (techo). Sodium is rendered separately (dual).
function metFor(meta, value, tgt, goal) {
  if (tgt == null) return false;
  if (meta.kind === 'diana') return classifyBullseye(value, tgt, goal) === 'ok';
  if (meta.kind === 'rango') return classifyBand(value, tgt) === 'ok';
  if (meta.kind === 'techo') return value <= tgt;
  return value >= tgt; // piso, meta archetypes
}

// Delta to the target formatted per the mode: absolute (−318) or in % (−18%).
function deltaText(mode, delta, base, decimals) {
  const sign = delta < 0 ? '−' : '+';
  if (mode === 'pct') return `${sign}${Math.abs(Math.round((delta / base) * 100))}%`;
  return `${sign}${Math.abs(round(delta, decimals))}`;
}

// Pending items (chips of the mini layout and of the fixed mini-summary). base = the
// target (or the sodium floor) against which the % is computed in 'pct' mode. Sodium
// below the medical floor is ALWAYS included, even if the user removed it from their
// items — safety rule, not configurable.
function pendingFor(items, totals, target, hasFood) {
  const sodium = Number(totals.sodio_mg || 0);
  const sodLow = sodiumIsLow(sodium, hasFood);
  const sodHigh = sodiumIsHigh(sodium, hasFood);
  // Sodium pending item: floor (deficit) or ceiling (excess), both critical and medical.
  const sodPending = () =>
    sodLow
      ? { key: 'sodio_mg', critical: true, delta: sodium - SODIUM_FLOOR_MG, base: SODIUM_FLOOR_MG }
      : { key: 'sodio_mg', critical: true, delta: sodium - SODIUM_CEILING_MG, base: SODIUM_CEILING_MG };
  const pending = [];
  for (const key of items) {
    const s = itemState(key, totals, target);
    if (!s) continue;
    const { meta, value, tgt, goal } = s;
    if (meta.kind === 'diana') {
      const st = classifyBullseye(value, tgt, goal);
      if (st && st !== 'ok') pending.push({ key, critical: st === 'danger', delta: value - tgt, base: tgt });
    } else if (meta.kind === 'rango') {
      const st = classifyBand(value, tgt);
      if (st && st !== 'ok') pending.push({ key, critical: st === 'danger', delta: value - tgt, base: tgt });
    } else if (meta.kind === 'piso') {
      if (classifyFloor(value, tgt) === 'danger') pending.push({ key, critical: true, delta: value - tgt, base: tgt });
    } else if (meta.kind === 'techo') {
      const st = classifyCeiling(value, tgt);
      if (st && st !== 'ok') pending.push({ key, critical: st === 'danger', delta: value - tgt, base: tgt });
    } else if (meta.kind === 'sodio') {
      if (sodLow || sodHigh) pending.push(sodPending());
    } else if (tgt != null && value < tgt) {
      pending.push({ key, critical: false, delta: value - tgt, base: tgt });
    }
  }
  if ((sodLow || sodHigh) && !items.includes('sodio_mg')) pending.push(sodPending());
  // A delta that rounds to 0 counts as met: showing "−0" as pending
  // (worse still, as critical) would contradict the displayed figure.
  return pending.filter((s) => Math.abs(round(s.delta, 0)) >= 1);
}

// Today's summary, layout selectable by the user (prefs.today_view) and applied
// at every screen size. The toggle cycles through the 3 layouts; the gear
// opens the customization sheet (items + per-layout toggles).
function SummaryCard({ view, cfg, onToggleView, onConfig, ...props }) {
  const next = VIEW_CYCLE[(VIEW_CYCLE.indexOf(view) + 1) % VIEW_CYCLE.length];
  return (
    <div className="rounded-2xl bg-surface border border-border p-4 lg:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-text-3">{t(VIEW_NAMES[view])}</p>
        <div className="flex items-center">
          <button
            onClick={onConfig}
            className="w-11 h-11 -my-2.5 flex items-center justify-center text-text-3 press"
            aria-label={t('Personalizar resumen')}
          >
            <Settings size={16} />
          </button>
          <button
            onClick={onToggleView}
            className="w-11 h-11 -my-2.5 -mr-2.5 flex items-center justify-center text-text-3 press"
            aria-label={`${t('Ver')} ${t(VIEW_NAMES[next]).toLowerCase()}`}
          >
            <ArrowLeftRight size={16} />
          </button>
        </div>
      </div>
      {view === 'objetivos' ? <GoalSummary cfg={cfg} {...props} /> : view === 'mini' ? <MiniGrid cfg={cfg} {...props} /> : <StateSummary cfg={cfg} {...props} />}
    </div>
  );
}

function StateSummary({ cfg, totals, target, hasFood }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {cfg.items.map((key) => {
        const s = itemState(key, totals, target, hasFood);
        return s && <Stat key={key} state={s} mode={cfg.mode} />;
      })}
    </div>
  );
}

// Goal-oriented layout: hero with ring (items[0]), bars (items[1..3])
// and tiles (items[4..]). The position within items assigns the slot.
function GoalSummary({ cfg, totals, target, hasFood }) {
  const hero = cfg.items[0] ? itemState(cfg.items[0], totals, target, hasFood) : null;
  const rails = cfg.items.slice(1, 4).map((k) => itemState(k, totals, target, hasFood)).filter(Boolean);
  const tiles = cfg.items.slice(4).map((k) => itemState(k, totals, target, hasFood)).filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      {hero && <HeroRing state={hero} mode={cfg.mode} />}
      {rails.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-3">
            {rails.map((s) => <RailStat key={s.meta.key} state={s} mode={cfg.mode} />)}
          </div>
        </>
      )}
      {tiles.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((s) => <Tile key={s.meta.key} state={s} mode={cfg.mode} hasFood={hasFood} />)}
          </div>
        </>
      )}
    </div>
  );
}

function HeroRing({ state, mode }) {
  const { meta, value, tgt, pct, color, goal } = state;
  const arc = pct != null ? 326.726 * (1 - Math.min(1, pct / 100)) : null;
  const met = metFor(meta, value, tgt, goal);
  return (
    <div className="flex items-center gap-4">
      <div className={`relative w-[104px] h-[104px] flex-none ${color}`}>
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-2)" strokeWidth="11" />
          {arc != null && (
            <circle
              cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round"
              strokeDasharray="326.726" strokeDashoffset={arc}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono tabular-nums text-2xl leading-none text-text">{round(value, meta.decimals)}</span>
          <span className="text-[10px] text-text-3 mt-0.5">{meta.unit}</span>
        </div>
      </div>
      <div className={`min-w-0 ${color}`}>
        {tgt == null ? (
          <p className="text-xs text-text-3">{t('sin meta de')} {t(meta.label).toLowerCase()}</p>
        ) : met ? (
          <>
            <p className="flex items-center gap-1.5 text-lg"><Check size={18} />{t('en meta')}</p>
            <p className="text-xs text-text-3 mt-2">{t('meta')} {round(tgt, meta.decimals)} {meta.unit}</p>
          </>
        ) : mode === 'meta' ? (
          <>
            <p className="font-mono tabular-nums text-2xl leading-none">{round(tgt, meta.decimals)}</p>
            <p className="text-xs text-text-3 mt-2">{meta.unit} · {t('meta')}</p>
          </>
        ) : (
          <>
            <p className="font-mono tabular-nums text-2xl leading-none">{deltaText(mode, value - tgt, tgt, meta.decimals)}</p>
            <p className="text-xs text-text-3 mt-2">{meta.unit} · {t('meta')} {round(tgt, meta.decimals)}</p>
          </>
        )}
      </div>
    </div>
  );
}

// Mineral/micro tile. Sodium keeps its dual medical semantics (floor
// SODIUM_FLOOR_MG + ceiling SODIUM_CEILING_MG), not configurable; the rest follow
// their archetype (techo = do not exceed, meta = reach).
function Tile({ state, mode, hasFood }) {
  const { meta, value, tgt, color, goal } = state;
  const d = meta.decimals;
  const met = metFor(meta, value, tgt, goal);
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="text-[10px] uppercase tracking-wide text-text-3">{t(meta.label)}</p>
      <p className={`font-mono tabular-nums text-lg mt-1 ${color}`}>{round(value, d)}</p>
      {meta.kind === 'sodio' ? (
        sodiumIsLow(value, hasFood) ? (
          <p className="font-mono tabular-nums text-[11px] text-danger mt-0.5">
            {mode === 'pct' ? deltaText('pct', value - SODIUM_FLOOR_MG, SODIUM_FLOOR_MG, 0) : `−${round(SODIUM_FLOOR_MG - value, 0)}`} {t('al piso')}
          </p>
        ) : sodiumIsHigh(value, hasFood) ? (
          <p className="font-mono tabular-nums text-[11px] text-danger mt-0.5">
            {mode === 'pct' ? deltaText('pct', value - SODIUM_CEILING_MG, SODIUM_CEILING_MG, 0) : `+${round(value - SODIUM_CEILING_MG, 0)}`} {t('sobre el techo')}
          </p>
        ) : (
          <p className="text-[10px] text-text-3 mt-0.5">{meta.unit} · {t('piso')} {SODIUM_FLOOR_MG} · {t('techo')} {SODIUM_CEILING_MG}</p>
        )
      ) : tgt == null ? (
        <p className="text-[10px] text-text-3 mt-0.5">{meta.unit}</p>
      ) : met ? (
        <p className="flex items-center gap-1 text-[11px] text-ok mt-0.5"><Check size={12} />{t('meta')}</p>
      ) : mode === 'meta' ? (
        <p className="text-[10px] text-text-3 mt-0.5 font-mono tabular-nums">{t('de')} {round(tgt, d)}</p>
      ) : (
        <p className={`font-mono tabular-nums text-[11px] mt-0.5 ${color}`}>{deltaText(mode, value - tgt, tgt, d)} {t('de')} {round(tgt, d)}</p>
      )}
    </div>
  );
}

// Mini layout as a permanent card: in 'delta'/'pct' mode only chips for what
// is missing (everything on target collapses to a ✓); in 'meta' mode, the current
// value and the target of each item.
function MiniGrid({ cfg, totals, target, hasFood }) {
  if (cfg.mode === 'meta') {
    return (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        {cfg.items.map((key) => {
          const s = itemState(key, totals, target);
          return s && (
            <span key={key} className="flex items-baseline gap-1.5">
              <span className={`font-mono tabular-nums text-sm ${s.color}`}>{round(s.value, s.meta.decimals)}</span>
              <span className="text-[11px] text-text-3">
                {s.tgt != null && `/${round(s.tgt, s.meta.decimals)} `}{shortLabel(key)}
              </span>
            </span>
          );
        })}
      </div>
    );
  }
  const pending = pendingFor(cfg.items, totals, target, hasFood);
  if (pending.length === 0) {
    return <p className="flex items-center gap-1.5 text-sm text-ok"><Check size={16} />{t('en meta')}</p>;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
      {pending.map((s) => <MiniStat key={s.key} mode={cfg.mode} pending={s} label={shortLabel(s.key)} />)}
    </div>
  );
}

// Fixed mini-summary (<lg): visible only when the summary card leaves the
// viewport. Shows ONLY what is pending (items and mode of the mini layout) — delta
// + short label and a 4px status dot; met items take no slot. Everything
// on target collapses to a single ✓.
function MiniStat({ mode, pending, label }) {
  const { critical, delta, base } = pending;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`w-1 h-1 rounded-full self-center flex-none ${critical ? 'bg-danger' : 'bg-warn'}`} />
      <span className={`font-mono tabular-nums font-medium ${critical ? 'text-lg leading-none text-text' : 'text-sm text-text-2'}`}>
        {mode === 'pct' ? deltaText('pct', delta, base, 0) : deltaText('delta', delta, base, 0)}
      </span>
      <span className="text-[11px] text-text-3">{label}</span>
    </span>
  );
}

// The fixed mini-summary shares the 'mini' layout with the card: it reuses MiniGrid
// so that EVERY config change (including 'meta' mode, not just pending items) is
// reflected identically while scrolling. A dedicated renderer used to diverge in 'meta'.
function MiniSummary({ visible, top, cfg, totals, target, hasFood, onTap }) {
  // With no targets and no entries there is nothing to summarize.
  if (target == null && !hasFood) return null;
  return (
    <button
      id="mini-summary"
      type="button"
      onClick={onTap}
      aria-label={t('Ver resumen del día')}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      style={{ top }}
      className={`lg:hidden fixed left-0 right-0 md:left-52 z-20 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 min-h-[44px] bg-bg border-b border-border transition-opacity motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <MiniGrid cfg={cfg} totals={totals} target={target} hasFood={hasFood} />
    </button>
  );
}

// Meal templates sheet: lists the saved ones (add / delete) and allows saving
// the current day as a new one. Glass + close on scrim tap (BIBLIA).
function MealTemplatesSheet({ templates, canSave, onSave, onAdd, onDelete, onClose }) {
  const [name, setName] = useState('');
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center backdrop-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass w-full sm:max-w-sm border border-border rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 sheet-in max-h-[80vh] overflow-y-auto"
      >
        <h2 className="font-display text-[19px]">{t('Plantillas de comida')}</h2>
        {templates.length === 0 && (
          <p className="text-sm text-text-2" style={{ margin: 0 }}>
            {t('Aún no tienes plantillas. Guarda el día actual como una para reutilizarla en cualquier fecha.')}
          </p>
        )}
        {templates.map((tp) => (
          <div key={tp.id} className="flex items-center gap-2 rounded-xl border border-border p-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{tp.name}</p>
              <p className="text-xs text-text-3">{t('%n alimentos').replace('%n', tp.items.length)}</p>
            </div>
            <button
              onClick={() => onAdd(tp)}
              className="px-3 min-h-[40px] rounded-lg bg-accent-deep text-on-accent text-sm font-medium press"
            >
              {t('Añadir')}
            </button>
            <button onClick={() => onDelete(tp.id)} aria-label={t('Borrar')} className="p-2 min-h-[40px] text-text-3 press">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Nombre de la plantilla')}
            className="rounded-xl border border-border bg-surface-2 px-3 min-h-[44px] outline-none"
          />
          <button
            disabled={!canSave || !name.trim()}
            onClick={() => {
              onSave(name);
              setName('');
            }}
            className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press disabled:opacity-60"
          >
            {t('Guardar el día actual como plantilla')}
          </button>
          {!canSave && (
            <p className="text-xs text-text-3" style={{ margin: 0 }}>
              {t('Este día no tiene alimentos que guardar.')}
            </p>
          )}
        </div>
        <button onClick={onClose} className="min-h-[44px] rounded-xl border border-border text-text-2 press">
          {t('Cerrar')}
        </button>
      </div>
    </div>
  );
}

export default function Today() {
  const lang = useLang();
  useUnits();
  useAdherenceBands(); // re-renders when the bands change in Configuración
  const [date, setDate] = useState(todayISO());
  // SWR: renders the session cache instantly and the background refetch updates it.
  // Entries cached per date; 'targets' is shared with the Metas page.
  const [entries, setEntries] = useState(() => cacheGet(`entries:${todayISO()}`) || []);
  const [labels, setLabels] = useState(() => cacheGet('labels') || []);
  const [targets, setTargets] = useState(() => cacheGet('targets') || []);
  const [loading, setLoading] = useState(() => !cacheGet(`entries:${todayISO()}`));
  const [adding, setAdding] = useState(null); // { labelId } | null
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null); // entry being edited
  // "Calculator" preview: the add/edit form reports { meta(per-100g),
  // grams, minus(entry to be replaced|null) }; the summary reflects how the day
  // would end up if saved. Cleared when the form unmounts (cancel/save/close).
  const [preview, setPreview] = useState(null);
  const [toast, showToast] = useToast();
  const [userId, setUserId] = useState(null);
  const [prefs, setPrefs] = useState({ water_glass_ml: 1000, water_food_id: null, today_view: 'estado' });
  const [waterSettingsOpen, setWaterSettingsOpen] = useState(false);
  const [cardConfigOpen, setCardConfigOpen] = useState(false);
  // Optimistic water: in-flight ml (pending insert/delete) to render the glasses
  // instantly without waiting for the Supabase round-trip. Deducted upon resolution.
  const [pendingWaterMl, setPendingWaterMl] = useState(0);
  const [undoData, setUndoData] = useState(null); // { entry, timer } after a delete, for "Deshacer"
  const [undoTpl, setUndoTpl] = useState(null); // { list, timer }: prefs.meal_templates prior to deleting a template, for "Deshacer"
  const [activeEntry, setActiveEntry] = useState(null); // entry being dragged (for the DragOverlay ghost)
  const [dragOverSection, setDragOverSection] = useState(null); // label id (or 'none') under a dragged card
  const [draggingSection, setDraggingSection] = useState(null); // id of the section being dragged (dims the others)
  const [quickAddKey, setQuickAddKey] = useState(0); // bumped to reset the inline quick-add after logging
  const [quickAddInitialLabel, setQuickAddInitialLabel] = useState(null);
  const quickAddInputRef = useRef(null);
  const isLg = useIsLgUp();
  // Mini-summary (<lg): visible when the summary card leaves the viewport.
  const summaryCardRef = useRef(null);
  const [miniVisible, setMiniVisible] = useState(false);
  const [miniTop, setMiniTop] = useState(0);
  // Day copied for "Pegar" (localStorage: survives date changes and reloads).
  const [copiedDay, setCopiedDay] = useState(() => localStorage.getItem('nutri.today.copiedDay') || null);
  const [confirmingDeleteDay, setConfirmingDeleteDay] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // Collapsed sections: Set of keys (String(labelId) or 'none'), persisted in
  // localStorage — survives reloads without a remote write (ponytail: no DB).
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nutri.today.collapsed') || '[]')); }
    catch { return new Set(); }
  });
  // On dropping a section, the browser fires a click on the element where the
  // pointer ended up — if the drag started in the toggle zone, that ghost click
  // would collapse the just-reordered section. Grace window after each drag.
  const lastSectionDragRef = useRef(0);
  function toggleCollapsed(key) {
    if (Date.now() - lastSectionDragRef.current < 250) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem('nutri.today.collapsed', JSON.stringify([...next]));
      return next;
    });
  }

  // MouseSensor + TouchSensor, NOT PointerSensor: with touch-action pan-y (required
  // for swipe-to-delete) PointerSensor cannot block scrolling and iOS cancels the
  // drag with pointercancel; TouchSensor does preventDefault the touchmove on activation.
  const DRAG_ACTIVATION = { delay: 150, tolerance: 8 };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: DRAG_ACTIVATION })
  );

  useEffect(() => {
    // On date change, render the new day's cache BEFORE the refetch —
    // without this, the previous day's entries would show while loading.
    const cached = cacheGet(`entries:${date}`);
    if (cached) setEntries(cached);
    loadDay();
  }, [date]);

  useEffect(() => {
    const el = summaryCardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([entry]) => {
      // The mobile header is sticky: the mini-summary anchors right below it.
      setMiniTop(document.querySelector('header')?.offsetHeight || 0);
      setMiniVisible(!entry.isIntersecting);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  function scrollToSummary() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  // After saving an entry, leave its section bar at the top (below the sticky
  // header). setTimeout 0: waits for the re-render with the new entry before
  // measuring (rAF does not run in frameless tabs, e.g. in the background).
  function scrollToSection(labelId) {
    setTimeout(() => {
      const el = document.getElementById(labelId ? `sec-${labelId}` : 'sec-none');
      if (!el) return;
      const header = document.querySelector('header')?.offsetHeight || 0;
      // The mini-summary is fixed below the header (z-20) and may wrap onto 2
      // rows: its actual height also covers the section bar. On lg+ it is
      // display:none (offsetHeight 0), it offsets nothing.
      const mini = document.getElementById('mini-summary')?.offsetHeight || 0;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - header - mini - 8,
        behavior: reduce ? 'auto' : 'smooth',
      });
    }, 0);
  }

  useEffect(() => {
    loadLabels();
    loadTargets();
    loadPrefs();
    // On a slow connection the frequent-items query takes a while: it is fired here
    // (post-login) so that opening the add sheet is instant (it reads from the cache).
    prefetchFrequent();
    // LabelsModal lives in App.jsx above this page: no remount, it notifies via an event.
    window.addEventListener('labels-changed', loadLabels);
    return () => window.removeEventListener('labels-changed', loadLabels);
  }, []);

  // Keyboard shortcuts lg+: ←/→ change the day, "/" focuses the quick-add, Esc
  // closes panel/sheet — inactive when focus is on a form field.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (editing) setEditing(null);
        else if (adding) setAdding(null);
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setDate((d) => addDaysISO(d, -1));
      else if (e.key === 'ArrowRight') setDate((d) => addDaysISO(d, 1));
      else if (e.key === '/') {
        e.preventDefault();
        quickAddInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, adding]);

  async function loadPrefs() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);
    const { data } = await supabase.from('prefs').select('data').maybeSingle();
    if (data?.data) setPrefs((p) => ({ ...p, ...data.data }));
  }

  async function savePrefs(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    // merge_prefs (migration 014): writes ONLY the patch's keys server-side.
    // The previous upsert replaced the entire jsonb from this partial local
    // state and could clobber unrelated keys (e.g. the Dashboard's dashboards).
    await supabase.rpc('merge_prefs', { patch });
    return next;
  }

  function toggleTodayView() {
    const cur = VIEW_CYCLE.includes(prefs.today_view) ? prefs.today_view : 'estado';
    savePrefs({ today_view: VIEW_CYCLE[(VIEW_CYCLE.indexOf(cur) + 1) % VIEW_CYCLE.length] });
  }

  // Saves a config patch for the `view` layout; with sync enabled the patch
  // (applied on top of that layout's config) is replicated to all three.
  function saveCardCfg(view, patch) {
    const tc = prefs.today_card || {};
    const next = { ...cardCfg(prefs, view), ...patch };
    savePrefs({
      today_card: tc.sync
        ? { ...tc, estado: next, objetivos: next, mini: next }
        : { ...tc, [view]: next },
    });
  }

  // Turning sync on copies the active layout's config to all three (identical
  // starting point); turning it off leaves each with the latest and they diverge.
  function setCardSync(on, view) {
    const tc = prefs.today_card || {};
    const cur = cardCfg(prefs, view);
    savePrefs({
      today_card: on
        ? { ...tc, sync: true, estado: cur, objetivos: cur, mini: cur }
        : { ...tc, sync: false },
    });
  }

  // Water is logged as entries of the user's own "Agua" food (micros {agua_ml:100},
  // grams = ml). Find-or-create filtering by owner: the catalog is shared for
  // reading and the other user's "Agua" would not be editable by this one.
  async function getWaterFoodId() {
    // Validate the cache: a catalog import/cleanup may have deleted the food and
    // left the id dead (inserts would silently fail on the FK).
    if (prefs.water_food_id) {
      const { data } = await supabase.from('foods').select('id').eq('id', prefs.water_food_id).maybeSingle();
      if (data) return data.id;
    }
    let { data: food } = await supabase.from('foods').select('id').eq('name', 'Agua').eq('owner', userId).maybeSingle();
    if (!food) {
      ({ data: food } = await supabase
        .from('foods')
        .insert({ name: 'Agua', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, micros: { agua_ml: 100 }, source: 'manual' })
        .select('id')
        .single());
    }
    await savePrefs({ water_food_id: food.id });
    return food.id;
  }

  async function addWater(ml) {
    if (!userId || !(ml > 0)) return;
    setPendingWaterMl((p) => p + ml);
    try {
      const foodId = await getWaterFoodId();
      const { error } = await supabase.from('entries').insert({ day: date, grams: ml, food_id: foodId });
      if (error) throw error;
      await loadDay(true);
    } catch {
      showToast(t('Error al registrar agua.'));
    } finally {
      setPendingWaterMl((p) => p - ml);
    }
  }

  async function undoWater() {
    const last = waterEntries[waterEntries.length - 1];
    if (!last) return;
    const ml = Number(last.grams);
    setPendingWaterMl((p) => p - ml);
    const { error } = await supabase.from('entries').delete().eq('id', last.id);
    if (!error) await loadDay(true);
    else showToast(t('Error al registrar agua.'));
    setPendingWaterMl((p) => p + ml);
  }

  async function loadTargets() {
    const { data, error } = await supabase.from('targets').select('*');
    if (error) { showToast(t('No se pudieron cargar los objetivos — revisa tu conexión.')); return; }
    setTargets(cacheSet('targets', data || []));
  }

  // silent: refetch after a mutation without going through the skeleton — unmounting
  // the list collapses the page height and the browser clamps the scroll to the top.
  async function loadDay(silent = false) {
    if (!silent && !cacheGet(`entries:${date}`)) setLoading(true);
    const { data, error } = await supabase
      .from('entry_nutrients')
      .select('*')
      .eq('day', date)
      .order('sort_order')
      .order('created_at');
    if (error) { showToast(t('No se pudo cargar el día — revisa tu conexión.')); setLoading(false); return; }
    setEntries(cacheSet(`entries:${date}`, data || []));
    setLoading(false);
  }

  async function loadLabels() {
    const { data, error } = await supabase.from('meal_labels').select('*').is('archived_at', null).order('sort_order');
    if (error) { showToast(t('No se pudieron cargar las etiquetas — revisa tu conexión.')); return; }
    setLabels(cacheSet('labels', data || []));
  }

  async function persistLabelOrder(reordered) {
    setLabels(reordered);
    await Promise.all(reordered.map((l, i) => supabase.from('meal_labels').update({ sort_order: i }).eq('id', l.id)));
    loadLabels();
  }

  function handleDragStart({ active }) {
    if (active.data.current?.type === 'card') {
      setActiveEntry(foodEntries.find((e) => e.id === active.data.current.entryId) || null);
    } else if (active.data.current?.type === 'section') {
      setDraggingSection(active.data.current.labelId);
    }
  }

  function handleDragOver({ active, over }) {
    if (active?.data?.current?.type !== 'card') return;
    if (!over) {
      setDragOverSection(null);
      return;
    }
    const labelId = over.data.current?.labelId;
    setDragOverSection(labelId == null ? 'none' : labelId);
  }

  async function handleDragEnd({ active, over }) {
    setActiveEntry(null);
    setDragOverSection(null);
    setDraggingSection(null);
    if (active.data.current?.type === 'section') lastSectionDragRef.current = Date.now();
    if (!over) return;
    const data = active.data.current;
    if (data?.type === 'section') {
      if (active.id === over.id) return;
      const oldIndex = labels.findIndex((l) => `section-${l.id}` === active.id);
      const newIndex = labels.findIndex((l) => `section-${l.id}` === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      persistLabelOrder(arrayMove(labels, oldIndex, newIndex));
      return;
    }
    if (data?.type !== 'card') return;
    const overId = String(over.id);
    if (overId === active.id) return; // dropped onto itself
    const moving = entries.find((e) => e.id === data.entryId);
    if (!moving) return;
    // Destination label: direct section (container) or that of the card it was dropped onto.
    const overLabel = overId.startsWith('section-')
      ? (overId === 'section-none' ? null : overId.slice('section-'.length))
      : (entries.find((e) => `card-${e.id}` === overId)?.meal_label_id ?? null);
    // New global order: remove the card and reinsert it at the destination position.
    // groupByLabel groups by meal_label_id preserving the array order, so the
    // global order within a group == the section's visual order.
    const others = entries.filter((e) => e.id !== moving.id);
    let idx;
    if (overId.startsWith('section-')) {
      let last = -1; // insert after the last card of that label (end of section)
      others.forEach((e, i) => { if ((e.meal_label_id ?? null) === overLabel) last = i; });
      idx = last + 1;
    } else {
      idx = others.findIndex((e) => `card-${e.id}` === overId);
      if (idx === -1) idx = others.length;
      else {
        // arrayMove semantics: when dragging downward, the target card has already
        // shifted one index up within `others` — insert AFTER it, not before
        // (otherwise an adjacent downward swap ends up equal to the original order).
        const movingIdx = entries.findIndex((e) => e.id === moving.id);
        const overIdx = entries.findIndex((e) => `card-${e.id}` === overId);
        if (movingIdx < overIdx) idx += 1;
      }
    }
    const movedEntry = { ...moving, meal_label_id: overLabel };
    const next = [...others.slice(0, idx), movedEntry, ...others.slice(idx)];
    setEntries(next); // optimistic (render uses the array order + meal_label_id)
    // Persist: renumber sort_order for the affected sections (origin and destination)
    // and the moved card's meal_label_id.
    const affected = new Set([moving.meal_label_id ?? null, overLabel]);
    const counters = new Map();
    const updates = [];
    for (const e of next) {
      const L = e.meal_label_id ?? null;
      const so = counters.get(L) ?? 0;
      counters.set(L, so + 1);
      if (affected.has(L)) updates.push({ id: e.id, meal_label_id: e.meal_label_id, sort_order: so });
    }
    const results = await Promise.all(
      updates.map((u) => supabase.from('entries').update({ meal_label_id: u.meal_label_id, sort_order: u.sort_order }).eq('id', u.id))
    );
    if (results.some((r) => r.error)) loadDay(true);
  }

  function handleDragCancel() {
    setActiveEntry(null);
    setDragOverSection(null);
    setDraggingSection(null);
    lastSectionDragRef.current = Date.now();
  }

  // Unified delete (swipe/hover icon in Hoy and the editor's "Borrar" button): optimistic
  // UI + toast with "Deshacer" for 5 s that reinserts the entry exactly as it was.
  async function deleteEntry(entry) {
    setEntries((es) => es.filter((x) => x.id !== entry.id));
    const { error } = await supabase.from('entries').delete().eq('id', entry.id);
    if (error) {
      loadDay(true);
      showToast(t('Error al borrar.'));
      return;
    }
    setUndoData((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndoData(null), 5000);
      return { entry, timer };
    });
  }

  async function handleUndo() {
    if (!undoData) return;
    clearTimeout(undoData.timer);
    const { day, grams, meal_label_id, food_id, recipe_id } = undoData.entry;
    setUndoData(null);
    const { error } = await supabase.from('entries').insert({ day, grams, meal_label_id, food_id, recipe_id });
    if (!error) loadDay(true);
  }

  // Inserts `sourceDay`'s entries into the current date. Reused by "Ayer"
  // (sourceDay = date-1) and "Pegar" (sourceDay = copiedDay). Water is not copied:
  // it is logged with the day's glasses.
  async function copyEntriesFrom(sourceDay) {
    const { data: srcEntries } = await supabase
      .from('entries')
      .select('meal_label_id, food_id, recipe_id, grams')
      .eq('day', sourceDay);
    const toCopy = srcEntries?.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id)) || [];
    if (toCopy.length === 0) {
      showToast(t('Ese día no tiene registros.'));
      return;
    }
    const rows = toCopy.map((e) => ({ ...e, day: date }));
    const { error } = await supabase.from('entries').insert(rows);
    if (error) {
      showToast(t('Error al copiar.'));
      return;
    }
    showToast(t('%n registros copiados.').replace('%n', rows.length));
    loadDay(true);
  }

  function handleCopyDay() {
    setCopiedDay(date);
    localStorage.setItem('nutri.today.copiedDay', date);
    showToast(t('Día copiado.'));
  }

  // Meal templates (MFP's "Meals"): a set of foods saved under a name in
  // prefs.data.meal_templates (no migration) and reinsertable on any date.
  // Water is not included (foodEntries already excludes it).
  async function saveTemplate(name) {
    const nm = name.trim();
    if (!nm) return;
    const items = foodEntries.map((e) => ({
      meal_label_id: e.meal_label_id ?? null,
      food_id: e.food_id ?? null,
      recipe_id: e.recipe_id ?? null,
      grams: Number(e.grams),
    }));
    if (!items.length) {
      showToast(t('Este día no tiene alimentos.'));
      return;
    }
    const next = [...(prefs.meal_templates || []), { id: crypto.randomUUID(), name: nm, items }];
    await savePrefs({ meal_templates: next });
    showToast(t('Plantilla guardada.'));
  }

  async function deleteTemplate(id) {
    const prevList = prefs.meal_templates || [];
    await savePrefs({ meal_templates: prevList.filter((tp) => tp.id !== id) });
    setUndoTpl((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndoTpl(null), 5000);
      return { list: prevList, timer };
    });
  }

  // The template lives in a prefs array: undo = rewrite the previous array.
  async function undoDeleteTemplate() {
    if (!undoTpl) return;
    clearTimeout(undoTpl.timer);
    const { list } = undoTpl;
    setUndoTpl(null);
    await savePrefs({ meal_templates: list });
  }

  // Inserts the template on the current date. Filters out items whose food/recipe no
  // longer exists (a single SELECT per type): a deleted id would break the entire
  // insert via the FK, so they are discarded and the count is reported.
  async function addTemplate(tpl) {
    const foodIds = tpl.items.filter((i) => i.food_id).map((i) => i.food_id);
    const recipeIds = tpl.items.filter((i) => i.recipe_id).map((i) => i.recipe_id);
    const [{ data: fRows }, { data: rRows }] = await Promise.all([
      foodIds.length ? supabase.from('foods').select('id').in('id', foodIds) : Promise.resolve({ data: [] }),
      recipeIds.length ? supabase.from('recipes').select('id').in('id', recipeIds) : Promise.resolve({ data: [] }),
    ]);
    const okFoods = new Set((fRows || []).map((r) => r.id));
    const okRecipes = new Set((rRows || []).map((r) => r.id));
    const valid = tpl.items.filter((i) => (i.food_id ? okFoods.has(i.food_id) : okRecipes.has(i.recipe_id)));
    if (!valid.length) {
      showToast(t('Las comidas de esta plantilla ya no existen.'));
      return;
    }
    const rows = valid.map((i) => ({
      meal_label_id: i.meal_label_id ?? null,
      food_id: i.food_id ?? null,
      recipe_id: i.recipe_id ?? null,
      grams: i.grams,
      day: date,
    }));
    const { error } = await supabase.from('entries').insert(rows);
    if (error) {
      showToast(t('Error al añadir.'));
      return;
    }
    const dropped = tpl.items.length - valid.length;
    showToast(
      dropped
        ? t('%n añadidos · %m omitidos').replace('%n', rows.length).replace('%m', dropped)
        : t('%n registros copiados.').replace('%n', rows.length),
    );
    setTemplatesOpen(false);
    loadDay(true);
  }

  // Deletes the day's foods (not water, which is tracked by glasses). Destructive
  // and irreversible: confirms first with ConfirmSheet.
  function handleDeleteDay() {
    const foods = entries.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id));
    if (foods.length === 0) {
      showToast(t('Este día no tiene alimentos.'));
      return;
    }
    setConfirmingDeleteDay(true);
  }

  async function doDeleteDay() {
    const foods = entries.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id));
    const { error } = await supabase.from('entries').delete().in('id', foods.map((e) => e.id));
    setConfirmingDeleteDay(false);
    if (error) {
      showToast(t('Error al borrar.'));
      return;
    }
    showToast(t('%n registros borrados.').replace('%n', foods.length));
    loadDay(true);
  }

  // Publishes Ayer/Copiar/Pegar in the layout's "Más opciones" button (App.jsx).
  // "Ayer" only when the date is today; "Pegar" only with a copied day.
  useEffect(() => {
    const actions = [];
    if (date === todayISO()) {
      actions.push({ key: 'ayer', label: t('Ayer'), icon: History, onClick: () => copyEntriesFrom(addDaysISO(date, -1)) });
    }
    actions.push({ key: 'copiar', label: t('Copiar'), icon: Copy, onClick: handleCopyDay });
    if (copiedDay) {
      actions.push({
        key: 'pegar',
        label: t('Pegar %n').replace('%n', new Date(copiedDay + 'T00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' })),
        icon: ClipboardPaste,
        onClick: () => copyEntriesFrom(copiedDay),
      });
    }
    actions.push({ key: 'plantillas', label: t('Plantillas'), icon: Bookmark, onClick: () => setTemplatesOpen(true) });
    actions.push({ key: 'importar', label: t('Importar'), icon: Upload, onClick: () => setImporting(true) });
    actions.push({ key: 'borrar', label: t('Borrar día'), icon: Trash2, onClick: handleDeleteDay });
    setSectionMenu(actions);
    return () => setSectionMenu([]);
  }, [date, copiedDay, prefs.water_food_id, entries, lang]);

  // Section "+": on lg+ it does not open the sheet (replaced by the inline quick-add),
  // it only prefills its label and remounts the form (focus via autoFocus); on <lg
  // it keeps the current sheet.
  function handleSectionAdd(labelId) {
    if (isLg) {
      setQuickAddInitialLabel(labelId);
      setQuickAddKey((k) => k + 1);
    } else {
      setAdding({ labelId });
    }
  }

  const waterEntries = entries.filter((e) => e.food_id && e.food_id === prefs.water_food_id);
  const foodEntries = entries.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id));
  const waterMl = waterEntries.reduce((s, e) => s + Number(e.grams), 0); // density 1: grams = ml

  // Config of the active layout and of the mini (the fixed mini-summary shares it).
  // Totals are summed once for the union of the keys in use; sodium is
  // always included (medical rule) and the base keys come for free.
  const activeView = VIEW_CYCLE.includes(prefs.today_view) ? prefs.today_view : 'estado';
  const viewCfg = cardCfg(prefs, activeView);
  const miniCfg = cardCfg(prefs, 'mini');
  const totalKeys = [...new Set([...BASE_ITEMS, ...viewCfg.items, ...miniCfg.items])];
  const totals = foodEntries.reduce((acc, e) => {
    for (const k of totalKeys) acc[k] += Number((MACRO_META[k] ? e[k] : e.micros?.[k]) || 0);
    return acc;
  }, Object.fromEntries(totalKeys.map((k) => [k, 0])));

  // Totals the summary sees: the real ones + the delta of the entry being edited
  // (same per-100g scaling as AportaPanel). Without a preview, they are the real ones.
  const displayTotals = preview?.meta
    ? totalKeys.reduce((acc, k) => {
        const per100 = MACRO_META[k] ? preview.meta[k] : preview.meta.micros?.[k];
        acc[k] = totals[k] + Number(per100 || 0) * ((Number(preview.grams) || 0) / 100)
          - (preview.minus ? Number((MACRO_META[k] ? preview.minus[k] : preview.minus.micros?.[k]) || 0) : 0);
        return acc;
      }, { ...totals })
    : totals;

  const target = resolveTarget(targets, date);

  // Day-summary strip for the add/edit sheets (<lg): the sheet covers the
  // summary card, so this strip keeps the day's context in view.
  // Reuses MiniGrid (identical to the fixed mini-summary). Null if there is nothing to summarize.
  const daySummaryStrip = (target != null || foodEntries.length > 0) && (
    <div className="flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-wide text-text-3 flex-none">{t('Hoy')}</span>
      <div className="min-w-0">
        <MiniGrid cfg={miniCfg} totals={displayTotals} target={target} hasFood={foodEntries.length > 0} />
      </div>
    </div>
  );

  const groups = groupByLabel(foodEntries, labels, activeEntry != null);

  return (
    <div className="px-4 pt-4 pb-20 grid grid-cols-1 gap-4 lg:gap-x-6 lg:grid-cols-[1fr_320px] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start">
      {importing && (
        <ImportSheet
          kind="entries"
          onClose={() => setImporting(false)}
          onDone={(n) => { setImporting(false); showToast(t('%n registros importados.').replace('%n', n)); loadDay(true); }}
        />
      )}
      <div className="flex items-center justify-between lg:col-start-1">
        <button onClick={() => setDate(addDaysISO(date, -1))} className="p-2 press" aria-label={t('Día anterior')}>
          <ChevronLeft size={22} />
        </button>
        <div className="relative flex-1 flex justify-center">
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            aria-label={t('Elegir fecha')}
          />
          <span className="pointer-events-none font-display text-lg">
            {date === todayISO()
              ? t('Hoy')
              : new Date(date + 'T00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>
        <button onClick={() => setDate(addDaysISO(date, 1))} className="p-2 press" aria-label={t('Día siguiente')}>
          <ChevronRight size={22} />
        </button>
      </div>

      {/* Inline quick-add: lg+ only, replaces the FAB+sheet flow. */}
      <div className="hidden lg:block lg:col-start-1">
        <div className="rounded-2xl bg-surface border border-border p-4">
          <AddEntryForm
            key={quickAddKey}
            date={date}
            labels={labels}
            waterFoodId={prefs.water_food_id}
            initialLabelId={quickAddInitialLabel}
            inputRef={quickAddInputRef}
            autoFocus={quickAddKey > 0}
            onPreview={setPreview}
            onAdded={(labelId) => {
              setQuickAddKey((k) => k + 1);
              setQuickAddInitialLabel(null);
              loadDay(true).then(() => scrollToSection(labelId));
            }}
          />
        </div>
      </div>

      <MiniSummary
        visible={miniVisible}
        top={miniTop}
        cfg={miniCfg}
        totals={displayTotals}
        target={target}
        hasFood={foodEntries.length > 0}
        onTap={scrollToSummary}
      />

      <div className="lg:hidden" ref={summaryCardRef}>
        <SummaryCard
          view={activeView}
          cfg={viewCfg}
          onToggleView={toggleTodayView}
          onConfig={() => setCardConfigOpen(true)}
          totals={displayTotals}
          target={target}
          hasFood={foodEntries.length > 0}
        />
      </div>

      {/* Right rail (lg+): sticky, shows the day's summary or the active entry's editor. */}
      {/* The rail spans col-1's 4 rows (grid-rows-[auto_auto_auto_1fr] on the container).
          Without those explicit rows, `1/-1` collapses to span-1 and inflates row 1 with the
          rail's height (gap in col-1). The 1fr row absorbs the rail's overflow at the bottom. */}
      <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1 lg:[grid-row:1/-1] lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
        {/* Day summary: always present in the rail (lg). While editing it stays pinned
            above the editor (sticky within the scrollable rail) so the totals/targets
            are not lost while adjusting an amount. Its own bg to cover the
            editor scrolling underneath. */}
        <div className="hidden lg:block lg:sticky lg:top-0 lg:z-10 bg-bg rounded-2xl">
          <SummaryCard
            view={activeView}
            cfg={viewCfg}
            onToggleView={toggleTodayView}
            onConfig={() => setCardConfigOpen(true)}
            totals={displayTotals}
            target={target}
            hasFood={foodEntries.length > 0}
          />
        </div>

        {isLg && editing ? (
          <div key={editing.id} className="reveal-in rounded-2xl bg-surface border border-border p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg">{editing.item}{editing.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{editing.brand}</span>}</h2>
              <button onClick={() => setEditing(null)} className="p-2 -mr-2 press" aria-label={t('Cerrar')}>
                <X size={20} />
              </button>
            </div>
            <EditEntryForm
              entry={editing}
              labels={labels}
              favMicros={prefs.fav_micros || []}
              onPreview={setPreview}
              onDelete={() => {
                deleteEntry(editing);
                setEditing(null);
              }}
              onSaved={() => {
                setEditing(null);
                loadDay(true);
              }}
            />
          </div>
        ) : (
          <WaterCard
            waterMl={Math.max(0, waterMl + pendingWaterMl)}
            goalMl={Number(target?.micros?.agua_ml) || 0}
            glassMl={prefs.water_glass_ml}
            onGlass={() => addWater(prefs.water_glass_ml)}
            onUndo={undoWater}
            onCustom={addWater}
            onSettings={() => setWaterSettingsOpen(true)}
          />
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-2 lg:col-start-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-surface animate-pulse" />
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && labels.length === 0 && (
        <p className="text-text-2 text-center py-6 lg:col-start-1">{t('Sin registros este día')}</p>
      )}

      {!loading && (
        <div className="flex flex-col gap-4 lg:col-start-1">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={labels.map((l) => `section-${l.id}`)} strategy={verticalListSortingStrategy}>
              {groups.map((g) =>
                g.id != null ? (
                  <SortableSection
                    key={g.id}
                    group={g}
                    isOver={dragOverSection === g.id}
                    dimmed={draggingSection != null && draggingSection !== g.id}
                    editingId={editing?.id}
                    collapsed={collapsed.has(String(g.id))}
                    onToggle={() => toggleCollapsed(String(g.id))}
                    onAdd={() => handleSectionAdd(g.id)}
                    onEditEntry={setEditing}
                    onDeleteEntry={deleteEntry}
                  />
                ) : (
                  <DropOnlySection
                    key="none"
                    group={g}
                    isOver={dragOverSection === 'none'}
                    dimmed={draggingSection != null}
                    editingId={editing?.id}
                    collapsed={collapsed.has('none')}
                    onToggle={() => toggleCollapsed('none')}
                    onEditEntry={setEditing}
                    onDeleteEntry={deleteEntry}
                  />
                )
              )}
            </SortableContext>
            <DragOverlay>
              {activeEntry && (
                <div className="rounded-2xl bg-surface border border-border p-3 flex justify-between items-center gap-3 shadow-lg scale-[1.02]">
                  <CardBody entry={activeEntry} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      <button
        onClick={() => setAdding({ labelId: null })}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-full bg-accent-deep text-on-accent flex items-center justify-center press lg:hidden"
        aria-label={t('Añadir registro')}
      >
        <Plus size={24} />
      </button>

      {confirmingDeleteDay && (
        <ConfirmSheet
          title={t('Borrar día')}
          body={t('¿Borrar los %n registros de alimentos de este día? No se puede deshacer.').replace(
            '%n',
            entries.filter((e) => !(e.food_id && e.food_id === prefs.water_food_id)).length
          )}
          confirmLabel={t('Borrar día')}
          onConfirm={doDeleteDay}
          onClose={() => setConfirmingDeleteDay(false)}
        />
      )}

      {templatesOpen && (
        <MealTemplatesSheet
          templates={prefs.meal_templates || []}
          canSave={foodEntries.length > 0}
          onSave={saveTemplate}
          onAdd={addTemplate}
          onDelete={deleteTemplate}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      {cardConfigOpen && (
        <SummaryConfigSheet
          view={activeView}
          prefs={prefs}
          onPatch={(view, patch) => saveCardCfg(view, patch)}
          onSync={(on) => setCardSync(on, activeView)}
          onClose={() => setCardConfigOpen(false)}
        />
      )}

      {waterSettingsOpen && (
        <Sheet title={t('Ajustes de agua')} onClose={() => setWaterSettingsOpen(false)}>
          <WaterSettingsForm
            glassMl={prefs.water_glass_ml}
            onSave={(ml) => {
              savePrefs({ water_glass_ml: ml });
              setWaterSettingsOpen(false);
            }}
          />
        </Sheet>
      )}

      {adding && (
        <AddEntrySheet
          date={date}
          labels={labels}
          waterFoodId={prefs.water_food_id}
          initialLabelId={adding.labelId}
          subheader={daySummaryStrip}
          onPreview={setPreview}
          onClose={() => setAdding(null)}
          onAdded={(labelId) => {
            setAdding(null);
            loadDay(true).then(() => scrollToSection(labelId));
          }}
        />
      )}

      {editing && !isLg && (
        <EditEntrySheet
          entry={editing}
          labels={labels}
          favMicros={prefs.fav_micros || []}
          subheader={daySummaryStrip}
          onPreview={setPreview}
          onClose={() => setEditing(null)}
          onDelete={() => {
            deleteEntry(editing);
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            loadDay(true);
          }}
        />
      )}

      {undoData && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 flex items-center justify-between gap-3 lg:left-auto lg:right-6 lg:bottom-6"
        >
          <span className="text-sm">{t('Registro borrado')}</span>
          <button
            onClick={handleUndo}
            className="min-h-[44px] px-3 text-accent font-medium press"
          >
            {t('Deshacer')}
          </button>
        </div>
      )}

      {undoTpl && <UndoToast message={t('Plantilla borrada')} onUndo={undoDeleteTemplate} />}

      {!undoData && !undoTpl && toast && (
        <div role="status" aria-live="polite" className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 text-center text-sm lg:left-auto lg:right-6 lg:bottom-6">
          {toast}
        </div>
      )}
    </div>
  );
}

// While dragging a section it must only collide with other sections (otherwise,
// closestCorners would resolve `over` to an inner card and the reorder would fail).
// While dragging a card, closestCorners resolves to the sibling card or the container.
function collisionDetectionStrategy(args) {
  if (args.active?.data?.current?.type === 'section') {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith('section-')),
    });
  }
  return closestCorners(args);
}

// One section per label (even if empty), in the order of `labels`
// (they already come by sort_order); "Sin etiqueta" at the end if it has items, or while
// a card is being dragged (so it can be dropped there to remove its label).
function groupByLabel(entries, labels, showEmptyNone) {
  const groups = labels.map((l) => ({ id: l.id, name: l.name, items: [] }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const none = { id: null, name: t('Sin etiqueta'), items: [] };
  for (const e of entries) {
    (byId.get(e.meal_label_id) ?? none).items.push(e);
  }
  return none.items.length > 0 || showEmptyNone ? [...groups, none] : groups;
}

function sectionTotals(items) {
  return items.reduce((a, e) => ({
    kcal: a.kcal + Number(e.kcal),
    protein_g: a.protein_g + Number(e.protein_g),
    carbs_g: a.carbs_g + Number(e.carbs_g),
    fat_g: a.fat_g + Number(e.fat_g),
    sodio_mg: a.sodio_mg + Number(e.micros?.sodio_mg || 0),
    potasio_mg: a.potasio_mg + Number(e.micros?.potasio_mg || 0),
    magnesio_mg: a.magnesio_mg + Number(e.micros?.magnesio_mg || 0),
  }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodio_mg: 0, potasio_mg: 0, magnesio_mg: 0 });
}

// Summary bar = level 1 (section total): neutral background; with entries, the
// title and border switch to lime (a discreet recolor that distinguishes it from an
// empty section). Colored macros + micros (Na/K/Mg, lg only) and large kcal on the right.
// Clicking the left zone collapses/expands. `dragProps` = dnd-kit listeners
// (a 150 ms long-press on the bar drags the section; "+" does stopPropagation).
function SectionBar({ name, items, isOver, collapsed, onToggle, onAdd, dragProps, dragging }) {
  const tot = sectionTotals(items);
  const has = items.length > 0;
  const label = (
    <>
      <span className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold ${has ? 'text-accent' : 'text-text-2'}`}>
        {has && <ChevronDown size={13} className={`transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`} />}
        {name}
      </span>
      {has && (
        <span className="mt-0.5 text-[13px] font-mono tabular-nums font-medium flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {tot.protein_g > 0 && <span className="text-d-prot">P {round(tot.protein_g, 1)}</span>}
          {tot.carbs_g > 0 && <span className="text-d-carb">C {round(tot.carbs_g, 1)}</span>}
          {tot.fat_g > 0 && <span className="text-d-fat">{t('G')} {round(tot.fat_g, 1)}</span>}
          {tot.sodio_mg > 0 && <span className="hidden lg:inline text-text-3">Na {round(tot.sodio_mg, 0)}</span>}
          {tot.potasio_mg > 0 && <span className="hidden lg:inline text-text-3">K {round(tot.potasio_mg, 0)}</span>}
          {tot.magnesio_mg > 0 && <span className="hidden lg:inline text-text-3">Mg {round(tot.magnesio_mg, 0)}</span>}
        </span>
      )}
    </>
  );
  return (
    <div
      {...dragProps}
      className={`flex items-center justify-between gap-2 rounded-xl border bg-surface-2 px-3 py-2.5 min-h-[44px] transition-colors ${dragging ? 'cursor-grabbing' : ''}`}
      style={{
        borderColor: dragging
          ? 'color-mix(in srgb, var(--accent) 70%, transparent)'
          : isOver
          ? 'color-mix(in srgb, var(--accent) 55%, transparent)'
          : has
          ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
          : 'var(--border)',
      }}
    >
      {has ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? t('Expandir') : t('Contraer')} ${name}`}
          className="min-w-0 flex-1 flex flex-col text-left"
        >
          {label}
        </button>
      ) : (
        <div className="min-w-0 flex-1 flex flex-col">{label}</div>
      )}
      <div className="flex items-center gap-1 flex-none -mr-1">
        {has && (
          <span className="font-mono tabular-nums text-xl font-semibold text-text leading-none">
            {round(tot.kcal, 0)}<span className="text-xs font-normal text-text-2 ml-0.5">kcal</span>
          </span>
        )}
        {onAdd && (
          <button
            onClick={onAdd}
            onMouseDown={(ev) => ev.stopPropagation()}
            onTouchStart={(ev) => ev.stopPropagation()}
            className="p-2.5 text-accent press"
            aria-label={t('Añadir a %n').replace('%n', name)}
          >
            <Plus size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

// Section for a real label: reorderable (long-press on its bar) and droppable
// (cards from other sections). While dragging it "lifts" like a slab: the outer node only
// translates (dnd-kit overrides its transition, so scale/rotate there would jump); the inner
// one animates scale, tilt, accent halo and shadow. The other sections are dimmed (`dimmed`).
function SortableSection({ group: g, isOver, dimmed, editingId, collapsed, onToggle, onAdd, onEditEntry, onDeleteEntry }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `section-${g.id}`,
    data: { type: 'section', labelId: g.id },
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 20 } : null),
  };

  return (
    <div ref={setNodeRef} style={style} id={`sec-${g.id}`}>
      <div
        className={`flex flex-col gap-2 rounded-2xl transition-[transform,opacity,box-shadow] duration-200 ease-out motion-reduce:transition-none ${
          isDragging ? 'scale-[1.015] -rotate-[0.4deg]' : dimmed ? 'opacity-40 scale-[0.99]' : ''
        }`}
        style={
          isDragging
            ? {
                boxShadow:
                  '0 22px 48px -18px rgba(0,0,0,.65), 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent), 0 0 22px -6px color-mix(in srgb, var(--accent) 35%, transparent)',
              }
            : undefined
        }
      >
        <SectionBar
          name={g.name}
          items={g.items}
          isOver={isOver}
          collapsed={collapsed}
          onToggle={onToggle}
          onAdd={onAdd}
          dragProps={listeners}
          dragging={isDragging}
        />
        {!collapsed && (
          <SortableContext items={g.items.map((e) => `card-${e.id}`)} strategy={verticalListSortingStrategy}>
            {g.items.map((e) => (
              <SwipeCard key={e.id} entry={e} labelId={g.id} editing={e.id === editingId} onEdit={() => onEditEntry(e)} onDelete={() => onDeleteEntry(e)} />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  );
}

// "Sin etiqueta": the section is not reorderable, but its cards are; droppable for cross-section moves.
function DropOnlySection({ group: g, isOver, dimmed, editingId, collapsed, onToggle, onEditEntry, onDeleteEntry }) {
  const { setNodeRef } = useDroppable({ id: 'section-none', data: { type: 'section', labelId: null } });
  return (
    <div
      ref={setNodeRef}
      id="sec-none"
      className={`flex flex-col gap-2 rounded-2xl transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${dimmed ? 'opacity-40 scale-[0.99]' : ''}`}
    >
      <SectionBar name={g.name} items={g.items} isOver={isOver} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <SortableContext items={g.items.map((e) => `card-${e.id}`)} strategy={verticalListSortingStrategy}>
          {g.items.map((e) => (
            <SwipeCard key={e.id} entry={e} labelId={g.id} editing={e.id === editingId} onEdit={() => onEditEntry(e)} onDelete={() => onDeleteEntry(e)} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

// Intake card: tap → edit, immediate horizontal drag → swipe (delete),
// 150 ms long-press without moving → drag between sections (dnd-kit). The swipe lives in
// SwipeToDelete (shared with Objetivos); its movement threshold (8 px) matches
// dnd-kit's tolerance so both gestures "auto-cancel" each other consistently.
// On lg+ with a pointer (hover/focus-within), ✎/✕ icons appear on the right — a separate
// layer (not inside the swipe's <button>: nesting <button> breaks the HTML).
function SwipeCard({ entry: e, labelId, editing, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${e.id}`,
    data: { type: 'card', entryId: e.id, labelId },
  });
  // Sortable's transform → the neighboring cards "make room". The active card is
  // rendered by the DragOverlay, so we do not move it here (!isDragging).
  const style = transform && !isDragging ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition } : undefined;
  return (
    <div style={style} className="relative group rounded-2xl">
      {editing && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-accent" />}
      <SwipeToDelete
        onDelete={onDelete}
        onTap={onEdit}
        dragDisabled={isDragging}
        dragListeners={listeners}
        nodeRef={setNodeRef}
        dragAttributes={attributes}
        className={`${editing ? 'bg-surface-2' : 'bg-surface'} border border-border p-3 flex justify-between items-center gap-3 ${isDragging ? 'opacity-30' : ''}`}
      >
        <CardBody entry={e} />
      </SwipeToDelete>
      <div className="hidden lg:group-hover:flex lg:group-focus-within:flex absolute right-3 top-1/2 -translate-y-1/2 gap-1 bg-surface rounded-lg">
        <button
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => {
            ev.stopPropagation();
            onEdit();
          }}
          className="p-1.5 text-text-2 hover:text-accent"
          aria-label={t('Editar')}
        >
          <Pencil size={16} />
        </button>
        <button
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete();
          }}
          className="p-1.5 text-text-2 hover:text-danger"
          aria-label={t('Borrar')}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

// Inner content of a card, shared between SwipeCard and the DragOverlay ghost.
function CardBody({ entry: e }) {
  const highNa = Number(e.micros?.sodio_mg || 0) >= SODIUM_HIGH_MG;
  const highK = Number(e.micros?.potasio_mg || 0) >= POTASSIUM_HIGH_MG;
  return (
    <>
      <div className="min-w-0">
        <p className="font-medium">{e.item}{e.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{e.brand}</span>}</p>
        <div className="text-sm font-mono tabular-nums mt-0.5 text-text-2 flex flex-wrap items-center gap-y-0.5 [&>.sep]:text-text-3 [&>.sep]:mx-1.5">
          <span>{fmtG(e.grams)}</span>
          {Number(e.protein_g) > 0 && <><span className="sep">|</span><span>P {round(Number(e.protein_g), 1)}</span></>}
          {Number(e.carbs_g) > 0 && <><span className="sep">|</span><span>C {round(Number(e.carbs_g), 1)}</span></>}
          {Number(e.fat_g) > 0 && <><span className="sep">|</span><span>{t('G')} {round(Number(e.fat_g), 1)}</span></>}
          {Number(e.micros?.sodio_mg) > 0 && <><span className="sep hidden lg:inline">|</span><span className="hidden lg:inline">Na {round(Number(e.micros.sodio_mg), 0)}</span></>}
          {Number(e.micros?.potasio_mg) > 0 && <><span className="sep hidden lg:inline">|</span><span className="hidden lg:inline">K {round(Number(e.micros.potasio_mg), 0)}</span></>}
          {Number(e.micros?.magnesio_mg) > 0 && <><span className="sep hidden lg:inline">|</span><span className="hidden lg:inline">Mg {round(Number(e.micros.magnesio_mg), 0)}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {highNa && (
          <span title={t('Alto en sodio')} className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-danger/20 text-danger">
            Na {round(Number(e.micros.sodio_mg), 0)}
          </span>
        )}
        {highK && (
          <span title={t('Alto en potasio')} className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-warn/20 text-warn">
            K {round(Number(e.micros.potasio_mg), 0)}
          </span>
        )}
        <span className="font-mono tabular-nums text-text-2">{e.kcal} kcal</span>
      </div>
    </>
  );
}

function WaterCard({ waterMl, goalMl, glassMl, onGlass, onUndo, onCustom, onSettings }) {
  const units = useUnits();
  const isUS = units === 'us';
  const [customAmount, setCustomAmount] = useState('');
  const filled = glassMl > 0 ? Math.floor(waterMl / glassMl) : 0;
  // Fraction of the glass in progress (index `filled`): partially fills that glass
  // so that sub-glass water (a manual log < one glass) IS visible.
  const frac = glassMl > 0 ? (waterMl % glassMl) / glassMl : 0;
  // ponytail: 16-glass cap in case target/glass yields an absurd number
  const count = Math.min(Math.max(goalMl > 0 ? Math.ceil(goalMl / glassMl) : 3, filled + 1), 16);

  // On ADDING water (click or manual) the liquid of the highest glass with water rises
  // with a wave. Keyed on waterMl, NOT on `filled`: this way a partial manual add —one
  // that does not complete a glass— also animates. splash = index of the animated glass.
  const prevWaterRef = useRef(waterMl);
  const [splash, setSplash] = useState(-1);
  useEffect(() => {
    const prev = prevWaterRef.current;
    prevWaterRef.current = waterMl;
    if (waterMl <= prev) return undefined;
    setSplash(frac > 0 ? filled : filled - 1);
    const timer = setTimeout(() => setSplash(-1), 1400);
    return () => clearTimeout(timer);
  }, [waterMl, filled, frac]);

  return (
    <section className="rounded-2xl bg-surface border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          {t('Agua')}{' '}
          <span className="text-sm text-text-3 font-mono tabular-nums">
            {fmtMl(waterMl)}{goalMl > 0 ? ` / ${fmtMl(goalMl)}` : ''}
          </span>
        </h2>
        <button
          onClick={onSettings}
          className="p-2 -mr-2 text-text-3 press"
          aria-label={t('Ajustes de agua')}
        >
          <Settings size={18} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: count }, (_, i) => {
          const isFilled = i < filled;
          const isPartial = i === filled && frac > 0; // glass in progress, partially full
          return (
            <button
              key={i}
              onClick={() => (isFilled ? onUndo() : onGlass())}
              className={`relative overflow-hidden w-11 h-11 rounded-xl border border-border flex items-center justify-center press ${
                isFilled ? 'bg-surface-2 text-d-carb' : 'text-text-3'
              }`}
              aria-label={isFilled ? t('Quitar último registro de agua') : t('Añadir vaso de %n').replace('%n', fmtMl(glassMl))}
            >
              {(isFilled || isPartial) && (
                <span
                  aria-hidden="true"
                  className={`water-liquid ${i === splash ? 'water-liquid-rise' : ''}`}
                  style={isPartial ? { height: `${frac * 68}%` } : undefined}
                />
              )}
              <GlassWater size={22} className="relative" />
              {i === filled && <Plus size={11} className="absolute top-1 right-1 text-text-2" />}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(customAmount);
          if (n > 0) {
            onCustom(isUS ? flOzToMl(n) : n);
            setCustomAmount('');
          }
        }}
        className="flex gap-2"
      >
        <input
          type="number"
          inputMode="decimal"
          min="1"
          step="any"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          placeholder={isUS ? t('Cantidad (fl oz)') : t('Cantidad (ml)')}
          className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          className="min-h-[44px] px-4 rounded-xl border border-border text-text-2 press"
        >
          {t('Añadir')}
        </button>
      </form>
    </section>
  );
}

function WaterSettingsForm({ glassMl, onSave }) {
  const units = useUnits();
  const isUS = units === 'us';
  const [amount, setAmount] = useState(String(isUS ? round(mlToFlOz(glassMl), 1) : glassMl));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(amount);
        if (n > 0) onSave(isUS ? flOzToMl(n) : n);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">{isUS ? t('Tamaño de vaso (fl oz)') : t('Tamaño de vaso (ml)')}</label>
        <input
          type="number"
          inputMode="decimal"
          min="1"
          step="any"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="min-h-[44px] rounded-xl bg-surface-2 border border-border px-3 text-text font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <button
        type="submit"
        className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press"
      >
        {t('Guardar')}
      </button>
    </form>
  );
}

// Cell of the Estado grid. The mode decides the featured variable: 'meta' =
// current value (+ /target), 'delta'/'pct' = remainder (✓ when met); the small
// line always anchors the value/target context.
function Stat({ state, mode }) {
  const { meta, value, tgt, color, goal } = state;
  const d = meta.decimals;
  const met = metFor(meta, value, tgt, goal);
  const showDelta = mode !== 'meta' && tgt != null;
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg ${color}`}>
        {!showDelta ? round(value, d) : met ? <Check size={18} className="inline" aria-label={t('en meta')} /> : deltaText(mode, value - tgt, tgt, d)}
      </p>
      <p className="text-xs text-text-3">{t(meta.label)}</p>
      {tgt != null && (
        <p className="text-xs text-text-3 font-mono tabular-nums">
          {mode === 'meta' ? `/${round(tgt, d)}` : `${round(value, d)}/${round(tgt, d)}`}
        </p>
      )}
    </div>
  );
}

// Bar row of the Objetivos layout: it features the mode's variable (−N,
// −N% or value/target). Target met → check + dimmed row; the empty
// stretch of the bar uses the nutrient's own color (faint).
function RailStat({ state, mode }) {
  const { meta, value, tgt, pct, color, goal } = state;
  const d = meta.decimals;
  const has = tgt != null;
  const met = metFor(meta, value, tgt, goal);
  return (
    <div className={`${color}${met ? ' opacity-60' : ''}`}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-sm bg-current" />
          <span className="text-text-3">{t(meta.label)}</span>
        </span>
        <span className="flex items-baseline gap-2 font-mono tabular-nums">
          {met ? (
            <Check size={14} className="self-center" />
          ) : !has ? (
            <span>{round(value, d)} {meta.unit}</span>
          ) : mode === 'meta' ? (
            <span>{round(value, d)}/{round(tgt, d)} {meta.unit}</span>
          ) : (
            <span>{deltaText(mode, value - tgt, tgt, d)}{mode === 'delta' ? ` ${meta.unit}` : ''}</span>
          )}
          {has && mode !== 'meta' && <span className="text-text-3 text-xs">{round(value, d)}/{round(tgt, d)}</span>}
        </span>
      </div>
      {has && (
        <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, currentColor 16%, transparent)' }}>
          <div className="h-full bg-current rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
    </div>
  );
}

// Per-100 g values (kcal, macros, micros) + portions/density (foods only,
// for chips and the g/ml toggle) of the selected food or recipe.
function useFoodMeta(foodId, recipeId) {
  const key = foodId ? `foodmeta:${foodId}` : recipeId ? `recipemeta:${recipeId}` : null;
  // SWR cache seed: reopening a card for the same food renders instantly
  // (portion chips included); the background refetch corrects it if it changed.
  const [meta, setMeta] = useState(() => (key && cacheGet(key)) || null);
  useEffect(() => {
    setMeta((key && cacheGet(key)) || null);
    if (!key) return;
    let alive = true;
    const query = foodId
      ? supabase.from('foods').select('kcal, protein_g, carbs_g, fat_g, micros, portions, density_g_ml').eq('id', foodId).maybeSingle()
      : Promise.all([
          supabase.from('recipe_per_100g').select('kcal, protein_g, carbs_g, fat_g, micros').eq('recipe_id', recipeId).maybeSingle(),
          supabase.from('recipes').select('portions').eq('id', recipeId).maybeSingle(),
        ]).then(([n, r]) => ({ data: n.data ? { ...n.data, portions: r.data?.portions || [] } : null }));
    query.then(({ data }) => {
      if (data) cacheSet(key, data);
      if (alive && data) setMeta(data);
    });
    return () => { alive = false; };
  }, [foodId, recipeId]);
  return meta;
}

// Core of "add entry": search box with recents, amount and label.
// Reused by AddEntrySheet (sheet, <lg) and the inline quick-add (rail, lg+).
// Keyboard navigation over results: ↓/↑ moves the selection, Enter confirms it.
function AddEntryForm({ date, labels, waterFoodId, initialLabelId, onAdded, inputRef, autoFocus, onPreview }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState(null); // { id, name, type }
  const [grams, setGrams] = useState('');
  const [presetGrams, setPresetGrams] = useState(null);
  const [labelId, setLabelId] = useState(initialLabelId || '');
  const [frequent, setFrequent] = useState([]);
  const foodMeta = useFoodMeta(selected?.type === 'food' ? selected.id : null, selected?.type === 'recipe' ? selected.id : null);

  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  // "Calculator" preview: reports the chosen food's contribution at the amount
  // in progress. No selection/grams/meta → null (the summary reverts to the real totals).
  useEffect(() => {
    if (!onPreview) return;
    const g = Number(grams === '' ? presetGrams : grams);
    if (!selected || !foodMeta || !(g > 0)) onPreview(null);
    else onPreview({ meta: foodMeta, grams: g, minus: null });
  }, [selected, foodMeta, grams, presetGrams]);
  useEffect(() => () => onPreview?.(null), []); // cleans up on unmount (close/log)

  // Frequent items from the src/lib/frequent.js cache (prefetched when Hoy mounts):
  // opening the sheet does not wait for the network, it only derives the active label's list.
  useEffect(() => {
    let alive = true;
    getFrequent(initialLabelId, waterFoodId).then((list) => { if (alive) setFrequent(list); });
    return () => { alive = false; };
  }, [initialLabelId, waterFoodId]);

  useEffect(() => {
    if (!query.trim() || selected) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const trimmed = query.trim();
      const q = trimmed.replace(/[,()]/g, ' ');
      const [{ data: foods }, { data: recipes }] = await Promise.all([
        supabase.from('foods').select('id,name,brand,source').or(`name.ilike.%${q}%,brand.ilike.%${q}%`).limit(8),
        supabase.from('recipes').select('id,name').ilike('name', `%${q}%`).limit(8),
      ]);
      let foodHits = foods || [];
      // Semantic fallback search: only when ilike yields few hits. It must never
      // break the normal search — embedText already returns null on any failure.
      if (GEMINI_KEY && trimmed.length >= 3 && foodHits.length < 8) {
        try {
          const vec = await embedText(trimmed);
          if (vec) {
            const { data: semantic } = await supabase.rpc('match_foods', { q: JSON.stringify(vec), n: 8 });
            foodHits = mergeFoodResults(foodHits, semantic, 8);
          }
        } catch {
          // ignored: keeps the ilike hits
        }
      }
      const combined = [
        // Agua is logged from its own card, not as food
        ...foodHits.filter((f) => f.id !== waterFoodId).map((f) => ({ ...f, type: 'food' })),
        ...(recipes || []).map((r) => ({ ...r, type: 'recipe' })),
      ];
      // base catalog (usda) last; stable, preserves the order within each group
      combined.sort((a, b) => (a.source === 'usda') - (b.source === 'usda'));
      setResults(combined);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function pick(item, preset) {
    setSelected(item);
    setQuery(item.name);
    setResults([]);
    setGrams('');
    setPresetGrams(preset != null ? String(preset) : null);
  }

  function reset() {
    setSelected(null);
    setQuery('');
    setResults([]);
    setGrams('');
    setPresetGrams(null);
    setLabelId(initialLabelId || '');
  }

  function handleQueryKeyDown(e) {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pick(results[activeIndex]);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const finalGrams = grams === '' ? presetGrams : grams;
    if (!selected || !finalGrams) return;
    const payload = {
      day: date,
      grams: Number(finalGrams),
      meal_label_id: labelId || null,
      food_id: selected.type === 'food' ? selected.id : null,
      recipe_id: selected.type === 'recipe' ? selected.id : null,
    };
    const { error } = await supabase.from('entries').insert(payload);
    if (!error) {
      onAdded(labelId || null);
      // Reloads in the background; updates the list if the form is still mounted (lg+ rail).
      refreshFrequent()
        .then(() => getFrequent(initialLabelId, waterFoodId))
        .then(setFrequent)
        .catch(() => {});
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!selected && frequent.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-3">{t('Elementos frecuentes')}</p>
          <div className="flex flex-wrap gap-2">
            {frequent.map((r) => (
              <button
                key={(r.food_id || r.recipe_id) + r.item}
                onClick={() => pick({ id: r.food_id || r.recipe_id, name: r.item, type: r.food_id ? 'food' : 'recipe' }, r.grams)}
                className="px-3 py-2 rounded-full bg-surface-2 border border-border text-sm press"
              >
                {r.item}{r.brand && <span className="text-text-3 text-xs font-normal ml-1">{r.brand}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-sm text-text-2">{t('Alimento o receta')}</label>
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          onKeyDown={handleQueryKeyDown}
          placeholder={t('Buscar…')}
          className="input"
        />
        {results.length > 0 && (
          <div className="rounded-xl bg-surface-2 border border-border overflow-hidden">
            {results.map((r, i) => (
              <button
                key={r.type + r.id}
                onClick={() => pick(r)}
                className={`w-full text-left px-3 py-2 flex justify-between ${i === activeIndex ? 'bg-surface-3' : 'active:bg-surface-3'}`}
              >
                <span>{r.name}{r.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{r.brand}</span>}</span>
                {r.type === 'recipe' && <span className="text-xs text-text-3">{t('receta')}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {!selected && (
        <button
          type="button"
          onClick={() => navigate('/foods', { state: { newFood: { name: query.trim() } } })}
          className="min-h-[44px] self-start text-sm text-accent press"
        >
          ＋ {t('Nuevo alimento')}
        </button>
      )}

      {selected && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AmountField grams={grams} onGrams={setGrams} meta={foodMeta} placeholder={presetGrams ?? undefined} required={presetGrams == null} />

          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-2">{t('Etiqueta')}</label>
            <select
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
              className="input"
            >
              <option value="">{t('Sin etiqueta')}</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={reset} className="min-h-[44px] flex-1 rounded-xl border border-border text-text-2 press">{t('Cancelar')}</button>
            <button type="submit" className="min-h-[44px] flex-1 rounded-xl bg-accent-deep text-on-accent font-medium press">{t('Registrar')}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddEntrySheet({ date, labels, waterFoodId, initialLabelId, subheader, onClose, onAdded, onPreview }) {
  return (
    <Sheet title={t('Añadir registro')} onClose={onClose} subheader={subheader}>
      <AddEntryForm
        date={date}
        labels={labels}
        waterFoodId={waterFoodId}
        initialLabelId={initialLabelId}
        onPreview={onPreview}
        onAdded={onAdded}
      />
    </Sheet>
  );
}

// Core of "edit entry": amount, label and the "Aporta" panel. Reused
// by EditEntrySheet (sheet, <lg) and the inline edit panel (rail, lg+).
function EditEntryForm({ entry, labels, favMicros, onDelete, onSaved, onPreview }) {
  const [grams, setGrams] = useState('');
  const [labelId, setLabelId] = useState(entry.meal_label_id || '');
  const foodMeta = useFoodMeta(entry.food_id, entry.recipe_id);

  // "Calculator" preview: replaces the entry's saved contribution (minus) with
  // that of the amount being edited. With no meta yet, leaves the real totals.
  useEffect(() => {
    if (!onPreview || !foodMeta) return;
    const g = Number(grams === '' ? entry.grams : grams);
    if (g >= 0) onPreview({ meta: foodMeta, grams: g, minus: entry });
  }, [foodMeta, grams, entry]);
  useEffect(() => () => onPreview?.(null), []); // cleans up on unmount (close/save)

  async function handleSubmit(e) {
    e.preventDefault();
    const finalGrams = grams === '' ? entry.grams : Number(grams);
    const { error } = await supabase
      .from('entries')
      .update({ grams: finalGrams, meal_label_id: labelId || null })
      .eq('id', entry.id);
    if (!error) onSaved();
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <AmountField grams={grams} onGrams={setGrams} meta={foodMeta} placeholder={String(entry.grams)} required={false} />

        <div className="flex flex-col gap-1">
          <label className="text-sm text-text-2">{t('Etiqueta')}</label>
          <select
            value={labelId}
            onChange={(e) => setLabelId(e.target.value)}
            className="input"
          >
            <option value="">{t('Sin etiqueta')}</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="min-h-[44px] rounded-xl bg-accent-deep text-on-accent font-medium press">
          {t('Guardar')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="min-h-[44px] rounded-xl border border-danger text-danger font-medium press"
        >
          {t('Borrar')}
        </button>
      </form>

      <AportaPanel grams={grams || entry.grams} meta={foodMeta} favMicros={favMicros} fallback={entry} />
    </>
  );
}

function EditEntrySheet({ entry, labels, favMicros, subheader, onClose, onDelete, onSaved, onPreview }) {
  return (
    <Sheet title={<>{entry.item}{entry.brand && <span className="text-text-3 text-sm font-normal ml-1.5">{entry.brand}</span>}</>} onClose={onClose} subheader={subheader}>
      <EditEntryForm entry={entry} labels={labels} favMicros={favMicros} onPreview={onPreview} onDelete={onDelete} onSaved={onSaved} />
    </Sheet>
  );
}

// Read-only panel: kcal/macros/micros contributed by the current amount (grams),
// scaling the food/recipe's per-100 g values. Never persisted.
function AportaPanel({ grams, meta, favMicros, fallback }) {
  // No per-100g meta yet (fetch in flight): `fallback` is the entry_nutrients
  // row, with EXACT values for the entry's original grams (computed by the
  // SQL view) — shown as-is with factor 1, without deriving.
  // If the user already edited the grams before meta arrives, those values are
  // stale: a discreet pulse until re-scaling is possible.
  const src = meta || fallback;
  if (!src) return null;
  const stale = !meta && Number(grams) !== Number(fallback?.grams);
  const factor = meta ? (Number(grams) || 0) / 100 : 1;
  const scale = (v, decimals) => round(Number(v || 0) * factor, decimals);

  const visible = MICROS.filter((m, i) => (i < MICROS_DEFAULT || favMicros.includes(m.key)) && m.key !== 'agua_ml');
  const hidden = MICROS.filter((m, i) => i >= MICROS_DEFAULT && !favMicros.includes(m.key) && m.key !== 'agua_ml');

  const microRow = (m) => {
    const v = scale(src.micros?.[m.key], 2);
    return (
      <div key={m.key} className="flex justify-between py-1.5 border-t border-border text-sm">
        <span className="text-text-2">{t(m.label)}</span>
        <span className={`font-mono tabular-nums ${v === 0 ? 'text-text-3' : ''}`}>
          {v} {m.unit}
        </span>
      </div>
    );
  };

  return (
    <section className={`rounded-xl bg-surface-2 border border-border p-3 flex flex-col${stale ? ' animate-pulse' : ''}`}>
      <p className="text-sm text-text-3 mb-2">{t('Aporta')}</p>
      <div className="grid grid-cols-4 gap-2 text-center pb-3 border-b border-border">
        <AportaStat label={t('Kcal')} value={scale(src.kcal, 1)} color="text-d-kcal" />
        <AportaStat label={t('Prot')} value={scale(src.protein_g, 1)} color="text-d-prot" unit="g" />
        <AportaStat label={t('Carbs')} value={scale(src.carbs_g, 1)} color="text-d-carb" unit="g" />
        <AportaStat label={t('Grasa')} value={scale(src.fat_g, 1)} color="text-d-fat" unit="g" />
      </div>
      {visible.map(microRow)}
      {hidden.length > 0 && (
        <details className="mt-1">
          <summary className="min-h-[44px] flex items-center cursor-pointer text-sm text-text-2">{t('Más micros (%n)').replace('%n', hidden.length)}</summary>
          {microGroups(hidden).flatMap(({ cat, items }) => [
            <p key={cat} className="pt-3 pb-1 text-xs uppercase tracking-wide text-text-3">
              {t(cat)}
            </p>,
            ...items.map(microRow),
          ])}
        </details>
      )}
    </section>
  );
}

function AportaStat({ label, value, color, unit }) {
  const isZero = value === 0;
  return (
    <div>
      <p className={`font-mono tabular-nums text-lg ${isZero ? 'text-text-3' : color}`}>
        {value}
        {unit ? ` ${unit}` : ''}
      </p>
      <p className="text-xs text-text-3">{label}</p>
    </div>
  );
}

// Summary customization sheet. Edits the ACTIVE layout (the card's arrows
// switch layouts; here you only decide how to display the data).
// Everything is persisted immediately — the card behind the scrim is the preview.
function SummaryConfigSheet({ view, prefs, onPatch, onSync, onClose }) {
  const cfg = cardCfg(prefs, view);
  const sync = !!prefs.today_card?.sync;
  const addableMacros = Object.values(MACRO_META).filter((m) => !cfg.items.includes(m.key));
  // Water is never in the summary's nutrient list: it has its own card.
  const addableMicros = microGroups(MICROS.filter((m) => !cfg.items.includes(m.key) && m.key !== 'agua_ml'));

  function move(i, dir) {
    const items = [...cfg.items];
    [items[i], items[i + dir]] = [items[i + dir], items[i]];
    onPatch(view, { items });
  }

  // Fixed examples per mode: they show the shape of the datum, not a live computation.
  const MODES = [
    { id: 'delta', label: 'Faltante absoluto', example: '−318 kcal' },
    { id: 'pct', label: 'Faltante en %', example: '−18%' },
    { id: 'meta', label: 'Metas', example: '1482/1800' },
  ];

  return (
    <Sheet title={t('Personalizar resumen')} onClose={onClose}>
      <p className="text-xs text-text-3 -mt-2">{t('Diseño actual')}: {t(VIEW_NAMES[view])} · {t('cámbialo con las flechas de la card')}</p>

      <div className="flex flex-col gap-1" role="radiogroup" aria-label={t('Variable principal')}>
        <p className="text-xs uppercase tracking-wide text-text-3">{t('Variable principal')}</p>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={cfg.mode === m.id}
            onClick={() => onPatch(view, { mode: m.id })}
            className={`min-h-[44px] px-3 rounded-xl flex items-center justify-between text-sm press border ${cfg.mode === m.id ? 'border-accent bg-surface-2 text-text' : 'border-border text-text-2'}`}
          >
            <span>{t(m.label)}</span>
            <span className="font-mono tabular-nums text-xs text-text-3">{m.example}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-text-3">{t('Nutrientes')}</p>
        {view === 'objetivos' && (
          <p className="text-xs text-text-3">{t('El orden asigna el lugar: 1º anillo, 2º–4º barras, resto tarjetas.')}</p>
        )}
        {cfg.items.map((key, i) => {
          const meta = nutrientMeta(key);
          if (!meta) return null;
          return (
            <div key={key} className="flex items-center">
              <span className="flex-1 text-sm truncate">
                {t(meta.label)} <span className="text-text-3 text-xs">{meta.unit}</span>
              </span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="w-11 h-11 flex items-center justify-center text-text-3 press disabled:opacity-30" aria-label={t('Subir')}>
                <ChevronUp size={16} />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === cfg.items.length - 1} className="w-11 h-11 flex items-center justify-center text-text-3 press disabled:opacity-30" aria-label={t('Bajar')}>
                <ChevronDown size={16} />
              </button>
              <button
                onClick={() => onPatch(view, { items: cfg.items.filter((k) => k !== key) })}
                disabled={cfg.items.length <= 1}
                className="w-11 h-11 -mr-2.5 flex items-center justify-center text-text-3 press disabled:opacity-30"
                aria-label={t('Quitar')}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
        <select
          value=""
          onChange={(e) => e.target.value && onPatch(view, { items: [...cfg.items, e.target.value] })}
          className="input"
          aria-label={t('Añadir nutriente')}
        >
          <option value="">{t('Añadir nutriente…')}</option>
          {addableMacros.length > 0 && (
            <optgroup label={t('Básicos')}>
              {addableMacros.map((m) => (
                <option key={m.key} value={m.key}>{t(m.label)}</option>
              ))}
            </optgroup>
          )}
          {addableMicros.map(({ cat, items }) => (
            <optgroup key={cat} label={t(cat)}>
              {items.map((m) => (
                <option key={m.key} value={m.key}>{t(m.label)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="border-t border-border pt-1">
        <CfgToggle label={t('Aplicar a los 3 diseños')} checked={sync} onChange={onSync} />
      </div>
    </Sheet>
  );
}

function CfgToggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full min-h-[44px] flex items-center justify-between text-sm press"
    >
      <span className="text-text-2">{label}</span>
      <span className={`w-9 h-5 rounded-full p-0.5 flex-none transition-colors motion-reduce:transition-none ${checked ? 'bg-accent-deep' : 'bg-surface-2'}`}>
        <span className={`block w-4 h-4 rounded-full transition-transform motion-reduce:transition-none ${checked ? 'bg-on-accent translate-x-4' : 'bg-text-3'}`} />
      </span>
    </button>
  );
}

function Sheet({ title, onClose, children, subheader }) {
  // The backdrop closes on outside tap (the Objetivos Sheet's pattern); the ✕ would
  // be redundant here, so it is omitted — the inline editor's one (lg+ rail, no
  // backdrop) is kept because there is no tap-outside there.
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 backdrop-in">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-surface-3 rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4 max-h-[85dvh] overflow-y-auto sheet-in">
        <h2 className="font-display text-lg">{title}</h2>
        {subheader && <div className="-mt-1 pb-3 border-b border-border">{subheader}</div>}
        {children}
      </div>
    </div>
  );
}
