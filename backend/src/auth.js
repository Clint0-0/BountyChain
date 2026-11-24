// Wallet-signature authentication: nonce -> personal_sign -> JWT.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");

const NONCE_TTL_MS = 5 * 60 * 1000;

function buildMessage(address, nonce, chainId) {
  return [
    "BountyChain wants you to sign in with your Ethereum account:",
    address,
    "",
    "Sign in to the BountyChain report server. This request does not send a transaction or cost gas.",
    "",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

function createAuth({ db, config, chainId }) {
  const upsert = db.prepare(
    "INSERT INTO auth_nonces(address, nonce, message, expires_at) VALUES (?,?,?,?) ON CONFLICT(address) DO UPDATE SET nonce=excluded.nonce, message=excluded.message, expires_at=excluded.expires_at"
  );
  const get = db.prepare("SELECT * FROM auth_nonces WHERE address = ?");
  const del = db.prepare("DELETE FROM auth_nonces WHERE address = ?");

  function issueNonce(rawAddress) {
    if (!ethers.isAddress(rawAddress)) throw httpError(400, "Invalid address");
    const address = ethers.getAddress(rawAddress);
    const nonce = crypto.randomBytes(16).toString("hex");
    const message = buildMessage(address, nonce, chainId);
    upsert.run(address.toLowerCase(), nonce, message, Date.now() + NONCE_TTL_MS);
    return { nonce, message };
  }

  function verify(rawAddress, signature) {
    if (!ethers.isAddress(rawAddress) || typeof signature !== "string") throw httpError(400, "address and signature required");
    const address = rawAddress.toLowerCase();
    const row = get.get(address);
    if (!row || row.expires_at < Date.now()) throw httpError(401, "Nonce missing or expired, request a new one");
    let recovered;
    try {
      recovered = ethers.verifyMessage(row.message, signature).toLowerCase();
    } catch {
      throw httpError(401, "Malformed signature");
    }
    del.run(address); // single use -> no replay
    if (recovered !== address) throw httpError(401, "Signature does not match address");
    const token = jwt.sign({ sub: address }, config.jwtSecret, { expiresIn: config.jwtTtl, algorithm: "HS256" });
    return { token, address };
  }

  function requireAuth(req, res, next) {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: "Authentication required" });
    try {
      const payload = jwt.verify(m[1], config.jwtSecret, { algorithms: ["HS256"] });
      req.user = payload.sub; // lower-case address
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired session" });
    }
  }

  return { issueNonce, verify, requireAuth };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { createAuth, httpError, buildMessage };
