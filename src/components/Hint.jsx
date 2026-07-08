import { useEffect, useId, useRef, useState } from 'react';

// Tooltip de causa, hover (desktop) + tap (táctil), misma implementación.
// position:fixed evita el clipping de cards con overflow-hidden y se clampa
// al viewport a 375 px. Usado en ≥5 lugares del Dashboard para explicar todo
// dato faltante, deshabilitado o recortado — nunca un guion mudo.
export default function Hint({ text, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  function show() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const maxW = 240;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - maxW - 8);
    setPos({ top: r.bottom + 6, left });
    setOpen(true);
  }

  return (
    <button
      ref={btnRef}
      type="button"
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation();
        open ? setOpen(false) : show();
      }}
      className="underline decoration-dotted decoration-text-3 underline-offset-2 align-baseline"
    >
      {children}
      {open && pos && (
        <span
          id={id}
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, maxWidth: 240 }}
          className="z-50 rounded-lg bg-surface-3 border border-border text-text-2 text-xs px-2 py-1.5 shadow-lg text-left normal-case font-normal"
        >
          {text}
        </span>
      )}
    </button>
  );
}
