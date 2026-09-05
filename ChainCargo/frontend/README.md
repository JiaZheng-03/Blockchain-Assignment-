# ChainCargo

ChainCargo is a full-stack Ethereum dApp for milestone-based logistics agreements. A Shipper funds an escrow in Ether, a Carrier commits cryptographic evidence for two fixed checkpoints, and Shipper-confirmed milestones release payment. Missed deadlines enable deterministic refunds, while disputed escrow can be split by the contract arbitrator.

## Assignment requirements covered

| Requirement | Implementation |
| --- | --- |
| Registration and authentication | MetaMask wallet authentication plus on-chain Shipper/Carrier registration; the deployer is the only eligible Arbitrator |
| Agreement creation | Auto-generated per-Shipper name, Carrier, notes, fully funded escrow value, and deadlines for the two fixed milestones |
| Funding | `createAgreement` is payable and enforces that the Shipper-selected milestone payouts equal the deposited escrow |
| Milestones and payouts | Carrier uploads evidence to a shared Supabase Storage bucket and submits its `keccak256` file hash plus storage reference; the Shipper verifies it before confirmation atomically releases payment |
| Carrier reputation | Every Shipper-confirmed milestone awards the assigned Carrier 10 immutable on-chain reputation points; proof submission, refunds, and dispute payouts award no points |
| Refunds and disputes | Only the Shipper can refund an unsubmitted overdue milestone or open a dispute after the Final Delivery Deadline; the Carrier can escalate evidence after one hour without a Shipper response; the deployer/arbitrator resolves the remaining split |
| Transaction history | Dashboard lists wallet agreements and History reconstructs chronological activity from contract events |
| Smart-contract UI integration | React, ethers v6, MetaMask, live contract reads/writes, transaction confirmations, and error reporting |

> Ethereum contracts cannot execute themselves at a wall-clock time. ChainCargo automatically detects refund eligibility and notifies the Shipper, but the Shipper must submit the refund transaction in MetaMask.

## Technology

- Solidity 0.8.24
- Hardhat and Chai contract tests
- React 19 and Vite
- ethers v6
- MetaMask
- Supabase Storage for shared off-chain evidence files
- Express signing API for protected, wallet-authorized Supabase uploads

## Sepolia setup

Requirements: Node.js 22 or newer, npm, and the MetaMask browser extension.

`ChainCargo/frontend` is the only application root. From that directory, install dependencies:

```bash
npm install
```

Create `.env` from `.env.example`:

```powershell
Copy-Item .env.example .env
```

```env
SEPOLIA_RPC_URL=https://your-sepolia-rpc-provider.example/v2/api-key
DEPLOYER_PRIVATE_KEY=0xYOUR_DEPLOYER_WALLET_PRIVATE_KEY
VITE_ESCROW_CHAIN_ID=11155111
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-server-secret
SUPABASE_STORAGE_BUCKET=chaincargo-evidence
CHAINCARGO_API_PORT=3001
```

Create one Supabase project for the team and copy its Project URL and a server Secret key from the project's Connect/API Keys settings. The Express API automatically creates or updates the dedicated bucket as public-read with the application's 10 MB and MIME-type restrictions. Uploads still require a current Carrier's MetaMask signature and valid on-chain milestone state.

Never commit `.env`. The deployer wallet needs a small amount of Sepolia ETH for gas. `SUPABASE_SECRET_KEY` bypasses Supabase Row Level Security, is server-only, and must never use a `VITE_` prefix or be placed in browser code. Use the newer `sb_secret_...` key when available; the legacy `SUPABASE_SERVICE_ROLE_KEY` environment variable is also supported.

Deploy the contract once:

```bash
npm run deploy:sepolia
```

The script validates chain `11155111` and writes the new Sepolia address and generated ABI only to `src/contracts/deployment.json`. The currently saved contract predates version 2, so it must be redeployed once before fixed milestones, confirmation payments, and Supabase uploads are enabled.

Start the web app:

```bash
npm run dev
```

Open the Vite URL, then open **Setup**. The page checks MetaMask, Sepolia, deployment, and registration in order.

## MetaMask configuration

ChainCargo asks MetaMask to switch to Sepolia from the **Setup** page:

- Network name: `Sepolia`
- Chain ID: `11155111`
- Currency: `Sepolia ETH`
- Explorer: `https://sepolia.etherscan.io`

The Dashboard and Profile read the balance of the currently selected MetaMask account through MetaMask's Sepolia provider. Account and network changes refresh the displayed balance automatically.

## Suggested demonstration

