export const REPUTATION_POINTS_PER_MILESTONE = 10n;

export function getCarrierReputationTier(points) {
  const value = BigInt(points || 0);
  if (value >= 250n) return 'Elite carrier';
  if (value >= 100n) return 'Trusted carrier';
  if (value >= 50n) return 'Established carrier';
  if (value >= 10n) return 'Emerging carrier';
  return 'New carrier';
}

export async function readCarrierReputation(contract, carrierAddress) {
  try {
    return await contract.carrierReputation(carrierAddress);
  } catch (error) {
    const unsupported = error?.code === 'BAD_DATA'
      || error?.code === 'CALL_EXCEPTION'
      || /could not decode|no data present/i.test(error?.message || '');
    if (unsupported) return null;
    throw error;
  }
}
