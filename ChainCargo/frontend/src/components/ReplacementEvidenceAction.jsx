import { ethers } from 'ethers';
import { isValidDisputeText } from '../utils/disputeResolution';

export default function ReplacementEvidenceAction({
  id, isArbitrator, status, responseDeadline, nowSeconds, milestone, busyAction,
  reason, confirmationOpen, setConfirmationOpen, transact,
}) {
  const available = isArbitrator && status === 3 && responseDeadline > nowSeconds
    && Boolean(milestone?.proofHash) && milestone.proofHash !== ethers.ZeroHash
    && Boolean(milestone.submittedAt) && !busyAction;
  if (!available) return null;
  const valid = isValidDisputeText(reason);
  const confirm = () => {
    if (!valid) return;
    setConfirmationOpen(false);
    return transact('continue-replacement', (contract) => (
      contract.resolveDisputeAndContinue(id, false, reason.trim())
    ));
  };
  return (
    <>
      <div className="dispute-request-actions">
        <button className="btn btn-secondary" disabled={!valid} onClick={() => setConfirmationOpen(true)} type="button">
          Request Replacement Evidence &amp; Continue
        </button>
      </div>
      {reason.length > 0 && !valid && (
        <p className="notice error" role="alert">Enter a resolution reason of no more than 1,000 UTF-8 bytes.</p>
      )}
      {confirmationOpen && (
        <div className="toast-backdrop" role="presentation">
          <section aria-describedby="replacement-evidence-message" aria-labelledby="replacement-evidence-title"
            aria-modal="true" className="toast-popup confirmation-popup" role="alertdialog">
            <h2 id="replacement-evidence-title">Request replacement evidence?</h2>
            <div className="toast-message" id="replacement-evidence-message">
              <p>The current evidence hash, storage reference, and submission time will be cleared. The milestone will return to Pending and the agreement will return to Active.</p>
              <p>The time spent in the dispute will be added back to the remaining deadlines. The Carrier will be allowed to upload replacement evidence.</p>
              <p>No escrow will be released or refunded by this action.</p>
              <strong>This action cannot be undone after blockchain confirmation.</strong>
            </div>
            <div className="confirmation-actions">
              <button autoFocus className="confirmation-cancel" onClick={() => setConfirmationOpen(false)} type="button">Go Back</button>
              <button className="confirmation-confirm" disabled={!valid} onClick={confirm} type="button">Request Replacement Evidence</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
