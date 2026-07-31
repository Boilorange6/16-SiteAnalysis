import assert from "node:assert/strict";

import {
  buildTradeIndex,
  fetchMonthlyTrades,
  parseRtmsTradePage,
  recentDealMonths,
  summarizeTrades,
  synthesizeMissingComplexes,
} from "../lib/server/rtms-trades.ts";
import { formatComplexTradeCell, formatRecentTradesLine, formatTradeDetailLine, formatTradePrice } from "../lib/maintenance-map-utils.ts";

// --- XML 파싱 ---
const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header>
  <body>
    <items>
      <item>
        <aptNm>디에이치퍼스티어아이파크</aptNm><umdNm>개포동</umdNm><jibun>660-4</jibun>
        <dealAmount>    225,000</dealAmount><excluUseAr>84.9</excluUseAr>
        <dealYear>2026</dealYear><dealMonth>6</dealMonth><dealDay>15</dealDay>
        <floor>21</floor><buildYear>2023</buildYear>
      </item>
      <item>
        <aptNm>디에이치퍼스티어아이파크</aptNm><umdNm>개포동</umdNm><jibun>660-4</jibun>
        <dealAmount>310,000</dealAmount><excluUseAr>112.0</excluUseAr>
        <dealYear>2026</dealYear><dealMonth>3</dealMonth><dealDay>2</dealDay>
        <floor>5</floor><buildYear>2023</buildYear>
      </item>
      <item>
        <aptNm>개포주공5단지</aptNm><umdNm>개포동</umdNm><jibun>187</jibun>
        <dealAmount>195,000</dealAmount><excluUseAr>74.2</excluUseAr>
        <dealYear>2026</dealYear><dealMonth>5</dealMonth><dealDay>9</dealDay>
      </item>
      <item><aptNm></aptNm><dealAmount>100</dealAmount></item>
    </items>
    <numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>3</totalCount>
  </body>
