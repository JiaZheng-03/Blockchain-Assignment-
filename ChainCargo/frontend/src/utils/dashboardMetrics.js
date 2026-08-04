import { AGREEMENT_STATUS } from '../contracts/abi.js';
import { getAgreementActionDeadline, getDeadlineState } from './deadlineAlerts.js';

export function buildDashboardMetrics(agreements, nowSeconds) {
  const statusCounts = AGREEMENT_STATUS.map((label, status) => ({
    label,
    status,
    count: agreements.filter((agreement) => agreement.status === status).length,
  }));
  const totalAmount = agreements.reduce(
    (total, agreement) => total + (agreement.totalAmount || 0n),
    0n,
  );
  const remainingAmount = agreements.reduce(
    (total, agreement) => total + (agreement.remainingAmount || 0n),
    0n,
  );
  const activeAgreements = agreements.filter((agreement) => agreement.status === 0);
  const pendingEvidence = activeAgreements.filter(
    (agreement) => agreement.currentMilestoneState === 0,
  );
  const awaitingApproval = activeAgreements.filter(
    (agreement) => agreement.currentMilestoneState === 1,
  );
  const deadlineCounts = {
    safe: 0,
    warning: 0,
    critical: 0,
    overdue: 0,
  };

  pendingEvidence.forEach((agreement) => {
    const state = getDeadlineState(getAgreementActionDeadline(agreement), nowSeconds);
    if (deadlineCounts[state.level] !== undefined) deadlineCounts[state.level] += 1;
  });

  const nextDeadlineAgreement = pendingEvidence
    .slice()
    .sort(
      (left, right) => getAgreementActionDeadline(left) - getAgreementActionDeadline(right),
    )[0] || null;

  return {
    totalCount: agreements.length,
    activeCount: activeAgreements.length,
    disputedCount: statusCounts[3].count,
    resolvedCount: statusCounts[4].count,
    completedCount: statusCounts[1].count,
    statusCounts,
    totalAmount,
    remainingAmount,
    distributedAmount: totalAmount - remainingAmount,
    pendingEvidenceCount: pendingEvidence.length,
    awaitingApprovalCount: awaitingApproval.length,
    deadlineCounts,
    nextDeadlineAgreement,
  };
}
