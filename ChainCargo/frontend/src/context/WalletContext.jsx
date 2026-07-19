import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const WalletContext = createContext(null);

const getNetworkName = (chainId) => {
  switch (chainId) {
    case '0x1':
      return 'Ethereum Mainnet';
    case '0x5':
      return 'Goerli';
    case '0xaa36a7':
      return 'Sepolia';
    case '0x539':
    case '0x7a69':
      return 'Hardhat Local';
    default:
      return chainId ? `Chain ${chainId}` : 'Not connected';
  }
};

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('MetaMask is not installed. Please install MetaMask and refresh the page.');
      return;
    }

    if (typeof window.ethereum.request !== 'function') {
      setError('MetaMask is available but could not be initialized. Please refresh the page.');
      return;
    }

    try {
      setIsConnecting(true);
      setError('');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts[0]) {
        setAccount(accounts[0]);
      }

      const networkId = await window.ethereum.request({ method: 'eth_chainId' });
      setChainId(networkId);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to connect wallet.');
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('MetaMask is not installed. Please install MetaMask and refresh the page.');
      return undefined;
    }

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAccount(null);
      } else {
        setAccount(accounts[0]);
      }
    };

    const handleChainChanged = (newChainId) => {
      setChainId(newChainId);
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    const initializeWallet = async () => {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts && accounts[0]) {
          setAccount(accounts[0]);
        }
        const networkId = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(networkId);
      } catch (err) {
        console.error(err);
      }
    };

    initializeWallet();

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  const value = useMemo(
    () => ({
      account,
      chainId,
      isConnecting,
      error,
      formatAddress,
      connectWallet,
      networkName: getNetworkName(chainId),
      isConnected: Boolean(account),
    }),
    [account, chainId, isConnecting, error],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used inside WalletProvider');
  }
  return context;
}
