import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a07, collectTrades } = await import("../../lib/v2/tile/a07/engine.ts");
const { a08, collectRents } = await import("../../lib/v2/tile/a08/engine.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { restoreBoardState } = await import("../../lib/v2/ui/board-state.ts");
const { filterMapForLayer } = await import("../../lib/v2/ui/tile-layers.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { formatKoreanWon } = await import("../../lib/v2/tile/a07/district.ts");

const polygon = (x0, x1, y0, y1) => ({
  type: "Polygon",
  coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]],
});

async function make() {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-trade-modes-"));
  await buildEngineFixture(dataDir, "v1", { trades: true, rents: true });
  const core = new Database(join(dataDir, "versions", "v1", "core.sqlite"));
  const release = core.prepare("SELECT release_id FROM source_release WHERE source_id = 'legal_areas' LIMIT 1").get();
  assert.ok(release?.release_id, "법정구역 fixture release");

  // W3 MultiPolygon clip 회귀와 분리한다. 이 테스트의 행정구역 fixture는 의도적으로 단일 Polygon만 쓴다.
  insertFeature(core, {
    stableId: "legal-emd:4136011800",
    kind: "legal_emd",
    sourceKey: "4136011800",
    releaseId: release.release_id,
    geometry: polygon(-450, 2200, -400, 400),
    name: "다산동",
    legalCode: "4136011800",
  });
  insertFeature(core, {
    stableId: "legal-emd:1171010100",
    kind: "legal_emd",
    sourceKey: "1171010100",
    releaseId: release.release_id,
    geometry: polygon(450, 850, -300, 300),
    name: "문정동",
    legalCode: "1171010100",
  });
  const nameRelease = core.prepare("SELECT release_id FROM source_release WHERE source_id = 'ledger_recap' LIMIT 1").get();
  assert.ok(nameRelease?.release_id, "단지명 fixture release");
  insertFeature(core, {
    stableId: "housing:trade-modes-a",
    kind: "housing_complex",
    sourceKey: "trade-modes-a",
    releaseId: nameRelease.release_id,
    geometry: { type: "Point", coordinates: CENTER },
    pnu: "4136011800100010000",
    name: "다산 센트럴",
  });
  core.close();

  return new EngineContext(dataDir, M.readManifest(dataDir), "trade-modes-test", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
  });
}

function polygonsOf(tile, prefix = "") {
  return (tile.presentation.polygons ?? []).filter((polygon_) => polygon_.layer.startsWith(prefix));
}

function assertPolygonContract(tile) {
  const polygons = tile.presentation.polygons ?? [];
  assert.ok(polygons.length > 0, "법정동 Polygon이 있어야 한다");
  assert.ok(polygons.length <= 3000, "법정동 면 상한 3,000");
  for (const polygon_ of polygons) {
    for (const ring of polygon_.rings) assert.ok(ring.length <= 200, "고리 단순화 상한 200점");
  }
}

function near(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
}

// A07: 법정동 평균은 반경 밖 FAR 거래도 같은 법정동이면 포함하고, 최근 3건은 한국식 금액을 낸다.
{
  const ctx = await make();
  const trades = collectTrades(ctx);
  assert.ok(trades);
  const dasanMetric = trades.districtMetrics.get("41360118");
  assert.equal(dasanMetric?.count, 32, "다산동 평균은 반경 밖 FAR 5건을 포함한 유효 단가 32건");
  near(dasanMetric?.value, 1372.5, 1e-9, "다산동 전체 12개월 ㎡당 평균");
  assert.equal(trades.districtMetrics.get("11710101")?.count, 1);

  const tile = parseTileResult(a07(ctx));
  assertPolygonContract(tile);
  const dasan = polygonsOf(tile, "trade_district_").find((polygon_) => polygon_.fid?.startsWith("41360118:"));
  const munjeong = polygonsOf(tile, "trade_district_").find((polygon_) => polygon_.fid?.startsWith("11710101:"));
  assert.equal(dasan?.layer, "trade_district_q3", "유효 법정동은 동일 값일 때 3단계");
  assert.match(dasan?.sublabel ?? "", /평균 1,373만원\/㎡ · 32건/);
  assert.equal(munjeong?.layer, "trade_district_missing", "3건 미만 법정동은 자료 부족 레이어");
  assert.equal(munjeong?.sublabel, "자료 부족 · 1건");
  assert.ok(tile.presentation.legend.some((entry) => entry.label === "법정동 자료 부족"));

  const point = tile.presentation.features?.find((feature) => feature.name === "다산 센트럴");
  assert.match(point?.sublabel ?? "", /최근 .*11억 1,000만원 · 전용 100㎡ · 5층 · 2026년 5월/);
  assert.equal((point?.sublabel?.match(/2026년/g) ?? []).length, 3, "A07 건물 모드 최근 거래는 최대 3건");
  assert.equal(formatKoreanWon(1_110_000_000), "11억 1,000만원");

  const view = toTileView(tile);
  assert.deepEqual(view.layerOptions, [{ id: "all", label: "건물" }, { id: "district", label: "행정구역" }]);
  assert.equal(viewWithLayer(view, "all").map.polygons?.length, 0, "A07 건물 모드에서 행정구역 면을 숨긴다");
  assert.equal(viewWithLayer(view, "district").map.features.length, 0, "A07 행정구역 모드에서 건물 점을 숨긴다");
  assert.ok((viewWithLayer(view, "district").map.polygons?.length ?? 0) > 0);
  assert.equal(layerStyle("trade_district_missing").hatch, true, "자료 부족은 회색 빗금으로 색 외 구분");
  ctx.close();
}

