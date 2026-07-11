import { useState } from 'react';
import { t } from '../lib/i18n.js';

// Confirmación in-app que reemplaza a window.confirm: scrim con blur que cierra
// al tocar fuera (regla del proyecto) y card .glass. Sobre glass el acento debe
// ir en --accent-glass; aquí no hace falta — solo texto normal y botón danger
// sólido, que no pierde contraste con el fondo colándose.
export default function ConfirmSheet({ title, body, confirmLabel, danger = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      onClick={(e) => {
        // stopPropagation: puede vivir anidado en otro modal (LabelsModal) — el tap
        // en este scrim no debe burbujear y cerrar también al padre.
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center backdrop-in"
    >
      <div onClick={(e) => e.stopPropagation()} className="glass w-full sm:max-w-sm border border-border rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 sheet-in">
        <h2 className="font-display text-[19px]">{title}</h2>
        {body && <p className="text-sm text-text-2" style={{ margin: 0 }}>{body}</p>}
        <button
          onClick={async () => {
            setBusy(true);
            await onConfirm();
          }}
          disabled={busy}
          className={`min-h-[44px] rounded-xl font-medium press disabled:opacity-60 ${
            danger ? 'bg-danger text-bg' : 'bg-accent-deep text-on-accent'
          }`}
        >
          {confirmLabel}
        </button>
        <button onClick={onClose} disabled={busy} className="min-h-[44px] rounded-xl border border-border text-text-2 press">
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}
