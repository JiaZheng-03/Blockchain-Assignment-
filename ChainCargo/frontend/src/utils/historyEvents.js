export function decodeEscrowEvent(contractInterface, log) {
  if (!log?.topics || typeof log?.data !== 'string') return null;
  try {
    return contractInterface.parseLog({
      topics: log.topics,
      data: log.data,
    });
  } catch {
    return null;
  }
}
