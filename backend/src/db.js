// SQLite storage. Only off-chain data lives here; ids/hashes link it to the chain.
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_nonces (
  address     TEXT PRIMARY KEY,
  nonce       TEXT NOT NULL,
  message     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
-- Public program details (description, scope, rules). Keyed by the hash stored on-chain.
CREATE TABLE IF NOT EXISTS program_metadata (
  hash        TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
-- Sensitive vulnerability reports, AES-256-GCM encrypted. report_hash == on-chain reportHash.
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  researcher  TEXT NOT NULL,
  program_id  INTEGER NOT NULL,
  report_hash TEXT NOT NULL UNIQUE,
  ciphertext  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_researcher ON reports(researcher);
-- Verifier notes, dispute evidence, resolution notes. doc_hash == on-chain note/evidence hash.
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('review_note','dispute_evidence','resolution_note')),
  author        TEXT NOT NULL,
  doc_hash      TEXT NOT NULL UNIQUE,
  ciphertext    TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_submission ON documents(submission_id);
-- Who accessed which confidential record (accountability).
CREATE TABLE IF NOT EXISTS access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  address     TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  allowed     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
`;

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
