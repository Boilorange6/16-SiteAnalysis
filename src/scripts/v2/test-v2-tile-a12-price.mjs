import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER, PARCEL_PNUS, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a12ServerModule } = await import("../../lib/v2/tile/a12/server.ts");
const { d08 } = await import("../../lib/v2/tile/a12/d08.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { a12ClientModule } = await import("../../lib/v2/tile/a12/view.ts");

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const forbidden = /도보|\d\s*분|종합/;

function assertZoningLabelContract(tile, prefix = tile.tileCode) {
  const polygons = tile.presentation.polygons ?? [];
  const site = (tile.presentation.features ?? []).find((feature) => feature.layer === "zoning_site");
  assert.ok(polygons.length > 0, `${prefix}: 용도지역 면`);
  assert.ok(polygons.every((polygon) => polygon.label === null), `${prefix}: 새 계약 면은 legacy label을 우회하지 않음`);
  assert.ok(polygons.every((polygon) => typeof polygon.sublabel === "string" && /%$/.test(polygon.sublabel)), `${prefix}: 조각 sublabel은 교차 비율`);
  assert.ok(polygons.every((polygon) => !polygon.sublabel.includes("지역") && !polygon.sublabel.includes("주거") && !polygon.sublabel.includes("상업")), `${prefix}: sublabel에 분류명 반복 없음`);
  assert.ok(polygons.every((polygon) => polygon.name === null || ["제2종일반주거지역", "일반상업지역", "계획관리지역", "자연녹지지역"].includes(polygon.name)), `${prefix}: 면 name은 원천 세분명 또는 null`);
  for (const name of new Set(polygons.map((polygon) => polygon.name).filter(Boolean))) {
    assert.equal(polygons.filter((polygon) => polygon.name === name).length, 1, `${prefix}: ${name} name은 한 조각에만 표시`);
  }
  assert.ok(polygons.every((polygon) => polygon.labelPriority === (polygon.name === null ? 0 : ["제2종일반주거지역", "계획관리지역"].includes(polygon.name) ? 2 : 1)), `${prefix}: 대지 관련 면 2, 그 외 이름 있는 면 1`);
  assert.ok(site, `${prefix}: 대지 표식 유지`);
  assert.ok(site.name === "제2종일반주거지역, 계획관리지역" || site.name === "계획관리지역, 제2종일반주거지역", `${prefix}: 대지 표식은 원천 이름`);
  assert.equal(site.sublabel, null, `${prefix}: 대지 표식 sublabel 없음`);
  assert.equal(site.labelPriority, 2, `${prefix}: 대지 표식 priority 2`);
  assert.equal(site.label, null, `${prefix}: 대지 표식 legacy label 없음`);
}

function clean(tile) {
  parseTileResult(tile);
  assert.doesNotMatch(JSON.stringify(tile), forbidden, `${tile.tileCode}: 금지 표현`);
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), forbidden, `${tile.tileCode}: 화면 문자열 금지 표현`);
  assert.equal(tile.judgment?.level ?? null, null, `${tile.tileCode}: 등급 없음`);
  assert.match(tile.judgment.sentence, / → .+ → /, `${tile.tileCode}: 사실→의미→확인할 것`);
}

async function makeFixture(options, prices = false) {
  const dir = mkdtempSync(join(tmpdir(), "v2-d08-a12-"));
  await buildEngineFixture(dir, "v1", options);
  if (prices) {
    const manifest = M.readManifest(dir);
    const db = new Database(M.resolveDataPath(dir, manifest.files.reference.path));
    const release = insertRelease(db, {
      sourceId: "land_price",
      provider: "테스트",
      sourceUrl: "https://example.invalid/land-price",
      sourceAsOf: "2026-05-26",
      fetchedAt: "2026-09-30T00:00:00Z",
      checksum: "land-price-test",
      licenseCode: "TEST",
    });
    const insert = db.prepare("INSERT INTO land_price (pnu, base_year, base_month, price_krw_per_m2, is_standard) VALUES (?, ?, ?, ?, ?)");
    insert.run(PNU_DASAN_100, 2026, 1, 5_000_000, 0);
    insert.run(PARCEL_PNUS[1], 2026, 1, 4_000_000, 0);
    insert.run(PARCEL_PNUS[2], 2026, 1, 6_000_000, 0);
    assert.equal(release, "land_price@2026-05-26");
    db.close();
  }
  const manifest = M.readManifest(dir);
  return (pnu = PNU_DASAN_100, radiusM = 800) => new EngineContext(
    dir,
    manifest,
    "an-d08-a12",
    { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM, analysisDate: "2026-09-30", pnu },
  );
}

