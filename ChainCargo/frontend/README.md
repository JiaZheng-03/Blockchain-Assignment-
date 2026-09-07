# CargoSeal

CargoSeal is a full-stack Ethereum logistics escrow dApp. A Shipper funds an agreement, an assigned Carrier submits milestone evidence, and verified milestones release ETH from the smart contract. The system also handles deadlines, reputation, disputes, notifications, and Arbitrator decisions.

This project is intended for university coursework and Sepolia demonstrations. It has not received a production security audit.

## Features

- MetaMask connection, account selection, signed login, and on-chain roles
- Shipper, Carrier, and fixed-deployer Arbitrator workflows
- Fully funded agreements with Carrier acceptance or rejection
- Cargo pickup and Final delivery milestones with a custom payment split
- Wallet-authorized Supabase evidence uploads
- Keccak-256 file hashes and integrity verification before payment
- Evidence rejection and replacement submission
- Deadline extensions, refunds, and on-chain Carrier reputation
- Participant disputes, additional Arbitrator questions, and reasoned decisions
- Event-based transaction history and role-specific notifications
- Sepolia deployment and an optional local Hardhat demo

## Technology

| Layer | Technology |
| --- | --- |
| Smart contract | Solidity 0.8.24 |
| Development and tests | Hardhat, Chai |
| Frontend | React 19, React Router, Vite |
| Blockchain client | ethers v6, MetaMask |
| API | Express |
| Evidence storage | Supabase Storage |
| Default network | Ethereum Sepolia (`11155111`) |

## User Roles

### Shipper

- Registers a Shipper wallet and display name.
- Creates an agreement and deposits the complete escrow.
- Selects a registered Carrier, deadlines, and milestone percentages.
- Verifies, confirms, or rejects evidence.
- Approves or rejects extension requests.
- Opens or responds to disputes and claims eligible refunds.

### Carrier

- Registers a Carrier wallet and display name.
- Accepts or rejects an assigned agreement within 24 hours.
- Provides a reason when rejecting an agreement.
- Uploads evidence and commits its hash on-chain.
- May submit later-milestone evidence before an earlier milestone is confirmed.
- Requests extensions or Arbitrator action when eligible.
- Opens and responds to disputes.

### Arbitrator

- Uses the wallet that deployed the contract.
- Must register the deployer wallet as Arbitrator after deployment.
- Reviews both parties, evidence, dispute reasons, and responses.
- May request more information from either participant.
- Approves a milestone, requests replacement evidence, or divides the remaining escrow.
- Must record a reason and act within 48 hours after the dispute opens.

## Agreement Workflow

1. The Shipper and Carrier register separate MetaMask wallets.
2. The Shipper creates an agreement and deposits all milestone funding.
3. The Carrier accepts, or rejects with a reason and refunds the Shipper.
4. The Carrier uploads milestone evidence.
5. The API validates the signed upload request and current contract state.
6. The contract stores the Supabase reference and Keccak-256 file hash.
7. The Shipper downloads the file and verifies it against the on-chain hash.
8. The Shipper confirms and pays, or rejects it for replacement evidence.
9. After both milestones are confirmed, the agreement becomes Completed.

## Business Rules

- Every agreement has exactly two milestones: Cargo pickup and Final delivery.
- Milestone deadlines must be chronological and cannot exceed the Final Delivery Deadline.
- The complete escrow is deposited at agreement creation.
- Milestone payouts must total exactly 100% of the deposit.
- The Carrier has 24 hours to accept or reject a new agreement.
- Evidence submitted on time remains reviewable after its deadline.
- After 24 hours without a Shipper evidence decision, the Carrier may request arbitration.
- Rejected evidence receives up to 24 hours for replacement without passing the next deadline.
- The Carrier can request one 24-hour extension during the final 24 hours before the current milestone deadline.
- An approved extension affects only that milestone and allocates 5% of its payout to the Shipper.
- Confirming a milestone awards 10 Carrier reputation points.
- A missed-evidence refund deducts 10 points once, with a minimum score of zero.
- Either participant may open a dispute while the workflow permits it.
- A dispute pauses affected deadlines; later milestone evidence may still be submitted.
- Additional Arbitrator questions do not restart the 48-hour Arbitrator deadline.
- After 48 hours without an Arbitrator decision, the Arbitrator is locked out. Either participant may submit a cancellation transaction that refunds all remaining escrow to the Shipper.
- A smart contract cannot wake itself up at a future time. Refunds and timeout cancellations require a MetaMask transaction.

