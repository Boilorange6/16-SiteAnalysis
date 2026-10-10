/**
 * SGIS 1 km 격자 통계(인구·가구·주택·사업체) → pop_grid feature (셀 중심점 1개 = 격자 1개).
 *
 * 격자 코드는 국가지점번호 "가다7867": [동서 100 km 블록][남북 100 km 블록][동서 km 2자리][남북 km 2자리].
 * 좌표계 EPSG:5179(UTM-K), 셀 남서 모서리(미터):
 *   E = 700000 + 100000 * index("가나다라마바사아", 첫 글자) + 1000 * 앞 2자리
 *   N = 1300000 + 100000 * index("가나다라마바사아", 둘째 글자) + 1000 * 뒤 2자리
 * 원천 격자 경계 SHP(EPSG:5179) 107,680셀 전부와 대조해 불일치 0건, 통계 셀 77,730개 모두 SHP에 있음. 그래서 경계 SHP는 적재하지 않는다.
 *
 * 값은 { v, s }다: 원천 행이 있으면 observed, 없으면(=비밀보호 N/A) suppressed이고 v는 null — 0으로 바꾸지 않는다.
 * 원천 행의 0은 실제 값이 아니라 소수 셀에 대한 확률 대체(0 또는 5)·노이즈(±7) 결과일 수 있어 observed 0으로 그대로 둔다.
 * 총괄 항목(총인구·총가구·총주택·사업체)은 행이 없으면 suppressed다(인구 행이 없는 2,660셀은 전부 사업체만 있는 셀 — 무거주와 N/A를 구분할 수 없다).
 * 연령 구간(5세, 21개)은 다르다: 총인구가 있는 셀에서 없는 구간은 대개 95세 이상 같은 빈 구간이고, 총인구 1,000명 이상 셀 5,581개에서
 * 구간 합이 총인구의 100.1%로 맞는다(없는 행 = 0으로 저장되지 않은 값). 그래서 ageBands에는 null로 두고, 묶음(ageGroups)은
 * 있는 구간의 합으로 만들며 없는 구간 수를 unlisted로 남긴다. 총인구가 없는 셀의 묶음은 suppressed다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { decodeText } from "../../a0/measure";
import { toLngLat } from "../../crs";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;

export const SGIS_LETTERS = "가나다라마바사아";
export const SGIS_CELL_M = 1000;
const GRID_ID = new RegExp(`^([${SGIS_LETTERS}])([${SGIS_LETTERS}])(\\d{2})(\\d{2})$`);
export const UNKNOWN_REGION = "(미상)";

/** 격자 코드 → UTM-K 남서 모서리(m). 형식이 다르면 null. */
export function gridSouthWest(gridId: string): [number, number] | null {
  const m = GRID_ID.exec(gridId);
  if (!m) return null;
  return [700_000 + 100_000 * SGIS_LETTERS.indexOf(m[1]) + 1000 * Number(m[3]), 1_300_000 + 100_000 * SGIS_LETTERS.indexOf(m[2]) + 1000 * Number(m[4])];
}

export interface SgisRow {
  gridId: string;
  item: string;
  value: number;
}

/** 적재하는 통계항목. 나머지(성·연령별, 중분류 등)는 A11에 쓰이지 않아 읽고 버린다. */
export const AGE_ITEMS = Array.from({ length: 21 }, (_, i) => `in_age_${String(i + 1).padStart(3, "0")}`);
const WANTED = new Set([
  "to_in_001", "to_in_007", "to_in_008", ...AGE_ITEMS, // 총인구·남·여, 5세 구간
  "to_ga_001", "ga_sd_005", // 총가구, 1인가구
  "to_ho_001", "ho_gb_003", "ho_gb_002", // 총주택, 아파트, 단독주택
  "to_fa_010", "to_em_020", // 총사업체, 총종사자
]);

const FILE = /^(\d{4})년_(인구|가구|주택|사업체|종사자)_.+_1K\.csv$/;
const ROW = /^(\d+),"([^"]*)","([^"]*)",\s*(.*?)\s*$/;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** 통계 폴더의 CSV(UTF-8 또는 CP949)를 파일 단위로 읽어 필요한 항목 행만 낸다. 값이 숫자가 아니면 행을 버린다(=비공개 취급). */
export function* sgisRows(dir: string): Generator<SgisRow> {
  for (const file of [...walk(dir)].sort()) {
    const name = file.split(/[\\/]/).pop()!;
    if (!FILE.test(name)) continue;
    for (const line of decodeText(readFileSync(file)).text.split(/\r?\n/)) {
      const m = ROW.exec(line);
      if (!m || !WANTED.has(m[3])) continue;
      const value = Number(m[4]);
      if (m[4] !== "" && Number.isFinite(value)) yield { gridId: m[2], item: m[3], value };
    }
  }
}

/** 데이터 연도(기준연도 열은 읽지 않으므로 파일 이름에서) */
export function sgisDataYear(dir: string): string | null {
  for (const file of walk(dir)) {
    const m = FILE.exec(file.split(/[\\/]/).pop()!);
    if (m) return m[1];
  }
  return null;
}

// ── 시도 판정: core의 legal_sigungu 경계(EPSG:5179)에 대한 점 포함 검사 ──
type Ring = number[][];
interface Area {
  code: string;
  polys: Ring[][];
  bbox: [number, number, number, number];
}
export type LocateSigungu = (x: number, y: number) => string | null;

const inRing = (x: number, y: number, ring: Ring): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** core가 없으면 항상 null. 셀 중심이 바다·경계 밖이면 네 귀퉁이(±400 m)도 본다. */
export function locateSigunguFromCore(core: Db | null): LocateSigungu {
  if (!core) return () => null;
  const areas: Area[] = [];
  for (const r of core.prepare("SELECT legal_code, geom_json FROM feature WHERE kind = 'legal_sigungu' AND legal_code IS NOT NULL").iterate() as Iterable<{ legal_code: string; geom_json: string }>) {
    const g = JSON.parse(r.geom_json) as Geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (polys.length > 0) areas.push({ code: r.legal_code, polys, bbox: [x0, y0, x1, y1] });
  }
  const at = (x: number, y: number): string | null => {
    for (const a of areas) {
      if (x < a.bbox[0] || x > a.bbox[2] || y < a.bbox[1] || y > a.bbox[3]) continue;
      for (const p of a.polys) if (inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))) return a.code;
    }
    return null;
  };
  return (x, y) => at(x, y) ?? at(x - 400, y - 400) ?? at(x + 400, y - 400) ?? at(x - 400, y + 400) ?? at(x + 400, y + 400);
}

