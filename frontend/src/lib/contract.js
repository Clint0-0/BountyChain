// Contract helpers: deployment info, enums, struct conversion, error decoding.
import { ethers } from "ethers";

// The deploy script writes this file. import.meta.glob keeps the build working
// even before the contract is deployed (we then show a setup screen).
const mods = import.meta.glob("../contracts/BountyPlatform.json", { eager: true });
export const deployment = Object.values(mods)[0]?.default || null;

export const SEVERITY = ["None", "Low", "Medium", "High", "Critical"];
export const STATUS = ["None", "Submitted", "Approved", "Rejected", "Disputed", "RejectionUpheld", "Claimed"];
export const STATUS_LABEL = {
  Submitted: "Pending review",
  Approved: "Approved",
  Rejected: "Rejected",
  Disputed: "In dispute",
  RejectionUpheld: "Rejection upheld",
  Claimed: "Reward claimed",
};
export const DISPUTE_STATUS = ["None", "Open", "Upheld", "Overturned"];

export const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";

export const CHAINS = {
  31337: { name: "Hardhat Local", explorer: null, rpc: "http://127.0.0.1:8545", currency: "ETH" },
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io", rpc: "https://rpc.sepolia.org", currency: "SepoliaETH" },
};

export function explorerTx(chainId, hash) {
  const e = CHAINS[chainId]?.explorer;
  return e ? `${e}/tx/${hash}` : null;
}
export function explorerAddress(chainId, addr) {
  const e = CHAINS[chainId]?.explorer;
  return e ? `${e}/address/${addr}` : null;
}

export const iface = deployment ? new ethers.Interface(deployment.abi) : null;

export function getContract(runner) {
  return new ethers.Contract(deployment.address, deployment.abi, runner);
}

// ---------- struct conversion (ethers Result -> plain object) ----------
export function toProgram(p) {
  return {
    id: Number(p.id),
    owner: p.owner,
    title: p.title,
    metadataHash: p.metadataHash,
    startTime: Number(p.startTime),
    endTime: Number(p.endTime),
    active: p.active,
    rewards: [...p.rewards].map((x) => BigInt(x)),
    availableBalance: BigInt(p.availableBalance),
    reservedBalance: BigInt(p.reservedBalance),
    totalPaid: BigInt(p.totalPaid),
    submissionCount: Number(p.submissionCount),
    openItems: Number(p.openItems),
    disputeLockUntil: Number(p.disputeLockUntil),
  };
}

export function toSubmission(s) {
  return {
    id: Number(s.id),
    programId: Number(s.programId),
    researcher: s.researcher,
    reportHash: s.reportHash,
    submittedAt: Number(s.submittedAt),
    status: STATUS[Number(s.status)],
    severity: SEVERITY[Number(s.severity)],
    reward: BigInt(s.reward),
    reviewer: s.reviewer,
    reviewedAt: Number(s.reviewedAt),
    reviewNoteHash: s.reviewNoteHash,
  };
}

export function toDispute(d) {
  return {
    submissionId: Number(d.submissionId),
    researcher: d.researcher,
    evidenceHash: d.evidenceHash,
    raisedAt: Number(d.raisedAt),
    status: DISPUTE_STATUS[Number(d.status)],
    resolver: d.resolver,
    resolvedAt: Number(d.resolvedAt),
    resolutionNoteHash: d.resolutionNoteHash,
  };
}

export function programPhase(p, now = Date.now() / 1000) {
  if (!p.active) return "Inactive";
  if (now < p.startTime) return "Upcoming";
  if (now > p.endTime) return "Ended";
  return "Open";
}

// ---------- formatting ----------
export const fmtEth = (wei, digits = 4) => {
  const n = Number(ethers.formatEther(wei ?? 0n));
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits })} ETH`;
};
export const short = (a, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : "");
export const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : "—");
export const ZERO_HASH = ethers.ZeroHash;
export const ZERO_ADDR = ethers.ZeroAddress;

// ---------- error decoding ----------
const FRIENDLY = {
  ZeroAddress: "Address cannot be the zero address.",
  EmptyValue: "A required value is empty.",
  NotOrganization: "Your wallet is not an authorized organization.",
  NotProgramOwner: "Only the program owner can do this.",
  NotVerifier: "Your wallet is not an assigned verifier for this program.",
  NotDisputeResolver: "Only the dispute resolver can do this.",
  NotResearcher: "Only the researcher who submitted this report can do this.",
  AlreadyRegistered: "This organization is already registered.",
  AlreadyAssigned: "This verifier is already assigned.",
  NotAssigned: "This address is not an assigned verifier.",
  InvalidTimeRange: "Invalid start/end time (end must be in the future and after start).",
  InvalidRewardTiers: "Reward tiers must be > 0 and non-decreasing (Low ≤ Medium ≤ High ≤ Critical).",
  ProgramNotFound: "Program not found.",
  SubmissionNotFound: "Submission not found.",
  ProgramNotOpen: "Program is not accepting submissions (inactive, not started or expired).",
  DuplicateReport: "This report hash was already submitted.",
  ConflictOfInterest: "Conflict of interest: this wallet cannot perform this action.",
  InvalidStatus: "Action not allowed in the submission's current status.",
  InvalidSeverity: "Invalid severity for this decision.",
  InsufficientPool: "Insufficient funds in the program reward pool.",
  DisputeWindowClosed: "The dispute window has closed.",
  DisputeAlreadyExists: "A dispute already exists for this submission.",
  FundsLocked: "Funds are locked: program must be closed, with no pending reviews/disputes and the dispute window passed.",
  TransferFailed: "ETH transfer failed.",
  InvalidWindow: "Dispute window must be between 1 hour and 90 days.",
  OwnableUnauthorizedAccount: "Only the platform administrator can do this.",
};

function findRevertData(e) {
  const candidates = [e?.data, e?.error?.data, e?.info?.error?.data, e?.info?.error?.data?.data, e?.error?.data?.data];
  return candidates.find((d) => typeof d === "string" && d.startsWith("0x") && d.length >= 10);
}

export function decodeError(e) {
  if (!e) return "Unknown error";
  if (e.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) return "Transaction rejected in wallet.";
  let name = e.revert?.name;
  if (!name && iface) {
    const data = findRevertData(e);
    if (data) {
      try {
        name = iface.parseError(data)?.name;
      } catch {
        /* not a contract error */
      }
    }
  }
  if (!name) {
    const m = JSON.stringify(e.info || e.error || e.message || "").match(/custom error '(\w+)\(/);
    if (m) name = m[1];
  }
  if (name) return FRIENDLY[name] ? `${FRIENDLY[name]} (${name})` : name;
  if (e.code === "INSUFFICIENT_FUNDS") return "Wallet has insufficient ETH for this transaction.";
  if (e.code === "NETWORK_ERROR") return "Network error: is the blockchain node running?";
  return e.shortMessage || e.reason || e.message || String(e);
}
