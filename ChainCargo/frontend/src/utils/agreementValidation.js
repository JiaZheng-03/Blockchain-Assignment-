import { ethers } from 'ethers';

export const MIN_SCHEDULE_BUFFER_MS = 2 * 60 * 1000;
export const MAX_MILESTONES = 2;
export const MAX_AGREEMENT_TITLE_LENGTH = 200;
export const MAX_AGREEMENT_NOTES_LENGTH = 2_000;
export const MAX_MILESTONE_NAME_LENGTH = 120;
export const MAX_MILESTONE_DETAILS_LENGTH = 1_000;
export const FIXED_MILESTONES = Object.freeze([
  Object.freeze({
    name: 'Cargo pickup',
    details: 'Photo or PDF proving that the Carrier collected the cargo',
    percentage: '30',
  }),
  Object.freeze({
    name: 'Final delivery',
    details: 'Photo or PDF proving that the Carrier completed final delivery',
    percentage: '70',
  }),
]);

export function normalizeAgreementName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function requireMaximumUtf8Length(value, maximum, label) {
  if (ethers.toUtf8Bytes(value).length > maximum) {
    throw new Error(`${label} must be ${maximum} bytes or fewer.`);
  }
}

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
  requireMaximumUtf8Length(form.title, MAX_AGREEMENT_TITLE_LENGTH, 'Agreement name');
  requireMaximumUtf8Length(form.notes, MAX_AGREEMENT_NOTES_LENGTH, 'Agreement notes');
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

  if (milestones.length !== MAX_MILESTONES) {
    throw new Error('Every agreement must contain exactly Cargo pickup and Final delivery.');
  }

  let previousDueMs = minimumTimeMs - 1;
  const dueDates = [];

  milestones.forEach((milestone, index) => {
    const number = index + 1;
    const fixedMilestone = FIXED_MILESTONES[index];
    if (
      milestone.name !== fixedMilestone.name ||
      String(milestone.percentage) !== fixedMilestone.percentage
    ) {
      throw new Error('Milestones and payouts are fixed at Cargo pickup 30% and Final delivery 70%.');
    }
    if (!milestone.name.trim()) throw new Error(`Enter a name for milestone ${number}.`);
    requireMaximumUtf8Length(
      milestone.name,
      MAX_MILESTONE_NAME_LENGTH,
      `Milestone ${number} name`,
    );
    if (!milestone.details.trim()) {
      throw new Error(`Describe the required evidence for milestone ${number}.`);
    }
    requireMaximumUtf8Length(
      milestone.details,
      MAX_MILESTONE_DETAILS_LENGTH,
      `Milestone ${number} details`,
    );

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

  const pickupPayout = (totalWei * 30n) / 100n;
  const payouts = [pickupPayout, totalWei - pickupPayout];
  if (payouts.some((payout) => payout === 0n)) {
    throw new Error('The escrow amount is too small for the fixed 30%/70% payouts.');
  }

  return {
    totalWei,
    payouts,
    dueDates,
    deadline,
  };
}
