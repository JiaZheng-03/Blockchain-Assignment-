const lower = (value) => String(value || '').toLowerCase();
export const notificationScope = (chainId, address, account) => `${Number(chainId)}:${lower(address)}:${lower(account)}`;
export const notificationKey = (scope, log) => `chaincargo:notification:${scope}:${lower(log.transactionHash)}:${log.index ?? log.logIndex}`;

// Persist before updating the UI/navigation. Memory is only a storage-failure fallback.
export function createNotificationReadStore(getStorage) {
  const fallback = new Set();
  return {
    isRead(key) {
      try { return getStorage().getItem(key) === 'read' || fallback.has(key); }
      catch { return fallback.has(key); }
    },
    markRead(keys) {
      for (const key of keys) {
        try { getStorage().setItem(key, 'read'); fallback.delete(key); }
        catch { fallback.add(key); }
      }
    },
  };
}

export function notificationPosition(pending, selection) {
  const found = pending.findIndex((item) => item.key === selection?.key);
  return found >= 0 ? found : Math.min(selection?.index || 0, pending.length - 1);
}

export function nextUnreadSelection(pending, position) {
  const next = pending[position + 1] || pending[0];
  return { key: next?.key, index: 0 };
}

export function mergeNotificationQueue(current, next, scope, presented) {
  const eligible = next.filter((item) => item.scope === scope && !item.read);
  const byKey = new Map(eligible.map((item) => [item.key, item]));
  const queued = new Map(current.filter((item) => byKey.has(item.key)).map((item) => [item.key, byKey.get(item.key)]));
  eligible.forEach((item) => { if (!presented.has(item.key)) queued.set(item.key, item); });
  return [...queued.values()];
}

export function eventNotification(event, agreement, account, arbitrator) {
  const { name, args } = event;
  const shipper = lower(account) === lower(agreement.shipper);
  const carrier = lower(account) === lower(agreement.carrier);
  const participant = shipper || carrier;
  const rules = {
    AgreementCreated: [carrier, 'New agreement awaiting your acceptance.'],
    AgreementAccepted: [shipper, 'The Carrier accepted this agreement.'],
    AgreementRejected: [shipper, `The Carrier rejected this agreement. Escrow refunded. Reason: ${args.reason || 'Not provided'}`],
    MilestoneProofSubmitted: [shipper, 'Evidence submitted for your review.'],
    EvidenceRevisionRequested: [carrier, 'Replacement evidence requested.'],
    MilestoneConfirmed: [carrier, 'Milestone confirmed and payment released.'],
    DeadlineExtensionRequested: [shipper, 'The Carrier requested a deadline extension.'],
    DeadlineExtensionApproved: [carrier, 'Deadline extension approved.'],
    DeadlineExtensionRejected: [carrier, 'Deadline extension rejected.'],
    DisputeOpened: [(participant && lower(account) !== lower(args.openedBy)) || lower(account) === lower(arbitrator), `Dispute opened: ${args.reason || 'Arbitrator review requested.'}`],
    DisputeResolved: [participant, 'The Arbitrator settled the dispute and distributed the remaining escrow.'],
    DisputeContinued: [participant, `The Arbitrator ${args.evidenceApproved ? 'approved the evidence' : 'requested replacement evidence'}. Agreement resumed.`],
    AgreementCompleted: [participant, 'Agreement completed.'],
    Refunded: [shipper, 'Escrow refund paid to your wallet.'],
    UnacceptedAgreementCancelled: [carrier || shipper, 'Unaccepted agreement cancelled and escrow refunded.'],
  };
  const rule = rules[name];
  return rule?.[0] ? { agreementId: String(args.agreementId), title: agreement.title, message: rule[1], name } : null;
}

export function refundNotification(agreement, milestone, now, source, scope) {
  if (Number(agreement.status) !== 0 || Number(milestone?.state) !== 0 || now <= Number(milestone.dueAt)) return null;
  return {
    key: `${notificationKey(scope, source)}:refund:${agreement.id}:${agreement.nextMilestone}:${milestone.dueAt}`,
    agreementId: String(agreement.id), title: agreement.title,
    message: 'Evidence deadline missed. You can claim the remaining escrow refund.',
    timestamp: Number(milestone.dueAt) + 1, name: 'RefundAvailable',
  };
}
