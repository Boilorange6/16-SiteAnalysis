import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import JSZip from "jszip";
import { ensureTopoUploadTable } from "../app-db";
import { buildTopoDb, TopoError, type TopoSummary } from "./build";
import { TOPO_UPLOAD_KEEP } from "./layers";

type Db = BetterSqlite3.Database;

export interface ApiReply {
  status: number;
  body: Record<string, unknown>;
}

export const MAX_TOPO_UPLOAD_BYTES = 64 * 1024 ** 2;
export const MAX_TOPO_INFLATED_BYTES = 256 * 1024 ** 2;
export const MAX_TOPO_ENTRIES = 400;

type TopoUploadRow = {
  topo_id: string;
  user_id: string;
  sha256: string;
  db_path: string;
  summary_json: string;
  created_at: string;
};

class TopoUploadError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

type ZipObjectWithData = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: unknown };
};

const uploadLocks = new WeakMap<object, Map<string, Promise<ApiReply>>>();

function reply(status: number, error: string, extra: Record<string, unknown> = {}): ApiReply {
  return { status, body: { error, ...extra } };
}

function userKey(userId: string | number): string {
  return String(userId);
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function getUploadRow(db: Db, userId: string, digest: string): TopoUploadRow | undefined {
  return db.prepare(`
    SELECT topo_id, user_id, sha256, db_path, summary_json, created_at
    FROM topo_upload
    WHERE user_id = ? AND sha256 = ?
    LIMIT 1
  `).get(userId, digest) as TopoUploadRow | undefined;
}

function replyForExisting(row: TopoUploadRow): ApiReply {
  return {
    status: 200,
    body: { topoId: row.topo_id, summary: JSON.parse(row.summary_json) as TopoSummary },
  };
}

function isUnsafeEntryName(name: string): boolean {
  return name.includes("/") || name.includes("\\") || name.includes("..");
}

function declaredInflatedSize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as ZipObjectWithData)._data?.uncompressedSize;
  if (size === undefined) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new TopoUploadError(413, "topo_too_large");
  }
  return size;
}

function addInflatedSize(current: number, size: number): number {
  if (size > MAX_TOPO_INFLATED_BYTES || current > MAX_TOPO_INFLATED_BYTES - size) {
    throw new TopoUploadError(413, "topo_too_large");
  }
  return current + size;
}

function removeSqliteFiles(path: string | null): void {
  if (!path) return;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
    try {
      if (existsSync(candidate)) rmSync(candidate, { force: true });
    } catch {
      // Cleanup is best effort and must not replace the upload/build result.
    }
  }
}

function removeDirectory(path: string | null): void {
  if (!path) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Cleanup is best effort and must not replace the upload/build result.
  }
}

function topoDirectory(appDb: Db, dataDir: string): string {
  if (!appDb.memory && appDb.name !== ":memory:") return resolve(dirname(appDb.name), "topo");
  return resolve(dataDir, "..", "topo");
}

