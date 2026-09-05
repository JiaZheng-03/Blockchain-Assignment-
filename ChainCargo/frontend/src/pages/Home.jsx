import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import Icon from '../components/Icon';

function Home() {
  const { isConnected } = useWallet();
  const { deploymentStatus, isCorrectNetwork, expectedNetworkName } = useContract();
  const { hasAppAccess, isArbitrator, isShipper } = useProfile();
  const primaryAction = !isConnected
    ? { to: '/login', label: 'Connect your wallet' }
    : !isCorrectNetwork || deploymentStatus !== 'ready'
      ? { to: '/setup', label: 'Finish your setup' }
      : !hasAppAccess
        ? { to: '/register', label: 'Register your wallet' }
        : isArbitrator
          ? { to: '/dashboard', label: 'Open arbitration' }
          : isShipper
            ? { to: '/create-agreement', label: 'Create an agreement' }
            : { to: '/dashboard', label: 'View your shipments' };

  return (
    <section className="overview-page">
      <div className="page-heading">
        <div><h1>Your cargo. Connected.</h1><p>A clearer view of every shipment, milestone, and payment.</p></div>
        <span className="badge">{expectedNetworkName}</span>
      </div>
      <div className="overview-hero">
        <div className="overview-copy">
          <span className="overview-kicker"><Icon name="shield" size={13} />Your logistics, with a layer of trust</span>
          <h2>Keep cargo moving.<br /><span className="gradient-text">Keep payments secure.</span></h2>
          <p>Bring shippers and carriers into one workspace. Fund a shipment, verify its journey, and release payment at every confirmed milestone.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to={primaryAction.to}>{primaryAction.label}<Icon name="arrow" size={16} /></Link>
            <Link className="btn btn-secondary" to="/setup">Explore the setup<Icon name="external" size={14} /></Link>
          </div>
          <span className="overview-assurance"><Icon name="lock" size={12} />Your wallet. Your confirmation. Your control.</span>
        </div>
        <div className="shipment-visual" aria-label="Default payment split: 30 percent at cargo pickup and 70 percent at final delivery">
          <div className="visual-orbit" aria-hidden="true" />
          <div className="cargo-core"><Icon name="box" /></div>
          <span className="visual-top-note">THE JOURNEY, VERIFIED</span>
          <div className="visual-label visual-pickup"><Icon name="truck" /><span><strong>Cargo pickup</strong><small>30% default allocation</small></span></div>
          <div className="visual-label visual-delivery"><Icon name="check" /><span><strong>Final delivery</strong><small>70% default allocation</small></span></div>
          <span className="visual-hash">EVIDENCE → CONFIRMATION → PAYMENT</span>
        </div>
      </div>
      <div className="feature-grid">
        {[
          { icon: 'wallet', title: 'Fund once. Release in stages.', detail: 'Your payment stays in escrow until the shipment reaches its confirmed milestones.' },
          { icon: 'file', title: 'Proof behind every payment.', detail: 'Shared photos and documents, with file integrity checked against the on-chain hash.' },
          { icon: 'clock', title: 'A plan when things change.', detail: 'Track deadlines, request extensions, and manage refunds or disputes in one place.' },
        ].map((feature) => (
          <article className="feature-card" key={feature.title}><span className="feature-icon"><Icon name={feature.icon} size={19} /></span><h3>{feature.title}</h3><p>{feature.detail}</p></article>
        ))}
      </div>
      <section className="panel flow-panel" aria-labelledby="shipment-flow-title">
        <div className="section-heading"><div><span className="eyebrow">A connected workflow</span><h3 id="shipment-flow-title">From agreement to arrival</h3></div><Icon name="arrows" size={18} /></div>
        <div className="flow-strip">
          {[
            ['Connect', 'Register your Shipper or Carrier wallet.'],
            ['Agree & fund', 'Set the terms, fund escrow, and accept the shipment.'],
            ['Upload evidence', 'Record proof of pickup and final delivery.'],
            ['Confirm & pay', 'Verify each milestone and release its payment.'],
          ].map(([title, detail], index) => <span key={title}><span className="flow-number">0{index + 1}</span><strong>{title}</strong><small>{detail}</small></span>)}
        </div>
      </section>
      <div className="overview-bottom-note"><span>Built for the journey. Every agreement has a traceable on-chain history.</span><Link to="/history">Explore transactions <Icon name="arrow" size={14} /></Link></div>
    </section>
  );
}
export default Home;
