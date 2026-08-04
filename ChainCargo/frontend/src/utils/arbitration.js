export const DISPUTED_STATUS = 3;
export const RESOLVED_STATUS = 4;

export function buildAgreementIds(agreementCount) {
  const count = Number(agreementCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('The agreement count returned by the contract is invalid.');
  }
  return Array.from({ length: count }, (_, index) => BigInt(index));
}

export function isArbitrationAgreement(agreement) {
  const status = Number(agreement.status);
  return status === DISPUTED_STATUS || status === RESOLVED_STATUS;
}
