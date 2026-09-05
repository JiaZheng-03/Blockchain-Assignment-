import { ethers } from 'ethers';

export const MAX_EVIDENCE_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_EVIDENCE_PROOF_URI_LENGTH = 200;
export const EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
export const EVIDENCE_FILE_ACCEPT = `${EVIDENCE_MIME_TYPES.join(',')},.jpg,.jpeg,.png,.webp,.pdf`;
export const SUPABASE_EVIDENCE_SCHEME = 'supabase://';

const MIME_TYPE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const FILE_EXTENSION_MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export function normalizeEvidenceMimeType({ name, type }) {
  if (type === 'image/jpg') return 'image/jpeg';
  if (EVIDENCE_MIME_TYPES.includes(type)) return type;
  if (type && type !== 'application/octet-stream') return type;
  const extension = String(name || '').split('.').pop()?.toLowerCase();
  return FILE_EXTENSION_MIME_TYPES[extension] || type || '';
}

export function validateEvidenceFileMetadata({ name, size, type }) {
  if (!name || !Number.isInteger(size) || size <= 0) {
    throw new Error('Select a non-empty receipt, photo, or PDF document.');
  }
  if (size > MAX_EVIDENCE_FILE_SIZE) {
    throw new Error('Evidence files must be 10 MB or smaller.');
  }
  if (!EVIDENCE_MIME_TYPES.includes(normalizeEvidenceMimeType({ name, type }))) {
    throw new Error('Evidence must be a JPEG, PNG, WebP, or PDF file.');
  }
}

export function evidenceFileExtensionForMimeType(mimeType) {
  return MIME_TYPE_EXTENSIONS[mimeType] || '';
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

export function normalizeSupabaseProjectUrl(projectUrl) {
  return String(projectUrl || '').trim().replace(/\/+$/, '');
}

export function supabaseProjectRefFromUrl(projectUrl) {
  const normalized = normalizeSupabaseProjectUrl(projectUrl);
  const match = /^https:\/\/([a-z0-9]{6,40})\.supabase\.co$/i.exec(normalized);
  return match ? match[1].toLowerCase() : '';
}

export function isValidSupabaseBucketName(bucket) {
  return /^[a-z0-9][a-z0-9._-]{0,62}$/i.test(String(bucket || ''));
}

function isValidObjectPath(objectPath) {
  const value = String(objectPath || '');
  if (!value || value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false;
  const segments = value.split('/');
  return segments.every((segment) => (
    segment !== '.' &&
    segment !== '..' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)
  ));
}

export function parseSupabaseProofUri(uri) {
  const value = String(uri || '').trim();
  if (!value.startsWith(SUPABASE_EVIDENCE_SCHEME) || value.length > MAX_EVIDENCE_PROOF_URI_LENGTH) {
    return null;
  }
  const parts = value.slice(SUPABASE_EVIDENCE_SCHEME.length).split('/');
  const projectRef = parts.shift()?.toLowerCase() || '';
  const bucket = parts.shift() || '';
  const objectPath = parts.join('/');
  if (!/^[a-z0-9]{6,40}$/.test(projectRef)) return null;
  if (!isValidSupabaseBucketName(bucket) || !isValidObjectPath(objectPath)) return null;
  return { bucket, objectPath, projectRef };
}

export function createSupabaseProofUri({ bucket, objectPath, projectRef }) {
  const proofURI = `${SUPABASE_EVIDENCE_SCHEME}${projectRef}/${bucket}/${objectPath}`;
  const parsed = parseSupabaseProofUri(proofURI);
  if (!parsed) {
    throw new Error('The Supabase evidence location is invalid or too long for the contract.');
  }
  return proofURI;
}

export function getSupabaseEvidenceUrl(uri) {
  const parsed = parseSupabaseProofUri(uri);
  if (!parsed) return '';
  const encodedBucket = encodeURIComponent(parsed.bucket);
  const encodedPath = parsed.objectPath.split('/').map(encodeURIComponent).join('/');
  return `https://${parsed.projectRef}.supabase.co/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
}

export function getEvidencePublicUrl(uri) {
  return getSupabaseEvidenceUrl(uri);
}

export function getEvidenceStorageLabel(uri) {
  if (parseSupabaseProofUri(uri)) return 'Supabase Storage';
  return 'unknown storage';
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

export async function uploadEvidenceToSupabase({
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
  const mimeType = normalizeEvidenceMimeType(file);
  const authorization = {
    account,
    agreementId: String(agreementId),
    contractAddress,
    fileName: file.name,
    fileSize: file.size,
    mimeType,
    milestoneIndex,
    nonce,
    timestamp,
  };
  const message = createUploadAuthorizationMessage(authorization);
  const [proofHash, signature] = await Promise.all([
    hashEvidenceFile(file),
    signMessage(message),
  ]);

  const signedUrlResponse = await fetch('/api/storage/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...authorization, signature }),
  });
  if (!signedUrlResponse.ok) {
    throw new Error(await readError(signedUrlResponse, 'Unable to authorize the evidence upload.'));
  }
  const { proofURI, signedUrl } = await signedUrlResponse.json();
  if (!signedUrl || !parseSupabaseProofUri(proofURI)) {
    throw new Error('The storage API returned an invalid Supabase upload location.');
  }

  const formData = new FormData();
  formData.append('cacheControl', '3600');
  const uploadFile = file.type === mimeType
    ? file
    : new File([file], file.name, { type: mimeType });
  formData.append('', uploadFile, file.name);
  const uploadResponse = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'x-upsert': 'false' },
    body: formData,
  });
  if (!uploadResponse.ok) {
    throw new Error(await readError(uploadResponse, 'Supabase could not upload the evidence file.'));
  }

  return {
    fileName: file.name,
    publicUrl: getSupabaseEvidenceUrl(proofURI),
    proofHash,
    proofURI,
  };
}

export async function verifyEvidenceFromStorage({ expectedHash, evidenceUrl }) {
  if (!evidenceUrl) {
    throw new Error(
      'This evidence is not a valid ChainCargo Supabase reference and cannot be verified automatically.',
    );
  }
  const response = await fetch(evidenceUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('The evidence file could not be downloaded from storage.');
  const actualHash = hashEvidenceBytes(await response.arrayBuffer());
  return {
    actualHash,
    matches: evidenceHashMatches(actualHash, expectedHash),
  };
}
