import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a08, collectRents, MIN_PAIRED } = await import("../../lib/v2/tile/a08/engine.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => tile.metrics.find((item) => item.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

const make = async (options, radiusM = 500, analysisDate = "2026-09-30") => {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-a08-"));
  await buildEngineFixture(dataDir, "v1", options);
  const core = new Database(join(dataDir, "versions", "v1", "core.sqlite"));
  const nameRelease = insertRelease(core, {
    sourceId: "housing_name_test",
    provider: "테스트",
    sourceUrl: "https://example.invalid",
    sourceAsOf: "2026-09-30",
    fetchedAt: "2026-09-30T00:00:00Z",
    checksum: "x",
    licenseCode: "TEST",
  });
  insertFeature(core, { stableId: "housing:rent-a", kind: "housing_complex", sourceKey: "rent-a", releaseId: nameRelease, geometry: { type: "Point", coordinates: CENTER }, pnu: "4136011800100010000", name: "다산 센트럴" });
  insertFeature(core, { stableId: "housing:rent-b", kind: "housing_complex", sourceKey: "rent-b", releaseId: nameRelease, geometry: { type: "Point", coordinates: CENTER }, pnu: "4136011800100020000", name: "다산 리버" });
  core.close();
  const manifest = M.readManifest(dataDir);
  return new EngineContext(dataDir, manifest, "a08-test", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM,
    analysisDate,
  });
};

const clean = (tile) => {
  parseTileResult(tile);
  assert.match(tile.judgment?.sentence ?? "", / → .+ → /, "사실→의미→확인할 것");
  assert.equal(tile.judgment?.level ?? null, null, "A08 등급 없음");
  const view = toTileView(tile);
  assert.doesNotMatch(JSON.stringify(view), /안전|위험|환산율/, "A08 판단 문구가 위험·환산율로 확장되지 않음");
};

assert.equal(MIN_PAIRED, 3);

// 최근 12개월·반경 내 아파트 임대차와 동일 PNU 매매의 대응 전세가율.
{
  const ctx = await make({ trades: true, rents: true });
  const collected = collectRents(ctx);
  assert.equal(collected, collectRents(ctx), "임대차 집계는 분석 내 memo를 사용");
  assert.equal(collected.hasRenewal, true);
  const columns = ctx.db("market").prepare("PRAGMA table_info(property_transaction)").all();
  assert.ok(columns.some((column) => column.name === "renewal"), "renewal 열 확인");

  const started = performance.now();
  const tile = a08(ctx);
  const elapsedMs = performance.now() - started;
  clean(tile);
  assert.equal(tile.status, "partial", "위치 미확인 임대차가 있으면 부분 결과");
  assert.equal(value(tile, "jeonse_count"), 8, "A 6 + B 2, 반경 밖 C 제외");
  assert.equal(value(tile, "monthly_count"), 4);
  assert.equal(value(tile, "new_count"), 4);
  assert.equal(value(tile, "renewal_count"), 2);
  near(value(tile, "jeonse_deposit_per_m2"), 535.7, 0.1, "전세 보증금 단가 중앙값");
  near(value(tile, "jeonse_q1_per_m2"), 410.7, 0.2, "전세 보증금 단가 25% 경계");
  near(value(tile, "jeonse_q3_per_m2"), 574.4, 0.2, "전세 보증금 단가 75% 경계");
  assert.equal(metric(tile, "jeonse_q3_per_m2").label, "전세 보증금 단가 상위 25% 경계");
  assert.equal(value(tile, "monthly_rent_median"), 95, "월세 중앙값");
  assert.equal(value(tile, "monthly_deposit_median"), 10000, "월세 보증금 중앙값");
  near(value(tile, "jeonse_to_trade_ratio_pct"), 55.7, 0.1, "A 단지 대응 전세가율");
  assert.equal(metric(tile, "jeonse_to_trade_ratio_pct").numerator, 1, "대응 단지 수");
  assert.equal(value(tile, "latest_rent_days"), 57);
  assert.equal(value(tile, "cancelled_rents"), 0, "반경 밖 취소 거래 제외");
  assert.equal(tile.metrics.some((item) => /환산|pyeong|conversion/i.test(item.id)), false, "월세 환산 지표 없음");

  const features = tile.presentation.features;
  assert.equal(features.length, 2, "같은 PNU의 전세·월세를 한 점으로 합친다");
  assert.deepEqual([...new Set(features.map((feature) => feature.layer))], ["rent_jeonse"], "혼합 점은 전세 우선 레이어로 한 번만 표시");
  assert.deepEqual(features.map((feature) => feature.weight).sort((a, b) => a - b), [6, 6], "점 크기는 PNU 전체 계약 건수");
  const named = features.find((feature) => feature.name === "다산 센트럴");
  const mixed = features.find((feature) => feature.name === "다산 리버");
  assert.deepEqual([named?.name, named?.sublabel, named?.labelPriority], ["다산 센트럴", "전세 560만원/㎡ · 6건", 1], "A08 전세 점은 단지명·전세 단가·건수를 낸다");
  assert.deepEqual([mixed?.name, mixed?.sublabel, mixed?.labelPriority], ["다산 리버", "전세 131만원/㎡ · 2건", 1], "A08 혼합 PNU도 한 점의 주 계약군 값을 보존한다");
  assert.deepEqual(mixed?.badges, [{ text: "전세", color: "#2B6CB0" }, { text: "월세", color: "#63B3ED" }], "A08 혼합 PNU의 두 계약군은 문자·색 배지로도 구분한다");
  assert.ok(features.every((feature) => !Object.hasOwn(feature, "label")), "A08는 옛 label을 내지 않는다");
  assert.ok(tile.presentation.layers.includes("rent_jeonse") && tile.presentation.layers.includes("rent_monthly"));
  assert.deepEqual(tile.provenance.sources.map((source) => source.sourceId).sort(), ["rtms_apt_rent", "rtms_apt_trade"]);
  assert.ok(elapsedMs < 1500, `A08 합성 타일 성능 ${elapsedMs.toFixed(1)}ms`);
  ctx.close();
}

// renewal 열이 없는 옛 market 파일도 임대차 지표는 계산하고 신규·갱신만 missing으로 남긴다.
{
  const ctx = await make({ rents: "nocolumn" });
  const collected = collectRents(ctx);
  assert.equal(collected.hasRenewal, false);
  const tile = a08(ctx);
  clean(tile);
  assert.equal(metric(tile, "new_count").status, "missing");
  assert.equal(metric(tile, "renewal_count").status, "missing");
  assert.equal(value(tile, "jeonse_count"), 8);
  assert.equal(value(tile, "monthly_count"), 4);
  assert.match(tile.judgment.sentence, /신규·갱신 구분 자료가 없어/);
  assert.equal(tile.provenance.sources.length, 1);
  ctx.close();
}

// 원천은 있지만 반경 안 계약이 없는 경우도 빈 결과를 사실대로 설명한다.
{
  const ctx = await make({ rents: true }, 50);
  const tile = a08(ctx);
  clean(tile);
  assert.match(tile.judgment.sentence, /반경 안에 위치가 확인된 전월세 계약 없음/);
  assert.match(tile.judgment.sentence, /신규·갱신 구분 가능/);
  ctx.close();
}

// 임대차 원천이 게시되지 않은 옛 버전은 계산 결과로 가장하지 않는다.
{
  const ctx = await make({});
  const tile = a08(ctx);
  assert.equal(tile.status, "not_provided");
  assert.equal(tile.metrics.length, 0);
  ctx.close();
}

console.log("v2 A08 rent tile: ok");
