import { useWallet } from '../context/WalletContext';

function WalletButton() {
  const { account, connectWallet, isConnecting, isConnected, formatAddress, error } = useWallet();

  const handleClick = () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer');
      return;
    }

    connectWallet();
  };

  return (
    <div className="wallet-control">
      <button className="btn btn-secondary" onClick={handleClick} disabled={isConnecting} type="button">
        {isConnecting ? 'Connecting...' : isConnected ? formatAddress(account) : 'Connect Wallet'}
      </button>
      {error ? <p className="wallet-error">{error}</p> : null}
    </div>
  );
}

export default WalletButton;
