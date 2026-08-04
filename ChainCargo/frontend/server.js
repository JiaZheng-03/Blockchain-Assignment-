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
const deployment = JSON.parse(
  fs.readFileSync(path.join(rootDirectory, 'src', 'contracts', 'deployment.json'), 'utf8'),
);
const port = Number(process.env.PINATA_API_PORT || 3001);
const host = process.env.CHAINCARGO_HOST || '127.0.0.1';
const pinataJwt = process.env.PINATA_JWT?.trim();
const gatewayBaseUrl = normalizeGatewayBaseUrl(process.env.PINATA_GATEWAY);
const gatewayHost = new URL(gatewayBaseUrl).host;
const contractAddress = process.env.VITE_ESCROW_CONTRACT_ADDRESS?.trim() || deployment.address;
const rpcUrl = process.env.SEPOLIA_RPC_URL?.trim() || 'https://ethereum-sepolia-rpc.publicnode.com';
const pinata = pinataJwt
  ? new PinataSDK({ pinataJwt, pinataGateway: gatewayHost })
  : null;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const escrow = new ethers.Contract(contractAddress, ESCROW_ABI, provider);
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
  try {
    if (!pinata) {
      return response.status(503).json({
        error: 'Pinata is not configured. Add PINATA_JWT and PINATA_GATEWAY to .env.',
      });
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
    validateEvidenceFileMetadata({ name: fileName, size: fileSize, type: mimeType });
    if (!ethers.isAddress(account) || !addressesEqual(requestedContract, contractAddress)) {
      return response.status(400).json({ error: 'The upload account or contract address is invalid.' });
    }
    if (!/^\d+$/.test(String(agreementId)) || !Number.isSafeInteger(milestoneIndex) || milestoneIndex < 0) {
      return response.status(400).json({ error: 'The agreement or milestone identifier is invalid.' });
    }
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 2 * 60_000) {
      return response.status(401).json({ error: 'The upload authorization has expired.' });
    }
    if (!/^[a-fA-F0-9-]{16,64}$/.test(nonce || '') || typeof signature !== 'string') {
      return response.status(401).json({ error: 'The upload authorization is invalid.' });
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
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (!addressesEqual(recoveredAddress, account)) {
      return response.status(401).json({ error: 'MetaMask did not authorize this upload.' });
    }
    const authorizationId = ethers.keccak256(ethers.toUtf8Bytes(signature));
    if (usedAuthorizations.has(authorizationId)) {
      return response.status(409).json({ error: 'This upload authorization has already been used.' });
    }
    if (!recordUploadAttempt(account)) {
      return response.status(429).json({ error: 'Too many upload attempts. Wait one minute and try again.' });
    }

    const agreement = await escrow.getAgreement(agreementId);
    if (!addressesEqual(agreement.carrier, account)) {
      return response.status(403).json({ error: 'Only the assigned Carrier can upload this evidence.' });
    }
    if (Number(agreement.status) !== 0 || Number(agreement.nextMilestone) !== milestoneIndex) {
      return response.status(409).json({ error: 'This milestone is not currently accepting evidence.' });
    }

    const signedUrl = await pinata.upload.public.createSignedURL({
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
    usedAuthorizations.set(authorizationId, Date.now());
    return response.json({ gatewayBaseUrl, signedUrl });
  } catch (error) {
    const message = error?.shortMessage || error?.message || 'Unable to authorize the Pinata upload.';
    return response.status(502).json({ error: message });
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
