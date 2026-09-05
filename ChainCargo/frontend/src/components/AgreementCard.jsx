import { Link } from 'react-router-dom';
import Icon from './Icon';

function AgreementCard({
  agreementId,
  title,
  amount,
  remaining,
  deadline,
  deadlineLabel = 'Final deadline',
  deadlineState,
  refundAvailable = false,
  status,
  link,
  actionLabel = 'View Details',
}) {
  return (
    <article className={`card agreement-card deadline-${deadlineState?.level || 'closed'}`}>
      {agreementId !== undefined && <span className="eyebrow">Agreement #{agreementId}</span>}
      {status === 'Disputed' && (
        <div className="dispute-card-alert">
          <span className="dispute-status-mark" aria-hidden="true">!</span>
          <span><strong>Dispute requested</strong><small>Awaiting Arbitrator action</small></span>
        </div>
      )}
      <h3>{title}</h3>
      <div className="agreement-values">
        <span><small>Total escrow</small><strong>{amount}</strong></span>
        {remaining && <span><small>Remaining</small><strong>{remaining}</strong></span>}
      </div>
      {deadline && <div className="agreement-date"><Icon name="clock" size={15} /><span>{deadlineLabel}<strong>{deadline}</strong></span></div>}
      {deadlineState?.countdown && (
        <div className={`deadline-indicator deadline-${deadlineState.level}`} aria-live="polite">
          <strong>{deadlineState.countdown}</strong>
          {refundAvailable && <span>Deadline missed — remaining escrow is refundable to the Shipper.</span>}
        </div>
      )}
      <Link className="btn btn-secondary" to={link}>
        {actionLabel}<Icon name="arrow" size={15} />
      </Link>
    </article>
  );
}

export default AgreementCard;
