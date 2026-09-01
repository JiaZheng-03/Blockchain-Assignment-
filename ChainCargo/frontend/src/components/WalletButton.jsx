import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';

function WalletButton() {
  const navigate = useNavigate();
  const {
    account,
    disconnectWallet,
    isConnecting,
    isConnected,
    isAuthenticated,
    formatAddress,
    error,
  } = useWallet();
  const handleClick = () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer');
      return;
    }

    if (isConnected && isAuthenticated) {
      disconnectWallet();
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="wallet-control">
      <button className="btn btn-secondary" onClick={handleClick} disabled={isConnecting} type="button">
        {isConnecting
          ? 'Choose account in MetaMask…'
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