## Prerequisites

- Node.js 22 or newer
- npm
- MetaMask
- Sepolia ETH for transaction gas
- A Sepolia RPC endpoint
- A Supabase project for evidence storage

## Installation

Run from the `frontend` directory:

```bash
npm install
```

Create `.env` on Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

## Environment Variables

```env
SEPOLIA_RPC_URL=https://your-sepolia-rpc-provider.example/v2/api-key
DEPLOYER_PRIVATE_KEY=YOUR_DEPLOYER_PRIVATE_KEY

VITE_ESCROW_CONTRACT_ADDRESS=
VITE_ESCROW_CHAIN_ID=11155111

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_SERVER_SECRET
SUPABASE_STORAGE_BUCKET=cargoseal-evidence
CARGOSEAL_API_PORT=3001
```

- Never commit `.env`.
- The private key may include or omit `0x` and needs Sepolia ETH for deployment.
- `SUPABASE_SECRET_KEY` is server-only. Never expose it through a `VITE_` variable.
- Normally leave `VITE_ESCROW_CONTRACT_ADDRESS` empty so the app uses `deployment.json`.
- Use an override address only for a deliberate compatible deployment.

## Supabase Setup

1. Create a Supabase project.
2. Put its Project URL and server Secret key in `.env`.
3. Keep the default bucket name or configure another valid name.
4. Start the API. It creates or updates the bucket with a 10 MB limit and permits JPEG, PNG, WebP, and PDF evidence.

The current bucket is public-read. Uploads require a valid Carrier signature and on-chain permission, but anyone with the object URL can read a file. Use demonstration files only. Production should use a private bucket with participant-authorized, short-lived download URLs.

## Sepolia Deployment

Run all checks first:

```bash
npm run check
```

Deploy:

```bash
npm run deploy:sepolia
```

The script validates chain `11155111`, deploys `LogisticsEscrow`, and writes its address, block number, chain ID, and generated ABI to `src/contracts/deployment.json`.

After deployment:

1. Commit the updated `deployment.json` for the team.
2. Connect the deployer wallet and register it as Arbitrator.
3. Register separate Shipper and Carrier wallets.

Every Solidity change requires a new deployment. React, CSS, API, and documentation-only changes do not.

## Run the Application

```bash
npm run dev
```

Open the Local URL printed by Vite, normally `http://localhost:5173`. Vite may select another port if `5173` is occupied. The evidence API runs at `http://127.0.0.1:3001`; keep the terminal running during uploads.

## MetaMask

Use Sepolia:

| Setting | Value |
| --- | --- |
| Network | Sepolia |
| Chain ID | `11155111` |
| Currency | Sepolia ETH |
| Explorer | `https://sepolia.etherscan.io` |

Login steps:

1. Click **Connect MetaMask** and unlock MetaMask if required.
2. Authorize one or more accounts.
3. Select an authorized account in CargoSeal.
4. Sign the free login message; it does not create a transaction.
5. Register the wallet if it has no role.

Logout clears the CargoSeal session and requests site disconnection. A website cannot force MetaMask itself to request a password on every login.

## Local Hardhat Demo

Create the local environment file:

```powershell
Copy-Item .env.hardhat.example .env.hardhat
```

Run in separate terminals:

```bash
# Terminal 1
npm run chain

# Terminal 2
npm run deploy:local
npm run seed:local

# Terminal 3
npm run dev:local
```

