import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { openV2AppDb, loadScene } = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { parseScene } = await import("../../lib/v2/scene.ts");
const { DEFAULT_RAIL_COLOR } = await import("../../lib/v2/tile/rail-presentation.ts");

const input = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-10-27" };
const appDb = openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-scene-basemap-app-")), "app.sqlite"));

try {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-scene-basemap-"));
  await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true, roads: true, landuse: true, rail: true, basemap: true });
  const outcome = runAnalysis(appDb, dataDir, input);
  assert.equal(outcome.ok, true);
  const scene = loadScene(appDb, outcome.analysisId);
  assert.ok(scene?.context);
  const c = scene.context;

  // 도로 이름
  assert.ok(c.roads.find((road) => road.name === "도곡로77길"), "이름 있는 도로는 이름을 보존한다");
  assert.ok(c.roads.some((road) => road.name === null), "이름 없는 도로는 name === null");

  // 녹지 분류
  assert.ok(c.greenKinds, "greenKinds 필드가 있다");
  assert.equal(c.greenKinds.length, c.green.length, "greenKinds는 green과 같은 길이");
  assert.ok(c.greenKinds.includes("forest") && c.greenKinds.includes("park"));

  // 철도
  assert.ok(c.rail && c.rail.length > 0);
  const line3 = c.rail.find((r) => r.lineRef === "3");
  assert.ok(line3);
  assert.equal(line3.color, "#ED6C00");
  assert.equal(line3.name, "수도권 전철 3호선: 대화 → 오금");
  assert.ok(c.rail.flatMap((r) => r.points).every(([x, y]) => Math.hypot(x, y) <= 801), "철도는 반경 안으로 자른다");

  // 역
  assert.ok(c.stations && c.stations.length > 0);
  const daechi = c.stations.find((s) => s.name === "대치");
  assert.ok(daechi);
  assert.equal(daechi.color, "#ED6C00");
  assert.ok(Math.abs(daechi.x + 150) < 1 && Math.abs(daechi.y + 100) < 1, `역 좌표 ${daechi.x},${daechi.y}`);
  assert.equal(c.stations.find((s) => s.name === "나래역")?.color, DEFAULT_RAIL_COLOR, "색 자료 없으면 A01과 같은 기본 회색");

  // 지명
  assert.ok(c.places);
  const dong = c.places.filter((p) => p.kind === "dong");
  assert.equal(dong.length, 1);
  assert.equal(dong[0].name, "다산동");
  assert.ok(Math.hypot(dong[0].x, dong[0].y) <= 800);
  const parks = c.places.filter((p) => p.kind === "park");
  assert.ok(parks.some((p) => p.name === "p1" && Math.abs(p.x - 300) < 1), "공원 점 지명");

  // 원천
  for (const id of ["osm_subway", "park", "legal_areas"]) {
    assert.ok(scene.sources.some((s) => s.sourceId === id), `scene.sources에 ${id}`);
  }

  // 직렬화·하위 호환
  parseScene(JSON.parse(JSON.stringify(scene)));
  const legacy = JSON.parse(JSON.stringify(scene));
  for (const road of legacy.context.roads) delete road.name;
  for (const key of ["greenKinds", "rail", "stations", "places"]) delete legacy.context[key];
  const parsed = parseScene(legacy);
  assert.equal(parsed.context.rail, undefined);
  assert.equal(parsed.context.roads[0].name, undefined);

  // 원천이 없으면 필드를 넣지 않는다(빈 배열 아님).
  const plainDir = mkdtempSync(join(tmpdir(), "v2-scene-basemap-plain-"));
  await buildEngineFixture(plainDir, "v1", { buildings: true, parcels: true, roads: true, landuse: true });
  const plain = loadScene(appDb, runAnalysis(appDb, plainDir, { ...input, analysisDate: "2026-10-26" }).analysisId);
  assert.ok(plain?.context);
  for (const key of ["rail", "stations"]) assert.equal(plain.context[key], undefined, `${key}: 원천 없으면 필드 없음`);
  assert.equal(plain.context.places?.some((p) => p.kind === "dong") ?? false, false, "법정구역 면이 없으면 동 지명 없음");
} finally {
  appDb.close();
}

console.log("✓ v2 scene basemap context");
