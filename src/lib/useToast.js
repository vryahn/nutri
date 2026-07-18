import { useState } from 'react';

// Ephemeral toast (3 s). Behavior identical to the pattern it replaces:
// a new toast overwrites the previous one without clearing its timeout (harmless).
export function useToast() {
  const [toast, setToast] = useState('');
  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }
  return [toast, showToast];
}
