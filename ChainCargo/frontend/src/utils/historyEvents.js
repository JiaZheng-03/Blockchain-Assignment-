import { ethers } from 'ethers';
import { deploymentMatchesContract } from './deploymentConfig.js';

export const HISTORY_BLOCK_CHUNK_SIZE = 5_000;

const deploymentBlockCache = new Map();

export function decodeEscrowEvent(contractInterface, log) {
  if (!log?.topics || typeof log?.data !== 'string') return null;
  try {
    return contractInterface.parseLog({
      topics: log.topics,
      data: log.data,
    });
  } catch {
    return null;
  }
}

export async function findContractDeploymentBlock(
  provider,
  address,
  latestBlock,
  cacheNamespace = '',
) {
  const cacheKey = `${cacheNamespace}:${address.toLowerCase()}`;
  if (deploymentBlockCache.has(cacheKey)) return deploymentBlockCache.get(cacheKey);
  if ((await provider.getCode(address, latestBlock)) === '0x') {
    throw new Error('The configured contract has no code on Sepolia.');
  }

  let low = 0;
  let high = latestBlock;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((await provider.getCode(address, middle)) === '0x') {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  deploymentBlockCache.set(cacheKey, low);
  return low;
}

export async function selectHistoryStartBlock({
  provider,
  address,
  chainId,
  deployment,
  latestBlock,
}) {
  const savedBlock = Number(deployment?.deploymentBlock || 0);
  if (
    savedBlock > 0 &&
    deploymentMatchesContract({ address, chainId, deployment })
  ) {
    return savedBlock;
  }
  return findContractDeploymentBlock(provider, address, latestBlock, String(chainId));
}

export async function loadContractLogsInChunks({
  provider,
  address,
  fromBlock,
  toBlock,
  topics,
  chunkSize = HISTORY_BLOCK_CHUNK_SIZE,
}) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    const chunk = await provider.getLogs({
      address,
      fromBlock: start,
      toBlock: end,
      ...(topics?.length ? { topics } : {}),
    });
    logs.push(...chunk);
  }
  return logs;
}

export function reconstructAgreementHistory(agreementId, agreement, milestones) {
  const id = Number(agreementId);
  const entries = [{
    key: `state-created-${id}`,
    agreementId: id,
    name: 'AgreementCreated',
    detail: `${ethers.formatEther(agreement.totalAmount)} ETH deposited into escrow`,
    transactionHash: null,
    timestamp: Number(agreement.createdAt),
  }];

  milestones.forEach((milestone, index) => {
    const submittedAt = Number(milestone.submittedAt);
    const approvedAt = Number(milestone.approvedAt);
    if (submittedAt) {
      entries.push({
        key: `state-submitted-${id}-${index}`,
        agreementId: id,
        name: 'MilestoneProofSubmitted',
        detail: `Evidence submitted for milestone ${index + 1}`,
        transactionHash: null,
        timestamp: submittedAt,
      });
    }
    if (approvedAt) {
      entries.push({
        key: `state-confirmed-${id}-${index}`,
        agreementId: id,
        name: 'MilestoneConfirmed',
        detail: `${ethers.formatEther(milestone.payout)} ETH released after Shipper confirmation; Carrier reputation awarded for milestone ${index + 1}`,
        transactionHash: null,
        timestamp: approvedAt,
      });
    }
  });

  if (Number(agreement.status) === 1) {
    const completedAt = milestones.reduce(
      (latest, milestone) => Math.max(latest, Number(milestone.approvedAt)),
      Number(agreement.createdAt),
    );
    entries.push({
      key: `state-completed-${id}`,
      agreementId: id,
      name: 'AgreementCompleted',
      detail: 'All milestones paid and the agreement completed',
      transactionHash: null,
      timestamp: completedAt,
    });
  }

  return entries;
}

export function groupAgreementHistory(agreements, events) {
  const eventsByAgreement = new Map();
  events.forEach((event) => {
    const current = eventsByAgreement.get(event.agreementId) || [];
    current.push(event);
    eventsByAgreement.set(event.agreementId, current);
  });

  return agreements
    .map((agreement) => {
      const agreementEvents = (eventsByAgreement.get(agreement.id) || [])
        .sort((a, b) => b.timestamp - a.timestamp);
      return {
        ...agreement,
        eventCount: agreementEvents.length,
        latestEvent: agreementEvents[0] || null,
        latestTimestamp: agreementEvents[0]?.timestamp || agreement.createdAt,
      };
    })
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp);
}
