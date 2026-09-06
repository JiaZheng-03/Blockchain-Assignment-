import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { useNotifications } from '../context/NotificationContext';
import { nextUnreadSelection, notificationPosition } from '../utils/notifications';

// The former rejection-only popup now presents the shared received-event queue.
function AgreementRejectionNotice() {
  const { notifications, pending, markRead, markAllRead, close } = useNotifications();
  const [selection, setSelection] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const dialog = useRef(null);
  const position = notificationPosition(pending, selection);
  const notice = pending[position];
  const unreadCount = notifications.filter((item) => !item.read).length;
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
    dialog.current?.querySelector('button:not(:disabled)')?.focus();
    return () => previous?.isConnected && previous.focus();
  }, [visible]);
  if (!visible) return null;
  function dismiss() {
    setSelection(null);
    close();
  }
  function readCurrent() {
    setSelection(nextUnreadSelection(pending, position));
    markRead(notice.key);
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
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
        <div className="confirmation-actions notification-actions notification-dialog-actions">
          <button className="btn btn-secondary notification-action notification-action-quiet" type="button" disabled={position === 0} onClick={() => setSelection({ key: pending[position - 1].key, index: position - 1 })}>Previous</button>
          <button className="btn btn-secondary notification-action notification-action-quiet" type="button" disabled={position === pending.length - 1} onClick={() => setSelection({ key: pending[position + 1].key, index: position + 1 })}>Next</button>
          <button className="btn btn-secondary notification-action" type="button" onClick={readCurrent}><Icon name="check" size={16} />Mark as Read</button>
          {unreadCount > 1 && <button className="btn btn-secondary notification-action" type="button" onClick={() => { markAllRead(); setSelection(null); }}><Icon name="check" size={16} />Mark All as Read</button>}
          <Link className="btn btn-primary notification-action" to={`/agreement/${notice.agreementId}`} onClick={() => { markRead(notice.key); dismiss(); }}>View Agreement</Link>
          <button className="btn btn-secondary notification-action notification-action-quiet" type="button" onClick={dismiss}>Close</button>
        </div>
      </section>
    </div>
  );
}
export default AgreementRejectionNotice;
