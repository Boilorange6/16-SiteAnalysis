import assert from "node:assert/strict";

import {
  buildTradeIndex,
  parseRtmsTradePage,
  recentDealMonths,
  summarizeTrades,
} from "../lib/server/rtms-trades.ts";
import { formatComplexTradeCell, formatRecentTradesLine, formatTradePrice } from "../lib/maintenance-map-utils.ts";

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

// PPT 표 셀 축약
assert.equal(formatComplexTradeCell({ count: 2, months: 6, latest_price_manwon: 225000, latest_date: "2026-06-15", latest_area_sqm: 84.9, max_price_manwon: 310000 }), "22.5억(26.06)");
assert.equal(formatComplexTradeCell({ count: 1, months: 6, latest_price_manwon: 310000, latest_date: "2026-03-02", latest_area_sqm: 112, max_price_manwon: 310000 }), "31억(26.03)");
assert.equal(formatComplexTradeCell({ count: 1, months: 6, latest_price_manwon: 9800, latest_date: "2026-05-01", latest_area_sqm: 59, max_price_manwon: 9800 }), "9,800만(26.05)");
assert.equal(formatComplexTradeCell(undefined), "무거래");

console.log("test-rtms-trades: all assertions passed");
