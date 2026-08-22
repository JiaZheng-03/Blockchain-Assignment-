import { ethers } from 'ethers';

export const MAX_EVIDENCE_FILE_SIZE = 10 * 1024 * 1024;
export const EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
export const EVIDENCE_FILE_ACCEPT = EVIDENCE_MIME_TYPES.join(',');

export function validateEvidenceFileMetadata({ name, size, type }) {
  if (!name || !Number.isInteger(size) || size <= 0) {
    throw new Error('Select a non-empty receipt, photo, or PDF document.');
  }
  if (size > MAX_EVIDENCE_FILE_SIZE) {
    throw new Error('Evidence files must be 10 MB or smaller.');
  }
  if (!EVIDENCE_MIME_TYPES.includes(type)) {
    throw new Error('Evidence must be a JPEG, PNG, WebP, or PDF file.');
  }
}

export function createUploadAuthorizationMessage({
  account,
  agreementId,
  contractAddress,
  fileName,
  fileSize,
  mimeType,
  milestoneIndex,
  nonce,
  timestamp,
}) {
  return [
    'ChainCargo evidence upload',
    `Contract: ${contractAddress}`,
    `Agreement: ${agreementId}`,
    `Milestone: ${milestoneIndex}`,
    `Account: ${account}`,
    `File: ${fileName}`,
    `Size: ${fileSize}`,
    `Type: ${mimeType}`,
    `Timestamp: ${timestamp}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

export function normalizeGatewayBaseUrl(gateway) {
  const value = String(gateway || '').trim();
  if (!value) return 'https://gateway.pinata.cloud';
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, '').replace(/\/ipfs$/i, '');
}

export function isValidIpfsCid(cid) {
  const value = String(cid || '').trim();
  const cidV0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
  const cidV1Base32 = /^b[a-z2-7]{20,127}$/;
  const cidV1Base58 = /^z[1-9A-HJ-NP-Za-km-z]{20,127}$/;
  return cidV0.test(value) || cidV1Base32.test(value) || cidV1Base58.test(value);
}

export function ipfsUriToCid(uri) {
  const value = String(uri || '').trim();
  if (!value.startsWith('ipfs://')) return '';
  const cid = value.slice(7);
  return isValidIpfsCid(cid) ? cid : '';
}

export function getEvidenceGatewayUrl(uri, gateway) {
  const cid = ipfsUriToCid(uri);
  if (cid) return `${normalizeGatewayBaseUrl(gateway)}/ipfs/${cid}`;
  return '';
}

export function hashEvidenceBytes(bytes) {
  const normalized = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return ethers.keccak256(normalized);
}

export async function hashEvidenceFile(file) {
  return hashEvidenceBytes(await file.arrayBuffer());
}

export function evidenceHashMatches(actualHash, expectedHash) {
  return Boolean(actualHash && expectedHash) &&
    actualHash.toLowerCase() === expectedHash.toLowerCase();
}

async function readError(response, fallback) {
  try {
    const payload = await response.json();
    return payload.error || payload.message || fallback;
  } catch {
    return fallback;
  }
}

export async function uploadEvidenceToPinata({
  account,
  agreementId,
  contractAddress,
  file,
  milestoneIndex,
  signMessage,
}) {
  validateEvidenceFileMetadata(file);
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const authorization = {
    account,
    agreementId: String(agreementId),
    contractAddress,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    milestoneIndex,
    nonce,
    timestamp,
  };
  const message = createUploadAuthorizationMessage(authorization);
  const [proofHash, signature] = await Promise.all([
    hashEvidenceFile(file),
    signMessage(message),
  ]);

  const signedUrlResponse = await fetch('/api/pinata/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...authorization, signature }),
  });
  if (!signedUrlResponse.ok) {
    throw new Error(await readError(signedUrlResponse, 'Unable to authorize the evidence upload.'));
  }
  const { gatewayBaseUrl, signedUrl } = await signedUrlResponse.json();
  if (!signedUrl) throw new Error('The Pinata API did not return a signed upload URL.');

  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('network', 'public');
  formData.append('name', file.name);
  const uploadResponse = await fetch(signedUrl, {
    method: 'POST',
    body: formData,
  });
  if (!uploadResponse.ok) {
    throw new Error(await readError(uploadResponse, 'Pinata could not upload the evidence file.'));
  }
  const payload = await uploadResponse.json();
  const upload = payload.data || payload;
  if (!isValidIpfsCid(upload?.cid)) {
    throw new Error('Pinata uploaded the file without returning a valid IPFS CID.');
  }

  const proofURI = `ipfs://${upload.cid}`;
  return {
    cid: upload.cid,
    fileName: file.name,
    gatewayUrl: getEvidenceGatewayUrl(proofURI, gatewayBaseUrl),
    proofHash,
    proofURI,
  };
}

export async function verifyEvidenceFromGateway({ expectedHash, gatewayUrl }) {
  if (!gatewayUrl) {
    throw new Error(
      'This evidence is not a valid ChainCargo IPFS URI. Legacy or external URLs cannot be verified automatically.',
    );
  }
  const response = await fetch(gatewayUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('The evidence file could not be downloaded from IPFS.');
  const actualHash = hashEvidenceBytes(await response.arrayBuffer());
  return {
    actualHash,
    matches: evidenceHashMatches(actualHash, expectedHash),
  };
}
