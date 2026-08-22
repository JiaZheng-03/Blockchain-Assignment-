import { ethers } from 'ethers';

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;

export function selectDeploymentForChain(
  chainId,
  sepoliaDeployment,
  localDeployment,
) {
  const normalizedChainId = Number(chainId);
  if (normalizedChainId === LOCAL_CHAIN_ID) return localDeployment;
  if (normalizedChainId === SEPOLIA_CHAIN_ID) return sepoliaDeployment;
  return {
    address: '',
    abi: [],
    chainId: normalizedChainId,
    deploymentBlock: 0,
  };
}

export function resolveContractAddress({ deployment, overrideAddress }) {
  const override = String(overrideAddress || '').trim();
  const candidate = override || deployment?.address || '';
  if (!ethers.isAddress(candidate) || candidate === ethers.ZeroAddress) return '';
  return ethers.getAddress(candidate);
}

export function deploymentMatchesContract({ address, chainId, deployment }) {
  return Boolean(
    address &&
    deployment?.address &&
    Number(chainId) === Number(deployment.chainId) &&
    address.toLowerCase() === deployment.address.toLowerCase(),
  );
}
