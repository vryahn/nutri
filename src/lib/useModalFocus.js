import { useLayoutEffect, useRef } from 'react';

const dialogs = [];
const focusable = 'a[href], button, input, select, textarea, summary, [tabindex]';

function tabStops(card) {
  return [...card.querySelectorAll(focusable)].filter((el) =>
    el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length && getComputedStyle(el).visibility === 'visible');
}

// Only the innermost open sheet traps focus and handles Escape. When it closes,
// its opener belongs to the parent sheet and is safe to focus again.
export function useModalFocus(onClose) {
  const cardRef = useRef(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const opener = document.activeElement;
    dialogs.push(card);
    const isTop = () => dialogs.at(-1) === card;
    const focusFirst = () => (tabStops(card)[0] || card).focus({ preventScroll: true });
    if (!card.contains(opener)) {
      const initial = card.querySelector('[data-initial-focus]');
      if (initial) initial.focus({ preventScroll: true });
      else focusFirst();
    }

    function guardFocus(e) {
      if (isTop() && !card.contains(e.target)) focusFirst();
    }
    function handleKey(e) {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key !== 'Tab') return;
      const stops = tabStops(card);
      const first = stops[0] || card;
      const last = stops.at(-1) || card;
      const current = document.activeElement;
      if (!stops.includes(current) || (e.shiftKey ? current === first : current === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener('focusin', guardFocus);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      const wasTop = isTop();
      dialogs.splice(dialogs.lastIndexOf(card), 1);
      document.removeEventListener('focusin', guardFocus);
      document.removeEventListener('keydown', handleKey, true);
      if (!wasTop) return;
      const parent = dialogs.at(-1);
      if (opener?.isConnected && (!parent || parent.contains(opener))) opener.focus({ preventScroll: true });
      else if (parent?.isConnected) (tabStops(parent)[0] || parent).focus({ preventScroll: true });
    };
  }, []);
  return cardRef;
}
