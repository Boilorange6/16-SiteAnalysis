import type { AnalysisProjectPayload, AnalysisProjectRecord, AnalysisProjectSummary } from "@/lib/project-types";
import { getDb } from "./database";

interface ProjectRow {
  readonly id: number;
  readonly title: string;
  readonly center_name: string;
  readonly center_lat: number;
  readonly center_lng: number;
  readonly radius_km: number;
  readonly payload_json: string;
  readonly created_at: number;
  readonly updated_at: number;
}

function parsePayload(payloadJson: string): AnalysisProjectPayload {
  return JSON.parse(payloadJson) as AnalysisProjectPayload;
}

function rowToRecord(row: ProjectRow): AnalysisProjectRecord {
  return {
    id: row.id,
    title: row.title,
    centerName: row.center_name,
    centerLat: row.center_lat,
    centerLng: row.center_lng,
    radiusKm: row.radius_km,
    payload: parsePayload(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: ProjectRow): AnalysisProjectSummary {
  let payload: AnalysisProjectPayload | null = null;
  try {
    payload = parsePayload(row.payload_json);
  } catch {
    payload = null;
  }

  return {
    id: row.id,
    title: row.title,
    centerName: row.center_name,
    centerLat: row.center_lat,
    centerLng: row.center_lng,
    radiusKm: row.radius_km,
    manualPoiCount: payload?.manualPois.length ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAnalysisProjects(userId: number): AnalysisProjectSummary[] {
  const rows = getDb()
    .prepare(
      "SELECT id, title, center_name, center_lat, center_lng, radius_km, payload_json, created_at, updated_at FROM analysis_projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
    )
    .all(userId) as ProjectRow[];
  return rows.map(rowToSummary);
}

export function getAnalysisProject(userId: number, id: number): AnalysisProjectRecord | null {
  const row = getDb()
    .prepare(
      "SELECT id, title, center_name, center_lat, center_lng, radius_km, payload_json, created_at, updated_at FROM analysis_projects WHERE user_id = ? AND id = ?",
    )
    .get(userId, id) as ProjectRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function createAnalysisProject(
  userId: number,
  title: string,
  payload: AnalysisProjectPayload,
): AnalysisProjectRecord {
  const now = Date.now() / 1000;
  const config = payload.config;
  const result = getDb()
    .prepare(
      `INSERT INTO analysis_projects
       (user_id, title, center_name, center_lat, center_lng, radius_km, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      title,
      config.centerName,
      config.centerLat,
      config.centerLng,
      config.radiusKm,
      JSON.stringify(payload),
      now,
      now,
    );
  return getAnalysisProject(userId, result.lastInsertRowid as number)!;
}

export function updateAnalysisProject(
  userId: number,
  id: number,
  title: string,
  payload: AnalysisProjectPayload,
): AnalysisProjectRecord | null {
  const now = Date.now() / 1000;
  const config = payload.config;
  const result = getDb()
    .prepare(
      `UPDATE analysis_projects
       SET title = ?, center_name = ?, center_lat = ?, center_lng = ?, radius_km = ?, payload_json = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      title,
      config.centerName,
      config.centerLat,
      config.centerLng,
      config.radiusKm,
      JSON.stringify(payload),
      now,
      userId,
      id,
    );
  return result.changes > 0 ? getAnalysisProject(userId, id) : null;
}

export function deleteAnalysisProject(userId: number, id: number): boolean {
  const result = getDb()
    .prepare("DELETE FROM analysis_projects WHERE user_id = ? AND id = ?")
    .run(userId, id);
  return result.changes > 0;
}
