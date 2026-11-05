import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a07, collectTrades } = await import("../../lib/v2/tile/a07/engine.ts");
const { d25 } = await import("../../lib/v2/tile/a07/d25.ts");
const { a07ServerModule } = await import("../../lib/v2/tile/a07/server.ts");
const { jibunLabel, lookupComplexNames, lookupEmdNames } = await import("../../lib/v2/tile/a07/complex-name.ts");
const { a07ClientModule } = await import("../../lib/v2/tile/a07/view.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-d25-"));
  await buildEngineFixture(dir, "v1", options);
  const core = new Database(join(dir, "versions", "v1", "core.sqlite"));
  const nameRelease = insertRelease(core, {
    sourceId: "housing_name_test",
    provider: "테스트",
    sourceUrl: "https://example.invalid",
    sourceAsOf: "2026-09-30",
    fetchedAt: "2026-09-30T00:00:00Z",
    checksum: "x",
    licenseCode: "TEST",
  });
  insertFeature(core, { stableId: "housing:trade-a", kind: "housing_complex", sourceKey: "trade-a", releaseId: nameRelease, geometry: { type: "Point", coordinates: CENTER }, pnu: "4136011800100010000", name: "다산 센트럴" });
  insertFeature(core, { stableId: "housing:trade-b", kind: "housing_complex", sourceKey: "trade-b", releaseId: nameRelease, geometry: { type: "Point", coordinates: CENTER }, pnu: "4136011800100020000", name: "다산 리버" });
  if (options.edgeTrade) {
    // 북쪽 가장자리(799.7 m) 단지 하나: 엔진(UTM-K)은 800 m 안으로 세지만 그래프(남북 거리를 0.3 % 길게 잼)는 counted 없이는 802.6 m로 밖에 둔다.
    const pnu = "4136011800100050000";
    const parcelRelease = core.prepare("SELECT release_id FROM source_release WHERE source_id = 'parcel'").pluck().get();
    core.prepare("INSERT INTO parcel_point VALUES (?, ?, ?, ?, ?)").run(pnu, ...at(0, 799.7), "대", parcelRelease);
    const market = new Database(join(dir, "versions", "v1", "market.sqlite"));
    const tradeRelease = market.prepare("SELECT release_id FROM source_release WHERE source_id = 'rtms_apt_trade'").pluck().get();
    const ins = market.prepare(`INSERT INTO property_transaction (transaction_id, source_record_key, lawd_cd, deal_date, property_type, contract_type, price_krw, deposit_krw, rent_krw, area_m2, floor, cancelled_at, location_id, match_status, release_id)
      VALUES (?, ?, '41360', ?, 'apt', 'trade', ?, NULL, NULL, 100, 5, NULL, ?, 'located', ?)`);
    ins.run("edge1", "edge-k1", "2026-08-20", 1100 * 100 * 10_000, pnu, tradeRelease);
    ins.run("edge2", "edge-k2", "2026-08-21", 1200 * 100 * 10_000, pnu, tradeRelease);
    market.close();
  }
  if (options.manyComplexes) {
    // 이름 있는 단지 9곳(동쪽 100~260 m, 멀수록 거래 많음) + 가장 가까운(50 m) 이름 없는 단지 1곳
    const parcelRelease = core.prepare("SELECT release_id FROM source_release WHERE source_id = 'parcel'").pluck().get();
    const market = new Database(join(dir, "versions", "v1", "market.sqlite"));
    const tradeRelease = market.prepare("SELECT release_id FROM source_release WHERE source_id = 'rtms_apt_trade'").pluck().get();
    const ins = market.prepare(`INSERT INTO property_transaction (transaction_id, source_record_key, lawd_cd, deal_date, property_type, contract_type, price_krw, deposit_krw, rent_krw, area_m2, floor, cancelled_at, location_id, match_status, release_id)
      VALUES (?, ?, '41360', ?, 'apt', 'trade', ?, NULL, NULL, 100, 5, NULL, ?, 'located', ?)`);
    for (let i = 0; i < 10; i += 1) {
      const pnu = `4136011800200${String(i).padStart(2, "0")}0000`;
      core.prepare("INSERT INTO parcel_point VALUES (?, ?, ?, ?, ?)").run(pnu, ...at(i === 9 ? 50 : 100 + i * 20, 0), "대", parcelRelease);
      if (i < 9) insertFeature(core, { stableId: `housing:many-${i}`, kind: "housing_complex", sourceKey: `many-${i}`, releaseId: nameRelease, geometry: { type: "Point", coordinates: CENTER }, pnu, name: options.sameName && i === 1 ? "단지0" : `단지${i}` });
      for (let k = 0; k <= (i === 9 ? 0 : i); k += 1) ins.run(`many${i}-${k}`, `many-k${i}-${k}`, "2026-08-20", 1000 * 100 * 10_000, pnu, tradeRelease);
    }
    market.close();
  }
  core.close();
  const manifest = M.readManifest(dir);
  return (radiusM = 800, analysisDate = "2026-09-30") =>
    new EngineContext(dir, manifest, "an-d25", {
      address: "경기도 남양주시 다산동 100",
      center: CENTER,
      radiusM,
      analysisDate,
    });
};

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const clean = (tile) => {
  parseTileResult(tile);
  assert.doesNotMatch(JSON.stringify(tile), /도보|\d\s*분|종합/);
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), /도보|\d\s*분|종합/);
  assert.equal(tile.judgment?.level ?? null, null);
  assert.match(tile.judgment.sentence, / → .+ → /);
};

