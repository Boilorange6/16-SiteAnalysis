/**
 * 건축물대장 표제부에서 오피스텔을 골라낸다.
 *
 * 앱은 오랫동안 총괄표제부(getBrRecapTitleInfo)만 봤고, 거기서 주용도가
 * "공동주택"이 아닌 행을 전부 버렸다. 그래서 오피스텔이 통째로 빠졌다.
 *
 * 총괄표제부의 "업무시설"은 한국과학기술회관·신한은행 같은 순수 업무빌딩이고
 * 세대·호수가 모두 0이다. 오피스텔은 표제부(getBrTitleInfo)에만 있으며
 * 주용도는 "업무시설", 실제 구분은 세부용도(etcPurps)의 "오피스텔"이다.
 *
 * 규모도 다르게 센다 — 공동주택은 세대수(hhldCnt), 오피스텔은 호수(hoCnt).
 * 실제 응답에서 오피스텔의 hhldCnt는 대개 0이다.
 */

export interface LedgerTitleRow {
  readonly [field: string]: string | undefined;
}

export interface OfficetelRecord {
  readonly name: string;
  readonly units: number;
  readonly parking: number;
  readonly maxFloor: number;
  readonly useAprDay: string;
  readonly platPlc: string;
  readonly bun: string;
  readonly ji: string;
}

function text(row: LedgerTitleRow, field: string): string {
  return (row[field] ?? "").trim();
}

function count(row: LedgerTitleRow, field: string): number {
  const value = parseInt(text(row, field).replaceAll(",", ""), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function readOfficetelFromTitleRow(row: LedgerTitleRow): OfficetelRecord | null {
  // 공동주택은 총괄표제부가 이미 단지 단위로 담당한다 — 여기서 또 넣으면 중복된다
  if (text(row, "mainPurpsCdNm") === "공동주택") return null;

  // 세부용도가 유일하게 믿을 만한 구분자다. 주용도만 보면 순수 업무빌딩이 섞인다.
  if (!text(row, "etcPurps").includes("오피스텔")) return null;

  const name = text(row, "bldNm");
  if (!name) return null;

  // 오피스텔은 호수, 없으면 세대수. 둘 다 없으면 규모를 모르는 것이라 버린다 —
  // 세대 0인 주거 POI는 지도·점수 어디에도 쓸모가 없다.
  const units = count(row, "hoCnt") || count(row, "hhldCnt");
  if (units === 0) return null;

  return {
    name,
    units,
    parking: count(row, "totPkngCnt"),
    maxFloor: count(row, "grndFlrCnt"),
    useAprDay: text(row, "useAprDay"),
    platPlc: text(row, "platPlc").replace(/번지$/, "").trim(),
    bun: text(row, "bun"),
    ji: text(row, "ji"),
  };
}
