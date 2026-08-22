export const DEADLINE_WARNING_SECONDS = 24 * 60 * 60;
export const DEADLINE_CRITICAL_SECONDS = 60 * 60;

export function formatDeadlineDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainderSeconds = seconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${remainderSeconds}s`;
  return `${minutes}m ${remainderSeconds}s`;
}

export function getDeadlineState(deadline, nowSeconds, active = true) {
  if (!active || !deadline) {
    return { level: 'closed', countdown: '', secondsRemaining: null };
  }

  const secondsRemaining = deadline - nowSeconds;
  if (secondsRemaining < 0) {
    return {
      level: 'overdue',
      countdown: `Overdue by ${formatDeadlineDuration(secondsRemaining)}`,
      secondsRemaining,
    };
  }
  if (secondsRemaining <= DEADLINE_CRITICAL_SECONDS) {
    return {
      level: 'critical',
      countdown: `${formatDeadlineDuration(secondsRemaining)} remaining`,
      secondsRemaining,
    };
  }
  if (secondsRemaining <= DEADLINE_WARNING_SECONDS) {
    return {
      level: 'warning',
      countdown: `${formatDeadlineDuration(secondsRemaining)} remaining`,
      secondsRemaining,
    };
  }
  return {
    level: 'safe',
    countdown: `${formatDeadlineDuration(secondsRemaining)} remaining`,
    secondsRemaining,
  };
}

export function getAgreementActionDeadline(agreement) {
  if (agreement.status === 0 && agreement.currentMilestoneState === 0) {
    return agreement.currentMilestoneDueAt || agreement.deadline;
  }
  return agreement.deadline;
}

export function isRefundAvailable(agreement, nowSeconds) {
  return agreement.status === 0
    && agreement.currentMilestoneState === 0
    && Boolean(agreement.currentMilestoneDueAt)
    && nowSeconds > agreement.currentMilestoneDueAt;
}

export function isRefundButtonAvailable(contractCanRefund) {
  return contractCanRefund === true;
}
