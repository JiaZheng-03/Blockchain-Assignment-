import { Link } from 'react-router-dom';

function AgreementCard({ title, amount, status, link }) {
  return (
    <article className="card">
      <h3>{title}</h3>
      <p>Total Amount: {amount}</p>
      <p>Status: <span className="badge">{status}</span></p>
      <Link className="btn btn-secondary" to={link}>
        View Details
      </Link>
    </article>
  );
}

export default AgreementCard;
