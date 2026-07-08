import { useState } from 'react';

// Toast efímero (3 s). Comportamiento idéntico al patrón que reemplaza:
// un toast nuevo pisa al anterior sin limpiar su timeout (inofensivo).
export function useToast() {
  const [toast, setToast] = useState('');
  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }
  return [toast, showToast];
}
