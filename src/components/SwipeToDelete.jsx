import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

// Reusable swipe-left-to-delete. Mechanics extracted from Today.jsx:
// axis lock at ~8 px, translateX ≤ 0, danger background with Trash2, 40 % threshold
// (96 px cap, identical to the Today page), suppression of the click that follows
// the swipe, and animated restore when released before the threshold.
//
// dnd-kit integration (Today page): the card is simultaneously a dnd-kit draggable
// and swipeable. The optional props allow sharing the same node/gesture:
//   dragDisabled  -> true while dnd-kit is dragging (aborts the swipe)
//   dragListeners -> dnd-kit listeners (onMouseDown/onTouchStart) to spread
//                    onto the element; they coexist with the swipe's pointerdown
//   nodeRef       -> dnd-kit setNodeRef callback (merged with the internal ref)
//   dragAttributes -> dnd-kit attributes to spread onto the element
// `resetOnDelete`: once past the threshold, the card returns to its place after
// invoking onDelete (for when the delete opens a confirmation instead of
// unmounting the card).
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
  dragListeners,
  nodeRef,
  dragAttributes,
}) {
  const cardRef = useRef(null);
  const gesture = useRef({ startX: 0, startY: 0, swiping: false, tracking: false, justSwiped: false });
  const [swipeX, setSwipeX] = useState(0);
  const [restoring, setRestoring] = useState(false);

  function onPointerDown(ev) {
    gesture.current = { startX: ev.clientX, startY: ev.clientY, swiping: false, tracking: true, justSwiped: false };
  }

  function onPointerMove(ev) {
    if (dragDisabled || !onDelete || !gesture.current.tracking) return;
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
      onDelete?.();
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
        {...dragListeners}
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
