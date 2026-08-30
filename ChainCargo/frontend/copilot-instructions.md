# ChainCargo Copilot Instructions

## Current architecture

ChainCargo is a university logistics escrow dApp. Preserve the current stack and extend it in place:

- Solidity 0.8.24 and Hardhat
- React, Vite, JavaScript, and React Router
- ethers v6 and MetaMask
- Express for protected Supabase upload authorization
- Supabase Storage for public evidence files
- Sepolia as the submitted/default network; Hardhat chain 31337 for local development

`ChainCargo/frontend` is the application root. `contracts/LogisticsEscrow.sol` is one multi-agreement escrow contract; the project does not deploy an `Escrow.sol` instance per agreement and has no `EscrowFactory.sol`.

## Roles and agreement flow

- A wallet registers on-chain as a Shipper or Carrier.
- A Shipper selects an already-registered Carrier, creates a uniquely named agreement, schedules the two fixed milestones, and deposits the full escrow.
- The Carrier assigned by the Shipper submits evidence for the current milestone before its deadline.
- The immutable Shipper verifies the evidence bytes and confirms the milestone, atomically releasing 30% for Cargo pickup or the remaining 70% for Final delivery.
- Each successful Shipper confirmation awards the Carrier exactly 10 on-chain reputation points.
- A current milestone left `Pending` after its deadline enables a deterministic refund of all remaining escrow to the Shipper.
- Either participant may dispute an active agreement unless a pending-milestone refund is already eligible. The deployment arbitrator resolves the remaining escrow split.
- Contract events drive the History and dispute-detail views.

An older design document described a separate Carrier acceptance step. The current implementation intentionally has the Shipper assign the Carrier directly. Do not add Carrier acceptance unless the official assignment requirements explicitly require it.

## Evidence security invariant

Never remove or weaken this workflow:

1. The Carrier selects a JPEG, PNG, WebP, or PDF (maximum 10 MB).
2. The frontend computes `keccak256` over the exact file bytes.
3. The Express endpoint validates a signed MetaMask upload authorization and current blockchain state before requesting a short-lived Supabase signed upload URL.
4. Supabase stores the file in the dedicated public bucket and the contract stores the hash plus a self-contained `supabase://project-ref/bucket/path` reference.
5. The Shipper downloads the file only from the validated Supabase project reference (or the neutral gateway for legacy `ipfs://` evidence) and hashes the downloaded bytes.
6. Confirmation stays disabled unless the downloaded hash equals the on-chain `proofHash`.

Do not hash files on-chain. Do not automatically fetch arbitrary HTTP(S) proof locations supplied from contract data.

## Contract invariants

- Keep `REPUTATION_POINTS_PER_MILESTONE = 10`.
- Reputation tiers are: 0 New, 10+ Emerging, 50+ Established, 100+ Trusted, and 250+ Elite.
- Proof submission, file verification, refunds, and dispute resolution award no reputation.
- Only one confirmation/payment is possible for a milestone.
- Exactly two milestones execute sequentially: Cargo pickup pays 30%, and Final delivery pays the remaining 70%.
- Timely `Submitted` evidence remains confirmable or disputable after its due date; it is not refundable merely because time passes.
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

- Never commit `.env`, Supabase secret keys, RPC credentials, deployer keys, seed phrases, or wallet secrets.
- `SUPABASE_SECRET_KEY` remains server-only and must not use a `VITE_` prefix.
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
