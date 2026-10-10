/**
 * 행정안전부 도로명주소 건물 도형(VWorld dsId 30056, TL_SPBD_BULD_<시도>_<YYYYMM>, EPSG:5179) → 보조 건물 원천.
 * GIS건물통합정보(AL_D010)에 없는 건물(최근 준공·대단지)을 채우고, 층수로 높이가 없는 GIS 건물에 높이를 보태는 용도다.
 *   - GIS 건물과 겹치는 도로명주소 건물(겹친 면적 ≥ 작은 쪽 면적의 50%)은 기본적으로 같은 건물로 본다.
 *     다만 오래된 GIS 승인일·core PNU 승인일·서로 다른 이름이 모두 확인되면 옛 GIS를 retired로 표시하고
 *     juso 행을 새 건물로 넣는다(삭제하지 않고 feature_link로 대체 관계를 남긴다).
 *     같은 건물로 본 경우에는 그 GIS 건물의 높이가 미상이면 지상층수×층고(GIS와 같은 FLOOR_HEIGHT_M)로,
 *     이름이 없으면 건물명을 보탠다(출처는 field_provenance_json).
 *   - 겹치지 않는 건물은 `juso:<건물관리번호>` 새 건물이다. 사용승인일·용도코드는 원천에 없어 비운다(BDTYP_CD는 건축물대장 용도코드와 체계가 달라 properties에만 둔다).
 * 시도 파일 하나가 한 단계(buildResumableSteps)다. GIS 건물 단계가 모두 끝난 뒤에 돌아야 한다.
 */
import { closeSync, openSync, readSync } from "node:fs";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, MultiPolygon, Polygon, Position } from "geojson";
import { feature, featureCollection, intersect } from "@turf/turf";
import { insertFeature } from "../../data/features";
import { makePnu } from "../../data/parcels";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";
import { COORD_DECIMALS, FLOOR_HEIGHT_M, heightOf } from "./buildings";

type Db = BetterSqlite3.Database;

export const JUSO_SOURCE_ID = "building_juso";
export const JUSO_PROVIDER = "행정안전부(VWorld 도로명주소 건물)";
export const JUSO_SOURCE_URL = "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30056";
/** VWorld 30056 페이지 표기: CC BY-NC-ND(저작자표시-비영리-변경금지). 2026-10-07 사용자 결정: 비영리로 사용하고 출처를 표기한다. */
export const JUSO_LICENSE_CODE = "CC BY-NC-ND";
export const JUSO_RIGHTS = { attribution: "행정안전부 도로명주소 건물(VWorld 제공)", licenseStatus: "verified", note: "CC BY-NC-ND — 비영리 사용, 출처 표기 필수(2026-10-07 사용자 결정)" };
/** 겹침 판정: 겹친 면적 / 작은 쪽 면적 */
export const OVERLAP_MIN = 0.5;
/** 이 연도 이하의 GIS 승인일만 신축 대체 후보의 옛 건물로 본다. 근거가 없으면 GIS를 유지한다. */
export const RETIRED_GIS_MAX_APPROVAL_YEAR = 2010;
const CELL_M = 64;
const GEOM_CACHE_MAX = 100_000;
const PAD_M = 10;
const JUSO_PERF_ENABLED = process.env.SITE_ANALYSIS_JUSO_PERF !== "0";

const SHP_RE = /^TL_SPBD_BULD_(\d{2})_(\d{6})\.shp$/i;

/** 시도(2자리)마다 가장 새 기준월의 .shp. */
export function jusoShpPerSido(paths: readonly string[]): Map<string, { date: string; file: string }> {
  const best = new Map<string, { date: string; file: string }>();
  for (const file of paths) {
    const m = SHP_RE.exec(basename(file));
    if (!m) continue;
    const cur = best.get(m[1]);
    if (!cur || m[2] > cur.date) best.set(m[1], { date: m[2], file });
  }
  return new Map([...best].sort(([a], [b]) => a.localeCompare(b)));
}

