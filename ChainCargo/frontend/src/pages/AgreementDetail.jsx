import { useCallback, useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { useParams } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { MILESTONE_STATUS } from '../contracts/abi';
import { normalizeAgreement } from '../hooks/useAgreements';
import { useCarrierReputation } from '../hooks/useCarrierReputation';
import {
  EVIDENCE_FILE_ACCEPT,
  getEvidenceGatewayUrl,
  normalizeGatewayBaseUrl,
  uploadEvidenceToPinata,
  validateEvidenceFileMetadata,
  verifyEvidenceFromGateway,
} from '../utils/pinataEvidence';
import { getDeadlineState, isRefundButtonAvailable } from '../utils/deadlineAlerts';
import {
  decodeEscrowEvent,
  loadContractLogsInChunks,
  selectHistoryStartBlock,
} from '../utils/historyEvents';

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const formatDate = (timestamp) => new Date(timestamp * 1000).toLocaleString();

function AgreementDetail() {
  const { id } = useParams();
  const { account } = useWallet();
  const { address, deployment, getReadContract, getWriteContract, isConfigured, refreshKey, waitForTransaction } =
    useContract();
  const evidenceFileInputRef = useRef(null);
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [canRefund, setCanRefund] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(normalizeGatewayBaseUrl(''));
  const [pinataConfigured, setPinataConfigured] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [verification, setVerification] = useState(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [resolutionEth, setResolutionEth] = useState('');
  const [arbitrator, setArbitrator] = useState('');
  const [disputeInfo, setDisputeInfo] = useState(null);
  const [disputeLookupError, setDisputeLookupError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nowSeconds, setNowSeconds] = useState(0);
  const carrierReputation = useCarrierReputation(agreement?.carrier || null);

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
      setDisputeInfo(null);
      setDisputeLookupError('');
      if (Number(rawAgreement.status) === 3) {
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
          const filter = contract.filters.DisputeOpened(id);
          const logs = await loadContractLogsInChunks({
            provider,
            address,
            fromBlock,
            toBlock: latestBlock,
            topics: await filter.getTopicFilter(),
          });
          const opened = logs
            .map((log) => decodeEscrowEvent(contract.interface, log))
            .filter((event) => event?.name === 'DisputeOpened')
            .at(-1);
          if (opened) {
            setDisputeInfo({
              openedBy: opened.args.openedBy,
              reason: opened.args.reason,
            });
          } else {
            setDisputeLookupError('The DisputeOpened event was not found for this agreement.');
          }
        } catch {
          setDisputeLookupError(
            'The dispute event could not be loaded from the configured RPC. No reason will be assumed.',
          );
        }
      }
    } catch (loadError) {
      setError(friendlyContractError(loadError));
    } finally {
      setLoading(false);
    }
  }, [address, deployment, getReadContract, id, isConfigured]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const updateTime = () => setNowSeconds(Math.floor(Date.now() / 1000));
    updateTime();
    const timer = window.setInterval(updateTime, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isConfigured || agreement?.status !== 0) return undefined;
    let cancelled = false;
    const refreshRefundEligibility = async () => {
      try {
        const contract = await getReadContract();
        const refundable = await contract.canRefund(id);
        if (!cancelled) setCanRefund(refundable);
      } catch {
        // The main load path reports RPC errors; keep the last confirmed chain value here.
      }
    };
    const timer = window.setInterval(refreshRefundEligibility, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agreement?.status, getReadContract, id, isConfigured]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pinata/config')
      .then((response) => response.ok ? response.json() : null)
      .then((config) => {
        if (!cancelled) {
          setPinataConfigured(Boolean(config?.configured));
          if (config?.gatewayBaseUrl) {
            setGatewayBaseUrl(normalizeGatewayBaseUrl(config.gatewayBaseUrl));
          }
        }
      })
      .catch(() => {
        // Public gateway fallback remains available for previously uploaded IPFS evidence.
        if (!cancelled) setPinataConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setVerification(null);
    setUploadStatus('');
  }, [account, id, refreshKey]);

  const transact = async (action, callback) => {
    try {
      setBusyAction(action);
      setError('');
      const contract = await getWriteContract();
      const transaction = await callback(contract);
      await waitForTransaction(transaction);
      setVerification(null);
      setDisputeReason('');
      setResolutionEth('');
    } catch (actionError) {
      setError(friendlyContractError(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const selectEvidenceFile = (file) => {
    try {
      if (file) validateEvidenceFileMetadata(file);
      setEvidenceFile(file || null);
      setUploadStatus('');
      setError('');
    } catch (fileError) {
      setEvidenceFile(null);
      if (evidenceFileInputRef.current) evidenceFileInputRef.current.value = '';
      setError(fileError.message);
    }
  };

  const submitEvidence = async (milestone) => {
    if (!evidenceFile || !pinataConfigured) return;
    try {
      setBusyAction('proof');
      setError('');
      setUploadStatus('Confirm the evidence-upload authorization in MetaMask…');
      const contract = await getWriteContract();
      const upload = await uploadEvidenceToPinata({
        account,
        agreementId: id,
        contractAddress: address,
        file: evidenceFile,
        milestoneIndex: milestone.index,
        signMessage: (message) => contract.runner.signMessage(message),
      });
      setUploadStatus('Uploaded to IPFS. Confirm the on-chain evidence transaction in MetaMask…');
      const transaction = await contract.submitMilestoneProof(
        id,
        milestone.index,
        upload.proofHash,
        upload.proofURI,
      );
      await waitForTransaction(transaction);
      setEvidenceFile(null);
      setUploadStatus('');
      if (evidenceFileInputRef.current) evidenceFileInputRef.current.value = '';
    } catch (uploadError) {
      setUploadStatus('');
      setError(friendlyContractError(uploadError));
    } finally {
      setBusyAction('');
    }
  };

  const verifyEvidence = async (milestone) => {
    try {
      setBusyAction('verify');
      setVerification({ milestoneIndex: milestone.index, status: 'checking' });
      const gatewayUrl = getEvidenceGatewayUrl(milestone.proofURI, gatewayBaseUrl);
      const result = await verifyEvidenceFromGateway({
        expectedHash: milestone.proofHash,
        gatewayUrl,
      });
      setVerification({
        milestoneIndex: milestone.index,
        status: result.matches ? 'verified' : 'failed',
      });
    } catch (verificationError) {
      setVerification({
        message: verificationError.message,
        milestoneIndex: milestone.index,
        status: 'failed',
      });
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
  const currentMilestonePending = agreement.status === 0 && currentMilestone?.state === 0;
  const activeDeadline = currentMilestonePending ? currentMilestone.dueAt : agreement.deadline;
  const deadlineState = getDeadlineState(activeDeadline, nowSeconds, agreement.status === 0);
  const refundAvailable = isRefundButtonAvailable(canRefund);
  const browserShowsMissedDeadline = currentMilestonePending && nowSeconds > currentMilestone.dueAt;
  let nextStep = {
    title: 'This agreement is closed',
    detail: `Final status: ${agreement.statusLabel}. Review the immutable milestones and transaction history.`,
  };
  if (agreement.status === 0 && refundAvailable) {
    nextStep = {
      title: 'A deadline refund is available',
      detail: 'The current required checkpoint or final deadline has passed. Claiming returns all remaining escrow to the Shipper.',
    };
  } else if (agreement.status === 0 && currentMilestone?.state === 0) {
    nextStep = isCarrier
      ? {
          title: `Submit evidence for milestone ${currentMilestone.index + 1}`,
          detail: 'Upload the receipt or photo to IPFS and confirm its immutable hash on-chain before the due date.',
        }
      : {
          title: `Waiting for Carrier evidence on milestone ${currentMilestone.index + 1}`,
          detail: 'Switch to the assigned Carrier wallet to submit proof. No ETH is released until the Shipper approves it.',
        };
  } else if (agreement.status === 0 && currentMilestone?.state === 1) {
    nextStep = isShipper
      ? {
          title: `Verify milestone ${currentMilestone.index + 1} and release payment`,
          detail: 'Open the uploaded evidence, verify its file hash, then confirm the exact milestone payout in MetaMask.',
        }
      : {
          title: 'Evidence submitted — awaiting Shipper approval',
          detail: 'The proof is immutable. Switch to the Shipper wallet to review it and release the payout.',
        };
  } else if (agreement.status === 3) {
    nextStep = isArbitrator
      ? {
          title: 'Resolve the disputed remaining escrow',
          detail: 'Choose the Shipper share below. The Carrier automatically receives the balance.',
        }
      : {
          title: 'Dispute awaiting arbitrator resolution',
          detail: 'Milestone actions are paused until the deployment arbitrator divides the remaining escrow.',
        };
  }

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
          <div>
            <small>Carrier reputation</small>
            <strong>
              {carrierReputation.loading
                ? 'Loading…'
                : carrierReputation.supported
                  ? `${carrierReputation.pointsLabel} points · ${carrierReputation.tier}`
                  : 'Redeploy required'}
            </strong>
          </div>
          <div><small>Total funded</small><strong>{agreement.totalEth} ETH</strong></div>
          <div><small>Escrow remaining</small><strong>{agreement.remainingEth} ETH</strong></div>
          <div><small>Created</small><strong>{formatDate(agreement.createdAt)}</strong></div>
          <div><small>Final deadline</small><strong>{formatDate(agreement.deadline)}</strong></div>
        </div>
        {agreement.status === 0 && (
          <div className={`deadline-indicator deadline-${deadlineState.level}`} aria-live="polite">
            <span className="eyebrow">
              {currentMilestonePending ? 'Current milestone deadline' : 'Final delivery deadline'}
            </span>
            <strong>{deadlineState.countdown}</strong>
            {refundAvailable && (
              <span>The pending milestone was missed. Remaining escrow can now be refunded to the Shipper.</span>
            )}
            {!refundAvailable && browserShowsMissedDeadline && (
              <span>Waiting for the blockchain timestamp to confirm refund eligibility.</span>
            )}
          </div>
        )}
        <div className="notice next-step-notice">
          <span className="eyebrow">Current workflow state</span>
          <strong>{nextStep.title}</strong>
          <p>{nextStep.detail}</p>
        </div>
        {error && <div className="notice error">{error}</div>}

        {agreement.status === 0 && (isShipper || isCarrier) && (
          <div className="action-panel">
            <h3>Agreement actions</h3>
            {refundAvailable && (
              <button
                className="btn btn-danger"
                disabled={Boolean(busyAction)}
                onClick={() => transact('refund', (contract) => contract.claimRefundAfterDeadline(id))}
              >
                {busyAction === 'refund' ? 'Refunding…' : 'Claim deadline refund'}
              </button>
            )}
            {!refundAvailable && <div className="inline-form">
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
            </div>}
          </div>
        )}

        {agreement.status === 3 && isArbitrator && (
          <div className="action-panel">
            <h3>Arbitrator resolution</h3>
            <div className="detail-grid">
              <div>
                <small>Opened by</small>
                <strong title={disputeInfo?.openedBy || ''}>
                  {disputeInfo?.openedBy ? shortAddress(disputeInfo.openedBy) : 'Unavailable'}
                </strong>
              </div>
              <div><small>Remaining escrow</small><strong>{agreement.remainingEth} ETH</strong></div>
              <div>
                <small>Current milestone</small>
                <strong>{currentMilestone ? `${currentMilestone.index + 1}. ${currentMilestone.name}` : 'Unavailable'}</strong>
              </div>
              <div>
                <small>Evidence state</small>
                <strong>{currentMilestone?.statusLabel || 'Unavailable'}</strong>
              </div>
            </div>
            {disputeInfo ? (
              <div className="notice"><strong>Dispute reason</strong><p>{disputeInfo.reason}</p></div>
            ) : disputeLookupError ? (
              <div className="notice error">{disputeLookupError}</div>
            ) : (
              <div className="notice">Loading the dispute event…</div>
            )}
            {currentMilestone?.proofHash !== ethers.ZeroHash && (
              <div className="proof-box">
                <small>Current evidence hash</small>
                <code>{currentMilestone.proofHash}</code>
                <small>Evidence URI</small>
                <code>{currentMilestone.proofURI}</code>
              </div>
            )}
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
            const evidenceUrl = getEvidenceGatewayUrl(milestone.proofURI, gatewayBaseUrl);
            const verificationForMilestone = verification?.milestoneIndex === milestone.index
              ? verification
              : null;
            const evidenceVerified = verificationForMilestone?.status === 'verified';
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
                      {evidenceUrl ? (
                        <a href={evidenceUrl} target="_blank" rel="noreferrer">Open receipt or photo from IPFS</a>
                      ) : milestone.proofURI ? (
                        <>
                          <code>{milestone.proofURI}</code>
                          <span className="notice error">
                            This is not a valid ChainCargo IPFS CID. Legacy or external evidence cannot be fetched or verified automatically.
                          </span>
                        </>
                      ) : null}
                      <span>Submitted {formatDate(milestone.submittedAt)}</span>
                    </div>
                  )}
                  {isCurrent && isCarrier && milestone.state === 0 && !milestoneExpired && !agreementExpired && (
                    <div className="evidence-form">
                      {pinataConfigured === false && (
                        <div className="notice error">
                          Evidence upload is disabled because the Pinata server is not configured. Existing IPFS evidence remains viewable through the public gateway.
                        </div>
                      )}
                      <label>
                        Receipt, delivery photo, or supporting PDF
                        <input
                          accept={EVIDENCE_FILE_ACCEPT}
                          onChange={(event) => selectEvidenceFile(event.target.files?.[0])}
                          ref={evidenceFileInputRef}
                          type="file"
                          disabled={!pinataConfigured}
                        />
                      </label>
                      {evidenceFile && (
                        <small>
                          Selected: {evidenceFile.name} · {(evidenceFile.size / 1024).toFixed(1)} KB
                        </small>
                      )}
                      {uploadStatus && <div className="notice">{uploadStatus}</div>}
                      <button
                        className="btn btn-primary"
                        disabled={Boolean(busyAction) || !evidenceFile || !pinataConfigured}
                        onClick={() => submitEvidence(milestone)}
                      >
                        {busyAction === 'proof' ? 'Uploading evidence…' : 'Upload to IPFS & submit proof'}
                      </button>
                      <small>
                        The file is stored on Pinata IPFS. Only its CID and Keccak-256 hash are stored on-chain.
                      </small>
                    </div>
                  )}
                  {isCurrent && isCarrier && milestone.state === 0 && (milestoneExpired || agreementExpired) && (
                    <div className="notice error">The proof deadline has passed. Evidence can no longer be submitted.</div>
                  )}
                  {isCurrent && isShipper && milestone.state === 1 && (
                    <div className="evidence-form">
                      <strong>Review and verify evidence before payout</strong>
                      {evidenceUrl && (
                        <a className="btn btn-secondary" href={evidenceUrl} target="_blank" rel="noreferrer">
                          Open receipt or photo
                        </a>
                      )}
                      <button
                        className="btn btn-secondary"
                        disabled={Boolean(busyAction) || !evidenceUrl}
                        onClick={() => verifyEvidence(milestone)}
                      >
                        {verificationForMilestone?.status === 'checking'
                          ? 'Verifying downloaded file…'
                          : 'Verify file integrity'}
                      </button>
                      {verificationForMilestone?.status && verificationForMilestone.status !== 'checking' && (
                        <div className={`notice ${evidenceVerified ? 'success' : 'error'}`}>
                          {evidenceVerified
                            ? 'Cryptographic verification passed. The IPFS file matches the immutable on-chain hash.'
                            : verificationForMilestone.message || 'Verification failed. The downloaded file does not match the on-chain hash; do not release payment.'}
                        </div>
                      )}
                      <button
                        className="btn btn-primary"
                        disabled={Boolean(busyAction) || !evidenceVerified}
                        onClick={() => transact('approve', (contract) => contract.approveMilestone(id, milestone.index))}
                      >
                        {busyAction === 'approve' ? 'Releasing payment…' : `Release verified payout · ${milestone.payoutEth} ETH`}
                      </button>
                    </div>
                  )}
                  {isCurrent && isShipper && milestone.state === 1 && agreementExpired && (
                    <div className="notice">
                      This proof was submitted before its deadline. You may still approve it, or open a dispute if the evidence is not acceptable.
                    </div>
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
