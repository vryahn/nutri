import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

// Swipe-izquierda-para-borrar reutilizable. Mecánica extraída de Today.jsx:
// lock de eje a ~8 px, translateX ≤ 0, fondo danger con Trash2, umbral 40 %
// (cap 96 px, idéntico a Hoy), supresión del click posterior al swipe y
// restauración animada al soltar antes del umbral.
//
// Integración con dnd-kit (Hoy): la card es a la vez draggable de dnd-kit y
// swipeable. Los props opcionales permiten compartir el mismo nodo/gesto:
//   dragDisabled  -> true mientras dnd-kit arrastra (aborta el swipe)
//   onPointerDownExtra -> se llama en pointerdown antes de armar el swipe
//                         (aquí Hoy engancha el listener de dnd-kit)
//   nodeRef       -> callback de setNodeRef de dnd-kit (se fusiona con el ref interno)
//   dragAttributes -> attributes de dnd-kit a esparcir en el elemento
// `resetOnDelete`: al pasar el umbral, vuelve a su sitio tras invocar onDelete
// (para cuando el borrado abre una confirmación en vez de desmontar la card).
export default function SwipeToDelete({
  children,
  onDelete,
  onTap,
  className = '',
  radius = 'rounded-2xl',
  revealClassName = 'bg-danger',
  revealIconClassName = 'text-text',
  revealStyle,
  resetOnDelete = false,
  dragDisabled = false,
  onPointerDownExtra,
  nodeRef,
  dragAttributes,
}) {
  const cardRef = useRef(null);
  const gesture = useRef({ startX: 0, startY: 0, swiping: false, tracking: false, justSwiped: false });
  const [swipeX, setSwipeX] = useState(0);
  const [restoring, setRestoring] = useState(false);

  function onPointerDown(ev) {
    onPointerDownExtra?.(ev);
    gesture.current = { startX: ev.clientX, startY: ev.clientY, swiping: false, tracking: true, justSwiped: false };
  }

  function onPointerMove(ev) {
    if (dragDisabled || !gesture.current.tracking) return;
    const dx = ev.clientX - gesture.current.startX;
    const dy = ev.clientY - gesture.current.startY;
    if (!gesture.current.swiping) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      gesture.current.swiping = true;
      setRestoring(false);
    }
    ev.preventDefault();
    setSwipeX(Math.min(0, dx));
  }

  function onPointerUp() {
    if (!gesture.current.tracking) return;
    gesture.current.tracking = false;
    if (!gesture.current.swiping) return;
    gesture.current.swiping = false;
    gesture.current.justSwiped = true;
    const cardWidth = cardRef.current?.offsetWidth || 300;
    const threshold = Math.min(96, cardWidth * 0.35);
    if (Math.abs(swipeX) > threshold) {
      onDelete();
      if (resetOnDelete) {
        setRestoring(true);
        setSwipeX(0);
      }
    } else {
      setRestoring(true);
      setSwipeX(0);
    }
  }

  function handleClick() {
    if (gesture.current.justSwiped) {
      gesture.current.justSwiped = false;
      return;
    }
    onTap?.();
  }

  const style = {
    transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
    transition: restoring ? 'transform 150ms ease-out' : undefined,
  };

  return (
    <div className={`relative ${radius} ${swipeX !== 0 ? 'overflow-hidden' : ''}`}>
      {swipeX !== 0 && (
        <div style={revealStyle} className={`absolute inset-0 ${radius} ${revealClassName} flex items-center justify-end pr-4`}>
          <Trash2 size={20} className={revealIconClassName} />
        </div>
      )}
      <button
        ref={(node) => {
          cardRef.current = node;
          if (typeof nodeRef === 'function') nodeRef(node);
        }}
        {...dragAttributes}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
        onTransitionEnd={() => setRestoring(false)}
        style={style}
        className={`relative w-full text-left touch-pan-y select-none [-webkit-touch-callout:none] ${className}`}
      >
        {children}
      </button>
    </div>
  );
}
