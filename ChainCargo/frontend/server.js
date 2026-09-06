import 'dotenv/config';
import express from 'express';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESCROW_ABI } from './src/contracts/abi.js';
import { addressesEqual } from './src/utils/address.js';
import {
  EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_FILE_SIZE,
  SUPABASE_EVIDENCE_SCHEME,
  canSubmitEvidenceForWorkflow,
  createSupabaseProofUri,
  createUploadAuthorizationMessage,
  evidenceFileExtensionForMimeType,
  isValidSupabaseBucketName,
  normalizeSupabaseProjectUrl,
  supabaseProjectRefFromUrl,
  validateEvidenceFileMetadata,
} from './src/utils/evidenceStorage.js';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.CARGOSEAL_API_PORT || 3001);
const host = process.env.CARGOSEAL_HOST || '127.0.0.1';
const supabaseUrl = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
const supabaseProjectRef = supabaseProjectRefFromUrl(supabaseUrl);
const supabaseSecretKey = (
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)?.trim();
const evidenceBucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'cargoseal-evidence';
const chainId = Number(process.env.VITE_ESCROW_CHAIN_ID || 11155111);
const deploymentFile = chainId === 31337 ? 'deployment.local.json' : 'deployment.json';
const deployment = JSON.parse(
  fs.readFileSync(path.join(rootDirectory, 'src', 'contracts', deploymentFile), 'utf8'),
);
const savedContractAddress = Number(deployment.chainId) === chainId ? deployment.address : '';
const contractAddress = process.env.VITE_ESCROW_CONTRACT_ADDRESS?.trim() || savedContractAddress;
const rpcUrl = chainId === 31337
  ? process.env.LOCAL_RPC_URL?.trim() || 'http://127.0.0.1:8545'
  : process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com';
const hasSupabaseConfiguration = Boolean(
  supabaseUrl &&
  supabaseProjectRef &&
  supabaseSecretKey &&
  isValidSupabaseBucketName(evidenceBucket),
);
const supabase = hasSupabaseConfiguration
  ? createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    })
  : null;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const escrow = ethers.isAddress(contractAddress || '')
  ? new ethers.Contract(contractAddress, ESCROW_ABI, provider)
  : null;
const usedAuthorizations = new Map();
const uploadAttempts = new Map();
let bucketReadyPromise = null;

function removeExpiredEntries() {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, timestamp] of usedAuthorizations) {
    if (timestamp < cutoff) usedAuthorizations.delete(key);
  }
  for (const [key, timestamps] of uploadAttempts) {
    const recent = timestamps.filter((timestamp) => timestamp >= Date.now() - 60_000);
    if (recent.length) uploadAttempts.set(key, recent);
    else uploadAttempts.delete(key);
  }
}

function recordUploadAttempt(account) {
  const key = account.toLowerCase();
  const recent = (uploadAttempts.get(key) || [])
    .filter((timestamp) => timestamp >= Date.now() - 60_000);
  if (recent.length >= 5) return false;
  recent.push(Date.now());
  uploadAttempts.set(key, recent);
  return true;
}

function sendError(response, status, error) {
  return response.status(status).json({ error });
}

function isRpcUnavailable(error) {
  return [
    'NETWORK_ERROR',
    'SERVER_ERROR',
    'TIMEOUT',
    'UNKNOWN_ERROR',
  ].includes(error?.code) || /network|connect|timeout|socket|fetch failed/i.test(error?.message || '');
}

function isMissingBucketError(error) {
  return Number(error?.statusCode || error?.status) === 404 ||
    /not found|does not exist/i.test(error?.message || '');
}

async function configureEvidenceBucket() {
  const options = {
    public: true,
    allowedMimeTypes: EVIDENCE_MIME_TYPES,
    fileSizeLimit: MAX_EVIDENCE_FILE_SIZE,
  };
  const { error: lookupError } = await supabase.storage.getBucket(evidenceBucket);
  if (lookupError && !isMissingBucketError(lookupError)) throw lookupError;

  const operation = lookupError
    ? supabase.storage.createBucket(evidenceBucket, options)
    : supabase.storage.updateBucket(evidenceBucket, options);
  const { error } = await operation;
  if (error) throw error;
}

