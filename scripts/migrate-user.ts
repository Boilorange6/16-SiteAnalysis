/**
 * Migration script: copies impjy613 user from jipgpt DB to SiteAnalysis DB.
 *
 * Run on the server:
 *   cd /home/bitnami/site-analysis
 *   npx tsx scripts/migrate-user.ts
 *
 * This reads:
 *   - /home/bitnami/jipgpt/.cache/jipgpt.db (user + encrypted API keys)
 *   - /home/bitnami/jipgpt/.cache/jipgpt.secret (Fernet key for decryption)
 *
 * And writes to:
 *   - .cache/site-analysis.db (creates user + re-encrypts keys with local AES)
 */

import Database from "better-sqlite3";
import { createDecipheriv } from "crypto";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Dynamically import site-analysis modules
const SA_DB_PATH = resolve(process.cwd(), ".cache/site-analysis.db");
const JIPGPT_DB_PATH = process.env.JIPGPT_DB_PATH || "/home/bitnami/jipgpt/.cache/jipgpt.db";
const JIPGPT_SECRET_PATH = process.env.JIPGPT_SECRET_PATH || "/home/bitnami/jipgpt/.cache/jipgpt.secret";
const TARGET_USERNAME = "impjy613";

// Fernet decryption (Python's cryptography.fernet compatible)
function fernetDecrypt(token: string, key: Buffer): string {
  const tokenBuf = Buffer.from(token, "base64");
  // Fernet format: version(1) + timestamp(8) + iv(16) + ciphertext(n) + hmac(32)
  const iv = tokenBuf.subarray(9, 25);
  const ciphertext = tokenBuf.subarray(25, tokenBuf.length - 32);
  // Fernet uses the last 16 bytes of the 32-byte key as AES key
  const aesKey = key.subarray(16, 32);
  const decipher = createDecipheriv("aes-128-cbc", aesKey, iv);
  let decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  // Remove PKCS7 padding
  const padLen = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - padLen);
  return decrypted.toString("utf8");
}

async function main() {
  // Check files exist
  if (!existsSync(JIPGPT_DB_PATH)) {
    console.error(`jipgpt DB not found: ${JIPGPT_DB_PATH}`);
    process.exit(1);
  }
  if (!existsSync(JIPGPT_SECRET_PATH)) {
    console.error(`jipgpt secret not found: ${JIPGPT_SECRET_PATH}`);
    process.exit(1);
  }

  // Read jipgpt secret (base64-encoded Fernet key)
  const secretRaw = readFileSync(JIPGPT_SECRET_PATH, "utf8").trim();
  const fernetKey = Buffer.from(secretRaw, "base64url");

  // Open jipgpt DB
  const jipgptDb = new Database(JIPGPT_DB_PATH, { readonly: true });

  // Find user
  const userRow = jipgptDb.prepare("SELECT * FROM users WHERE username = ?").get(TARGET_USERNAME) as {
    id: number;
    username: string;
    password_hash: string;
    role: string;
  } | undefined;

  if (!userRow) {
    console.error(`User "${TARGET_USERNAME}" not found in jipgpt DB.`);
    process.exit(1);
  }

  console.log(`Found user: ${userRow.username} (id=${userRow.id}, role=${userRow.role})`);

  // Read encrypted API keys
  const keyRows = jipgptDb
    .prepare("SELECT key_name, key_value FROM user_api_keys WHERE user_id = ?")
    .all(userRow.id) as Array<{ key_name: string; key_value: string }>;

  const naverKeys: Record<string, string> = {};
  for (const row of keyRows) {
    if (["naver_id", "naver_secret", "naver_map_id", "naver_map_secret"].includes(row.key_name)) {
      try {
        naverKeys[row.key_name] = fernetDecrypt(row.key_value, fernetKey);
        console.log(`  Decrypted key: ${row.key_name} = ****${naverKeys[row.key_name].slice(-4)}`);
      } catch (e) {
        console.warn(`  Failed to decrypt ${row.key_name}:`, e);
      }
    }
  }

  jipgptDb.close();

  if (Object.keys(naverKeys).length === 0) {
    console.error("No Naver API keys found for user.");
    process.exit(1);
  }

  // Now write to site-analysis DB using its own modules
  // Import dynamically to trigger DB creation with schema
  const { createUserWithHash, saveApiKeys, getUserById } = await import("../src/lib/server/user-store");
  const { getDb } = await import("../src/lib/server/database");

  // Check if user already exists
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(TARGET_USERNAME) as { id: number } | undefined;

  let userId: number;
  if (existing) {
    console.log(`User "${TARGET_USERNAME}" already exists in site-analysis DB (id=${existing.id}). Updating keys.`);
    userId = existing.id;
  } else {
    const newUser = createUserWithHash(userRow.username, userRow.password_hash, userRow.role);
    userId = newUser.id;
    console.log(`Created user "${TARGET_USERNAME}" in site-analysis DB (id=${userId})`);
  }

  // Save API keys (re-encrypted with site-analysis's AES key)
  saveApiKeys(userId, naverKeys);
  console.log(`Saved ${Object.keys(naverKeys).length} API keys for user.`);
  console.log("\nMigration complete!");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
