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
  selectHistoryStartBlock,
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
import { addressesEqual } from '../src/utils/address.js';
import {
  buildAgreementIds,
  isArbitrationAgreement,
} from '../src/utils/arbitration.js';
import {
  createUploadAuthorizationMessage,
  evidenceHashMatches,
  getEvidenceGatewayUrl,
  hashEvidenceBytes,
  hashEvidenceFile,
  isValidIpfsCid,
  ipfsUriToCid,
  normalizeGatewayBaseUrl,
  validateEvidenceFileMetadata,
} from '../src/utils/pinataEvidence.js';
import { filterAndSortAgreements } from '../src/utils/agreementFilters.js';
import {
  formatDeadlineDuration,
  getAgreementActionDeadline,
  getDeadlineState,
  isRefundAvailable,
  isRefundButtonAvailable,
} from '../src/utils/deadlineAlerts.js';
import { buildDashboardMetrics } from '../src/utils/dashboardMetrics.js';
import {
  getCarrierReputationTier,
  readCarrierReputation,
} from '../src/utils/carrierReputation.js';
import {
  deploymentMatchesContract,
  resolveContractAddress,
  selectDeploymentForChain,
} from '../src/utils/deploymentConfig.js';
import { findAgreementCreatedId } from '../src/utils/contractReceipts.js';

const nowMs = new Date(2026, 6, 25, 9, 0).getTime();
const shipper = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const carrier = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

const filterAgreements = [
  { id: 1, title: 'Port pickup', shipper, carrier, status: 0, deadline: 300, createdAt: 100 },
  { id: 2, title: 'Warehouse delivery', shipper: carrier, carrier: shipper, status: 3, deadline: 500, createdAt: 200 },
  { id: 3, title: 'Completed cargo', shipper, carrier, status: 1, deadline: 400, createdAt: 150 },
];

test('searches agreements by title, ID and participant address', () => {
  assert.deepEqual(
    filterAndSortAgreements(filterAgreements, { query: 'warehouse' }).map(({ id }) => id),
    [2],
  );
  assert.deepEqual(
    filterAndSortAgreements(filterAgreements, { query: '3' }).map(({ id }) => id),
    [3],
  );
  assert.equal(filterAndSortAgreements(filterAgreements, { query: shipper.toLowerCase() }).length, 3);
});

test('filters on-chain statuses and overdue active agreements', () => {
  assert.deepEqual(
    filterAndSortAgreements(filterAgreements, { status: '3' }).map(({ id }) => id),
    [2],
  );
  assert.deepEqual(
    filterAndSortAgreements(filterAgreements, { status: 'overdue', nowSeconds: 350 }).map(({ id }) => id),
    [1],
  );
});

test('sorts agreements by creation time or nearest deadline', () => {
  assert.deepEqual(filterAndSortAgreements(filterAgreements).map(({ id }) => id), [2, 3, 1]);
  assert.deepEqual(
    filterAndSortAgreements(filterAgreements, { sort: 'deadline' }).map(({ id }) => id),
    [1, 3, 2],
  );
  assert.deepEqual(
    filterAndSortAgreements(filterAgreements, { sort: 'oldest' }).map(({ id }) => id),
    [1, 3, 2],
  );
});

test('formats live deadline countdowns and assigns warning colors', () => {
  assert.equal(formatDeadlineDuration(90_061), '1d 1h 1m');
  assert.equal(getDeadlineState(200_000, 100_000).level, 'safe');
  assert.equal(getDeadlineState(110_000, 100_000).level, 'warning');
  assert.equal(getDeadlineState(103_600, 100_000).level, 'critical');
  assert.deepEqual(
    getDeadlineState(99_000, 100_000),
    { level: 'overdue', countdown: 'Overdue by 16m 40s', secondsRemaining: -1_000 },
  );
});

test('uses the current pending milestone for urgency and refund availability', () => {
  const agreement = {
    status: 0,
    deadline: 500,
    currentMilestoneDueAt: 300,
    currentMilestoneState: 0,
  };
  assert.equal(getAgreementActionDeadline(agreement), 300);
  assert.equal(isRefundAvailable(agreement, 299), false);
  assert.equal(isRefundAvailable(agreement, 301), true);

  const submitted = { ...agreement, currentMilestoneState: 1 };
  assert.equal(getAgreementActionDeadline(submitted), 500);
  assert.equal(isRefundAvailable(submitted, 600), false);
});

test('uses only confirmed contract state for the refund action button', () => {
  assert.equal(isRefundButtonAvailable(true), true);
  assert.equal(isRefundButtonAvailable(false), false);
  assert.equal(isRefundButtonAvailable(1), false);
  assert.equal(isRefundButtonAvailable(Date.now() > 0 && false), false);
});

