export function showActionResult(type, message) {
  if (typeof window === 'undefined' || !message) return;
  window.dispatchEvent(new CustomEvent('chaincargo:action-result', {
    detail: { message, type },
  }));
}
