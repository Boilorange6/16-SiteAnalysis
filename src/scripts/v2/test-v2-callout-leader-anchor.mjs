/** 설명선: (a) 링이 같은 면은 서로 다른 안쪽 기준점을 받고, (b) 지시선이 다른 카드 상자를 지나지 않는다 */
import assert from "node:assert/strict";

import * as C from "../../lib/v2/ui/callout-layout.ts";
import { buildMapScene, mapElementKey } from "../../lib/v2/ui/map-scene.ts";
import { GODEOK_RESULTS } from "../../lib/v2/ui/fixtures/godeok.ts";
import { toTileView } from "../../lib/v2/ui/tile-view.ts";

// ── (b) 배치: 폭이 다른 카드에서도 지시선이 다른 카드를 지나지 않는다 ──
{
  const frame = C.calloutFrame({ W: 960, H: 540, m: C.PX, edge: 4, top: 10, bottom: 530, perSide: 100, rows: 3, variant: "compact", maxFill: 0.8 });
  let seed = 20261030;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let narrowerCases = 0;
  for (let run = 0; run < 300; run += 1) {
    const count = 3 + Math.floor(rand() * 4);
    // 점은 좌우 카드 칸 사이 띠에 놓는다(칸 밑이 아님). 오른쪽 칸(x ≥ centerX)을 쓰도록 한다.
    const points = Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      x: frame.centerX + rand() * (frame.right.x0 - 40 - frame.centerX),
      y: 20 + rand() * 500,
      rank: index,
      width: 60 + rand() * (frame.cardW - 60),
      height: 30 + rand() * 30,
    }));
    const { placed } = C.layoutCallouts(frame, points);
    const boxes = placed.map((item) => ({ id: item.id, x0: item.x, y0: item.y, x1: item.x + item.width, y1: item.y + item.height }));
    if (new Set(placed.map((item) => item.width.toFixed(0))).size > 1) narrowerCases += 1;
    for (const item of placed) {
      for (const box of boxes) {
        if (box.id === item.id) continue;
        assert.equal(C.segmentHitsRect(item.dot, item.knee, box), false, `run ${run}: ${item.id} 지시선이 ${box.id} 카드를 지난다`);
        assert.equal(C.segmentHitsRect(item.knee, item.edge, box), false, `run ${run}: ${item.id} 꺾임→가장자리가 ${box.id} 카드를 지난다`);
      }
    }
    // 한 칸의 꺾임 x는 하나다.
    for (const side of ["L", "R"]) assert.equal(new Set(placed.filter((item) => item.side === side).map((item) => item.knee[0].toFixed(3))).size <= 1, true, `run ${run}: ${side} 칸 꺾임 x가 하나가 아니다`);
  }
  assert.ok(narrowerCases > 100, "폭이 다른 카드 조합을 충분히 시험했다");
  // 선분 대 상자 판정
  assert.equal(C.segmentHitsRect([0, 0], [10, 10], { x0: 4, y0: 4, x1: 8, y1: 8 }), true);
  assert.equal(C.segmentHitsRect([0, 0], [10, 0], { x0: 4, y0: 4, x1: 8, y1: 8 }), false);
  assert.equal(C.segmentHitsRect([6, 6], [20, 6], { x0: 4, y0: 4, x1: 8, y1: 8 }), true, "끝점이 상자 안");
}

