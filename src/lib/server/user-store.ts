import { hashSync, compareSync } from "bcryptjs";
import { createHash } from "crypto";
import { getDb } from "./database";
import { encrypt, decrypt } from "./crypto";

export interface User {
  id: number;
  username: string;
  role: string;
  is_active: number;
  created_at: number;
}

interface UserRow extends User {
  password_hash: string;
}

export function createUser(
  username: string,
  password: string,
  role: string = "user",
): User {
  const db = getDb();
  const hash = hashSync(password, 10);
  const now = Date.now() / 1000;
  const result = db
    .prepare(
      "INSERT INTO users (username, password_hash, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)"
    )
    .run(username, hash, role, now);
  return {
    id: result.lastInsertRowid as number,
    username,
    role,
    is_active: 1,
    created_at: now,
  };
}


/**
 * Admin-only: creates a user with a pre-existing password hash (for migrations).
 * Do NOT call from API routes — use createUser() which enforces bcrypt.
 */
export function createUserWithHash(
  username: string,
  passwordHash: string,
  role: string = "user",
): User {
  const db = getDb();
  const now = Date.now() / 1000;
  const result = db
    .prepare(
      "INSERT INTO users (username, password_hash, role, is_active, created_at) VALUES (?, ?, ?, 1, ?)"
    )
    .run(username, passwordHash, role, now);
  return {
    id: result.lastInsertRowid as number,
    username,
    role,
    is_active: 1,
    created_at: now,
  };
}

export function authenticate(
  username: string,
  password: string
): User | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM users WHERE username = ? AND is_active = 1")
    .get(username) as UserRow | undefined;
  if (!row) return null;
  if (!compareSync(password, row.password_hash)) return null;
  const { password_hash: _, ...user } = row;
  return user;
}

export function getUserById(id: number): User | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, username, role, is_active, created_at FROM users WHERE id = ?")
    .get(id) as User | undefined;
  return row ?? null;
}

// ─── Session management (C-1) ─────────────────────────────────────────────────

const REFRESH_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function storeSession(userId: number, refreshToken: string): void {
  const db = getDb();
  const now = Date.now() / 1000;
  db.prepare(
    "INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(userId, hashToken(refreshToken), now + REFRESH_TTL_SECONDS, now);
}

export function validateAndRotateSession(
  oldToken: string,
  userId: number,
  newToken: string,
): boolean {
  const db = getDb();
  const oldHash = hashToken(oldToken);
  const newHash = hashToken(newToken);
  const now = Date.now() / 1000;

  const session = db
    .prepare("SELECT id FROM user_sessions WHERE refresh_token_hash = ? AND user_id = ? AND expires_at > ?")
    .get(oldHash, userId, now);

  if (!session) return false;

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM user_sessions WHERE refresh_token_hash = ?").run(oldHash);
    db.prepare(
      "INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, newHash, now + REFRESH_TTL_SECONDS, now);
  });
  tx();
  return true;
}

export function deleteSession(refreshToken: string): void {
  const db = getDb();
  db.prepare("DELETE FROM user_sessions WHERE refresh_token_hash = ?").run(hashToken(refreshToken));
}

// ─── API key management ───────────────────────────────────────────────────────

export function saveApiKeys(
  userId: number,
  keys: Record<string, string>
): void {
  const db = getDb();
  const now = Date.now() / 1000;
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO user_api_keys (user_id, key_name, key_value, updated_at) VALUES (?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    for (const [name, value] of Object.entries(keys)) {
      if (value.trim()) {
        stmt.run(userId, name, encrypt(value.trim()), now);
      }
    }
  });
  tx();
}

export function loadApiKeys(userId: number): Record<string, string> {
  const db = getDb();
  const rows = db
    .prepare("SELECT key_name, key_value FROM user_api_keys WHERE user_id = ?")
    .all(userId) as Array<{ key_name: string; key_value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    try {
      result[row.key_name] = decrypt(row.key_value);
    } catch (error) {
      console.warn(
        `[api-keys] Stored key could not be decrypted: ${row.key_name}`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return result;
}

export function getApiKeysMasked(userId: number): Record<string, string> {
  const keys = loadApiKeys(userId);
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(keys)) {
    masked[name] =
      value.length > 4 ? "****" + value.slice(-4) : "****";
  }
  return masked;
}
