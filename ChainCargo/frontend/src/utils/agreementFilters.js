export const AGREEMENT_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: '0', label: 'Active' },
  { value: 'overdue', label: 'Deadline passed' },
  { value: '1', label: 'Completed' },
  { value: '2', label: 'Refunded' },
  { value: '3', label: 'Disputed' },
  { value: '4', label: 'Resolved' },
  { value: '5', label: 'Pending Carrier Acceptance' },
  { value: '6', label: 'Rejected' },
];

export const AGREEMENT_SORTS = [
  { value: 'newest', label: 'Newest created' },
  { value: 'urgent', label: 'Urgent first' },
  { value: 'deadline', label: 'Nearest deadline' },
  { value: 'oldest', label: 'Oldest created' },
];

function matchesSearch(agreement, normalizedQuery) {
  if (!normalizedQuery) return true;
  if (/^#?\d+$/.test(normalizedQuery)) {
    return agreement.id === Number(normalizedQuery.replace('#', ''));
  }

  return [
    agreement.title,
    agreement.shipper,
    agreement.carrier,
  ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
}

function matchesStatus(agreement, status, nowSeconds) {
  if (status === 'all') return true;
  if (status === 'overdue') {
    if (agreement.status === 5) {
      return agreement.carrierAcceptanceDeadline < nowSeconds;
    }
    const actionDeadline = agreement.currentMilestoneState === 0
      ? agreement.currentMilestoneDueAt || agreement.deadline
      : agreement.deadline;
    return agreement.status === 0 && actionDeadline < nowSeconds;
  }
  return agreement.status === Number(status);
}

function agreementDeadline(agreement) {
  if (agreement.status === 5) return agreement.carrierAcceptanceDeadline || agreement.deadline;
  return agreement.currentMilestoneState === 0
    ? agreement.currentMilestoneDueAt || agreement.deadline
    : agreement.deadline;
}

export function filterAndSortAgreements(
  agreements,
  { query = '', status = 'all', sort = 'newest', nowSeconds = Math.floor(Date.now() / 1000) } = {},
) {
  const normalizedQuery = query.trim().toLowerCase();
  const results = agreements.filter(
    (agreement) => matchesSearch(agreement, normalizedQuery)
      && matchesStatus(agreement, status, nowSeconds),
  );

  return results.sort((left, right) => {
    const leftDeadline = agreementDeadline(left);
    const rightDeadline = agreementDeadline(right);
    if (sort === 'urgent') {
      const leftPriority = left.status === 0 && left.currentMilestoneState === 0
        ? 0
        : left.status === 0 ? 1 : 2;
      const rightPriority = right.status === 0 && right.currentMilestoneState === 0
        ? 0
        : right.status === 0 ? 1 : 2;
      return leftPriority - rightPriority
        || leftDeadline - rightDeadline
        || right.createdAt - left.createdAt;
    }
    if (sort === 'deadline') return leftDeadline - rightDeadline || right.createdAt - left.createdAt;
    if (sort === 'oldest') return left.createdAt - right.createdAt || left.id - right.id;
    return right.createdAt - left.createdAt || right.id - left.id;
  });
}
