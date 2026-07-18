import { t, useLang } from '../lib/i18n.js';

// Deletion toast with an "Undo" action (5 s). Style and mechanics identical to
// the one in Today; extracted for Foods and Recipes (Today keeps its inline copy).
export default function UndoToast({ message, onUndo }) {
  useLang();
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 left-4 right-4 z-[60] mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 flex items-center justify-between gap-3 lg:left-auto lg:right-6 lg:bottom-6"
    >
      <span className="text-sm">{message}</span>
      <button onClick={onUndo} className="min-h-[44px] px-3 text-accent font-medium press">
        {t('Deshacer')}
      </button>
    </div>
  );
}
