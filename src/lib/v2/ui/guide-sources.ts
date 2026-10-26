/** 가이드 페이지가 게시 manifest의 원천 메타를 읽는 서버 전용 경로. 파일을 만들거나 갱신하지 않는다. */
import type BetterSqlite3 from "better-sqlite3";
import { DATA_FILE_KINDS } from "../data/schema";
import { openDataFile, readManifest } from "../data/manifest";
import { v2DataDir } from "../paths";
import { SOURCE_DETAIL_DEFINITIONS } from "./source-details";

export type GuideSourceRelease = {
  sourceId: string;
  releaseId: string;
  provider: string;
  sourceUrl: string;
  sourceAsOf: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  licenseCode: string;
  rights: Record<string, unknown>;
  fileKey: string;
};

export type GuideSourceSnapshot = {
  manifestVersion: string | null;
  manifestCreatedAt: string | null;
  rows: GuideSourceRelease[];
};

type ReleaseRow = {
  source_id: string;
  release_id: string;
  provider: string;
  source_url: string;
  source_as_of: string | null;
  published_at: string | null;
  fetched_at: string;
  license_code: string;
  rights_json: string | null;
};

function rightsOf(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function catalogFallbackFor(sourceId: string): GuideSourceRelease | null {
  if (sourceId !== "ngii_topo") return null;
  const definition = SOURCE_DETAIL_DEFINITIONS[sourceId];
  return {
    sourceId,
    releaseId: "catalog",
    provider: definition?.provider ?? "제공처 미기록",
    sourceUrl: definition?.sourceUrl ?? "",
    sourceAsOf: null,
    publishedAt: null,
    fetchedAt: "",
    licenseCode: definition?.license ?? "미기록",
    rights: {},
    fileKey: "catalog",
  };
}

/** 여러 data file에 중복 저장된 source_release를 releaseId 단위로 한 번만 반환한다. */
export function readGuideSourceSnapshot(dataDir: string = v2DataDir()): GuideSourceSnapshot {
  try {
    const manifest = readManifest(dataDir);
    if (!manifest) return { manifestVersion: null, manifestCreatedAt: null, rows: [] };

    const rows: GuideSourceRelease[] = [];
    const seen = new Set<string>();
    for (const [fileKey, file] of Object.entries(manifest.files)) {
      if (!(DATA_FILE_KINDS as readonly string[]).includes(file.kind)) continue;
      let db: BetterSqlite3.Database | null = null;
      try {
        db = openDataFile(dataDir, manifest, fileKey);
        const releases = db.prepare(`SELECT source_id, release_id, provider, source_url, source_as_of, published_at, fetched_at, license_code, rights_json
          FROM source_release ORDER BY source_id, release_id`).all() as ReleaseRow[];
        for (const release of releases) {
          if (seen.has(release.release_id)) continue;
          seen.add(release.release_id);
          rows.push({
            sourceId: release.source_id,
            releaseId: release.release_id,
            provider: release.provider,
            sourceUrl: release.source_url,
            sourceAsOf: release.source_as_of,
            publishedAt: release.published_at,
            fetchedAt: release.fetched_at,
            licenseCode: release.license_code,
            rights: rightsOf(release.rights_json),
            fileKey,
          });
        }
      } catch {
        // 부분 게시본·구형 파일은 가이드 전체를 깨뜨리지 않고 카탈로그 fallback을 사용한다.
      } finally {
        db?.close();
      }
    }
    if (!rows.some((row) => row.sourceId === "ngii_topo")) {
      const fallback = catalogFallbackFor("ngii_topo");
      if (fallback) rows.push(fallback);
    }
    rows.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.releaseId.localeCompare(b.releaseId));
    return { manifestVersion: manifest.version, manifestCreatedAt: manifest.createdAt, rows };
  } catch {
    return { manifestVersion: null, manifestCreatedAt: null, rows: [] };
  }
}
