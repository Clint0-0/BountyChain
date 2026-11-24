// Data hooks reading LIVE contract state through the read provider.
import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "../context/Web3Context";
import { toProgram, toSubmission, toDispute, deployment, SEVERITY } from "./contract";
import { getProgramMetadata } from "./api";

/** Generic async loader that re-runs on refreshKey (bumped after every tx). */
export function useAsync(fn, deps) {
  const { refreshKey } = useWeb3();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const run = useCallback(fn, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    run()
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((error) => !cancelled && setState({ data: null, loading: false, error: error.shortMessage || error.message }));
    return () => {
      cancelled = true;
    };
  }, [run, refreshKey]);
  return state;
}

export async function loadProgram(c, id) {
  const p = toProgram(await c.getProgram(id));
  const meta = await getProgramMetadata(p.metadataHash);
  // Metadata is only trusted if published by the same wallet that owns the
  // program on-chain (otherwise an org could reuse another org's details).
  if (meta && meta.owner?.toLowerCase() !== p.owner.toLowerCase()) {
    p.meta = null;
    p.metaWarning = "Off-chain details were published by a different wallet than the program owner and are not shown.";
  } else {
    p.meta = meta;
  }
  return p;
}

export function usePrograms(ids) {
  const { readContract } = useWeb3();
  const key = ids ? ids.join(",") : "all";
  return useAsync(async () => {
    const list = ids || Array.from({ length: Number(await readContract.programCount()) }, (_, i) => i + 1);
    const out = await Promise.all(list.map((id) => loadProgram(readContract, id)));
    return out.sort((a, b) => b.id - a.id);
  }, [readContract, key]);
}

export async function loadSubmissions(c, ids) {
  return Promise.all(ids.map(async (id) => toSubmission(await c.getSubmission(id))));
}

export async function loadDispute(c, id) {
  return toDispute(await c.getDispute(id));
}

const fromBlock = () => deployment?.deployBlock || 0;

/** Timeline of all events concerning one submission. */
export async function loadSubmissionTimeline(c, id) {
  const names = ["ReportSubmitted", "ReportApproved", "ReportRejected", "RewardReserved", "DisputeRaised", "DisputeResolved", "RewardClaimed"];
  const logs = (await Promise.all(names.map((n) => c.queryFilter(c.filters[n](id), fromBlock())))).flat();
  return decorate(c, logs);
}

/** Recent platform-wide activity (admin view). */
export async function loadActivity(c, limit = 40) {
  const logs = await c.queryFilter("*", fromBlock());
  return decorate(c, logs.slice(-limit).reverse());
}

/** ProgramFunded / FundsWithdrawn history for a program. */
export async function loadProgramFunding(c, programId) {
  const logs = (
    await Promise.all([c.queryFilter(c.filters.ProgramFunded(programId), fromBlock()), c.queryFilter(c.filters.FundsWithdrawn(programId), fromBlock())])
  ).flat();
  return decorate(c, logs);
}

/** Rewards claimed by a researcher. */
export async function loadClaims(c, researcher) {
  const logs = await c.queryFilter(c.filters.RewardClaimed(null, researcher), fromBlock());
  return decorate(c, logs);
}

const blockTimeCache = new Map();
async function decorate(c, logs) {
  const provider = c.runner.provider || c.runner;
  const out = [];
  for (const l of logs) {
    if (!l.fragment) continue; // unknown event
    if (!blockTimeCache.has(l.blockNumber)) blockTimeCache.set(l.blockNumber, (await provider.getBlock(l.blockNumber)).timestamp);
    out.push({ name: l.fragment.name, args: l.args, hash: l.transactionHash, block: l.blockNumber, index: l.index, time: blockTimeCache.get(l.blockNumber) });
  }
  return out.sort((a, b) => a.block - b.block || a.index - b.index);
}

export function describeEvent(e) {
  const a = e.args;
  const eth = (v) => `${ethers.formatEther(v)} ETH`;
  switch (e.name) {
    case "OrganizationRegistered": return `Organization "${a.name}" registered`;
    case "OrganizationRevoked": return `Organization revoked`;
    case "DisputeResolverChanged": return `Dispute resolver set`;
    case "DisputeWindowChanged": return `Dispute window set to ${Number(a.newWindow) / 3600} h`;
    case "ProgramCreated": return `Program #${a.programId} "${a.title}" created`;
    case "ProgramFunded": return `Program #${a.programId} funded with ${eth(a.amount)}`;
    case "ProgramStatusChanged": return `Program #${a.programId} ${a.active ? "activated" : "deactivated"}`;
    case "FundsWithdrawn": return `${eth(a.amount)} withdrawn from program #${a.programId}`;
    case "VerifierAssigned": return `Verifier assigned to program #${a.programId}`;
    case "VerifierRemoved": return `Verifier removed from program #${a.programId}`;
    case "ReportSubmitted": return `Report #${a.submissionId} submitted to program #${a.programId}`;
    case "ReportApproved": return `Report #${a.submissionId} approved as ${SEVERITY[Number(a.severity)]}`;
    case "ReportRejected": return `Report #${a.submissionId} rejected`;
    case "RewardReserved": return `${eth(a.amount)} reserved for report #${a.submissionId}`;
    case "RewardClaimed": return `${eth(a.amount)} claimed for report #${a.submissionId}`;
    case "DisputeRaised": return `Dispute raised on report #${a.submissionId}`;
    case "DisputeResolved": return `Dispute on #${a.submissionId} ${a.overturned ? `overturned → ${SEVERITY[Number(a.severity)]}` : "— rejection upheld"}`;
    case "OwnershipTransferred": return `Platform admin set`;
    default: return e.name;
  }
}
