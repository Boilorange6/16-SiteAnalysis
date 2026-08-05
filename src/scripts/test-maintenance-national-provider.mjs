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

// ── 상류가 봉투를 벗겨서 준다 — {response:{header,body}} → {header,body} ──────
// 2026-08-05 운영에서 maintenance_attributes가 계속 실패했다. 표준 API가
// response 래퍼 없이 header/body를 top-level로 반환하도록 바뀐 것이 원인이었다.
// 두 형태 모두 받아야 상류가 되돌려도 깨지지 않는다.
{
  const unwrapped = ky.create({
    retry: 0,
    timeout: 1_000,
    fetch: async (request) => {
      const parsed = new URL(request.url);
      if (parsed.hostname === "api.odcloud.kr") {
        return new Response(JSON.stringify({ currentCount: 0, totalCount: 0, data: [] }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
        body: { totalCount: 1, items: { item: [{ CTPV_NM: "경상남도", SGG_NM: "진주시", ZONE_NM: "하대6구역" }] } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const flat = await fetchNationalMaintenanceAttributes({
    serviceKey: "test", httpClient: unwrapped, pageSize: 10,
  });
  assert.equal(flat.standard.length, 1, "봉투 없는 응답도 파싱해야 한다");
  assert.equal(flat.standard[0].name, "하대6구역");
  assert.equal(flat.standard[0].sido, "경상남도");
  console.log("national-provider: 봉투 없는 표준 응답 파싱 확인");
}

// 상류 오류는 봉투가 없어도 여전히 오류로 잡아야 한다 (조용한 0건 금지)
await assert.rejects(
  () => fetchNationalMaintenanceAttributes({
    serviceKey: "expired",
    httpClient: ky.create({
      retry: 0,
      timeout: 1_000,
      fetch: async (request) => new URL(request.url).hostname === "api.odcloud.kr"
        ? new Response(JSON.stringify({ currentCount: 0, totalCount: 0, data: [] }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({
            header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR" },
          }), { status: 200, headers: { "Content-Type": "application/json" } }),
    }),
  }),
  /SERVICE KEY IS NOT REGISTERED/,
  "봉투 없는 헤더 오류도 예외가 되어야 한다",
);
console.log("national-provider: 봉투 없는 오류 헤더 감지 확인");

// ── 상류 필드명이 UPPER_SNAKE → camelCase로 바뀌었다 ──────────────────────────
// 봉투를 고친 뒤에도 표준 소스가 0건이었다. 응답이 CTPV_NM 대신 ctpvNm을 쓴다.
// 조용한 0건이 가장 위험하므로 실제 운영 응답 모양을 그대로 고정한다.
assert.deepEqual(
  normalizeStandardRow({
    zoneNm: "하대6구역(상대주공아파트)",
    ctpvNm: "경상남도",
    sggNm: "진주시",
    usgRgn: "제2종 일반주거지역",
    bdcvrt: "0",
    gfa: "24399",
    prgrsStpCn: "조합설립인가",
    hhCnt: "",
    dsgnYmd: "2024-06-26",
    mngInstNm: "경상남도 진주시청",
    dataCrtrYmd: "2026-01-20",
  }),
  {
    source_record_id: "경상남도|진주시|하대6구역(상대주공아파트)",
    source: "public_standard",
    sido: "경상남도",
    sigungu: "진주시",
    name: "하대6구역(상대주공아파트)",
    // 표준 API는 사업유형 필드를 주지 않는다 — 추측하지 말고 미확인으로 둔다
    type: "미확인",
    stage: "조합설립",
    area_sqm: 24399,
    land_use_zone: "제2종 일반주거지역",
    building_coverage_ratio: 0,
    designation_date: "2024-06-26",
    management_agency: "경상남도 진주시청",
    source_updated_at: "2026-01-20",
  },
);
console.log("national-provider: camelCase 필드명 정규화 확인");

// 옛 UPPER_SNAKE도 계속 받아야 한다 (상류가 되돌릴 수 있다)
assert.equal(
  normalizeStandardRow({ CTPV_NM: "광주광역시", SGG_NM: "북구", ZONE_NM: "D" })?.name,
  "D",
  "옛 필드명도 계속 지원해야 한다",
);
console.log("national-provider: 옛 필드명 하위호환 확인");

// ── 스키마가 또 바뀌면 조용한 0건이 아니라 예외여야 한다 ──────────────────────
// 이번 장애의 본질은 "응답은 200, 행도 있는데 하나도 못 읽어서 0건"이었다.
// HTTP도 헤더도 정상이라 어디서도 경고가 뜨지 않았다.
await assert.rejects(
  () => fetchNationalMaintenanceAttributes({
    serviceKey: "test",
    httpClient: ky.create({
      retry: 0,
      timeout: 1_000,
      fetch: async (request) => new URL(request.url).hostname === "api.odcloud.kr"
        ? new Response(JSON.stringify({ currentCount: 0, totalCount: 0, data: [] }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
            // 행은 있는데 아는 필드명이 하나도 없다 = 상류 스키마 변경
            body: { totalCount: 2, items: { item: [{ 알수없는필드: "x" }, { 다른필드: "y" }] } },
          }), { status: 200, headers: { "Content-Type": "application/json" } }),
    }),
  }),
  /schema/i,
  "행이 있는데 전부 못 읽으면 예외여야 한다",
);
console.log("national-provider: 스키마 변경 시 조용한 0건 대신 예외 확인");

// 상류가 진짜로 0건을 주는 건 정상이다 — 예외로 만들면 안 된다
{
  const empty = await fetchNationalMaintenanceAttributes({
    serviceKey: "test",
    httpClient: ky.create({
      retry: 0,
      timeout: 1_000,
      fetch: async (request) => new URL(request.url).hostname === "api.odcloud.kr"
        ? new Response(JSON.stringify({ currentCount: 0, totalCount: 0, data: [] }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
            body: { totalCount: 0, items: { item: [] } },
          }), { status: 200, headers: { "Content-Type": "application/json" } }),
    }),
  });
  assert.equal(empty.standard.length, 0, "진짜 0건은 정상 통과해야 한다");
  console.log("national-provider: 진짜 0건은 예외 아님 확인");
}
