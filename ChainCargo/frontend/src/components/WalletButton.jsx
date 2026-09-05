import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';

function WalletButton() {
  const navigate = useNavigate();
  const {
    account,
    connectWallet,
    disconnectWallet,
    isConnecting,
    isConnected,
    isAuthenticated,
    formatAddress,
    error,
  } = useWallet();
  const handleClick = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer');
      return;
    }

    if (isConnected && isAuthenticated) {
      await disconnectWallet();
      navigate('/');
    } else {
      if (!isConnected) await connectWallet();
      navigate('/login');
    }
  };

  return (
    <div className="wallet-control">
      <button className="btn btn-secondary" onClick={handleClick} disabled={isConnecting} type="button">
        {isConnecting
          ? 'Waiting for MetaMask…'
          : isConnected && !isAuthenticated
              ? `Login with Wallet · ${formatAddress(account)}`
          : isConnected
            ? `Logout · ${formatAddress(account)}`
            : 'Connect to MetaMask'}
      </button>
      {error ? <p className="wallet-error">{error}</p> : null}
    </div>
  );
}

export default WalletButton;
