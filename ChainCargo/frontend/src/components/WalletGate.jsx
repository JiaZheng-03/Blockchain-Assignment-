import { Link, Outlet } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';

function WalletGate() {
  const {
    isConnected,
    isAuthenticated,
  } = useWallet();
  const {
    deploymentStatus,
    expectedChainId,
    expectedNetworkName,
    isCorrectNetwork,
    switchToExpectedNetwork,
  } = useContract();
  const { hasAppAccess, loading } = useProfile();

  if (!isConnected) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Wallet required</span>
        <h2>Connect MetaMask to continue</h2>
        <p>Your wallet address is your CargoSeal login and identifies your on-chain role.</p>
        <Link className="btn btn-primary" to="/login">Open wallet access</Link>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Wallet login required</span>
        <h2>Sign in with your connected wallet</h2>
        <p>Sign a free message in MetaMask to prove that you control this public address.</p>
        <Link className="btn btn-primary" to="/login">Open wallet access</Link>
      </div>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Network required</span>
        <h2>Switch MetaMask to {expectedNetworkName}</h2>
        <p>The configured CargoSeal contract runs on chain {expectedChainId}.</p>
        <button className="btn btn-primary" onClick={switchToExpectedNetwork} type="button">
          Switch network
        </button>
      </div>
    );
  }

  if (deploymentStatus === 'checking') {
    return <div className="panel access-panel">Checking the local escrow deployment…</div>;
  }

  if (deploymentStatus !== 'ready') {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Contract deployment required</span>
        <h2>Deploy CargoSeal to {expectedNetworkName} first</h2>
        <p>The configured address does not contain the current escrow contract.</p>
        <Link className="btn btn-primary" to="/setup">Open setup checklist</Link>
      </div>
    );
  }

  if (loading) {
    return <div className="panel access-panel">Checking your on-chain registration…</div>;
  }

  if (!hasAppAccess) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Registration required</span>
        <h2>Choose a role for this wallet</h2>
        <p>Register as a Shipper to create and fund agreements, or as a Carrier to complete them.</p>
        <Link className="btn btn-primary" to="/register">Register wallet role</Link>
      </div>
    );
  }

  return <Outlet />;
}

export default WalletGate;