// ── A12 (D08 용도지역 레이어 흡수) ──
{
  const ctx = (await makeFixture({ zoning: "overlap" }))();
  const tile = a12ServerModule.compute(ctx);
  clean(tile);
  assert.equal(tile.tileCode, "A12");
  assert.equal(tile.tileType, "analysis");
  assert.equal(tile.status, "partial", "fixture는 5종 중 2종 용도지역 레이어만 적재");
  assert.equal(tile.metrics.filter((m) => m.id.startsWith("share_class_")).length, 8, "8분류 고정");
  assert.ok(tile.metrics.filter((m) => m.id.startsWith("share_class_")).every((m) => m.status === "observed"), "0도 관측 0");
  assert.doesNotMatch(tile.judgment.sentence, /(?:공업|농림|자연환경보전|기타)\s+0(?:\.0)?%/, "0% 분류는 용도지역 문장에 넣지 않음");
  assert.match(tile.judgment.sentence, /주거|상업|녹지|관리/, "실제 존재하는 분류는 문장에 유지");
  assert.ok(metric(tile, "fill_zoning_pct").value <= 100, "채움률 상한");
  assert.ok(metric(tile, "back_overlap_pct").value > 0, "중첩 초과분");
  assert.ok(tile.metrics.some((m) => m.id.startsWith("raw_")), "원천 세분 지표");
  assert.ok(tile.presentation.polygons.length >= 3, "용도지역 면");
  assert.ok(tile.presentation.features.some((feature) => feature.layer === "zoning_site"), "대지 zoning_site 대표점 유지");
  assertZoningLabelContract(tile);
  assert.ok(!tile.presentation.features.some((feature) => feature.layer.startsWith("zone_center:")), "zone_center 대표점 제거");
  assert.ok(!tile.presentation.layers.some((layer) => layer.startsWith("zone_center:")), "zone_center 레이어 id 제거");
  const absorbed = d08(ctx);
  assert.equal(absorbed.judgment, null, "흡수 D08 judgment는 내보내지 않음");
  assert.equal(absorbed.metrics.filter((metric) => metric.id.startsWith("share_class_")).length, 0, "D08 share_class 중복 지표 제거");
  assert.ok(absorbed.presentation.features.some((feature) => feature.layer === "zoning_site"), "D08도 zoning_site 대표점 유지");
  assertZoningLabelContract(absorbed, "D08");
  assert.ok(!absorbed.presentation.features.some((feature) => feature.layer.startsWith("zone_center:")), "D08 zone_center 대표점 제거");
  const view = toTileView(tile);
  assert.deepEqual(view.layerOptions, [{ id: "all", label: "기본 토지" }], "동일 내용 용도지역 레이어 선택 제거");
  assert.ok(!a12ClientModule.headline.ids.includes("mixed_zone_share_pct"), "죽은 headline id 제거");
  assert.notEqual(view.headlineMetricId, "mixed_zone_share_pct", "죽은 headline 지표는 선택하지 않음");
  assert.equal(tile.judgment.ruleId, "a12-zoning@1", "흡수 D08 judgment는 A12 judgment만 유지");
  assert.doesNotMatch(tile.judgment.sentence, /\s·\s/, "흡수 D08 judgment 문장 중복 제거");
  assert.equal(new Set(tile.metrics.map((m) => m.id)).size, tile.metrics.length, "흡수 지표 id 중복 없음");
  ctx.close();
}

// ── A12: 대상 지가·주변 지가·대상 필지 도형 면적 ──
{
  const ctx = (await makeFixture({ zoning: "overlap", parcels: true }, true))();
  const tile = a12ServerModule.compute(ctx);
  clean(tile);
  assert.equal(metric(tile, "land_price").value, 5_000_000);
  assert.match(metric(tile, "land_price").formulaVersion, /기준연도 2026/);
  assert.equal(metric(tile, "nearby_price_median").value, 5_000_000);
  assert.deepEqual([metric(tile, "nearby_price_median").numerator, metric(tile, "nearby_price_median").denominator], [3, 8]);
  assert.equal(metric(tile, "parcel_area_m2").value, 1_600);
  assert.ok(tile.provenance.sources.some((source) => source.sourceId === "land_price"), "지가 원천 provenance");
  assert.ok(tile.provenance.sources.some((source) => source.sourceId === "parcel_polygon"), "필지 도형 원천 provenance");
  assert.ok(!tile.limitations.some((limitation) => limitation.note.includes("개별공시지가를 적재하지 않아")), "지가 제공 시 stale not_provided 문구 없음");
  ctx.close();
}

// parcels 파일이 없으면 주변 지가와 대상 도형 면적은 예외 없이 missing이어야 한다.
{
  const ctx = (await makeFixture({ zoning: "overlap" }))();
  const tile = a12ServerModule.compute(ctx);
  clean(tile);
  assert.equal(metric(tile, "nearby_price_median").status, "missing");
  assert.match(metric(tile, "nearby_price_median").formulaVersion, /주변 필지 자료 없음/);
  assert.equal(metric(tile, "parcel_area_m2").status, "missing");
  ctx.close();
}

// PNU가 없으면 대상 공시지가의 missing 사유가 행 없음과 구분되어야 한다.
{
  const ctx = (await makeFixture({ zoning: "overlap", parcels: true }, true))(null);
  const tile = a12ServerModule.compute(ctx);
  clean(tile);
  assert.equal(metric(tile, "land_price").status, "missing");
  assert.match(metric(tile, "land_price").formulaVersion, /pnu 없음/);
  ctx.close();
}

console.log("v2 D08/A12 land price: ok");
