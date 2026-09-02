import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import { useAgreements } from '../hooks/useAgreements';
import { useCarrierReputation } from '../hooks/useCarrierReputation';
import { useWalletBalance } from '../hooks/useWalletBalance';
import { getSepoliaAddressUrl } from '../utils/sepoliaExplorer';

function Profile() {
  const {
    account,
    isConnected,
    formatAddress,
    networkName,
  } = useWallet();
  const { address } = useContract();
  const { isArbitrator, profile, roleLabel, loading } = useProfile();
  const reputation = useCarrierReputation(
    !isArbitrator && profile?.role === 2 ? account : null,
  );
  const { agreements } = useAgreements({ arbitration: isArbitrator });
  const { displayBalance, error: balanceError } = useWalletBalance();

  const activeEscrow = agreements
    .filter((agreement) => agreement.status === 0 || agreement.status === 3)
    .reduce((total, agreement) => total + agreement.remainingAmount, 0n);

  return (
    <div className="grid grid-2">
      <div className="panel">
        <span className="eyebrow">On-chain identity</span>
        <h2>{loading ? 'Loading…' : isArbitrator ? 'Contract deployer' : profile?.name || 'Unregistered wallet'}</h2>
        <div className="detail-grid single">
          <div><small>Role</small><strong>{roleLabel}</strong></div>
          <div>
            <small>Wallet</small>
            {isConnected ? (
              <a href={getSepoliaAddressUrl(account)} target="_blank" rel="noreferrer" title={account}>
                {formatAddress(account)}
              </a>
            ) : <strong>Not connected</strong>}
          </div>
          <div>
            <small>{isArbitrator ? 'Authority' : 'Registered'}</small>
            <strong>
              {isArbitrator
                ? 'Assigned at contract deployment'
                : profile?.registeredAt
                  ? new Date(profile.registeredAt * 1000).toLocaleString()
                  : '—'}
            </strong>
          </div>
          <div><small>Network</small><strong>{networkName}</strong></div>
          {!isArbitrator && profile?.role === 2 && (
            <div>
              <small>Carrier reputation</small>
              <strong>
                {reputation.loading
                  ? 'Loading…'
                  : reputation.supported
                    ? `${reputation.pointsLabel} points · ${reputation.tier}`
                    : 'Redeploy required'}
              </strong>
            </div>
          )}
        </div>
        {!profile?.role && !isArbitrator && <Link className="btn btn-primary" to="/register">Register this wallet</Link>}
      </div>
      <div className="panel">
        <span className="eyebrow">Portfolio</span>
        <h2>{displayBalance}</h2>
        {balanceError && <div className="notice error">{balanceError}</div>}
        <div className="detail-grid single">
          <div>
            <small>{isArbitrator ? 'Arbitration cases' : 'Participating agreements'}</small>
            <strong>{agreements.length}</strong>
          </div>
          <div><small>Active escrow</small><strong>{ethers.formatEther(activeEscrow)} ETH</strong></div>
          <div>
            <small>Escrow contract</small>
            {address ? (
              <a href={getSepoliaAddressUrl(address)} target="_blank" rel="noreferrer" title={address}>
                {formatAddress(address)}
              </a>
            ) : <strong>Not deployed</strong>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Profile;
