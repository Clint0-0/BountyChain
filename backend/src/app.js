// Express application. Created by a factory so tests can inject an in-memory
// database and a mock chain reader.
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createAuth, httpError } = require("./auth");
const { canonicalize, hashDocument } = require("./canonical");
const { encrypt, decrypt } = require("./crypto");
const { getSubmissionAccess } = require("./access");

const SEVERITIES = ["Low", "Medium", "High", "Critical"];
const DOC_KINDS = ["review_note", "dispute_evidence", "resolution_note"];

// ---------- validation helpers ----------
function str(body, key, { min = 1, max = 5000, optional = false } = {}) {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (optional) return "";
    throw httpError(400, `${key} is required`);
  }
  if (typeof v !== "string") throw httpError(400, `${key} must be a string`);
  const t = v.trim();
  if (t.length < min) throw httpError(400, `${key} must be at least ${min} characters`);
  if (t.length > max) throw httpError(400, `${key} must be at most ${max} characters`);
  return t;
}
function positiveInt(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, `${name} must be a positive integer`);
  return n;
}

// ---------- tiny in-memory rate limiter (per IP, per route group) ----------
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  // prune expired entries so the map cannot grow without bound
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) Object.assign(entry, { count: 0, reset: now + windowMs });
    entry.count++;
    hits.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: "Too many requests, slow down" });
    next();
  };
}

