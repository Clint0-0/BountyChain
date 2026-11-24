# Demo Checklist (viva, ~10 minutes)

## Before the viva
- [ ] `npm run setup` done; `npx hardhat test` shows **53 passing**; `cd backend; npm test` shows **23 pass**
- [ ] Fresh chain: terminal 1 `cd blockchain; npx hardhat node`
- [ ] Deploy: terminal 2 `cd blockchain; npm run deploy:local` → note the contract address
- [ ] Clean DB: `Remove-Item -Recurse -Force backend\data` (if it exists), then terminal 3 `cd backend; npm start`
- [ ] Terminal 4 `cd frontend; npm run dev` → open http://localhost:5173
- [ ] MetaMask: Hardhat Local network (chain 31337); accounts #0–#4 imported and renamed **Admin / Org / Verifier / Researcher / Resolver**
- [ ] MetaMask: "Clear activity tab data" on every account after restarting the node

## Live flow
| # | Wallet | Where | Action | Point to show |
|---|---|---|---|---|
| 1 | Researcher | Admin Panel URL `/admin` | Open it | "Not authorized": UI gate. Then explain the contract also refuses (`OwnableUnauthorizedAccount`) |
| 2 | Admin | Admin Panel | Register **Org** address, name "Acme Security Labs" | Toast: Confirm in MetaMask → Pending + tx hash → Confirmed in block N |
| 3 | Admin | Admin Panel | Assign **Resolver** address | Try assigning the admin's own address → `ConflictOfInterest` |
| 4 | Org | Organization | Create program (defaults: tiers 0.1 / 0.5 / 1 / 2 ETH, 5 ETH pool) | Signature login (no gas), then a payable tx; pool balance on-chain |
| 5 | Org | Organization → Manage | Assign **Verifier** address | Event `VerifierAssigned` in program page history |
| 6 | Researcher | Explore → program | Show "Metadata integrity verified" badge, then submit report | Only the hash goes on-chain: copy it from "On-chain record" |
| 7 | Researcher | Submission page | "Decrypt & view" | Integrity badge: keccak256(decrypted JSON) == on-chain hash |
| 8 | Org | same submission URL | Decrypt | Organization is allowed (owner of program) |
| 9 | Verifier | Verifier dashboard → report | Decrypt, write note, severity **High**, Approve | `RewardReserved` = exactly 1 ETH: verifier cannot type an amount |
| 10 | Researcher | My Submissions | Claim | MetaMask balance +1 ETH; `RewardClaimed` event; try Claim again → `InvalidStatus` |
| 11 | Researcher | Program | Submit 2nd report | |
| 12 | Verifier | report #2 | Reject with note | |
| 13 | Researcher | report #2 | Raise dispute with reason | Window deadline shown; duplicate dispute impossible |
| 14 | Resolver | Dispute Resolution → report #2 | Decrypt (now allowed), read verifier note + evidence, Overturn → Critical | `DisputeResolved(overturned)` on-chain; then researcher claims 2 ETH |
| 15 | Admin | Admin Panel | Recent activity + stats | Every event with block and tx hash |

## Talking points
- **Why hybrid?** Exploit details must stay confidential. The chain stores hashes, roles, money and decisions; the server stores encrypted content.
- **Why pull payments?** Review never transfers ETH. `claimReward` uses CEI + `nonReentrant`, and a failed transfer reverts the whole tx.
- **Why can't the org rug-pull?** Reserved rewards are untouchable; `withdrawUnreserved` only works after close, with nothing pending and the dispute window passed.
- **Why can't the admin cheat?** Admin cannot be org, verifier or resolver. It is enforced in Solidity, not the UI.
- **Server compromise?** It could leak plaintext but cannot forge decisions or payments; tampering is detected by the hash and the GCM tag.
- Live proof of tests: `npx hardhat test` (53) and `npm run e2e` (full workflow with real txs).

## If something breaks
- "Nonce too high" → MetaMask clear activity data.
- "Contract not deployed" page → re-run deploy, restart Vite.
- "Off-chain report not found" → the DB is from an old chain: delete `backend\data`, restart backend.