/** .shp 머리말의 [xmin, ymin, xmax, ymax] */
export function shpExtent(shpFile: string): [number, number, number, number] {
  const fd = openSync(shpFile, "r");
  try {
    const b = Buffer.alloc(100);
    readSync(fd, b, 0, 100, 0);
    return [b.readDoubleLE(36), b.readDoubleLE(44), b.readDoubleLE(52), b.readDoubleLE(60)];
  } finally {
    closeSync(fd);
  }
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

/** 단지·동 이름의 표기 차이(공백·괄호·구두점)만 제거한다. 모르는 접두어는 보수적으로 남긴다. */
export function normalizeBuildingName(value: string | null): string | null {
  const name = value?.trim();
  return name ? name.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s()·,._\-/\\]/g, "") : null;
}

/**
 * 도로명주소 원천의 표시용 건물명과 동/상세명을 하나의 라벨로 조립한다.
 * 비교용 정규화(normalizeBuildingName)와 달리 표시 문자열의 공백·구두점은 보존한다.
 * 단, 문자·숫자가 하나도 없는 값은 원천의 자리 채움 기호로 보고 버린다.
 */
export function composeBuildingName(value: string | null, detail: string | null): string | null {
  const cleanPart = (candidate: string | null): string | null => {
    const part = candidate?.normalize("NFKC").trim() ?? "";
    const onlyJamo = part.length > 0 && [...part].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint >= 0x1100 && codePoint <= 0x11ff) || (codePoint >= 0xa960 && codePoint <= 0xa97f) || (codePoint >= 0xd7b0 && codePoint <= 0xd7ff);
    });
    return part && /[\p{L}\p{N}]/u.test(part) && !onlyJamo ? part : null;
  };
  const name = cleanPart(value);
  const extra = cleanPart(detail);
  if (!name) return extra;
  if (!extra) return name;

  const normalizedName = normalizeBuildingName(name);
  const normalizedExtra = normalizeBuildingName(extra);
  if (!normalizedName || !normalizedExtra) return name;
  if (normalizedName === normalizedExtra || normalizedName.includes(normalizedExtra)) return name;
  if (normalizedExtra.includes(normalizedName)) return extra;
  return `${name} ${extra}`;
}

function validCoreApprovalDate(value: unknown, maxDate: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > maxDate) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

const coreApprovalCache = new WeakMap<Db, Map<string, Map<string, string>>>();

/**
 * core의 해당 시도 PNU만 한 번 읽어 juso 파일의 모든 행이 공유한다.
 * 전국 적재에서도 행마다 core를 조회하지 않고 시도별 range scan 1회로 끝낸다.
 */
export function coreApprovalByPnu(core: Db | null | undefined, sido: string, maxDate = "9999-12-31"): Map<string, string> {
  if (!core || !/^\d{2}$/.test(sido)) return new Map();
  let byKey = coreApprovalCache.get(core);
  if (!byKey) coreApprovalCache.set(core, (byKey = new Map()));
  const key = `${sido}:${maxDate}`;
  const cached = byKey.get(key);
  if (cached) return cached;

  const dates = new Map<string, string>();
  try {
    const start = `${sido}${"0".repeat(17)}`;
    const next = Number(sido) + 1;
    const end = next <= 99 ? `${String(next).padStart(2, "0")}${"0".repeat(17)}` : null;
    const sql = `SELECT pnu, properties_json FROM feature
      WHERE pnu >= ? ${end ? "AND pnu < ?" : ""}
        AND kind IN ('housing_complex', 'officetel')`;
    const rows = (end ? core.prepare(sql).all(start, end) : core.prepare(sql).all(start)) as Array<{ pnu: string; properties_json: string }>;
    for (const row of rows) {
      let approval: unknown = null;
      try {
        approval = (JSON.parse(row.properties_json) as { approvalDate?: unknown }).approvalDate;
      } catch {
        // malformed optional properties are not evidence for replacement
      }
      const date = validCoreApprovalDate(approval, maxDate);
      if (date && (!dates.has(row.pnu) || date < dates.get(row.pnu)!)) dates.set(row.pnu, date);
    }
  } catch {
    // core가 없는 구버전/부분 파일이면 적재를 보수적으로 계속한다.
  }
  byKey.set(key, dates);
  return dates;
}

