// Skeleton genérico de página: bloques pulsantes con la silueta de cards.
// Reemplaza los "Cargando…" de texto (Targets, Dashboard, fallback de Suspense).
export default function PageSkeleton({ blocks = 3 }) {
  return (
    <div className="px-4 py-4 flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: blocks }, (_, i) => (
        <div key={i} className="h-24 rounded-2xl bg-surface animate-pulse" />
      ))}
    </div>
  );
}
