import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { v2RequestsDir } from "../paths";
import { TILE_CODES } from "../ui/tile-catalog";

type Db = BetterSqlite3.Database;

export const REQUEST_STATUSES = ["대기", "진행", "완료", "보류"] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];
export type TileRequestPin = { x: number; y: number };
export type TileRequest = {
  id: number;
  tileCode: string;
  analysisId: string | null;
  memo: string;
  pins: TileRequestPin[];
  context: Record<string, unknown>;
  imagePath: string | null;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  resolvedCommit: string | null;
  resolvedNote: string | null;
  resolvedAt: string | null;
  reopenNote: string | null;
  userId: string | null;
};

export const MAX_REQUEST_PNG_BYTES = 5 * 1024 * 1024;

export function validateRequestInput(input: { tileCode: string; memo: string; pins: unknown }): { ok: true; pins: TileRequestPin[] } | { ok: false; error: string } {
  if (!TILE_CODES.includes(input.tileCode as (typeof TILE_CODES)[number])) return { ok: false, error: "없는 타일 코드입니다" };
  if (input.memo.length > 2000) return { ok: false, error: "메모는 2,000자까지 쓸 수 있습니다" };
  if (!Array.isArray(input.pins)) return { ok: false, error: "핀 위치가 그림 밖입니다" };
  if (input.pins.length >= 10) return { ok: false, error: "핀은 9개까지 찍을 수 있습니다" };
  const pins: TileRequestPin[] = [];
  for (const pin of input.pins) {
    if (!pin || typeof pin !== "object") return { ok: false, error: "핀 위치가 그림 밖입니다" };
    const { x, y } = pin as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return { ok: false, error: "핀 위치가 그림 밖입니다" };
    }
    pins.push({ x, y });
  }
  if (input.memo.trim().length === 0 && pins.length === 0) return { ok: false, error: "메모나 핀 중 하나는 있어야 합니다" };
  return { ok: true, pins };
}

export function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function fromRow(row: Record<string, unknown>): TileRequest {
  return {
    id: Number(row.request_id),
    tileCode: String(row.tile_code),
    analysisId: row.analysis_id === null ? null : String(row.analysis_id),
    memo: String(row.memo),
    pins: parseJson<TileRequestPin[]>(String(row.pins_json), []),
    context: parseJson<Record<string, unknown>>(String(row.context_json), {}),
    imagePath: row.image_path === null ? null : String(row.image_path),
    status: String(row.status) as RequestStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    resolvedCommit: row.resolved_commit === null ? null : String(row.resolved_commit),
    resolvedNote: row.resolved_note === null ? null : String(row.resolved_note),
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    reopenNote: row.reopen_note === null ? null : String(row.reopen_note),
    userId: row.user_id === null ? null : String(row.user_id),
  };
}

const requestSelect = `SELECT request_id, tile_code, analysis_id, memo, pins_json, context_json, image_path,
  status, created_at, updated_at, resolved_commit, resolved_note, resolved_at, reopen_note, user_id FROM tile_request`;

export function createTileRequest(db: Db, input: { tileCode: string; analysisId: string | null; memo: string; pins: TileRequestPin[]; context: Record<string, unknown>; png: Uint8Array | null; userId: string | number }): TileRequest {
  const validated = validateRequestInput(input);
  if (!validated.ok) throw new Error(validated.error);
  if (input.png && input.png.length > MAX_REQUEST_PNG_BYTES) throw new Error("그림은 5 MB까지입니다");
  if (input.png && !isPng(input.png)) throw new Error("PNG 그림만 올릴 수 있습니다");
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO tile_request
    (tile_code, analysis_id, memo, pins_json, context_json, image_path, status, created_at, updated_at, user_id)
    VALUES (?, ?, ?, ?, ?, NULL, '대기', ?, ?, ?)`)
    .run(input.tileCode, input.analysisId, input.memo, JSON.stringify(validated.pins), JSON.stringify(input.context), now, now, String(input.userId));
  const id = Number(result.lastInsertRowid);
  if (input.png) {
    const directory = v2RequestsDir();
    mkdirSync(directory, { recursive: true });
    const imagePath = join(directory, `${id}.png`);
    writeFileSync(imagePath, Buffer.from(input.png));
    db.prepare("UPDATE tile_request SET image_path = ?, updated_at = ? WHERE request_id = ?").run(imagePath, new Date().toISOString(), id);
  }
  return getTileRequest(db, id)!;
}

export function listTileRequests(db: Db, filter?: { status?: RequestStatus; tileCode?: string }): TileRequest[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter?.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  if (filter?.tileCode) {
    where.push("tile_code = ?");
    args.push(filter.tileCode);
  }
  const suffix = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`${requestSelect}${suffix} ORDER BY created_at DESC, request_id DESC`).all(...args) as Array<Record<string, unknown>>;
  return rows.map(fromRow);
}

export function getTileRequest(db: Db, id: number): TileRequest | null {
  const row = db.prepare(`${requestSelect} WHERE request_id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

const ALLOWED_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  대기: ["진행", "완료", "보류"],
  진행: ["완료", "보류", "대기"],
  완료: ["대기"],
  보류: ["대기"],
};

export function transitionTileRequest(db: Db, id: number, to: RequestStatus, patch: { commit?: string; note?: string } = {}): { ok: true; request: TileRequest } | { ok: false; error: string } {
  const current = getTileRequest(db, id);
  if (!current) return { ok: false, error: "없는 요청입니다" };
  if (!REQUEST_STATUSES.includes(to) || !ALLOWED_TRANSITIONS[current.status].includes(to)) {
    return { ok: false, error: `${current.status}에서 ${to}로 바꿀 수 없습니다` };
  }
  if (to === "완료" && !patch.commit?.trim()) return { ok: false, error: "완료로 바꾸려면 커밋 번호가 필요합니다" };
  const now = new Date().toISOString();
  const reopenNote = to === "대기" && patch.note?.trim()
    ? current.reopenNote ? `${current.reopenNote}\n${patch.note.trim()}` : patch.note.trim()
    : current.reopenNote;
  const resolvedCommit = to === "대기" ? null : to === "완료" ? patch.commit!.trim() : current.resolvedCommit;
  const resolvedNote = to === "대기" ? null : patch.note?.trim() || (to === "완료" || to === "보류" ? null : current.resolvedNote);
  const resolvedAt = to === "대기" ? null : to === "완료" || to === "보류" ? now : current.resolvedAt;
  db.prepare(`UPDATE tile_request SET status = ?, updated_at = ?, resolved_commit = ?, resolved_note = ?, resolved_at = ?, reopen_note = ? WHERE request_id = ?`)
    .run(to, now, resolvedCommit, resolvedNote, resolvedAt, reopenNote, id);
  return { ok: true, request: getTileRequest(db, id)! };
}
