export const SEPOLIA_EXPLORER_URL = 'https://sepolia.etherscan.io';

export function getSepoliaAddressUrl(address) {
  return `${SEPOLIA_EXPLORER_URL}/address/${address}`;
}

export function getSepoliaTransactionUrl(transactionHash) {
  return `${SEPOLIA_EXPLORER_URL}/tx/${transactionHash}`;
}