// PNU→단지명 조회는 500개 단위로 나눠야 SQLite 변수 상한과 전국 자료를 함께 처리한다.
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  const releaseId = insertRelease(db, {
    sourceId: "housing_name_test",
    provider: "테스트",
    sourceUrl: "https://example.invalid",
    sourceAsOf: "2026-09-30",
    fetchedAt: "2026-09-30T00:00:00Z",
    checksum: "x",
    licenseCode: "TEST",
  });
  const pnus = Array.from({ length: 501 }, (_, i) => `41360118001${String(10000000 + i).padStart(8, "0")}`);
  insertFeature(db, { stableId: "officetel:first", kind: "officetel", sourceKey: "first", releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: pnus[0], name: "오피스텔 이름" });
  insertFeature(db, { stableId: "housing:first", kind: "housing_complex", sourceKey: "first", releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: pnus[0], name: "대표 아파트" });
  for (let i = 1; i < pnus.length; i += 1) {
    insertFeature(db, { stableId: `housing:${i}`, kind: "housing_complex", sourceKey: String(i), releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: pnus[i], name: `단지 ${i}` });
  }
  // 법인명은 단지명이 아니다: 법인명만 있는 PNU는 이름 없음, 다른 종류 행에 진짜 이름이 있으면 그 이름
  insertFeature(db, { stableId: "housing:corp", kind: "housing_complex", sourceKey: "corp", releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: "4136011800199990001", name: "(유)갈현상가" });
  insertFeature(db, { stableId: "housing:corp2", kind: "housing_complex", sourceKey: "corp2", releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: "4136011800199990002", name: "㈜가나다" });
  insertFeature(db, { stableId: "officetel:corp2", kind: "officetel", sourceKey: "corp2", releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: "4136011800199990002", name: "진짜오피스텔" });
  const names = lookupComplexNames(db, [...pnus, "없는 PNU", "4136011800199990001", "4136011800199990002"]);
  assert.equal(names.has("4136011800199990001"), false, "법인명만 있으면 이름 없음");
  assert.equal(names.get("4136011800199990002"), "진짜오피스텔", "법인명 행은 건너뛰고 다음 행의 이름");
  names.delete("4136011800199990002");
  assert.equal(names.size, 501);
  assert.equal(names.get(pnus[0]), "대표 아파트", "같은 PNU면 공동주택 이름을 오피스텔보다 우선");
  assert.equal(names.get(pnus[500]), "단지 500", "두 번째 500개 청크도 조회");
  assert.equal(names.has("없는 PNU"), false);
  db.close();
}

