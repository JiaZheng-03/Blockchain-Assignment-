import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import AgreementCard from '../components/AgreementCard';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import { useAgreements } from '../hooks/useAgreements';

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
  const [balance, setBalance] = useState('0 ETH');
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !account || typeof window === 'undefined' || !window.ethereum) {
      setBalance('0 ETH');
      setBalanceLoading(false);
      return undefined;
    }

    let isCancelled = false;

    const fetchBalance = async () => {
      try {
        setBalanceLoading(true);
        const provider = new ethers.BrowserProvider(window.ethereum);
        const balance = await provider.getBalance(account);
        const formattedBalance = ethers.formatEther(balance);

        if (!isCancelled) {
          setBalance(`${Number(formattedBalance).toFixed(4)} ETH`);
        }
      } catch (error) {
        console.error(error);
        if (!isCancelled) {
          setBalance('Unavailable');
        }
      } finally {
        if (!isCancelled) {
          setBalanceLoading(false);
        }
      }
    };

    fetchBalance();

    return () => {
      isCancelled = true;
    };
  }, [account, isConnected]);

  const stats = [
    { title: 'Account', value: profile?.name || (account ? formatAddress(account) : 'Not connected') },
    { title: 'Network', value: networkName },
    { title: 'Wallet Balance', value: balanceLoading ? 'Loading...' : balance },
    { title: 'On-chain Role', value: profile?.roleLabel || 'Unregistered' },
  ];

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

      <div className="panel">
        <div className="section-heading">
          <h3>Your Agreements</h3>
          <span className="badge">{agreements.length} total</span>
        </div>
        {!isConfigured && <div className="notice error">No contract deployment is configured.</div>}
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
              />
            ))}
          </div>
        ) : <p>{isConnected ? 'No agreements are linked to this wallet yet.' : 'Connect your wallet to load agreements.'}</p>}
      </div>
    </section>
  );
}

export default Dashboard;
