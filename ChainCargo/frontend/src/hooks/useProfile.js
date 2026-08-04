import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { ROLE_LABELS } from '../contracts/abi';
import { addressesEqual } from '../utils/address';

export function useProfile() {
  const { account, isConnected } = useWallet();
  const { getReadContract, isConfigured, refreshKey } = useContract();
  const [profile, setProfile] = useState(null);
  const [arbitratorAddress, setArbitratorAddress] = useState('');
  const [resolvedAccount, setResolvedAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!account || !isConnected || !isConfigured) {
      setProfile(null);
      setArbitratorAddress('');
      setResolvedAccount(null);
      return undefined;
    }

    async function loadProfile() {
      setLoading(true);
      setError('');
      try {
        const contract = await getReadContract();
        const [result, contractArbitrator] = await Promise.all([
          contract.getProfile(account),
          contract.arbitrator(),
        ]);
        if (!cancelled) {
          setProfile({
            account,
            name: result.name,
            role: Number(result.role),
            roleLabel: ROLE_LABELS[Number(result.role)],
            registeredAt: Number(result.registeredAt),
          });
          setArbitratorAddress(contractArbitrator);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) {
          setResolvedAccount(account);
          setLoading(false);
        }
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [account, getReadContract, isConfigured, isConnected, refreshKey]);

  const profileMatchesAccount =
    Boolean(profile?.account && account) &&
    profile.account.toLowerCase() === account.toLowerCase();
  const activeProfile = profileMatchesAccount ? profile : null;
  const isArbitrator = addressesEqual(account, arbitratorAddress);
  const isRegistered = Boolean(activeProfile?.role);
  const identityLoading = loading || (
    Boolean(account && isConnected && isConfigured) &&
    !addressesEqual(account, resolvedAccount)
  );

  return {
    profile: activeProfile,
    arbitratorAddress,
    loading: identityLoading,
    error,
    hasAppAccess: isRegistered || isArbitrator,
    isArbitrator,
    isRegistered,
    isShipper: !isArbitrator && activeProfile?.role === 1,
    isCarrier: !isArbitrator && activeProfile?.role === 2,
    roleLabel: isArbitrator ? 'Arbitrator' : activeProfile?.roleLabel || 'Unregistered',
  };
}
