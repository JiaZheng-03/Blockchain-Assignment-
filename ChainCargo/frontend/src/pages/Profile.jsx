import { useWallet } from '../context/WalletContext';

function Profile() {
  const { account, isConnected, formatAddress, networkName, balance, isLoadingBalance } = useWallet();

  return (
    <div className="grid grid-2">
      <div className="panel">
        <h3>Profile Summary</h3>
        <p>Connected Wallet: {isConnected ? formatAddress(account) : 'Not connected'}</p>
        <p>Network: {networkName}</p>
        <p>Balance: {isLoadingBalance ? 'Loading...' : balance}</p>
      </div>
      <div className="panel">
        <h3>Account Settings</h3>
        <p>Status: {isConnected ? 'Connected to MetaMask' : 'Disconnected'}</p>
        <p>Wallet Address: {isConnected ? account : 'Not available'}</p>
      </div>
    </div>
  );
}

export default Profile;
