import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a09, collectMaintenance } = await import("../../lib/v2/tile/a09/engine.ts");
const { a09ServerModule } = await import("../../lib/v2/tile/a09/server.ts");
const { d23 } = await import("../../lib/v2/tile/a09/d23.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-d23-"));
  await buildEngineFixture(dir, "v1", options);
  if (options.mzoneSource) {
    const manifest = M.readManifest(dir);
    const db = new Database(M.resolveDataPath(dir, manifest.files.reference.path));
    insertRelease(db, {
      sourceId: "mzone_zone",
      provider: "테스트 정비구역",
      sourceUrl: "https://example.invalid/mzone-zone",
      sourceAsOf: "2026-09-09",
      fetchedAt: "2026-09-30T00:00:00Z",
      checksum: "mzone-zone-test",
      licenseCode: "TEST",
    });
    db.close();
  }
  const manifest = M.readManifest(dir);
  return new EngineContext(dir, manifest, "an-d23", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  });
};

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const forbidden = /도보|\d\s*분|종합/;

{
  const zones = [
    { featureId: 1, stableId: "z1", name: "구역 이름", properties: { layer: "zone", announcedDate: "2020-05-01" } },
    { featureId: 2, stableId: "z2", name: "다른 구역", properties: { layer: "zone", announcedDate: "2019-01-02" } },
    { featureId: 3, stableId: "z3", name: "도시환경정비 사업", properties: { layer: "improvement" } },
    { featureId: 4, stableId: "z4", name: null, properties: { layer: "planned", altName: "재건축 예정" } },
    { featureId: 5, stableId: "z5", name: null, properties: { layer: "improvement" } },
    { featureId: 6, stableId: "z6", name: null, properties: { layer: "zone", typeLabel: "정비구역" } },
  ];
  const roster = [{ id: "p1", sido: "11", sigungu: "강남구", name: "명부 사업", type: "재건축", operator: "시행 조합", designatedAt: "2010-01-02", rawStage: "조합설립인가" }];
  const db = { prepare(sql) {
    if (sql.includes("GLOB")) return { all: () => [] };
    if (sql.includes("SELECT 1 FROM feature")) return { get: () => ({}) };
    if (sql.includes("feature_link")) return { pluck: () => ({ get: (id) => ["z1", "z2"].includes(id) ? "p1" : undefined }) };
    if (sql.includes("development_event")) return { all: () => [{ stage: "조합", units: 500 }] };
    if (sql.includes("coverage_json")) return { pluck: () => ({ all: () => [JSON.stringify({ projects: roster })] }) };
    throw new Error(sql);
  } };
  const ctx = { db: () => db, sources: () => [], hits: () => zones, sigungu: () => [] };
  const result = collectMaintenance(ctx);
  const linked = result.projects.get("p1");
  assert.deepEqual([linked.name, linked.type, linked.operator, linked.designatedAt, linked.rawStage, linked.announcedDate, linked.linked], ["명부 사업", "재건축", "시행 조합", "2010-01-02", "조합설립인가", "2019-01-02", true]);
  assert.deepEqual(["z3", "z4", "z5", "z6"].map((key) => result.projects.get(key).type), ["재개발", "재건축", "주거환경개선", "종류 미확인"]);
}

