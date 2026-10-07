import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const Database = (await import("better-sqlite3")).default;
const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { a01, gradeRail } = await import("../../lib/v2/engine/tiles/a01.ts");
const { a02 } = await import("../../lib/v2/engine/tiles/a02.ts");
const { a05 } = await import("../../lib/v2/engine/tiles/a05.ts");
const { a10 } = await import("../../lib/v2/engine/tiles/a10.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-rs-"));
  await buildEngineFixture(dir, "v1", options);
  const manifest = M.readManifest(dir);
  return (radiusM = 800, center = CENTER) => new EngineContext(dir, manifest, "an-1", { address: "경기도 남양주시 다산동 100", center, radiusM, analysisDate: "2026-09-30" });
};
const metric = (t, id) => t.metrics.find((m) => m.id === id);
const val = (t, id) => metric(t, id)?.value;
const FORBIDDEN = /도보|\d\s*분|종합/;
const noForbidden = (t) => {
  const forbidden = t.tileCode === "A01" ? /종합/ : FORBIDDEN;
  assert.doesNotMatch(JSON.stringify(t), forbidden, `${t.tileCode}: 금지 표현`);
  assert.doesNotMatch(JSON.stringify(toTileView(t)), forbidden, `${t.tileCode}: 화면 문자열 금지 표현`);
};
const layers = (t, l) => t.presentation.features.filter((f) => f.layer === l);

// ── A01 철도 ──
assert.deepEqual([500, 501, 1000, 1001].map(gradeRail), ["good", "fair", "fair", "caution"], "경계값 500/1000");
{
  const ctxFor = await make({ rail: true });
  const ctx = ctxFor(800);
  const t = a01(ctx);
  // 나래역(출입구 없음, 역 대표점 600m) < 다온역 출입구 650m(역 대표점 500m는 쓰지 않는다)
  assert.equal(val(t, "nearest_rail_m"), 600);
  assert.match(metric(t, "nearest_rail_m").label, /역 대표점/);
  assert.match(metric(t, "nearest_rail_m").formulaVersion, /탐색 1,500m/);
  assert.equal(val(t, "rail_stations"), 2, "반경 800 안: 나래·다온 (가온은 1100m라 밖)");
  assert.equal(val(t, "rail_lines"), 1, "반경과 교차한 고유 rail_line 원천 feature");
  assert.equal(t.judgment.level, null, "철도·버스 등급을 합치지 않는다");
  assert.match(t.judgment.sentence, /최근접 역 대표점 직선 600m, 최근접 정류장 직선 250m → 철도 접근은 보통 수준, 버스 접근은 가까운 편 → 실제 보행 경로는 확인 필요/);
  assert.match(t.judgment.criteria, /500m 이하 좋음 · 1,000m 이하 보통/);
  assert.match(t.judgment.criteria, /300m 이하 좋음/);
  assert.ok(!t.limitations.some((l) => l.note.includes("철도 자료 미적재")));
  assert.ok(t.limitations.some((l) => l.note.includes("역 대표점")));
  assert.deepEqual(t.provenance.sources.map((s) => s.sourceId), ["bus_stop", "osm_subway"]);
  // 지도: 노선 점열은 반경 안만, 최근접은 강조 + 라벨
  const nearest = layers(t, "rail_nearest");
  assert.deepEqual([nearest.length, nearest[0].highlight, nearest[0].label], [1, true, "직선 600m"]);
  assert.equal(layers(t, "rail_entrance").length, 1, "반경 안 출입구는 다온1뿐");
  assert.ok(layers(t, "rail_line").length > 10);
  assert.ok(t.presentation.layers.includes("rail_line"));
  noForbidden(t);
  ctx.close();

  // 분석 반경(500)보다 밖(600)이어도 탐색 1500 안이면 최근접으로 잡는다. 지도에는 그리지 않는다.
  const c5 = ctxFor(500);
  const t5 = a01(c5);
  assert.equal(val(t5, "nearest_rail_m"), 600);
  assert.equal(val(t5, "rail_stations"), 1, "반경 경계의 다온역 원천 feature를 포함");
  assert.equal(layers(t5, "rail_nearest").length, 0);
  assert.ok(t5.limitations.some((l) => l.note.includes("반경(500m) 밖")));
  c5.close();
}
{
  // 가까운 역이 없을 때: 출입구가 역 대표점보다 우선, 반경 밖(1100m) 출입구, 등급 주의
  const ctxFor = await make({ rail: "far" });
  const t = a01(ctxFor(800));
  assert.equal(val(t, "nearest_rail_m"), 1100, "가온역 출입구 1100m(역 대표점 1200m 아님)");
  assert.equal(metric(t, "nearest_rail_m").label, "최근접 철도역 출입구");
  assert.equal(val(t, "rail_stations"), 0);
  assert.match(t.judgment.sentence, /최근접 역 출입구 직선 1,100m.*철도 접근은 먼 편/);
  // 탐색 1500m 안에 역이 없으면 거리는 missing (먼역은 2000m)
  const none = a01(ctxFor(800, [127.1506 + 0.03, 37.6245 + 0.03]));
  assert.equal(metric(none, "nearest_rail_m").status, "missing");
  assert.match(none.judgment.sentence, /탐색 1,500m 안 운영역 없음/);
  assert.ok(none.limitations.some((l) => l.note.includes("철도 거리는 계산하지 못했습니다")));
}
{
  // 철도 원천이 없는 버전(기존 게시본): 지금까지와 같은 동작
  const ctx = (await make({}))(800);
  const t = a01(ctx);
  assert.ok(t.limitations.some((l) => l.kind === "not_provided" && l.note.includes("철도 자료를 확인하지 못해")));
  assert.equal(metric(t, "nearest_rail_m").status, "missing");
  assert.equal(t.judgment.level, "good");
  assert.equal(metric(t, "rail_lines").status, "missing", "철도 원천이 없어도 A01 집계 슬롯은 유지");
  assert.ok(!t.presentation.layers.includes("rail_line"));
  ctx.close();
}

