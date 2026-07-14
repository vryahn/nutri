import { useEffect, useState } from 'react';
import { X, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { reorderLabels } from '../lib/domain.js';
import { t, useLang } from '../lib/i18n.js';
import UndoToast from './UndoToast.jsx';

export default function LabelsModal({ onClose }) {
  useLang();
  const [labels, setLabels] = useState([]);
  const [name, setName] = useState('');
  const [undoLabel, setUndoLabel] = useState(null); // { id, timer } tras archivar una etiqueta, para "Deshacer"

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from('meal_labels').select('*').is('archived_at', null).order('sort_order');
    if (data) setLabels(data);
    // Hoy renderiza secciones por etiqueta sin remontarse cuando este modal cambia algo.
    window.dispatchEvent(new Event('labels-changed'));
  }

  async function addLabel(e) {
    e.preventDefault();
    const nm = name.trim();
    if (!nm) return;
    const maxOrder = labels.reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0);
    const { error } = await supabase.from('meal_labels').insert({ name: nm, sort_order: maxOrder + 1 });
    // 23505 = choca el unique (owner, name) con una etiqueta ARCHIVADA (las vivas ya
    // están en la lista). Revivirla en vez de crear otra fila devuelve sus registros
    // históricos a esta sección, que es de donde salieron. RLS acota el eq('name').
    if (error?.code === '23505') {
      await supabase.from('meal_labels').update({ archived_at: null, sort_order: maxOrder + 1 }).eq('name', nm);
    }
    setName('');
    load();
  }

  async function rename(id, newName) {
    await supabase.from('meal_labels').update({ name: newName }).eq('id', id);
    load();
  }

  // Archivar, no borrar: la FK entries.meal_label_id es ON DELETE SET NULL, así que
  // un delete reescribiría todos los registros históricos de la etiqueta. Archivada,
  // desaparece de la lista y sus registros caen en "Sin etiqueta" (groupByLabel rutea
  // ahí cualquier id que no esté en labels) — mismo efecto visible, reversible.
  async function archive(id) {
    const { error } = await supabase.from('meal_labels').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if (error) return;
    load();
    setUndoLabel((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndoLabel(null), 5000);
      return { id, timer };
    });
  }

  async function undoArchive() {
    if (!undoLabel) return;
    clearTimeout(undoLabel.timer);
    const { id } = undoLabel;
    setUndoLabel(null);
    await supabase.from('meal_labels').update({ archived_at: null }).eq('id', id);
    load();
  }

  async function move(index, dir) {
    const updates = reorderLabels(labels, index, dir);
    if (updates.length === 0) return;
    await Promise.all(updates.map((u) => supabase.from('meal_labels').update({ sort_order: u.sort_order }).eq('id', u.id)));
    load();
  }

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 backdrop-in">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-surface-3 rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4 max-h-[80dvh] overflow-y-auto sheet-in">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">{t('Etiquetas')}</h2>
          <button onClick={onClose} className="p-2 -mr-2 press" aria-label={t('Cerrar')}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={addLabel} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Nueva etiqueta')}
            className="flex-1 input"
          />
          <button
            type="submit"
            className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
          >
            {t('Añadir')}
          </button>
        </form>

        {labels.length === 0 && <p className="text-text-2 text-center py-4">{t('Sin etiquetas aún')}</p>}

        <div className="flex flex-col gap-2">
          {labels.map((l, i) => (
            <div key={l.id} className="flex items-center gap-2 rounded-xl bg-surface-2 border border-border px-3 py-2">
              <input
                value={l.name}
                onChange={(e) => setLabels((ls) => ls.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))}
                onBlur={(e) => rename(l.id, e.target.value)}
                className="flex-1 bg-transparent text-text focus:outline-none"
              />
              <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-text-2 disabled:opacity-30" aria-label={t('Subir')}>
                <ArrowUp size={16} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === labels.length - 1}
                className="p-1 text-text-2 disabled:opacity-30"
                aria-label={t('Bajar')}
              >
                <ArrowDown size={16} />
              </button>
              <button onClick={() => archive(l.id)} className="p-1 text-danger" aria-label={t('Borrar')}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {undoLabel && (
        <div onClick={(e) => e.stopPropagation()}>
          <UndoToast message={t('Etiqueta borrada')} onUndo={undoArchive} />
        </div>
      )}
    </div>
  );
}
