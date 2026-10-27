/** 벡터 바탕: Scene → MapBase 변환, 묶음 순서, 타일별 생략, 필지선 축척, 라벨 상자, 바탕 없는 모델의 기존 결과. */
import assert from "node:assert/strict";

const { toUtmk } = await import("../../lib/v2/crs.ts");
const { mapBaseFromScene, BASE_SUPPRESS, resolveBasemap, baseUsable } =await import("../../lib/v2/ui/basemap.ts");
const { buildMapScene, northArrowBox, scaleBarBox } = await import("../../lib/v2/ui/map-scene.ts");
const { baseTheme } = await import("../../lib/v2/ui/map-theme.ts");

const ORIGIN_LNG = 127.0636;
const ORIGIN_LAT = 37.4979;
const [ox, oy] = toUtmk([ORIGIN_LNG, ORIGIN_LAT]);
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

/** 1.2km 반경 안의 작은 손 장면. 새 필드(이름·녹지 분류·철도·역·지명)를 모두 가진다. */
function makeScene() {
  return {
    version: "v2-scene@2",
    analysisId: "a-basemap",
    manifestHash: "h",
    origin: { epsg: "EPSG:5179", x: ox, y: oy, lng: ORIGIN_LNG, lat: ORIGIN_LAT },
    radiusM: 500,
    ground: { kind: "flat" },
    site: null,
    buildings: [0, 1, 2, 3, 4].map((i) => ({
      id: `b${i}`, name: null, sublabel: null, labelPriority: 0,
      rings: [i === 0 ? box(0, 0, 20, 20) : box(-200 + i * 50, -150 + i * 30, 30, 25)],
      baseZ: null, heightM: 9, heightMethod: "source", floorsAbove: 3, useCode: null, approvalDate: null,
    })),
    parcels: [0, 1, 2].map((i) => ({ pnu: `p${i}`, rings: [box(-100 + i * 40, 40, 36, 36)], jimok: null, areaM2: 1000, isSite: i === 0 })),
    context: {
      roads: [
        { points: line(-450, -60, 450, -60), widthM: 20, hierarchy: "간선", name: "테헤란로" },
        { points: line(-450, 120, 450, 140), widthM: 10, hierarchy: "집산", name: "도곡로77길" },
        { points: line(-120, -450, -80, 450), widthM: 6, hierarchy: "국지", name: null },
        { points: line(180, -300, 200, -280, 2), widthM: 6, hierarchy: "국지", name: "짧은길" },
        { points: line(-300, 300, 300, 330), widthM: 3, hierarchy: "보행·자전거", name: null },
      ],
      green: [[box(-400, -400, 120, 100)], [box(250, 200, 100, 100)], [box(-380, 200, 90, 90)]],
      greenKinds: ["forest", "park", "grass"],
      water: [[box(300, -380, 120, 60)]],
      rail: [
        { points: line(-450, -200, 450, -190), color: "#ED6C00", lineRef: "3", name: "수도권 전철 3호선: 대화 → 오금" },
        { points: line(-450, 220, 450, 240), color: "#123456", lineRef: "", name: "공항 셔틀트레인" },
      ],
      stations: [{ name: "대치", x: -150, y: -195, color: "#ED6C00" }],
      places: [{ name: "역삼동", kind: "dong", x: 60, y: -300 }, { name: "근린공원", kind: "park", x: 280, y: 240 }],
    },
    counts: { buildingsTotal: 5, buildingsIncluded: 5, parcelsTotal: 3, parcelsIncluded: 3 },
    sources: [],
    limitations: [],
  };
}

const scene = makeScene();
const base = mapBaseFromScene(scene);
const modelOf = (tileCode, extra = {}) => ({ center: [ORIGIN_LNG, ORIGIN_LAT], radiusM: 500, features: [], total: 0, notes: [], tileCode, base, ...extra });
const build = (model, options = {}) => buildMapScene({ model, width: 800, height: 600, activeLayer: "vector", ...options });

