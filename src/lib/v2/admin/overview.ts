import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { readManifest, openDataFile, type Manifest } from "../data/manifest";
import { DATA_FILE_KINDS } from "../data/schema";
import { cacheEngineVersion } from "../engine/tiles/common";
import { DATE_INDEPENDENT, HEAVY_TILES, SITE_DEPENDENT_TILE_CODES } from "../tile/server";
import { CUT_CODES } from "../tile/client";
import { DETAIL_CODES } from "../ui/detail-state";
import { TILE_CATALOG, TILE_CODES, sourceName, type TileForm, type TileKind } from "../ui/tile-catalog";
import { TILE_CODE_RENAMES } from "../ui/board-state";
import { readGuideSourceSnapshot, type GuideSourceRelease } from "../ui/guide-sources";
import { sourceOps, SOURCE_DETAIL_DEFINITIONS, type SourceCollect } from "../ui/source-details";
import { tileReportModuleFor } from "../tile/report";
import { TILE_STATUSES } from "../tile-result";
import { ageDays, compareTileSources, type SourceCheck } from "./provenance-check";

type Db = BetterSqlite3.Database;

export type AdminSource = {
  sourceId: string;
  name: string;
  provider: string;
  url: string;
  asOf: string | null;
  fetchedAt: string | null;
  ageDays: number | null;
  license: string;
  group: string | null;
  collect: SourceCollect | null;
  cycle: string | null;
  expected: number | null;
  accepted: number | null;
  rejected: number | null;
  fileKey: string | null;
  runtime: boolean;
  usedBy: string[];
};

export type AdminTile = {
  code: string;
  title: string;
  kind: TileKind;
  forms: TileForm[];
  declaredSources: string[];
  actualSources: string[] | null;
  check: SourceCheck;
  resultStatus: (typeof TILE_STATUSES)[number] | null;
  heavy: boolean;
  dateIndependent: boolean;
  siteDependent: boolean;
  cut: boolean;
  detail: boolean;
  reportHook: boolean;
  absorbs: string[];
  cacheVersion: string;
  files: string[];
  orphan: boolean;
};

export type AdminOverview = {
  generatedAt: string;
  manifest: {
    version: string | null;
    createdAt: string | null;
    files: Array<{ key: string; path: string }>;
  };
  analysis: { id: string; address: string; radiusM: number; analysisDate: string } | null;
  sources: AdminSource[];
  tiles: AdminTile[];
};

const RUNTIME_SOURCE_IDS = ["vworld_wmts", "ngii_topo", "browser_lbm", "fallback_d2q9"] as const;

type AnalysisRow = {
  analysis_id: string;
  address: string;
  radius_m: number;
  analysis_date: string;
  user_id: string | null;
  status: string;
  created_at: string;
};

type TileRow = { tile_code: string; status: string; result_json: string };
type IngestRow = { expected_count: number | null; accepted_count: number; rejected_count: number };

function analysisRow(db: Db, analysisId: string | null, userId: string | number): AnalysisRow | null {
  const requested = analysisId
    ? db.prepare("SELECT analysis_id, address, radius_m, analysis_date, user_id, status, created_at FROM analysis_run WHERE analysis_id = ?").get(analysisId) as AnalysisRow | undefined
    : undefined;
  if (requested) return requested;
  return db.prepare(`SELECT analysis_id, address, radius_m, analysis_date, user_id, status, created_at
    FROM analysis_run WHERE status = 'complete' AND user_id = ? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`).get(String(userId)) as AnalysisRow | undefined ?? null;
}

function manifestSummary(manifest: Manifest | null): AdminOverview["manifest"] {
  if (!manifest) return { version: null, createdAt: null, files: [] };
  return {
    version: manifest.version,
    createdAt: manifest.createdAt,
    files: Object.entries(manifest.files).map(([key, file]) => ({ key, path: file.path })),
  };
}

