import { createContext, useContext, useEffect, useState } from 'react';
import { useWallet } from './WalletContext';
import { useContract } from './ContractContext';
import { decodeEscrowEvent, loadContractLogsInChunks, selectHistoryStartBlock } from '../utils/historyEvents';
import { eventNotification, mergeNotificationQueue, notificationKey, notificationScope, refundNotification } from '../utils/notifications';

const NotificationContext = createContext(null);
const memoryRead = new Set();
const presented = new Set();
const wasRead = (key) => {
  try { return memoryRead.has(key) || localStorage.getItem(key) === 'read'; }
  catch { return memoryRead.has(key); }
};

export function NotificationProvider({ children }) {
  const { account, isAuthenticated } = useWallet();
  const { address, expectedChainId, isCorrectNetwork, isConfigured, getReadContract, deployment, refreshKey } = useContract();
  const scope = notificationScope(expectedChainId, address, account);
  const enabled = Boolean(account && isAuthenticated && isCorrectNetwork && isConfigured);
  const [items, setItems] = useState([]);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState('');
  const deploymentBlock = deployment?.deploymentBlock;
  const deploymentAddress = deployment?.address;
  const deploymentChain = deployment?.chainId;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let checking = false;
    let cursor;
    const logsByKey = new Map();
    const timestamps = new Map();
    // Availability has no Solidity event, so retain observed deadline notices locally.
    const refundHistoryKey = `chaincargo:refund-notices:${scope}`;
    let refundHistory = new Map();
    try {
      const saved = JSON.parse(localStorage.getItem(refundHistoryKey) || '[]');
      if (Array.isArray(saved)) refundHistory = new Map(saved.filter((item) => item.scope === scope && item.name === 'RefundAvailable').map((item) => [item.key, item]));
    } catch { /* An unavailable or malformed cache does not block blockchain scanning. */ }
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const contract = await getReadContract();
        const provider = contract.runner;
        const latest = await provider.getBlock('latest');
        const start = cursor === undefined ? await selectHistoryStartBlock({ provider, address, chainId: expectedChainId,
          deployment: { deploymentBlock, address: deploymentAddress, chainId: deploymentChain }, latestBlock: latest.number }) : Math.max(0, Math.min(cursor, latest.number) - 12);
        const logs = await loadContractLogsInChunks({ provider, address, fromBlock: start, toBlock: latest.number });
        const arbitrator = await contract.arbitrator();
        const ids = new Set((await contract.getUserAgreementIds(account)).map(String));
        for (const [key, { log }] of logsByKey) if (log.blockNumber >= start) logsByKey.delete(key);
        for (const log of logs) {
          const event = decodeEscrowEvent(contract.interface, log);
          if (event?.args.agreementId !== undefined) logsByKey.set(notificationKey(scope, log), { log, event });
        }
        if (account.toLowerCase() === arbitrator.toLowerCase()) {
          for (const { event } of logsByKey.values()) if (event.name === 'DisputeOpened') ids.add(String(event.args.agreementId));
        }
        const agreements = new Map();
        for (const id of ids) agreements.set(id, await contract.getAgreement(id));
        const next = [];
        for (const [key, { log, event }] of logsByKey) {
          const agreement = agreements.get(String(event.args.agreementId));
          if (!agreement) continue;
          const item = eventNotification(event, agreement, account, arbitrator);
          if (!item) continue;
          if (!timestamps.has(log.blockHash)) timestamps.set(log.blockHash, Number((await provider.getBlock(log.blockHash)).timestamp));
          next.push({ ...item, key, scope, timestamp: timestamps.get(log.blockHash), read: wasRead(key) });
        }
        for (const [id, agreement] of agreements) {
          if (agreement.shipper.toLowerCase() !== account.toLowerCase() || Number(agreement.status) !== 0) continue;
          const milestones = await contract.getMilestones(id);
          const source = [...logsByKey.values()].find(({ event }) => event.name === 'AgreementCreated' && String(event.args.agreementId) === id);
          if (!source) continue;
          const item = refundNotification({ ...agreement, id, status: agreement.status, title: agreement.title, nextMilestone: agreement.nextMilestone }, milestones[Number(agreement.nextMilestone)], Number(latest.timestamp), source.log, scope);
          if (item) refundHistory.set(item.key, { ...item, scope });
        }
        if (cancelled) return;
        for (const item of refundHistory.values()) {
          next.push({ ...item, message: 'Evidence deadline missed; a refund became available. View the agreement for its current status.' });
        }
        try { localStorage.setItem(refundHistoryKey, JSON.stringify([...refundHistory.values()])); } catch { /* Keep the session history. */ }
        cursor = latest.number + 1;
        next.sort((a, b) => b.timestamp - a.timestamp || a.key.localeCompare(b.key));
        next.forEach((item) => { item.read = wasRead(item.key); });
        setItems(next);
        setQueue((current) => mergeNotificationQueue(current, next, scope, presented));
        setError('');
      } catch {
        if (!cancelled) setError('Unable to refresh blockchain notifications. Retrying automatically.');
      } finally { checking = false; }
    }
    check();
    const timer = window.setInterval(check, 30_000);
    const syncRead = () => {
      setItems((current) => current.map((item) => ({ ...item, read: wasRead(item.key) })));
      setQueue((current) => current.filter((item) => !wasRead(item.key)));
    };
    window.addEventListener('storage', syncRead);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('storage', syncRead); };
  }, [account, address, deploymentAddress, deploymentBlock, deploymentChain, enabled, expectedChainId, getReadContract, refreshKey, scope]);

  const notifications = enabled ? items.filter((item) => item.scope === scope) : [];
  const pending = enabled ? queue.filter((item) => item.scope === scope) : [];
  function markRead(key) {
    memoryRead.add(key);
    try { localStorage.setItem(key, 'read'); } catch { /* In-memory reads remain available. */ }
    setItems((current) => current.map((item) => item.key === key ? { ...item, read: true } : item));
    setQueue((current) => current.filter((item) => item.key !== key));
  }
  function close() {
    pending.forEach((item) => presented.add(item.key));
    setQueue([]);
  }
  return <NotificationContext.Provider value={{ notifications, pending, markRead, close, error: enabled ? error : '' }}>{children}</NotificationContext.Provider>;
}

export const useNotifications = () => useContext(NotificationContext);