const ringArea = (ring: Position[]): number => {
  let s = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(s) / 2;
};
const polyArea = (rings: Position[][]): number => rings.reduce((a, r, i) => a + (i === 0 ? ringArea(r) : -ringArea(r)), 0);
/** 평면 면적(㎡). 좌표가 EPSG:5179 미터일 때만 의미가 있다. */
export function planarArea(g: Geometry): number {
  if (g.type === "Polygon") return polyArea(g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.reduce((a, p) => a + polyArea(p), 0);
  return 0;
}
const isAreal = (g: Geometry | null): g is Polygon | MultiPolygon => g !== null && (g.type === "Polygon" || g.type === "MultiPolygon");

function bboxOf(g: Polygon | MultiPolygon): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

/** 구멍 없는 Polygon의 바깥 고리(닫힌 고리), 아니면 null */
const solidRing = (g: Polygon | MultiPolygon): Position[] | null => (g.type === "Polygon" && g.coordinates.length === 1 ? g.coordinates[0] : null);

/** 닫힌 고리가 볼록이면 반시계 방향으로 맞춘 고리, 아니면 null */
function convexCcw(ring: Position[]): Position[] | null {
  let sign = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n], [cx, cy] = ring[(i + 2) % n];
    const c = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    // 좌표를 1 cm로 반올림해 거의 일직선인 꼭짓점이 미세하게 꺾인다 — 0.5 ㎡ 미만의 꺾임은 일직선으로 본다(겹침 50% 판정에 영향 없음)
    if (Math.abs(c) < 0.5) continue;
    if (sign !== 0 && Math.sign(c) !== sign) return null;
    sign = Math.sign(c);
  }
  return sign >= 0 ? ring : [...ring].reverse();
}

/** Sutherland–Hodgman: 볼록 clip(반시계)으로 subject를 잘라 겹친 면적을 낸다. 건물 대부분이 사각형이라 polyclip보다 훨씬 빠르다. */
function clipArea(subject: Position[], clip: Position[]): number {
  let out = subject.slice(0, -1);
  for (let e = 0; e < clip.length - 1 && out.length > 0; e++) {
    const [ax, ay] = clip[e], [bx, by] = clip[e + 1];
    const side = (p: Position) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const sc = side(cur), sp = side(prev);
      if ((sc >= 0) !== (sp >= 0)) {
        const t = sp / (sp - sc);
        out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
      }
      if (sc >= 0) out.push(cur);
    }
  }
  return out.length < 3 ? 0 : ringArea([...out, out[0]]);
}

export const triCache = new WeakMap<Position[], Position[][] | null>();

/** 귀 자르기(O(n²))로 단순 다각형을 반시계 삼각형들로 나눈다. 실패하거나 면적이 안 맞으면 null(→ polyclip). 고리 객체별로 기억한다. */
export function triangulate(ring: Position[]): Position[][] | null {
  if (triCache.has(ring)) return triCache.get(ring)!;
  const pts = ring.slice(0, -1);
  const idx = pts.map((_, i) => i);
  const signed = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;
  if (signed < 0) idx.reverse();
  const tris: Position[][] = [];
  const cross = (a: Position, b: Position, c: Position) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let ok = pts.length >= 3;
  while (ok && idx.length > 3) {
    ok = false;
    for (let k = 0; k < idx.length; k++) {
      const [ia, ib, ic] = [idx[(k + idx.length - 1) % idx.length], idx[k], idx[(k + 1) % idx.length]];
      const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
      const cr = cross(a, b, c);
      if (Math.abs(cr) <= 1e-9) { idx.splice(k, 1); ok = true; break; } // 일직선 꼭짓점은 버린다
      if (cr < 0) continue; // 오목 꼭짓점
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && cross(a, b, pts[j]) >= -1e-9 && cross(b, c, pts[j]) >= -1e-9 && cross(c, a, pts[j]) >= -1e-9)) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      ok = true;
      break;
    }
  }
  let result: Position[][] | null = null;
  if (ok && idx.length === 3) {
    tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
    const sum = tris.reduce((s, t) => s + cross(t[0], t[1], t[2]) / 2, 0);
    if (Math.abs(sum - Math.abs(signed)) <= 1e-6 * Math.abs(signed) + 1e-6) result = tris.map((t) => [...t, t[0]]);
  }
  triCache.set(ring, result);
  return result;
}