// ── (a) 면 기준점: 링이 같은 면 3개는 면 안쪽의 서로 다른 점 ──
{
  const fixture = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
  assert.ok(fixture);
  const base = toTileView(fixture).map;
  assert.ok(base);
  const [lng, lat] = base.center;
  const radius = base.radiusM;
  const ring = Array.from({ length: 101 }, (_, i) => {
    const angle = (i / 100) * Math.PI * 2;
    return [lng + (Math.cos(angle) * radius) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.sin(angle) * radius) / 110540];
  });
  const polygons = ["a", "b", "c"].map((fid, index) => ({ fid, layer: "district", rings: [ring], name: `구역 ${index + 1}`, sublabel: `지정기간:2025.10.${index + 1}.~`, labelPriority: 2 }));
  const model = { ...base, features: [], lines: [], polygons, siteParcel: [] };
  const keys = polygons.map((polygon, index) => mapElementKey("polygon", polygon.layer, polygon.fid, index));
  const scene = buildMapScene({ model, width: 960, height: 540, activeLayer: "white", scale: false, showAutomaticLabels: false, pinnedKeys: keys, avoid: [] });
  const anchors = keys.map((key) => scene.labels.find((entry) => entry.key === key)?.p);
  assert.ok(anchors.every(Boolean), "세 면 모두 라벨 기준점이 있다");
  const sceneRing = scene.polygons[0].rings[0];
  const pointInRing = (x, y, r) => {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[i];
      const [bx, by] = r[j];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
  for (const [x, y] of anchors) {
    assert.equal(pointInRing(x, y, sceneRing), true, "기준점은 면 안쪽");
    assert.ok(Math.min(...sceneRing.map(([rx, ry]) => Math.hypot(rx - x, ry - y))) > 5, "기준점은 링 둘레 위가 아니다");
  }
  for (let i = 0; i < anchors.length; i += 1) for (let j = i + 1; j < anchors.length; j += 1) assert.ok(Math.hypot(anchors[i][0] - anchors[j][0], anchors[i][1] - anchors[j][1]) >= 5, "링이 같은 면의 기준점은 서로 다르다");
  // 지시선 점이 서로 다른 카드 상자 밑이 아니다.
  const boxes = scene.labelPlacements.map((placement) => placement.box);
  assert.equal(scene.labelPlacements.length, 3);
  for (const placement of scene.labelPlacements) {
    for (const box of boxes) {
      if (box === placement.box) continue;
      assert.equal(C.segmentHitsRect(placement.placed.dot, placement.placed.knee, box), false, "지시선이 다른 카드를 지난다");
    }
  }
}

// ── (c) 면 기준점: 면이 좌우 카드 사이 띠 경계에 1~2 px만 걸쳐도 그 끝점이 기준점이 되던 것(G1, 12쪽 개포주공6,7단지·개포우성4차·도곡개포한신)
{
  const { interiorAnchor } = await import("../../lib/v2/ui/map-scene.ts");
  // 12쪽 DOM 실측(1440×900, 855×680): 카드 틀 left.x1=192 · right.x0=663, stub 14 → 안쪽 띠 [206,649], 바깥 띠 [192,663]
  const bands = [[206, 649], [192, 663]];
  const keepOut = [[200.4, 211.6], [643.4, 654.6]];
  const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
  for (const [name, x0, y0, x1, y1] of [["개포주공6,7단지 (띠와 1 px 겹침)", 648, 360, 760, 456], ["개포우성4차 (띠와 2 px 겹침)", 130, 480, 208, 560], ["도곡개포한신 (띠 밖 작은 면)", 170, 448, 190, 452]]) {
    const point = interiorAnchor(rect(x0, y0, x1, y1), 855, 680, bands, keepOut, [], [], 10);
    assert.ok(point, `${name}: 기준점이 있다`);
    const centre = [(x0 + x1) / 2, (y0 + y1) / 2];
    assert.ok(Math.abs(point[0] - centre[0]) <= 0.25 * (x1 - x0) + 1, `${name}: 기준점 x ${point[0]}가 면 중심 ${centre[0]} 쪽 (귀퉁이 아님)`);
    assert.ok(Math.abs(point[1] - centre[1]) <= 0.25 * (y1 - y0) + 1, `${name}: 기준점 y ${point[1]}가 면 중심 ${centre[1]} 쪽`);
  }
  // 띠와 면이 절반 이상 겹치면 그 띠를 그대로 쓴다(카드 사이 띠 안 우선 규칙은 유지): 면 x 300–500은 안쪽 띠 안
  const inBand = interiorAnchor(rect(300, 100, 500, 200), 855, 680, bands, keepOut, [], [], 10);
  assert.ok(inBand && inBand[0] > 380 && inBand[0] < 420, `띠 안의 면은 중심: ${inBand}`);
}

console.log("callout leader anchor ok");
