import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { normalizeAgreement } from '../hooks/useAgreements';
import { useProfile } from '../hooks/useProfile';
import { buildAgreementIds, isArbitrationAgreement } from '../utils/arbitration';
import Icon from '../components/Icon';
import {
  decodeEscrowEvent,
  groupAgreementHistory,
  loadContractLogsInChunks,
  reconstructAgreementHistory,
  selectHistoryStartBlock,
} from '../utils/historyEvents';

const eventDetails = {
  AgreementCreated: (args) => `${ethers.formatEther(args.amount)} ETH deposited into escrow`,
  AgreementAccepted: () => 'Carrier accepted the agreement and activated the milestone workflow',
  AgreementRejected: (args) => `Carrier rejected the agreement; ${ethers.formatEther(args.refundAmount)} ETH returned to the Shipper. Reason: ${args.reason}`,
  UnacceptedAgreementCancelled: (args) => `Carrier response period expired; ${ethers.formatEther(args.refundAmount)} ETH returned to the Shipper`,
  MilestoneProofSubmitted: (args) => `Evidence submitted for milestone ${Number(args.milestoneIndex) + 1}`,
  MilestoneConfirmed: (args) => `${ethers.formatEther(args.paymentAmount)} ETH released after Shipper confirmation for milestone ${Number(args.milestoneIndex) + 1}`,
  CarrierReputationAwarded: (args) => `${args.points.toString()} reputation points awarded to the Carrier (${args.totalPoints.toString()} total)`,
  EvidenceRevisionRequested: (args) => `Shipper requested replacement evidence for milestone ${Number(args.milestoneIndex) + 1}; resubmission is due ${new Date(Number(args.resubmissionDueAt) * 1000).toLocaleString()}`,
  AgreementCompleted: () => 'All milestones paid and the agreement completed',
  Refunded: (args) => `${ethers.formatEther(args.amount)} ETH returned to the shipper`,
  DisputeOpened: (args) => `Dispute opened: ${args.reason}`,
  DisputeResolved: (args) => `Resolved: ${ethers.formatEther(args.shipperAmount)} ETH to shipper and ${ethers.formatEther(args.carrierAmount)} ETH to carrier`,
  DisputeContinued: (args) => `Arbitrator ${args.evidenceApproved ? 'approved the evidence' : 'requested replacement evidence'} for milestone ${Number(args.milestoneIndex) + 1}; deadlines restored by ${Number(args.pausedSeconds)} seconds`,
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
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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
  const normalizedQuery = query.trim().toLowerCase();
  const filteredHistory = agreementHistory.filter((agreement) => {
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'pending' && agreement.status === 5)
      || String(agreement.status) === statusFilter;
    return matchesStatus && (
      !normalizedQuery ||
      [agreement.title, String(agreement.id), `#${agreement.id}`, agreement.shipper, agreement.carrier]
        .some((value) => String(value || '').toLowerCase().includes(normalizedQuery))
    );
  });
  const tabs = [
    ['all', 'All'],
    ['0', 'Active'],
    ['pending', 'Pending'],
    ['1', 'Completed'],
    ['2', 'Refunded'],
    ['3', 'Disputed'],
    ['4', 'Resolved'],
    ['6', 'Rejected'],
  ];
  const exportHistory = () => {
    const escapeCell = (value) => {
      const text = String(value ?? '');
      const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = [
      ['Agreement ID', 'Agreement', 'Total ETH', 'Remaining ETH', 'Status', 'Last activity (UTC)', 'Event count'],
      ...filteredHistory.map((agreement) => [
        agreement.id, agreement.title, agreement.totalEth, agreement.remainingEth,
        agreement.statusLabel, new Date(agreement.latestTimestamp * 1000).toISOString(), agreement.eventCount,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chaincargo-transactions.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section>
      <div className="page-heading">
        <div><h1>{isArbitrator ? 'Dispute history' : 'Transactions'}</h1><p>{isArbitrator ? 'A complete record of cases and their on-chain resolutions.' : 'The complete history of your agreements and escrow movements.'}</p></div>
        <div className="page-heading-actions">
          <button className="btn btn-secondary" disabled={loading || !filteredHistory.length} onClick={exportHistory} type="button"><Icon name="download" size={16} />Export CSV</button>
        </div>
      </div>
      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="filter-tabs" role="group" aria-label="Filter transactions by status">
            {tabs.map(([value, label]) => <button className={statusFilter === value ? 'active' : ''} aria-pressed={statusFilter === value} key={value} onClick={() => setStatusFilter(value)} type="button">{label}</button>)}
          </div>
          <label className="table-search"><span className="sr-only">Search transactions</span><Icon name="search" size={15} /><input placeholder="Search agreement..." type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
        {error && <div className="notice error">{error}</div>}
        {historyNotice && <div className="notice">{historyNotice}</div>}
        {loading ? (
          <div className="empty-state" role="status"><Icon name="arrows" size={28} /><p>Reading your on-chain history...</p></div>
        ) : filteredHistory.length ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Agreement transactions">
            <table className="data-table">
              <thead><tr><th scope="col">Agreement</th><th scope="col">Latest activity</th><th scope="col">Total escrow</th><th scope="col">Remaining</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
              <tbody>
                {filteredHistory.map((agreement) => (
                  <tr key={agreement.id}>
                    <td><Link className="table-agreement" to={`/agreement/${agreement.id}`}><span className="asset-icon"><Icon name="box" size={17} /></span><span><strong>{agreement.title}</strong><small>Agreement #{agreement.id}</small></span></Link></td>
                    <td className="table-activity">{agreement.latestEvent ? agreement.latestEvent.name.replace(/([A-Z])/g, ' $1').trim() : 'Agreement created'}<small>{agreement.eventCount} event{agreement.eventCount === 1 ? '' : 's'}</small></td>
                    <td className="table-amount">{agreement.totalEth} ETH</td>
                    <td className="table-date">{agreement.remainingEth} ETH</td>
                    <td><span className={`badge status-${agreement.statusLabel.toLowerCase().replaceAll(' ', '-')}`}>{agreement.statusLabel}</span></td>
                    <td className="table-date"><time dateTime={new Date(agreement.latestTimestamp * 1000).toISOString()} title={new Date(agreement.latestTimestamp * 1000).toLocaleString()}>{new Date(agreement.latestTimestamp * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Icon name={agreementHistory.length ? 'search' : 'arrows'} size={32} />
            <h3>{agreementHistory.length ? 'No matching transactions' : 'Your story starts with an agreement'}</h3>
            <p>{agreementHistory.length ? 'Try a different status or search term.' : isArbitrator ? 'No disputed or resolved agreements found.' : 'Once you participate in a shipment, its agreement and payment history will appear here.'}</p>
            {agreementHistory.length > 0 && <button className="btn btn-secondary" onClick={() => { setQuery(''); setStatusFilter('all'); }} type="button">Clear filters</button>}
          </div>
        )}
        <div className="table-footer"><span>{filteredHistory.length} of {agreementHistory.length} agreement{agreementHistory.length === 1 ? '' : 's'}</span><span><Icon name="shield" size={13} />Sourced from the blockchain</span></div>
      </div>
    </section>
  );
}
export default History;
