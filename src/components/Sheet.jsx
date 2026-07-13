import { t } from '../lib/i18n.js';

// Shell de hoja modal: scrim que cierra al tocar fuera (regla del proyecto) +
// card .glass anclada abajo en móvil / centrada en desktop, con scroll propio.
// stopPropagation en la card para que el tap dentro no cierre. Usado por las
// sheets del menú de usuario (Perfil, Idioma, Configuración).
export default function Sheet({ title, onClose, children, footer }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center backdrop-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass w-full sm:max-w-md border border-border rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[88vh] sheet-in"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <h2 className="font-display text-[19px]">{title}</h2>
          <button onClick={onClose} className="w-9 h-9 -mr-2 flex items-center justify-center text-text-3 press" aria-label={t('Cerrar')}>✕</button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-3">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-border">{footer}</div>}
      </div>
    </div>
  );
}