/** 두 도형의 겹친 면적(㎡). 위상 오류로 교차를 못 구하면 0(=겹침 없음)으로 보고 errors를 올린다. */
export function overlapArea(a: Polygon | MultiPolygon, b: Polygon | MultiPolygon, onError?: () => void, onSlow?: () => void, onTriangulate?: () => void): number {
  const ra = solidRing(a), rb = solidRing(b);
  if (ra && rb) {
    const cb = convexCcw(rb);
    if (cb) return clipArea(ra, cb);
    const ca = convexCcw(ra);
    if (ca) return clipArea(rb, ca);
    // 둘 다 오목: 삼각형으로 나눠 삼각형 쌍마다 볼록 자르기
    onTriangulate?.();
    const ta = triangulate(ra), tb = triangulate(rb);
    if (ta && tb) {
      let s = 0;
      for (const t of ta) for (const u of tb) s += clipArea(t, u);
      return s;
    }
  }
  onSlow?.();
  try {
    const r = intersect(featureCollection([feature(a), feature(b)]));
    return r ? planarArea(r.geometry) : 0;
  } catch {
    onError?.();
    return 0;
  }
}

interface GisIndex {
  ids: number[];
  stableIds: string[];
  names: (string | null)[];
  approvalDates: (string | null)[];
  bbox: number[];
  /** 1 = 높이 미상, 2 = 이름 없음 */
  need: number[];
  cells: Map<number, number[]>;
}

/** 이 파일 범위의 GIS 건물(feature_id ≤ maxId)의 bbox를 격자 색인으로 메모리에 올린다. R*Tree는 단계가 다 끝나야 생기므로 build 중에는 pending 표를 쓴다. */
function loadGisIndex(db: Db, extent: readonly number[], maxId: number): GisIndex {
  const hasPending = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'feature_rtree_pending'").pluck().get() !== undefined;
  const table = hasPending ? "feature_rtree_pending" : "feature_rtree";
  const q = db.prepare(`SELECT p.feature_id, p.min_x, p.max_x, p.min_y, p.max_y, b.height_method = 'unknown', f.name IS NULL, f.stable_id, f.name, b.approval_date
    FROM ${table} p CROSS JOIN feature f ON f.feature_id = p.feature_id CROSS JOIN building_fact b ON b.feature_id = p.feature_id
    WHERE p.feature_id <= ? AND p.max_x >= ? AND p.min_x <= ? AND p.max_y >= ? AND p.min_y <= ?`).raw(true);
  const idx: GisIndex = { ids: [], stableIds: [], names: [], approvalDates: [], bbox: [], need: [], cells: new Map() };
  for (const r of q.iterate(maxId, extent[0] - PAD_M, extent[2] + PAD_M, extent[1] - PAD_M, extent[3] + PAD_M) as Iterable<number[]>) {
    const i = idx.ids.length;
    idx.ids.push(r[0]);
    idx.stableIds.push(r[7] as unknown as string);
    idx.names.push((r[8] as unknown as string | null) ?? null);
    idx.approvalDates.push((r[9] as unknown as string | null) ?? null);
    idx.bbox.push(r[1], r[3], r[2], r[4]); // x0 y0 x1 y1
    idx.need.push((r[5] ? 1 : 0) | (r[6] ? 2 : 0));
    for (let ix = Math.floor(r[1] / CELL_M); ix <= Math.floor(r[2] / CELL_M); ix++) {
      for (let iy = Math.floor(r[3] / CELL_M); iy <= Math.floor(r[4] / CELL_M); iy++) {
        const k = ix * 65536 + iy;
        const cell = idx.cells.get(k);
        if (cell) cell.push(i);
        else idx.cells.set(k, [i]);
      }
    }
  }
  return idx;
}

/** 단계(시도 파일)가 끝나기 전 GIS 건물의 feature_id 상한. 처음 한 번 정해 진행표 메타에 남기므로 재개해도 앞 단계가 넣은 juso 건물과 섞이지 않는다. */
export function gisFeatureIdBound(db: Db): number {
  const key = "juso_gis_max_feature_id";
  const have = db.prepare("SELECT value FROM build_progress_meta WHERE key = ?").pluck().get(key) as string | undefined;
  if (have !== undefined) return Number(have);
  const max = Number(db.prepare("SELECT COALESCE(MAX(feature_id), 0) FROM feature").pluck().get());
  db.prepare("INSERT INTO build_progress_meta (key, value) VALUES (?, ?)").run(key, String(max));
  return max;
}