async function putTopoUploadInternal(
  appDb: Db,
  dataDir: string,
  body: Buffer,
  userId: string,
  digest: string,
): Promise<ApiReply> {
  ensureTopoUploadTable(appDb);
  const existing = getUploadRow(appDb, userId, digest);
  if (existing) return replyForExisting(existing);

  let tempDir: string | null = null;
  let finalPath: string | null = null;
  let committed = false;
  try {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(body);
    } catch {
      throw new TopoUploadError(400, "topo_bad_zip");
    }

    const entries = Object.values(zip.files);
    if (entries.length > MAX_TOPO_ENTRIES) throw new TopoUploadError(413, "topo_too_large");

    let inflatedBytes = 0;
    const selected: Array<{ entry: JSZip.JSZipObject; name: string; declaredSize: number | null; content?: Buffer }> = [];
    const unknownContent = new Map<JSZip.JSZipObject, Buffer>();
    for (const entry of entries) {
      const originalName = entry.unsafeOriginalName ?? entry.name;
      if (isUnsafeEntryName(originalName) || isUnsafeEntryName(entry.name)) {
        throw new TopoUploadError(400, "topo_bad_zip");
      }

      const declaredSize = entry.dir ? 0 : declaredInflatedSize(entry);
      if (declaredSize !== null) inflatedBytes = addInflatedSize(inflatedBytes, declaredSize);
      else if (!entry.dir) {
        try {
          const content = await entry.async("nodebuffer");
          unknownContent.set(entry, content);
          inflatedBytes = addInflatedSize(inflatedBytes, content.length);
        } catch {
          throw new TopoUploadError(400, "topo_bad_zip");
        }
      }

      if (!entry.dir && TOPO_UPLOAD_KEEP(entry.name)) {
        selected.push({ entry, name: entry.name, declaredSize, content: unknownContent.get(entry) });
      }
    }

    const topoDir = topoDirectory(appDb, dataDir);
    mkdirSync(topoDir, { recursive: true });
    tempDir = mkdtempSync(join(topoDir, ".upload-"));
    const sourceDir = join(tempDir, "src");
    mkdirSync(sourceDir);
    for (const item of selected) {
      let content = item.content;
      if (!content) {
        try {
          content = await item.entry.async("nodebuffer");
        } catch {
          throw new TopoUploadError(400, "topo_bad_zip");
        }
        inflatedBytes = inflatedBytes - (item.declaredSize ?? 0) + content.length;
        if (inflatedBytes > MAX_TOPO_INFLATED_BYTES) throw new TopoUploadError(413, "topo_too_large");
      }
      writeFileSync(join(sourceDir, item.name), content);
    }

    const topoId = randomUUID();
    const builtPath = join(tempDir, "topo.sqlite");
    let summary: TopoSummary;
    try {
      summary = await buildTopoDb(sourceDir, builtPath, { releaseId: `ngii_topo@${digest.slice(0, 12)}` });
    } catch (error) {
      if (error instanceof TopoError) throw error;
      throw new TopoUploadError(400, "topo_bad_zip");
    }

    finalPath = join(topoDir, `${topoId}.sqlite`);
    renameSync(builtPath, finalPath);
    const createdAt = new Date().toISOString();
    const inserted = appDb.prepare(`
      INSERT INTO topo_upload (topo_id, user_id, sha256, db_path, summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, sha256) DO NOTHING
    `).run(topoId, userId, digest, finalPath, JSON.stringify(summary), createdAt);

    if (inserted.changes === 0) {
      removeSqliteFiles(finalPath);
      finalPath = null;
      const winner = getUploadRow(appDb, userId, digest);
      if (!winner) throw new Error("topo upload dedupe row disappeared");
      return replyForExisting(winner);
    }

    committed = true;
    return { status: 201, body: { topoId, summary } };
  } finally {
    if (!committed) removeSqliteFiles(finalPath);
    removeDirectory(tempDir);
  }
}

export async function putTopoUpload(
  appDb: Db,
  dataDir: string,
  body: Buffer,
  userId: string | number | null,
): Promise<ApiReply> {
  if (userId == null) return reply(403, "topo_auth_required");
  if (!Buffer.isBuffer(body)) return reply(400, "topo_bad_zip");
  if (body.length > MAX_TOPO_UPLOAD_BYTES) return reply(413, "topo_too_large");

  const owner = userKey(userId);
  const digest = sha256(body);
  ensureTopoUploadTable(appDb);
  const key = `${owner}:${digest}`;
  let locks = uploadLocks.get(appDb);
  if (!locks) {
    locks = new Map();
    uploadLocks.set(appDb, locks);
  }
  const previous = locks.get(key);
  if (previous) {
    const result = await previous;
    return result.status === 201 ? { status: 200, body: result.body } : result;
  }

  let current: Promise<ApiReply>;
  current = putTopoUploadInternal(appDb, dataDir, body, owner, digest)
    .catch((error: unknown) => {
      if (error instanceof TopoUploadError) return reply(error.status, error.code);
      if (error instanceof TopoError) return reply(400, error.code);
      return reply(500, "topo_upload_failed");
    })
    .finally(() => {
      if (locks?.get(key) === current) locks.delete(key);
    });
  locks.set(key, current);
  return current;
}

export function openTopoForUser(
  appDb: Db,
  topoId: string,
  userId: string | number,
): { db: Db; sha256: string; summary: TopoSummary; uploadedAt: string } | null {
  if (!topoId || userId == null) return null;
  ensureTopoUploadTable(appDb);
  const row = appDb.prepare(`
    SELECT topo_id, user_id, sha256, db_path, summary_json, created_at
    FROM topo_upload
    WHERE topo_id = ? AND user_id = ?
    LIMIT 1
  `).get(topoId, userKey(userId)) as TopoUploadRow | undefined;
  if (!row) return null;

  let summary: TopoSummary;
  try {
    summary = JSON.parse(row.summary_json) as TopoSummary;
  } catch {
    return null;
  }

  if (!appDb.memory && resolve(row.db_path) !== resolve(topoDirectory(appDb, "."), `${topoId}.sqlite`)) return null;
  try {
    const db = new Database(row.db_path, { readonly: true, fileMustExist: true });
    return { db, sha256: row.sha256, summary, uploadedAt: row.created_at };
  } catch {
    return null;
  }
}
