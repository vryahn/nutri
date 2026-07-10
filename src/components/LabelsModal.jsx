import { useEffect, useState } from 'react';
import { X, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { reorderLabels } from '../lib/domain.js';

export default function LabelsModal({ onClose }) {
  const [labels, setLabels] = useState([]);
  const [name, setName] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from('meal_labels').select('*').order('sort_order');
    if (data) setLabels(data);
    // Hoy renderiza secciones por etiqueta sin remontarse cuando este modal cambia algo.
    window.dispatchEvent(new Event('labels-changed'));
  }

  async function addLabel(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const maxOrder = labels.reduce((m, l) => Math.max(m, l.sort_order ?? 0), 0);
    await supabase.from('meal_labels').insert({ name: name.trim(), sort_order: maxOrder + 1 });
    setName('');
    load();
  }

  async function rename(id, newName) {
    await supabase.from('meal_labels').update({ name: newName }).eq('id', id);
    load();
  }

  async function remove(id) {
    if (!confirm('¿Borrar esta etiqueta?')) return;
    await supabase.from('meal_labels').delete().eq('id', id);
    load();
  }

  async function move(index, dir) {
    const updates = reorderLabels(labels, index, dir);
    if (updates.length === 0) return;
    await Promise.all(updates.map((u) => supabase.from('meal_labels').update({ sort_order: u.sort_order }).eq('id', u.id)));
    load();
  }

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-surface-3 rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-4 max-h-[80dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Etiquetas</h2>
          <button onClick={onClose} className="p-2 -mr-2 press" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={addLabel} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nueva etiqueta"
            className="flex-1 input"
          />
          <button
            type="submit"
            className="min-h-[44px] px-4 rounded-xl bg-accent-deep text-on-accent font-medium press"
          >
            Añadir
          </button>
        </form>

        {labels.length === 0 && <p className="text-text-2 text-center py-4">Sin etiquetas aún</p>}

        <div className="flex flex-col gap-2">
          {labels.map((l, i) => (
            <div key={l.id} className="flex items-center gap-2 rounded-xl bg-surface-2 border border-border px-3 py-2">
              <input
                value={l.name}
                onChange={(e) => setLabels((ls) => ls.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))}
                onBlur={(e) => rename(l.id, e.target.value)}
                className="flex-1 bg-transparent text-text focus:outline-none"
              />
              <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-text-2 disabled:opacity-30" aria-label="Subir">
                <ArrowUp size={16} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === labels.length - 1}
                className="p-1 text-text-2 disabled:opacity-30"
                aria-label="Bajar"
              >
                <ArrowDown size={16} />
              </button>
              <button onClick={() => remove(l.id)} className="p-1 text-danger" aria-label="Borrar">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
