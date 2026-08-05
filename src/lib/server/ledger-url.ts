/**
 * 건축물대장(총괄표제부) 요청 URL 빌더.
 *
 * 공공데이터포털이 `_type` 없는 요청의 기본 응답을 XML에서 JSON으로 바꾼 적이 있다.
 * 앱은 정규식 XML 파서를 쓰므로 그때 전국의 주거 POI가 통째로 0건이 됐고,
 * HTTP는 200이라 경고조차 뜨지 않았다. 포맷은 항상 명시한다.
 */

export const LEDGER_RECAP_URL =
  "https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo";

export const LEDGER_PAGE_SIZE = 100;

export interface LedgerUrlParams {
  sigunguCd: string;
  bjdongCd: string;
  pageNo: number;
  /** 이미 URL 인코딩된 서비스 키 (재인코딩하지 않는다) */
  encodedApiKey: string;
}

export function buildLedgerUrl({ sigunguCd, bjdongCd, pageNo, encodedApiKey }: LedgerUrlParams): string {
  return (
    `${LEDGER_RECAP_URL}?serviceKey=${encodedApiKey}` +
    `&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}` +
    `&numOfRows=${LEDGER_PAGE_SIZE}&pageNo=${pageNo}&_type=xml`
  );
}
