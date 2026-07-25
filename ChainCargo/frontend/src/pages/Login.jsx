import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useProfile } from '../hooks/useProfile';

function Login() {
  const navigate = useNavigate();
  const {
    account,
    authorizedAccountCount,
    isConnected,
    isConnecting,
    connectWallet,
    switchWallet,
    error,
  } = useWallet();
  const { isRegistered, loading, profile } = useProfile();

  useEffect(() => {
    if (isConnected && isRegistered && !loading) navigate('/dashboard');
  }, [isConnected, isRegistered, loading, navigate]);

  return (
    <div className="auth-shell">
      <div className="form-card auth-card setup-card">
        <Link className="brand dark" to="/">ChainCargo</Link>
        <h2>Wallet login</h2>
        <p>Choose a MetaMask account. Its wallet address is your secure login—there is no password.</p>

        <div className="wallet-preview">
          <small>Selected MetaMask account</small>
          <code>{account || 'No wallet connected'}</code>
        </div>

        {error && <div className="notice error">{error}</div>}
        {loading && isConnected && <div className="notice">Checking this wallet’s registration…</div>}

        {!isConnected && (
          <button className="btn btn-primary full-width" onClick={connectWallet} disabled={isConnecting}>
            {isConnecting ? 'Waiting for MetaMask…' : 'Connect MetaMask'}
          </button>
        )}

        {isConnected && !loading && isRegistered && (
          <div className="notice success">
            Registered as <strong>{profile.roleLabel}</strong>: {profile.name}. Opening your dashboard…
          </div>
        )}

        {isConnected && !loading && !isRegistered && (
          <>
            <div className="notice">
              This wallet is connected but not registered. Choose what this wallet represents:
            </div>
            <div className="role-grid">
              <Link className="role-card" to="/register?role=shipper">
                <span className="role-icon">S</span>
                <strong>Register as Shipper</strong>
                <small>Creates agreements and funds escrow.</small>
              </Link>
              <Link className="role-card" to="/register?role=carrier">
                <span className="role-icon">C</span>
                <strong>Register as Carrier</strong>
                <small>Submits evidence and receives payouts.</small>
              </Link>
            </div>
          </>
        )}

        {isConnected && (
          <button className="btn btn-secondary full-width" onClick={switchWallet} disabled={isConnecting}>
            {isConnecting
              ? 'Choose account in MetaMask…'
              : authorizedAccountCount > 1
                ? 'Switch to the other authorized account'
                : 'Authorize another MetaMask account'}
          </button>
        )}

        {isConnected && authorizedAccountCount < 2 && (
          <div className="notice">
            MetaMask may say “Connect this website.” You are already connected; click <strong>Edit accounts</strong>, select both imported accounts, then click <strong>Connect</strong>.
          </div>
        )}

        <div className="setup-help">
          <strong>Testing both roles?</strong>
          <p>Use two different MetaMask accounts: register Account 1 as Shipper, then select Account 2 and register it as Carrier. One wallet cannot hold both roles.</p>
        </div>
        <Link className="back-link" to="/">← Back to home</Link>
      </div>
    </div>
  );
}

export default Login;
