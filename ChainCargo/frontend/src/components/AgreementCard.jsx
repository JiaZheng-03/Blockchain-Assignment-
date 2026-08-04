import { Link } from 'react-router-dom';

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
      <h3>{title}</h3>
      <p>Total Amount: {amount}</p>
      {remaining && <p>Escrow Remaining: {remaining}</p>}
      {deadline && <p>{deadlineLabel}: {deadline}</p>}
      {deadlineState?.countdown && (
        <div className={`deadline-indicator deadline-${deadlineState.level}`} aria-live="polite">
          <strong>{deadlineState.countdown}</strong>
          {refundAvailable && <span>Deadline missed — remaining escrow is refundable to the Shipper.</span>}
        </div>
      )}
      <p>Status: <span className="badge">{status}</span></p>
      <Link className="btn btn-secondary" to={link}>
        {actionLabel}
      </Link>
    </article>
  );
}

export default AgreementCard;