function ingestFor(dataDir: string, manifest: Manifest | null, row: GuideSourceRelease): IngestRow | null {
  if (!manifest || !row.fileKey || !manifest.files[row.fileKey] || !(DATA_FILE_KINDS as readonly string[]).includes(manifest.files[row.fileKey].kind)) return null;
  let db: Db | null = null;
  try {
    db = openDataFile(dataDir, manifest, row.fileKey);
    return db.prepare(`SELECT expected_count, accepted_count, rejected_count FROM ingest_run
      WHERE release_id = ? ORDER BY rowid DESC LIMIT 1`).get(row.releaseId) as IngestRow | undefined ?? null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function usedByFor(sourceId: string): string[] {
  return TILE_CODES.filter((code) => (TILE_CATALOG[code].sources as readonly string[]).includes(sourceId)).slice();
}

function sourceRow(row: GuideSourceRelease, dataDir: string, manifest: Manifest | null, today: string): AdminSource {
  const operations = sourceOps(row.sourceId);
  const ingest = ingestFor(dataDir, manifest, row);
  return {
    sourceId: row.sourceId,
    name: sourceName(row.sourceId),
    provider: row.provider || sourceName(row.sourceId),
    url: row.sourceUrl || "",
    asOf: row.sourceAsOf,
    fetchedAt: row.fetchedAt || null,
    ageDays: ageDays(row.sourceAsOf, today),
    license: row.licenseCode || "미기록",
    group: operations.group,
    collect: operations.collect,
    cycle: operations.cycle,
    expected: ingest?.expected_count ?? null,
    accepted: ingest?.accepted_count ?? null,
    rejected: ingest?.rejected_count ?? null,
    fileKey: row.fileKey === "catalog" ? null : row.fileKey,
    runtime: RUNTIME_SOURCE_IDS.includes(row.sourceId as (typeof RUNTIME_SOURCE_IDS)[number]),
    usedBy: usedByFor(row.sourceId),
  };
}

function runtimeSource(sourceId: string): AdminSource {
  const definition = SOURCE_DETAIL_DEFINITIONS[sourceId];
  const operations = sourceOps(sourceId);
  return {
    sourceId,
    name: sourceName(sourceId),
    provider: definition?.provider ?? sourceName(sourceId),
    url: definition?.sourceUrl ?? "",
    asOf: null,
    fetchedAt: null,
    ageDays: null,
    license: definition?.license ?? "미기록",
    group: operations.group,
    collect: operations.collect,
    cycle: operations.cycle,
    expected: null,
    accepted: null,
    rejected: null,
    fileKey: null,
    runtime: true,
    usedBy: usedByFor(sourceId),
  };
}

function sourceRows(dataDir: string, manifest: Manifest | null, today: string): AdminSource[] {
  const snapshot = readGuideSourceSnapshot(dataDir);
  const rows = snapshot.rows.map((row) => sourceRow(row, dataDir, manifest, today));
  const byId = new Map(rows.map((row) => [row.sourceId, row]));
  for (const sourceId of RUNTIME_SOURCE_IDS) if (!byId.has(sourceId)) rows.push(runtimeSource(sourceId));
  return rows;
}

function filesFor(repoRoot: string, code: string): string[] {
  const dir = join(repoRoot, "src", "lib", "v2", "tile", code.toLowerCase());
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

function actualSourcesFor(row: TileRow): string[] {
  try {
    const json = JSON.parse(row.result_json) as { provenance?: { sources?: unknown } };
    if (!Array.isArray(json.provenance?.sources)) return [];
    return [...new Set(json.provenance.sources.flatMap((source) => {
      if (!source || typeof source !== "object") return [];
      const sourceId = (source as { sourceId?: unknown }).sourceId;
      return typeof sourceId === "string" ? [sourceId] : [];
    }))];
  } catch {
    return [];
  }
}

function tileRows(db: Db, analysis: AnalysisRow | null): Map<string, TileRow> {
  if (!analysis) return new Map();
  return new Map((db.prepare("SELECT tile_code, status, result_json FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").all(analysis.analysis_id) as TileRow[]).map((row) => [row.tile_code, row]));
}

export function buildAdminOverview(input: { appDb: Db; dataDir: string; analysisId: string | null; userId: string | number; today?: string; repoRoot?: string }): AdminOverview {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const manifest = readManifest(input.dataDir);
  const analysis = analysisRow(input.appDb, input.analysisId, input.userId);
  const rows = tileRows(input.appDb, analysis);
  const repoRoot = input.repoRoot ?? process.cwd();
  const tiles = TILE_CODES.map((code): AdminTile => {
    const catalog = TILE_CATALOG[code];
    const stored = rows.get(code);
    const actualSources = analysis && stored ? actualSourcesFor(stored) : null;
    const check = compareTileSources(catalog.sources, actualSources);
    const resultStatus = stored && (TILE_STATUSES as readonly string[]).includes(stored.status) ? stored.status as (typeof TILE_STATUSES)[number] : null;
    const absorbs = Object.entries(TILE_CODE_RENAMES).filter(([, target]) => target === code).map(([oldCode]) => oldCode);
    return {
      code,
      title: catalog.title,
      kind: catalog.kind,
      forms: [...catalog.forms],
      declaredSources: [...catalog.sources],
      actualSources,
      check,
      resultStatus,
      heavy: HEAVY_TILES.includes(code as (typeof HEAVY_TILES)[number]),
      dateIndependent: DATE_INDEPENDENT.has(code),
      siteDependent: SITE_DEPENDENT_TILE_CODES.has(code),
      cut: CUT_CODES.has(code),
      detail: DETAIL_CODES.has(code),
      reportHook: tileReportModuleFor(code) !== undefined,
      absorbs,
      cacheVersion: cacheEngineVersion(code),
      files: filesFor(repoRoot, code),
      orphan: (catalog.sources as readonly string[]).length === 0 && (actualSources === null || actualSources.length === 0),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    manifest: manifestSummary(manifest),
    analysis: analysis ? { id: analysis.analysis_id, address: analysis.address, radiusM: analysis.radius_m, analysisDate: analysis.analysis_date } : null,
    sources: sourceRows(input.dataDir, manifest, today),
    tiles,
  };
}
