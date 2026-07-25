import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useParams } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { MILESTONE_STATUS } from '../contracts/abi';
import { normalizeAgreement } from '../hooks/useAgreements';

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const formatDate = (timestamp) => new Date(timestamp * 1000).toLocaleString();

function AgreementDetail() {
  const { id } = useParams();
  const { account } = useWallet();
  const { getReadContract, getWriteContract, isConfigured, refreshKey, waitForTransaction } =
    useContract();
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [canRefund, setCanRefund] = useState(false);
  const [proofText, setProofText] = useState('');
  const [proofURI, setProofURI] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [resolutionEth, setResolutionEth] = useState('');
  const [arbitrator, setArbitrator] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nowSeconds, setNowSeconds] = useState(0);

  const load = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const contract = await getReadContract();
      const [rawAgreement, rawMilestones, refundable, arbitratorAddress] = await Promise.all([
        contract.getAgreement(id),
        contract.getMilestones(id),
        contract.canRefund(id),
        contract.arbitrator(),
      ]);
      setAgreement(normalizeAgreement(id, rawAgreement));
      setMilestones(
        rawMilestones.map((milestone, index) => ({
          index,
          name: milestone.name,
          details: milestone.details,
          payout: milestone.payout,
          payoutEth: ethers.formatEther(milestone.payout),
          dueAt: Number(milestone.dueAt),
          proofHash: milestone.proofHash,
          proofURI: milestone.proofURI,
          submittedAt: Number(milestone.submittedAt),
          approvedAt: Number(milestone.approvedAt),
          state: Number(milestone.state),
          statusLabel: MILESTONE_STATUS[Number(milestone.state)],
        })),
      );
      setCanRefund(refundable);
      setArbitrator(arbitratorAddress);
    } catch (loadError) {
      setError(friendlyContractError(loadError));
    } finally {
      setLoading(false);
    }
  }, [getReadContract, id, isConfigured]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const updateTime = () => setNowSeconds(Math.floor(Date.now() / 1000));
    updateTime();
    const timer = window.setInterval(updateTime, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const transact = async (action, callback) => {
    try {
      setBusyAction(action);
      setError('');
      const contract = await getWriteContract();
      const transaction = await callback(contract);
      await waitForTransaction(transaction);
      setProofText('');
      setProofURI('');
      setDisputeReason('');
      setResolutionEth('');
    } catch (actionError) {
      setError(friendlyContractError(actionError));
    } finally {
      setBusyAction('');
    }
  };

  if (!isConfigured) return <div className="notice error">Deploy the escrow contract first.</div>;
  if (loading) return <div className="panel">Loading agreement from the blockchain…</div>;
  if (!agreement) return <div className="notice error">{error || 'Agreement not found.'}</div>;

  const normalizedAccount = account?.toLowerCase();
  const isShipper = normalizedAccount === agreement.shipper.toLowerCase();
  const isCarrier = normalizedAccount === agreement.carrier.toLowerCase();
  const isArbitrator = normalizedAccount === arbitrator.toLowerCase();
  const currentMilestone = milestones[agreement.nextMilestone];

  return (
    <section className="detail-layout">
      <div className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Agreement #{id}</span>
            <h2>{agreement.title}</h2>
          </div>
          <span className={`badge status-${agreement.statusLabel.toLowerCase()}`}>
            {agreement.statusLabel}
          </span>
        </div>
        <p>{agreement.notes || 'No additional shipment notes.'}</p>
        <div className="detail-grid">
          <div><small>Shipper</small><strong title={agreement.shipper}>{shortAddress(agreement.shipper)}</strong></div>
          <div><small>Carrier</small><strong title={agreement.carrier}>{shortAddress(agreement.carrier)}</strong></div>
          <div><small>Total funded</small><strong>{agreement.totalEth} ETH</strong></div>
          <div><small>Escrow remaining</small><strong>{agreement.remainingEth} ETH</strong></div>
          <div><small>Created</small><strong>{formatDate(agreement.createdAt)}</strong></div>
          <div><small>Final deadline</small><strong>{formatDate(agreement.deadline)}</strong></div>
        </div>
        {error && <div className="notice error">{error}</div>}

        {agreement.status === 0 && (isShipper || isCarrier) && (
          <div className="action-panel">
            <h3>Agreement actions</h3>
            {canRefund && (
              <button
                className="btn btn-danger"
                disabled={Boolean(busyAction)}
                onClick={() => transact('refund', (contract) => contract.claimRefundAfterDeadline(id))}
              >
                {busyAction === 'refund' ? 'Refunding…' : 'Claim deadline refund'}
              </button>
            )}
            <div className="inline-form">
              <input
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value)}
                placeholder="Reason for dispute"
              />
              <button
                className="btn btn-secondary"
                disabled={Boolean(busyAction) || !disputeReason}
                onClick={() => transact('dispute', (contract) => contract.openDispute(id, disputeReason))}
              >
                Open dispute
              </button>
            </div>
          </div>
        )}

        {agreement.status === 3 && isArbitrator && (
          <div className="action-panel">
            <h3>Arbitrator resolution</h3>
            <p>Enter the portion of the remaining {agreement.remainingEth} ETH to return to the shipper. The carrier receives the rest.</p>
            <div className="inline-form">
              <input type="number" min="0" step="any" value={resolutionEth} onChange={(event) => setResolutionEth(event.target.value)} placeholder="Shipper share (ETH)" />
              <button className="btn btn-primary" disabled={Boolean(busyAction) || resolutionEth === ''} onClick={() => transact('resolve', (contract) => contract.resolveDispute(id, ethers.parseEther(resolutionEth)))}>
                Resolve dispute
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-heading">
          <h3>Milestones</h3>
          <span>{agreement.nextMilestone}/{milestones.length} paid</span>
        </div>
        <div className="progress-track">
          <span style={{ width: `${(agreement.nextMilestone / milestones.length) * 100}%` }} />
        </div>
        <div className="timeline">
          {milestones.map((milestone) => {
            const isCurrent = milestone.index === agreement.nextMilestone && agreement.status === 0;
            const milestoneExpired = nowSeconds > milestone.dueAt;
            const agreementExpired = nowSeconds > agreement.deadline;
            const percentage = Number((milestone.payout * 10000n) / agreement.totalAmount) / 100;
            return (
              <article className={`milestone-row state-${milestone.state}`} key={milestone.index}>
                <div className="timeline-dot">{milestone.index + 1}</div>
                <div className="milestone-content">
                  <div className="section-heading">
                    <div><strong>{milestone.name}</strong><p>{milestone.details}</p></div>
                    <span className="badge">{milestone.statusLabel}</span>
                  </div>
                  <div className="milestone-meta">
                    <span>{milestone.payoutEth} ETH ({percentage}%)</span>
                    <span>Due {formatDate(milestone.dueAt)}</span>
                  </div>
                  {milestone.proofHash !== ethers.ZeroHash && (
                    <div className="proof-box">
                      <small>Immutable evidence hash</small>
                      <code>{milestone.proofHash}</code>
                      {milestone.proofURI && <a href={milestone.proofURI} target="_blank" rel="noreferrer">{milestone.proofURI}</a>}
                      <span>Submitted {formatDate(milestone.submittedAt)}</span>
                    </div>
                  )}
                  {isCurrent && isCarrier && milestone.state === 0 && !milestoneExpired && !agreementExpired && (
                    <div className="evidence-form">
                      <input value={proofText} onChange={(event) => setProofText(event.target.value)} placeholder="Evidence content or document fingerprint" />
                      <input value={proofURI} onChange={(event) => setProofURI(event.target.value)} placeholder="Evidence URI (e.g. ipfs://…)" />
                      <button
                        className="btn btn-primary"
                        disabled={Boolean(busyAction) || !proofText}
                        onClick={() => transact('proof', (contract) =>
                          contract.submitMilestoneProof(id, milestone.index, ethers.keccak256(ethers.toUtf8Bytes(proofText)), proofURI))}
                      >
                        Submit cryptographic proof
                      </button>
                    </div>
                  )}
                  {isCurrent && isCarrier && milestone.state === 0 && (milestoneExpired || agreementExpired) && (
                    <div className="notice error">The proof deadline has passed. Evidence can no longer be submitted.</div>
                  )}
                  {isCurrent && isShipper && milestone.state === 1 && !agreementExpired && (
                    <button
                      className="btn btn-primary"
                      disabled={Boolean(busyAction)}
                      onClick={() => transact('approve', (contract) => contract.approveMilestone(id, milestone.index))}
                    >
                      {busyAction === 'approve' ? 'Releasing payment…' : `Verify & release ${milestone.payoutEth} ETH`}
                    </button>
                  )}
                  {isCurrent && isShipper && milestone.state === 1 && agreementExpired && (
                    <div className="notice error">The final deadline has passed. Use the deadline refund or dispute action.</div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {currentMilestone && agreement.status === 0 && !isShipper && !isCarrier && (
          <p className="notice">This agreement is read-only for the connected wallet.</p>
        )}
      </div>
    </section>
  );
}

export default AgreementDetail;
