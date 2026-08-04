import { useEffect, useState } from 'react';
import { useContract } from '../context/ContractContext';
import { getCarrierReputationTier, readCarrierReputation } from '../utils/carrierReputation';

export function useCarrierReputation(carrierAddress) {
  const { getReadContract, isConfigured, refreshKey } = useContract();
  const [points, setPoints] = useState(null);
  const [supported, setSupported] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!carrierAddress || !isConfigured) {
      setPoints(null);
      setSupported(null);
      return undefined;
    }

    async function loadReputation() {
      try {
        setLoading(true);
        setError('');
        const contract = await getReadContract();
        const result = await readCarrierReputation(contract, carrierAddress);
        if (!cancelled) {
          setPoints(result);
          setSupported(result !== null);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReputation();
    return () => {
      cancelled = true;
    };
  }, [carrierAddress, getReadContract, isConfigured, refreshKey]);

  return {
    points,
    pointsLabel: points === null ? 'Unavailable' : points.toString(),
    tier: points === null ? 'Redeploy required' : getCarrierReputationTier(points),
    supported,
    loading,
    error,
  };
}
