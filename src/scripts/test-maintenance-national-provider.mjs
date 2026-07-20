import assert from "node:assert/strict";
import ky from "ky";
import {
  fetchNationalMaintenanceAttributes,
  normalizeIntegratedRow,
  normalizeStandardRow,
} from "../lib/server/maintenance/national-provider.ts";

assert.deepEqual(
  normalizeIntegratedRow({
    시도: "대전광역시",
    시군구: "동구",
    구역명: "성남1구역",
    추진단계: "조합설립인가",
    정비사업유형: "재개발",
    시행자: "성남1구역 조합",
    예정세대수: "1,234",
    데이터기준일자: "2026-01-01",
  }),
  {
    source_record_id: "대전광역시|동구|성남1구역",
    source: "molit_integrated",
    sido: "대전광역시",
    sigungu: "동구",
    name: "성남1구역",
    type: "재개발",
    stage: "조합설립",
    implementer: "성남1구역 조합",
    planned_households: 1234,
    source_updated_at: "2026-01-01",
  },
);

assert.deepEqual(
  normalizeStandardRow({
    시도명: "서울특별시",
    시군구명: "종로구",
    정비구역명: "테스트",
    정비구역면적: "10,000",
    건폐율: "60.5",
    용적률: "250",
    정비구역지정일자: "20260203",
    데이터기준일자: "2026.02.04",
  }),
  {
    source_record_id: "서울특별시|종로구|테스트",
    source: "public_standard",
    sido: "서울특별시",
    sigungu: "종로구",
    name: "테스트",
    type: "미확인",
    stage: "미확인",
    area_sqm: 10000,
    building_coverage_ratio: 60.5,
    floor_area_ratio: 250,
    designation_date: "2026-02-03",
    source_updated_at: "2026-02-04",
  },
);

const officialIntegratedRow = normalizeIntegratedRow({
  시도: "인천광역시",
  시군구: "미추홀구",
  구역명칭: "주안4구역",
  "현 사업추진단계": "사업시행인가",
  사업유형: "주택 재개발",
  사업시행자: "주안4구역 주택재개발정비사업조합",
  "공급 예정 세대수": "2,345",
  데이터기준일자: "2026-03-05",
});
assert.deepEqual(officialIntegratedRow, {
  source_record_id: "인천광역시|미추홀구|주안4구역",
  source: "molit_integrated",
  sido: "인천광역시",
  sigungu: "미추홀구",
  name: "주안4구역",
  type: "재개발",
  stage: "사업시행인가",
  implementer: "주안4구역 주택재개발정비사업조합",
  planned_households: 2345,
  source_updated_at: "2026-03-05",
});

const officialStandardRow = normalizeStandardRow({
  ZONE_NM: "사직2구역",
  CTPV_NM: "부산광역시",
  SGG_NM: "동래구",
  USG_RGN: "제3종일반주거지역",
  BDCVRT: "59.8",
  GFA: "279.5",
  PRGRS_STP_CN: "관리처분계획인가",
  HH_CNT: "1,560",
  DSGN_YMD: "20240131",
  MNG_INST_NM: "부산광역시 동래구",
  DATA_CRTR_YMD: "2026-03-06",
});
assert.deepEqual(officialStandardRow, {
  source_record_id: "부산광역시|동래구|사직2구역",
  source: "public_standard",
  sido: "부산광역시",
  sigungu: "동래구",
  name: "사직2구역",
  type: "미확인",
  stage: "관리처분",
  planned_households: 1560,
  area_sqm: 279.5,
  land_use_zone: "제3종일반주거지역",
  building_coverage_ratio: 59.8,
  designation_date: "2024-01-31",
  management_agency: "부산광역시 동래구",
  source_updated_at: "2026-03-06",
});
assert.equal(officialStandardRow?.floor_area_ratio, undefined);

assert.equal(normalizeIntegratedRow({ 시도: "서울특별시", 구역명: "누락" }), null);
assert.equal(normalizeStandardRow({ 시군구명: "종로구", 정비구역명: "누락" }), null);

const requested = [];
const httpClient = ky.create({
  retry: 0,
  timeout: 1_000,
  fetch: async (request) => {
    const parsed = new URL(request.url);
    const isIntegrated = parsed.hostname === "api.odcloud.kr";
    const page = Number(parsed.searchParams.get(isIntegrated ? "page" : "pageNo"));
    requested.push({
      source: isIntegrated ? "integrated" : "standard",
      page,
      hasKey: parsed.searchParams.get("serviceKey") === "test",
    });

    if (isIntegrated) {
      const data = page === 1
        ? [
            {
              시도: "서울특별시", 시군구: "강남구", 구역명칭: "A",
              "현사업추진단계": "조합설립인가", "공급예정세대수": "100",
            },
            { 시도: "부산광역시", 시군구: "동구", 구역명: "B" },
          ]
        : [{ 시도: "대전광역시", 시군구: "동구", 구역명: "C" }];
      return new Response(JSON.stringify({ currentCount: data.length, totalCount: 3, data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
        body: {
          totalCount: 1,
          items: [{ CTPV_NM: "광주광역시", SGG_NM: "북구", ZONE_NM: "D" }],
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});

const result = await fetchNationalMaintenanceAttributes({ serviceKey: "test", httpClient, pageSize: 2 });
assert.equal(result.integrated.length, 3);
assert.equal(result.standard.length, 1);
assert.equal(result.integrated[0].name, "A");
assert.equal(result.integrated[0].stage, "조합설립");
assert.equal(result.integrated[0].planned_households, 100);
assert.equal(result.standard[0].name, "D");
assert.equal(result.standard[0].sido, "광주광역시");
assert.deepEqual(requested, [
  { source: "integrated", page: 1, hasKey: true },
  { source: "integrated", page: 2, hasKey: true },
  { source: "standard", page: 1, hasKey: true },
]);

await assert.rejects(
  () => fetchNationalMaintenanceAttributes({
    serviceKey: "expired",
    httpClient: ky.create({
      retry: 0,
      timeout: 1_000,
      fetch: async () => new Response(
        JSON.stringify({ code: "30", msg: "SERVICE KEY IS NOT REGISTERED ERROR" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    }),
  }),
  /SERVICE KEY|403/,
);

await assert.rejects(
  () => fetchNationalMaintenanceAttributes({
    serviceKey: "xml-error",
    httpClient: ky.create({
      retry: 0,
      timeout: 1_000,
      fetch: async () => new Response(
        "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>UNREGISTERED KEY</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
        { status: 200, headers: { "Content-Type": "text/xml" } },
      ),
    }),
  }),
  /UNREGISTERED KEY|XML/,
);

await assert.rejects(
  () => fetchNationalMaintenanceAttributes({
    serviceKey: "json-error",
    httpClient: ky.create({
      retry: 0,
      timeout: 1_000,
      fetch: async () => new Response(
        JSON.stringify({ code: "30", msg: "SERVICE KEY IS NOT REGISTERED ERROR" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    }),
  }),
  /SERVICE KEY|30/,
);

await assert.rejects(
  () => fetchNationalMaintenanceAttributes({ serviceKey: "   " }),
  /DATA_GO_KR_API_KEY is not configured/,
);

console.log("maintenance national provider: all tests passed");
