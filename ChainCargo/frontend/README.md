# ChainCargo

ChainCargo is a full-stack Ethereum dApp for milestone-based logistics agreements. A shipper funds an escrow in Ether, a carrier commits cryptographic evidence for each checkpoint, and approved milestones progressively release payment. Missed deadlines enable refunds, while disputed escrow can be split by the contract arbitrator.

## Assignment requirements covered

| Requirement | Implementation |
| --- | --- |
| Registration and authentication | MetaMask wallet authentication plus on-chain Shipper/Carrier registration |
| Agreement creation | Title, carrier, notes, funded payload/escrow value, final deadline, ordered milestones, due dates, and payout percentages |
| Funding | `createAgreement` is payable and requires milestone payouts to exactly equal deposited ETH |
| Milestones and payouts | Carrier uploads evidence to Pinata IPFS and submits its `keccak256` file hash plus CID; the Shipper UI downloads and verifies the same file before approval releases that milestone's exact payout |
| Carrier reputation | Every Shipper-approved milestone awards the assigned Carrier 10 immutable on-chain reputation points; proof submission, refunds, and dispute payouts award no points |
| Refunds and disputes | Permissionless refund when the current milestone remains unsubmitted after its deadline; either party can pause escrow and open a dispute; deployer/arbitrator resolves the remaining split |
| Transaction history | Dashboard lists wallet agreements and History reconstructs chronological activity from contract events |
| Smart-contract UI integration | React, ethers v6, MetaMask, live contract reads/writes, transaction confirmations, and error reporting |

> Ethereum contracts cannot execute themselves at a wall-clock time. An eligible refund is therefore automatic in its outcome and permissionless to trigger: anyone can call `claimRefundAfterDeadline`, but the contract always sends the funds to the shipper.

## Technology

- Solidity 0.8.24
- Hardhat and Chai contract tests
- React 19 and Vite
- ethers v6
- MetaMask
- Pinata IPFS for off-chain evidence files
- Express signing API for protected Pinata uploads

## Sepolia setup

Requirements: Node.js, npm, and the MetaMask browser extension.

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
PINATA_JWT=your-server-only-pinata-jwt
PINATA_GATEWAY=your-gateway.mypinata.cloud
PINATA_API_PORT=3001
```

Never commit `.env`. The deployer wallet needs a small amount of Sepolia ETH for gas. The Pinata JWT is server-only and must never use a `VITE_` prefix.

Deploy the contract once:

```bash
npm run deploy:sepolia
```

The script validates chain `11155111` and writes the Sepolia address and ABI only to `src/contracts/deployment.json`.

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
3. Switch back to the Shipper and open **Create Agreement**. Choose the Carrier from the on-chain directory, define chronological milestones totalling 100%, and fund the escrow.
4. Switch to the Carrier, open the agreement, select a receipt/photo/PDF, authorize its signed Pinata upload, then submit the returned IPFS CID and file hash on-chain.
5. Switch to the Shipper, open and review the IPFS file, verify its bytes against the immutable hash, and approve the milestone. MetaMask shows the payout transaction, the Carrier receives ETH, and 10 reputation points are recorded on-chain.
6. Repeat for final delivery, or demonstrate a deadline refund with a short due date.
7. Open **History** to show the event timeline and transaction hashes.

The account that deploys the contract is the arbitrator. If either participant opens a dispute, connect that deploying account to resolve how much remaining ETH goes to the shipper; the carrier receives the balance.

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
npm run dev              # start the protected Pinata API and Vite together
npm run dev:local        # start API/UI on chain 31337 using .env.hardhat
npm run dev:api          # start only the Pinata signing API on port 3001
npm run dev:ui           # start only Vite (uploads require the API)
npm start                # serve the production dist folder and Pinata API
```

The `chain`, `deploy:local`, `seed:local`, `demo:local`, and `dev:local` commands are development helpers only. The submitted application uses Sepolia. For local development, copy `.env.hardhat.example` to `.env.hardhat`, start `npm run chain` in one terminal, run `npm run deploy:local` and optionally `npm run seed:local` in another, then run `npm run dev:local`. Both the frontend and API will use chain 31337, `LOCAL_RPC_URL`, and `src/contracts/deployment.local.json`; the Sepolia deployment file is never overwritten.

## Date and deployment rules

- Final and milestone dates must be at least two minutes in the future. This buffer prevents a date from expiring while MetaMask waits for confirmation.
- Milestone dates must be strictly chronological and cannot be later than the final deadline.
- Evidence submitted on time remains eligible for Shipper approval after the wall-clock deadline; it cannot be bypassed with a refund.
- The browser displays `datetime-local` values in the computer's local timezone; Solidity stores the equivalent Unix timestamp in UTC.
- Sepolia data persists across browser and computer restarts.
- Pinata evidence is public through its IPFS CID; use dummy or encrypted files, never sensitive commercial records.
- If the UI reports the wrong network, switch MetaMask to Sepolia chain `11155111`.
- If the contract is deliberately redeployed to Sepolia, commit the updated `src/contracts/deployment.json` so every team member uses the same Sepolia address. Local deploys update only `deployment.local.json`.

## Contract security decisions

- Checks-effects-interactions and a re-entrancy lock protect ETH transfers.
- Only registered shippers create agreements and only registered carriers can be selected.
- Only the assigned carrier submits milestone evidence.
- Only the assigned shipper approves evidence and releases payouts.
- Milestones are sequential, immutable after approval, and bounded by ordered deadlines.
- The deposit must exactly equal all milestone payouts, preventing stranded or underfunded escrow.
- Remaining escrow can be refunded only when the current required milestone is still unsubmitted after its deadline.

The contract is suitable for coursework and local/test-network demonstrations. A production deployment should additionally receive an independent security audit, decentralized oracle/e-signature policy, multisig arbitration, IPFS pinning, and comprehensive operational monitoring.
