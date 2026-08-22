import { addressesEqual } from './address.js';

export function findAgreementCreatedId(receipt, contractInterface, contractAddress) {
  if (!receipt?.logs || !contractInterface || !contractAddress) return null;
  for (const log of receipt.logs) {
    if (!addressesEqual(log?.address, contractAddress)) continue;
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === 'AgreementCreated' && parsed.args?.agreementId !== undefined) {
        return parsed.args.agreementId;
      }
    } catch {
      // Ignore unrelated logs from the same transaction.
    }
  }
  return null;
}
