import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { booleanPointInPolygon, multiPolygon, point, polygon } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { z } from "zod";

import type { MaintenanceProject, MaintenanceStage } from "../../types";

export const SEOUL_CLEANUP_LIST_URL = "https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do";
export const SEOUL_CLEANUP_SITE_URL = "https://cleanup.seoul.go.kr/";

/** 정보몽땅 진행단계 중 사업이 사실상 종료된 상태 — 지도 표시 제외 대상 */
const COMPLETED_STAGE_PATTERN = /준공인가|조합해산|조합청산|이전고시/u;

export function isCompletedCleanupStage(stageText: string): boolean {
  return COMPLETED_STAGE_PATTERN.test(stageText.replaceAll(" ", ""));
}

export function mapCleanupStage(stageText: string): MaintenanceStage {
  const compact = stageText.replaceAll(" ", "");
  if (COMPLETED_STAGE_PATTERN.test(compact)) return "준공";
  if (/착공|분양/u.test(compact)) return "착공";
  if (/관리처분|철거/u.test(compact)) return "관리처분";
  if (compact.includes("사업시행")) return "사업시행인가";
  if (compact.includes("조합설립")) return "조합설립";
  if (/추진위|추진위원/u.test(compact)) return "추진위";
  if (/구역지정|정비계획|안전진단/u.test(compact)) return "구역지정/변경";
  return "미확인";
}

export interface SeoulCleanupRow {
  readonly no: number;
  readonly sigungu: string;
  readonly type: string;
  readonly name: string;
  readonly address: string;
  readonly stage_text: string;
  readonly record_code?: string;
  readonly cafe_id?: string;
  readonly lat?: number;
  readonly lng?: number;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function cellText(cellHtml: string): string {
  return decodeEntities(cellHtml.replace(/<[^>]*>/gu, " ")).replaceAll(/\s+/gu, " ").trim();
}

/** 정보몽땅 사업장검색 결과 페이지(HTML)에서 목록 행을 추출한다. */
export function parseSeoulCleanupListPage(html: string): readonly SeoulCleanupRow[] {
  const tbody = /<tbody[\s\S]*?<\/tbody>/u.exec(html)?.[0];
  if (!tbody) return [];
  const rows: SeoulCleanupRow[] = [];
  for (const rowMatch of tbody.matchAll(/<tr[\s\S]*?<\/tr>/gu)) {
    const rowHtml = rowMatch[0];
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map((match) => cellText(match[1] ?? ""));
    if (cells.length < 6) continue;
    const no = Number(cells[0]);
    if (!Number.isInteger(no) || no <= 0) continue;
    const [, sigungu = "", type = "", name = "", address = "", stageText = ""] = cells;
    if (!sigungu || !name || !stageText) continue;
    const recordCode = /mapOpenPopup\('([^']+)'\)/u.exec(rowHtml)?.[1]?.trim();
    const cafeId = /cafeOpenPopup\('([^']+)'\)/u.exec(rowHtml)?.[1]?.trim();
    rows.push({
      no, sigungu, type, name, address, stage_text: stageText,
      ...(recordCode ? { record_code: recordCode } : {}),
      ...(cafeId ? { cafe_id: cafeId } : {}),
    });
  }
  return rows;
}

const rowSchema = z.object({
  no: z.number().int().positive(),
  sigungu: z.string().min(1),
  type: z.string(),
  name: z.string().min(1),
  address: z.string(),
  stage_text: z.string().min(1),
  record_code: z.string().min(1).optional(),
  cafe_id: z.string().min(1).optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
});

export const seoulCleanupArtifactSchema = z.object({
  schema_version: z.literal(1),
  source_url: z.string().min(1),
  retrieved_at: z.string().min(1),
  record_count: z.number().int().positive(),
  records: z.array(rowSchema).min(1),
}).refine((artifact) => artifact.record_count === artifact.records.length, {
  message: "record_count must equal records.length",
});

export type SeoulCleanupArtifact = z.infer<typeof seoulCleanupArtifactSchema>;

export class SeoulCleanupArtifactError extends Error {
  readonly name = "SeoulCleanupArtifactError";
  constructor(
    readonly code: "UNREADABLE" | "MALFORMED" | "INVALID_SCHEMA",
    readonly artifactPath: string,
    cause: unknown,
  ) {
    super(`Seoul cleanup artifact ${code.toLowerCase()}: ${artifactPath}`, { cause });
  }
}