Add a MetaMask network with RPC `http://127.0.0.1:8545`, chain ID `31337`, and currency `ETH`. Import only the disposable accounts printed by Hardhat. Local deployment updates only `deployment.local.json`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Sepolia API and Vite |
| `npm run dev:api` | Run only the evidence API |
| `npm run dev:ui` | Run only Vite; upload still needs the API |
| `npm run build` | Build the production frontend |
| `npm start` | Serve `dist` and the API |
| `npm run lint` | Run ESLint |
| `npm run test:ui` | Run frontend utility and event tests |
| `npm run test:contracts` | Run Hardhat tests |
| `npm test` | Run UI and contract tests |
| `npm run check` | Run lint, all tests, and build |
| `npm run compile` | Compile Solidity |
| `npm run deploy:sepolia` | Deploy to Sepolia |
| `npm run chain` | Start the local Hardhat chain |
| `npm run deploy:local` | Deploy to chain `31337` |
| `npm run seed:local` | Create local demo roles and agreement |
| `npm run demo:local` | Deploy and seed locally |
| `npm run dev:local` | Run API/UI for the local chain |

## Project Structure

```text
frontend/
|-- contracts/                 Solidity contract
|-- scripts/                   Deployment and seed scripts
|-- test/                      Hardhat tests
|-- test-ui/                   Frontend and event tests
|-- src/
|   |-- components/            Shared UI
|   |-- context/               Wallet, contract, and notification state
|   |-- contracts/             ABI and deployment metadata
|   |-- hooks/                 Blockchain data hooks
|   |-- pages/                 Application screens
|   `-- utils/                 Validation, evidence, and history helpers
|-- server.js                  Express/Supabase authorization API
|-- hardhat.config.cjs         Compiler and network configuration
`-- vite.config.js             Frontend and API proxy configuration
```

## Evidence Integrity

1. The frontend hashes the exact selected bytes.
2. The Carrier signs a short-lived upload authorization.
3. The API checks the signature, assignment, milestone, deadline, chain, and contract.
4. Supabase stores the original file.
5. Solidity stores its hash and `supabase://project-ref/bucket/path` reference.
6. The Shipper downloads and hashes the stored file again.
7. Confirmation remains disabled until both hashes match.

Never hash large files inside Solidity or trust arbitrary HTTP evidence links.

## History and Notifications

- Events are read beginning at the saved deployment block.
- Notifications refresh every 30 seconds and after local transactions.
- Recipient rules depend on the Shipper, Carrier, and Arbitrator roles.
- Read state is isolated by browser, chain, contract, and wallet.
- Dispute reasons, follow-up questions, responses, decisions, and resolution reasons are recorded in history.
- Refund availability is calculated from the latest block timestamp because no refund event exists until a user submits the transaction.

## Troubleshooting

### Vite port is already in use

Open the alternative URL printed by Vite, or stop the older process before restarting.

### Windows asks `Terminate batch job (Y/N)?`

This normally follows `Ctrl+C`. Enter `Y` once and wait for both API and Vite to stop.

### Wrong MetaMask network

Switch to Sepolia `11155111`, refresh, and sign in again.

### Contract unavailable or new function fails

Redeploy after Solidity changes and share the updated `deployment.json`. Updating a frontend ABI cannot add functions to an older deployed address.

### Evidence upload unavailable

- Confirm `npm run dev` is running and the API is listening on port `3001`.
- Check the Supabase URL, secret, and bucket name.
- Use the assigned Carrier wallet and correct network.
- Use JPEG, PNG, WebP, or PDF no larger than 10 MB.

### Sepolia deployment timeout

Check the RPC endpoint and connection, then retry. Before deploying repeatedly, check whether the previous transaction was already broadcast.

### Account details unavailable

Check MetaMask network, RPC access, and the deployed address. Do not register again until the existing profile lookup succeeds.

## Security and Limitations

- Never commit or share private keys, seed phrases, RPC credentials, or Supabase secrets.
- Rotate a credential immediately after accidental exposure.
- Blockchain data and wallet addresses are public.
- Current evidence files are public-read and must not contain confidential information.
- Login signatures use a browser session. Production should use server nonces and expiring HTTP-only sessions.
- The fixed deployer Arbitrator is centralized; production should consider multisig or decentralized arbitration.
- RPC historical-log availability may affect history loading.
- Sepolia ETH has no real monetary value.

## Team Workflow

1. Pull the latest work before making changes.
2. Keep `.env` local and share only `.env.example`.
3. Use separate feature branches.
4. Run `npm run check` before merging.
5. Only the deployment owner should redeploy and update `deployment.json`.
6. Inform the team whenever the contract address or ABI changes.

## License

This project is provided for academic use. Add an explicit license before external distribution.



Testing
