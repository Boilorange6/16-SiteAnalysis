/**
 * VWorld 개별공시지가정보(dsId 6, 시도별 CSV, EUC-KR) → land_price (reference).
 * 열: 고유번호(PNU 19) · 법정동코드 · 법정동명 · 특수지구분코드/명 · 지번 · 기준연도 · 기준월 · 공시지가(원/㎡) · 공시일자 · 표준지여부(Y/N) · 데이터기준일자 · 원천시도시군구코드.
 * 시도 파일마다 최신 기준연도 한 해분만 들어 있어 필지당 한 행이다. 같은 PNU가 또 오면 먼저 온 행을 두고 rejected로 센다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { remapLegalCode, RENUMBERED_SIDO } from "../../data/code-remap";
import { batched, SourceStats } from "../build";

/** rights_json에 기록하는 이용 근거 (A0 검증표 행 6·후속 4) */
export const LAND_PRICE_RIGHTS = {
  basis: "data.go.kr 15052266 개별공시지가 '이용허락범위 제한 없음'",
  decision: "VWorld dsId=6 '개별공시지가정보' 시도별 CSV(속성)만 내부 업무용으로 적재. SHP(공간)는 받지 않는다",
  vworldPageLicense: "VWorld dsId=6 페이지는 '라이센스가 지정되어 있지 않습니다'",
} as const;

export interface LandPriceRecord {
  properties: Record<string, string>;
}

/** 압축을 푼 경로들에서 시도(파일명 코드)마다 가장 새 CSV를 고른다. 파일명은 AL_D151_36_YYYYMMDD.csv. */
export function latestLandPricePerSido(paths: readonly string[]): Map<string, { date: string; file: string }> {
  const out = new Map<string, { date: string; file: string }>();
  for (const p of paths) {
    const m = p.replace(/\\/g, "/").match(/AL_D151_(\d{2})_(\d{8})\.csv$/i);
    if (!m) continue;
    const cur = out.get(m[1]);
    if (!cur || m[2] > cur.date) out.set(m[1], { date: m[2], file: p });
  }
  return out;
}

const int = (v: unknown): number | null => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

/**
 * core를 주면 옛 행정구역 코드(광주·전남 29·46, 인천 중·동·서구 등)를 현재 코드로 옮겨 저장한다 — 옮길 수 없는 행은 unlocated(저장 안 함).
 * 원래 PNU는 남기지 않는다: 약 3,900만 행에 열을 더하는 값이 크고, 원천 CSV(법정동명 포함)에서 언제든 다시 만들 수 있다.
 * expectedRegions는 원천 파일의 시도 코드이며 저장되는 시도(12 등)로 바꿔 기록한다.
 */
export async function buildLandPrice(db: BetterSqlite3.Database, records: AsyncIterable<LandPriceRecord>, releaseId: string, expectedRegions: readonly string[] = [], core: BetterSqlite3.Database | null = null): Promise<SourceStats> {
  const stats = new SourceStats("land_price", releaseId, ["baseMonth"]);
  stats.expectedRegions = [...new Set(expectedRegions.map((r) => (core ? RENUMBERED_SIDO[r] ?? r : r)))];
  const insert = db.prepare("INSERT OR IGNORE INTO land_price (pnu, base_year, base_month, price_krw_per_m2, is_standard) VALUES (?, ?, ?, ?, ?)");
  const remapped = new Map<string, string | null>(); // 원천 법정동 10자리 → 현재 코드 (법정동마다 한 번만 푼다)
  await batched(db, records, (r) => {
    stats.read();
    const p = r.properties;
    let pnu = p["고유번호"]?.trim();
    const year = int(p["기준연도"]);
    const price = int(p["공시지가"]);
    if (!pnu || !/^\d{19}$/.test(pnu) || year === null || year < 1990 || year > 2100 || price === null || price <= 0) return stats.reject();
    if (core) {
      const old = pnu.slice(0, 10);
      if (!remapped.has(old)) remapped.set(old, remapLegalCode(core, old, p["법정동명"]?.trim() || null).code);
      const now = remapped.get(old);
      if (!now) return stats.unlocate();
      pnu = now + pnu.slice(10);
    }
    const month = int(p["기준월"]);
    if (insert.run(pnu, year, month, price, p["표준지여부"]?.trim() === "Y" ? 1 : 0).changes === 0) return stats.reject(); // 중복 PNU
    stats.accept({ baseMonth: month }, pnu.slice(0, 2), String(year));
  }, 20000);
  return stats;
}