// ── A01 보행망 도보시간·경로: 등급은 직선 지표에만 유지 ──
{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-rs-walk-"));
  await buildEngineFixture(dir, "v1", { rail: true, roads: true });
  const reference = new Database(join(dir, "versions", "v1", "reference.sqlite"));
  const roadRelease = reference.prepare("SELECT release_id FROM source_release WHERE source_id = 'osm_roads'").pluck().get();
  // OSM 중심선의 교차점이 반드시 정점이라는 T7 계약에 맞춰 중심에서 버스·나래역까지 연결한다.
  for (const [id, end] of [["bus-approach", [300, 0]], ["rail-approach", [-600, 0]]]) {
    insertFeature(reference, {
      stableId: `road:${id}`,
      kind: "road",
      sourceKey: id,
      releaseId: roadRelease,
      geometry: { type: "LineString", coordinates: [at(0, 0), at(end[0], end[1])] },
      properties: { osmId: id, fclass: "residential", hierarchy: "국지", name: null },
    });
  }
  reference.close();
  const ctx = new EngineContext(dir, M.readManifest(dir), "an-walk", { address: "x", center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
  const t = a01(ctx);
  assert.equal(metric(t, "walk_nearest_rail_m").status, "observed");
  assert.equal(metric(t, "walk_nearest_rail_min").status, "observed");
  assert.equal(metric(t, "walk_nearest_bus_m").status, "observed");
  assert.equal(metric(t, "walk_nearest_bus_min").status, "observed");
  assert.equal(val(t, "walk_nearest_rail_m"), 600);
  assert.equal(val(t, "walk_nearest_rail_min"), 7, "T7 walkMinutes()의 정점 경로 반올림");
  assert.equal(val(t, "walk_nearest_bus_m"), 300, "보행망 계약의 정점 스냅 거리");
  assert.equal(val(t, "walk_nearest_bus_min"), 4);
  assert.ok(t.presentation.layers.includes("walk_route"));
  assert.ok(t.presentation.lines.some((line) => line.layer === "walk_route"));
  assert.match(t.judgment.sentence, /보행망 도보\(OSM, 80 m\/분, 내부 제안 기준\)/);
  assert.ok((t.judgment.grades ?? []).every((grade) => !grade.metricId.startsWith("walk_")), "등급은 직선거리 지표만 사용");
  assert.deepEqual(t.provenance.sources.map((s) => s.sourceId), ["bus_stop", "osm_subway", "osm_roads"]);
  assert.doesNotMatch(JSON.stringify(t), /종합|법적 적합|개발 가능|건강 위험 예측/);
  ctx.close();
}

// ── A02 학교 ──
{
  const ctx = (await make({ school: true }))(800);
  const t = a02(ctx);
  assert.equal(t.status, "partial");
  assert.deepEqual([val(t, "nearest_elem_m"), val(t, "nearest_middle_m"), val(t, "nearest_high_m")], [447, 539, 728], "폐교·특수학교 제외");
  assert.deepEqual([val(t, "elem_schools"), val(t, "middle_schools"), val(t, "high_schools")], [1, 1, 1], "반경 밖 e2·폐교 e-closed는 세지 않음");
  assert.equal(metric(t, "in_school_zone").status, "missing");
  assert.ok(t.limitations.some((l) => l.kind === "not_provided" && l.note === "통학구역 도형 미확보 — 배정은 교육청 확인"));
  assert.equal(t.judgment.level, null, "통학구역 없이 등급 없음");
  assert.match(t.judgment.sentence, /최근접 초등학교 직선 447m 확인, 통학구역은 미확인/);
  assert.equal(layers(t, "school_nearest")[0].label, "직선 447m");
  assert.deepEqual([layers(t, "school_middle").length, layers(t, "school_high").length, layers(t, "school_elem").length], [1, 1, 0]);
  assert.equal(toTileView(t).headline.value, "통학구역 미확인");
  noForbidden(t);
  ctx.close();

  // 탐색 1500: 반경 500이면 개수 0이어도 최근접은 나온다
  const c5 = (await make({ school: true }))(500);
  const t5 = a02(c5);
  assert.deepEqual([val(t5, "elem_schools"), val(t5, "nearest_elem_m")], [1, 447]);
  c5.close();

  const none = a02((await make({}))(800));
  assert.equal(none.status, "not_provided", "학교 원천이 없는 버전");
}

// ── A05 K-APT ──
{
  const base = a05((await make({}))(800));
  assert.equal(val(base, "households"), 800, "K-APT 없음: 500 + 세대 수 300");
  assert.ok(!metric(base, "kapt_only_apartments") && !metric(base, "households_from_kapt"));
  assert.match(metric(base, "households").formulaVersion, /a05-households@1/);

  const ctx = (await make({ kapt: true }))(800);
  const t = a05(ctx);
  assert.equal(val(t, "households"), 820, "apt1 500(대장) + apt2 K-APT 320");
  assert.deepEqual([val(t, "households_from_kapt"), val(t, "households_from_units"), val(t, "households_unknown_complexes")], [1, 0, 1]);
  assert.match(metric(t, "households").formulaVersion, /세대수: 대장, 없으면 K-APT/);
  assert.match(metric(t, "households").label, /세대수: 대장, 없으면 K-APT/);
  assert.equal(val(t, "apartment_complexes"), 3, "K-APT 단지는 아파트 단지 수에 섞지 않는다");
  assert.equal(val(t, "kapt_only_apartments"), 1, "k3만(k4는 코드 2, kfar은 반경 밖, k1·k2는 연결됨)");
  assert.ok(t.limitations.some((l) => l.kind === "partial" && l.note.includes("K-APT에만 있는")));
  assert.ok(t.provenance.sources.some((s) => s.sourceId === "kapt"));
  noForbidden(t);
  ctx.close();
}

// ── A10 계획 철도 ──
{
  const absent = a10((await make({ rail: true }))(800));
  assert.deepEqual([absent.status, absent.metrics.length, absent.limitations[0].kind], ["not_provided", 0, "not_provided"]);

  const ctx = (await make({ planned: true }))(800);
  const t = a10(ctx);
  assert.equal(t.status, "partial");
  assert.deepEqual([val(t, "planned_projects"), val(t, "nearest_planned_station_m"), val(t, "nearest_planned_line_m")], [1, 361, 300]);
  assert.equal(metric(t, "stage_1").label, "단계: 공사 중");
  assert.equal(metric(t, "opening_schedule").status, "missing");
  assert.equal(val(t, "review_age_days"), 75, "2026-07-17 → 2026-09-30");
  assert.ok(t.limitations.some((l) => l.kind === "partial" && l.note === "공개 계획 철도 목록이 일부(1건)만 포함"));
  assert.match(t.judgment.sentence, /^위치는 개략 선형: 반경 안 계획·공사 사업 1건\(공사 중 1건\), 최근접 계획역 직선 361m/);
  assert.equal(t.judgment.level, null);
  assert.equal(layers(t, "planned_rail_station")[0].highlight, true);
  assert.ok(layers(t, "planned_rail_line").length > 10);
  noForbidden(t);
  ctx.close();

  // 반경 250: 선형(300m)도 계획역(361m)도 밖 → 0건이지만 “없다”고 단정하지 않는다
  const empty = a10((await make({ planned: true }))(250));
  assert.equal(val(empty, "planned_projects"), 0);
  assert.equal(metric(empty, "nearest_planned_station_m").status, "missing");
  assert.match(empty.judgment.sentence, /목록이 일부 사업만 담고 있어 계획이 없다는 뜻은 아님/);
}
console.log("engine rail/school/kapt/planned ok");
