// SQLite storage. Only off-chain data lives here; ids/hashes link it to the chain.
const initSqlJs = require("sql.js");
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

// sql.js = SQLite compiled to WebAssembly: no native build, works on any
// Node version / OS. A tiny wrapper gives the better-sqlite3 style API used
// by the app (prepare().run/get/all) and persists the DB file after writes.
let SQL = null;
async function initDb() {
  if (!SQL) SQL = await initSqlJs();
}

function openDb(file) {
  if (!SQL) throw new Error("initDb() must be awaited before openDb()");
  const persistent = file !== ":memory:";
  if (persistent) fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = persistent && fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  const save = () => {
    if (!persistent) return;
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, Buffer.from(raw.export()));
    fs.renameSync(tmp, file); // atomic replace
  };
  raw.run("PRAGMA foreign_keys = ON");
  raw.exec(SCHEMA);
  save();

  const db = {
    exec(sql) {
      raw.exec(sql);
      save();
    },
    prepare(sql) {
      return {
        run(...params) {
          raw.run(sql, params);
          const changes = raw.getRowsModified();
          save();
          return { changes };
        },
        get(...params) {
          const st = raw.prepare(sql);
          try {
            st.bind(params);
            return st.step() ? st.getAsObject() : undefined;
          } finally {
            st.free();
          }
        },
        all(...params) {
          const st = raw.prepare(sql);
          const rows = [];
          try {
            st.bind(params);
            while (st.step()) rows.push(st.getAsObject());
          } finally {
            st.free();
          }
          return rows;
        },
      };
    },
    close() {
      save();
      raw.close();
    },
  };
  return db;
}

module.exports = { initDb, openDb };
