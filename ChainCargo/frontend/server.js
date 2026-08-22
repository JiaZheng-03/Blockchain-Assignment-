import 'dotenv/config';
import express from 'express';
import { ethers } from 'ethers';
import { PinataSDK } from 'pinata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESCROW_ABI } from './src/contracts/abi.js';
import { addressesEqual } from './src/utils/address.js';
import {
  createUploadAuthorizationMessage,
  normalizeGatewayBaseUrl,
  validateEvidenceFileMetadata,
} from './src/utils/pinataEvidence.js';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PINATA_API_PORT || 3001);
const host = process.env.CHAINCARGO_HOST || '127.0.0.1';
const pinataJwt = process.env.PINATA_JWT?.trim();
const gatewayBaseUrl = normalizeGatewayBaseUrl(process.env.PINATA_GATEWAY);
const gatewayHost = new URL(gatewayBaseUrl).host;
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
const pinata = pinataJwt
  ? new PinataSDK({ pinataJwt, pinataGateway: gatewayHost })
  : null;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const escrow = ethers.isAddress(contractAddress || '')
  ? new ethers.Contract(contractAddress, ESCROW_ABI, provider)
  : null;
const usedAuthorizations = new Map();
const uploadAttempts = new Map();

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

function safeFileName(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160);
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

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/api/pinata/config', (_request, response) => {
  response.json({
    configured: Boolean(pinata),
    gatewayBaseUrl,
  });
});

app.post('/api/pinata/upload-url', async (request, response) => {
  if (!pinata) {
    return sendError(
      response,
      503,
      'Pinata is not configured. Add PINATA_JWT and PINATA_GATEWAY to .env.',
    );
  }
  if (!escrow) {
    return sendError(response, 503, `No escrow contract is configured for chain ${chainId}.`);
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
    let latestBlock;
    try {
      agreement = await escrow.getAgreement(agreementId);
      if (!addressesEqual(agreement.carrier, account)) {
        return sendError(response, 403, 'Only the assigned Carrier can upload this evidence.');
      }
      if (Number(agreement.status) !== 0 || Number(agreement.nextMilestone) !== milestoneIndex) {
        return sendError(response, 409, 'This milestone is not currently accepting evidence.');
      }
      const milestones = await escrow.getMilestones(agreementId);
      currentMilestone = milestones[milestoneIndex];
      if (!currentMilestone || Number(currentMilestone.state) !== 0) {
        return sendError(response, 409, 'The current milestone is not pending evidence.');
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
    if (blockTimestamp > currentMilestone.dueAt) {
      return sendError(response, 409, 'The current milestone deadline has passed on-chain.');
    }
    if (blockTimestamp > agreement.deadline) {
      return sendError(response, 409, 'The final agreement deadline has passed on-chain.');
    }

    let signedUrl;
    try {
      signedUrl = await pinata.upload.public.createSignedURL({
        expires: 60,
        keyvalues: {
          agreementId: String(agreementId),
          carrier: ethers.getAddress(account),
          contract: contractAddress,
          milestoneIndex: String(milestoneIndex),
        },
        maxFileSize: fileSize,
        mimeTypes: [mimeType],
        name: safeFileName(fileName),
      });
    } catch {
      return sendError(response, 502, 'Pinata is temporarily unable to authorize the upload.');
    }
    signedUrlIssued = true;
    return response.json({ gatewayBaseUrl, signedUrl });
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
  const status = pinata ? 'configured' : 'missing PINATA_JWT';
  console.log(`ChainCargo API listening at http://${host}:${port} (Pinata ${status})`);
});
