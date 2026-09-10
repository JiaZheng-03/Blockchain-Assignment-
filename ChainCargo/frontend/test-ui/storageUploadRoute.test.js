import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { createStorageUploadHandler } from '../server.js';
import { createUploadAuthorizationMessage } from '../src/utils/evidenceStorage.js';

const contractAddress = '0x1000000000000000000000000000000000000001';

function createResponse() {
  return {
    headersSent: false,
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.headersSent = true;
      return this;
    },
  };
}

async function createRequest(wallet, overrides = {}) {
  const body = {
    account: wallet.address,
    agreementId: '7',
    contractAddress,
    fileName: 'delivery.pdf',
    fileSize: 512,
    mimeType: 'application/pdf',
    milestoneIndex: 1,
    nonce: ethers.hexlify(ethers.randomBytes(16)).slice(2),
    timestamp: Date.now(),
    ...overrides,
  };
  body.signature = await wallet.signMessage(createUploadAuthorizationMessage(body));
  return { body };
}

function createDependencies(wallet, { disputeActive = true } = {}) {
  const calls = [];
  let uploadUrlRequests = 0;
  const now = 2_000_000n;
  const escrow = {
    async getAgreement(agreementId) {
      calls.push(['getAgreement', agreementId]);
      return {
        carrier: wallet.address,
        status: 3n,
        nextMilestone: 0n,
        deadline: now + 200_000n,
      };
    },
    async getMilestoneDispute(agreementId, milestoneIndex) {
      calls.push(['getMilestoneDispute', agreementId, milestoneIndex]);
      return { active: disputeActive, milestoneIndex: 0n, openedAt: now - 100n };
    },
    async getMilestones(agreementId) {
      calls.push(['getMilestones', agreementId]);
      return [
        { state: 1n, dueAt: now + 50_000n },
        { state: 0n, dueAt: now + 100_000n },
      ];
    },
  };
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'cargoseal-evidence');
        return {
          async createSignedUploadUrl(objectPath, options) {
            uploadUrlRequests += 1;
            assert.equal(objectPath, '7/1/delivery.pdf');
            assert.deepEqual(options, { upsert: false });
            return { data: { signedUrl: 'https://upload.example/signed' }, error: null };
          },
        };
      },
    },
  };
  return {
    calls,
    dependencies: {
      supabase,
      escrow,
      provider: { getBlock: async () => ({ timestamp: Number(now) }) },
      contractAddress,
      chainId: 11155111,
      supabaseProjectRef: 'abcdefghijklmnopqrst',
      evidenceBucket: 'cargoseal-evidence',
      ensureEvidenceBucket: async () => {},
      contractSupportsSupabaseEvidence: async () => true,
      buildEvidenceObjectPath: () => '7/1/delivery.pdf',
    },
    getUploadUrlRequests: () => uploadUrlRequests,
  };
}

test('upload-url authorizes future-milestone evidence through the current dispute API', async () => {
  const wallet = ethers.Wallet.createRandom();
  const request = await createRequest(wallet);
  const response = createResponse();
  const context = createDependencies(wallet);

  await createStorageUploadHandler(context.dependencies)(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.signedUrl, 'https://upload.example/signed');
  assert.match(response.body.proofURI, /^supabase:\/\//);
  assert.deepEqual(
    context.calls.find(([name]) => name === 'getMilestoneDispute'),
    ['getMilestoneDispute', '7', 0],
  );
  assert.equal(context.getUploadUrlRequests(), 1);
});

test('upload-url rejects future evidence when the milestone dispute is not active', async () => {
  const wallet = ethers.Wallet.createRandom();
  const request = await createRequest(wallet);
  const response = createResponse();
  const context = createDependencies(wallet, { disputeActive: false });

  await createStorageUploadHandler(context.dependencies)(request, response);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, 'This milestone is not currently accepting evidence.');
  assert.equal(context.getUploadUrlRequests(), 0);
});