test('sorts active pending milestones before closed agreements when urgency is selected', () => {
  const agreements = [
    { ...filterAgreements[0], currentMilestoneDueAt: 250, currentMilestoneState: 0 },
    filterAgreements[1],
    filterAgreements[2],
  ];
  assert.deepEqual(
    filterAndSortAgreements(agreements, { sort: 'urgent' }).map(({ id }) => id),
    [1, 3, 2],
  );
  assert.deepEqual(
    filterAndSortAgreements(agreements, { status: 'overdue', nowSeconds: 275 }).map(({ id }) => id),
    [1],
  );
});

test('summarizes escrow, statuses, workflow, and deadline risk for dashboard charts', () => {
  const metrics = buildDashboardMetrics([
    {
      id: 1,
      status: 0,
      totalAmount: 100n,
      remainingAmount: 70n,
      deadline: 500,
      currentMilestoneDueAt: 200,
      currentMilestoneState: 0,
    },
    {
      id: 2,
      status: 0,
      totalAmount: 200n,
      remainingAmount: 150n,
      deadline: 600,
      currentMilestoneDueAt: 300,
      currentMilestoneState: 1,
    },
    { id: 3, status: 1, totalAmount: 300n, remainingAmount: 0n, deadline: 400 },
    { id: 4, status: 3, totalAmount: 400n, remainingAmount: 400n, deadline: 700 },
  ], 100);

  assert.equal(metrics.totalCount, 4);
  assert.equal(metrics.activeCount, 2);
  assert.equal(metrics.completedCount, 1);
  assert.equal(metrics.disputedCount, 1);
  assert.equal(metrics.totalAmount, 1_000n);
  assert.equal(metrics.remainingAmount, 620n);
  assert.equal(metrics.distributedAmount, 380n);
  assert.equal(metrics.pendingEvidenceCount, 1);
  assert.equal(metrics.awaitingApprovalCount, 1);
  assert.equal(metrics.deadlineCounts.critical, 1);
  assert.equal(metrics.nextDeadlineAgreement.id, 1);
  assert.deepEqual(metrics.statusCounts.map(({ count }) => count), [2, 1, 0, 1, 0]);
});

test('assigns transparent carrier reputation tiers from on-chain points', () => {
  assert.equal(getCarrierReputationTier(0n), 'New carrier');
  assert.equal(getCarrierReputationTier(10n), 'Emerging carrier');
  assert.equal(getCarrierReputationTier(50n), 'Established carrier');
  assert.equal(getCarrierReputationTier(100n), 'Trusted carrier');
  assert.equal(getCarrierReputationTier(250n), 'Elite carrier');
});

test('reads reputation and gracefully detects a deployment without reputation support', async () => {
  assert.equal(
    await readCarrierReputation({ carrierReputation: async () => 30n }, carrier),
    30n,
  );
  assert.equal(
    await readCarrierReputation({
      carrierReputation: async () => {
        const error = new Error('could not decode result data');
        error.code = 'BAD_DATA';
        throw error;
      },
    }, carrier),
    null,
  );
});

test('recognizes the deployer address regardless of checksum casing', () => {
  assert.equal(addressesEqual(shipper, shipper.toLowerCase()), true);
  assert.equal(addressesEqual(shipper, carrier), false);
  assert.equal(addressesEqual(shipper, null), false);
});

test('builds the arbitrator case range and includes disputed and resolved records', () => {
  assert.deepEqual(buildAgreementIds(3n), [0n, 1n, 2n]);
  assert.equal(isArbitrationAgreement({ status: 3n }), true);
  assert.equal(isArbitrationAgreement({ status: 4n }), true);
  assert.equal(isArbitrationAgreement({ status: 0n }), false);
});

test('cryptographically verifies uploaded file bytes before payout approval', () => {
  const receipt = new TextEncoder().encode('signed delivery receipt');
  const altered = new TextEncoder().encode('altered delivery receipt');
  const proofHash = hashEvidenceBytes(receipt);
  assert.equal(proofHash, ethers.keccak256(receipt));
  assert.equal(evidenceHashMatches(hashEvidenceBytes(receipt), proofHash), true);
  assert.equal(evidenceHashMatches(hashEvidenceBytes(altered), proofHash), false);
});

