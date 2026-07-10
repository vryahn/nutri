import { useEffect, useRef } from 'react';

// Cierra un desplegable flotante al tocar fuera de él. Devuelve el ref que debe
// envolver disparador + panel (tocar el disparador no cierra: lo togglea).
//
// Un backdrop `fixed inset-0` NO sirve como cierre-al-tocar-fuera: dentro de un
// ancestro con `backdrop-filter` (todo `.glass`: header y tab bar móviles) el
// fixed se ancla a ese ancestro, no al viewport, y el resto de la pantalla queda
// sin cubrir. Por eso el listener va en `document`.
export function useOutsideClose(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, setOpen]);
  return ref;
}
