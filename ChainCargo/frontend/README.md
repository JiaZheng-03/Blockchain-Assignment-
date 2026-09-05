# CargoSeal

CargoSeal is a full-stack Ethereum dApp for milestone-based logistics agreements. A Shipper funds an escrow in Ether, a Carrier commits cryptographic evidence for two fixed checkpoints, and Shipper-confirmed milestones release payment. Missed deadlines enable deterministic refunds, while disputed escrow can be split by the contract arbitrator.

## Assignment requirements covered

| Requirement | Implementation |
| --- | --- |
| Registration and authentication | MetaMask wallet authentication plus on-chain Shipper/Carrier registration; the deployer is the only eligible Arbitrator |
| Agreement creation | Auto-generated per-Shipper name, Carrier, notes, fully funded escrow value, and deadlines for the two fixed milestones |
| Funding | `createAgreement` is payable and enforces that the Shipper-selected milestone payouts equal the deposited escrow |
| Milestones and payouts | Carrier uploads evidence to a shared Supabase Storage bucket and submits its `keccak256` file hash plus storage reference; the Shipper verifies it before confirmation atomically releases payment |
| Carrier reputation | Every Shipper-confirmed milestone awards the assigned Carrier 10 immutable on-chain reputation points; proof submission, refunds, and dispute payouts award no points |
| Refunds and disputes | Only the Shipper can refund an unsubmitted overdue milestone; either agreement participant can request a dispute with details; the Carrier can also escalate evidence after one hour without a Shipper response; the deployer/arbitrator resolves the remaining split |
| Transaction history | Dashboard lists wallet agreements and History reconstructs chronological activity from contract events |
| Smart-contract UI integration | React, ethers v6, MetaMask, live contract reads/writes, transaction confirmations, and error reporting |

> Ethereum contracts cannot execute themselves at a wall-clock time. CargoSeal automatically detects refund eligibility and notifies the Shipper, but the Shipper must submit the refund transaction in MetaMask.

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

CargoSeal asks MetaMask to switch to Sepolia from the **Setup** page:

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

The account that deploys the contract is the Arbitrator. It resolves a dispute requested by either participant or a Carrier escalation opened after the one-hour evidence review period.

If MetaMask remains on the same wallet, click **Switch account** in CargoSeal. Authorize both development accounts once, then the app's role-labelled account picker can switch the active workflow without guessing.

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
- Either the Shipper or assigned Carrier can request a dispute while the agreement is active, and the submitted reason is recorded in the event history for Arbitrator review.
- The assigned Carrier can request Arbitrator action after submitted evidence has waited one hour without a Shipper decision.

The contract is suitable for coursework and local/test-network demonstrations. A production deployment should additionally receive an independent security audit, decentralized oracle/e-signature policy, private evidence access controls, multisig arbitration, durable storage backups, and comprehensive operational monitoring.

## Frontend agreement notifications

After MetaMask connection and signed login on the configured chain, CargoSeal scans contract logs from the deployment block and checks again every 30 seconds. The scan also refreshes after local transactions. No contract changes, notification backend, or browser notification permission are required. Existing browser deadline alerts and action-result/confirmation dialogs remain available.

Received updates use one dialog with Previous, Next, Mark as Read, Close, and View Agreement. Previous/Next only navigate. Mark as Read advances to the next unread update (wrapping to the first if needed). Mark All as Read appears when multiple unread updates exist and includes dismissed updates in the bell. View Agreement marks its update read before navigating, then dismisses the remaining popup queue. Close and Escape dismiss the queue without marking anything read for the current login session. Unread updates can appear again after reloading or signing in again; read status persists across reloads. Read updates remain in the bell as history, but only unread received updates count in its badge. Existing deadline alerts remain listed separately. The dialog waits for existing action-result or confirmation popups to close.

Read keys use `chaincargo:notification:<decimal chain ID>:<lowercase contract>:<lowercase wallet>:<transaction hash>:<log index>`. Reads synchronize between tabs through storage events. If localStorage is unavailable, read/dismiss state works in memory for the current page session. Each browser stores its own read state.

Refund availability has no on-chain event. It is detected from an Active agreement with a Pending current milestone when the latest block timestamp exceeds its due date. Its key uses the creation transaction/log plus agreement ID, milestone index, and due date. Observed refund notices are cached locally under `chaincargo:refund-notices:<scope>` to retain them after settlement. Their text directs users to check current agreement status. The separate Refunded event confirms actual payment.

### Manual test

Use your existing configured deployment and registered Shipper, Carrier, and Arbitrator wallets. Start the frontend with `npm run dev:ui` (existing evidence uploads still need their usual service). Use separate browser profiles for simultaneous wallet sessions, or switch accounts and sign in again.

1. Create an agreement as Shipper. Connect and sign in as the assigned Carrier: a new-agreement popup should appear without opening an agreement. An unrelated wallet should receive nothing.
2. Close it. Open the bell: the update remains unread with its agreement title, message, local date/time, and View Agreement link. Wait over 30 seconds: that same popup should stay closed. Reload and sign in: the unread update can appear again.
3. Mark the update as read, then reload and sign in again. It stays in the bell as read and does not pop up. View Agreement should navigate to the correct detail page.
4. Generate several updates while the recipient is signed out. Sign in and exercise Previous/Next: the unread count must not change. Mark the current update read and check that the next unread appears, including when starting at the last item. View Agreement must mark only that update read before navigating. Close or Escape must leave the rest unread and suppress repeated polling popups. Sign out and in again to see those unread updates again. Finally, use Mark All as Read: the popup closes, the unread badge disappears, and every update remains in the bell as read history.
5. Exercise the recipient matrix below, leaving the recipient dashboard open for at least 30 seconds after each confirmed transaction. Test historical delivery by signing in after transactions as well.
6. Open an agreement confirmation dialog while another wallet produces an update. The received-event dialog should wait until the confirmation/action-result popup is dismissed. Check keyboard Tab/Shift+Tab and Escape in the notification dialog.
7. Switch wallet, network, or configured contract: updates/read flags must not leak to the other scope. Mark an update read in another tab of the same browser and scope: the first tab should update too.
8. Let a Pending milestone deadline pass without evidence, and allow a new block to be mined. Only the Shipper receives refund availability. Submitted evidence or a disputed/closed agreement must not produce it. Claim the refund and verify the paid-refund update and retained availability history.

| Action | Receives update |
| --- | --- |
| Create agreement | Assigned Carrier |
| Accept/reject agreement | Shipper (rejection includes reason) |
| Submit evidence | Shipper |
| Request replacement evidence | Carrier |
| Confirm milestone/release payment | Carrier |
| Request extension | Shipper |
| Approve/reject extension | Carrier |
| Open dispute (including evidence arbitration) | Other participant and Arbitrator; not opener |
| Arbitrator settles or continues dispute | Shipper and Carrier |
| Complete agreement | Shipper and Carrier |
| Pending evidence deadline expires | Shipper |

The first scan depends on your RPC's historical-log availability and agreement history size. Temporary RPC errors appear in the bell and retry automatically; they do not mark notifications read. Polling rescans the most recent 12 blocks to reconcile recent event changes. Tests cover recipient routing, ABI event names, identity isolation, queue deduplication, and refund conditions; interactive MetaMask behavior should be checked using the steps above.
