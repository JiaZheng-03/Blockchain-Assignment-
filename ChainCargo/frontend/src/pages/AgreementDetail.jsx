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
  getEvidencePublicUrl,
  getEvidenceStorageLabel,
  uploadEvidenceToSupabase,
  validateEvidenceFileMetadata,
  verifyEvidenceFromStorage,
} from '../utils/evidenceStorage';
import {
  formatDeadlineDuration,
  getDeadlineState,
  isRefundButtonAvailable,
} from '../utils/deadlineAlerts';
import { showActionResult } from '../utils/actionResult';

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const formatDate = (timestamp) => new Date(timestamp * 1000).toLocaleString();

function AgreementDetail() {
  const { id } = useParams();
  const { account } = useWallet();
  const { address, getReadContract, getWriteContract, isConfigured, refreshKey, waitForTransaction } =
    useContract();
  const evidenceFileInputRef = useRef(null);
  const [agreement, setAgreement] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [canRefund, setCanRefund] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [storageConfigured, setStorageConfigured] = useState(null);
  const [storageConfigurationMessage, setStorageConfigurationMessage] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [verification, setVerification] = useState(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [resolutionEth, setResolutionEth] = useState('');
  const [extensionReason, setExtensionReason] = useState('');
  const [extensionRequest, setExtensionRequest] = useState(null);
  const [arbitrator, setArbitrator] = useState('');
  const [disputeInfo, setDisputeInfo] = useState(null);
  const [disputeLookupError, setDisputeLookupError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [evidenceDecision, setEvidenceDecision] = useState(null);
  const [agreementDecision, setAgreementDecision] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const rejectionReasonValid = rejectionReason.trim().length > 0
    && new TextEncoder().encode(rejectionReason.trim()).length <= 1000;
  const [disputeConfirmationOpen, setDisputeConfirmationOpen] = useState(false);
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
      const [rawAgreement, rawMilestones, refundable, arbitratorAddress, acceptanceDeadline] = await Promise.all([
        contract.getAgreement(id),
        contract.getMilestones(id),
        contract.canRefund(id),
        contract.arbitrator(),
        contract.carrierAcceptanceDeadline(id),
      ]);
      setAgreement({
        ...normalizeAgreement(id, rawAgreement),
        carrierAcceptanceDeadline: Number(acceptanceDeadline),
        rejectionReason: Number(rawAgreement.status) === 6
          ? await contract.agreementRejectionReason(id) : '',
      });
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
          paid: Boolean(milestone.paid),
          extensionRequestedAt: Number(milestone.extensionRequestedAt),
          extensionProposedDueAt: Number(milestone.extensionProposedDueAt),
          extensionCompensation: milestone.extensionCompensation,
          extensionRequested: Boolean(milestone.extensionRequested),
          extensionPending: Boolean(milestone.extensionPending),
          extensionApproved: Boolean(milestone.extensionApproved),
          statusLabel: Number(milestone.state) === 2 && milestone.paid
            ? 'Confirmed & paid'
            : MILESTONE_STATUS[Number(milestone.state)],
        })),
      );
      const nextMilestoneIndex = Number(rawAgreement.nextMilestone);
      if (nextMilestoneIndex < rawMilestones.length) {
        const request = await contract.getExtensionRequest(id, nextMilestoneIndex);
        setExtensionRequest({
          approved: Boolean(request.approved),
          compensation: request.compensation,
          pending: Boolean(request.pending),
          proposedDueAt: Number(request.proposedDueAt),
          reason: request.reason,
          requested: Boolean(request.requested),
          requestedAt: Number(request.requestedAt),
        });
      } else {
        setExtensionRequest(null);
      }
      setCanRefund(refundable);
      setArbitrator(arbitratorAddress);
      setDisputeInfo(null);
      setDisputeLookupError('');
      if (Number(rawAgreement.status) === 3) {
        try {
          const dispute = await contract.getDisputeRequest(id);
          if (dispute.active) {
            setDisputeInfo({
              milestoneIndex: Number(dispute.milestoneIndex),
              openedAt: Number(dispute.openedAt),
              openedBy: dispute.openedBy,
              reason: dispute.reason,
              type: dispute.reviewTimeout ? 'review-timeout' : 'participant-dispute',
            });
          } else {
            setDisputeLookupError('No active dispute record was found for this agreement.');
          }
        } catch {
          setDisputeLookupError('The on-chain dispute details could not be loaded.');
        }
      }
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
    fetch('/api/storage/config')
      .then((response) => response.ok ? response.json() : null)
      .then((config) => {
        if (!cancelled) {
          const apiUsesCurrentContract = Boolean(
            address &&
            config?.contractAddress &&
            config.contractAddress.toLowerCase() === address.toLowerCase()
          );
          setStorageConfigured(Boolean(config?.configured && apiUsesCurrentContract));
          setStorageConfigurationMessage(
            !apiUsesCurrentContract
              ? 'The API is using a different contract deployment. Restart npm run dev after deploying.'
              : config?.message || 'The evidence storage API is unavailable.',
          );
        }
      })
      .catch(() => {
        // Existing public Supabase evidence remains directly viewable.
        if (!cancelled) {
          setStorageConfigured(false);
          setStorageConfigurationMessage('The evidence storage API is unavailable.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

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
      showActionResult('success', 'The blockchain action completed successfully.');
      setVerification(null);
      setDisputeReason('');
      setResolutionEth('');
      setExtensionReason('');
    } catch (actionError) {
      const message = friendlyContractError(actionError);
      setError(message);
      showActionResult('error', message);
    } finally {
      setBusyAction('');
    }
  };

  const confirmEvidenceDecision = () => {
    const decision = evidenceDecision;
    if (!decision) return;
    if (decision === 'reject' && !rejectionReasonValid) return;
    setEvidenceDecision(null);
    if (decision.type === 'confirm') {
      transact(
        'confirm',
        (contract) => contract.confirmMilestone(
          id,
          decision.milestone.index,
          decision.milestone.proofHash,
        ),
      );
      return;
    }
    transact(
      'reject',
      (contract) => contract.rejectEvidence(id, decision.milestone.index),
    );
  };

  const confirmAgreementDecision = () => {
    const decision = agreementDecision;
    if (!decision) return;
    setAgreementDecision(null);
    if (decision === 'accept') {
      transact('accept-agreement', (contract) => contract.acceptAgreement(id));
    } else if (decision === 'reject') {
      transact('reject-agreement', (contract) => contract.rejectAgreement(id, rejectionReason.trim()));
    } else {
      transact('cancel-unaccepted', (contract) => contract.cancelUnacceptedAgreement(id));
    }
  };

  const confirmDisputeRequest = () => {
    if (!disputeReason.trim()) return;
    const reason = disputeReason.trim();
    setDisputeConfirmationOpen(false);
    transact('dispute', (contract) => contract.requestDispute(id, reason));
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
    if (!evidenceFile || !storageConfigured) return;
    try {
      setBusyAction('proof');
      setError('');
      setUploadStatus('Confirm the evidence-upload authorization in MetaMask…');
      const contract = await getWriteContract();
      const upload = await uploadEvidenceToSupabase({
        account,
        agreementId: id,
        contractAddress: address,
        file: evidenceFile,
        milestoneIndex: milestone.index,
        signMessage: (message) => contract.runner.signMessage(message),
      });
      setUploadStatus('Uploaded to Supabase. Confirm the on-chain evidence transaction in MetaMask…');
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
      showActionResult('success', 'The photo or document was uploaded and its proof was submitted successfully.');
    } catch (uploadError) {
      setUploadStatus('');
      const message = friendlyContractError(uploadError);
      setError(message);
      showActionResult('error', message);
    } finally {
      setBusyAction('');
    }
  };

  const verifyEvidence = async (milestone) => {
    try {
      setBusyAction('verify');
      setVerification({ milestoneIndex: milestone.index, status: 'checking' });
      const evidenceUrl = getEvidencePublicUrl(milestone.proofURI);
      const result = await verifyEvidenceFromStorage({
        expectedHash: milestone.proofHash,
        evidenceUrl,
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
  const nextMilestone = milestones[agreement.nextMilestone + 1];
  const currentMilestonePending = agreement.status === 0 && currentMilestone?.state === 0;
  const activeDeadline = currentMilestonePending ? currentMilestone.dueAt : agreement.deadline;
  const deadlineState = getDeadlineState(activeDeadline, nowSeconds, agreement.status === 0);
  const refundAvailable = isRefundButtonAvailable(canRefund);
  const browserShowsMissedDeadline = currentMilestonePending && nowSeconds > currentMilestone.dueAt;
  const extensionWindowOpen = currentMilestonePending
    && nowSeconds >= currentMilestone.dueAt - (24 * 60 * 60)
    && nowSeconds < currentMilestone.dueAt;
  const extensionBoundary = nextMilestone?.dueAt || agreement.deadline;
  const proposedExtensionDeadline = currentMilestone?.dueAt + (24 * 60 * 60);
  const extensionFitsSchedule = proposedExtensionDeadline < extensionBoundary;
  const awaitingCarrierAcceptance = agreement.status === 5;
  const acceptanceExpired = awaitingCarrierAcceptance
    && nowSeconds > agreement.carrierAcceptanceDeadline;
  const isFinalEvidenceConfirmation = evidenceDecision?.type === 'confirm'
    && evidenceDecision.milestone.index === milestones.length - 1;
  let nextStep = {
    title: 'This agreement is closed',
    detail: `Final status: ${agreement.statusLabel}. Review the immutable milestones and transaction history.`,
  };
  if (awaitingCarrierAcceptance) {
    nextStep = isCarrier
      ? {
          title: acceptanceExpired ? 'The acceptance period has expired' : 'Accept or reject this agreement',
          detail: acceptanceExpired
            ? 'The Shipper can now cancel this unaccepted agreement and recover the full escrow.'
            : 'Review the funded terms. Accept to begin the milestone workflow, or reject to return the full escrow to the Shipper.',
        }
      : {
          title: acceptanceExpired ? 'Cancel this unaccepted agreement' : 'Waiting for Carrier acceptance',
          detail: acceptanceExpired
            ? 'The Carrier did not accept in time. The Shipper can recover the full escrow.'
            : 'The escrow is locked, but milestone work cannot begin until the assigned Carrier accepts.',
        };
  } else if (agreement.status === 0 && refundAvailable) {
    nextStep = {
      title: 'A deadline refund is available',
      detail: 'The Carrier missed the current evidence deadline. Only the original Shipper can refund all remaining escrow.',
    };
  } else if (agreement.status === 0 && currentMilestone?.state === 0) {
    nextStep = isCarrier
      ? {
          title: `Submit evidence for milestone ${currentMilestone.index + 1}`,
          detail: 'Upload the receipt or photo to Supabase and confirm its immutable hash on-chain before the due date.',
        }
      : {
          title: `Waiting for Carrier evidence on milestone ${currentMilestone.index + 1}`,
          detail: 'Switch to the assigned Carrier wallet to submit proof. No ETH is released until the fixed Shipper confirms it.',
        };
  } else if (agreement.status === 0 && currentMilestone?.state === 1) {
    nextStep = isShipper
      ? {
          title: `Verify and confirm milestone ${currentMilestone.index + 1}`,
          detail: 'Open the uploaded evidence, verify its file hash, then confirm the exact milestone payout in MetaMask.',
        }
      : {
          title: 'Evidence submitted — awaiting Shipper confirmation',
          detail: 'The proof is immutable. If the Shipper takes no action for 1 hour, the Carrier may escalate it to the Arbitrator.',
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
            {agreement.rejectionReason && (
              <div className="alert error" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                <strong>Carrier rejection reason: </strong>{agreement.rejectionReason}
              </div>
            )}
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
          {awaitingCarrierAcceptance && (
            <div><small>Carrier response deadline</small><strong>{formatDate(agreement.carrierAcceptanceDeadline)}</strong></div>
          )}
          <div><small>Final deadline</small><strong>{formatDate(agreement.deadline)}</strong></div>
        </div>
        {agreement.status === 3 && (
          <div className="dispute-status-banner" role="status">
            <span className="dispute-status-mark" aria-hidden="true">!</span>
            <div>
              <strong>Dispute requested</strong>
              <p>The disputed milestone is paused while the Carrier may continue preparing later evidence.</p>
            </div>
          </div>
        )}
        {agreement.status === 3 && !isArbitrator && disputeInfo && (
          <div className="dispute-participant-details">
            <div>
              <small>Requested by</small>
              <strong title={disputeInfo.openedBy}>{shortAddress(disputeInfo.openedBy)}</strong>
            </div>
            <div>
              <small>Milestone</small>
              <strong>{disputeInfo.milestoneIndex + 1}</strong>
            </div>
            <div className="dispute-reason-row">
              <small>Details for Arbitrator</small>
              <p>{disputeInfo.reason}</p>
            </div>
          </div>
        )}
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

        {awaitingCarrierAcceptance && (
          <div className="action-panel">
            <h3>Carrier acceptance</h3>
            {isCarrier && !acceptanceExpired && (
              <>
                <div className="notice">
                  Accepting activates the milestone workflow. Rejecting permanently closes this agreement and refunds the full escrow to the Shipper.
                </div>
                <div className="wizard-actions">
                  <button
                    className="btn btn-danger"
                    disabled={Boolean(busyAction)}
                    onClick={() => setAgreementDecision('reject')}
                    type="button"
                  >
                    {busyAction === 'reject-agreement' ? 'Rejecting…' : 'Reject agreement'}
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={Boolean(busyAction)}
                    onClick={() => setAgreementDecision('accept')}
                    type="button"
                  >
                    {busyAction === 'accept-agreement' ? 'Accepting…' : 'Accept and proceed'}
                  </button>
                </div>
              </>
            )}
            {isShipper && !acceptanceExpired && (
              <div className="notice">
                Waiting for the assigned Carrier. The full escrow remains locked until acceptance, rejection, or the response deadline.
              </div>
            )}
            {isShipper && acceptanceExpired && (
              <button
                className="btn btn-danger"
                disabled={Boolean(busyAction)}
                onClick={() => setAgreementDecision('cancel')}
                type="button"
              >
                {busyAction === 'cancel-unaccepted' ? 'Cancelling & refunding…' : `Cancel & refund ${agreement.remainingEth} ETH`}
              </button>
            )}
          </div>
        )}

        {agreement.status === 0 && isShipper && refundAvailable && (
          <div className="action-panel">
            <h3>Deadline refund</h3>
            <div className="notice">
              The current milestone deadline passed without evidence. Only the original Shipper can refund the remaining escrow.
            </div>
            <button
              className="btn btn-danger"
              disabled={Boolean(busyAction)}
              onClick={() => transact('refund', (contract) => contract.claimRefundAfterDeadline(id))}
            >
              {busyAction === 'refund' ? 'Refunding…' : 'Refund remaining escrow'}
            </button>
          </div>
        )}

        {agreement.status === 0 && (isShipper || isCarrier) && (
          <div className="action-panel dispute-request-panel">
            <div className="dispute-request-heading">
              <span className="dispute-status-mark" aria-hidden="true">!</span>
              <div>
                <h3>Request Arbitrator action</h3>
                <p>Explain the issue clearly. Submitting this request pauses the agreement workflow.</p>
              </div>
            </div>
            <label>
              Dispute details
              <textarea
                maxLength="1000"
                placeholder="Describe what happened and what outcome you are requesting"
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value)}
              />
            </label>
            <div className="dispute-request-actions">
              <button
                className="btn btn-danger"
                disabled={Boolean(busyAction) || !disputeReason.trim()}
                onClick={() => setDisputeConfirmationOpen(true)}
                type="button"
              >
                {busyAction === 'dispute' ? 'Submitting dispute…' : 'Request dispute'}
              </button>
            </div>
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
            <h4>Continue the agreement</h4>
            <p>All remaining deadlines will be extended by the exact time this dispute was open.</p>
            <div className="wizard-actions">
              <button
                className="btn btn-secondary"
                disabled={Boolean(busyAction)}
                onClick={() => transact('continue-revision', (contract) => contract.resolveDisputeAndContinue(id, false))}
                type="button"
              >
                Request new evidence
              </button>
              <button
                className="btn btn-primary"
                disabled={Boolean(busyAction) || currentMilestone?.proofHash === ethers.ZeroHash}
                onClick={() => transact('continue-payment', (contract) => contract.resolveDisputeAndContinue(id, true))}
                type="button"
              >
                Approve evidence & pay
              </button>
            </div>
            <h4>End the agreement</h4>
            <p>Enter the remaining amount to return to the Shipper. The Carrier receives the balance and the agreement closes.</p>
            <div className="inline-form">
              <input type="number" min="0" max={agreement.remainingEth} step="any" value={resolutionEth} onChange={(event) => setResolutionEth(event.target.value)} placeholder="Shipper share (ETH)" />
              <button className="btn btn-danger" disabled={Boolean(busyAction) || resolutionEth === ''} onClick={() => transact('resolve', (contract) => contract.resolveDispute(id, ethers.parseEther(resolutionEth)))}>
                Cancel & split escrow
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
            const disputePausedSeconds = agreement.status === 3 && disputeInfo?.openedAt
              ? Math.max(0, nowSeconds - disputeInfo.openedAt)
              : 0;
            const canSubmitEvidence = (agreement.status === 0
              || (agreement.status === 3 && milestone.index > agreement.nextMilestone))
              && milestone.state === 0
              && nowSeconds <= milestone.dueAt + disputePausedSeconds
              && nowSeconds <= agreement.deadline + disputePausedSeconds;
            const milestoneExpired = nowSeconds > milestone.dueAt + disputePausedSeconds;
            const agreementExpired = nowSeconds > agreement.deadline + disputePausedSeconds;
            const evidenceUrl = getEvidencePublicUrl(milestone.proofURI);
            const evidenceStorageLabel = getEvidenceStorageLabel(milestone.proofURI);
            const verificationForMilestone = verification?.milestoneIndex === milestone.index
              ? verification
              : null;
            const evidenceVerified = verificationForMilestone?.status === 'verified';
            const reviewDeadline = milestone.submittedAt + (60 * 60);
            const reviewSecondsRemaining = reviewDeadline - nowSeconds;
            const reviewExpired = milestone.state === 1 && reviewSecondsRemaining <= 0;
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
                  {milestone.extensionApproved && (
                    <div className="notice">
                      24-hour extension approved · 5% compensation: {ethers.formatEther(milestone.extensionCompensation)} ETH to Shipper · Carrier receives {ethers.formatEther(milestone.payout - milestone.extensionCompensation)} ETH after confirmation.
                    </div>
                  )}
                  {isCurrent && currentMilestonePending && extensionRequest?.pending && (
                    <div className="evidence-form">
                      <strong>24-hour extension requested</strong>
                      <div className="detail-grid single">
                        <div><small>Reason</small><strong>{extensionRequest.reason}</strong></div>
                        <div><small>Proposed deadline</small><strong>{formatDate(extensionRequest.proposedDueAt)}</strong></div>
                      </div>
                      <div className="notice warning">
                        Approval extends only this milestone by 24 hours and returns 5% of its payout to the Shipper when the milestone is confirmed. Final Delivery Deadline does not change.
                      </div>
                      {isShipper && !browserShowsMissedDeadline && (
                        <div className="wizard-actions">
                          <button className="btn btn-danger" disabled={Boolean(busyAction)} onClick={() => transact('reject-extension', (contract) => contract.rejectDeadlineExtension(id, milestone.index))} type="button">
                            {busyAction === 'reject-extension' ? 'Rejecting…' : 'Reject request'}
                          </button>
                          <button className="btn btn-primary" disabled={Boolean(busyAction)} onClick={() => transact('approve-extension', (contract) => contract.approveDeadlineExtension(id, milestone.index))} type="button">
                            {busyAction === 'approve-extension' ? 'Approving…' : 'Approve with 5% compensation'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isCurrent && isCarrier && extensionWindowOpen && !extensionRequest?.requested && extensionFitsSchedule && (
                    <div className="evidence-form">
                      <strong>Request one 24-hour extension</strong>
                      <p>Available only during the final 24 hours before this milestone deadline. New deadline: {formatDate(proposedExtensionDeadline)}.</p>
                      <label>
                        Extension reason
                        <textarea value={extensionReason} onChange={(event) => setExtensionReason(event.target.value)} maxLength="1000" placeholder="Explain why another 24 hours are needed" />
                      </label>
                      <button className="btn btn-secondary" disabled={Boolean(busyAction) || !extensionReason.trim()} onClick={() => transact('request-extension', (contract) => contract.requestDeadlineExtension(id, milestone.index, extensionReason.trim()))} type="button">
                        {busyAction === 'request-extension' ? 'Requesting…' : 'Request 24-hour extension'}
                      </button>
                    </div>
                  )}
                  {isCurrent && isCarrier && extensionWindowOpen && !extensionRequest?.requested && !extensionFitsSchedule && (
                    <div className="notice error">A 24-hour extension would reach or pass the next milestone or Final Delivery Deadline, so it is unavailable.</div>
                  )}
                  {milestone.proofHash !== ethers.ZeroHash && (
                    <div className="proof-box">
                      <small>Immutable evidence hash</small>
                      <code>{milestone.proofHash}</code>
                      {evidenceUrl ? (
                        <a href={evidenceUrl} target="_blank" rel="noreferrer">
                          Open receipt or photo from {evidenceStorageLabel}
                        </a>
                      ) : milestone.proofURI ? (
                        <>
                          <code>{milestone.proofURI}</code>
                          <span className="notice error">
                            This is not a valid ChainCargo Supabase reference. External evidence cannot be fetched or verified automatically.
                          </span>
                        </>
                      ) : null}
                      <span>Submitted {formatDate(milestone.submittedAt)}</span>
                    </div>
                  )}
                  {isCarrier && canSubmitEvidence && (
                    <div className="evidence-form">
                      {storageConfigured === false && (
                        <div className="notice error">
                          Evidence upload is disabled. {storageConfigurationMessage} Existing public evidence remains viewable.
                        </div>
                      )}
                      <label>
                        Receipt, delivery photo, or supporting PDF
                        <input
                          accept={EVIDENCE_FILE_ACCEPT}
                          onChange={(event) => selectEvidenceFile(event.target.files?.[0])}
                          ref={evidenceFileInputRef}
                          type="file"
                          disabled={!storageConfigured}
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
                        disabled={Boolean(busyAction) || !evidenceFile || !storageConfigured}
                        onClick={() => submitEvidence(milestone)}
                      >
                        {busyAction === 'proof' ? 'Uploading evidence…' : 'Upload to Supabase & submit proof'}
                      </button>
                      <small>
                        The file is stored in the shared Supabase bucket. Only its storage reference and Keccak-256 hash are stored on-chain.
                      </small>
                    </div>
                  )}
                  {isCarrier && milestone.state === 0 && (milestoneExpired || agreementExpired) && (
                    <div className="notice error">The proof deadline has passed. Evidence can no longer be submitted.</div>
                  )}
                  {isCurrent && isShipper && milestone.state === 1 && (
                    <div className="evidence-form">
                      <strong>Review and verify evidence before confirmation</strong>
                      <div className={`notice ${reviewExpired ? 'warning' : ''}`}>
                        {reviewExpired
                          ? 'The 1-hour review period has ended. The Carrier may now request Arbitrator review.'
                          : `${formatDeadlineDuration(reviewSecondsRemaining)} remain in the Shipper review period.`}
                      </div>
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
                            ? 'Cryptographic verification passed. The stored file matches the immutable on-chain hash.'
                            : verificationForMilestone.message || 'Verification failed. The downloaded file does not match the on-chain hash; do not release payment.'}
                        </div>
                      )}
                      <div className="evidence-decision-actions">
                        <button
                          className="btn btn-primary"
                          disabled={Boolean(busyAction) || !evidenceVerified}
                          onClick={() => setEvidenceDecision({ type: 'confirm', milestone })}
                          type="button"
                        >
                          {busyAction === 'confirm'
                            ? 'Confirming & paying…'
                            : `Confirm & pay · ${milestone.payoutEth} ETH`}
                        </button>
                        <button
                          className="btn btn-danger"
                          disabled={Boolean(busyAction)}
                          onClick={() => setEvidenceDecision({ type: 'reject', milestone })}
                          type="button"
                        >
                          {busyAction === 'reject'
                            ? 'Requesting new evidence…'
                            : 'Reject & request new evidence'}
                        </button>
                      </div>
                    </div>
                  )}
                  {isCurrent && milestone.state === 1 && !isShipper && !reviewExpired && (
                    <div className="notice">
                      The Shipper has {formatDeadlineDuration(reviewSecondsRemaining)} remaining to review this evidence.
                    </div>
                  )}
                  {isCurrent && isCarrier && milestone.state === 1 && reviewExpired && (
                    <div className="evidence-form">
                      <div className="notice warning">
                        The Shipper did not approve or reject within 1 hour. Submit this case to the Arbitrator for a decision.
                      </div>
                      <button
                        className="btn btn-primary"
                        disabled={Boolean(busyAction)}
                        onClick={() => transact(
                          'timeout-arbitration',
                          (contract) => contract.requestArbitrationAfterReviewTimeout(
                            id,
                            milestone.index,
                          ),
                        )}
                        type="button"
                      >
                        {busyAction === 'timeout-arbitration'
                          ? 'Submitting to Arbitrator...'
                          : 'Request Arbitrator action'}
                      </button>
                    </div>
                  )}
                  {isCurrent && isShipper && milestone.state === 1 && agreementExpired && (
                    <div className="notice">
                      This proof was submitted before its deadline and remains available for confirmation.
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {currentMilestone && agreement.status === 0 && !isShipper && !isCarrier && !refundAvailable && (
          <p className="notice">This agreement is read-only for the connected wallet.</p>
        )}
      </div>
      {disputeConfirmationOpen && (
        <div className="toast-backdrop" role="presentation">
          <section
            aria-describedby="dispute-confirmation-message"
            aria-labelledby="dispute-confirmation-title"
            aria-modal="true"
            className="toast-popup confirmation-popup"
            role="alertdialog"
          >
            <h2 id="dispute-confirmation-title">Request Arbitrator action?</h2>
            <div className="toast-message" id="dispute-confirmation-message">
              <strong>This will pause the active agreement.</strong>
              <p>The Shipper and Carrier will see the dispute status. Only the Arbitrator can resolve the remaining escrow afterward.</p>
            </div>
            <div className="confirmation-actions">
              <button className="confirmation-cancel" onClick={() => setDisputeConfirmationOpen(false)} type="button">
                Cancel
              </button>
              <button autoFocus className="confirmation-reject" onClick={confirmDisputeRequest} type="button">
                Submit dispute
              </button>
            </div>
          </section>
        </div>
      )}
      {agreementDecision && (
        <div className="toast-backdrop" role="presentation">
          <section
            aria-describedby="agreement-decision-message"
            aria-labelledby="agreement-decision-title"
            aria-modal="true"
            className="toast-popup confirmation-popup"
            role="alertdialog"
          >
            <h2 id="agreement-decision-title">
              {agreementDecision === 'accept' ? 'Accept this agreement?' : agreementDecision === 'reject' ? 'Reject this agreement?' : 'Cancel this agreement?'}
            </h2>
            <div className="toast-message" id="agreement-decision-message">
              <strong>This blockchain action cannot be undone.</strong>
              <p>
                {agreementDecision === 'accept'
                  ? 'The agreement will become active and the Carrier can begin submitting milestone evidence.'
                  : `${agreement.remainingEth} ETH will be returned to the Shipper and the agreement will be closed.`}
              </p>
            </div>
            {agreementDecision === 'reject' && (
              <div style={{ textAlign: 'left', marginBottom: 16 }}>
                <label htmlFor="agreement-rejection-reason">Reason for rejection (required)</label>
                <textarea
                  id="agreement-rejection-reason"
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  rows={4}
                  maxLength={1000}
                  required
                  aria-describedby="rejection-reason-help"
                  style={{ width: '100%', boxSizing: 'border-box', marginTop: 8 }}
                />
                <small id="rejection-reason-help">
                  Publicly recorded on-chain. Do not include private information. Maximum 1,000 UTF-8 bytes.
                </small>
                {new TextEncoder().encode(rejectionReason.trim()).length > 1000 && (
                  <p role="alert">The reason is too long. Please shorten it.</p>
                )}
              </div>
            )}
            <div className="confirmation-actions">
              <button className="confirmation-cancel" onClick={() => setAgreementDecision(null)} type="button">
                Go Back
              </button>
              <button
                autoFocus
                className={agreementDecision === 'accept' ? 'confirmation-confirm' : 'confirmation-reject'}
                disabled={agreementDecision === 'reject' && !rejectionReasonValid}
                onClick={confirmAgreementDecision}
                type="button"
              >
                {agreementDecision === 'accept' ? 'Accept & Proceed' : agreementDecision === 'reject' ? 'Reject & Refund' : 'Cancel & Refund'}
              </button>
            </div>
          </section>
        </div>
      )}
      {evidenceDecision && (
        <div className="toast-backdrop" role="presentation">
          <section
            aria-describedby="evidence-decision-message"
            aria-labelledby="evidence-decision-title"
            aria-modal="true"
            className="toast-popup confirmation-popup"
            role="alertdialog"
          >
            <h2 id="evidence-decision-title">
              {isFinalEvidenceConfirmation
                ? 'Final delivery confirmation'
                : evidenceDecision.type === 'confirm' ? 'Confirm milestone payment?' : 'Request replacement evidence?'}
            </h2>
            <div className="toast-message" id="evidence-decision-message">
              <strong>
                {isFinalEvidenceConfirmation
                  ? 'This is your final confirmation and cannot be undone.'
                  : 'This blockchain action cannot be undone.'}
              </strong>
              <p>
                {isFinalEvidenceConfirmation
                  ? `${evidenceDecision.milestone.payoutEth} ETH will be released, the agreement will be completed, and no after-sales claim, evidence rejection, refund, or dispute will be available through ChainCargo.`
                  : evidenceDecision.type === 'confirm'
                  ? `${evidenceDecision.milestone.payoutEth} ETH will be released for this milestone.`
                  : 'The current evidence will be cleared and the Carrier will receive up to 24 hours to submit replacement evidence. No escrow will be refunded by this action.'}
              </p>
            </div>
            <div className="confirmation-actions">
              <button className="confirmation-cancel" onClick={() => setEvidenceDecision(null)} type="button">
                Cancel
              </button>
              <button
                autoFocus
                className={evidenceDecision.type === 'confirm' ? 'confirmation-confirm' : 'confirmation-reject'}
                onClick={confirmEvidenceDecision}
                type="button"
              >
                {isFinalEvidenceConfirmation
                  ? 'Final Confirm & Pay'
                  : evidenceDecision.type === 'confirm' ? 'Confirm & Pay' : 'Request New Evidence'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default AgreementDetail;
