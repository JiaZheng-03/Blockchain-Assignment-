import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { ROLE_LABELS } from '../contracts/abi';

export function useProfile() {
  const { account, isConnected } = useWallet();
  const { getReadContract, isConfigured, refreshKey } = useContract();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!account || !isConnected || !isConfigured) {
      setProfile(null);
      return undefined;
    }

    async function loadProfile() {
      setLoading(true);
      setError('');
      try {
        const contract = await getReadContract();
        const result = await contract.getProfile(account);
        if (!cancelled) {
          setProfile({
            account,
            name: result.name,
            role: Number(result.role),
            roleLabel: ROLE_LABELS[Number(result.role)],
            registeredAt: Number(result.registeredAt),
          });
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
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

  return {
    profile: activeProfile,
    loading,
    error,
    isRegistered: Boolean(activeProfile?.role),
    isShipper: activeProfile?.role === 1,
    isCarrier: activeProfile?.role === 2,
  };
}