function ensureEvidenceBucket() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = configureEvidenceBucket().catch((error) => {
      bucketReadyPromise = null;
      throw error;
    });
  }
  return bucketReadyPromise;
}

async function contractSupportsSupabaseEvidence() {
  if (!escrow) return false;
  const [scheme, version] = await Promise.all([
    escrow.EVIDENCE_URI_SCHEME(),
    escrow.CONTRACT_VERSION(),
  ]);
  return scheme === SUPABASE_EVIDENCE_SCHEME && Number(version) >= 2;
}

function buildEvidenceObjectPath({ agreementId, mimeType, milestoneIndex, nonce }) {
  const extension = evidenceFileExtensionForMimeType(mimeType);
  return [
    String(chainId),
    contractAddress.toLowerCase(),
    String(agreementId),
    String(milestoneIndex),
    `${nonce}${extension}`,
  ].join('/');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/api/storage/config', async (_request, response) => {
  let contractSupported = false;
  let contractCheckError = null;
  if (supabase && escrow) {
    try {
      contractSupported = await contractSupportsSupabaseEvidence();
    } catch (error) {
      contractCheckError = error;
    }
  }

  let message = '';
  if (!supabase) {
    message = 'Add a valid SUPABASE_URL, SUPABASE_SECRET_KEY, and bucket name to .env.';
  } else if (!escrow) {
    message = `No escrow contract is configured for chain ${chainId}.`;
  } else if (contractCheckError && isRpcUnavailable(contractCheckError)) {
    message = 'The Sepolia RPC is unavailable. Check SEPOLIA_RPC_URL and try again.';
  } else if (!contractSupported) {
    message = 'Redeploy LogisticsEscrow before using Supabase evidence storage.';
  }
  response.json({
    configured: Boolean(supabase && escrow && contractSupported),
    contractAddress,
    chainId,
    message,
  });
});

