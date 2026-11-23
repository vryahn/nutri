import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../lib/useModalFocus.js';
import { t } from '../lib/i18n.js';

// In-app confirmation that replaces window.confirm: blurred scrim that closes
// on tap outside (project rule) plus a .glass card. On glass, accent color must
// use --accent-glass; not needed here — only regular text and a solid danger
// button, which does not lose contrast against the background bleeding through.
export default function ConfirmSheet({ title, body, confirmLabel, danger = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) onClose(); };
  const cardRef = useModalFocus(close);
  const titleId = useId();
  return createPortal(
    <div
      onClick={(e) => {
        // stopPropagation: this sheet may be nested inside another modal (LabelsModal) —
        // a tap on this scrim must not bubble up and close the parent as well.
        e.stopPropagation();
        close();
      }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center backdrop-in"
    >
      <div ref={cardRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()} className="glass w-full sm:max-w-sm border border-border rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 sheet-in">
        <h2 id={titleId} className="font-display text-[19px]">{title}</h2>
        {body && <p className="text-sm text-text-2" style={{ margin: 0 }}>{body}</p>}
        <button
          onClick={async () => {
            setBusy(true);
            try { await onConfirm(); }
            finally { setBusy(false); }
          }}
          disabled={busy}
          className={`min-h-[44px] rounded-xl font-medium press disabled:opacity-60 ${
            danger ? 'bg-danger text-bg' : 'bg-accent-deep text-on-accent'
          }`}
        >
          {confirmLabel}
        </button>
        <button data-initial-focus onClick={onClose} disabled={busy} className="min-h-[44px] rounded-xl border border-border text-text-2 press">
          {t('Cancelar')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