{
  const ctx = (await make({ trades: true }))();
  const trades = collectTrades(ctx);
  assert.ok(trades);
  assert.equal(trades.valid.length, 29, "위치 확인·취소 제외 유효 거래");
  assert.equal(trades.priced.length, 28, "전용면적이 있어 단가를 계산한 거래");
  assert.equal(trades.unlocated, 2, "위치 미확인 거래");
  assert.equal(trades.cancelled, 1, "취소 거래");
  assert.equal(trades.points.length, 3, "단지별 점");
  assert.deepEqual(trades.points.map((p) => p.n).sort((a, b) => a - b), [1, 3, 24]);

  const d25Tile = d25(ctx);
  clean(d25Tile);
  assert.equal(d25Tile.tileCode, "D25");
  assert.equal(d25Tile.status, "partial");
  assert.equal(value(d25Tile, "fill_location_pct"), 93.5, "29/(29+2)");
  assert.equal(metric(d25Tile, "fill_location_pct").numerator, 29);
  assert.equal(metric(d25Tile, "fill_location_pct").denominator, 31);
  assert.equal(value(d25Tile, "unlocated_trades"), 2);
  const back = [1, 2, 3, 4, 5].map((i) => value(d25Tile, `back_q${i}`));
  assert.equal(back.reduce((sum, n) => sum + n, 0), 28, "원거래 단가 기준 분위수 건수");
  assert.deepEqual(d25Tile.presentation.features, [], "D25는 A07에 흡수되어 지도 지물을 중복 방출하지 않는다");
  assert.equal(d25Tile.presentation.featuresTotal, 0);
  const t = a07ServerModule.compute(ctx);
  clean(t);
  assert.equal(t.tileCode, "A07");
  assert.equal(t.status, "partial");
  assert.equal(value(t, "fill_location_pct"), 93.5);
  const aCtx = (await make({ trades: true }))();
  const a = a07(aCtx);
  aCtx.close();
  const named = a.presentation.features.find((feature) => feature.name === "다산 센트럴");
  const unnamed = a.presentation.features.find((feature) => feature.name === null);
  const pointA = trades.points.find((point) => point.pnu === "4136011800100010000");
  const pointC = trades.points.find((point) => point.pnu === "1171010100100030000");
  assert.equal(named?.name, "다산 센트럴");
  assert.equal(named?.labelPriority, 2, "이름 있는 단지는 6곳 안이면 우선순위 2");
  assert.match(named?.sublabel ?? "", new RegExp(`^㎡당 중앙값 ${Math.round(pointA.m).toLocaleString("en-US")}만원 · 최근 `), "A07은 lookupComplexNames 이름과 단가를 사용한다");
  assert.match(named?.sublabel ?? "", /억|만원/);
  assert.equal(unnamed?.name, null);
  assert.match(unnamed?.sublabel ?? "", new RegExp(`^㎡당 중앙값 ${Math.round(pointC.m).toLocaleString("en-US")}만원 · 최근 `));
  assert.equal(unnamed?.labelPriority, 0, "A07 이름이 없으면 대체 문구 없이 priority 0이다");
  {
    const mCtx = (await make({ trades: true, manyComplexes: true }))();
    const m = a07(mCtx);
    mCtx.close();
    const labeled = m.presentation.features.filter((feature) => feature.labelPriority === 2);
    assert.equal(labeled.length, 6, "이름 있는 단지 가까운 6곳만 우선순위 2");
    assert.deepEqual(labeled.map((feature) => feature.name).sort(), ["단지0", "단지1", "단지2", "단지3", "단지4", "다산 센트럴"].sort(), "가까운 순 여섯(기존 fixture의 다산 센트럴 포함, 거래 수가 많은 먼 단지가 아님)");
    assert.ok(m.presentation.features.some((feature) => feature.name === null) && m.presentation.features.filter((feature) => feature.name === null).every((feature) => feature.labelPriority === 0), "이름 없는 단지는 가까워도 제외");
  }
  // ⑧ 라벨로 놓이는 단지 중 이름이 같은 것이 둘 이상이면 상세 첫 줄에 지번을 더한다(하나뿐이면 그대로)
  {
    const sCtx = (await make({ trades: true, manyComplexes: true, sameName: true }))();
    const s = a07(sCtx);
    sCtx.close();
    const dup = s.presentation.features.filter((feature) => feature.name === "단지0" && feature.labelPriority === 2);
    assert.equal(dup.length, 2, "전제: 같은 이름 두 곳이 라벨 대상");
    assert.deepEqual(dup.map((f) => f.sublabel.split(" · ")[0]).sort(), ["지번 산 0", "지번 산 1"], "같은 이름이면 지번(산 본번)으로 구분, 동 이름을 모르면 「지번」을 앞에");
    assert.ok(dup.every((f) => !/\d{8}/.test(f.sublabel)), "법정동 코드 숫자는 화면 글에 없다");
    const single = s.presentation.features.filter((feature) => feature.labelPriority === 2 && feature.name !== "단지0");
    assert.ok(single.length > 0 && single.every((f) => f.sublabel.startsWith("㎡당 중앙값 ")), "이름이 하나뿐이면 지금 그대로");
  }
  // T14b-5: 동 이름 조회는 legal_area에서, 없는 코드는 비워 둔다(코드를 이름으로 쓰지 않는다)
  {
    const mem = new Database(":memory:");
    mem.exec("CREATE TABLE legal_area (code TEXT PRIMARY KEY, level TEXT, name TEXT, parent_code TEXT, release_id TEXT)");
    mem.prepare("INSERT INTO legal_area VALUES ('11680106','emd','대치동','11680','r'), ('11680107','ri','가짜리','11680','r')").run();
    const found = lookupEmdNames(mem, ["11680106", "11680107", "99999999", "abc"]);
    assert.deepEqual([...found], [["11680106", "대치동"]]);
    assert.equal(jibunLabel("1168010600105060000", found.get("11680106")), "대치동 506");
    assert.equal(jibunLabel("1168010600105060000", found.get("99999999")), "지번 506");
    assert.equal(jibunLabel("1168010600105060000", undefined).includes("11680106"), false);
    mem.close();
  }
  // 그래프용 값: 모든 거래 점에서 value === weight (㎡당 중앙값, 만원)
  assert.deepEqual(a.presentation.valueAxis, { label: "㎡당 가격", unit: "만원", countUnit: "단지" });
  const tradePoints = a.presentation.features.filter((feature) => feature.layer.startsWith("trade_q"));
  assert.ok(tradePoints.length > 0);
  for (const feature of tradePoints) assert.ok(Number.isFinite(feature.value) && feature.value === feature.weight, `${feature.layer} value === weight`);
  assert.deepEqual(toTileView(a).map.valueAxis, a.presentation.valueAxis);
  // counted: 그래프 단지 수 = 엔진이 센 거래 단지 수(점 수). 400 m는 단지 C(600 m)가 반경 밖이라 점 3 → 2.
  {
    const { viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
    const { analysisCharts, analysisStatLine } = await import("../../lib/v2/report/analysis-charts.ts");
    const makeAt = await make({ trades: true });
    for (const [radiusM, complexes] of [[800, 3], [400, 2]]) {
      const radiusCtx = makeAt(radiusM);
      const tile = a07(radiusCtx);
      const engineComplexes = collectTrades(radiusCtx).points.length;
      assert.equal(engineComplexes, complexes, `${radiusM} m: 엔진 단지 수(전제)`);
      assert.ok(tile.presentation.features.length > 0 && tile.presentation.features.every((feature) => feature.counted === true), `${radiusM} m: 그린 단지는 모두 counted`);
      const view = toTileView(tile);
      const chart = analysisCharts(viewWithLayer(view, view.defaultLayer).map);
      assert.ok(chart, `${radiusM} m: A07은 아파트·단지를 밝혀 그래프가 나온다`);
      assert.equal(chart.total, engineComplexes, `${radiusM} m: 그래프 단지 수 = 엔진 단지 수`);
      assert.ok(analysisStatLine(chart).startsWith(`반경 ${radiusM === 800 ? "800 m" : "400 m"} 안 아파트 ${engineComplexes}단지`), analysisStatLine(chart));
      radiusCtx.close();
    }
    // 가장자리 단지(북쪽 799.7 m)가 있는 픽스처: 800 m에서 엔진 4단지, 그래프도 4. counted를 떼면 3.
    const edgeAt = await make({ trades: true, edgeTrade: true });
    const edgeCtx = edgeAt(800);
    const edgeTile = a07(edgeCtx);
    assert.equal(collectTrades(edgeCtx).points.length, 4, "전제: 엔진 단지 4(가장자리 포함)");
    const edgeView = toTileView(edgeTile);
    assert.equal(analysisCharts(viewWithLayer(edgeView, edgeView.defaultLayer).map).total, 4, "가장자리 단지까지 센다");
    const stripped = JSON.parse(JSON.stringify(edgeTile));
    for (const feature of stripped.presentation.features) delete feature.counted;
    const strippedView = toTileView(stripped);
    assert.equal(analysisCharts(viewWithLayer(strippedView, strippedView.defaultLayer).map), null, "음성 대조: counted가 없는 옛 분석은 그래프를 그리지 않는다(반경 판정으로 돌아가지 않는다)");
    edgeCtx.close();
  }
  assert.ok(a.presentation.features.every((feature) => !Object.hasOwn(feature, "label")), "A07는 옛 label을 내지 않는다");
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => {
    const values = trades.points.map((point) => point.m).sort((x, y) => x - y);
    const position = (values.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return values[lower] + (values[upper] - values[lower]) * (position - lower);
  });
  assert.deepEqual(a.presentation.legend.map(({ label, min, max }) => ({ label, min, max })), [
    { label: "㎡당 하위 20%", min: null, max: cuts[0] },
    { label: "㎡당 20~40%", min: cuts[0], max: cuts[1] },
    { label: "㎡당 40~60%", min: cuts[1], max: cuts[2] },
    { label: "㎡당 60~80%", min: cuts[2], max: cuts[3] },
    { label: "㎡당 상위 20%", min: cuts[3], max: null },
  ], "A07 범례는 실제 점별 단가 분위 경계값을 보존한다");
  assert.deepEqual(
    t.presentation.features.map(({ layer, weight, lng, lat }) => ({ layer, weight, lng, lat })),
    a.presentation.features.map(({ layer, weight, lng, lat }) => ({ layer, weight, lng, lat })),
    "흡수된 A07 결과는 A07 지도 지물만 방출",
  );
  assert.match(t.judgment.sentence, /최근 12개월 반경 안 아파트 매매/);
  assert.match(d25Tile.judgment.sentence, /아파트 매매 · 최근 12개월/);
  ctx.close();
}

assert.deepEqual(a07ClientModule.layers.options({ presentation: { polygons: [] } }), [{ id: "all", label: "기본 거래" }], "법정동 자료가 없으면 옛 기본 보기만 보존");

{
  const ctx = (await make({}))();
  assert.equal(d25(ctx).status, "not_provided", "실거래 원천이 없으면 미제공");
  ctx.close();
}

console.log("v2 engine D25: ok");
