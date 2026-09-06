export function showActionResult(type, message) {
  if (typeof window === 'undefined' || !message) return;
  window.dispatchEvent(new CustomEvent('cargoseal:action-result', {
    detail: { message, type },
  }));
}