// A08: 전세·월세 법정동 평균을 별도 모드로 제공하고, 각각의 표본 부족 면을 회색으로 표시한다.
{
  const ctx = await make();
  const rents = collectRents(ctx);
  assert.ok(rents);
  const dasanJeonse = rents.districtJeonseMetrics.get("41360118");
  const dasanMonthly = rents.districtMonthlyMetrics.get("41360118");
  assert.equal(dasanJeonse?.count, 8, "전세 평균은 다산동 전체 8건");
  near(dasanJeonse?.value, 301_000 / 8 / 84, 1e-9, "전세 법정동 ㎡당 평균");
  assert.equal(dasanMonthly?.count, 4, "월세 평균은 다산동 전체 4건");
  near(dasanMonthly?.value, 97.5, 1e-9, "월세 법정동 평균");
  assert.equal(rents.districtJeonseMetrics.get("11710101")?.count, 2, "문정동 전세는 취소 제외 2건");

  const tile = parseTileResult(a08(ctx));
  assertPolygonContract(tile);
  const jeonsePolygons = polygonsOf(tile, "rent_district_jeonse_");
  const monthlyPolygons = polygonsOf(tile, "rent_district_monthly_");
  const dasanJeonsePolygon = jeonsePolygons.find((polygon_) => polygon_.fid?.startsWith("41360118:"));
  const dasanMonthlyPolygon = monthlyPolygons.find((polygon_) => polygon_.fid?.startsWith("41360118:"));
  const munjeongJeonsePolygon = jeonsePolygons.find((polygon_) => polygon_.fid?.startsWith("11710101:"));
  assert.equal(dasanJeonsePolygon?.layer, "rent_district_jeonse_q3");
  assert.match(dasanJeonsePolygon?.sublabel ?? "", /평균 447\.9만원\/㎡ · 8건/);
  assert.equal(dasanMonthlyPolygon?.layer, "rent_district_monthly_q3");
  assert.equal(dasanMonthlyPolygon?.sublabel, "평균 97.5만원\/월 · 4건");
  assert.equal(munjeongJeonsePolygon?.layer, "rent_district_jeonse_missing");
  assert.equal(munjeongJeonsePolygon?.sublabel, "자료 부족 · 2건");
  assert.ok(tile.presentation.legend.some((entry) => entry.label === "전세 ㎡당 하위 20%"));
  assert.ok(tile.presentation.legend.some((entry) => entry.label === "월세 상위 20%"));
  assert.ok(tile.presentation.legend.some((entry) => entry.label === "전세 법정동 자료 부족"));
  assert.ok(tile.presentation.legend.some((entry) => entry.label === "월세 법정동 자료 부족"));

  const point = tile.presentation.features?.find((feature) => feature.name === "다산 센트럴");
  assert.match(point?.layer ?? "", /^rent_jeonse_q[1-5]$/, "A08 전세 점은 ㎡당 보증금 분위 레이어");
  assert.match(point?.sublabel ?? "", /최근 전세 5억원 · 전용 84㎡ · 4층 · 2026년 6월/);
  assert.equal((point?.sublabel?.match(/2026년/g) ?? []).length, 3, "A08 건물 모드 최근 계약은 최대 3건");
  const monthlyPoint = tile.presentation.features?.find((feature) => feature.layer.startsWith("rent_monthly_"));
  assert.match(monthlyPoint?.sublabel ?? "", /^월세 중앙값 95만원 · 최근 보증금 .* · 월세 /, "A08 월세 점 최근 3건은 월세만 포함");
  assert.equal((monthlyPoint?.sublabel?.match(/2026년/g) ?? []).length, 3, "A08 월세 점 최근 계약은 최대 3건");
  assert.doesNotMatch(point?.sublabel ?? "", /월세/, "A08 전세 점 최근 3건은 전세만 포함");
  assert.ok(tile.presentation.features?.every((feature) => !Object.hasOwn(feature, "badges")), "A08 건물 점에는 배지가 없다");
  assert.ok((point?.weight ?? 0) > (monthlyPoint?.weight ?? 0), "A08 가격이 높은 점의 weight가 더 크다");

  const view = toTileView(tile);
  assert.deepEqual(view.layerOptions, [
    { id: "building_jeonse", label: "건물-전세" },
    { id: "building_monthly", label: "건물-월세" },
    { id: "district_jeonse", label: "행정구역-전세" },
    { id: "district_monthly", label: "행정구역-월세" },
  ]);
  assert.equal(view.defaultLayer, "building_jeonse", "A08 기본 모드는 건물-전세");
  assert.equal(viewWithLayer(view, "all").defaultLayer, "building_jeonse", "A08 legacy all은 건물-전세로 매핑");
  const jeonseView = viewWithLayer(view, "building_jeonse");
  assert.ok(jeonseView.map.features.length > 0, "A08 건물-전세 feature가 있어야 한다");
  assert.ok(jeonseView.map.features.every((feature) => feature.layer.startsWith("rent_jeonse_")));
  assert.equal(jeonseView.map.polygons?.length, 0, "A08 건물-전세 모드에서 행정구역 면을 숨긴다");
  assert.ok(jeonseView.map.legend?.every((entry) => entry.label.startsWith("전세")), "A08 건물-전세 범례는 전세 구간만 보인다");
  const monthlyView = viewWithLayer(view, "building_monthly");
  assert.ok(monthlyView.map.features.length > 0, "A08 건물-월세 feature가 있어야 한다");
  assert.ok(monthlyView.map.features.every((feature) => feature.layer.startsWith("rent_monthly_")));
  assert.equal(monthlyView.map.polygons?.length, 0, "A08 건물-월세 모드에서 행정구역 면을 숨긴다");
  assert.ok(monthlyView.map.legend?.every((entry) => entry.label.startsWith("월세")), "A08 건물-월세 범례는 월세 구간만 보인다");
  const districtJeonseView = viewWithLayer(view, "district_jeonse");
  assert.equal(districtJeonseView.map.features.length, 0, "A08 행정구역-전세 모드에서 건물 점을 숨긴다");
  assert.ok((districtJeonseView.map.polygons?.length ?? 0) > 0, "A08 행정구역-전세 polygon이 있어야 한다");
  assert.ok(districtJeonseView.map.polygons?.every((polygon_) => polygon_.layer.startsWith("rent_district_jeonse_")));
  assert.ok(districtJeonseView.map.legend?.every((entry) => entry.label.startsWith("전세 법정동")), "A08 행정구역-전세 범례는 전세 면 구간만 보인다");
  const districtMonthlyView = viewWithLayer(view, "district_monthly");
  assert.equal(districtMonthlyView.map.features.length, 0, "A08 행정구역-월세 모드에서 건물 점을 숨긴다");
  assert.ok((districtMonthlyView.map.polygons?.length ?? 0) > 0, "A08 행정구역-월세 polygon이 있어야 한다");
  assert.ok(districtMonthlyView.map.polygons?.every((polygon_) => polygon_.layer.startsWith("rent_district_monthly_")));
  assert.ok(districtMonthlyView.map.legend?.every((entry) => entry.label.startsWith("월세 법정동")), "A08 행정구역-월세 범례는 월세 면 구간만 보인다");
  const legacyAll = filterMapForLayer(tile.presentation, "A08", "all");
  assert.ok(legacyAll?.features.every((feature) => feature.layer.startsWith("rent_jeonse_")), "A08 legacy all은 건물-전세로 정규화");
  assert.equal(legacyAll?.polygons?.length, 0, "A08 legacy all은 행정구역 면을 숨긴다");
  assert.ok(legacyAll?.legend?.every((entry) => entry.label.startsWith("전세")), "A08 legacy all 범례도 전세만 보인다");
  const restored = restoreBoardState([tile], {
    version: 3,
    order: [tile.tileId],
    layers: { [tile.tileId]: "all" },
  });
  assert.equal(restored.layers[tile.tileId], "building_jeonse", "저장된 A08 all은 건물-전세로 복원");
  assert.equal(layerStyle("rent_district_jeonse_missing").hatch, true);

  // W2 이전 저장 결과의 정확한 구형 점 레이어는 새 suffix 필터와도 호환한다.
  const legacyJeonse = tile.presentation.features?.find((feature) => feature.layer.startsWith("rent_jeonse_"));
  const legacyMonthly = tile.presentation.features?.find((feature) => feature.layer.startsWith("rent_monthly_"));
  assert.ok(legacyJeonse && legacyMonthly, "구형 레이어 회귀 fixture의 양 계약군 점");
  const legacyTile = parseTileResult({
    ...tile,
    tileId: `${tile.tileId}-legacy`,
    presentation: {
      ...tile.presentation,
      layers: ["rent_jeonse", "rent_monthly"],
      features: [
        { ...legacyJeonse, layer: "rent_jeonse" },
        { ...legacyMonthly, layer: "rent_monthly" },
      ],
      featuresTotal: 2,
      polygons: [],
      polygonsTotal: 0,
      legend: [
        { label: "전세 거래 지점", min: null, max: null },
        { label: "월세 거래 지점", min: null, max: null },
      ],
    },
  });
  const legacyView = toTileView(legacyTile);
  const legacyJeonseView = viewWithLayer(legacyView, "building_jeonse");
  const legacyMonthlyView = viewWithLayer(legacyView, "building_monthly");
  assert.equal(legacyJeonseView.map.features.length, 1, "구형 rent_jeonse 레이어를 건물-전세로 표시");
  assert.equal(legacyMonthlyView.map.features.length, 1, "구형 rent_monthly 레이어를 건물-월세로 표시");
  assert.ok(legacyMonthlyView.map.legend?.some((entry) => entry.label === "월세 거래 지점"), "구형 월세 범례를 보존");
  const legacyDistrict = viewWithLayer(legacyView, "district_monthly");
  assert.equal(legacyDistrict.map.polygons?.length, 0, "polygon이 없는 구형 결과의 행정구역 모드");
  assert.equal(legacyDistrict.map.emptyMessage, "구버전 저장 결과에는 행정구역 면이 없습니다. 새 분석에서 갱신해 주세요.");

  // 진짜 0건 모드는 지도 위에서 원인을 구분할 수 있는 빈 상태를 제공한다.
  const zeroMonthlyTile = parseTileResult({
    ...tile,
    tileId: `${tile.tileId}-zero-monthly`,
    presentation: {
      ...tile.presentation,
      features: tile.presentation.features?.filter((feature) => !feature.layer.startsWith("rent_monthly_")),
      polygons: tile.presentation.polygons?.filter((polygon_) => !polygon_.layer.startsWith("rent_district_monthly_")),
      legend: tile.presentation.legend.filter((entry) => !entry.label.startsWith("월세")),
    },
  });
  const zeroMonthly = viewWithLayer(toTileView(zeroMonthlyTile), "building_monthly");
  assert.equal(zeroMonthly.map.features.length, 0, "0건 월세 모드 feature 없음");
  assert.equal(zeroMonthly.map.emptyMessage, "이 반경에 월세 거래 없음", "0건 월세 빈 상태 안내");

  const zeroAllTile = parseTileResult({
    ...tile,
    tileId: `${tile.tileId}-zero-all`,
    presentation: {
      ...tile.presentation,
      features: [],
      polygons: [],
      layers: [],
      legend: [],
    },
  });
  const zeroAll = viewWithLayer(toTileView(zeroAllTile), "district_monthly");
  assert.ok(zeroAll.map, "A08 전체 0건도 빈 지도 모델을 유지");
  assert.equal(zeroAll.map.polygons?.length ?? 0, 0, "전체 0건 행정구역 polygon 없음");
  assert.equal(zeroAll.map.emptyMessage, "이 반경에 월세 행정구역 자료 없음", "전체 0건 행정구역 빈 상태 안내");
  ctx.close();
}

console.log("v2 W2 A07/A08 trade modes: ok");
