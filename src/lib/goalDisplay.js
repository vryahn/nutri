import { impliedBounds } from './domain.js';

export function goalBounds(state, hasTarget) {
  if (!hasTarget) return null;
  const b = state.coupled ? state.explicitBound : state.bound || impliedBounds(state.meta.key, state.tgt, state.goal);
  return b?.min != null || b?.max != null ? b : null;
}

export function goalScale(state, hasTarget) {
  const bound = goalBounds(state, hasTarget);
  if (!bound) return null;
  const end = bound.max ?? bound.min;
  if (!(end > 0)) return null;
  return { bound, at: (value) => Math.max(0, Math.min(1, value / end)) };
}

// One solid tone for the current value; coupled macros use their declared envelope.
export function goalTone(state, hasTarget, hasFood) {
  if (!hasTarget || !hasFood) return 'var(--text-3)';
  const bound = state.coupled ? state.explicitBound : goalBounds(state, hasTarget);
  if (!bound) return 'var(--text-3)';
  const { min, max } = bound;
  const { value } = state;
  if (max != null && value > max) return 'var(--danger)';
  if (min != null && value < min) return `color-mix(in srgb, var(--ok) ${Math.max(0, Math.min(100, value / min * 100))}%, var(--text-3))`;
  if (!(max > (min ?? 0))) return 'var(--ok)';
  const position = (value - (min ?? 0)) / (max - (min ?? 0));
  if (position <= 0.5) return 'var(--ok)';
  if (position <= 0.72) return `color-mix(in srgb, var(--near) ${(position - 0.5) / 0.22 * 100}%, var(--ok))`;
  if (position <= 0.9) return `color-mix(in srgb, var(--warn) ${(position - 0.72) / 0.18 * 100}%, var(--near))`;
  return 'var(--warn)';
}
