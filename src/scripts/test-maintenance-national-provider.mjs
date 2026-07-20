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
            { 시도: "서울특별시", 시군구: "강남구", 구역명: "A" },
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
          items: [{ 시도명: "광주광역시", 시군구명: "북구", 정비구역명: "D" }],
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});

const result = await fetchNationalMaintenanceAttributes({ serviceKey: "test", httpClient, pageSize: 2 });
assert.equal(result.integrated.length, 3);
assert.equal(result.standard.length, 1);
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
  () => fetchNationalMaintenanceAttributes({ serviceKey: "   " }),
  /DATA_GO_KR_API_KEY is not configured/,
);

console.log("maintenance national provider: all tests passed");
