// Backend API client. Confidential report data only ever comes from here,
// and only after wallet-signature login.
import { ethers } from "ethers";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

export async function api(path, { method = "GET", body, token } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach backend at ${API_URL}. Is it running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Same canonical JSON + keccak256 as the backend: lets the browser verify
// off-chain documents against on-chain hashes independently.
export function canonicalize(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
}
export const hashDocument = (obj) => ethers.keccak256(ethers.toUtf8Bytes(canonicalize(obj)));

// Public program metadata cache
const metaCache = new Map();
export async function getProgramMetadata(hash) {
  if (metaCache.has(hash)) return metaCache.get(hash);
  try {
    const r = await api(`/api/programs/metadata/${hash}`);
    const verified = hashDocument(r.metadata) === hash.toLowerCase();
    const out = { ...r.metadata, _verified: verified };
    metaCache.set(hash, out);
    return out;
  } catch {
    return null;
  }
}
