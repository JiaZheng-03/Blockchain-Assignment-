import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MILESTONES,
  validateAgreementDraft,
} from '../src/utils/agreementValidation.js';
import { ethers } from 'ethers';
import { ESCROW_ABI } from '../src/contracts/abi.js';
import { friendlyContractError } from '../src/utils/contractErrors.js';
import {
  decodeEscrowEvent,
  findContractDeploymentBlock,
  groupAgreementHistory,
  loadContractLogsInChunks,
  reconstructAgreementHistory,
} from '../src/utils/historyEvents.js';
import {
  SEPOLIA_NETWORK,
  switchWalletNetwork,
  toHexChainId,
} from '../src/utils/walletNetwork.js';
import {
  getSepoliaAddressUrl,
  getSepoliaTransactionUrl,
} from '../src/utils/sepoliaExplorer.js';

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

test('accepts same-day milestones in time order and allows the last one at the final deadline', () => {
  const draft = validDraft();
  draft.milestones[0].dueAt = '2026-07-25T10:00';
  draft.milestones[1].dueAt = '2026-07-25T12:00';

  const result = validateAgreementDraft(draft);
  assert.deepEqual(result.dueDates, [
    Math.floor(new Date('2026-07-25T10:00').getTime() / 1000),
    Math.floor(new Date('2026-07-25T12:00').getTime() / 1000),
  ]);
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

test('finds the contract deployment block and reads history in RPC-safe chunks', async () => {
  const codeCalls = [];
  const logCalls = [];
  const provider = {
    getCode: async (_address, blockNumber) => {
      codeCalls.push(blockNumber);
      return blockNumber >= 12_345 ? '0x6000' : '0x';
    },
    getLogs: async (filter) => {
      logCalls.push(filter);
      return [{ blockNumber: filter.fromBlock }];
    },
  };
  const address = '0x0000000000000000000000000000000000001234';

  const deploymentBlock = await findContractDeploymentBlock(provider, address, 20_000);
  assert.equal(deploymentBlock, 12_345);
  assert.ok(codeCalls.length < 20);

  const logs = await loadContractLogsInChunks({
    provider,
    address,
    fromBlock: deploymentBlock,
    toBlock: 23_000,
    topics: [['0xevent1', '0xevent2']],
    chunkSize: 5_000,
  });
  assert.equal(logCalls.length, 3);
  assert.deepEqual(
    logCalls.map(({ fromBlock, toBlock }) => [fromBlock, toBlock]),
    [[12_345, 17_344], [17_345, 22_344], [22_345, 23_000]],
  );
  assert.deepEqual(logCalls[0].topics, [['0xevent1', '0xevent2']]);
  assert.equal(logs.length, 3);
});

test('reconstructs viewable history when an RPC rejects event-log queries', () => {
  const entries = reconstructAgreementHistory(
    7n,
    {
      totalAmount: ethers.parseEther('1'),
      createdAt: 100n,
      status: 1n,
    },
    [
      {
        payout: ethers.parseEther('0.3'),
        submittedAt: 200n,
        approvedAt: 300n,
      },
      {
        payout: ethers.parseEther('0.7'),
        submittedAt: 400n,
        approvedAt: 500n,
      },
    ],
  );

  assert.deepEqual(
    entries.map(({ name, timestamp }) => [name, timestamp]),
    [
      ['AgreementCreated', 100],
      ['MilestoneProofSubmitted', 200],
      ['MilestoneApproved', 300],
      ['MilestoneProofSubmitted', 400],
      ['MilestoneApproved', 500],
      ['AgreementCompleted', 500],
    ],
  );
  assert.ok(entries.every((entry) => entry.transactionHash === null));
});

test('groups history into one newest-first summary per agreement', () => {
  const grouped = groupAgreementHistory(
    [
      { id: 0, title: 'Older', createdAt: 100 },
      { id: 1, title: 'Newer activity', createdAt: 200 },
    ],
    [
      { agreementId: 0, name: 'AgreementCreated', timestamp: 100 },
      { agreementId: 0, name: 'MilestoneApproved', timestamp: 500 },
      { agreementId: 1, name: 'AgreementCreated', timestamp: 200 },
    ],
  );

  assert.deepEqual(grouped.map((agreement) => agreement.id), [0, 1]);
  assert.equal(grouped[0].eventCount, 2);
  assert.equal(grouped[0].latestEvent.name, 'MilestoneApproved');
  assert.equal(grouped[1].eventCount, 1);
});

test('formats chain IDs and asks MetaMask to switch to Sepolia', async () => {
  const calls = [];
  const ethereum = {
    request: async (request) => {
      calls.push(request);
    },
  };

  assert.equal(toHexChainId(11155111), '0xaa36a7');
  await switchWalletNetwork(ethereum, 11155111, SEPOLIA_NETWORK);
  assert.deepEqual(calls, [{
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0xaa36a7' }],
  }]);
});

test('adds Sepolia metadata when a wallet does not know the network', async () => {
  const calls = [];
  const ethereum = {
    request: async (request) => {
      calls.push(request);
      if (request.method === 'wallet_switchEthereumChain') {
        const error = new Error('Unknown chain');
        error.code = 4902;
        throw error;
      }
    },
  };

  await switchWalletNetwork(ethereum, 11155111, SEPOLIA_NETWORK);
  assert.equal(calls[1].method, 'wallet_addEthereumChain');
  assert.equal(calls[1].params[0].chainId, '0xaa36a7');
  assert.deepEqual(calls[1].params[0].rpcUrls, ['https://rpc.sepolia.org']);
  assert.deepEqual(calls[1].params[0].blockExplorerUrls, ['https://sepolia.etherscan.io']);
});

test('builds Sepolia explorer links for connected wallets and transactions', () => {
  assert.equal(
    getSepoliaAddressUrl(shipper),
    `https://sepolia.etherscan.io/address/${shipper}`,
  );
  assert.equal(
    getSepoliaTransactionUrl('0xabc123'),
    'https://sepolia.etherscan.io/tx/0xabc123',
  );
});
