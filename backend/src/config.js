// Loads configuration from environment variables. No secrets are hardcoded.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}. Run "npm run gen-env" to create backend/.env`);
  return v;
}

function loadConfig() {
  const key = required("REPORT_ENCRYPTION_KEY");
  if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("REPORT_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  const jwtSecret = required("JWT_SECRET");
  if (jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  return {
    port: Number(process.env.PORT || 4000),
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    dbPath: process.env.DB_PATH || path.join(__dirname, "..", "data", "bountychain.db"),
    encryptionKey: Buffer.from(key, "hex"),
    jwtSecret,
    jwtTtl: process.env.JWT_TTL || "2h",
    corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:5173").split(","),
    contractFile: process.env.CONTRACT_FILE || path.join(__dirname, "..", "contract", "BountyPlatform.json"),
  };
}

module.exports = { loadConfig };