// ── base-convert ──
{
  assert.ok(base.buildings.length === 5 && base.parcels.length === 3 && base.roads.length === 5);
  const [lng, lat] = base.buildings[0][0][0];
  assert.ok(Math.abs(lng - scene.origin.lng) < 1e-7 && Math.abs(lat - scene.origin.lat) < 1e-7, `원점 ${lng},${lat}`);
  assert.strictEqual(mapBaseFromScene(scene), base, "같은 scene이면 같은 객체");
  assert.notStrictEqual(mapBaseFromScene(makeScene()), base);
  assert.deepEqual(base.green.map((g) => g.kind), ["forest", "park", "grass"]);
  assert.equal(base.roads[0].name, "테헤란로");
  assert.equal(base.roads[2].name, null);
  // 옛 장면: 새 필드가 없으면 빈 값
  const legacy = makeScene();
  delete legacy.context.greenKinds; delete legacy.context.rail; delete legacy.context.stations; delete legacy.context.places;
  for (const road of legacy.context.roads) delete road.name;
  const old = mapBaseFromScene(legacy);
  assert.deepEqual([old.rail, old.stations, old.places], [[], [], []]);
  assert.ok(old.green.every((g) => g.kind === "park") && old.roads.every((r) => r.name === null));
  const noContext = makeScene(); delete noContext.context;
  assert.deepEqual(mapBaseFromScene(noContext).roads, []);
  // 철도: 공용 노선만, 공식 노선색(OSM의 #ED6C00 -> 3호선 공식 #EF7C1C)
  assert.equal(base.rail.length, 1, "셔틀 노선은 뺀다");
  assert.equal(base.rail[0].color, "#EF7C1C");
  assert.deepEqual(BASE_SUPPRESS, { A01: ["rail", "station"], A10: ["rail", "station"], D13: ["road"], D19: ["parcel"] });
}

// ── resolveBasemap: 결과 지정 > 사용자 선택 > 바탕 있으면 벡터 > 일반지도 ──
{
  assert.equal(resolveBasemap({ basemap: "Satellite", base }, "vector"), "Satellite");
  assert.equal(resolveBasemap({ base }, "Base"), "Base");
  assert.equal(resolveBasemap({ base }), "vector");
  assert.equal(resolveBasemap({ base }, "vector"), "vector");
  assert.equal(resolveBasemap({}, "vector"), "white", "바탕 자료 없는 옛 분석은 일반지도");
  assert.equal(resolveBasemap({}), "white");
  // 도로 맥락이 없는 바탕(OSM 맥락 없는 장면)은 건물·필지만 남아 깨져 보이므로 쓰지 않는다
  const noContext = makeScene(); delete noContext.context;
  const roadless = mapBaseFromScene(noContext);
  assert.equal(baseUsable(roadless), false);
  assert.equal(baseUsable(base), true);
  assert.equal(resolveBasemap({ base: roadless }), "white");
  assert.equal(resolveBasemap({ base: roadless }, "vector"), "white");
  assert.equal(resolveBasemap({ base: roadless }, "Base"), "Base", "사용자가 고른 VWorld는 그대로");
  const roadlessScene = buildMapScene({ model: modelOf("A04", { base: roadless }), width: 800, height: 600 });
  assert.equal(roadlessScene.base, null);
  assert.equal(roadlessScene.activeLayer, "white");
}

// ── 출처 표기: 벡터일 때만 OSM 문구 ──
{
  const { VECTOR_ATTRIBUTION, basemapAttribution, BASEMAP_ATTRIBUTION } = await import("../../lib/v2/ui/map-projection.ts");
  const { stripText } = await import("../../lib/v2/ui/overlay-layout.ts");
  assert.equal(VECTOR_ATTRIBUTION, "© OpenStreetMap contributors · 국토교통부");
  assert.equal(basemapAttribution("vector"), VECTOR_ATTRIBUTION);
  for (const layer of ["white", "Base", "Satellite"]) assert.equal(basemapAttribution(layer), BASEMAP_ATTRIBUTION);
  assert.equal(stripText("국토부 2026-01-01", true, "vector"), `국토부 2026-01-01 · ${VECTOR_ATTRIBUTION}`);
  assert.equal(stripText("국토부 2026-01-01", true, "white"), "국토부 2026-01-01 · © VWorld(국토교통부)");
  assert.equal(stripText("국토부 2026-01-01"), "국토부 2026-01-01 · © VWorld(국토교통부)");
  assert.equal(stripText("국토부 2026-01-01", false, "vector"), "국토부 2026-01-01");
}

