/**
 * 건축물대장 표제부에서 오피스텔을 골라내는 규칙 검증.
 *
 * 배경: 앱은 총괄표제부(getBrRecapTitleInfo)만 봤는데 거기엔 오피스텔이 없다.
 * 총괄표제부의 "업무시설"은 한국과학기술회관·신한은행 같은 순수 업무빌딩이고
 * 세대·호수가 모두 0이다. 오피스텔은 표제부(getBrTitleInfo)에 주용도 "업무시설",
 * 세부용도(etcPurps) "오피스텔"로 들어 있고 세대수가 아니라 호수(hoCnt)를 쓴다.
 */
import assert from "node:assert/strict";
import { readOfficetelFromTitleRow } from "../lib/server/residential/officetel.ts";

// 실제 역삼동 응답 — 세대수는 0이고 호수에 값이 있다
assert.deepEqual(
  readOfficetelFromTitleRow({
    bldNm: "역삼 노블루체 언주",
    mainPurpsCdNm: "업무시설",
    etcPurps: "오피스텔(주거용)",
    hhldCnt: "0",
    hoCnt: "129",
    grndFlrCnt: "15",
    platPlc: "서울특별시 강남구 역삼동 761번지",
    useAprDay: "20190315",
    bun: "0761",
    ji: "0000",
    totPkngCnt: "80",
  }),
  {
    name: "역삼 노블루체 언주",
    units: 129,
    parking: 80,
    maxFloor: 15,
    useAprDay: "20190315",
    platPlc: "서울특별시 강남구 역삼동 761",
    bun: "0761",
    ji: "0000",
  },
);

// 복합용도 — 세부용도 안에 오피스텔이 섞여 있어도 잡아야 한다 (실제 고덕동 응답)
assert.equal(
  readOfficetelFromTitleRow({
    bldNm: "오앤하우스",
    mainPurpsCdNm: "업무시설",
    etcPurps: "근린생활시설 및 업무시설(오피스텔),다세대(도시형-원룸형)",
    hhldCnt: "21",
    hoCnt: "24",
    platPlc: "서울특별시 강동구 고덕동 1번지",
  })?.units,
  24,
  "호수가 있으면 호수를 쓴다",
);

// 호수가 없으면 세대수로 폴백
assert.equal(
  readOfficetelFromTitleRow({
    bldNm: "세대수형 오피스텔",
    mainPurpsCdNm: "업무시설",
    etcPurps: "업무시설(오피스텔)",
    hhldCnt: "30",
    hoCnt: "0",
    platPlc: "서울특별시 강남구 역삼동 2번지",
  })?.units,
  30,
);

// ── 걸러야 하는 것들 ─────────────────────────────────────────────────────────
// 순수 업무빌딩 — 총괄표제부의 업무시설이 전부 이 모양이었다
assert.equal(
  readOfficetelFromTitleRow({
    bldNm: "한국과학기술회관",
    mainPurpsCdNm: "업무시설",
    etcPurps: "업무시설/근린생활시설",
    hhldCnt: "0",
    hoCnt: "0",
    platPlc: "서울특별시 강남구 역삼동 635번지",
  }),
  null,
  "오피스텔이 아닌 업무시설은 주거 POI가 아니다",
);

// 세부용도에 오피스텔이 있어도 규모를 모르면 버린다 (지도에 세대 0으로 찍히면 안 된다)
assert.equal(
  readOfficetelFromTitleRow({
    bldNm: "규모미상",
    mainPurpsCdNm: "업무시설",
    etcPurps: "업무시설(오피스텔)",
    hhldCnt: "0",
    hoCnt: "0",
    platPlc: "서울특별시 강남구 역삼동 3번지",
  }),
  null,
);

// 이름 없는 행 — 지도에 이름 없는 마커를 만들지 않는다
assert.equal(
  readOfficetelFromTitleRow({
    bldNm: " ",
    mainPurpsCdNm: "업무시설",
    etcPurps: "오피스텔",
    hoCnt: "50",
    platPlc: "서울특별시 강남구 역삼동 4번지",
  }),
  null,
);

// 공동주택은 총괄표제부가 이미 담당한다 — 여기서 또 넣으면 중복된다
assert.equal(
  readOfficetelFromTitleRow({
    bldNm: "래미안아파트",
    mainPurpsCdNm: "공동주택",
    etcPurps: "아파트",
    hhldCnt: "500",
    hoCnt: "500",
    platPlc: "서울특별시 강남구 역삼동 5번지",
  }),
  null,
  "공동주택은 총괄표제부 담당 — 중복 방지",
);

console.log("officetel-ledger: all assertions passed");
