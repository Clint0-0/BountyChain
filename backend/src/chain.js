// Read-only access to the BountyPlatform contract. The backend never holds a
// private key; it only READS on-chain state to make authorisation decisions.
const { ethers } = require("ethers");
const fs = require("fs");

const SubmissionStatus = ["None", "Submitted", "Approved", "Rejected", "Disputed", "RejectionUpheld", "Claimed"];
const DisputeStatus = ["None", "Open", "Upheld", "Overturned"];

function createChainReader({ rpcUrl, contractFile }) {
  if (!fs.existsSync(contractFile)) {
    throw new Error(`Contract file ${contractFile} not found. Deploy the contract first (blockchain: npm run deploy:local).`);
  }
  const dep = JSON.parse(fs.readFileSync(contractFile, "utf8"));
  // cacheTimeout -1: never serve cached eth_call results for authorisation decisions
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
  const c = new ethers.Contract(dep.address, dep.abi, provider);
  const lc = (a) => a.toLowerCase();

  return {
    address: dep.address,
    provider,
    chainId: dep.chainId,
    async isOrganization(addr) {
      return c.isOrganization(addr);
    },
    async disputeResolver() {
      return lc(await c.disputeResolver());
    },
    async isVerifier(programId, addr) {
      return c.isVerifier(programId, addr);
    },
    async getProgram(id) {
      try {
        const p = await c.getProgram(id);
        return { id: Number(p.id), owner: lc(p.owner), active: p.active, startTime: Number(p.startTime), endTime: Number(p.endTime), metadataHash: p.metadataHash };
      } catch (e) {
        if (e.revert?.name === "ProgramNotFound") return null;
        throw e;
      }
    },
    async getSubmission(id) {
      try {
        const s = await c.getSubmission(id);
        return {
          id: Number(s.id),
          programId: Number(s.programId),
          researcher: lc(s.researcher),
          reportHash: s.reportHash,
          status: SubmissionStatus[Number(s.status)],
          reviewNoteHash: s.reviewNoteHash,
        };
      } catch (e) {
        if (e.revert?.name === "SubmissionNotFound") return null;
        throw e;
      }
    },
    async getDispute(id) {
      const d = await c.getDispute(id);
      return { status: DisputeStatus[Number(d.status)], evidenceHash: d.evidenceHash, resolutionNoteHash: d.resolutionNoteHash };
    },
  };
}

module.exports = { createChainReader };
