import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useProfile } from '../hooks/useProfile';

function Home() {
  const { isConnected } = useWallet();
  const { isRegistered, isShipper } = useProfile();
  const primaryAction = !isConnected
    ? { to: '/login', label: 'Connect Wallet' }
    : !isRegistered
      ? { to: '/register', label: 'Register This Wallet' }
      : isShipper
        ? { to: '/create-agreement', label: 'Create Agreement' }
        : { to: '/dashboard', label: 'View Assigned Agreements' };

  return (
    <section className="hero">
      <div>
        <h1>Secure logistics payments with blockchain escrow.</h1>
        <p>
          ChainCargo helps shippers and carriers manage milestone-based payments with
          transparent on-chain agreements, immutable shipment evidence, and deadline protection.
        </p>
        <div className="hero-actions">
          <Link className="btn btn-primary" to={primaryAction.to}>
            {primaryAction.label}
          </Link>
          {primaryAction.to !== '/dashboard' && (
            <Link className="btn btn-secondary" to="/dashboard">
              View Dashboard
            </Link>
          )}
        </div>
      </div>
      <div className="panel">
        <h3>Why ChainCargo</h3>
        <ul>
          <li>Escrow protected payments</li>
          <li>Milestone-based release logic</li>
          <li>MetaMask-ready blockchain flow</li>
          <li>Cryptographic milestone evidence</li>
          <li>Deadline refunds and dispute resolution</li>
        </ul>
      </div>
    </section>
  );
}

export default Home;
