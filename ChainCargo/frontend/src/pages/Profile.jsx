import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import { useAgreements } from '../hooks/useAgreements';

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
  const [balance, setBalance] = useState('0 ETH');

  useEffect(() => {
    if (!account || !window.ethereum) return undefined;
    let cancelled = false;
    new ethers.BrowserProvider(window.ethereum).getBalance(account).then((value) => {
      if (!cancelled) setBalance(`${Number(ethers.formatEther(value)).toFixed(4)} ETH`);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

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
          <div><small>Wallet</small><strong title={account}>{isConnected ? formatAddress(account) : 'Not connected'}</strong></div>
          <div><small>Registered</small><strong>{profile?.registeredAt ? new Date(profile.registeredAt * 1000).toLocaleString() : '—'}</strong></div>
          <div><small>Network</small><strong>{networkName}</strong></div>
        </div>
        {!profile?.role && <Link className="btn btn-primary" to="/register">Register this wallet</Link>}
      </div>
      <div className="panel">
        <span className="eyebrow">Portfolio</span>
        <h2>{balance}</h2>
        <div className="detail-grid single">
          <div><small>Participating agreements</small><strong>{agreements.length}</strong></div>
          <div><small>Active escrow</small><strong>{ethers.formatEther(activeEscrow)} ETH</strong></div>
          <div><small>Escrow contract</small><strong title={address}>{address ? formatAddress(address) : 'Not deployed'}</strong></div>
        </div>
      </div>
      <div className="panel full-span wallet-access-panel">
        <div>
          <span className="eyebrow">MetaMask permissions</span>
          <h2>Wallet Access</h2>
          <p>Choose which authorized address to use, remove individual addresses from localhost, or disconnect the site completely.</p>
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
