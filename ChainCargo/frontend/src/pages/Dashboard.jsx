import { Link } from 'react-router-dom';
import AgreementCard from '../components/AgreementCard';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import { useAgreements } from '../hooks/useAgreements';
import { useWalletBalance } from '../hooks/useWalletBalance';

function Dashboard() {
  const {
    account,
    authorizedAccountCount,
    isConnected,
    isConnecting,
    formatAddress,
    networkName,
    switchWallet,
  } = useWallet();
  const { isConfigured } = useContract();
  const { profile, isShipper, isCarrier } = useProfile();
  const { agreements, loading: agreementsLoading, error: agreementsError } = useAgreements();
  const { displayBalance, error: balanceError } = useWalletBalance();

  const stats = [
    { title: 'Account', value: profile?.name || (account ? formatAddress(account) : 'Not connected') },
    { title: 'Network', value: networkName },
    { title: 'Sepolia Balance', value: displayBalance },
    { title: 'On-chain Role', value: profile?.roleLabel || 'Unregistered' },
  ];
  const activeAgreements = agreements.filter((agreement) => agreement.status === 0).length;
  const attentionAgreements = agreements.filter(
    (agreement) => agreement.status === 0 || agreement.status === 3,
  ).length;

  return (
    <section>
      {profile && (
        <div className={`role-banner ${isShipper ? 'shipper-banner' : 'carrier-banner'}`}>
          <div>
            <span className="eyebrow">Current role: {profile.roleLabel}</span>
            <h2>{isShipper ? 'Create and fund shipments' : 'Complete assigned shipments'}</h2>
            <p>
              {isShipper
                ? 'Shippers create agreements, choose a registered carrier, and fund milestone escrow.'
                : 'Carriers do not create or fund agreements. A shipper assigns your wallet; you then submit milestone evidence and receive approved payouts.'}
            </p>
          </div>
          <div className="role-actions">
            {isShipper && <Link className="btn btn-primary" to="/create-agreement">Create agreement</Link>}
            <button className="btn btn-secondary" onClick={switchWallet} disabled={isConnecting}>
              {isConnecting
                ? 'Choose account in MetaMask…'
                : authorizedAccountCount > 1
                  ? `Switch to ${isCarrier ? 'Shipper' : 'Carrier'} wallet`
                  : `Add your ${isCarrier ? 'Shipper' : 'Carrier'} wallet`}
            </button>
            {authorizedAccountCount < 2 && (
              <small className="wallet-permission-hint">
                In MetaMask, choose <strong>Edit accounts</strong>, select both imported accounts, then click <strong>Connect</strong>. Your current wallet stays registered.
              </small>
            )}
          </div>
        </div>
      )}
      <div className="stat-grid">
        {stats.map((stat) => (
          <div className="stat-box" key={stat.title}>
            <h3>{stat.value}</h3>
            <p>{stat.title}</p>
          </div>
        ))}
      </div>

      {profile && (
        <div className="panel workflow-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Your next step</span>
              <h3>
                {isShipper
                  ? activeAgreements
                    ? 'Review active agreements or create the next shipment'
                    : 'Create and fund your first logistics agreement'
                  : attentionAgreements
                    ? 'Open an assigned agreement and complete its current milestone'
                    : 'Wait for a Shipper to assign this Carrier wallet'}
              </h3>
            </div>
            <span className="badge">{attentionAgreements} need attention</span>
          </div>
          <p>
            {isShipper
              ? 'After funding, switch to the Carrier wallet to submit evidence. Switch back here to verify the evidence and release payment.'
              : 'Submit evidence before the milestone due date. The Shipper reviews it and releases the on-chain payout.'}
          </p>
          <div className="wizard-actions">
            <Link className="btn btn-secondary" to="/history">View transaction history</Link>
            {isShipper && <Link className="btn btn-primary" to="/create-agreement">Create & fund agreement</Link>}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="section-heading">
          <h3>Your Agreements</h3>
          <span className="badge">{agreements.length} total</span>
        </div>
        {!isConfigured && <div className="notice error">No contract deployment is configured.</div>}
        {balanceError && <div className="notice error">{balanceError}</div>}
        {agreementsError && <div className="notice error">{agreementsError}</div>}
        {agreementsLoading ? <p>Loading on-chain agreements…</p> : isConnected && agreements.length ? (
          <div className="grid grid-2">
            {agreements.map((agreement) => (
              <AgreementCard
                key={agreement.id}
                title={agreement.title}
                amount={`${agreement.totalEth} ETH`}
                remaining={`${agreement.remainingEth} ETH`}
                status={agreement.statusLabel}
                link={`/agreement/${agreement.id}`}
                actionLabel={
                  agreement.status === 0
                    ? isShipper
                      ? 'Review / release payout'
                      : 'Open current milestone'
                    : agreement.status === 3
                      ? 'Review dispute'
                      : 'View final record'
                }
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>
              {isConnected
                ? isShipper
                  ? 'No agreements yet. Create one to lock ETH into milestone escrow.'
                  : 'No agreements are assigned to this Carrier wallet yet.'
                : 'Connect your wallet to load agreements.'}
            </p>
            {isShipper && <Link className="btn btn-primary" to="/create-agreement">Create first agreement</Link>}
          </div>
        )}
      </div>
    </section>
  );
}

export default Dashboard;
