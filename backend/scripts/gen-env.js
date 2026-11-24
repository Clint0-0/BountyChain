// Generates backend/.env with fresh random secrets (if it does not exist yet).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const file = path.join(__dirname, "..", ".env");
if (fs.existsSync(file)) {
  console.log(".env already exists - leaving it untouched.");
  process.exit(0);
}
const content = `PORT=4000
RPC_URL=http://127.0.0.1:8545
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
JWT_SECRET=${crypto.randomBytes(32).toString("hex")}
JWT_TTL=2h
REPORT_ENCRYPTION_KEY=${crypto.randomBytes(32).toString("hex")}
# DB_PATH=./data/bountychain.db
`;
fs.writeFileSync(file, content);
console.log("Created backend/.env with random JWT_SECRET and REPORT_ENCRYPTION_KEY");