test('builds safe IPFS gateway links and wallet upload authorization messages', () => {
  const cid = `b${'a'.repeat(58)}`;
  assert.equal(normalizeGatewayBaseUrl('demo.mypinata.cloud/'), 'https://demo.mypinata.cloud');
  assert.equal(isValidIpfsCid(cid), true);
  assert.equal(ipfsUriToCid(`ipfs://${cid}`), cid);
  assert.equal(
    getEvidenceGatewayUrl(`ipfs://${cid}`, 'demo.mypinata.cloud'),
    `https://demo.mypinata.cloud/ipfs/${cid}`,
  );
  assert.equal(getEvidenceGatewayUrl('https://attacker.example/file', 'demo.mypinata.cloud'), '');
  assert.equal(getEvidenceGatewayUrl('ipfs://not-a-cid', 'demo.mypinata.cloud'), '');
  const message = createUploadAuthorizationMessage({
    account: carrier,
    agreementId: '7',
    contractAddress: shipper,
    fileName: 'receipt.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    milestoneIndex: 1,
    nonce: '12345678-1234-1234-1234-123456789abc',
    timestamp: 123456789,
  });
  assert.match(message, /ChainCargo evidence upload/);
  assert.match(message, /Agreement: 7/);
  assert.match(message, /File: receipt\.pdf/);
});

test('validates evidence metadata and hashes file bytes with Keccak-256', async () => {
  const bytes = new TextEncoder().encode('signed receipt');
  const file = {
    name: 'receipt.pdf',
    size: bytes.length,
    type: 'application/pdf',
    arrayBuffer: async () => bytes.buffer,
  };
  assert.doesNotThrow(() => validateEvidenceFileMetadata(file));
  assert.equal(await hashEvidenceFile(file), ethers.keccak256(bytes));
  assert.throws(
    () => validateEvidenceFileMetadata({ ...file, type: 'text/html' }),
    /JPEG, PNG, WebP, or PDF/i,
  );
  assert.throws(
    () => validateEvidenceFileMetadata({ ...file, size: 10 * 1024 * 1024 + 1 }),
    /10 MB or smaller/i,
  );
});

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

test('mirrors important contract text limits before transaction submission', () => {
  const longTitle = validDraft();
  longTitle.form.title = 'x'.repeat(201);
  assert.throws(() => validateAgreementDraft(longTitle), /200 bytes or fewer/i);

  const longDetails = validDraft();
  longDetails.milestones[0].details = 'x'.repeat(1001);
  assert.throws(() => validateAgreementDraft(longDetails), /1000 bytes or fewer/i);
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

test('uses saved deployment blocks only for the matching contract and chain', async () => {
  const savedAddress = '0x0000000000000000000000000000000000004321';
  const overrideAddress = '0x0000000000000000000000000000000000009876';
  const deployment = { address: savedAddress, chainId: 11155111, deploymentBlock: 500 };
  let codeCalls = 0;
  const provider = {
    getCode: async (_address, block) => {
      codeCalls += 1;
      return block >= 700 ? '0x6000' : '0x';
    },
  };

  assert.equal(await selectHistoryStartBlock({
    provider,
    address: savedAddress,
    chainId: 11155111,
    deployment,
    latestBlock: 1_000,
  }), 500);
  assert.equal(codeCalls, 0);

  assert.equal(await selectHistoryStartBlock({
    provider,
    address: overrideAddress,
    chainId: 11155111,
    deployment,
    latestBlock: 1_000,
  }), 700);
  assert.ok(codeCalls > 0);

  const callsBeforeChainMismatch = codeCalls;
  assert.equal(await selectHistoryStartBlock({
    provider,
    address: savedAddress,
    chainId: 31337,
    deployment,
    latestBlock: 1_000,
  }), 700);
  assert.ok(codeCalls > callsBeforeChainMismatch);
});

test('selects local or Sepolia deployment metadata without inventing addresses', () => {
  const sepolia = { address: shipper, chainId: 11155111 };
  const local = { address: carrier, chainId: 31337 };
  assert.equal(selectDeploymentForChain(11155111, sepolia, local), sepolia);
  assert.equal(selectDeploymentForChain(31337, sepolia, local), local);
  assert.equal(selectDeploymentForChain(1, sepolia, local).address, '');
  assert.equal(resolveContractAddress({ deployment: local }), carrier);
  assert.equal(resolveContractAddress({ deployment: { address: '', chainId: 31337 } }), '');
  assert.equal(deploymentMatchesContract({ address: shipper, chainId: 11155111, deployment: sepolia }), true);
  assert.equal(deploymentMatchesContract({ address: carrier, chainId: 11155111, deployment: sepolia }), false);
});

test('extracts AgreementCreated only from the confirmed escrow contract logs', () => {
  const contractInterface = new ethers.Interface(ESCROW_ABI);
  const encoded = contractInterface.encodeEventLog(
    contractInterface.getEvent('AgreementCreated'),
    [9, shipper, carrier, ethers.parseEther('1'), 1_800_000_000],
  );
  const correctLog = { address: shipper, topics: encoded.topics, data: encoded.data };
  const foreignLog = { ...correctLog, address: carrier };

  assert.equal(
    findAgreementCreatedId({ logs: [foreignLog, correctLog] }, contractInterface, shipper),
    9n,
  );
  assert.equal(
    findAgreementCreatedId({ logs: [foreignLog] }, contractInterface, shipper),
    null,
  );
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
