import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { normalizeAgreement } from '../hooks/useAgreements';
import { useProfile } from '../hooks/useProfile';
import { buildAgreementIds, isArbitrationAgreement } from '../utils/arbitration';
import {
  decodeEscrowEvent,
  groupAgreementHistory,
  loadContractLogsInChunks,
  reconstructAgreementHistory,
  selectHistoryStartBlock,
} from '../utils/historyEvents';

const eventDetails = {
  AgreementCreated: (args) => `${ethers.formatEther(args.amount)} ETH deposited into escrow`,
  MilestoneProofSubmitted: (args) => `Evidence submitted for milestone ${Number(args.milestoneIndex) + 1}`,
  MilestoneApproved: (args) => `${ethers.formatEther(args.payout)} ETH released for milestone ${Number(args.milestoneIndex) + 1}`,
  CarrierReputationAwarded: (args) => `${args.points.toString()} reputation points awarded to the Carrier (${args.totalPoints.toString()} total)`,
  AgreementCompleted: () => 'All milestones paid and the agreement completed',
  Refunded: (args) => `${ethers.formatEther(args.amount)} ETH returned to the shipper`,
  DisputeOpened: (args) => `Dispute opened: ${args.reason}`,
  DisputeResolved: (args) => `Resolved: ${ethers.formatEther(args.shipperAmount)} ETH to shipper and ${ethers.formatEther(args.carrierAmount)} ETH to carrier`,
};

