const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const E = (n) => ethers.parseEther(String(n));
const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const REWARDS = [E("0.1"), E("0.5"), E("1"), E("2")]; // Low, Medium, High, Critical
const Sev = { None: 0, Low: 1, Medium: 2, High: 3, Critical: 4 };
const St = { None: 0, Submitted: 1, Approved: 2, Rejected: 3, Disputed: 4, RejectionUpheld: 5, Claimed: 6 };
const DAY = 24 * 3600;

async function deployFixture() {
  const [admin, org, verifier, researcher, resolver, other, org2] = await ethers.getSigners();
  const Platform = await ethers.getContractFactory("BountyPlatform");
  const platform = await Platform.deploy(admin.address);
  return { platform, admin, org, verifier, researcher, resolver, other, org2 };
}

async function programFixture() {
  const f = await deployFixture();
  const { platform, org, verifier, resolver } = f;
  await platform.registerOrganization(org.address, "Acme Corp");
  await platform.setDisputeResolver(resolver.address);
  const now = await time.latest();
  await platform
    .connect(org)
    .createProgram("Acme Web", h("meta"), now, now + 30 * DAY, REWARDS, { value: E(5) });
  await platform.connect(org).assignVerifier(1, verifier.address);
  return { ...f, now };
}

async function submittedFixture() {
  const f = await programFixture();
  await f.platform.connect(f.researcher).submitReport(1, h("report-1"));
  return f;
}

async function rejectedFixture() {
  const f = await submittedFixture();
  await f.platform.connect(f.verifier).rejectReport(1, h("not reproducible"));
  return f;
}

