import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';

// The former rejection-only popup now presents the shared received-event queue.
function AgreementRejectionNotice() {
  const { pending, markRead, close } = useNotifications();
  const [index, setIndex] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const dialog = useRef(null);
  const notice = pending[Math.min(index, pending.length - 1)];
  useEffect(() => {
    const check = () => setBlocked(Boolean(document.querySelector('.toast-backdrop:not(.received-notification-backdrop), [role="dialog"][aria-modal="true"]')));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const visible = Boolean(notice && !blocked);
  useEffect(() => {
    if (!visible) return undefined;
    const previous = document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => previous?.isConnected && previous.focus();
  }, [visible]);
  if (!visible) return null;
  const position = Math.min(index, pending.length - 1);
  function onKeyDown(event) {
    if (event.key === 'Escape') close();
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), a')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return (
    <div className="toast-backdrop received-notification-backdrop" role="presentation">
      <section ref={dialog} onKeyDown={onKeyDown} className="toast-popup confirmation-popup received-notification-popup" role="alertdialog" aria-modal="true"
        aria-labelledby="received-notification-title" aria-describedby="received-notification-message">
        <h2 id="received-notification-title">Agreement update</h2>
        <div className="toast-message" id="received-notification-message" aria-live="polite">
          <strong>{notice.title}</strong>
          <p>{notice.message}</p>
          <time dateTime={new Date(notice.timestamp * 1000).toISOString()}>{new Date(notice.timestamp * 1000).toLocaleString()}</time>
        </div>
        <p>{position + 1} of {pending.length} unread updates</p>
        <div className="confirmation-actions notification-dialog-actions">
          <button type="button" disabled={position === 0} onClick={() => setIndex(position - 1)}>Previous</button>
          <button type="button" disabled={position === pending.length - 1} onClick={() => setIndex(position + 1)}>Next</button>
          <button type="button" onClick={() => markRead(notice.key)}>Mark as Read</button>
          <Link className="notification-view-link" to={`/agreement/${notice.agreementId}`} onClick={close}>View Agreement</Link>
          <button type="button" onClick={close}>Close</button>
        </div>
      </section>
    </div>
  );
}
export default AgreementRejectionNotice;