</response>`;
const page = parseRtmsTradePage(sampleXml);
assert.equal(page.totalCount, 3);
assert.equal(page.trades.length, 3);
assert.deepEqual(page.trades[0], {
  apt_name: "디에이치퍼스티어아이파크", dong: "개포동", jibun: "660-4",
  price_manwon: 225000, area_sqm: 84.9, deal_date: "2026-06-15", floor: 21, build_year: 2023,
});
assert.throws(() => parseRtmsTradePage("<response><header><resultCode>30</resultCode><resultMsg>KEY</resultMsg></header></response>"), /30/);

// --- 페이지네이션 완결성 ---
{
  // totalCount가 페이지 크기를 넘으면 필요한 페이지를 모두 읽어야 한다
  const pageSize = 1000;
  const total = 2500;
  const seenPages = [];
  const fetchImpl = async (url) => {
    const pageNo = Number(new URL(url).searchParams.get("pageNo"));
    seenPages.push(pageNo);
    const items = Array.from({ length: Math.min(pageSize, total - (pageNo - 1) * pageSize) }, (_, i) =>
      `<item><aptNm>단지${pageNo}_${i}</aptNm><umdNm>개포동</umdNm><jibun>1</jibun>
       <dealAmount>100,000</dealAmount><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay></item>`).join("");
    return { ok: true, status: 200, text: async () => `<response><header><resultCode>000</resultCode></header><body><items>${items}</items><totalCount>${total}</totalCount></body></response>` };
  };
  const { trades, truncated } = await fetchMonthlyTrades({ serviceKey: "k", lawdCd: "11680", dealYm: "202607", fetchImpl });
  assert.deepEqual(seenPages.sort((a, b) => a - b), [1, 2, 3], "totalCount에 맞춰 3페이지를 모두 읽어야 한다");
  assert.equal(trades.length, total);
  assert.equal(truncated, false, "상한 내에서 다 읽었으면 절단이 아니다");
}

{
  // 상한을 넘으면 절단 사실을 보고해야 한다 (조용한 과소 집계 금지)
  const fetchImpl = async () => ({
    ok: true, status: 200,
    text: async () => `<response><header><resultCode>000</resultCode></header><body><items>` +
      `<item><aptNm>단지</aptNm><umdNm>개포동</umdNm><jibun>1</jibun><dealAmount>100,000</dealAmount>` +
      `<dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay></item>` +
      `</items><totalCount>999999</totalCount></body></response>`,
  });
  const { truncated } = await fetchMonthlyTrades({ serviceKey: "k", lawdCd: "11680", dealYm: "202607", fetchImpl, maxPages: 2 });
  assert.equal(truncated, true, "페이지 상한 초과 시 truncated=true여야 한다");
}

// --- 월 목록 ---
assert.deepEqual(recentDealMonths(new Date(Date.UTC(2026, 6, 30)), 3), ["202607", "202606", "202605"]);
assert.deepEqual(recentDealMonths(new Date(Date.UTC(2026, 0, 15)), 2), ["202601", "202512"]);

// --- 인덱스 & 요약 ---
const index = buildTradeIndex(page.trades);
// 이름 정규화 매칭 (공백·"아파트" 무시)
assert.equal(index.byName.get("디에이치퍼스티어아이파크")?.length, 2);
// 지번 매칭
assert.equal(index.byJibun.get("개포동|660-4")?.length, 2);
assert.equal(index.byJibun.get("개포동|187")?.length, 1);

const summary = summarizeTrades(index.byJibun.get("개포동|660-4") ?? []);
assert.equal(summary?.count, 2);
assert.equal(summary?.latest_price_manwon, 225000);
assert.equal(summary?.latest_date, "2026-06-15");
assert.equal(summary?.max_price_manwon, 310000);
assert.equal(summarizeTrades([]), undefined);

// --- 표시 포맷 ---
assert.equal(formatTradePrice(225000), "22억 5,000");
assert.equal(formatTradePrice(310000), "31억");
assert.equal(formatTradePrice(9800), "9,800만");
assert.equal(
  formatRecentTradesLine({ count: 2, months: 6, latest_price_manwon: 225000, latest_date: "2026-06-15", latest_area_sqm: 84.9, max_price_manwon: 310000 }),
  "22억 5,000 (2026-06-15 · 84.9㎡) · 6개월 2건",
);

assert.equal(summary?.max_build_year, 2023);

// --- 실거래 상세 목록 ---
{
  const detail = summarizeTrades(index.byJibun.get("개포동|660-4") ?? []);
  assert.ok(Array.isArray(detail.recent_list), "요약에 최근 거래 목록이 있어야 한다");
  assert.equal(detail.recent_list.length, 2);
  // 최신순 정렬
  assert.equal(detail.recent_list[0].deal_date, "2026-06-15");
  assert.equal(detail.recent_list[1].deal_date, "2026-03-02");
  assert.equal(detail.recent_list[0].price_manwon, 225000);
  assert.equal(detail.recent_list[0].area_sqm, 84.9);
  assert.equal(detail.recent_list[0].floor, 21);

  // 목록은 상한이 있어 팝업·페이로드가 비대해지지 않는다
  const many = Array.from({ length: 30 }, (_, i) => ({
    apt_name: "테스트", dong: "개포동", jibun: "1", price_manwon: 100000 + i,
    area_sqm: 84, deal_date: `2026-0${(i % 6) + 1}-01`,
  }));
  assert.ok(summarizeTrades(many).recent_list.length <= 10, "목록은 최대 10건으로 제한한다");
}

// --- 실거래 상세 표시 포맷 ---
{
  assert.equal(
    formatTradeDetailLine({ deal_date: "2026-06-15", price_manwon: 225000, area_sqm: 84.9, floor: 21 }),
    "2026-06-15 · 22억 5,000 · 84.9㎡ · 21층",
  );
  assert.equal(
    formatTradeDetailLine({ deal_date: "2026-03-02", price_manwon: 9800, area_sqm: 59 }),
    "2026-03-02 · 9,800만 · 59㎡",
  );
}

// --- 건축물대장 누락 신축 단지 합성 ---
{
  const center = { lat: 37.4807, lng: 127.0584 };
  const synthesized = await synthesizeMissingComplexes({
    pois: [
      { id: "a", name: "개포주공5단지", lat: 37.487, lng: 127.068, category: "apartment", units: 940, parking_count: 0, sale_date: "1983-06", distance_m: 0, status: "existing", source: "ledger" },
    ],
    index,
    center,
    radiusM: 2000,
    lawdCd: "11680",
    geocode: async (query) => (query === "개포동 660-4" ? { lat: 37.4804, lng: 127.0571 } : null),
  });
  // 퍼스티어(2023 신축·기존 POI 없음)만 합성, 주공5단지(구축·이미 존재)는 제외
  assert.equal(synthesized.length, 1);
  assert.equal(synthesized[0].name, "디에이치퍼스티어아이파크");
  assert.equal(synthesized[0].source, "rtms");
  assert.equal(synthesized[0].sale_date, "2023");
  assert.ok(synthesized[0].recent_trades.count >= 1);

  // 장소검색이 성공하면 지번 지오코딩보다 우선, 반경 밖 결과는 버리고 지번 폴백
  const placed = await synthesizeMissingComplexes({
    pois: [], index, center, radiusM: 2000, lawdCd: "11680",
    searchPlace: async () => ({ lat: 37.4804, lng: 127.0571 }),
    geocode: async () => { throw new Error("장소검색 성공 시 지오코딩 호출 금지"); },
    enrich: async () => new Map(),
  });
  assert.ok(placed.some((p) => p.name === "디에이치퍼스티어아이파크" && Math.abs(p.lat - 37.4804) < 1e-6));
  const outOfRange = await synthesizeMissingComplexes({
    pois: [], index, center, radiusM: 2000, lawdCd: "11680",
    searchPlace: async () => ({ lat: 35.1, lng: 129.0 }), // 부산 동명 단지 오매칭 가정
    geocode: async (query) => (query === "개포동 660-4" ? { lat: 37.4804, lng: 127.0571 } : null),
    enrich: async () => new Map(),
  });
  assert.ok(outOfRange.some((p) => p.name === "디에이치퍼스티어아이파크"));

  // 세대수 보강(enrich) 결과가 있으면 units·sale_date 갱신
  const enriched = await synthesizeMissingComplexes({
    pois: [], index, center, radiusM: 2000, lawdCd: "11680",
    searchPlace: async () => ({ lat: 37.4804, lng: 127.0571 }),
    geocode: async () => null,
    enrich: async () => new Map([["디에이치퍼스티어아이파크", { units: 6702, parking_count: 0, sale_date: "2023-11" }]]),
  });
  const target = enriched.find((p) => p.name === "디에이치퍼스티어아이파크");
  assert.equal(target?.units, 6702);
  assert.equal(target?.sale_date, "2023-11");
}

// 구조화 지번 폴백: jibun 태그가 없어도 bonbun/bubun으로 지번 구성
{
  const xml = `<response><header><resultCode>000</resultCode></header><body><items><item>
    <aptNm>테스트단지</aptNm><umdNm>개포동</umdNm><umdCd>10300</umdCd>
    <bonbun>0660</bonbun><bubun>0004</bubun>
    <dealAmount>100,000</dealAmount><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>1</dealDay>
  </item></items><totalCount>1</totalCount></body></response>`;
  const parsed = parseRtmsTradePage(xml);
  assert.equal(parsed.trades[0].jibun, "660-4");
  assert.equal(parsed.trades[0].umd_cd, "10300");
}

// PPT 표 셀 축약
assert.equal(formatComplexTradeCell({ count: 2, months: 6, latest_price_manwon: 225000, latest_date: "2026-06-15", latest_area_sqm: 84.9, max_price_manwon: 310000 }), "22.5억(26.06)");
assert.equal(formatComplexTradeCell({ count: 1, months: 6, latest_price_manwon: 310000, latest_date: "2026-03-02", latest_area_sqm: 112, max_price_manwon: 310000 }), "31억(26.03)");
assert.equal(formatComplexTradeCell({ count: 1, months: 6, latest_price_manwon: 9800, latest_date: "2026-05-01", latest_area_sqm: 59, max_price_manwon: 9800 }), "9,800만(26.05)");
assert.equal(formatComplexTradeCell(undefined), "무거래");

console.log("test-rtms-trades: all assertions passed");