// ── 값 모델 ──
export type GridValue = { v: number | null; s: "observed" | "suppressed" };
const val = (n: number | undefined): GridValue => (n === undefined ? { v: null, s: "suppressed" } : { v: n, s: "observed" });
/** 있는 구간의 합. 총인구가 없는 셀이면 suppressed. 없는 구간 수는 unlisted에 남긴다. */
function groupSum(cell: Record<string, number>, items: string[]): GridValue & { unlisted?: number } {
  if (cell.to_in_001 === undefined) return { v: null, s: "suppressed" };
  const listed = items.filter((i) => cell[i] !== undefined);
  return { v: listed.reduce((s, i) => s + cell[i], 0), s: "observed", unlisted: items.length - listed.length };
}

export const AGE_GROUPS = {
  under15: AGE_ITEMS.slice(0, 3),
  age15to64: AGE_ITEMS.slice(3, 13),
  age65plus: AGE_ITEMS.slice(13),
} as const;

export function cellProperties(gridId: string, cell: Record<string, number>, dataYear: string | null): Record<string, unknown> {
  return {
    gridId,
    cellSizeM: SGIS_CELL_M,
    dataYear,
    population: { total: val(cell.to_in_001), male: val(cell.to_in_007), female: val(cell.to_in_008) },
    /** 5세 구간 21개(0-4 … 100+), 합계 성별. null = 비공개 */
    ageBands: AGE_ITEMS.map((i) => cell[i] ?? null),
    ageGroups: { under15: groupSum(cell, [...AGE_GROUPS.under15]), age15to64: groupSum(cell, [...AGE_GROUPS.age15to64]), age65plus: groupSum(cell, [...AGE_GROUPS.age65plus]) },
    households: { total: val(cell.to_ga_001), single: val(cell.ga_sd_005) },
    housing: { total: val(cell.to_ho_001), apartment: val(cell.ho_gb_003), detached: val(cell.ho_gb_002) },
    business: { establishments: val(cell.to_fa_010), employees: val(cell.to_em_020) },
  };
}

export interface PopGridInput {
  rows: Iterable<SgisRow>;
  releaseId: string;
  dataYear: string | null;
  locate: LocateSigungu;
}

/** 격자 한 칸 = 읽은 단위 1개. 형식이 다른 코드는 rejected. 시도 판정 실패는 "(미상)"으로 두고 적재한다. */
export async function buildPopGrid(db: Db, input: PopGridInput): Promise<SourceStats> {
  const stats = new SourceStats("sgis_grid", input.releaseId, ["population", "households"]);
  const cells = new Map<string, Record<string, number>>();
  const bad = new Set<string>();
  for (const r of input.rows) {
    if (!gridSouthWest(r.gridId)) {
      bad.add(r.gridId);
      continue;
    }
    let c = cells.get(r.gridId);
    if (!c) cells.set(r.gridId, (c = {}));
    c[r.item] = r.value;
  }
  bad.forEach(() => {
    stats.read();
    stats.reject();
  });
  await batched(db, [...cells].sort(([a], [b]) => (a < b ? -1 : 1)), ([gridId, cell]) => {
    stats.read();
    const [x0, y0] = gridSouthWest(gridId)!;
    const cx = x0 + SGIS_CELL_M / 2;
    const cy = y0 + SGIS_CELL_M / 2;
    const [lng, lat] = toLngLat([cx, cy]);
    const sigungu = input.locate(cx, cy);
    const props = cellProperties(gridId, cell, input.dataYear);
    insertFeature(db, { stableId: `pop_grid:${gridId}`, kind: "pop_grid", sourceKey: gridId, releaseId: input.releaseId, geometry: { type: "Point", coordinates: [lng, lat] }, legalCode: sigungu, properties: props });
    stats.accept({ population: cell.to_in_001 ?? null, households: cell.to_ga_001 ?? null }, sigungu ? sigungu.slice(0, 2) : UNKNOWN_REGION, "cell");
  });
  return stats;
}
