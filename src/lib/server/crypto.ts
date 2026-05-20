import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const JWT_SECRET_PATH = resolve(process.cwd(), ".cache/site-analysis.secret");

function loadOrCreateFileSecret(filePath: string): Buffer {
  if (!existsSync(filePath)) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const secret = randomBytes(32);
    writeFileSync(filePath, secret);
    return secret;
  }
  return readFileSync(filePath);
}

/**
 * JWT signing key.
 * Production: set JWT_SECRET env var to a 64-char hex string (32 bytes).
 * Development: auto-generated file at .cache/site-analysis.secret.
 */
export function getJwtSecret(): Buffer {
  const envVal = process.env.JWT_SECRET;
  if (envVal) {
    const buf = Buffer.from(envVal, "hex");
    if (buf.length !== 32) throw new Error("JWT_SECRET must be 64 hex characters (32 bytes)");
    return buf;
  }
  return loadOrCreateFileSecret(JWT_SECRET_PATH);
}

/**
 * AES-256-GCM encryption key for API key storage.
 * Production: set API_KEYS_ENCRYPTION_SECRET env var to a 64-char hex string (32 bytes).
 * Development: falls back to JWT_SECRET_PATH file for backward compatibility.
 */
function getEncryptionKey(): Buffer {
  const envVal = process.env.API_KEYS_ENCRYPTION_SECRET;
  if (envVal) {
    const buf = Buffer.from(envVal, "hex");
    if (buf.length !== 32) throw new Error("API_KEYS_ENCRYPTION_SECRET must be 64 hex characters (32 bytes)");
    return buf;
  }
  // Fall back to same file as JWT for backward compatibility with existing encrypted data
  return loadOrCreateFileSecret(JWT_SECRET_PATH);
}

function getDecryptionKeys(): Buffer[] {
  const keys = [getEncryptionKey(), loadOrCreateFileSecret(JWT_SECRET_PATH)];
  return keys.filter((key, index) => keys.findIndex((candidate) => candidate.equals(key)) === index);
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${encrypted.toString("base64")}.${authTag.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    // Legacy local databases may contain API keys saved before AES-GCM storage was added.
    // New writes still go through encrypt(); this only keeps old saved keys readable.
    return ciphertext;
  }
  const [ivB64, encB64, tagB64] = parts;
  if (!ivB64 || !encB64 || !tagB64) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(encB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  let lastError: unknown;

  for (const key of getDecryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to decrypt ciphertext");
}