// ── base-buckets ──
{
  const s = build(modelOf("A04"));
  assert.ok(s.base, "벡터면 base가 있다");
  assert.equal(s.base.bg, baseTheme().bg);
  const layers = s.base.buckets.map((b) => b.layer);
  const collapsed = layers.filter((layer, i) => layer !== layers[i - 1]);
  assert.deepEqual(collapsed, ["water", "green", "parcel", "road", "rail", "building", "station"], layers.join(","));
  const displays = s.base.buckets.filter((b) => b.layer === "road").map((b) => b.display);
  assert.deepEqual(displays, [...displays].sort((a, b) => (a === "도로 테두리" ? 0 : 1) - (b === "도로 테두리" ? 0 : 1)), "도로 테두리가 모두 도로 채움 아래");
  assert.equal(s.base.buckets.filter((b) => b.layer === "building").length, 1, "건물 여러 동도 묶음 하나");
  assert.equal(s.base.buckets.find((b) => b.layer === "building").paths.length, 5);
  assert.deepEqual(s.base.buckets.filter((b) => b.layer === "green").map((b) => b.display), ["숲", "공원", "잔디"]);
  const casings = s.base.buckets.filter((b) => b.display === "도로 테두리");
  const fills = s.base.buckets.filter((b) => b.display === "도로");
  assert.equal(casings.length, fills.length);
  assert.ok(casings.length >= 3);
  assert.deepEqual(casings.map((b) => b.strokeWidth), [...casings.map((b) => b.strokeWidth)].sort((a, b) => a - b), "폭 오름차순");
  const theme = baseTheme();
  const wide = fills.at(-1);
  assert.ok(Math.abs(wide.strokeWidth - Math.max(theme.road.minWidthPx, (20 * theme.road.widthScale) / s.mpp)) < 0.01, `간선 폭 ${wide.strokeWidth}`);
  assert.ok(Math.abs(casings.at(-1).strokeWidth - (wide.strokeWidth + theme.road.casingM / s.mpp)) < 0.01, "테두리 = 채움 + casingM/mPerPx");
  assert.equal(new Set(s.base.buckets.map((b) => b.key)).size, s.base.buckets.length, "key 유일");
  assert.deepEqual(s.base.buckets.filter((b) => b.layer === "rail").map((b) => b.display), ["철도"]);
  assert.equal(s.base.buckets.find((b) => b.layer === "rail").stroke, "#EF7C1C");
  assert.equal(s.base.buckets.find((b) => b.layer === "station").display, "역");
  assert.equal(s.base.buckets.find((b) => b.layer === "parcel").display, "필지선");
  assert.equal(s.base.buckets.find((b) => b.layer === "water").display, "물");
  assert.ok(s.base.buckets.every((b) => b.paths.length > 0 && b.paths.every((p) => p.length >= 1)));
  // 테마를 바꾸면 색이 따라간다
  const cool = build(modelOf("A04"), { baseTheme: "cool" });
  assert.equal(cool.base.bg, baseTheme("cool").bg);
  assert.equal(cool.base.buckets.find((b) => b.layer === "building").fill, baseTheme("cool").building.fill);
}

// ── suppress ──
{
  const layersOf = (code) => new Set(build(modelOf(code)).base.buckets.map((b) => b.layer));
  for (const code of ["A01", "A10"]) { const l = layersOf(code); assert.ok(!l.has("rail") && !l.has("station") && l.has("road") && l.has("parcel"), code); }
  assert.ok(!layersOf("D19").has("parcel") && layersOf("D19").has("road"));
  assert.ok(!layersOf("D13").has("road") && layersOf("D13").has("parcel"));
  const all = layersOf("A04");
  for (const layer of ["water", "green", "parcel", "road", "rail", "building", "station"]) assert.ok(all.has(layer), layer);
}

// ── parcel-scale ──
{
  const near = build(modelOf("A04"));
  assert.ok(near.mpp < 2.5 && near.base.buckets.some((b) => b.layer === "parcel"));
  const far = build(modelOf("A04", { radiusM: 720 }));
  assert.ok(far.mpp > 2.5, `mpp ${far.mpp}`);
  assert.ok(!far.base.buckets.some((b) => b.layer === "parcel"), "mPerPx > maxMPerPx면 필지선 생략");
}

