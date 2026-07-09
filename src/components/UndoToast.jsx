// Toast de borrado con acción "Deshacer" (5 s). Estilo y mecánica idénticos al
// de Hoy; extraído para Alimentos y Recetas (Hoy conserva su copia inline).
export default function UndoToast({ message, onUndo }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 left-4 right-4 mx-auto max-w-sm rounded-xl bg-surface-3 border border-border px-4 py-3 flex items-center justify-between gap-3"
    >
      <span className="text-sm">{message}</span>
      <button onClick={onUndo} className="min-h-[44px] px-3 text-accent font-medium press">
        Deshacer
      </button>
    </div>
  );
}