1. Open **Setup**, connect the first MetaMask account, switch to Sepolia, and register it as **Shipper**.
2. Authorize a second MetaMask account and register it as **Carrier**.
3. Switch back to the Shipper and open **Create Agreement**. Choose the Carrier, select the milestone payment split, set chronological due dates, and fund the escrow.
4. Switch to the Carrier and accept the agreement. Rejecting it closes the agreement and returns the full escrow to the Shipper.
5. Upload evidence for either milestone to Supabase and submit its storage reference and file hash on-chain. The second milestone does not need to wait for the first payout.
6. Switch to the Shipper, verify the stored file against the immutable hash, then confirm and pay or reject it so the Carrier can submit replacement evidence.
7. During the final 24 hours before a current milestone deadline, the Carrier may request one 24-hour extension. The Shipper may approve it with 5% milestone compensation or reject it.
8. If the Shipper does not act on submitted evidence for one hour, the Carrier may escalate it to the Arbitrator. If evidence was never submitted by its deadline, the Shipper may refund the remaining escrow.
9. Open **History** to show the event timeline and transaction hashes.

The account that deploys the contract is the Arbitrator. It resolves either a Shipper dispute opened after the Final Delivery Deadline or a Carrier escalation opened after the one-hour evidence review period.

If MetaMask remains on the same wallet, click **Switch account** in ChainCargo. Authorize both development accounts once, then the app's role-labelled account picker can switch the active workflow without guessing.

## Commands

```bash
npm run check            # lint + all tests + production build
npm test                 # UI tests followed by Solidity tests
npm run compile          # compile Solidity
npm run test:contracts   # run escrow tests
npm run test:ui          # run validation, error, event, and MetaMask-network tests
npm run lint             # lint React
npm run build            # create production UI build
npm run chain            # start local Hardhat node
npm run deploy:local     # deploy and update deployment.local.json only
npm run seed:local       # add repeatable demo roles and a funded agreement
npm run demo:local       # deploy, then seed the local demo
npm run deploy:sepolia   # deploy the coursework contract to Sepolia
npm run dev              # start the protected Supabase API and Vite together
npm run dev:local        # start API/UI on chain 31337 using .env.hardhat
npm run dev:api          # start only the Supabase signing API on port 3001
npm run dev:ui           # start only Vite (uploads require the API)
npm start                # serve the production dist folder and Supabase API
```

The `chain`, `deploy:local`, `seed:local`, `demo:local`, and `dev:local` commands are development helpers only. The submitted application uses Sepolia. For local development, copy `.env.hardhat.example` to `.env.hardhat`, start `npm run chain` in one terminal, run `npm run deploy:local` and optionally `npm run seed:local` in another, then run `npm run dev:local`. Both the frontend and API will use chain 31337, `LOCAL_RPC_URL`, and `src/contracts/deployment.local.json`; the Sepolia deployment file is never overwritten.

## Date and deployment rules

- The final deadline must be at least one hour in the future. Every milestone deadline must still be in the future when the agreement is created.
- Milestone dates must be strictly chronological and cannot be later than the final deadline.
- Evidence submitted on time remains eligible for Shipper confirmation after the wall-clock deadline; it cannot be bypassed with a refund.
- The browser displays `datetime-local` values in the computer's local timezone; Solidity stores the equivalent Unix timestamp in UTC.
- Sepolia data persists across browser and computer restarts.
- Supabase evidence is public to anyone who knows its object URL; use dummy or encrypted files, never sensitive commercial records.
- Evidence references are stored as `supabase://project-ref/bucket/path`.
- If the UI reports the wrong network, switch MetaMask to Sepolia chain `11155111`.
- If the contract is deliberately redeployed to Sepolia, commit the updated `src/contracts/deployment.json` so every team member uses the same Sepolia address. Local deploys update only `deployment.local.json`.

## Contract security decisions

- Checks-effects-interactions and a re-entrancy lock protect ETH transfers.
- Only registered shippers create agreements and only registered carriers can be selected.
- Only the assigned carrier submits milestone evidence.
- Only the immutable Shipper stored at creation can confirm evidence and release payouts.
- Agreement names are unique per Shipper after case and whitespace normalization.
- Every agreement has exactly Cargo pickup and Final delivery; the Shipper selects their payment percentages and the two payouts must total 100%.
- Milestones are sequential, immutable after confirmation, and bounded by ordered deadlines.
- The deposit must exactly equal all milestone payouts, preventing stranded or underfunded escrow.
- Remaining escrow can be refunded only when the current required milestone is still unsubmitted after its deadline.
- Only the original Shipper can submit that refund transaction.
- Only the Shipper can open a normal dispute, and only after the Final Delivery Deadline.
- The assigned Carrier can request Arbitrator action after submitted evidence has waited one hour without a Shipper decision.

The contract is suitable for coursework and local/test-network demonstrations. A production deployment should additionally receive an independent security audit, decentralized oracle/e-signature policy, private evidence access controls, multisig arbitration, durable storage backups, and comprehensive operational monitoring.