function History() {
  const location = useLocation();
  const { account, isConnected } = useWallet();
  const { isArbitrator } = useProfile();
  const {
    address,
    deployment,
    getReadContract,
    isConfigured,
    refreshKey,
  } = useContract();
  const [agreements, setAgreements] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyNotice, setHistoryNotice] = useState(location.state?.historyNotice || '');

  useEffect(() => {
    let cancelled = false;
    if (!account || !isConnected || !isConfigured) {
      setAgreements([]);
      setEvents([]);
      return undefined;
    }

    async function loadHistory() {
      try {
        setLoading(true);
        setError('');
        setHistoryNotice(location.state?.historyNotice || '');
        const contract = await getReadContract();
        const candidateIds = isArbitrator
          ? buildAgreementIds(await contract.agreementCount())
          : await contract.getUserAgreementIds(account);
        const candidateAgreements = await Promise.all(
          candidateIds.map((id) => contract.getAgreement(id)),
        );
        const visibleRecords = candidateIds
          .map((id, index) => ({ id, agreement: candidateAgreements[index] }))
          .filter(({ agreement }) => !isArbitrator || isArbitrationAgreement(agreement));
        const ids = visibleRecords.map(({ id }) => id);
        if (!ids.length) {
          if (!cancelled) {
            setAgreements([]);
            setEvents([]);
          }
          return;
        }

        const rawAgreements = visibleRecords.map(({ agreement }) => agreement);
        const agreementSummaries = ids.map(
          (id, index) => normalizeAgreement(id, rawAgreements[index]),
        );

        let normalized;
        try {
          const provider = contract.runner;
          const latestBlock = await provider.getBlockNumber();
          const network = await provider.getNetwork();
          const fromBlock = await selectHistoryStartBlock({
            provider,
            address,
            chainId: Number(network.chainId),
            deployment,
            latestBlock,
          });
          const eventTopics = Object.keys(eventDetails).map(
            (name) => contract.interface.getEvent(name).topicHash,
          );
          const logs = await loadContractLogsInChunks({
            provider,
            address,
            fromBlock,
            toBlock: latestBlock,
            topics: [eventTopics],
          });
          const agreementIds = new Set(ids.map((id) => id.toString()));

          const uniqueBlocks = [...new Set(logs.map((log) => log.blockNumber))];
          const blockEntries = await Promise.all(
            uniqueBlocks.map(async (blockNumber) => [
              blockNumber,
              await provider.getBlock(blockNumber),
            ]),
          );
          const blocks = new Map(blockEntries);
          normalized = logs
            .map((log) => {
              const parsed = decodeEscrowEvent(contract.interface, log);
              if (!parsed || parsed.args?.agreementId === undefined || !eventDetails[parsed.name]) {
                return null;
              }
              if (!agreementIds.has(parsed.args.agreementId.toString())) return null;
              return {
                key: `${log.transactionHash}-${log.index ?? log.logIndex ?? parsed.name}`,
                agreementId: Number(parsed.args.agreementId),
                name: parsed.name,
                detail: eventDetails[parsed.name](parsed.args),
                transactionHash: log.transactionHash,
                timestamp: Number(blocks.get(log.blockNumber)?.timestamp || 0),
              };
            })
            .filter(Boolean);
        } catch {
          const stateEntries = await Promise.all(
            ids.map(async (id, index) => {
              const milestones = await contract.getMilestones(id);
              return reconstructAgreementHistory(
                id,
                rawAgreements[index],
                milestones,
              );
            }),
          );
          normalized = stateEntries.flat();
          if (!cancelled) {
            setHistoryNotice(
              'Your Sepolia RPC does not provide event logs. Showing agreement summaries reconstructed from contract state.',
            );
          }
        }

        normalized.sort((a, b) => b.timestamp - a.timestamp);
        if (!cancelled) {
          setAgreements(agreementSummaries);
          setEvents(normalized);
        }
      } catch (historyError) {
        if (!cancelled) {
          setAgreements([]);
          setEvents([]);
          setError(
            `Unable to read Sepolia history. ${friendlyContractError(historyError)}`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [account, address, deployment, getReadContract, isArbitrator, isConfigured, isConnected, location.state, refreshKey]);

  const agreementHistory = groupAgreementHistory(agreements, events);

  return (
    <div className="panel">
      <div className="section-heading">
        <div>
          <h2>{isArbitrator ? 'Dispute History' : 'Agreement History'}</h2>
          <p>
            {isArbitrator
              ? 'Open a disputed case to resolve it, or review the final record of a resolved case.'
              : 'Each agreement is grouped into one record. Open it to review milestones and details.'}
          </p>
        </div>
        <span className="badge">{agreementHistory.length} agreements</span>
      </div>
      {error && <div className="notice error">{error}</div>}
      {historyNotice && <div className="notice">{historyNotice}</div>}
      {loading ? <p>Reading agreement history…</p> : agreementHistory.length ? (
        <div className="history-agreement-list">
          {agreementHistory.map((agreement) => (
            <Link
              className="history-agreement-card"
              key={agreement.id}
              to={`/agreement/${agreement.id}`}
            >
              <div className="history-agreement-heading">
                <div>
                  <small>Agreement #{agreement.id}</small>
                  <h3>{agreement.title}</h3>
                </div>
                <span className="badge">{agreement.statusLabel}</span>
              </div>
              <div className="history-agreement-stats">
                <span><small>Total escrow</small><strong>{agreement.totalEth} ETH</strong></span>
                <span><small>Remaining</small><strong>{agreement.remainingEth} ETH</strong></span>
                <span>
                  <small>Last activity</small>
                  <strong>
                    {agreement.latestEvent
                      ? agreement.latestEvent.name.replace(/([A-Z])/g, ' $1').trim()
                      : 'Agreement created'}
                  </strong>
                </span>
                <span>
                  <small>Updated</small>
                  <strong>{new Date(agreement.latestTimestamp * 1000).toLocaleString()}</strong>
                </span>
              </div>
              <div className="history-agreement-footer">
                <span>{agreement.eventCount} recorded event{agreement.eventCount === 1 ? '' : 's'}</span>
                <strong>View agreement details →</strong>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p>
          {isConnected
            ? isArbitrator
              ? 'No disputed or resolved agreements found.'
              : 'No agreements found for this wallet.'
            : 'Connect your wallet to view history.'}
        </p>
      )}
    </div>
  );
}

export default History;
