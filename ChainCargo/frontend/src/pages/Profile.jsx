import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import { useAgreements } from '../hooks/useAgreements';
import { useWalletBalance } from '../hooks/useWalletBalance';
import { getSepoliaAddressUrl } from '../utils/sepoliaExplorer';

function Profile() {
  const {
    account,
    authorizedAccounts,
    connectWallet,
    disconnectWallet,
    isConnected,
    isConnecting,
    formatAddress,
    manageAuthorizedAccounts,
    networkName,
    switchWallet,
  } = useWallet();
  const { address } = useContract();
  const { profile, loading } = useProfile();
  const { agreements } = useAgreements();
  const { displayBalance, error: balanceError } = useWalletBalance();

  const activeEscrow = agreements
    .filter((agreement) => agreement.status === 0 || agreement.status === 3)
    .reduce((total, agreement) => total + agreement.remainingAmount, 0n);

  return (
    <div className="grid grid-2">
      <div className="panel">
        <span className="eyebrow">On-chain identity</span>
        <h2>{loading ? 'Loading…' : profile?.name || 'Unregistered wallet'}</h2>
        <div className="detail-grid single">
          <div><small>Role</small><strong>{profile?.roleLabel || 'None'}</strong></div>
          <div>
            <small>Wallet</small>
            {isConnected ? (
              <a href={getSepoliaAddressUrl(account)} target="_blank" rel="noreferrer" title={account}>
                {formatAddress(account)}
              </a>
            ) : <strong>Not connected</strong>}
          </div>
          <div><small>Registered</small><strong>{profile?.registeredAt ? new Date(profile.registeredAt * 1000).toLocaleString() : '—'}</strong></div>
          <div><small>Network</small><strong>{networkName}</strong></div>
        </div>
        {!profile?.role && <Link className="btn btn-primary" to="/register">Register this wallet</Link>}
      </div>
      <div className="panel">
        <span className="eyebrow">Portfolio</span>
        <h2>{displayBalance}</h2>
        {balanceError && <div className="notice error">{balanceError}</div>}
        <div className="detail-grid single">
          <div><small>Participating agreements</small><strong>{agreements.length}</strong></div>
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
      <div className="panel full-span wallet-access-panel">
        <div>
          <span className="eyebrow">MetaMask permissions</span>
          <h2>Wallet Access</h2>
          <p>Choose which authorized Sepolia address to use, manage site access, or disconnect ChainCargo from MetaMask.</p>
        </div>
        <div className="authorized-addresses">
          <small>Linked addresses ({authorizedAccounts.length})</small>
          {authorizedAccounts.map((address) => (
            <code className={address.toLowerCase() === account?.toLowerCase() ? 'selected-address' : ''} key={address}>
              {formatAddress(address)}
              {address.toLowerCase() === account?.toLowerCase() ? ' · Current' : ''}
            </code>
          ))}
        </div>
        <div className="wallet-access-actions">
          <button className="btn btn-primary" type="button" onClick={isConnected ? switchWallet : connectWallet} disabled={isConnecting}>
            {isConnected ? 'Switch account' : 'Connect wallet'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={manageAuthorizedAccounts} disabled={isConnecting || !isConnected}>
            Manage linked accounts
          </button>
          <button className="btn btn-danger" type="button" onClick={disconnectWallet} disabled={isConnecting || !isConnected}>
            Disconnect ChainCargo
          </button>
        </div>
        <small className="permission-note">
          Removing website access does not delete on-chain roles, agreements, or transaction history.
        </small>
      </div>
    </div>
  );
}

export default Profile;
