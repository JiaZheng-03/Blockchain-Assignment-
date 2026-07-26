import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';

export function useWalletBalance() {
  const { account, chainId, isConnected } = useWallet();
  const { isCorrectNetwork, refreshKey } = useContract();
  const [balanceWei, setBalanceWei] = useState(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (
      !isConnected ||
      !account ||
      !isCorrectNetwork ||
      typeof window === 'undefined' ||
      !window.ethereum
    ) {
      setBalanceWei(0n);
      setLoading(false);
      setError('');
      return undefined;
    }

    async function loadBalance() {
      try {
        setLoading(true);
        setError('');
        const provider = new ethers.BrowserProvider(window.ethereum);
        const value = await provider.getBalance(account);
        if (!cancelled) setBalanceWei(value);
      } catch (loadError) {
        if (!cancelled) {
          setBalanceWei(0n);
          setError(loadError?.shortMessage || loadError?.message || 'Unable to read wallet balance.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBalance();
    return () => {
      cancelled = true;
    };
  }, [account, chainId, isConnected, isCorrectNetwork, refreshKey]);

  const balanceEth = ethers.formatEther(balanceWei);
  return {
    balanceEth,
    balanceWei,
    displayBalance: loading ? 'Loading…' : `${Number(balanceEth).toFixed(6)} Sepolia ETH`,
    error,
    loading,
  };
}