{
  const ctx = await make({ maint: "zones", mzoneSource: true });
  const collected = collectMaintenance(ctx);
  assert.ok(collected, "정비구역 수집 결과");
  assert.equal(collected.zones.length, 2, "반경과 교차하는 구역만 수집");
  assert.equal(collected.projects.size, 2, "연결된 사업은 구역 단위로 한 번만 집계");

  const base = a09(ctx);
  parseTileResult(base);
  assert.equal(base.presentation.features, undefined, "A09 기본 엔진은 D23에 중복 점을 내지 않음");
  assert.equal(base.presentation.polygons, undefined, "A09 기본 엔진은 D23에 중복 면을 내지 않음");
  assert.ok(base.provenance.sources.some((source) => source.sourceId === "mzone_zone"), "실제 mzone_* 원천 provenance");

  const tile = a09ServerModule.compute(ctx);
  parseTileResult(tile);
  assert.equal(tile.status, "partial");
  assert.equal(tile.tileCode, "A09");
  assert.equal(tile.tileType, "analysis");
  assert.equal(value(tile, "stage_2"), 1, "조합 단계 사업");
  assert.equal(value(tile, "stage_0"), 1, "구역지정 단계 사업");
  const stages = tile.metrics.filter((m) => m.label.startsWith("단계: "));
  assert.equal(new Set(stages.map((m) => m.label)).size, stages.length);
  assert.ok(stages.every((m) => m.value > 0));
  assert.ok(!tile.metrics.some((m) => m.id.startsWith("back_stage_")));
  assert.equal(value(d23(ctx), "back_stage_7"), 0, "D23 단독 단계 지표는 유지");
  assert.equal(value(tile, "fill_boundary_pct"), 66.7, "경계 사업 2 / 반경 시군구 명부 3");
  assert.equal(value(tile, "fill_stage_pct"), 100, "두 사업의 단계가 모두 확인됨");
  assert.equal(value(tile, "zone_area_in_radius_m2"), 80000, "교차 정비구역 면적 합");
  assert.equal(value(tile, "planned_households"), 1300, "A09와 동일한 예정 세대 합");
  const polygons = tile.presentation.polygons ?? [];
  const features = tile.presentation.features ?? [];
  assert.ok(polygons.length >= 2);
  assert.ok(polygons.every((p) => p.layer.startsWith("maint_stage:")), "기본 도형은 D23 반경 절단 단계 면");
  assert.ok(!polygons.some((p) => p.layer === "maint_zone"), "A09 원본 면 중복 없음");
  assert.ok(polygons.some((p) => p.layer === "maint_stage:조합"));
  assert.ok(!features.some((f) => f.layer === "maint_zone_center"), "A09 원본 대표점 중복 없음");
  assert.ok(polygons.every((p) => p.label === null), "새 계약 면은 긴 legacy label을 우회하지 않음");
  assert.ok(polygons.every((p) => p.name === "다산1구역" || p.name === "다산2구역"), "단계 면 name은 원천 구역명");
  assert.equal(polygons.filter((p) => p.name === "다산1구역").length, 1, "같은 구역명은 한 조각에만 name");
  assert.ok(polygons.every((p) => / · (조합|구역지정)$/.test(p.sublabel)), "단계 면 sublabel은 종류와 단계");
  assert.ok(polygons.every((p) => p.labelPriority === 1), "정비구역 면은 주요 면 자동 라벨 우선순위 1");
  assert.ok(!polygons.some((p) => features.some((f) => f.fid === p.fid)), "면이 있는 정비구역의 같은 fid 대표점 제거");
  assert.ok(features.every((f) => f.label === null && f.name !== null && f.sublabel !== null && [0, 1, 2].includes(f.labelPriority)), "fallback 점도 새 라벨 계약을 지킴");
  assert.ok(tile.presentation.layers.includes("maint_stage:조합"));
  assert.ok(tile.presentation.layers.includes("maint_stage:구역지정"));
  assert.ok(tile.provenance.sources.some((source) => source.sourceId === "mzone_zone"), "흡수된 A09 결과에도 mzone_* provenance");
  assert.match(tile.judgment.sentence, / → .+ → /);
  assert.equal(tile.judgment.level, null);
  assert.doesNotMatch(JSON.stringify(tile), forbidden);
  ctx.close();
}

{
  const ctx = await make({ maint: "roster" });
  const tile = a09ServerModule.compute(ctx);
  parseTileResult(tile);
  assert.equal(tile.status, "partial", "명부만 있어도 자료 없음이 아니라 부분 결과");
  assert.equal(value(tile, "planned_households"), 1500);
  assert.equal(value(tile, "stage_0"), 1);
  assert.equal(value(tile, "stage_2"), 1);
  assert.equal(tile.presentation.features, undefined, "경계 없는 명부는 지도에 그리지 않음");
  assert.equal(tile.presentation.polygons, undefined, "경계 없는 명부는 면을 그리지 않음");
  assert.match(tile.limitations.map((l) => l.note).join("\n"), /경계 (없음|미확보)/);
    assert.match(tile.judgment.sentence, /경계가 없어 반경 안에 있는지는 확인되지 않은/);
  assert.doesNotMatch(JSON.stringify(tile), forbidden);
  ctx.close();
}

console.log("v2 D23 maintenance tile: ok");
