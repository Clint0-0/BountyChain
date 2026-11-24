/**
 * End-to-end integration check against a RUNNING local stack:
 *   - Hardhat node on RPC_URL (default http://127.0.0.1:8545)
 *   - contract deployed (backend/contract/BountyPlatform.json)
 *   - backend on API_URL (default http://localhost:4000)
 *
 * Uses Hardhat's unlocked default accounts:
 *   #0 admin, #1 organisation, #2 verifier, #3 researcher, #4 dispute resolver, #5 stranger
 *
 * Every step sends a REAL transaction / HTTP request and asserts the result.
 * Run: npm run e2e   (from backend/)
 */
const { ethers } = require("ethers");
const assert = require("assert/strict");
const dep = require("../contract/BountyPlatform.json");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const API = process.env.API_URL || "http://localhost:4000";
const provider = new ethers.JsonRpcProvider(RPC);
const E = ethers.parseEther;
let step = 0;
const log = (msg) => console.log(`\n[${++step}] ${msg}`);
const ok = (msg) => console.log(`    ✔ ${msg}`);

async function http(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(signer) {
  const addr = await signer.getAddress();
  const n = await http(`/api/auth/nonce?address=${addr}`);
  const signature = await signer.signMessage(n.body.message);
  const v = await http("/api/auth/verify", { method: "POST", body: { address: addr, signature } });
  assert.equal(v.status, 200, "login failed");
  return v.body.token;
}

async function send(label, p) {
  const tx = await p;
  const r = await tx.wait();
  assert.equal(r.status, 1);
  ok(`${label} — tx ${r.hash} (block ${r.blockNumber})`);
  return r;
}

const IFACE = new ethers.Interface(dep.abi);
function revertName(e) {
  if (e.revert?.name) return e.revert.name;
  for (const d of [e.data, e.info?.error?.data?.data, e.info?.error?.data, e.error?.data]) {
    if (typeof d === "string" && d.length >= 10) {
      try { return IFACE.parseError(d).name; } catch { /* ignore */ }
    }
  }
  const m = JSON.stringify(e.info || e.error || e.message || "").match(/custom error '(\w+)\(/);
  return m ? m[1] : undefined;
}

async function expectRevert(label, p, errName) {
  try {
    const tx = await p;
    await tx.wait();
  } catch (e) {
    const name = revertName(e);
    if (errName) assert.equal(name, errName, `${label}: expected ${errName} got ${name || e.shortMessage}`);
    ok(`${label} rejected (${name || e.shortMessage})`);
    return;
  }
  throw new Error(`${label} should have reverted`);
}

function parse(c, receipt, name) {
  return receipt.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === name);
}

const REPORT = (title) => ({
  title,
  description: "Parameter `id` in /api/orders is concatenated into a SQL query without sanitisation.",
  affectedComponent: "/api/orders?id=",
  stepsToReproduce: "1. Login as any user\n2. GET /api/orders?id=1 OR 1=1\n3. Observe all orders returned",
  proofOfConcept: "curl 'https://shop.acme.test/api/orders?id=1%20OR%201=1'",
  impact: "Disclosure of every customer's order history and addresses.",
  suggestedSeverity: "High",
  additionalNotes: "Found during e2e test",
});

async function main() {
  const [admin, org, verifier, researcher, resolver, stranger] = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => provider.getSigner(i)));
  const C = (s) => new ethers.Contract(dep.address, dep.abi, s);
  const addr = { org: await org.getAddress(), verifier: await verifier.getAddress(), researcher: await researcher.getAddress(), resolver: await resolver.getAddress() };
  console.log(`Contract ${dep.address} on chain ${dep.chainId}`);

  // ---------------------------------------------------------------- admin
  log("Admin registers organization & dispute resolver");
  await expectRevert("Stranger registerOrganization", C(stranger).registerOrganization(addr.org, "Fake"), "OwnableUnauthorizedAccount");
  if (!(await C(admin).isOrganization(addr.org))) await send("registerOrganization", C(admin).registerOrganization(addr.org, "Acme Security Labs"));
  if ((await C(admin).disputeResolver()) !== addr.resolver) await send("setDisputeResolver", C(admin).setDisputeResolver(addr.resolver));
  await expectRevert("Admin as resolver", C(admin).setDisputeResolver(await admin.getAddress()), "ConflictOfInterest");

  // ---------------------------------------------------------------- org
  log("Organization publishes metadata off-chain, creates & funds program on-chain");
  const orgToken = await login(org);
  const strangerToken = await login(stranger);
  const meta = { title: "Acme Shop E2E", organizationName: "Acme Security Labs", description: "Bug bounty for the Acme web shop and its REST API.", targetSystem: "https://shop.acme.test", inScope: "shop.acme.test, /api/*", outOfScope: "DoS, social engineering, third-party services", rules: "Test only with your own accounts. Report within 24h. No data exfiltration." };
  assert.equal((await http("/api/programs/metadata", { method: "POST", body: meta, token: strangerToken })).status, 403);
  ok("Stranger cannot publish program metadata (403)");
  const m = await http("/api/programs/metadata", { method: "POST", body: meta, token: orgToken });
  assert.equal(m.status, 201);
  const now = (await provider.getBlock("latest")).timestamp;
  const rewards = [E("0.1"), E("0.5"), E("1"), E("2")];
  await expectRevert("Stranger createProgram", C(stranger).createProgram("x", m.body.metadataHash, now, now + 86400, rewards, { value: E("1") }), "NotOrganization");
  const rc = await send("createProgram (5 ETH pool)", C(org).createProgram(meta.title, m.body.metadataHash, now, now + 30 * 86400, rewards, { value: E("5") }));
  const programId = parse(C(org), rc, "ProgramCreated").args.programId;
  await send("fundProgram +1 ETH", C(org).fundProgram(programId, { value: E("1") }));
  await send("assignVerifier", C(org).assignVerifier(programId, addr.verifier));
  let p = await C(org).getProgram(programId);
  assert.equal(p.availableBalance, E("6"));
  ok(`Program #${programId} pool = ${ethers.formatEther(p.availableBalance)} ETH`);

  // ---------------------------------------------------------------- researcher
  log("Researcher submits encrypted report off-chain and anchors hash on-chain");
  const rToken = await login(researcher);
  const vToken = await login(verifier);
  const resToken = await login(resolver);
  async function submitReport(title) {
    const r = await http("/api/reports", { method: "POST", body: { ...REPORT(title), programId: Number(programId) }, token: rToken });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const receipt = await send(`submitReport "${title}"`, C(researcher).submitReport(programId, r.body.reportHash));
    const id = parse(C(researcher), receipt, "ReportSubmitted").args.submissionId;
    const s = await C(researcher).getSubmission(id);
    assert.equal(s.reportHash, r.body.reportHash);
    ok(`On-chain reportHash matches backend hash ${r.body.reportHash.slice(0, 18)}…`);
    return id;
  }
  const s1 = await submitReport("SQL injection in orders API");
  await expectRevert("Verifier submits to own program", C(verifier).submitReport(programId, ethers.id("v")), "ConflictOfInterest");
  await expectRevert("Duplicate hash", C(stranger).submitReport(programId, (await C(admin).getSubmission(s1)).reportHash), "DuplicateReport");

  log("Confidential access control");
  assert.equal((await http(`/api/submissions/${s1}/report`, { token: strangerToken })).status, 403);
  ok("Stranger denied (403)");
  assert.equal((await http(`/api/submissions/${s1}/report`, { token: resToken })).status, 403);
  ok("Resolver denied while no dispute exists (403)");
  assert.equal((await http(`/api/submissions/${s1}/report`)).status, 401);
  ok("Unauthenticated denied (401)");
  for (const [name, t] of [["researcher", rToken], ["organization", orgToken], ["verifier", vToken]]) {
    const r = await http(`/api/submissions/${s1}/report`, { token: t });
    assert.equal(r.status, 200);
    assert.equal(r.body.integrity.verified, true);
    ok(`${name} reads report, integrity verified against chain`);
  }

  // ---------------------------------------------------------------- verify + reward
  log("Verifier approves with severity High → contract reserves tier reward");
  await expectRevert("Admin approves", C(admin).approveReport(s1, 3, ethers.id("n")), "NotVerifier");
  await expectRevert("Org approves", C(org).approveReport(s1, 3, ethers.id("n")), "NotVerifier");
  const note = await http(`/api/submissions/${s1}/documents`, { method: "POST", body: { kind: "review_note", content: "Reproduced on staging. High severity." }, token: vToken });
  assert.equal(note.status, 201);
  const ra = await send("approveReport(High)", C(verifier).approveReport(s1, 3, note.body.docHash));
  assert.equal(parse(C(verifier), ra, "RewardReserved").args.amount, E("1"));
  ok("RewardReserved = 1 ETH (High tier)");
  await expectRevert("Stranger claims", C(stranger).claimReward(s1), "NotResearcher");
  const rcClaim = await send("claimReward", C(researcher).claimReward(s1));
  const before = await provider.getBalance(addr.researcher, rcClaim.blockNumber - 1);
  const after = await provider.getBalance(addr.researcher, rcClaim.blockNumber);
  const gas = rcClaim.gasUsed * rcClaim.gasPrice;
  assert.equal(after - before + gas, E("1"));
  ok("Researcher balance increased by exactly 1 ETH (+gas accounted)");
  await expectRevert("Double claim", C(researcher).claimReward(s1), "InvalidStatus");

  // ---------------------------------------------------------------- dispute overturn
  log("Rejected report → dispute → resolver overturns (Critical) → claim");
  const s2 = await submitReport("Auth bypass via JWT alg none");
  const rn = await http(`/api/submissions/${s2}/documents`, { method: "POST", body: { kind: "review_note", content: "Could not reproduce." }, token: vToken });
  await send("rejectReport", C(verifier).rejectReport(s2, rn.body.docHash));
  await expectRevert("Claim rejected", C(researcher).claimReward(s2), "InvalidStatus");
  await expectRevert("Stranger disputes", C(stranger).raiseDispute(s2, ethers.id("e")), "NotResearcher");
  const ev = await http(`/api/submissions/${s2}/documents`, { method: "POST", body: { kind: "dispute_evidence", content: "Verifier tested wrong endpoint; see attached video link." }, token: rToken });
  assert.equal(ev.status, 201);
  await send("raiseDispute", C(researcher).raiseDispute(s2, ev.body.docHash));
  await expectRevert("Duplicate dispute", C(researcher).raiseDispute(s2, ethers.id("e2")), "DisputeAlreadyExists");
  const rr = await http(`/api/submissions/${s2}/report`, { token: resToken });
  assert.equal(rr.status, 200);
  assert.equal(rr.body.documents.length, 2);
  ok("Resolver can now read report + verifier note + evidence");
  await expectRevert("Verifier resolves", C(verifier).resolveDispute(s2, true, 4, ethers.id("x")), "NotDisputeResolver");
  const resNote = await http(`/api/submissions/${s2}/documents`, { method: "POST", body: { kind: "resolution_note", content: "Valid. Overturned as Critical." }, token: resToken });
  await send("resolveDispute(overturn, Critical)", C(resolver).resolveDispute(s2, true, 4, resNote.body.docHash));
  const d = await C(admin).getDispute(s2);
  assert.equal(Number(d.status), 3);
  ok("Dispute status Overturned recorded on-chain");
  await send("claimReward (2 ETH)", C(researcher).claimReward(s2));
  await expectRevert("Reopen resolved dispute", C(researcher).raiseDispute(s2, ethers.id("again")), "DisputeAlreadyExists");

  // ---------------------------------------------------------------- dispute upheld
  log("Rejected report → dispute → resolver upholds");
  const s3 = await submitReport("Self-XSS in search box");
  const rn3 = await http(`/api/submissions/${s3}/documents`, { method: "POST", body: { kind: "review_note", content: "Self-XSS is out of scope." }, token: vToken });
  await send("rejectReport", C(verifier).rejectReport(s3, rn3.body.docHash));
  const ev3 = await http(`/api/submissions/${s3}/documents`, { method: "POST", body: { kind: "dispute_evidence", content: "It can be chained with CSRF for stored impact." }, token: rToken });
  await send("raiseDispute", C(researcher).raiseDispute(s3, ev3.body.docHash));
  const n3 = await http(`/api/submissions/${s3}/documents`, { method: "POST", body: { kind: "resolution_note", content: "Chain not demonstrated. Upheld." }, token: resToken });
  await send("resolveDispute(uphold)", C(resolver).resolveDispute(s3, false, 0, n3.body.docHash));
  assert.equal(Number((await C(admin).getSubmission(s3)).status), 5);
  ok("Submission status RejectionUpheld");

  // ---------------------------------------------------------------- final accounting
  log("Final accounting + events");
  p = await C(admin).getProgram(programId);
  assert.equal(p.totalPaid, E("3"));
  assert.equal(p.reservedBalance, 0n);
  assert.equal(p.availableBalance, E("3"));
  ok(`available ${ethers.formatEther(p.availableBalance)} / reserved ${ethers.formatEther(p.reservedBalance)} / paid ${ethers.formatEther(p.totalPaid)} ETH`);
  const bal = await provider.getBalance(dep.address);
  ok(`Contract balance ${ethers.formatEther(bal)} ETH (sum over all programs)`);
  const events = await C(admin).queryFilter("*", dep.deployBlock);
  const counts = {};
  for (const e of events) if (e.fragment) counts[e.fragment.name] = (counts[e.fragment.name] || 0) + 1;
  console.log("    Events emitted:", counts);
  console.log("\nE2E PASSED ✅");
}

main().catch((e) => {
  console.error("\nE2E FAILED ❌\n", e);
  process.exit(1);
});
