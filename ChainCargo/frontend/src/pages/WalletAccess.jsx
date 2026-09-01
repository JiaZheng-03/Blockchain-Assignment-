import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { ROLE_LABELS } from '../contracts/abi';

function WalletAccess() {
  const navigate = useNavigate();
  const { account, authenticateWallet, authorizedAccounts, chooseAccountInMetaMask,
    connectWallet, disconnectWallet, error, formatAddress, isAuthenticated, isAuthenticating, isConnecting,
    networkName, selectAuthorizedAccount } = useWallet();
  const { getReadContract, isCorrectNetwork } = useContract();
  const [details, setDetails] = useState({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const hasMetaMask = typeof window !== 'undefined' && Boolean(window.ethereum);

  const backToHome = async () => {
    if (authorizedAccounts.length || account) await disconnectWallet();
    navigate('/');
  };

  useEffect(() => {
    let cancelled = false;
    if (!authorizedAccounts.length || !window.ethereum) {
      setDetails({});
      return undefined;
    }

    async function loadAccountDetails() {
      setDetailsLoading(true);
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        let contract = null;
        if (isCorrectNetwork) {
          try { contract = await getReadContract(); } catch { contract = null; }
        }
        const entries = await Promise.all(authorizedAccounts.map(async (address) => {
          const [balance, profile] = await Promise.all([
            provider.getBalance(address).catch(() => 0n),
            contract?.getProfile(address).catch(() => null) || null,
          ]);
          const role = profile ? Number(profile.role) : 0;
          return [address.toLowerCase(), {
            balance: `${Number(ethers.formatEther(balance)).toFixed(6)} ETH`,
            name: profile?.name || 'Unregistered wallet',
            role: ROLE_LABELS[role] || 'Unregistered',
          }];
        }));
        if (!cancelled) setDetails(Object.fromEntries(entries));
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    }

    loadAccountDetails();
    return () => { cancelled = true; };
  }, [authorizedAccounts, getReadContract, isCorrectNetwork]);

  return (
    <div className="auth-shell">
      <main className="form-card auth-card wallet-login-card">
        <Link className="brand dark" to="/">ChainCargo</Link>
        <span className="eyebrow">Wallet access</span>
        <h2>{authorizedAccounts.length ? 'Choose an account' : 'Connect to MetaMask'}</h2>
        <p>{authorizedAccounts.length ? 'Review every authorized account and select the one you want to login with.' : 'Select one or more MetaMask accounts to use with ChainCargo.'}</p>
        {error && <div className="notice error">{error}</div>}

        {!authorizedAccounts.length ? (
          !hasMetaMask ? (
            <a className="btn btn-primary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
          ) : (
            <button className="btn btn-primary" disabled={isConnecting} onClick={connectWallet} type="button">
              {isConnecting ? 'Waiting for MetaMask…' : 'Connect to MetaMask'}
            </button>
          )
        ) : (
          <>
            <div className="authorized-wallet-grid">
              {authorizedAccounts.map((address) => {
                const selected = address.toLowerCase() === account?.toLowerCase();
                const detail = details[address.toLowerCase()];
                return (
                  <button className={`selected-wallet-details wallet-detail-choice ${selected ? 'current' : ''}`} key={address} onClick={() => selectAuthorizedAccount(address)} type="button">
                    <div className="selected-wallet-heading">
                      <span className="wallet-identicon" aria-hidden="true">{detail?.name?.charAt(0) || 'W'}</span>
                      <span><small>{selected ? 'Selected account' : 'Authorized account'}</small><strong>{detailsLoading && !detail ? 'Loading profile…' : detail?.name}</strong><code title={address}>{formatAddress(address)}</code></span>
                      {selected && <span className="badge">Selected</span>}
                    </div>
                    <div className="wallet-detail-grid">
                      <div><small>Role</small><strong>{detail?.role || 'Loading…'}</strong></div>
                      <div><small>Balance</small><strong>{detail?.balance || 'Loading…'}</strong></div>
                      <div><small>Network</small><strong>{networkName}</strong></div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="wallet-login-actions">
              <button className="btn btn-primary" disabled={!account || isAuthenticating || isAuthenticated} onClick={authenticateWallet} type="button">
                {isAuthenticated ? 'Login complete' : isAuthenticating ? 'Waiting for signature…' : 'Login with Wallet'}
              </button>
              <button className="btn btn-secondary" disabled={isConnecting || isAuthenticating} onClick={chooseAccountInMetaMask} type="button">
                {isConnecting ? 'Waiting for MetaMask…' : 'Switch account'}
              </button>
            </div>
            {isAuthenticated && (
              <div className="notice success setup-complete">
                <div><strong>Wallet ready</strong><p>{formatAddress(account)} is connected and verified.</p></div>
                <Link className="btn btn-primary" to={details[account.toLowerCase()]?.role !== 'Unregistered' ? '/dashboard' : '/register'}>Continue</Link>
              </div>
            )}
          </>
        )}
        <button className="text-button back-link" disabled={isConnecting} onClick={backToHome} type="button">
          Back to Home
        </button>
      </main>
    </div>
  );
}

export default WalletAccess;
