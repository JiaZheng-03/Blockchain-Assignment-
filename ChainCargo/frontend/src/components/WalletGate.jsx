import { Link, Outlet } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';

function WalletGate() {
  const {
    connectWallet,
    isConnected,
    isConnecting,
  } = useWallet();
  const {
    deploymentStatus,
    isCorrectNetwork,
    switchToExpectedNetwork,
  } = useContract();
  const { isRegistered, loading } = useProfile();

  if (!isConnected) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Wallet required</span>
        <h2>Connect MetaMask to continue</h2>
        <p>Your wallet address is your ChainCargo login and identifies your on-chain role.</p>
        <button className="btn btn-primary" disabled={isConnecting} onClick={connectWallet} type="button">
          {isConnecting ? 'Waiting for MetaMask…' : 'Connect MetaMask'}
        </button>
      </div>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Network required</span>
        <h2>Switch MetaMask to Sepolia</h2>
        <p>ChainCargo’s coursework contract runs on Sepolia testnet, chain 11155111.</p>
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
        <span className="eyebrow">Sepolia contract required</span>
        <h2>Deploy ChainCargo to Sepolia first</h2>
        <p>The configured Sepolia address does not contain the escrow contract.</p>
        <Link className="btn btn-primary" to="/setup">Open setup checklist</Link>
      </div>
    );
  }

  if (loading) {
    return <div className="panel access-panel">Checking your on-chain registration…</div>;
  }

  if (!isRegistered) {
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
