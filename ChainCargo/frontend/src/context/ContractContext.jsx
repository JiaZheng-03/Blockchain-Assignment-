import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import deployment from '../contracts/deployment.json';
import { ESCROW_ABI } from '../contracts/abi';
import { useWallet } from './WalletContext';
export { friendlyContractError } from '../utils/contractErrors';

const ContractContext = createContext(null);

function getContractAddress() {
  return import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || deployment.address;
}

export function ContractProvider({ children }) {
  const { account, isConnected } = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);
  const address = getContractAddress();
  const expectedChainId = Number(import.meta.env.VITE_ESCROW_CHAIN_ID || deployment.chainId || 0);
  const isConfigured = ethers.isAddress(address || '') && address !== ethers.ZeroAddress;

  const getReadContract = useCallback(async () => {
    if (!isConfigured) throw new Error('Contract is not deployed. Run the local deployment first.');
    if (!window.ethereum) throw new Error('MetaMask is required to access the blockchain.');
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    if (expectedChainId && Number(network.chainId) !== expectedChainId) {
      throw new Error(
        `Wrong MetaMask network. Switch to chain ${expectedChainId} and try again.`,
      );
    }
    if ((await provider.getCode(address)) === '0x') {
      throw new Error(
        'No escrow contract exists at the configured address. Run the deployment command again.',
      );
    }
    return new ethers.Contract(address, ESCROW_ABI, provider);
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
      expectedChainId,
      isConfigured,
      refreshKey,
      getReadContract,
      getWriteContract,
      waitForTransaction,
    }),
    [address, expectedChainId, getReadContract, getWriteContract, isConfigured, refreshKey, waitForTransaction],
  );

  return <ContractContext.Provider value={value}>{children}</ContractContext.Provider>;
}

export function useContract() {
  const context = useContext(ContractContext);
  if (!context) throw new Error('useContract must be used inside ContractProvider');
  return context;
}
