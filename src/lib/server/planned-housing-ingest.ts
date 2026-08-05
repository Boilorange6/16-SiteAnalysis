/**
 * 청약홈 분양 공고 전국 적재.
 *
 * 분석 요청마다 광역 단위로 6년치를 훑고 단지마다 지오코딩하던 것을
 * 하루 한 번 배치로 옮긴다. 읽기는 bbox 쿼리 한 번이 된다.
 *
 * 네트워크는 fetchComplexes / geocode 주입 지점으로 분리했다.
 * 적재 로직은 네트워크 없이 테스트한다 — src/scripts/test-planned-housing-ingest.mjs
 */
import type BetterSqlite3 from "better-sqlite3";
import {
  PLANNED_HOUSING_SPEC,
  appendStaging,
  beginStaging,
  commitStaging,
  type IngestResult,
} from "./dataset-store";

type Db = BetterSqlite3.Database;

/** 청약홈 SUBSCRPT_AREA_CODE_NM 전체 값 */
export const APPLYHOME_AREA_NAMES = [
  "서울", "인천", "경기", "부산", "대구", "광주", "대전", "울산", "세종",
  "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

export interface IngestComplex {
  houseManageNo: string;
  pblancNo: string;
  name: string;
  address: string;
  units: number;
  saleDate: string;
  moveInMonth: string;
  homepageUrl: string;
  noticeUrl: string;
  kind: string;
}

export function plannedHousingId(complex: IngestComplex): string {
  return `${complex.houseManageNo}:${complex.pblancNo}`;
}

export function complexToDatasetRow(
  complex: IngestComplex,
  areaName: string,
  coord: { lat: number; lng: number } | null,
): Record<string, unknown> {
  return {
    id: plannedHousingId(complex),
    name: complex.name,
    address: complex.address,
    area_name: areaName,
    kind: complex.kind,
    units: complex.units,
    sale_date: complex.saleDate,
    move_in_month: complex.moveInMonth,
    homepage_url: complex.homepageUrl,
    notice_url: complex.noticeUrl,
    lat: coord ? coord.lat : null,
    lng: coord ? coord.lng : null,
  };
}

export interface IngestPlannedHousingDeps {
  db: Db;
  now: number;
  areaNames: readonly string[];
  fetchComplexes: (areaName: string) => Promise<IngestComplex[]>;
  geocode: (address: string) => Promise<{ lat: number; lng: number } | null>;
  log?: (message: string) => void;
}

export async function ingestPlannedHousing(deps: IngestPlannedHousingDeps): Promise<IngestResult> {
  const { db, now, areaNames, fetchComplexes, geocode } = deps;
  const log = deps.log ?? (() => {});

  beginStaging(db, PLANNED_HOUSING_SPEC);

  const seen = new Set<string>();
  let geocodedCount = 0;
  let missingCoord = 0;

  for (const areaName of areaNames) {
    const complexes = await fetchComplexes(areaName);
    log(`[planned-housing] ${areaName}: ${complexes.length}건`);

    const rows: Array<Record<string, unknown>> = [];
    for (const complex of complexes) {
      const id = plannedHousingId(complex);
      // 인접 시도에 같은 공고가 걸릴 수 있다.
      if (seen.has(id)) continue;
      seen.add(id);

      const coord = await geocode(complex.address);
      if (coord) geocodedCount += 1;
      else missingCoord += 1;
      rows.push(complexToDatasetRow(complex, areaName, coord));
    }
    appendStaging(db, PLANNED_HOUSING_SPEC, rows);
  }

  log(`[planned-housing] 좌표 확보 ${geocodedCount}건 / 실패 ${missingCoord}건`);
  const result = commitStaging(db, PLANNED_HOUSING_SPEC, now);
  if (result.status === "rejected") {
    log(`[planned-housing] ${result.message}`);
  } else {
    log(`[planned-housing] 적재 완료: ${result.previousCount} → ${result.rowCount}건`);
  }
  return result;
}
