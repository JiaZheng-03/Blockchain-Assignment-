import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import sepoliaDeployment from '../contracts/deployment.json';
import localDeployment from '../contracts/deployment.local.json';
import { ESCROW_ABI } from '../contracts/abi';
import {
  HARDHAT_LOCAL_NETWORK,
  SEPOLIA_NETWORK,
  switchWalletNetwork,
} from '../utils/walletNetwork';
import {
  resolveContractAddress,
  selectDeploymentForChain,
} from '../utils/deploymentConfig';
import { useWallet } from './WalletContext';
export { friendlyContractError } from '../utils/contractErrors';

const ContractContext = createContext(null);
const DEFAULT_CHAIN_ID = SEPOLIA_NETWORK.chainId;
const REQUIRED_CONTRACT_VERSION = 12;

export function ContractProvider({ children }) {
  const { account, chainId, isConnected } = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);
  const [deploymentStatus, setDeploymentStatus] = useState('checking');
  const [deploymentError, setDeploymentError] = useState('');
  const expectedChainId = Number(import.meta.env.VITE_ESCROW_CHAIN_ID || DEFAULT_CHAIN_ID);
  const targetNetwork = expectedChainId === SEPOLIA_NETWORK.chainId
    ? SEPOLIA_NETWORK
    : expectedChainId === HARDHAT_LOCAL_NETWORK.chainId
      ? HARDHAT_LOCAL_NETWORK
      : null;
  const expectedNetworkName = targetNetwork?.chainName || `Chain ${expectedChainId}`;
  const expectedCurrencyName = targetNetwork?.nativeCurrency?.name || 'Ether';
  const blockExplorerUrl = targetNetwork?.blockExplorerUrls?.[0] || '';
  const deployment = selectDeploymentForChain(
    expectedChainId,
    sepoliaDeployment,
    localDeployment,
  );
  const address = resolveContractAddress({
    deployment,
    overrideAddress: import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS,
  });
  const isConfigured = Boolean(address);
  const currentChainId = chainId ? Number.parseInt(chainId, 16) : 0;
  const isCorrectNetwork = !expectedChainId || currentChainId === expectedChainId;

  const checkDeployment = useCallback(async () => {
    setDeploymentError('');
    if (!isConfigured) {
      setDeploymentStatus('not-configured');
      return 'not-configured';
    }
    if (typeof window === 'undefined' || !window.ethereum) {
      setDeploymentStatus('wallet-missing');
      return 'wallet-missing';
    }
    if (!isCorrectNetwork) {
      setDeploymentStatus('wrong-network');
      return 'wrong-network';
    }

    try {
      setDeploymentStatus('checking');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const code = await provider.getCode(address);
      let nextStatus = code === '0x' ? 'missing' : 'ready';
      if (nextStatus === 'ready') {
        try {
          const contract = new ethers.Contract(address, ESCROW_ABI, provider);
          const version = Number(await contract.CONTRACT_VERSION());
          if (version < REQUIRED_CONTRACT_VERSION) nextStatus = 'outdated';
        } catch {
          nextStatus = 'outdated';
        }
      }
      setDeploymentStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      setDeploymentStatus('unreachable');
      setDeploymentError(
        error?.shortMessage ||
          error?.message ||
          'The configured blockchain RPC could not be reached.',
      );
      return 'unreachable';
    }
  }, [address, isConfigured, isCorrectNetwork]);

  useEffect(() => {
    checkDeployment();
  }, [checkDeployment, refreshKey]);

  const switchToExpectedNetwork = useCallback(async () => {
    if (!expectedChainId) throw new Error('No target chain is configured.');
    await switchWalletNetwork(window.ethereum, expectedChainId, targetNetwork);
    setRefreshKey((current) => current + 1);
  }, [expectedChainId, targetNetwork]);

  const getReadContract = useCallback(async () => {
    if (!isConfigured) {
      throw new Error(`The escrow contract is not configured for chain ${expectedChainId}.`);
    }
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask is required to access the blockchain.');
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    if (expectedChainId && Number(network.chainId) !== expectedChainId) {
      throw new Error(
        `Wrong MetaMask network. Switch to chain ${expectedChainId} and try again.`,
      );
    }
    if ((await provider.getCode(address)) === '0x') {
      throw new Error(
        `No escrow contract exists at the configured address on chain ${expectedChainId}.`,
      );
    }
    const contract = new ethers.Contract(address, ESCROW_ABI, provider);
    try {
      const version = Number(await contract.CONTRACT_VERSION());
      if (version < REQUIRED_CONTRACT_VERSION) throw new Error('outdated');
    } catch {
      throw new Error('The configured contract is outdated. Redeploy it before using this application.');
    }
    return contract;
  }, [address, expectedChainId, isConfigured]);

  const getWriteContract = useCallback(async () => {
    if (!isConnected || !account) throw new Error('Connect your MetaMask wallet first.');
    const contract = await getReadContract();
    const signer = await contract.runner.getSigner(account);
    return contract.connect(signer);
  }, [account, getReadContract, isConnected]);

  const waitForTransaction = useCallback(async (transaction) => {
    const receipt = await transaction.wait();
    setRefreshKey((current) => current + 1);
    return receipt;
  }, []);

  const value = useMemo(
    () => ({
      address,
      blockExplorerUrl,
      deployment,
      expectedCurrencyName,
      expectedChainId,
      expectedNetworkName,
      isCorrectNetwork,
      isConfigured,
      deploymentError,
      deploymentStatus,
      refreshKey,
      checkDeployment,
      getReadContract,
      getWriteContract,
      switchToExpectedNetwork,
      waitForTransaction,
    }),
    [
      address,
      blockExplorerUrl,
      checkDeployment,
      deployment,
      deploymentError,
      deploymentStatus,
      expectedCurrencyName,
      expectedChainId,
      expectedNetworkName,
      getReadContract,
      getWriteContract,
      isConfigured,
      isCorrectNetwork,
      refreshKey,
      switchToExpectedNetwork,
      waitForTransaction,
    ],
  );

  return <ContractContext.Provider value={value}>{children}</ContractContext.Provider>;
}

export function useContract() {
  const context = useContext(ContractContext);
  if (!context) throw new Error('useContract must be used inside ContractProvider');
  return context;
}
