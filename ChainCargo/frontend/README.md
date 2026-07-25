# ChainCargo

ChainCargo is a full-stack Ethereum dApp for milestone-based logistics agreements. A shipper funds an escrow in Ether, a carrier commits cryptographic evidence for each checkpoint, and approved milestones progressively release payment. Missed deadlines enable refunds, while disputed escrow can be split by the contract arbitrator.

## Assignment requirements covered

| Requirement | Implementation |
| --- | --- |
| Registration and authentication | MetaMask wallet authentication plus on-chain Shipper/Carrier registration |
| Agreement creation | Title, carrier, notes, final deadline, ordered milestones, due dates, and payout percentages |
| Funding | `createAgreement` is payable and requires milestone payouts to exactly equal deposited ETH |
| Milestones and payouts | Carrier submits a `keccak256` evidence hash; shipper approval releases that milestone's exact payout |
| Refunds and disputes | Permissionless deadline refund to the shipper; either party can pause escrow and open a dispute; deployer/arbitrator resolves the remaining split |
| Transaction history | Dashboard lists wallet agreements and History reconstructs chronological activity from contract events |
| Smart-contract UI integration | React, ethers v6, MetaMask, live contract reads/writes, transaction confirmations, and error reporting |

> Ethereum contracts cannot execute themselves at a wall-clock time. An eligible refund is therefore automatic in its outcome and permissionless to trigger: anyone can call `claimRefundAfterDeadline`, but the contract always sends the funds to the shipper.

## Technology

- Solidity 0.8.24
- Hardhat and Chai contract tests
- React 19 and Vite
- ethers v6
- MetaMask

## Local setup

Requirements: Node.js, npm, and the MetaMask browser extension.

From `ChainCargo/frontend`, install dependencies:

```bash
npm install
```

Use three terminals.

Terminal 1 — start the local Ethereum chain:

```bash
npm run chain
```

Terminal 2 — deploy the contract:

```bash
npm run deploy:local
```

The deploy script writes the address and ABI to `src/contracts/deployment.json`, so the UI immediately uses the new deployment.

Terminal 3 — start the web app:

```bash
npm run dev
```

Open the Vite URL printed in the terminal.

## MetaMask configuration

Add a network with:

- Network name: `Hardhat Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

Import two of the development private keys printed by `npm run chain`. Use one account as the shipper and another as the carrier. These keys are public testing keys and must never receive real funds.

If the local chain is restarted, deploy again. Hardhat resets all accounts and contract state whenever the node restarts.

## Suggested demonstration

1. Open **Login**, connect the first MetaMask account, and select **Register as Shipper**.
2. After confirmation, click **Select another wallet for Carrier**. Choose a different MetaMask account and register it as **Carrier**.
3. Switch back to the shipper and create an agreement using the carrier's address. Set milestone due dates before the final deadline and ensure percentages total 100%.
4. Switch to the carrier, open the agreement, enter evidence text or a document fingerprint and an optional IPFS URI, then submit the cryptographic proof.
5. Switch to the shipper, inspect the immutable evidence hash, and approve the milestone. MetaMask shows the payout transaction and the carrier receives ETH.
6. Repeat for final delivery, or demonstrate a deadline refund with a short due date.
7. Open **History** to show the event timeline and transaction hashes.

The account that deploys the contract is the arbitrator. If either participant opens a dispute, connect that deploying account to resolve how much remaining ETH goes to the shipper; the carrier receives the balance.

If MetaMask remains on the same wallet, click **Select a different MetaMask account** in ChainCargo. This requests MetaMask's account-selection permission directly. Changing accounts only inside MetaMask also works; ChainCargo listens for the `accountsChanged` event.

## Commands

```bash
npm run compile          # compile Solidity
npm run test:contracts   # run escrow tests
npm run test:ui          # run form/date/error-decoding tests
npm run lint             # lint React
npm run build            # create production UI build
npm run chain            # start local Hardhat node
npm run deploy:local     # deploy and update frontend address/ABI
npm run dev              # start Vite
```

## Date and deployment rules

- Final and milestone dates must be at least two minutes in the future. This buffer prevents a date from expiring while MetaMask waits for confirmation.
- Milestone dates must be strictly chronological and cannot be later than the final deadline.
- The browser displays `datetime-local` values in the computer's local timezone; Solidity stores the equivalent Unix timestamp in UTC.
- If the Hardhat node is stopped or restarted, its blockchain state is erased. Keep `npm run chain` running, run `npm run deploy:local` again, then refresh the browser.
- If the UI reports the wrong network, switch MetaMask to chain `31337`.

## Contract security decisions

- Checks-effects-interactions and a re-entrancy lock protect ETH transfers.
- Only registered shippers create agreements and only registered carriers can be selected.
- Only the assigned carrier submits milestone evidence.
- Only the assigned shipper approves evidence and releases payouts.
- Milestones are sequential, immutable after approval, and bounded by ordered deadlines.
- The deposit must exactly equal all milestone payouts, preventing stranded or underfunded escrow.
- Only remaining escrow can be refunded or divided in a dispute.

The contract is suitable for coursework and local/test-network demonstrations. A production deployment should additionally receive an independent security audit, decentralized oracle/e-signature policy, multisig arbitration, IPFS pinning, and comprehensive operational monitoring.
