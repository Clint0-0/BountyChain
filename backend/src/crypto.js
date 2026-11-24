// AES-256-GCM encryption at rest for sensitive report contents.
// Stored format: base64(iv[12] | authTag[16] | ciphertext)
const crypto = require("crypto");

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

function decrypt(key, blob) {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag); // tampering with stored data -> decrypt throws
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
