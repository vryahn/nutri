export function openDatePicker(event) {
  const input = event.currentTarget;
  if (globalThis.navigator?.userActivation?.isActive === false) return;
  if (typeof input.showPicker !== 'function') return;

  try {
    input.showPicker();
  } catch (error) {
    if (error?.name !== 'NotAllowedError') throw error;
    input.focus();
  }
}
