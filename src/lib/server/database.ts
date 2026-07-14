import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const DB_PATH =
  process.env.DB_PATH || resolve(process.cwd(), ".cache/site-analysis.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_api_keys (
      user_id INTEGER NOT NULL,
      key_name TEXT NOT NULL,
      key_value TEXT NOT NULL,
      updated_at REAL NOT NULL,
      PRIMARY KEY (user_id, key_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      expires_at REAL NOT NULL,
      created_at REAL NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS apt_enrichment_cache (
      cache_key TEXT PRIMARY KEY,
      units INTEGER NOT NULL DEFAULT 0,
      parking_count INTEGER NOT NULL DEFAULT 0,
      sale_date TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kapt_extras_cache (
      cache_key TEXT PRIMARY KEY,
      top_floor INTEGER NOT NULL DEFAULT 0,
      dong_count INTEGER NOT NULL DEFAULT 0,
      constructor_name TEXT NOT NULL DEFAULT '',
      welfare_facilities TEXT NOT NULL DEFAULT '',
      parking_total INTEGER NOT NULL DEFAULT 0,
      use_date TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS geocode_cache (
      address TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      created_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      center_name TEXT NOT NULL,
      center_lat REAL NOT NULL,
      center_lng REAL NOT NULL,
      radius_km REAL NOT NULL,
      payload_json TEXT NOT NULL,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_projects_user_updated
      ON analysis_projects (user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS poi_source_cache (
      source TEXT NOT NULL,
      lat TEXT NOT NULL,
      lng TEXT NOT NULL,
      radius_m INTEGER NOT NULL,
      value_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (source, lat, lng, radius_m)
    );
  `);
}
