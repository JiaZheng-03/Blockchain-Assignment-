import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';

function AgreementRejectionNotice() {
  const { account, isAuthenticated } = useWallet();
  const { address, expectedChainId, isCorrectNetwork, isConfigured, getReadContract, refreshKey } = useContract();
  const [notifications, setNotifications] = useState([]);
  const acknowledged = useRef(new Set());
  const scope = `${expectedChainId}:${address?.toLowerCase()}:${account?.toLowerCase()}`;
  const enabled = Boolean(isAuthenticated && isCorrectNetwork && isConfigured && account);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const contract = await getReadContract();
        const ids = await contract.getUserAgreementIds(account);
        const pending = [];
        for (const id of ids) {
          if (cancelled) return;
          const key = `chaincargo:rejection-read:${scope}:${id}`;
          if (acknowledged.current.has(key)) continue;
          try {
            if (window.localStorage.getItem(key)) continue;
          } catch { /* Session acknowledgement still works when storage is unavailable. */ }
          const agreement = await contract.getAgreement(id);
          if (Number(agreement.status) !== 6 || agreement.shipper.toLowerCase() !== account.toLowerCase()) continue;
          const reason = await contract.agreementRejectionReason(id);
          pending.push({ key, scope, title: agreement.title, id: String(id), reason });
        }
        if (!cancelled) setNotifications(pending.filter((item) => !acknowledged.current.has(item.key)));
      } catch {
        // Retry transient RPC failures without interrupting a user's current action.
      } finally {
        checking = false;
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [account, enabled, getReadContract, refreshKey, scope]);

  const notice = enabled && notifications.find((item) => item.scope === scope);
  if (!notice) return null;
  const dismiss = () => {
    acknowledged.current.add(notice.key);
    try { window.localStorage.setItem(notice.key, '1'); } catch { /* Keep the in-memory acknowledgement. */ }
    setNotifications((items) => items.filter((item) => item.key !== notice.key));
  };

  return (
    <div className="toast-backdrop" role="presentation">
      <section className="toast-popup confirmation-popup" role="alertdialog" aria-modal="true"
        aria-labelledby="rejected-agreement-title" aria-describedby="rejected-agreement-description">
        <h2 id="rejected-agreement-title">Agreement rejected</h2>
        <div className="toast-message" id="rejected-agreement-description" style={{ overflowWrap: 'anywhere' }}>
          <strong>{notice.title} (#{notice.id})</strong>
          <p>The Carrier rejected this agreement. The escrow has been refunded to your wallet.</p>
          <p style={{ whiteSpace: 'pre-wrap', maxHeight: '35vh', overflowY: 'auto' }}><strong>Reason: </strong>{notice.reason}</p>
        </div>
        <button autoFocus className="confirmation-confirm" onClick={dismiss} type="button">OK</button>
      </section>
    </div>
  );
}

export default AgreementRejectionNotice;
