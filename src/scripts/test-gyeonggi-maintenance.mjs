import assert from "node:assert/strict";

import {
  GYEONGGI_SERVICE_NAME,
  fetchGyeonggiMaintenance,
  normalizeGyeonggiRow,
} from "../lib/server/maintenance/gyeonggi-provider.ts";

// ── 행 정규화: 경기데이터드림 필드 → 앱 공통 스키마 ───────────────────────
{
  const row = normalizeGyeonggiRow({
    SIGUN_NM: "성남시 분당구",
    BSNS_NM: "시범단지 우성·현대 리모델링주택조합",
    BSNS_SE_NM: "리모델링",
    PRGRS_STTUS_NM: "사업시행인가",
    LOCPLC_LOTNO_ADDR: "경기도 성남시 분당구 서현동 245",
    PLAN_HSHLD_CO: "1,842",
    ARA: "56,000",
    DESIGN_DE: "2021-03-15",
  });

  assert.equal(row.sido, "경기도");
  assert.equal(row.sigungu, "성남시 분당구");
  assert.equal(row.name, "시범단지 우성·현대 리모델링주택조합");
  assert.equal(row.type, "리모델링");
  assert.equal(row.stage_text, "사업시행인가");
  assert.equal(row.address, "경기도 성남시 분당구 서현동 245");
  assert.equal(row.planned_households, 1842, "쉼표가 섞인 숫자를 파싱해야 한다");
  assert.equal(row.area_sqm, 56000);
  assert.equal(row.designation_date, "2021-03-15");
}

// ── 필수 필드가 없으면 버린다 (쓰레기 레코드 유입 방지) ───────────────────
{
  assert.equal(normalizeGyeonggiRow({ SIGUN_NM: "성남시", PRGRS_STTUS_NM: "착공" }), null,
    "사업명이 없으면 레코드로 만들지 않는다");
  assert.equal(normalizeGyeonggiRow({ BSNS_NM: "이름만 있음" }), null,
    "시군이 없으면 레코드로 만들지 않는다");
}

// ── 숫자·날짜 결측을 안전하게 처리한다 ────────────────────────────────────
{
  const row = normalizeGyeonggiRow({
    SIGUN_NM: "수원시 영통구", BSNS_NM: "테스트 조합", PRGRS_STTUS_NM: "조합설립인가",
    PLAN_HSHLD_CO: "-", ARA: "", DESIGN_DE: "0000-00-00",
  });
  assert.equal(row.planned_households, undefined);
  assert.equal(row.area_sqm, undefined);
  assert.equal(row.designation_date, undefined);
  assert.equal(row.address, "");
}

// ── API 응답 파싱 + 페이지네이션 ──────────────────────────────────────────
{
  const pages = {
    1: { list_total_count: 3, rows: [
      { SIGUN_NM: "성남시 분당구", BSNS_NM: "A조합", PRGRS_STTUS_NM: "착공" },
      { SIGUN_NM: "성남시 분당구", BSNS_NM: "B조합", PRGRS_STTUS_NM: "준공인가" },
    ] },
    2: { list_total_count: 3, rows: [
      { SIGUN_NM: "용인시 수지구", BSNS_NM: "C조합", PRGRS_STTUS_NM: "관리처분인가" },
    ] },
  };
  const seen = [];
  const fetchImpl = async (url) => {
    const pIndex = Number(new URL(url).searchParams.get("pIndex"));
    seen.push(pIndex);
    const page = pages[pIndex];
    return {
      ok: true, status: 200,
      json: async () => ({
        [GYEONGGI_SERVICE_NAME]: [
          { head: [{ list_total_count: page.list_total_count }, { RESULT: { CODE: "INFO-000" } }] },
          { row: page.rows },
        ],
      }),
    };
  };

  const records = await fetchGyeonggiMaintenance({ apiKey: "k", fetchImpl, pageSize: 2 });
  assert.deepEqual(seen, [1, 2], "총 건수에 맞춰 다음 페이지까지 읽어야 한다");
  assert.equal(records.length, 3);
  assert.equal(records[0].sido, "경기도");
  assert.equal(records[2].sigungu, "용인시 수지구");
}

// ── API 오류 코드는 예외로 올린다 (조용한 빈 결과 금지) ───────────────────
{
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ RESULT: { CODE: "ERROR-300", MESSAGE: "필수 값이 누락되었습니다" } }),
  });
  await assert.rejects(fetchGyeonggiMaintenance({ apiKey: "k", fetchImpl }), /ERROR-300/);
}

{
  // 데이터 없음(INFO-200)은 오류가 아니라 빈 결과다
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } }),
  });
  assert.deepEqual(await fetchGyeonggiMaintenance({ apiKey: "k", fetchImpl }), []);
}

console.log("test-gyeonggi-maintenance: all assertions passed");