export interface JusoCounts {
  added: number;
  /** GIS 건물과 겹쳐 새로 넣지 않은 수 */
  deduped: number;
  /** core PNU 승인일·이름 근거로 GIS를 옛 건물로 표시하고 juso를 새로 넣은 수 */
  retired: number;
  attachedHeight: number;
  attachedName: number;
  intersectErrors: number;
  /** 오목·구멍 도형이라 polyclip으로 계산한 겹침 판정 수 */
  polyclipFallbacks: number;
}

interface JusoPerf {
  gridCandidates: number;
  uniqueGridCandidates: number;
  bboxPasses: number;
  areaPrefilterRejects: number;
  exactOverlapCalls: number;
  triangulateCalls: number;
  polyclipFallbacks: number;
  gisGeomCacheHits: number;
  gisGeomCacheMisses: number;
  jsonParseMs: number;
  gisIndexMs: number;
  candidateMs: number;
  exactOverlapMs: number;
  writeMs: number;
  attachMs: number;
  getProvCalls: number;
  getProvMs: number;
  setHeightCalls: number;
  setHeightMs: number;
  setNameCalls: number;
  setNameMs: number;
  setProvCalls: number;
  setProvMs: number;
  totalMs: number;
}

const roundedMs = (value: number): number => Number(value.toFixed(1));

