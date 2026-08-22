import { ethers } from 'ethers';
import { ESCROW_ABI } from '../contracts/abi.js';

const contractInterface = new ethers.Interface(ESCROW_ABI);

const errorMessages = {
  Unauthorized: 'This wallet is not authorized to perform that action.',
  InvalidInput: 'The contract rejected one or more invalid values.',
  InvalidRole: 'The selected wallet has the wrong registered role.',
  AlreadyRegistered: 'This wallet is already registered.',
  NotRegistered: 'This wallet is not registered.',
  InvalidStatus: 'The agreement is not in the correct state for that action.',
  InvalidMilestone: 'That milestone is not currently eligible for this action.',
  DeadlinePassed: 'The agreement deadline has already passed.',
  DeadlineNotPassed: 'A refund is not available before the applicable deadline.',
  TransferFailed: 'The Ether transfer failed.',
  ReentrantCall: 'The contract blocked an unsafe repeated call.',
  SameParticipant: 'The shipper and carrier must use different wallet addresses.',
  EmptyTitle: 'Enter an agreement name.',
  ZeroFunding: 'The escrow amount must be greater than zero.',
  MilestoneArrayLengthMismatch: 'The milestone fields have inconsistent lengths.',
  InvalidProofURI: 'Evidence must use a non-empty, bounded ipfs:// URI.',
  DeadlineRefundAvailable: 'The pending milestone deadline has passed. The refund must be handled before a new dispute.',
};

function findRevertData(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.data,
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.startsWith('0x'));
}

function describeCustomError(parsed) {
  const index = parsed.args?.milestoneIndex === undefined
    ? null
    : Number(parsed.args.milestoneIndex) + 1;
  switch (parsed.name) {
    case 'AgreementNotFound':
      return `Agreement #${parsed.args.agreementId} does not exist on this deployment.`;
    case 'InvalidCarrier':
      return 'The selected wallet is not registered as a Carrier.';
    case 'InvalidDeadline':
      return 'The final deadline must be later than the current blockchain time.';
    case 'InvalidMilestoneCount':
      return `The contract does not allow ${parsed.args.count} milestones.`;
    case 'EmptyMilestoneName':
      return `Milestone ${index} needs a name.`;
    case 'ZeroMilestonePayout':
      return `Milestone ${index} must have a non-zero payout.`;
    case 'MilestoneDeadlineNotSequential':
      return `Milestone ${index} must be in the future and later than the previous milestone.`;
    case 'MilestoneDeadlineAfterAgreement':
      return `Milestone ${index} cannot be later than the final deadline.`;
    case 'PayoutTotalMismatch':
      return 'Milestone payouts must exactly equal the deposited escrow amount.';
    case 'InputTooLong':
      return `A text value is too long. The contract allows at most ${parsed.args.maximumLength} bytes.`;
    default:
      return errorMessages[parsed.name] || null;
  }
}

export function friendlyContractError(error) {
  const knownName = error?.revert?.name || error?.errorName;
  if (knownName) {
    const described = describeCustomError({
      name: knownName,
      args: error?.revert?.args || error?.errorArgs || [],
    });
    if (described) return described;
  }

  const revertData = findRevertData(error);
  if (revertData) {
    try {
      const described = describeCustomError(contractInterface.parseError(revertData));
      if (described) return described;
    } catch {
      // Fall back to the provider's message below.
    }
  }

  const message =
    error?.shortMessage ||
    error?.reason ||
    error?.info?.error?.message ||
    error?.message ||
    'The blockchain transaction failed.';
  if (message.includes('unknown custom error')) {
    return 'The contract rejected the transaction. Restart the local chain, redeploy the latest contract, and check the form values.';
  }
  return message.replace('execution reverted: ', '');
}
