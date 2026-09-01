import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import { useAgreements } from '../hooks/useAgreements';
import { getAgreementActionDeadline, getDeadlineState } from '../utils/deadlineAlerts';

const NOTIFICATION_PREFERENCE_KEY = 'chaincargoDeadlineNotifications';
const NOTIFICATION_ALERT_PREFIX = 'chaincargoDeadlineAlert';

function NotificationButton() {
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [permission, setPermission] = useState('default');
  const { account } = useWallet();
  const { address: contractAddress } = useContract();
  const { hasAppAccess, isArbitrator } = useProfile();
  const { agreements } = useAgreements({ arbitration: isArbitrator });

  useEffect(() => {
    const timer = window.setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if ('Notification' in window) setPermission(window.Notification.permission);
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  const alerts = useMemo(() => agreements
    .filter((agreement) => agreement.status === 0 && [0, 1].includes(agreement.currentMilestoneState))
    .map((agreement) => {
      const reviewPending = agreement.currentMilestoneState === 1;
      const deadline = reviewPending
        ? agreement.currentMilestoneSubmittedAt + (2 * 24 * 60 * 60)
        : getAgreementActionDeadline(agreement);
      return {
        agreement,
        deadline,
        kind: reviewPending ? 'review' : 'evidence',
        state: getDeadlineState(deadline, nowSeconds),
      };
    })
    .filter(({ state }) => ['warning', 'critical', 'overdue'].includes(state.level))
    .sort((left, right) => left.deadline - right.deadline), [agreements, nowSeconds]);

  useEffect(() => {
    if (permission !== 'granted'
      || window.localStorage.getItem(NOTIFICATION_PREFERENCE_KEY) !== 'enabled') return;

    alerts.forEach(({ agreement, deadline, kind, state }) => {
      const alertKey = [
        NOTIFICATION_ALERT_PREFIX,
        contractAddress,
        account,
        agreement.id,
        deadline,
        kind,
        state.level,
      ].join(':');
      if (window.localStorage.getItem(alertKey)) return;

      const overdue = state.level === 'overdue';
      const title = kind === 'review'
        ? overdue
          ? `Agreement #${agreement.id} review period ended`
          : `Agreement #${agreement.id} evidence review ending`
        : overdue
          ? `Agreement #${agreement.id} deadline missed`
          : `Agreement #${agreement.id} deadline approaching`;
      const body = kind === 'review'
        ? overdue
          ? `${agreement.title}: the submitted milestone can now be finalized and paid to the Carrier.`
          : `${agreement.title}: ${state.countdown} in the Shipper review period.`
        : overdue
          ? `${agreement.title}: remaining escrow is ready for an on-chain refund to the Shipper.`
          : `${agreement.title}: ${state.countdown} for ${agreement.currentMilestoneName || 'the current milestone'}.`;
      try {
        new window.Notification(title, { body, tag: alertKey });
        window.localStorage.setItem(alertKey, 'sent');
      } catch {
        // The in-app notification center remains available if the browser suppresses it.
      }
    });
  }, [account, alerts, contractAddress, permission]);

  async function toggleNotifications() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || !('Notification' in window)) return;
    if (permission === 'granted') {
      window.localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, 'enabled');
      return;
    }
    if (permission !== 'default') return;

    const nextPermission = await window.Notification.requestPermission();
    setPermission(nextPermission);
    if (nextPermission === 'granted') {
      window.localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, 'enabled');
    }
  }

  if (!account || !hasAppAccess) return null;

  return (
    <div className="notification-menu" ref={containerRef}>
      <button
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="notification-trigger"
        onClick={toggleNotifications}
        title="Notifications"
        type="button"
      >
        <span aria-hidden="true" className="notification-bell" />
        {alerts.length > 0 && <span className="notification-count">{alerts.length}</span>}
      </button>
      {open && (
        <section aria-label="Deadline notifications" className="notification-popover">
          <div className="notification-popover-heading">
            <div>
              <span className="eyebrow">Deadline alerts</span>
              <h3>Notifications</h3>
            </div>
            {permission === 'granted' && <span className="badge">Browser alerts on</span>}
          </div>
          {permission === 'denied' && (
            <p className="notification-permission-warning">
              Browser alerts are blocked. Enable them in this site&apos;s browser settings.
            </p>
          )}
          {alerts.length === 0 ? (
            <p className="notification-empty">No deadline alerts right now.</p>
          ) : (
            <div className="notification-list">
              {alerts.map(({ agreement, deadline, kind, state }) => (
                <Link
                  className={`notification-item deadline-${state.level}`}
                  key={`${agreement.id}-${deadline}-${kind}-${state.level}`}
                  onClick={() => setOpen(false)}
                  to={`/agreement/${agreement.id}`}
                >
                  <strong>{agreement.title}</strong>
                  <span>
                    {kind === 'review'
                      ? state.level === 'overdue'
                        ? 'Review period ended. The milestone is ready to finalize.'
                        : `${state.countdown} in the Shipper evidence review period.`
                      : state.level === 'overdue'
                        ? 'Deadline missed. Refund is ready to settle on-chain.'
                        : `${state.countdown} remaining for ${agreement.currentMilestoneName || 'the current milestone'}.`}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <small>Alerts update automatically while ChainCargo is open.</small>
        </section>
      )}
    </div>
  );
}

export default NotificationButton;
