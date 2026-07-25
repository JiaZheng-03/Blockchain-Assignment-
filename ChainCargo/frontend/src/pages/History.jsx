import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { decodeEscrowEvent } from '../utils/historyEvents';

const eventDetails = {
  AgreementCreated: (args) => `${ethers.formatEther(args.amount)} ETH deposited into escrow`,
  MilestoneProofSubmitted: (args) => `Evidence submitted for milestone ${Number(args.milestoneIndex) + 1}`,
  MilestoneApproved: (args) => `${ethers.formatEther(args.payout)} ETH released for milestone ${Number(args.milestoneIndex) + 1}`,
  AgreementCompleted: () => 'All milestones paid and the agreement completed',
  Refunded: (args) => `${ethers.formatEther(args.amount)} ETH returned to the shipper`,
  DisputeOpened: (args) => `Dispute opened: ${args.reason}`,
  DisputeResolved: (args) => `Resolved: ${ethers.formatEther(args.shipperAmount)} ETH to shipper and ${ethers.formatEther(args.carrierAmount)} ETH to carrier`,
};

function History() {
  const { account, isConnected } = useWallet();
  const { getReadContract, isConfigured, refreshKey } = useContract();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!account || !isConnected || !isConfigured) {
      setEvents([]);
      return undefined;
    }

    async function loadHistory() {
      try {
        setLoading(true);
        setError('');
        const contract = await getReadContract();
        const ids = await contract.getUserAgreementIds(account);
        const names = Object.keys(eventDetails);
        const logs = (
          await Promise.all(
            ids.flatMap((id) =>
              names.map((name) => contract.queryFilter(contract.filters[name](id), 0, 'latest')),
            ),
          )
        ).flat();

        const uniqueBlocks = [...new Set(logs.map((log) => log.blockNumber))];
        const blockEntries = await Promise.all(
          uniqueBlocks.map(async (blockNumber) => [
            blockNumber,
            await contract.runner.getBlock(blockNumber),
          ]),
        );
        const blocks = new Map(blockEntries);
        const normalized = logs
          .map((log) => {
            const parsed = decodeEscrowEvent(contract.interface, log);
            if (!parsed || parsed.args?.agreementId === undefined || !eventDetails[parsed.name]) {
              return null;
            }
            return {
              key: `${log.transactionHash}-${log.index ?? log.logIndex ?? parsed.name}`,
              agreementId: Number(parsed.args.agreementId),
              name: parsed.name,
              detail: eventDetails[parsed.name](parsed.args),
              transactionHash: log.transactionHash,
              timestamp: Number(blocks.get(log.blockNumber)?.timestamp || 0),
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.timestamp - a.timestamp);
        if (!cancelled) setEvents(normalized);
      } catch (historyError) {
        if (!cancelled) setError(friendlyContractError(historyError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [account, getReadContract, isConfigured, isConnected, refreshKey]);

  return (
    <div className="panel">
      <div className="section-heading">
        <div><h2>On-chain Activity</h2><p>Chronological events for every agreement linked to this wallet.</p></div>
        <span className="badge">{events.length} events</span>
      </div>
      {error && <div className="notice error">{error}</div>}
      {loading ? <p>Reading blockchain event logs…</p> : events.length ? (
        <div className="activity-list">
          {events.map((event) => (
            <article className="activity-item" key={event.key}>
              <div className="activity-icon" />
              <div>
                <div className="section-heading">
                  <strong>{event.name.replace(/([A-Z])/g, ' $1').trim()}</strong>
                  <time>{new Date(event.timestamp * 1000).toLocaleString()}</time>
                </div>
                <p>{event.detail}</p>
                <Link to={`/agreement/${event.agreementId}`}>Agreement #{event.agreementId}</Link>
                <code className="tx-hash" title={event.transactionHash}>{event.transactionHash}</code>
              </div>
            </article>
          ))}
        </div>
      ) : <p>{isConnected ? 'No on-chain agreement activity found.' : 'Connect your wallet to view history.'}</p>}
    </div>
  );
}

export default History;
