# ChainCargo Copilot Instructions

## Current architecture

ChainCargo is a university logistics escrow dApp. Preserve the current stack and extend it in place:

- Solidity 0.8.24 and Hardhat
- React, Vite, JavaScript, and React Router
- ethers v6 and MetaMask
- Express for protected Pinata upload authorization
- Pinata/IPFS for public evidence files
- Sepolia as the submitted/default network; Hardhat chain 31337 for local development

`ChainCargo/frontend` is the application root. `contracts/LogisticsEscrow.sol` is one multi-agreement escrow contract; the project does not deploy an `Escrow.sol` instance per agreement and has no `EscrowFactory.sol`.

## Roles and agreement flow

- A wallet registers on-chain as a Shipper or Carrier.
- A Shipper selects an already-registered Carrier, creates an agreement, defines ordered milestones, and deposits ETH equal to all milestone payouts.
- The Carrier assigned by the Shipper submits evidence for the current milestone before its deadline.
- The Shipper verifies the evidence bytes and approves the milestone, releasing its exact payout.
- Each successful Shipper approval awards the Carrier exactly 10 on-chain reputation points.
- A current milestone left `Pending` after its deadline enables a deterministic refund of all remaining escrow to the Shipper.
- Either participant may dispute an active agreement unless a pending-milestone refund is already eligible. The deployment arbitrator resolves the remaining escrow split.
- Contract events drive the History and dispute-detail views.

An older design document described a separate Carrier acceptance step. The current implementation intentionally has the Shipper assign the Carrier directly. Do not add Carrier acceptance unless the official assignment requirements explicitly require it.

## Evidence security invariant

Never remove or weaken this workflow:

1. The Carrier selects a JPEG, PNG, WebP, or PDF (maximum 10 MB).
2. The frontend computes `keccak256` over the exact file bytes.
3. The Express endpoint validates a signed MetaMask upload authorization and current blockchain state before requesting a short-lived Pinata signed URL.
4. Pinata returns a CID and the contract stores the hash plus `ipfs://CID`.
5. The Shipper downloads the file through the configured trusted IPFS gateway and hashes the downloaded bytes.
6. Approval stays disabled unless the downloaded hash equals the on-chain `proofHash`.

Do not hash files on-chain. Do not automatically fetch arbitrary HTTP(S) proof locations supplied from contract data.

## Contract invariants

- Keep `REPUTATION_POINTS_PER_MILESTONE = 10`.
- Reputation tiers are: 0 New, 10+ Emerging, 50+ Established, 100+ Trusted, and 250+ Elite.
- Proof submission, file verification, refunds, and dispute resolution award no reputation.
- Only one approval is possible for a milestone.
- Milestones execute sequentially and their payouts must exactly equal funded escrow.
- Timely `Submitted` evidence remains approvable or disputable after its due date; it is not refundable merely because time passes.
- An already-eligible missed-`Pending`-milestone refund cannot be blocked by opening a new dispute.
- Use checks-effects-interactions and retain reentrancy protection around ETH transfers.
- Keep user-controlled on-chain strings bounded.

## Deployment configuration

- `src/contracts/deployment.json` is Sepolia metadata and is the default submitted deployment.
- `src/contracts/deployment.local.json` is only for chain 31337.
- `npm run deploy:local` must never overwrite Sepolia metadata.
- The frontend and Express server select the deployment for `VITE_ESCROW_CHAIN_ID` and use the same override address when one is deliberately configured.
- Local compilation/tests must not require `DEPLOYER_PRIVATE_KEY`.
- Never deploy to Sepolia automatically and never create a fake Sepolia address.
- Any Solidity change requires a new deliberate Sepolia deployment before the live address contains that change.

## Security and secrets

- Never commit `.env`, `PINATA_JWT`, RPC credentials, deployer keys, seed phrases, or wallet secrets.
- Pinata credentials remain server-only and must not use a `VITE_` prefix.
- Do not expose credentials, internal stack traces, or raw upstream errors in API responses.
- Use blockchain block timestamps for upload/refund eligibility; browser time is only for countdown display.
- Keep signed-upload replay protection and per-wallet upload rate limiting.

## Engineering conventions

- Inspect existing code and tests before modifying behavior.
- Use React functional components and hooks, ethers v6 APIs, ES modules in frontend/server code, and CommonJS only in the existing Hardhat scripts/tests.
- Prefer small testable utilities for receipt parsing, deployment selection, validation, and event decoding.
- Do not disable ESLint rules or delete tests to conceal failures.
- Run `npm run compile`, `npm run test:contracts`, `npm run test:ui`, `npm run lint`, `npm run build`, and `npm run check` before delivery.
- Preserve the existing framework and folder layout unless a narrowly scoped change is necessary.
