import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MILESTONES,
  validateAgreementDraft,
} from '../src/utils/agreementValidation.js';
import { ethers } from 'ethers';
import { ESCROW_ABI } from '../src/contracts/abi.js';
import { friendlyContractError } from '../src/utils/contractErrors.js';
import { decodeEscrowEvent } from '../src/utils/historyEvents.js';

const nowMs = new Date(2026, 6, 25, 9, 0).getTime();
const shipper = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const carrier = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

function validDraft() {
  return {
    account: shipper,
    nowMs,
    form: {
      title: 'Port Klang shipment',
      carrier,
      totalAmount: '1',
      deadline: '2026-07-25T12:00',
      notes: '',
    },
    milestones: [
      { name: 'Pickup', details: 'Signed pickup note', percentage: '30', dueAt: '2026-07-25T10:00' },
      { name: 'Delivery', details: 'Signed delivery note', percentage: '70', dueAt: '2026-07-25T11:30' },
    ],
  };
}

test('accepts a valid chronological agreement and calculates exact payouts', () => {
  const result = validateAgreementDraft(validDraft());
  assert.equal(result.payouts[0], 300000000000000000n);
  assert.equal(result.payouts[1], 700000000000000000n);
  assert.equal(result.payouts.reduce((sum, value) => sum + value, 0n), result.totalWei);
});

test('rejects final deadlines and milestone dates in the past', () => {
  const pastDeadline = validDraft();
  pastDeadline.form.deadline = '2026-07-25T08:00';
  assert.throws(
    () => validateAgreementDraft(pastDeadline),
    /final deadline must be at least 2 minutes in the future/i,
  );

  const pastMilestone = validDraft();
  pastMilestone.milestones[0].dueAt = '2026-07-25T08:30';
  assert.throws(
    () => validateAgreementDraft(pastMilestone),
    /milestone 1 must be due at least 2 minutes in the future/i,
  );
});

test('rejects non-chronological milestones and milestones after the final deadline', () => {
  const unordered = validDraft();
  unordered.milestones[1].dueAt = unordered.milestones[0].dueAt;
  assert.throws(() => validateAgreementDraft(unordered), /later than the previous milestone/i);

  const tooLate = validDraft();
  tooLate.milestones[1].dueAt = '2026-07-25T12:30';
  assert.throws(() => validateAgreementDraft(tooLate), /cannot be later than the final deadline/i);
});

test('rejects invalid participants, percentages, and zero-wei milestone payouts', () => {
  const sameParticipant = validDraft();
  sameParticipant.form.carrier = shipper;
  assert.throws(() => validateAgreementDraft(sameParticipant), /different wallet addresses/i);

  const decimalPercentage = validDraft();
  decimalPercentage.milestones[0].percentage = '30.5';
  decimalPercentage.milestones[1].percentage = '69.5';
  assert.throws(() => validateAgreementDraft(decimalPercentage), /whole percentage/i);

  const wrongTotal = validDraft();
  wrongTotal.milestones[1].percentage = '60';
  assert.throws(() => validateAgreementDraft(wrongTotal), /total 90%/i);

  const dust = validDraft();
  dust.form.totalAmount = '0.000000000000000001';
  dust.milestones[0].percentage = '1';
  dust.milestones[1].percentage = '99';
  assert.throws(() => validateAgreementDraft(dust), /payout is too small/i);
});

test('caps milestone count to keep agreement creation gas-bounded', () => {
  const draft = validDraft();
  draft.milestones = Array.from({ length: MAX_MILESTONES + 1 }, (_, index) => ({
    name: `Milestone ${index + 1}`,
    details: 'Evidence',
    percentage: '1',
    dueAt: '2026-07-25T10:00',
  }));
  assert.throws(() => validateAgreementDraft(draft), /at most 20 milestones/i);
});

test('decodes Solidity custom errors into actionable messages', () => {
  const contractInterface = new ethers.Interface(ESCROW_ABI);
  const invalidDateData = contractInterface.encodeErrorResult(
    'MilestoneDeadlineNotSequential',
    [1],
  );
  assert.equal(
    friendlyContractError({ data: invalidDateData }),
    'Milestone 2 must be in the future and later than the previous milestone.',
  );

  const missingData = contractInterface.encodeErrorResult('AgreementNotFound', [42]);
  assert.equal(
    friendlyContractError({ info: { error: { data: missingData } } }),
    'Agreement #42 does not exist on this deployment.',
  );
});

test('decodes raw provider event logs before reading agreementId', () => {
  const contractInterface = new ethers.Interface(ESCROW_ABI);
  const event = contractInterface.getEvent('AgreementCreated');
  const encoded = contractInterface.encodeEventLog(event, [
    7,
    shipper,
    carrier,
    ethers.parseEther('1'),
    1784952000,
  ]);
  const parsed = decodeEscrowEvent(contractInterface, {
    topics: encoded.topics,
    data: encoded.data,
  });

  assert.equal(parsed.name, 'AgreementCreated');
  assert.equal(parsed.args.agreementId, 7n);
  assert.equal(parsed.args.shipper, shipper);
  assert.equal(decodeEscrowEvent(contractInterface, { data: '0x' }), null);
});
