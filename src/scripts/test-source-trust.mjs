/**
 * 신뢰 표시 테스트 (Phase 3).
 * "모르는 것을 모른다고 말한다" — 실패·노후 데이터를 정상 데이터처럼 보이지 않게 한다.
 */
import assert from "node:assert/strict";

import {
  MISSING_DATA_NOTICES,
  dataAsOfFootnote,
  describeSourceAge,
  failedSourceMessages,
  missingSectionNotices,
  reportPoisForSourceStatuses,
  sourceStatusLines,
} from "../lib/source-status-text.ts";
import { isStaleStage, maintenanceStalenessNote } from "../lib/maintenance-presentation.ts";

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 31);

// ── 3-1) 만료 캐시는 연령과 함께 stale로 표기된다 ─────────────────────────
{
  const lines = sourceStatusLines([
    { source: "osm", status: "cached", fetchedAt: now - 2 * day, stale: false },
    { source: "residential", status: "cached", fetchedAt: now - 20 * day, stale: true },
  ], { now });

  assert.match(lines[0], /2026-07-29 수집/, "신선한 캐시는 수집일만 표기한다");
  assert.doesNotMatch(lines[0], /장애|경과/, "신선한 캐시에 경고를 붙이면 안 된다");
  assert.match(lines[1], /20일 전/, "만료 캐시는 데이터 연령을 드러내야 한다");
  assert.match(lines[1], /원천 장애/, "만료 캐시는 원천 장애로 인한 대체임을 밝혀야 한다");
}

{
  assert.equal(describeSourceAge(now - 0 * day, now), "오늘");
  assert.equal(describeSourceAge(now - 1 * day, now), "1일 전");
  assert.equal(describeSourceAge(now - 45 * day, now), "45일 전");
  assert.equal(describeSourceAge(null, now), "시점 미상");
}

// ── 3-2) 원천 실패 시 해당 보고서 섹션을 '결측'으로 표기한다 ──────────────
{
  const notices = missingSectionNotices([
    { source: "osm", status: "failed", fetchedAt: null },
    { source: "park", status: "fresh", fetchedAt: now },
  ]);
  assert.ok(notices.subway, "OSM 실패 시 교통 섹션에 결측 안내가 있어야 한다");
  assert.ok(notices.school, "OSM 실패 시 교육 섹션에도 결측 안내가 있어야 한다");
  assert.equal(notices.park, undefined, "정상 원천 섹션에는 안내가 없어야 한다");
  assert.match(notices.subway, /수집 실패/);
}

{
  // 공원 외 원천도 동일하게 처리된다 (기존에는 공원만 특별 취급)
  const notices = missingSectionNotices([{ source: "residential", status: "failed", fetchedAt: null }]);
  assert.ok(notices.apartment, "주거 원천 실패 시 주거 섹션 결측 안내가 있어야 한다");
  assert.equal(MISSING_DATA_NOTICES.apartment, notices.apartment);
}

{
  // 실패 원천의 POI는 보고서 산출에서 제외한다 (공원만이 아니라 전부)
  const pois = [
    { id: "p1", name: "공원", lat: 0, lng: 0, category: "park" },
    { id: "s1", name: "역", lat: 0, lng: 0, category: "subway" },
  ];
  const filtered = reportPoisForSourceStatuses(pois, [{ source: "osm", status: "failed", fetchedAt: null }]);
  assert.equal(filtered.some((poi) => poi.category === "subway"), false,
    "OSM 실패 시 지하철 POI는 산출에서 빠져야 한다");
  assert.equal(filtered.some((poi) => poi.category === "park"), true,
    "정상 원천의 POI는 유지되어야 한다");
}

// ── 3-3) 실패 메시지를 사용자 언어로 번역한다 ─────────────────────────────
{
  const messages = failedSourceMessages(["maintenance_seoul", "park", "알 수 없는 소스"]);
  assert.equal(messages.length, 3);
  assert.match(messages[0], /서울 정비사업/, "소스 코드명이 아니라 사람이 읽는 이름이어야 한다");
  assert.doesNotMatch(messages[0], /maintenance_seoul/);
  assert.match(messages[0], /다시 시도|잠시 후/, "사용자가 무엇을 하면 되는지 알려야 한다");
  assert.ok(messages[2].length > 0, "알 수 없는 소스도 안내 문구를 만들어야 한다");
}

// ── 3-5) 정비사업 단계 노후 경고 ──────────────────────────────────────────
{
  assert.equal(isStaleStage("2023-01-01", now), true, "2년 이상 지난 단계는 노후로 본다");
  assert.equal(isStaleStage("2026-01-01", now), false);
  assert.equal(isStaleStage(undefined, now), false, "기준일이 없으면 노후 판정하지 않는다");

  const note = maintenanceStalenessNote({ stage: "착공", source_updated_at: "2023-01-01" }, now);
  assert.match(note, /갱신 지연/, "노후 단계는 갱신 지연을 표시해야 한다");
  assert.equal(maintenanceStalenessNote({ stage: "착공", source_updated_at: "2026-07-01" }, now), "");
}

// ── 3-6) PPT 기준일 각주는 원천별 기준일을 한 줄로 통일한다 ───────────────
{
  const footnote = dataAsOfFootnote([
    { source: "rtms", status: "fresh", fetchedAt: now },
    { source: "maintenance_seoul_cleanup", status: "cached", fetchedAt: now - 3 * day },
    { source: "osm", status: "failed", fetchedAt: null },
  ], { now });

  assert.match(footnote, /아파트 실거래가 2026-07-31/, "원천별 기준일이 들어가야 한다");
  assert.match(footnote, /2026-07-28/, "캐시 원천의 기준일도 실제 수집일이어야 한다");
  assert.match(footnote, /수집 실패/, "실패 원천은 각주에서도 실패로 표기해야 한다");
  assert.ok(footnote.includes(" · "), "한 줄로 통일된 구분자를 써야 한다");
  assert.equal(dataAsOfFootnote([], { now }), "", "원천이 없으면 빈 각주");
}

console.log("test-source-trust: all assertions passed");
