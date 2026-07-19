import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';

function Profile() {
  const { account, isConnected, formatAddress, networkName } = useWallet();
  const [balance, setBalance] = useState('0 ETH');

  useEffect(() => {
    if (!isConnected || !account || typeof window === 'undefined' || !window.ethereum) {
      setBalance('0 ETH');
      return undefined;
    }

    let isCancelled = false;

    const fetchBalance = async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const balance = await provider.getBalance(account);
        const formattedBalance = ethers.formatEther(balance);

        if (!isCancelled) {
          setBalance(`${Number(formattedBalance).toFixed(4)} ETH`);
        }
      } catch (error) {
        console.error(error);
        if (!isCancelled) {
          setBalance('Unavailable');
        }
      }
    };

    fetchBalance();

    return () => {
      isCancelled = true;
    };
  }, [account, isConnected]);

  return (
    <div className="grid grid-2">
      <div className="panel">
        <h3>Profile Summary</h3>
        <p>Connected Wallet: {isConnected ? formatAddress(account) : 'Not connected'}</p>
        <p>Network: {networkName}</p>
        <p>Balance: {balance}</p>
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