type ArtifactCacheEntry = { readonly mtimeMs: number; readonly artifact: SeoulCleanupArtifact };
const artifactCache = new Map<string, ArtifactCacheEntry>();

export function loadSeoulCleanupArtifact(
  artifactPath = join(process.cwd(), "data/maintenance/processed/seoul-cleanup.json"),
): SeoulCleanupArtifact {
  const absolutePath = resolve(artifactPath);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(absolutePath).mtimeMs;
  } catch (error) {
    throw new SeoulCleanupArtifactError("UNREADABLE", absolutePath, error);
  }
  const cached = artifactCache.get(absolutePath);
  if (cached?.mtimeMs === mtimeMs) return cached.artifact;
  let decoded: unknown;
  try {
    decoded = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new SeoulCleanupArtifactError("MALFORMED", absolutePath, error);
  }
  const parsed = seoulCleanupArtifactSchema.safeParse(decoded);
  if (!parsed.success) throw new SeoulCleanupArtifactError("INVALID_SCHEMA", absolutePath, parsed.error);
  artifactCache.set(absolutePath, { mtimeMs, artifact: parsed.data });
  return parsed.data;
}

function projectPolygon(project: MaintenanceProject): Feature<Polygon | MultiPolygon> | null {
  const boundary = project.boundary;
  if (!boundary) return null;
  return boundary.type === "Polygon"
    ? polygon(boundary.coordinates.map((ring) => ring.map(([lng, lat]) => [lng, lat])))
    : multiPolygon(boundary.coordinates.map((part) => part.map((ring) => ring.map(([lng, lat]) => [lng, lat]))));
}

function normalizedNameToken(value: string): string {
  return value.normalize("NFKC").replaceAll(/[^\p{L}\p{N}]/gu, "");
}

function nameCompatible(projectName: string, rowName: string): boolean {
  const left = normalizedNameToken(projectName);
  const right = normalizedNameToken(rowName);
  if (left.length < 2 || right.length < 2) return false;
  return left.includes(right) || right.includes(left);
}

export interface SeoulCleanupEnhanceResult {
  readonly projects: readonly MaintenanceProject[];
  readonly appliedCount: number;
  readonly ambiguousCount: number;
}

/**
 * 정보몽땅 사업장 좌표를 경계 폴리곤에 공간조인해 진행단계를 부여한다.
 * 폴리곤 안에 서로 다른 단계의 사업장이 여럿이면 이름 호환 후보 1건일 때만 적용한다.
 */
export function enhanceProjectsWithSeoulCleanup(
  projects: readonly MaintenanceProject[],
  records: readonly SeoulCleanupRow[],
): SeoulCleanupEnhanceResult {
  const located = records.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
  if (!located.length) return { projects, appliedCount: 0, ambiguousCount: 0 };
  let appliedCount = 0;
  let ambiguousCount = 0;
  const enhanced = projects.map((project) => {
    const feature = projectPolygon(project);
    if (!feature) return project;
    const inside = located.filter((row) => booleanPointInPolygon(point([row.lng as number, row.lat as number]), feature));
    if (!inside.length) return project;
    const stageTexts = new Set(inside.map((row) => row.stage_text));
    let selected: SeoulCleanupRow | undefined;
    if (stageTexts.size === 1) {
      selected = inside[0];
    } else {
      const compatible = inside.filter((row) => nameCompatible(project.name, row.name));
      if (compatible.length === 1) selected = compatible[0];
    }
    if (!selected) {
      ambiguousCount += 1;
      return project;
    }
    appliedCount += 1;
    return {
      ...project,
      stage: mapCleanupStage(selected.stage_text),
      stage_detail: selected.stage_text,
      ...(project.notice_url ? {} : { notice_url: SEOUL_CLEANUP_SITE_URL }),
    };
  });
  return { projects: enhanced, appliedCount, ambiguousCount };
}

export interface CompletedSplitResult {
  readonly active: readonly MaintenanceProject[];
  readonly completed: readonly MaintenanceProject[];
}

/** 준공·해산·청산·이전고시 등 종료된 사업을 지도 표시 대상에서 분리한다. */
export function splitCompletedMaintenanceProjects(
  projects: readonly MaintenanceProject[],
): CompletedSplitResult {
  const active: MaintenanceProject[] = [];
  const completed: MaintenanceProject[] = [];
  for (const project of projects) {
    const done = project.stage === "준공"
      || (project.stage_detail !== undefined && isCompletedCleanupStage(project.stage_detail));
    (done ? completed : active).push(project);
  }
  return { active, completed };
}