export async function buildJusoBuildings(
  db: Db,
  /** geometry는 EPSG:5179 미터(readShp의 native 모드) */
  records: AsyncIterable<ShpRecord>,
  releaseId: string,
  opts: { extent: readonly number[]; gisMaxFeatureId: number; floorHeightM?: number; core?: Db | null; coreApprovalMaxDate?: string },
): Promise<SourceStats> {
  const floorHeightM = opts.floorHeightM ?? FLOOR_HEIGHT_M;
  const stats = new SourceStats(JUSO_SOURCE_ID, releaseId, ["heightM", "floorsAbove"]);
  const counts: JusoCounts = { added: 0, deduped: 0, retired: 0, attachedHeight: 0, attachedName: 0, intersectErrors: 0, polyclipFallbacks: 0 };
  const totalStarted = JUSO_PERF_ENABLED ? performance.now() : 0;
  const perf: JusoPerf | null = JUSO_PERF_ENABLED ? {
    gridCandidates: 0,
    uniqueGridCandidates: 0,
    bboxPasses: 0,
    areaPrefilterRejects: 0,
    exactOverlapCalls: 0,
    triangulateCalls: 0,
    polyclipFallbacks: 0,
    gisGeomCacheHits: 0,
    gisGeomCacheMisses: 0,
    jsonParseMs: 0,
    gisIndexMs: 0,
    candidateMs: 0,
    exactOverlapMs: 0,
    writeMs: 0,
    attachMs: 0,
    getProvCalls: 0,
    getProvMs: 0,
    setHeightCalls: 0,
    setHeightMs: 0,
    setNameCalls: 0,
    setNameMs: 0,
    setProvCalls: 0,
    setProvMs: 0,
    totalMs: 0,
  } : null;
  const indexStarted = perf ? performance.now() : 0;
  const gis = loadGisIndex(db, opts.extent, opts.gisMaxFeatureId);
  if (perf) perf.gisIndexMs = performance.now() - indexStarted;
  const coreApprovalBySido = new Map<string, Map<string, string>>();
  const geomOf = db.prepare("SELECT geom_json FROM feature WHERE feature_id = ?").pluck();
  const geomCache = new Map<number, { g: Polygon | MultiPolygon; area: number }>();
  const gisGeom = (id: number) => {
    let c = geomCache.get(id);
    if (c) {
      if (perf) perf.gisGeomCacheHits++;
      return c;
    }
    if (perf) perf.gisGeomCacheMisses++;
    if (geomCache.size >= GEOM_CACHE_MAX) geomCache.clear();
    const parseStarted = perf ? performance.now() : 0;
    const g = JSON.parse(geomOf.get(id) as string) as Polygon | MultiPolygon;
    if (perf) perf.jsonParseMs += performance.now() - parseStarted;
    geomCache.set(id, (c = { g, area: planarArea(g) }));
    return c;
  };
  const insertFact = db.prepare(`INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
    VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`);
  const getFeatureProperties = db.prepare("SELECT properties_json FROM feature WHERE feature_id = ?").pluck();
  const setFeatureProperties = db.prepare("UPDATE feature SET properties_json = ? WHERE feature_id = ?");
  const insertReplacementLink = db.prepare(`INSERT INTO feature_link (from_stable_id, to_stable_id, relation_type, method, confidence, release_id)
    VALUES (?, ?, 'replaced_by', 'overlap+core_pnu_approval+name', 1, ?)
    ON CONFLICT(from_stable_id, to_stable_id, relation_type) DO UPDATE SET method = excluded.method, confidence = excluded.confidence, release_id = excluded.release_id`);
  const provHeight = (id: string) => ({ source: "juso:GRO_FLO_CO*floorHeightM", floorHeightM, jusoBuildingMgtSn: id });
  /** GIS 건물 feature_id → 가장 믿을 만한(층수가 있고 겹침이 큰) 도로명주소 건물 */
  const attach = new Map<number, { score: number; floors: number | null; heightM: number | null; name: string | null; id: string }>();

  const coreApprovalFor = (pnu: string | null, legalCode: string | null): string | null => {
    if (!pnu || !legalCode) return null;
    const sido = legalCode.slice(0, 2);
    let map = coreApprovalBySido.get(sido);
    if (!map) {
      map = coreApprovalByPnu(opts.core, sido, opts.coreApprovalMaxDate);
      coreApprovalBySido.set(sido, map);
    }
    return map.get(pnu) ?? null;
  };

  const markRetired = (featureId: number, stableId: string, replacementId: string): boolean => {
    let properties: Record<string, unknown>;
    try {
      properties = JSON.parse((getFeatureProperties.get(featureId) as string | undefined) ?? "{}") as Record<string, unknown>;
    } catch {
      properties = {};
    }
    if (properties.retired === true && properties.replacedBy === replacementId) {
      insertReplacementLink.run(stableId, replacementId, releaseId);
      return false;
    }
    if (properties.retired === true && typeof properties.replacedBy === "string" && properties.replacedBy !== replacementId) return false;
    setFeatureProperties.run(JSON.stringify({
      ...properties,
      retired: true,
      retiredReason: "juso-newer-core-approval",
      replacedBy: replacementId,
    }), featureId);
    insertReplacementLink.run(stableId, replacementId, releaseId);
    return true;
  };

  await batched(db, records, (r) => {
    stats.read();
    const p = r.properties;
    const id = str(p.BD_MGT_SN);
    const g = r.geometry;
    if (!id || !isAreal(g)) return stats.reject();
    const area = planarArea(g);
    if (!(area > 0)) return stats.reject();
    const h = heightOf({ A26: p.GRO_FLO_CO }, floorHeightM);
    const nm = str(p.BULD_NM);
    const name = composeBuildingName(nm, str(p.BULD_NM_DC));
    const legal = `${str(p.SIG_CD) ?? ""}${str(p.EMD_CD) ?? ""}${str(p.LI_CD) ?? ""}`;
    const legalCode = /^\d{10}$/.test(legal) ? legal : null;
    const pnu = legalCode ? makePnu(legalCode, str(p.MNTN_YN) === "1", p.LNBR_MNNM as number, p.LNBR_SLNO as number) : null;
    const coreApprovalDate = coreApprovalFor(pnu, legalCode);

    // 겹치는 GIS 건물 찾기: 격자 → bbox → (겹친 bbox 면적이 작은 쪽 면적의 50% 미만이면 탈락) → 정확한 교차 면적
    const candidateStarted = perf ? performance.now() : 0;
    const [x0, y0, x1, y1] = bboxOf(g);
    const seen = new Set<number>();
    let best: { i: number; inter: number } | null = null;
    for (let ix = Math.floor(x0 / CELL_M); ix <= Math.floor(x1 / CELL_M); ix++) {
      for (let iy = Math.floor(y0 / CELL_M); iy <= Math.floor(y1 / CELL_M); iy++) {
        for (const i of gis.cells.get(ix * 65536 + iy) ?? []) {
          if (perf) perf.gridCandidates++;
          if (seen.has(i)) continue;
          seen.add(i);
          if (perf) perf.uniqueGridCandidates++;
          const b = gis.bbox;
          const w = Math.min(x1, b[4 * i + 2]) - Math.max(x0, b[4 * i]);
          const hh = Math.min(y1, b[4 * i + 3]) - Math.max(y0, b[4 * i + 1]);
          if (w <= 0 || hh <= 0) continue;
          if (perf) perf.bboxPasses++;
          const c = gisGeom(gis.ids[i]);
          if (w * hh < OVERLAP_MIN * Math.min(area, c.area)) {
            if (perf) perf.areaPrefilterRejects++;
            continue;
          }
          if (perf) perf.exactOverlapCalls++;
          const overlapStarted = perf ? performance.now() : 0;
          const inter = overlapArea(g, c.g, () => counts.intersectErrors++, () => {
            counts.polyclipFallbacks++;
            if (perf) perf.polyclipFallbacks++;
          }, () => {
            if (perf) perf.triangulateCalls++;
          });
          if (perf) perf.exactOverlapMs += performance.now() - overlapStarted;
          if (inter >= OVERLAP_MIN * Math.min(area, c.area) && (!best || inter > best.inter)) best = { i, inter };
        }
      }
    }
    if (perf) perf.candidateMs += performance.now() - candidateStarted;
    const oldApprovalDate = best ? gis.approvalDates[best.i] : null;
    const oldName = best ? normalizeBuildingName(gis.names[best.i]) : null;
    const currentName = normalizeBuildingName(name);
    const oldYear = oldApprovalDate ? Number(oldApprovalDate.slice(0, 4)) : NaN;
    const isReplacement = Boolean(
      best && oldName && currentName && oldName !== currentName
      && Number.isInteger(oldYear) && oldYear <= RETIRED_GIS_MAX_APPROVAL_YEAR
      && coreApprovalDate && oldApprovalDate && coreApprovalDate > oldApprovalDate,
    );
    const replacement = isReplacement && best ? {
      featureId: gis.ids[best.i],
      stableId: gis.stableIds[best.i],
      replacementId: `juso:${id}`,
    } : null;

    if (best && !replacement) {
      counts.deduped++;
      const need = gis.need[best.i];
      if (need !== 0) {
        const gisId = gis.ids[best.i];
        const score = (h.heightM !== null ? 1e9 : 0) + best.inter;
        const cur = attach.get(gisId);
        if (!cur || score > cur.score) attach.set(gisId, { score, floors: h.floorsAbove, heightM: h.heightM, name, id });
      }
      return stats.reject();
    }

    let featureId: number;
    const writeStarted = perf ? performance.now() : 0;
    try {
      featureId = insertFeature(db, {
        stableId: `juso:${id}`, kind: "building", sourceKey: id, releaseId, geometry: g, geometryIsUtmk: true, name, pnu, legalCode, roundM: 10 ** -COORD_DECIMALS,
        properties: { source: "juso", bdtypCd: str(p.BDTYP_CD), nameDetail: str(p.BULD_NM_DC), floorsAbove: h.floorsAbove },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        if (perf) perf.writeMs += performance.now() - writeStarted;
        return stats.reject();
      }
      throw e;
    }
    const und = typeof p.UND_FLO_CO === "number" && Number.isInteger(p.UND_FLO_CO) && p.UND_FLO_CO >= 0 ? p.UND_FLO_CO : null;
    const prov = h.method === "floors_estimate" ? { origin: "juso-supplement", height_m: provHeight(id), floors_above: "juso:GRO_FLO_CO", footprint_area_m2: "polygon" } : { origin: "juso-supplement", footprint_area_m2: "polygon" };
    insertFact.run(featureId, h.heightM, h.method, h.floorsAbove, und, Math.round(area * 100) / 100, JSON.stringify(prov));
    if (replacement && markRetired(replacement.featureId, replacement.stableId, replacement.replacementId)) counts.retired++;
    counts.added++;
    stats.accept({ heightM: h.heightM, floorsAbove: h.floorsAbove }, str(p.SIG_CD)?.slice(0, 2) ?? "(미상)", h.method);
    if (perf) perf.writeMs += performance.now() - writeStarted;
  });

  // 겹친 GIS 건물에 보탤 속성: 파일을 다 읽은 뒤 건물마다 한 번만 쓴다
  const attachStarted = perf ? performance.now() : 0;
  const getProv = db.prepare("SELECT field_provenance_json FROM building_fact WHERE feature_id = ?").pluck();
  const setHeight = db.prepare("UPDATE building_fact SET height_m = ?, height_method = 'floors_estimate', floors_above = ?, field_provenance_json = ? WHERE feature_id = ? AND height_method = 'unknown'");
  const setProv = db.prepare("UPDATE building_fact SET field_provenance_json = ? WHERE feature_id = ?");
  const setName = db.prepare("UPDATE feature SET name = ? WHERE feature_id = ? AND name IS NULL");
  for (const [featureId, a] of attach) {
    const getProvStarted = perf ? performance.now() : 0;
    const provValue = getProv.get(featureId);
    if (perf) {
      perf.getProvCalls++;
      perf.getProvMs += performance.now() - getProvStarted;
    }
    const prov = JSON.parse(provValue as string) as Record<string, unknown>;
    let changed = false;
    if (a.heightM !== null) {
      const setHeightStarted = perf ? performance.now() : 0;
      if (perf) perf.setHeightCalls++;
      const result = setHeight.run(a.heightM, a.floors, JSON.stringify({ ...prov, height_m: provHeight(a.id), floors_above: "juso:GRO_FLO_CO" }), featureId);
      if (perf) perf.setHeightMs += performance.now() - setHeightStarted;
      if (result.changes > 0) {
        counts.attachedHeight++;
        prov.height_m = provHeight(a.id);
        prov.floors_above = "juso:GRO_FLO_CO";
        changed = true;
      }
    }
    if (a.name !== null) {
      const setNameStarted = perf ? performance.now() : 0;
      if (perf) perf.setNameCalls++;
      const result = setName.run(a.name, featureId);
      if (perf) perf.setNameMs += performance.now() - setNameStarted;
      if (result.changes > 0) {
        counts.attachedName++;
        prov.name = { source: "juso:BULD_NM", jusoBuildingMgtSn: a.id };
        changed = true;
      }
    }
    if (changed) {
      const setProvStarted = perf ? performance.now() : 0;
      if (perf) perf.setProvCalls++;
      setProv.run(JSON.stringify(prov), featureId);
      if (perf) perf.setProvMs += performance.now() - setProvStarted;
    }
  }
  if (perf) perf.attachMs = performance.now() - attachStarted;

  // 단계별 집계를 릴리스에 누적한다(재개해도 단계는 한 번만 실행되므로 중복 합산이 없다)
  const rel = db.prepare("SELECT coverage_json FROM source_release WHERE release_id = ?").pluck().get(releaseId) as string | undefined;
  const sum = { ...(rel ? (JSON.parse(rel) as Partial<JusoCounts>) : {}) } as Record<string, number>;
  for (const [k, v] of Object.entries(counts)) sum[k] = (sum[k] ?? 0) + v;
  db.prepare("UPDATE source_release SET coverage_json = ? WHERE release_id = ?").run(JSON.stringify(sum), releaseId);
  if (perf) {
    perf.totalMs = performance.now() - totalStarted;
    console.log(`[juso-perf] ${JSON.stringify({
      source: JUSO_SOURCE_ID,
      release: releaseId,
      rows: stats.received,
      accepted: stats.accepted,
      rejected: stats.rejected,
      added: counts.added,
      deduped: counts.deduped,
      retired: counts.retired,
      gridCandidates: perf.gridCandidates,
      uniqueGridCandidates: perf.uniqueGridCandidates,
      bboxPasses: perf.bboxPasses,
      areaPrefilterRejects: perf.areaPrefilterRejects,
      exactOverlapCalls: perf.exactOverlapCalls,
      triangulateCalls: perf.triangulateCalls,
      polyclipFallbacks: perf.polyclipFallbacks,
      gisGeomCacheHits: perf.gisGeomCacheHits,
      gisGeomCacheMisses: perf.gisGeomCacheMisses,
      jsonParseMs: roundedMs(perf.jsonParseMs),
      stageMs: {
        gisIndex: roundedMs(perf.gisIndexMs),
        candidate: roundedMs(perf.candidateMs),
        exactOverlap: roundedMs(perf.exactOverlapMs),
        write: roundedMs(perf.writeMs),
        attach: roundedMs(perf.attachMs),
        total: roundedMs(perf.totalMs),
      },
      attachOps: {
        getProv: { calls: perf.getProvCalls, ms: roundedMs(perf.getProvMs) },
        setHeight: { calls: perf.setHeightCalls, ms: roundedMs(perf.setHeightMs) },
        setName: { calls: perf.setNameCalls, ms: roundedMs(perf.setNameMs) },
        setProv: { calls: perf.setProvCalls, ms: roundedMs(perf.setProvMs) },
      },
    })}`);
  }
  return stats;
}
