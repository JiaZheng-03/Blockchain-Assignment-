import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const WalletContext = createContext(null);
const SELECTED_ACCOUNT_KEY = 'chaincargo.selectedAccount';

function rememberSelectedAccount(address) {
  if (typeof window === 'undefined') return;
  if (address) {
    window.localStorage.setItem(SELECTED_ACCOUNT_KEY, address);
  } else {
    window.localStorage.removeItem(SELECTED_ACCOUNT_KEY);
  }
}

function chooseRememberedAccount(accounts) {
  if (!accounts?.length) return null;
  const remembered = typeof window === 'undefined'
    ? null
    : window.localStorage.getItem(SELECTED_ACCOUNT_KEY);
  return accounts.find(
    (candidate) => candidate.toLowerCase() === remembered?.toLowerCase(),
  ) || accounts[0];
}

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
  const connectionConfirmedRef = useRef(false);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [authorizedAccounts, setAuthorizedAccounts] = useState([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [showAccountPermissionHelp, setShowAccountPermissionHelp] = useState(false);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [accountPermissionMode, setAccountPermissionMode] = useState('add');

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const connectWallet = useCallback(async () => {
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
      setAuthorizedAccounts(accounts || []);
      if (accounts && accounts[0]) {
        connectionConfirmedRef.current = true;
        const selected = chooseRememberedAccount(accounts);
        rememberSelectedAccount(selected);
        setAccount(selected);
      } else {
        connectionConfirmedRef.current = false;
        rememberSelectedAccount(null);
        setAccount(null);
      }

      const networkId = await window.ethereum.request({ method: 'eth_chainId' });
      setChainId(networkId);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to connect wallet.');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const switchWallet = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('MetaMask is not installed. Please install MetaMask and refresh the page.');
      return;
    }

    try {
      setIsConnecting(true);
      setError('');
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      setAuthorizedAccounts(accounts || []);

      if (accounts?.length > 1) {
        setShowAccountSwitcher(true);
        return;
      }
      setAccountPermissionMode('add');
      setShowAccountPermissionHelp(true);
    } catch (switchError) {
      console.error(switchError);
      if (switchError?.code !== 4001) {
        setError(switchError.message || 'Failed to select a MetaMask account.');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const authorizeAdditionalAccount = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    try {
      setShowAccountPermissionHelp(false);
      setIsConnecting(true);
      setError('');
      try {
        await window.ethereum.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch (permissionError) {
        if (permissionError?.code !== -32601 && permissionError?.code !== 4200) {
          throw permissionError;
        }
      }

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAuthorizedAccounts(accounts || []);
      if (!accounts?.length) {
        connectionConfirmedRef.current = false;
        rememberSelectedAccount(null);
        setAccount(null);
        return;
      }
      connectionConfirmedRef.current = true;
      if (accountPermissionMode === 'add' && accounts.length < 2) {
        setError('No second account was authorized. Open Edit accounts in MetaMask and select both imported accounts.');
        return;
      }
      const selected = chooseRememberedAccount(accounts);
      rememberSelectedAccount(selected);
      setAccount(selected);
      if (accountPermissionMode === 'add') setShowAccountSwitcher(true);
    } catch (permissionError) {
      console.error(permissionError);
      if (permissionError?.code !== 4001) {
        setError(permissionError.message || 'Failed to authorize another MetaMask account.');
      }
    } finally {
      setIsConnecting(false);
    }
  }, [accountPermissionMode]);

  const closeAccountPermissionHelp = useCallback(() => {
    setShowAccountPermissionHelp(false);
  }, []);

  const closeAccountSwitcher = useCallback(() => {
    setShowAccountSwitcher(false);
  }, []);

  const manageAuthorizedAccounts = useCallback(() => {
    setShowAccountSwitcher(false);
    setAccountPermissionMode('manage');
    setShowAccountPermissionHelp(true);
  }, []);

  const disconnectWallet = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    try {
      setIsConnecting(true);
      setError('');
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
      connectionConfirmedRef.current = false;
      rememberSelectedAccount(null);
      setAuthorizedAccounts([]);
      setAccount(null);
      setShowAccountSwitcher(false);
    } catch (disconnectError) {
      console.error(disconnectError);
      if (disconnectError?.code !== 4001) {
        setError(
          disconnectError?.code === -32601 || disconnectError?.code === 4200
            ? 'This wallet cannot disconnect automatically. Use MetaMask → Connected sites to disconnect ChainCargo.'
            : disconnectError.message || 'Failed to disconnect MetaMask.',
        );
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const selectAuthorizedAccount = useCallback((selectedAccount) => {
    if (!connectionConfirmedRef.current) {
      setError('Connect MetaMask before selecting an account.');
      return;
    }
    const authorized = authorizedAccounts.find(
      (candidate) => candidate.toLowerCase() === selectedAccount.toLowerCase(),
    );
    if (!authorized) {
      setError('That wallet is no longer authorized in MetaMask.');
      return;
    }
    setError('');
    rememberSelectedAccount(authorized);
    setAccount(authorized);
    setShowAccountSwitcher(false);
  }, [authorizedAccounts]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('MetaMask is not installed. Please install MetaMask and refresh the page.');
      return undefined;
    }

    const handleAccountsChanged = (accounts) => {
      setError('');
      setAuthorizedAccounts(accounts);
      if (!connectionConfirmedRef.current || accounts.length === 0) {
        if (accounts.length === 0) connectionConfirmedRef.current = false;
        rememberSelectedAccount(null);
        setAccount(null);
      } else {
        setAccount((current) => {
          const selected = accounts.find(
            (candidate) => candidate.toLowerCase() === current?.toLowerCase(),
          ) || chooseRememberedAccount(accounts);
          rememberSelectedAccount(selected);
          return selected;
        });
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
        setAuthorizedAccounts(accounts || []);
        // Keep the account disconnected until the user explicitly presses Connect MetaMask.
        // eth_accounts only tells us which permissions existed in an earlier browser session.
        connectionConfirmedRef.current = false;
        setAccount(null);
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
      accountPermissionMode,
      authorizedAccounts,
      authorizedAccountCount: authorizedAccounts.length,
      authorizeAdditionalAccount,
      chainId,
      isConnecting,
      error,
      formatAddress,
      connectWallet,
      closeAccountPermissionHelp,
      closeAccountSwitcher,
      disconnectWallet,
      manageAuthorizedAccounts,
      switchWallet,
      networkName: getNetworkName(chainId),
      isConnected: Boolean(account),
      selectAuthorizedAccount,
      showAccountPermissionHelp,
      showAccountSwitcher,
    }),
    [
      account,
      accountPermissionMode,
      authorizeAdditionalAccount,
      authorizedAccounts,
      chainId,
      closeAccountPermissionHelp,
      closeAccountSwitcher,
      connectWallet,
      disconnectWallet,
      error,
      isConnecting,
      manageAuthorizedAccounts,
      selectAuthorizedAccount,
      showAccountPermissionHelp,
      showAccountSwitcher,
      switchWallet,
    ],
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