describe("BountyPlatform", function () {
  // ------------------------------------------------------------------
  describe("Organization", function () {
    it("admin can register an organization", async function () {
      const { platform, org } = await loadFixture(deployFixture);
      await expect(platform.registerOrganization(org.address, "Acme"))
        .to.emit(platform, "OrganizationRegistered")
        .withArgs(org.address, "Acme");
      expect(await platform.isOrganization(org.address)).to.equal(true);
      expect(await platform.getOrganizations()).to.deep.equal([org.address]);
      expect((await platform.getOrganization(org.address)).name).to.equal("Acme");
    });

    it("unauthorized wallets cannot register organizations", async function () {
      const { platform, org, other } = await loadFixture(deployFixture);
      await expect(platform.connect(other).registerOrganization(org.address, "X"))
        .to.be.revertedWithCustomError(platform, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
    });

    it("rejects zero address, empty name, duplicates and admin-as-org", async function () {
      const { platform, admin, org } = await loadFixture(deployFixture);
      await expect(platform.registerOrganization(ethers.ZeroAddress, "X")).to.be.revertedWithCustomError(platform, "ZeroAddress");
      await expect(platform.registerOrganization(org.address, "")).to.be.revertedWithCustomError(platform, "EmptyValue");
      await expect(platform.registerOrganization(admin.address, "Admin")).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
      await platform.registerOrganization(org.address, "Acme");
      await expect(platform.registerOrganization(org.address, "Acme")).to.be.revertedWithCustomError(platform, "AlreadyRegistered");
    });

    it("revoked organizations cannot create programs; re-registration does not duplicate list", async function () {
      const { platform, org } = await loadFixture(deployFixture);
      await platform.registerOrganization(org.address, "Acme");
      await expect(platform.revokeOrganization(org.address)).to.emit(platform, "OrganizationRevoked");
      const now = await time.latest();
      await expect(
        platform.connect(org).createProgram("T", h("m"), now, now + DAY, REWARDS, { value: E(1) })
      ).to.be.revertedWithCustomError(platform, "NotOrganization");
      await platform.registerOrganization(org.address, "Acme 2");
      expect((await platform.getOrganizations()).length).to.equal(1);
    });

    it("unauthorized wallets cannot create programs", async function () {
      const { platform, other } = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(
        platform.connect(other).createProgram("T", h("m"), now, now + DAY, REWARDS, { value: E(1) })
      ).to.be.revertedWithCustomError(platform, "NotOrganization");
    });

    it("admin can set dispute resolver but not to itself or zero", async function () {
      const { platform, admin, resolver, other } = await loadFixture(deployFixture);
      await expect(platform.setDisputeResolver(resolver.address))
        .to.emit(platform, "DisputeResolverChanged")
        .withArgs(ethers.ZeroAddress, resolver.address);
      await expect(platform.setDisputeResolver(admin.address)).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
      await expect(platform.setDisputeResolver(ethers.ZeroAddress)).to.be.revertedWithCustomError(platform, "ZeroAddress");
      await expect(platform.connect(other).setDisputeResolver(other.address)).to.be.revertedWithCustomError(platform, "OwnableUnauthorizedAccount");
    });

    it("dispute window bounds are enforced", async function () {
      const { platform } = await loadFixture(deployFixture);
      await expect(platform.setDisputeWindow(60)).to.be.revertedWithCustomError(platform, "InvalidWindow");
      await expect(platform.setDisputeWindow(91 * DAY)).to.be.revertedWithCustomError(platform, "InvalidWindow");
      await platform.setDisputeWindow(3 * DAY);
      expect(await platform.disputeWindow()).to.equal(3 * DAY);
    });
  });

  // ------------------------------------------------------------------
  describe("Bounty programs", function () {
    it("authorized organizations can create programs with initial funding", async function () {
      const { platform, org } = await loadFixture(deployFixture);
      await platform.registerOrganization(org.address, "Acme");
      const now = await time.latest();
      await expect(platform.connect(org).createProgram("Acme Web", h("m"), now, now + DAY, REWARDS, { value: E(3) }))
        .to.emit(platform, "ProgramCreated")
        .and.to.emit(platform, "ProgramFunded")
        .withArgs(1, org.address, E(3), E(3));
      const p = await platform.getProgram(1);
      expect(p.owner).to.equal(org.address);
      expect(p.active).to.equal(true);
      expect(p.availableBalance).to.equal(E(3));
      expect(p.rewards.map((r) => r)).to.deep.equal(REWARDS);
      expect(await ethers.provider.getBalance(await platform.getAddress())).to.equal(E(3));
    });

    it("programs can receive additional funds (owner only)", async function () {
      const { platform, org, other } = await loadFixture(programFixture);
      await expect(platform.connect(org).fundProgram(1, { value: E(2) }))
        .to.emit(platform, "ProgramFunded")
        .withArgs(1, org.address, E(2), E(7));
      await expect(platform.connect(other).fundProgram(1, { value: E(1) })).to.be.revertedWithCustomError(platform, "NotProgramOwner");
      await expect(platform.connect(org).fundProgram(1, { value: 0 })).to.be.revertedWithCustomError(platform, "EmptyValue");
      await expect(platform.connect(org).fundProgram(99, { value: 1 })).to.be.revertedWithCustomError(platform, "ProgramNotFound");
    });

    it("empty or invalid program data is rejected", async function () {
      const { platform, org } = await loadFixture(deployFixture);
      await platform.registerOrganization(org.address, "Acme");
      const now = await time.latest();
      const c = platform.connect(org);
      await expect(c.createProgram("", h("m"), now, now + DAY, REWARDS, { value: 1 })).to.be.revertedWithCustomError(platform, "EmptyValue");
      await expect(c.createProgram("T", ethers.ZeroHash, now, now + DAY, REWARDS, { value: 1 })).to.be.revertedWithCustomError(platform, "EmptyValue");
      await expect(c.createProgram("T", h("m"), now + DAY, now, REWARDS, { value: 1 })).to.be.revertedWithCustomError(platform, "InvalidTimeRange");
      await expect(c.createProgram("T", h("m"), now - 10 * DAY, now - DAY, REWARDS, { value: 1 })).to.be.revertedWithCustomError(platform, "InvalidTimeRange");
      await expect(c.createProgram("T", h("m"), now, now + DAY, [0, 1, 2, 3], { value: 1 })).to.be.revertedWithCustomError(platform, "InvalidRewardTiers");
      await expect(c.createProgram("T", h("m"), now, now + DAY, [5, 4, 6, 7], { value: 1 })).to.be.revertedWithCustomError(platform, "InvalidRewardTiers");
      await expect(c.createProgram("T", h("m"), now, now + DAY, REWARDS, { value: 0 })).to.be.revertedWithCustomError(platform, "InsufficientPool");
    });

    it("inactive programs cannot accept submissions", async function () {
      const { platform, org, researcher } = await loadFixture(programFixture);
      await expect(platform.connect(org).setProgramActive(1, false)).to.emit(platform, "ProgramStatusChanged").withArgs(1, false);
      await expect(platform.connect(researcher).submitReport(1, h("r"))).to.be.revertedWithCustomError(platform, "ProgramNotOpen");
    });

    it("expired programs cannot accept submissions", async function () {
      const { platform, researcher } = await loadFixture(programFixture);
      await time.increase(31 * DAY);
      await expect(platform.connect(researcher).submitReport(1, h("r"))).to.be.revertedWithCustomError(platform, "ProgramNotOpen");
    });

    it("not-yet-started programs cannot accept submissions", async function () {
      const { platform, org, researcher } = await loadFixture(programFixture);
      const now = await time.latest();
      await platform.connect(org).createProgram("Future", h("m2"), now + 5 * DAY, now + 10 * DAY, REWARDS, { value: E(1) });
      await expect(platform.connect(researcher).submitReport(2, h("r"))).to.be.revertedWithCustomError(platform, "ProgramNotOpen");
    });

    it("plain ETH transfers to the contract are rejected", async function () {
      const { platform, other } = await loadFixture(deployFixture);
      await expect(other.sendTransaction({ to: await platform.getAddress(), value: 1 })).to.be.reverted;
    });
  });

  // ------------------------------------------------------------------
  describe("Verifier", function () {
    it("organizations can assign and remove verifiers", async function () {
      const { platform, org, other } = await loadFixture(programFixture);
      await expect(platform.connect(org).assignVerifier(1, other.address)).to.emit(platform, "VerifierAssigned").withArgs(1, other.address);
      expect(await platform.isVerifier(1, other.address)).to.equal(true);
      expect(await platform.getVerifierPrograms(other.address)).to.deep.equal([1n]);
      await expect(platform.connect(org).removeVerifier(1, other.address)).to.emit(platform, "VerifierRemoved");
      expect(await platform.isVerifier(1, other.address)).to.equal(false);
      expect(await platform.getVerifierPrograms(other.address)).to.deep.equal([]);
    });

    it("rejects invalid verifier management", async function () {
      const { platform, admin, org, verifier, other } = await loadFixture(programFixture);
      await expect(platform.connect(other).assignVerifier(1, other.address)).to.be.revertedWithCustomError(platform, "NotProgramOwner");
      await expect(platform.connect(org).assignVerifier(1, ethers.ZeroAddress)).to.be.revertedWithCustomError(platform, "ZeroAddress");
      await expect(platform.connect(org).assignVerifier(1, verifier.address)).to.be.revertedWithCustomError(platform, "AlreadyAssigned");
      await expect(platform.connect(org).assignVerifier(1, admin.address)).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
      await expect(platform.connect(org).removeVerifier(1, other.address)).to.be.revertedWithCustomError(platform, "NotAssigned");
    });

    it("unauthorized verifiers cannot review submissions (incl. admin and org)", async function () {
      const { platform, admin, org, other } = await loadFixture(submittedFixture);
      for (const s of [admin, org, other]) {
        await expect(platform.connect(s).approveReport(1, Sev.High, h("n"))).to.be.revertedWithCustomError(platform, "NotVerifier");
        await expect(platform.connect(s).rejectReport(1, h("n"))).to.be.revertedWithCustomError(platform, "NotVerifier");
      }
    });

    it("removed verifier loses review rights", async function () {
      const { platform, org, verifier } = await loadFixture(submittedFixture);
      await platform.connect(org).removeVerifier(1, verifier.address);
      await expect(platform.connect(verifier).approveReport(1, Sev.Low, h("n"))).to.be.revertedWithCustomError(platform, "NotVerifier");
    });

    it("verifiers cannot submit to their own program", async function () {
      const { platform, verifier, org } = await loadFixture(programFixture);
      await expect(platform.connect(verifier).submitReport(1, h("self"))).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
      await expect(platform.connect(org).submitReport(1, h("self2"))).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
    });

    it("verifiers cannot approve their own submissions (assigned after submitting)", async function () {
      const { platform, org, other } = await loadFixture(programFixture);
      await platform.connect(other).submitReport(1, h("mine"));
      await platform.connect(org).assignVerifier(1, other.address);
      await expect(platform.connect(other).approveReport(1, Sev.Critical, h("n"))).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
    });

    it("invalid review decisions are rejected", async function () {
      const { platform, verifier } = await loadFixture(submittedFixture);
      await expect(platform.connect(verifier).approveReport(1, Sev.None, h("n"))).to.be.revertedWithCustomError(platform, "InvalidSeverity");
      await expect(platform.connect(verifier).approveReport(1, 5, h("n"))).to.be.reverted; // out-of-range enum
      await expect(platform.connect(verifier).rejectReport(1, ethers.ZeroHash)).to.be.revertedWithCustomError(platform, "EmptyValue");
      await expect(platform.connect(verifier).approveReport(99, Sev.Low, h("n"))).to.be.revertedWithCustomError(platform, "SubmissionNotFound");
      await platform.connect(verifier).approveReport(1, Sev.Low, h("n"));
      // already reviewed -> invalid transition
      await expect(platform.connect(verifier).approveReport(1, Sev.High, h("n"))).to.be.revertedWithCustomError(platform, "InvalidStatus");
      await expect(platform.connect(verifier).rejectReport(1, h("n"))).to.be.revertedWithCustomError(platform, "InvalidStatus");
    });
  });

  // ------------------------------------------------------------------
  describe("Report submission", function () {
    it("researchers can submit reports to active programs and hash is recorded", async function () {
      const { platform, researcher } = await loadFixture(programFixture);
      const rh = h("full report json");
      await expect(platform.connect(researcher).submitReport(1, rh))
        .to.emit(platform, "ReportSubmitted")
        .withArgs(1, 1, researcher.address, rh);
      const s = await platform.getSubmission(1);
      expect(s.reportHash).to.equal(rh);
      expect(s.researcher).to.equal(researcher.address);
      expect(s.status).to.equal(St.Submitted);
      expect(s.submittedAt).to.be.greaterThan(0);
      expect(await platform.reportHashUsed(rh)).to.equal(true);
      expect(await platform.getResearcherSubmissions(researcher.address)).to.deep.equal([1n]);
      expect(await platform.getProgramSubmissions(1)).to.deep.equal([1n]);
    });

    it("duplicate report hashes are rejected (even from another researcher)", async function () {
      const { platform, researcher, other } = await loadFixture(submittedFixture);
      await expect(platform.connect(researcher).submitReport(1, h("report-1"))).to.be.revertedWithCustomError(platform, "DuplicateReport");
      await expect(platform.connect(other).submitReport(1, h("report-1"))).to.be.revertedWithCustomError(platform, "DuplicateReport");
    });

    it("zero hash and unknown programs are rejected", async function () {
      const { platform, researcher } = await loadFixture(programFixture);
      await expect(platform.connect(researcher).submitReport(1, ethers.ZeroHash)).to.be.revertedWithCustomError(platform, "EmptyValue");
      await expect(platform.connect(researcher).submitReport(7, h("x"))).to.be.revertedWithCustomError(platform, "ProgramNotFound");
    });

    it("sensitive report contents are not stored in the smart contract", async function () {
      const { platform, researcher } = await loadFixture(programFixture);
      const secret = "SQL injection in /login via ' OR 1=1 -- payload";
      const tx = await platform.connect(researcher).submitReport(1, h(secret));
      const receipt = await tx.wait();
      // 1) the function ABI accepts only a bytes32 hash, not text
      const frag = platform.interface.getFunction("submitReport");
      expect(frag.inputs.map((i) => i.type)).to.deep.equal(["uint256", "bytes32"]);
      // 2) calldata and logs do not contain the plaintext
      const secretHex = ethers.hexlify(ethers.toUtf8Bytes(secret)).slice(2);
      const txData = (await ethers.provider.getTransaction(receipt.hash)).data;
      expect(txData.includes(secretHex)).to.equal(false);
      for (const log of receipt.logs) expect(log.data.includes(secretHex)).to.equal(false);
      // 3) stored struct only exposes a hash
      const s = await platform.getSubmission(1);
      expect(s.reportHash).to.equal(h(secret));
    });
  });

  // ------------------------------------------------------------------
  describe("Rewards", function () {
    it("approval reserves exactly the tier reward and researcher can claim it", async function () {
      const { platform, verifier, researcher } = await loadFixture(submittedFixture);
      await expect(platform.connect(verifier).approveReport(1, Sev.High, h("ok")))
        .to.emit(platform, "ReportApproved")
        .withArgs(1, verifier.address, Sev.High, h("ok"))
        .and.to.emit(platform, "RewardReserved")
        .withArgs(1, researcher.address, REWARDS[2]);
      let p = await platform.getProgram(1);
      expect(p.availableBalance).to.equal(E(5) - REWARDS[2]);
      expect(p.reservedBalance).to.equal(REWARDS[2]);
      expect((await platform.getSubmission(1)).reward).to.equal(REWARDS[2]);

      const claimTx = platform.connect(researcher).claimReward(1);
      await expect(claimTx).to.changeEtherBalances([researcher, platform], [REWARDS[2], -REWARDS[2]]);
      await expect(claimTx).to.emit(platform, "RewardClaimed").withArgs(1, researcher.address, REWARDS[2]);
      expect((await platform.getSubmission(1)).status).to.equal(St.Claimed);
    });

    it("each severity maps to the predefined tier", async function () {
      const { platform, verifier, researcher } = await loadFixture(programFixture);
      for (let sev = 1; sev <= 4; sev++) {
        await platform.connect(researcher).submitReport(1, h("r" + sev));
        await platform.connect(verifier).approveReport(sev, sev, h("n"));
        expect((await platform.getSubmission(sev)).reward).to.equal(REWARDS[sev - 1]);
      }
    });

    it("rejected researchers cannot claim rewards", async function () {
      const { platform, researcher } = await loadFixture(rejectedFixture);
      await expect(platform.connect(researcher).claimReward(1)).to.be.revertedWithCustomError(platform, "InvalidStatus");
    });

    it("pending (unreviewed) reports cannot be claimed", async function () {
      const { platform, researcher } = await loadFixture(submittedFixture);
      await expect(platform.connect(researcher).claimReward(1)).to.be.revertedWithCustomError(platform, "InvalidStatus");
    });

    it("unauthorized users cannot claim another researcher's reward", async function () {
      const { platform, verifier, other, org } = await loadFixture(submittedFixture);
      await platform.connect(verifier).approveReport(1, Sev.Low, h("n"));
      await expect(platform.connect(other).claimReward(1)).to.be.revertedWithCustomError(platform, "NotResearcher");
      await expect(platform.connect(org).claimReward(1)).to.be.revertedWithCustomError(platform, "NotResearcher");
    });

    it("rewards cannot be claimed twice", async function () {
      const { platform, verifier, researcher } = await loadFixture(submittedFixture);
      await platform.connect(verifier).approveReport(1, Sev.Medium, h("n"));
      await platform.connect(researcher).claimReward(1);
      await expect(platform.connect(researcher).claimReward(1)).to.be.revertedWithCustomError(platform, "InvalidStatus");
    });

    it("insufficient reward funding prevents an invalid payout", async function () {
      const { platform, org, verifier, researcher } = await loadFixture(deployFixture);
      await platform.registerOrganization(org.address, "Acme");
      const now = await time.latest();
      await platform.connect(org).createProgram("Small", h("m"), now, now + DAY, REWARDS, { value: E("0.6") });
      await platform.connect(org).assignVerifier(1, verifier.address);
      await platform.connect(researcher).submitReport(1, h("a"));
      await platform.connect(researcher).submitReport(1, h("b"));
      // Critical = 2 ETH > 0.6 ETH available
      await expect(platform.connect(verifier).approveReport(1, Sev.Critical, h("n"))).to.be.revertedWithCustomError(platform, "InsufficientPool");
      await platform.connect(verifier).approveReport(1, Sev.Medium, h("n")); // 0.5 reserved, 0.1 left
      await expect(platform.connect(verifier).approveReport(2, Sev.Medium, h("n"))).to.be.revertedWithCustomError(platform, "InsufficientPool");
      // Organisation tops up, then approval succeeds
      await platform.connect(org).fundProgram(1, { value: E(1) });
      await platform.connect(verifier).approveReport(2, Sev.Medium, h("n"));
      const p = await platform.getProgram(1);
      expect(p.reservedBalance).to.equal(E(1));
      expect(p.availableBalance).to.equal(E("0.6"));
    });

    it("reward accounting remains correct after claims", async function () {
      const { platform, verifier, researcher, other } = await loadFixture(programFixture);
      await platform.connect(researcher).submitReport(1, h("a"));
      await platform.connect(other).submitReport(1, h("b"));
      await platform.connect(verifier).approveReport(1, Sev.Critical, h("n")); // 2
      await platform.connect(verifier).approveReport(2, Sev.Low, h("n")); // 0.1
      await platform.connect(researcher).claimReward(1);
      let p = await platform.getProgram(1);
      expect(p.availableBalance).to.equal(E("2.9"));
      expect(p.reservedBalance).to.equal(E("0.1"));
      expect(p.totalPaid).to.equal(E(2));
      await platform.connect(other).claimReward(2);
      p = await platform.getProgram(1);
      expect(p.reservedBalance).to.equal(0);
      expect(p.totalPaid).to.equal(E("2.1"));
      expect(await platform.totalRewardsDistributed()).to.equal(E("2.1"));
      // invariant: contract balance == available + reserved across programs
      expect(await ethers.provider.getBalance(await platform.getAddress())).to.equal(p.availableBalance + p.reservedBalance);
      const stats = await platform.getStats();
      expect(stats.distributed).to.equal(E("2.1"));
      expect(stats.submissions).to.equal(2);
    });

    it("failed transfer reverts and leaves accounting intact (contract researcher without receive)", async function () {
      const { platform, verifier } = await loadFixture(programFixture);
      const Rej = await ethers.getContractFactory("RejectingResearcher");
      const rej = await Rej.deploy(await platform.getAddress());
      await rej.submit(1, h("contract-report"));
      await platform.connect(verifier).approveReport(1, Sev.Low, h("n"));
      await expect(rej.claim(1)).to.be.revertedWithCustomError(platform, "TransferFailed");
      const s = await platform.getSubmission(1);
      expect(s.status).to.equal(St.Approved);
      expect((await platform.getProgram(1)).reservedBalance).to.equal(REWARDS[0]);
    });

    it("reentrant claim attempts are blocked", async function () {
      const { platform, verifier } = await loadFixture(programFixture);
      const Att = await ethers.getContractFactory("ReentrantResearcher");
      const att = await Att.deploy(await platform.getAddress());
      await att.submit(1, h("evil-report"));
      await platform.connect(verifier).approveReport(1, Sev.Low, h("n"));
      // reentry inside receive() fails -> outer call's transfer fails -> TransferFailed
      await expect(att.attack(1)).to.be.revertedWithCustomError(platform, "TransferFailed");
      expect((await platform.getProgram(1)).reservedBalance).to.equal(REWARDS[0]);
    });

    it("organisation can withdraw only unreserved funds after program closes and windows pass", async function () {
      const { platform, org, verifier, researcher } = await loadFixture(programFixture);
      await platform.connect(researcher).submitReport(1, h("a"));
      await platform.connect(researcher).submitReport(1, h("b"));
      await platform.connect(verifier).approveReport(1, Sev.High, h("n")); // 1 reserved
      await expect(platform.connect(org).withdrawUnreserved(1, E(1))).to.be.revertedWithCustomError(platform, "FundsLocked"); // still active
      await platform.connect(org).setProgramActive(1, false);
      await expect(platform.connect(org).withdrawUnreserved(1, E(1))).to.be.revertedWithCustomError(platform, "FundsLocked"); // pending review
      await platform.connect(verifier).rejectReport(2, h("dup"));
      await expect(platform.connect(org).withdrawUnreserved(1, E(1))).to.be.revertedWithCustomError(platform, "FundsLocked"); // dispute window
      await time.increase(7 * DAY + 1);
      await expect(platform.connect(org).withdrawUnreserved(1, E(5))).to.be.revertedWithCustomError(platform, "InsufficientPool");
      const wTx = platform.connect(org).withdrawUnreserved(1, E(4));
      await expect(wTx).to.changeEtherBalance(org, E(4));
      await expect(wTx).to.emit(platform, "FundsWithdrawn").withArgs(1, org.address, E(4));
      // reserved reward still claimable
      await expect(platform.connect(researcher).claimReward(1)).to.changeEtherBalance(researcher, E(1));
    });
  });

  // ------------------------------------------------------------------
  describe("Dispute resolution", function () {
    it("researchers can dispute eligible rejected reports", async function () {
      const { platform, researcher } = await loadFixture(rejectedFixture);
      await expect(platform.connect(researcher).raiseDispute(1, h("evidence")))
        .to.emit(platform, "DisputeRaised")
        .withArgs(1, researcher.address, h("evidence"));
      expect((await platform.getSubmission(1)).status).to.equal(St.Disputed);
      const d = await platform.getDispute(1);
      expect(d.status).to.equal(1); // Open
      expect(await platform.getDisputedSubmissions()).to.deep.equal([1n]);
    });

    it("unauthorized users cannot raise disputes", async function () {
      const { platform, other, verifier } = await loadFixture(rejectedFixture);
      await expect(platform.connect(other).raiseDispute(1, h("e"))).to.be.revertedWithCustomError(platform, "NotResearcher");
      await expect(platform.connect(verifier).raiseDispute(1, h("e"))).to.be.revertedWithCustomError(platform, "NotResearcher");
    });

    it("only rejected reports within the window and with evidence can be disputed", async function () {
      const { platform, researcher, verifier } = await loadFixture(submittedFixture);
      await expect(platform.connect(researcher).raiseDispute(1, h("e"))).to.be.revertedWithCustomError(platform, "InvalidStatus");
      await platform.connect(verifier).rejectReport(1, h("no"));
      await expect(platform.connect(researcher).raiseDispute(1, ethers.ZeroHash)).to.be.revertedWithCustomError(platform, "EmptyValue");
      await time.increase(7 * DAY + 1);
      await expect(platform.connect(researcher).raiseDispute(1, h("e"))).to.be.revertedWithCustomError(platform, "DisputeWindowClosed");
    });

    it("duplicate disputes are prevented", async function () {
      const { platform, researcher } = await loadFixture(rejectedFixture);
      await platform.connect(researcher).raiseDispute(1, h("e"));
      await expect(platform.connect(researcher).raiseDispute(1, h("e2"))).to.be.revertedWithCustomError(platform, "DisputeAlreadyExists");
    });

    it("only the dispute resolver can finalize a dispute", async function () {
      const { platform, researcher, admin, org, verifier, other } = await loadFixture(rejectedFixture);
      await platform.connect(researcher).raiseDispute(1, h("e"));
      for (const s of [admin, org, verifier, other, researcher]) {
        await expect(platform.connect(s).resolveDispute(1, true, Sev.High, h("r"))).to.be.revertedWithCustomError(platform, "NotDisputeResolver");
      }
    });

    it("resolver can uphold the rejection (final, no reward)", async function () {
      const { platform, researcher, resolver } = await loadFixture(rejectedFixture);
      await platform.connect(researcher).raiseDispute(1, h("e"));
      await expect(platform.connect(resolver).resolveDispute(1, false, Sev.High, h("r"))).to.be.revertedWithCustomError(platform, "InvalidSeverity");
      await expect(platform.connect(resolver).resolveDispute(1, false, Sev.None, ethers.ZeroHash)).to.be.revertedWithCustomError(platform, "EmptyValue");
      await expect(platform.connect(resolver).resolveDispute(1, false, Sev.None, h("r")))
        .to.emit(platform, "DisputeResolved")
        .withArgs(1, resolver.address, false, Sev.None, h("r"));
      expect((await platform.getSubmission(1)).status).to.equal(St.RejectionUpheld);
      expect((await platform.getDispute(1)).status).to.equal(2); // Upheld
      await expect(platform.connect(researcher).claimReward(1)).to.be.revertedWithCustomError(platform, "InvalidStatus");
    });

    it("resolved disputes cannot be reopened", async function () {
      const { platform, researcher, resolver } = await loadFixture(rejectedFixture);
      await platform.connect(researcher).raiseDispute(1, h("e"));
      await platform.connect(resolver).resolveDispute(1, false, Sev.None, h("r"));
      await expect(platform.connect(researcher).raiseDispute(1, h("e2"))).to.be.revertedWithCustomError(platform, "DisputeAlreadyExists");
      await expect(platform.connect(resolver).resolveDispute(1, true, Sev.Low, h("r2"))).to.be.revertedWithCustomError(platform, "InvalidStatus");
    });

    it("successful dispute outcomes follow the correct reward workflow", async function () {
      const { platform, researcher, resolver } = await loadFixture(rejectedFixture);
      await platform.connect(researcher).raiseDispute(1, h("e"));
      await expect(platform.connect(resolver).resolveDispute(1, true, Sev.None, h("r"))).to.be.revertedWithCustomError(platform, "InvalidSeverity");
      await expect(platform.connect(resolver).resolveDispute(1, true, Sev.Critical, h("valid")))
        .to.emit(platform, "DisputeResolved")
        .withArgs(1, resolver.address, true, Sev.Critical, h("valid"))
        .and.to.emit(platform, "RewardReserved")
        .withArgs(1, researcher.address, REWARDS[3]);
      const s = await platform.getSubmission(1);
      expect(s.status).to.equal(St.Approved);
      expect(s.severity).to.equal(Sev.Critical);
      expect((await platform.getDispute(1)).status).to.equal(3); // Overturned
      await expect(platform.connect(researcher).claimReward(1)).to.changeEtherBalance(researcher, REWARDS[3]);
      expect((await platform.getSubmission(1)).status).to.equal(St.Claimed);
    });

    it("resolver cannot resolve a dispute on their own submission", async function () {
      const { platform, resolver, verifier } = await loadFixture(programFixture);
      await platform.connect(resolver).submitReport(1, h("resolver-report"));
      await platform.connect(verifier).rejectReport(1, h("no"));
      await platform.connect(resolver).raiseDispute(1, h("e"));
      await expect(platform.connect(resolver).resolveDispute(1, true, Sev.High, h("r"))).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
    });

    it("dispute overturn also respects pool limits", async function () {
      const { platform, org, verifier, researcher, resolver } = await loadFixture(deployFixture);
      await platform.registerOrganization(org.address, "Acme");
      await platform.setDisputeResolver(resolver.address);
      const now = await time.latest();
      await platform.connect(org).createProgram("Small", h("m"), now, now + DAY, REWARDS, { value: E("0.2") });
      await platform.connect(org).assignVerifier(1, verifier.address);
      await platform.connect(researcher).submitReport(1, h("a"));
      await platform.connect(verifier).rejectReport(1, h("no"));
      await platform.connect(researcher).raiseDispute(1, h("e"));
      await expect(platform.connect(resolver).resolveDispute(1, true, Sev.High, h("r"))).to.be.revertedWithCustomError(platform, "InsufficientPool");
    });
  });

  // ------------------------------------------------------------------
  describe("Regression (bug-fix) tests", function () {
    it("dispute window is fixed at rejection time (admin change is not retroactive)", async function () {
      const { platform, researcher, verifier } = await loadFixture(submittedFixture);
      await platform.connect(verifier).rejectReport(1, h("no"));
      const deadline = await platform.disputeDeadline(1);
      expect(deadline).to.equal(BigInt(await time.latest()) + BigInt(7 * DAY));
      await platform.setDisputeWindow(3600); // shorten to 1h
      await time.increase(2 * DAY); // past the new window, inside the old one
      await expect(platform.connect(researcher).raiseDispute(1, h("e"))).to.emit(platform, "DisputeRaised");
    });

    it("withdraw lock follows the latest stored dispute deadline", async function () {
      const { platform, org, verifier } = await loadFixture(submittedFixture);
      await platform.connect(verifier).rejectReport(1, h("no"));
      await platform.connect(org).setProgramActive(1, false);
      await platform.setDisputeWindow(3600);
      await time.increase(2 * DAY);
      await expect(platform.connect(org).withdrawUnreserved(1, E(1))).to.be.revertedWithCustomError(platform, "FundsLocked");
      await time.increase(5 * DAY + 1);
      await expect(platform.connect(org).withdrawUnreserved(1, E(1))).to.emit(platform, "FundsWithdrawn");
    });

    it("organisation cannot assign itself as verifier", async function () {
      const { platform, org } = await loadFixture(programFixture);
      await expect(platform.connect(org).assignVerifier(1, org.address)).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
    });

    it("resolver cannot be the original reviewer, the program owner or a program verifier", async function () {
      const { platform, admin, org, verifier, researcher, other } = await loadFixture(rejectedFixture);
      await platform.connect(researcher).raiseDispute(1, h("e"));
      // resolver == original reviewer
      await platform.connect(admin).setDisputeResolver(verifier.address);
      await expect(platform.connect(verifier).resolveDispute(1, true, Sev.High, h("r"))).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
      // resolver == program owner
      await platform.connect(admin).setDisputeResolver(org.address);
      await expect(platform.connect(org).resolveDispute(1, true, Sev.High, h("r"))).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
      // resolver == another verifier of the same program
      await platform.connect(org).assignVerifier(1, other.address);
      await platform.connect(admin).setDisputeResolver(other.address);
      await expect(platform.connect(other).resolveDispute(1, true, Sev.High, h("r"))).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
    });

    it("admin role cannot be transferred to an organisation, resolver or verifier", async function () {
      const { platform, admin, org, verifier, resolver, other } = await loadFixture(programFixture);
      for (const s of [org, verifier, resolver]) {
        await platform.connect(admin).transferOwnership(s.address);
        await expect(platform.connect(s).acceptOwnership()).to.be.revertedWithCustomError(platform, "ConflictOfInterest");
      }
      await platform.connect(admin).transferOwnership(other.address);
      await platform.connect(other).acceptOwnership();
      expect(await platform.owner()).to.equal(other.address);
    });

    it("ReportApproved is emitted before RewardReserved (readable timelines)", async function () {
      const { platform, verifier } = await loadFixture(submittedFixture);
      const rc = await (await platform.connect(verifier).approveReport(1, Sev.Low, h("n"))).wait();
      const names = rc.logs.map((l) => platform.interface.parseLog(l).name);
      expect(names).to.deep.equal(["ReportApproved", "RewardReserved"]);
    });
  });

  describe("Roles view", function () {
    it("getRoles reports on-chain roles", async function () {
      const { platform, admin, org, verifier, resolver, researcher } = await loadFixture(programFixture);
      expect(await platform.getRoles(admin.address)).to.deep.equal([true, false, false, 0n]);
      expect(await platform.getRoles(org.address)).to.deep.equal([false, true, false, 0n]);
      expect(await platform.getRoles(verifier.address)).to.deep.equal([false, false, false, 1n]);
      expect(await platform.getRoles(resolver.address)).to.deep.equal([false, false, true, 0n]);
      expect(await platform.getRoles(researcher.address)).to.deep.equal([false, false, false, 0n]);
    });
  });
});
