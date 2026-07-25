import { useWallet } from '../context/WalletContext';

function WalletButton() {
  const {
    account,
    connectWallet,
    switchWallet,
    authorizedAccountCount,
    isConnecting,
    isConnected,
    formatAddress,
    error,
  } = useWallet();
  const handleClick = () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer');
      return;
    }

    if (isConnected) {
      switchWallet();
    } else {
      connectWallet();
    }
  };

  return (
    <div className="wallet-control">
      <button className="btn btn-secondary" onClick={handleClick} disabled={isConnecting} type="button">
        {isConnecting
          ? 'Choose account in MetaMask…'
          : isConnected
            ? `${authorizedAccountCount > 1 ? 'Switch account' : 'Add another account'} · ${formatAddress(account)}`
            : 'Connect Wallet'}
      </button>
      {error ? <p className="wallet-error">{error}</p> : null}
    </div>
  );
}

export default WalletButton;
