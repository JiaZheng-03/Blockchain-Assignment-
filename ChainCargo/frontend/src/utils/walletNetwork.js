export const HARDHAT_LOCAL_NETWORK = {
  chainId: 31337,
  chainName: 'Hardhat Local',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['http://127.0.0.1:8545'],
};

export const SEPOLIA_NETWORK = {
  chainId: 11155111,
  chainName: 'Sepolia Testnet',
  nativeCurrency: {
    name: 'Sepolia Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.sepolia.org'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

export function toHexChainId(chainId) {
  const normalized = Number(chainId);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error('A valid blockchain chain ID is required.');
  }
  return `0x${normalized.toString(16)}`;
}

function isUnknownChainError(error) {
  return error?.code === 4902 || error?.data?.originalError?.code === 4902;
}

export async function switchWalletNetwork(ethereum, chainId, network = null) {
  if (!ethereum?.request) {
    throw new Error('MetaMask is not available in this browser.');
  }

  const chainIdHex = toHexChainId(chainId);
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    if (!isUnknownChainError(error) || !network) throw error;

    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        chainName: network.chainName,
        nativeCurrency: network.nativeCurrency,
        rpcUrls: network.rpcUrls,
        ...(network.blockExplorerUrls
          ? { blockExplorerUrls: network.blockExplorerUrls }
          : {}),
      }],
    });
  }
}
