/** P2 등록: 카탈로그 순서·스텁·뒷면 일반화·레이어 스타일·areaInCircle. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { TILE_CATALOG, TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { LAYER_STYLES, layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { areaInCircle } = await import("../../lib/v2/engine/tiles/geo.ts");
const { ENGINE_VERSION } = await import("../../lib/v2/engine/tiles/common.ts");
const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");

// 1) 카탈로그: P2 코드가 모두 있고 순서가 A → D(코드순) → S 이다
const P2 = ["D01","D02","D03","D04","D05","D10","D11","D12","D13","D15","D16","D17","D18","D19","D22","D28","D29","S01","S02","S03","S04"];
for (const c of P2) assert.ok(TILE_CATALOG[c], `catalog ${c}`);
assert.deepEqual(TILE_CODES.filter((c) => c.startsWith("D") || c.startsWith("S")), P2);
for (const c of P2) assert.equal(TILE_CATALOG[c].kind, c.startsWith("D") ? "diagram" : "simulation");
assert.equal(ENGINE_VERSION, "v2-p4-ext-1");

// 2) 엔진: 모든 카탈로그 코드가 결과에 있고, 아직 미제공인 스텁은 not_provided
const dataDir = mkdtempSync(join(tmpdir(), "v2-p2-reg-"));
await buildEngineFixture(dataDir, "v1");
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-p2-reg-app-")), "app.sqlite"));
const run = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
assert.equal(run.ok, true);
assert.deepEqual(run.results.map((r) => r.tileCode), TILE_CODES, "결과 순서 = 카탈로그 순서");
for (const c of ["D02", "D19", "S01"]) {
  const t = run.results.find((r) => r.tileCode === c);
  assert.equal(t.status, "not_provided");
  assert.equal(t.tileType, c.startsWith("S") ? "simulation" : "diagram");
}
appDb.close();

// 3) 레이어 스타일: 계획의 id가 모두 정의돼 있다(타일 작업이 그대로 쓴다)
const ids = ["bldg_footprint","bldg_point","use:주거","use:미상","floors_1_4","floors_26p","floors_unknown","tall_ge35","tall_ge35_est","tall_unknown","low_le12","low_le12_est","green_zone","green_parcel","water_parcel","district:기타","facility:교통","road:고속도로","road:간선","road:보조간선","road:집산","road:국지","road:보행·자전거","road:기타","parcel","parcel_site","lot_lt100","lot_ge3000","lot_road_water","maint_stage:구역지정","maint_stage:미확인","pop_dens_0","pop_dens_5"];
for (const id of ids) assert.ok(LAYER_STYLES[id], `layer ${id}`);
assert.ok(layerStyle("tall_ge35_est").label.startsWith("[추정]"));

// 4) 뒷면 일반화: diagram 타일은 hasFace, share_/back_ 지표가 차트(단위 포함), 지물이 있으면 지도
const base = { analysisId: "x", status: "complete", engineVersion: "t", conditions: { address: "a", center: [127.15, 37.62], radiusM: 800, analysisDate: "2026-09-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null }, judgment: null, provenance: { manifestHash: "a".repeat(64), sources: [{ sourceId: "building", releaseId: "building@2026-09-09", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z" }] }, limitations: [] };
const m = (id, label, value, unit) => ({ id, label, value, unit, formulaVersion: "t@1", numerator: null, denominator: null, status: "observed" });
const d = { ...base, tileId: "x-D19", tileType: "diagram", tileCode: "D19", metrics: [m("parcels", "교차 필지", 12, "필지"), m("share_lot_1", "100㎡ 미만", 25, "%"), m("back_count_1", "필지 수", 3, "필지")], presentation: { legend: [], camera: null, layers: ["parcel"], outputFace: "front", polygons: [{ layer: "parcel", rings: [[[127.15, 37.62], [127.151, 37.62], [127.151, 37.621], [127.15, 37.62]]] }], polygonsTotal: 1 } };
const v = toTileView(d);
assert.equal(v.hasFace, true);
assert.deepEqual(v.chart, [{ label: "100㎡ 미만", value: 25, unit: "%" }, { label: "필지 수", value: 3, unit: "필지" }]);
assert.ok(v.map, "면 지물만 있어도 지도(polygons 전달은 Task 2가 검증)");
const a = { ...base, tileId: "x-A12", tileType: "analysis", tileCode: "A12", metrics: [m("share_class_1", "구성비: 주거", 40, "%")], presentation: { legend: [], camera: null, layers: [], outputFace: "front" } };
assert.equal(toTileView(a).hasFace, true, "레이어를 가진 분석 타일은 지도 면을 제공");
assert.equal(toTileView(a).layerOptions.length, 1, "A12는 바꿔도 화면이 같은 레이어 선택을 두지 않는다(계획 1-2)");

// 5) areaInCircle: 완전 포함은 절단 없이 전체 면적, 걸침은 교차 면적, 밖은 0
const [cx, cy] = toUtmk(CENTER);
const at = (x, y) => toLngLat([cx + x, cy + y]);
const rect = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]] });
const inside = areaInCircle(CENTER, 800, rect(0, 100, 0, 100));
assert.equal(inside.clipped, false);
assert.ok(Math.abs(inside.areaM2 - 10000) < 1);
const edge = areaInCircle(CENTER, 800, rect(700, 900, -50, 50));
assert.equal(edge.clipped, true);
assert.ok(edge.areaM2 > 9000 && edge.areaM2 < 10100, `edge ${edge.areaM2}`); // 700~800 구간 ≈ 100×100
assert.equal(areaInCircle(CENTER, 800, rect(2000, 2100, 0, 100)).areaM2, 0);
console.log("✓ v2 P2 registry");
