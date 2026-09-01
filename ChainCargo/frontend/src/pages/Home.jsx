import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';

function Home() {
  const { isConnected } = useWallet();
  const { deploymentStatus, isCorrectNetwork } = useContract();
  const { hasAppAccess, isArbitrator, isShipper } = useProfile();
  const primaryAction = !isConnected
    ? { to: '/login', label: 'Connect MetaMask' }
    : !isCorrectNetwork || deploymentStatus !== 'ready'
      ? { to: '/setup', label: 'Finish Local Setup' }
    : !hasAppAccess
      ? { to: '/register', label: 'Register This Wallet' }
      : isArbitrator
        ? { to: '/dashboard', label: 'Open Arbitration Dashboard' }
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
            <Link className="btn btn-secondary" to="/setup">
              View Setup Checklist
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
      <div className="flow-strip full-span">
        <span><strong>1. Register</strong><small>Shipper + Carrier wallets</small></span>
        <span><strong>2. Fund</strong><small>Lock ETH by milestone</small></span>
        <span><strong>3. Prove</strong><small>Carrier submits evidence</small></span>
        <span><strong>4. Release</strong><small>Shipper verifies payout</small></span>
      </div>
    </section>
  );
}

export default Home;
