export function getDisputePayout(remainingAmount, outcome) {
  const remaining = BigInt(remainingAmount);
  if (outcome === 'shipper') return { shipperAmount: remaining, carrierAmount: 0n };
  if (outcome === 'carrier') return { shipperAmount: 0n, carrierAmount: remaining };
  if (outcome === 'half') {
    const shipperAmount = remaining / 2n;
    return { shipperAmount, carrierAmount: remaining - shipperAmount };
  }
  throw new Error('Unknown dispute payout outcome.');
}
export const isValidDisputeText = (value) => value.trim().length > 0
  && new TextEncoder().encode(value.trim()).length <= 1000;