app.post('/api/storage/upload-url', async (request, response) => {
  if (!supabase) {
    return sendError(
      response,
      503,
      'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env.',
    );
  }
  if (!escrow) {
    return sendError(response, 503, `No escrow contract is configured for chain ${chainId}.`);
  }
  try {
    if (!await contractSupportsSupabaseEvidence()) {
      return sendError(response, 409, 'Redeploy LogisticsEscrow before uploading Supabase evidence.');
    }
  } catch (error) {
    if (isRpcUnavailable(error)) {
      return sendError(response, 503, 'The blockchain RPC is temporarily unavailable.');
    }
    return sendError(response, 409, 'The configured contract does not support Supabase evidence.');
  }

  removeExpiredEntries();
  const {
    account,
    agreementId,
    contractAddress: requestedContract,
    fileName,
    fileSize,
    mimeType,
    milestoneIndex,
    nonce,
    signature,
    timestamp,
  } = request.body || {};

  try {
    validateEvidenceFileMetadata({ name: fileName, size: fileSize, type: mimeType });
  } catch (error) {
    return sendError(response, 422, error.message);
  }
  if (!ethers.isAddress(account) || !addressesEqual(requestedContract, contractAddress)) {
    return sendError(response, 400, 'The upload account or contract address is invalid.');
  }
  if (!/^\d+$/.test(String(agreementId)) || !Number.isSafeInteger(milestoneIndex) || milestoneIndex < 0) {
    return sendError(response, 400, 'The agreement or milestone identifier is invalid.');
  }
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 2 * 60_000) {
    return sendError(response, 401, 'The upload authorization has expired.');
  }
  if (!/^[a-fA-F0-9-]{16,64}$/.test(nonce || '') || typeof signature !== 'string') {
    return sendError(response, 401, 'The upload authorization is invalid.');
  }

  const message = createUploadAuthorizationMessage({
    account,
    agreementId: String(agreementId),
    contractAddress: requestedContract,
    fileName,
    fileSize,
    mimeType,
    milestoneIndex,
    nonce,
    timestamp,
  });
  let recoveredAddress;
  try {
    recoveredAddress = ethers.verifyMessage(message, signature);
  } catch {
    return sendError(response, 401, 'The upload authorization signature is invalid.');
  }
  if (!addressesEqual(recoveredAddress, account)) {
    return sendError(response, 401, 'MetaMask did not authorize this upload.');
  }

  const authorizationId = ethers.keccak256(ethers.toUtf8Bytes(signature));
  if (usedAuthorizations.has(authorizationId)) {
    return sendError(response, 409, 'This upload authorization has already been used.');
  }

  // Reserve before any await so concurrent requests cannot pass the replay check together.
  usedAuthorizations.set(authorizationId, Date.now());
  let signedUrlIssued = false;
  try {
    if (!recordUploadAttempt(account)) {
      return sendError(response, 429, 'Too many upload attempts. Wait one minute and try again.');
    }

    let agreement;
    let currentMilestone;
    let dispute = null;
    let latestBlock;
    try {
      agreement = await escrow.getAgreement(agreementId);
      if (!addressesEqual(agreement.carrier, account)) {
        return sendError(response, 403, 'Only the assigned Carrier can upload this evidence.');
      }
      dispute = Number(agreement.status) === 3
        ? await escrow.getDisputeRequest(agreementId)
        : null;
      if (!canSubmitEvidenceForWorkflow({
        agreementStatus: agreement.status,
        disputeActive: dispute?.active,
        disputedMilestoneIndex: dispute?.milestoneIndex,
        milestoneIndex,
      })) {
        return sendError(response, 409, 'This milestone is not currently accepting evidence.');
      }
      const milestones = await escrow.getMilestones(agreementId);
      currentMilestone = milestones[milestoneIndex];
      if (!currentMilestone || Number(currentMilestone.state) !== 0) {
        return sendError(response, 409, 'The selected milestone is not pending evidence.');
      }
      latestBlock = await provider.getBlock('latest');
      if (!latestBlock) throw new Error('Latest blockchain block was unavailable.');
    } catch (error) {
      if (response.headersSent) return undefined;
      if (isRpcUnavailable(error)) {
        return sendError(response, 503, 'The blockchain RPC is temporarily unavailable.');
      }
      return sendError(response, 409, 'The agreement could not be verified on the configured contract.');
    }

    const blockTimestamp = BigInt(latestBlock.timestamp);
    const disputePausedSeconds = Number(agreement.status) === 3
      ? blockTimestamp - BigInt(dispute.openedAt)
      : 0n;
    if (blockTimestamp > currentMilestone.dueAt + disputePausedSeconds) {
      return sendError(response, 409, 'The selected milestone deadline has passed on-chain.');
    }
    if (blockTimestamp > agreement.deadline + disputePausedSeconds) {
      return sendError(response, 409, 'The final agreement deadline has passed on-chain.');
    }

    let signedUrl;
    let proofURI;
    try {
      await ensureEvidenceBucket();
      const objectPath = buildEvidenceObjectPath({
        agreementId,
        mimeType,
        milestoneIndex,
        nonce,
      });
      proofURI = createSupabaseProofUri({
        bucket: evidenceBucket,
        objectPath,
        projectRef: supabaseProjectRef,
      });
      const { data, error } = await supabase.storage
        .from(evidenceBucket)
        .createSignedUploadUrl(objectPath, { upsert: false });
      if (error || !data?.signedUrl) throw error || new Error('Missing signed upload URL.');
      signedUrl = data.signedUrl;
    } catch {
      return sendError(response, 502, 'Supabase is temporarily unable to authorize the upload.');
    }
    signedUrlIssued = true;
    return response.json({ proofURI, signedUrl });
  } catch {
    return sendError(response, 500, 'The upload authorization could not be processed.');
  } finally {
    if (!signedUrlIssued) usedAuthorizations.delete(authorizationId);
  }
});

const distDirectory = path.join(rootDirectory, 'dist');
app.use(express.static(distDirectory));
app.use((request, response, next) => {
  if (request.method === 'GET' && request.accepts('html') && fs.existsSync(path.join(distDirectory, 'index.html'))) {
    return response.sendFile(path.join(distDirectory, 'index.html'));
  }
  return next();
});

app.listen(port, host, () => {
  const status = supabase ? 'configured' : 'missing or invalid Supabase settings';
  console.log(`CargoSeal API listening at http://${host}:${port} (Supabase ${status})`);
});
