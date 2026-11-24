// Deterministic JSON serialisation (sorted keys) so the same document always
// produces the same keccak256 hash, both in backend and in the browser.
const { keccak256, toUtf8Bytes } = require("ethers");

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

function hashDocument(obj) {
  return keccak256(toUtf8Bytes(canonicalize(obj)));
}

module.exports = { canonicalize, hashDocument };