// ── label-boxes ──
{
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const s = build(modelOf("A04"));
  const labels = s.base.labels;
  assert.ok(labels.length >= 3, `라벨 ${labels.length}개`);
  const kinds = new Set(labels.map((l) => l.kind));
  for (const k of ["station", "place", "park", "road"]) assert.ok(kinds.has(k), `${k} 라벨`);
  assert.ok(!labels.some((l) => l.text === "짧은길"), "선이 글자 폭의 1.2배보다 짧으면 라벨 없음");
  assert.equal(labels.filter((l) => l.text === "테헤란로").length, 1, "이름별 하나");
  for (const l of labels) {
    assert.ok(l.angle >= -90 && l.angle <= 90, `${l.text} 각도 ${l.angle}`);
    assert.ok(l.box.x0 >= 0 && l.box.y0 >= 0 && l.box.x1 <= 800 && l.box.y1 <= 600, `${l.text} 밖으로 나감`);
    assert.equal(l.halo, baseTheme().label.halo);
  }
  for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) assert.ok(!overlaps(labels[i].box, labels[j].box), `${labels[i].text}·${labels[j].text} 겹침`);
  const north = northArrowBox(800, 600);
  const scaleBox = scaleBarBox(800, 600, s.mpp);
  const occupied = [north, scaleBox, s.siteBounds, ...s.rail.occupiedBoxes, ...s.labelPlacements.map((p) => p.box)];
  for (const l of labels) for (const o of occupied) assert.ok(!overlaps(l.box, o), `${l.text} 가 점유 상자와 겹침`);
  // 회피할 상자를 라벨 한가운데에 얹으면 그 라벨은 사라진다
  const first = labels.find((l) => l.kind === "place");
  const blocked = build(modelOf("A04"), { avoid: [first.box] });
  assert.ok(!blocked.base.labels.some((l) => l.key === first.key), "avoid 상자와 겹치면 버린다");
  assert.equal(build(modelOf("A04"), { compact: true }).base.labels.length, 0, "compact면 라벨 없음");
  assert.equal(buildMapScene({ model: modelOf("A04"), width: 599, height: 600, activeLayer: "vector" }).base.labels.length, 0, "폭 600 미만이면 라벨 없음");
  assert.ok(build(modelOf("A04"), { compact: true }).base.buckets.length > 0, "compact여도 묶음은 그린다");
  // 주제 라벨의 설명선(leader) 상자도 피한다: 고정 라벨이 있는 장면에서 바탕 라벨은 상자·설명선과 모두 겹치지 않는다
  const { toLngLat } = await import("../../lib/v2/crs.ts");
  const features = [[-60, 40], [90, 70], [20, -120], [-200, 160], [60, -300]].map(([x, y], i) => {
    const [lng, lat] = toLngLat([ox + x, oy + y]);
    return { fid: `f${i}`, layer: "park", lng, lat, name: `주제${i}`, labelPriority: 2 };
  });
  const topical = build(modelOf("A04", { features, total: features.length }), { pinnedKeys: features.map((f) => `park|${f.fid}`) });
  assert.ok(topical.labelPlacements.length > 0, "주제 라벨 배치가 있다");
  assert.ok(topical.labelPlacements.every((p) => p.leader.x1 > p.leader.x0 || p.leader.y1 > p.leader.y0), "설명선 상자가 있다");
  assert.ok(topical.base.labels.length > 0);
  // 마지막 지물은 지명 "역삼동"의 자리에 있어 그 설명선 상자가 지명 라벨을 덮는다 -> 지명 라벨은 버려진다
  assert.ok(labels.some((l) => l.text === "역삼동") && !topical.base.labels.some((l) => l.text === "역삼동"), "설명선 위의 바탕 라벨은 버린다");
  for (const l of topical.base.labels) for (const p of topical.labelPlacements) {
    assert.ok(!overlaps(l.box, p.box), `${l.text} 가 주제 라벨 상자와 겹침`);
    assert.ok(!overlaps(l.box, p.leader), `${l.text} 가 설명선 상자와 겹침`);
  }
  // 역·철도 바탕이 빠지면 역 라벨도 없다
  assert.ok(!build(modelOf("A01")).base.labels.some((l) => l.kind === "station"));
  assert.ok(!build(modelOf("D13")).base.labels.some((l) => l.kind === "road"));
}

// ── base-fallback ──
{
  const noBase = { center: [ORIGIN_LNG, ORIGIN_LAT], radiusM: 500, features: [], total: 0, notes: [], tileCode: "A04" };
  const plain = buildMapScene({ model: noBase, width: 800, height: 600, activeLayer: "white" });
  const asVector = buildMapScene({ model: noBase, width: 800, height: 600, activeLayer: "vector" });
  assert.equal(plain.base, null);
  assert.equal(asVector.base, null, "바탕 자료가 없으면 벡터를 골라도 base가 없다");
  assert.equal(asVector.activeLayer, "white");
  assert.deepEqual(asVector.tiles, plain.tiles);
  // 바탕 자료가 있어도 사용자가 일반지도를 고르면 기존 그대로
  const white = buildMapScene({ model: modelOf("A04"), width: 800, height: 600, activeLayer: "white" });
  assert.equal(white.base, null);
  assert.equal(white.activeLayer, "white");
  // 선택이 없으면 바탕이 있는 모델은 벡터
  assert.equal(buildMapScene({ model: modelOf("A04"), width: 800, height: 600 }).activeLayer, "vector");
  assert.equal(buildMapScene({ model: modelOf("A04", { basemap: "Satellite" }), width: 800, height: 600, activeLayer: "vector" }).base, null, "결과가 지정한 위성이 우선");
}

console.log("test-v2-basemap-scene OK");
