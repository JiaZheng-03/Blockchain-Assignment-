import { ethers } from 'ethers';

export const MIN_SCHEDULE_BUFFER_MS = 2 * 60 * 1000;
export const MAX_MILESTONES = 20;

export function toDateTimeLocalValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

export function validateAgreementBasics({ form, account, nowMs = Date.now() }) {
  if (!form.title.trim()) throw new Error('Enter an agreement name.');
  if (!ethers.isAddress(form.carrier)) throw new Error('Enter a valid carrier wallet address.');
  if (form.carrier === ethers.ZeroAddress) throw new Error('The carrier cannot be the zero address.');
  if (account && form.carrier.toLowerCase() === account.toLowerCase()) {
    throw new Error('The shipper and carrier must use different wallet addresses.');
  }

  let totalWei;
  try {
    totalWei = ethers.parseEther(form.totalAmount);
  } catch {
    throw new Error('Enter a valid total amount in ETH.');
  }
  if (totalWei <= 0n) throw new Error('The escrow amount must be greater than 0 ETH.');

  const minimumTimeMs = nowMs + MIN_SCHEDULE_BUFFER_MS;
  const deadlineMs = new Date(form.deadline).getTime();
  if (!Number.isFinite(deadlineMs)) throw new Error('Select a final delivery deadline.');
  if (deadlineMs < minimumTimeMs) {
    throw new Error('The final deadline must be at least 2 minutes in the future.');
  }

  return {
    totalWei,
    deadline: Math.floor(deadlineMs / 1000),
    deadlineMs,
    minimumTimeMs,
  };
}

export function validateAgreementDraft({ form, milestones, account, nowMs = Date.now() }) {
  const {
    totalWei,
    deadline,
    deadlineMs,
    minimumTimeMs,
  } = validateAgreementBasics({ form, account, nowMs });

  if (!milestones.length) throw new Error('Add at least one milestone.');
  if (milestones.length > MAX_MILESTONES) {
    throw new Error(`An agreement can contain at most ${MAX_MILESTONES} milestones.`);
  }

  let percentageTotal = 0;
  let previousDueMs = minimumTimeMs - 1;
  const dueDates = [];
  const percentages = [];

  milestones.forEach((milestone, index) => {
    const number = index + 1;
    if (!milestone.name.trim()) throw new Error(`Enter a name for milestone ${number}.`);
    if (!milestone.details.trim()) {
      throw new Error(`Describe the required evidence for milestone ${number}.`);
    }

    const percentage = Number(milestone.percentage);
    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
      throw new Error(`Milestone ${number} payout must be a whole percentage from 1 to 100.`);
    }
    percentageTotal += percentage;
    percentages.push(percentage);

    const dueMs = new Date(milestone.dueAt).getTime();
    if (!Number.isFinite(dueMs)) throw new Error(`Select a due date for milestone ${number}.`);
    if (dueMs < minimumTimeMs) {
      throw new Error(`Milestone ${number} must be due at least 2 minutes in the future.`);
    }
    if (dueMs <= previousDueMs) {
      throw new Error(`Milestone ${number} must be later than the previous milestone.`);
    }
    if (dueMs > deadlineMs) {
      throw new Error(`Milestone ${number} cannot be later than the final deadline.`);
    }
    previousDueMs = dueMs;
    dueDates.push(Math.floor(dueMs / 1000));
  });

  if (percentageTotal !== 100) {
    throw new Error(`Milestone percentages total ${percentageTotal}%; they must total exactly 100%.`);
  }

  let allocated = 0n;
  const payouts = percentages.map((percentage, index) => {
    const payout =
      index === percentages.length - 1
        ? totalWei - allocated
        : (totalWei * BigInt(percentage)) / 100n;
    allocated += payout;
    if (payout === 0n) {
      throw new Error(`Milestone ${index + 1} payout is too small for the escrow amount.`);
    }
    return payout;
  });

  return {
    totalWei,
    payouts,
    dueDates,
    deadline,
  };
}