function createApp({ db, chain, config }) {
  const app = express();
  const auth = createAuth({ db, config, chainId: chain.chainId });
  const key = config.encryptionKey;

  app.disable("x-powered-by");
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "256kb" }));
  // Express 5 leaves req.body undefined without a JSON body; normalise to {}
  app.use((req, res, next) => {
    if (req.body === undefined || req.body === null || typeof req.body !== "object") req.body = {};
    next();
  });
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "no-store");
    next();
  });

  const logAccess = db.prepare("INSERT INTO access_log(address, action, target, allowed, created_at) VALUES (?,?,?,?,?)");
  const audit = (addr, action, target, allowed) => logAccess.run(addr, action, String(target), allowed ? 1 : 0, Date.now());

  // wrap async handlers so errors reach the error middleware
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------------------------------------------------------------- public
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/config", (req, res) => res.json({ chainId: chain.chainId, contractAddress: chain.address }));

  // ---------------------------------------------------------------- auth
  const authLimiter = rateLimit({ windowMs: 60_000, max: 30 });
  app.get("/api/auth/nonce", authLimiter, (req, res) => res.json(auth.issueNonce(req.query.address)));
  app.post("/api/auth/verify", authLimiter, (req, res) => res.json(auth.verify(req.body.address, req.body.signature)));
  app.get("/api/auth/me", auth.requireAuth, (req, res) => res.json({ address: req.user }));

  // ---------------------------------------------------------------- program metadata
  // Program details are public (researchers must read scope/rules) but are kept
  // off-chain because they are long. Only the hash goes on-chain.
  const insertMeta = db.prepare("INSERT OR IGNORE INTO program_metadata(hash, owner, data_json, created_at) VALUES (?,?,?,?)");
  const getMeta = db.prepare("SELECT * FROM program_metadata WHERE hash = ?");

  app.post(
    "/api/programs/metadata",
    auth.requireAuth,
    h(async (req, res) => {
      if (!(await chain.isOrganization(req.user))) throw httpError(403, "Only authorized organizations can publish program metadata");
      const b = req.body || {};
      const doc = {
        type: "bountychain.program.v1",
        owner: req.user,
        title: str(b, "title", { min: 3, max: 120 }),
        organizationName: str(b, "organizationName", { min: 2, max: 120 }),
        description: str(b, "description", { min: 10, max: 10000 }),
        targetSystem: str(b, "targetSystem", { max: 500 }),
        inScope: str(b, "inScope", { max: 5000 }),
        outOfScope: str(b, "outOfScope", { max: 5000 }),
        rules: str(b, "rules", { max: 10000 }),
      };
      const hash = hashDocument(doc);
      insertMeta.run(hash, req.user, canonicalize(doc), Date.now());
      res.status(201).json({ metadataHash: hash, metadata: doc });
    })
  );

  app.get("/api/programs/metadata/:hash", (req, res) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.hash)) return res.status(400).json({ error: "Invalid hash" });
    const row = getMeta.get(req.params.hash.toLowerCase());
    if (!row) return res.status(404).json({ error: "Metadata not found" });
    const data = JSON.parse(row.data_json);
    res.json({ metadataHash: row.hash, metadata: data, integrityVerified: hashDocument(data) === row.hash });
  });

  // ---------------------------------------------------------------- reports
  const insertReport = db.prepare("INSERT INTO reports(researcher, program_id, report_hash, ciphertext, created_at) VALUES (?,?,?,?,?)");
  const getReportByHash = db.prepare("SELECT * FROM reports WHERE report_hash = ?");

  /**
   * Step 1 of submission. Encrypts and stores the report, returns the hash the
   * researcher must submit on-chain with submitReport(programId, reportHash).
   * A random salt makes the hash unguessable (cannot brute-force contents).
   */
  app.post(
    "/api/reports",
    auth.requireAuth,
    h(async (req, res) => {
      const b = req.body || {};
      const programId = positiveInt(b.programId, "programId");
      const program = await chain.getProgram(programId);
      if (!program) throw httpError(404, "Program not found on-chain");
      // use chain time, not wall-clock time (local chains can drift ahead)
      const now = chain.now ? await chain.now() : Math.floor(Date.now() / 1000);
      if (!program.active || now < program.startTime || now > program.endTime) throw httpError(400, "Program is not accepting submissions");
      if (program.owner === req.user || (await chain.isVerifier(programId, req.user))) {
        throw httpError(403, "Program owner and its verifiers cannot submit reports to it");
      }
      if (!SEVERITIES.includes(b.suggestedSeverity)) throw httpError(400, "suggestedSeverity must be Low, Medium, High or Critical");

      const doc = {
        type: "bountychain.report.v1",
        programId,
        researcher: req.user,
        title: str(b, "title", { min: 5, max: 200 }),
        description: str(b, "description", { min: 20, max: 20000 }),
        affectedComponent: str(b, "affectedComponent", { max: 500 }),
        stepsToReproduce: str(b, "stepsToReproduce", { min: 10, max: 20000 }),
        proofOfConcept: str(b, "proofOfConcept", { min: 5, max: 50000 }),
        impact: str(b, "impact", { min: 5, max: 10000 }),
        suggestedSeverity: b.suggestedSeverity,
        additionalNotes: str(b, "additionalNotes", { optional: true, max: 10000 }),
        salt: crypto.randomBytes(16).toString("hex"),
        createdAt: new Date().toISOString(),
      };
      const reportHash = hashDocument(doc);
      insertReport.run(req.user, programId, reportHash, encrypt(key, canonicalize(doc)), Date.now());
      audit(req.user, "report.create", reportHash, true);
      res.status(201).json({ reportHash, programId });
    })
  );

  /** Shared loader: on-chain lookup + authorisation + decrypt + integrity check. */
  async function loadAuthorized(req, submissionId) {
    const access = await getSubmissionAccess(chain, submissionId, req.user);
    if (!access.submission) throw httpError(404, "Submission not found on-chain");
    if (access.roles.length === 0) {
      audit(req.user, "report.read", submissionId, false);
      throw httpError(403, "You are not authorized to view this report");
    }
    const row = getReportByHash.get(access.submission.reportHash.toLowerCase());
    if (!row || row.researcher !== access.submission.researcher) throw httpError(404, "Off-chain report not found for this submission");
    let plaintext;
    try {
      plaintext = decrypt(key, row.ciphertext);
    } catch {
      throw httpError(500, "Stored report failed decryption/authentication (wrong key or tampered data)");
    }
    const report = JSON.parse(plaintext);
    const computedHash = hashDocument(report);
    return { ...access, report, integrity: { onChainHash: access.submission.reportHash, computedHash, verified: computedHash === access.submission.reportHash.toLowerCase() } };
  }

  const docsForSubmission = db.prepare("SELECT * FROM documents WHERE submission_id = ? ORDER BY id");

  app.get(
    "/api/submissions/:id/report",
    auth.requireAuth,
    h(async (req, res) => {
      const id = positiveInt(req.params.id, "id");
      const r = await loadAuthorized(req, id);
      const anchors = {
        review_note: r.submission.reviewNoteHash,
        dispute_evidence: r.dispute.evidenceHash,
        resolution_note: r.dispute.resolutionNoteHash,
      };
      const documents = docsForSubmission.all(id).map((d) => {
        let doc;
        try {
          doc = JSON.parse(decrypt(key, d.ciphertext));
        } catch {
          return { kind: d.kind, author: d.author, content: null, hash: d.doc_hash, anchoredOnChain: false, integrityVerified: false, error: "decryption failed" };
        }
        return {
          kind: d.kind,
          author: d.author,
          content: doc.content,
          hash: d.doc_hash,
          createdAt: doc.createdAt,
          anchoredOnChain: anchors[d.kind]?.toLowerCase() === d.doc_hash,
          integrityVerified: hashDocument(doc) === d.doc_hash,
        };
      });
      audit(req.user, "report.read", id, true);
      res.json({ submissionId: id, roles: r.roles, report: r.report, integrity: r.integrity, documents });
    })
  );

  /** Titles only, for list views. Silently skips ids the caller cannot see. */
  app.get(
    "/api/submissions/titles",
    auth.requireAuth,
    h(async (req, res) => {
      const ids = String(req.query.ids || "")
        .split(",")
        .filter(Boolean)
        .slice(0, 100)
        .map((x) => positiveInt(x, "id"));
      const out = {};
      for (const id of ids) {
        try {
          const r = await loadAuthorized(req, id);
          out[id] = { title: r.report.title, suggestedSeverity: r.report.suggestedSeverity, integrityVerified: r.integrity.verified };
        } catch (e) {
          if (!e.status) throw e;
        }
      }
      res.json(out);
    })
  );

  /**
   * Notes / evidence. Returns a hash that must then be passed to the matching
   * contract call (approveReport/rejectReport, raiseDispute, resolveDispute).
   */
  const insertDoc = db.prepare("INSERT INTO documents(submission_id, kind, author, doc_hash, ciphertext, created_at) VALUES (?,?,?,?,?,?)");
  app.post(
    "/api/submissions/:id/documents",
    auth.requireAuth,
    h(async (req, res) => {
      const id = positiveInt(req.params.id, "id");
      const kind = req.body?.kind;
      if (!DOC_KINDS.includes(kind)) throw httpError(400, "kind must be review_note, dispute_evidence or resolution_note");
      const content = str(req.body, "content", { min: 5, max: 20000 });
      const access = await getSubmissionAccess(chain, id, req.user);
      if (!access.submission) throw httpError(404, "Submission not found on-chain");
      const st = access.submission.status;
      const rules = {
        review_note: access.roles.includes("verifier") && st === "Submitted",
        dispute_evidence: access.roles.includes("researcher") && st === "Rejected" && access.dispute.status === "None",
        resolution_note: access.roles.includes("dispute_resolver") && st === "Disputed",
      };
      if (!rules[kind]) {
        audit(req.user, `doc.create.${kind}`, id, false);
        throw httpError(403, `Not allowed to add ${kind} for this submission in status ${st}`);
      }
      const doc = { type: `bountychain.${kind}.v1`, submissionId: id, author: req.user, content, salt: crypto.randomBytes(16).toString("hex"), createdAt: new Date().toISOString() };
      const docHash = hashDocument(doc);
      insertDoc.run(id, kind, req.user, docHash, encrypt(key, canonicalize(doc)), Date.now());
      audit(req.user, `doc.create.${kind}`, id, true);
      res.status(201).json({ docHash });
    })
  );

  // ---------------------------------------------------------------- errors
  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
    if (err.status) return res.status(err.status).json({ error: err.message });
    // ethers: empty result = no contract at address; connection errors = node down
    if (err.code === "BAD_DATA" || err.code === "NETWORK_ERROR" || err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED") {
      return res.status(503).json({ error: "Blockchain unavailable or contract not deployed at the configured address" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = { createApp };
