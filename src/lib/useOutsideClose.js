import { useEffect, useRef } from 'react';

// Closes a floating dropdown when tapping outside of it. Returns the ref that must
// wrap trigger + panel (tapping the trigger does not close: it toggles).
//
// A `fixed inset-0` backdrop does NOT work as close-on-outside-tap: inside an
// ancestor with `backdrop-filter` (everything `.glass`: mobile header and tab bar)
// the fixed element anchors to that ancestor, not the viewport, and the rest of the
// screen is left uncovered. That is why the listener goes on `document`.
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
