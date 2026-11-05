/** 설명선 렌더: 같은 등급은 대지에서 가까운 순, 칸별 위 끝, 금액 줄바꿈, 넘치는 낱말만 카드 폭 넓힘. */
import assert from "node:assert/strict";

const { buildMapScene, wrapMapText, northArrowBox } = await import("../../lib/v2/ui/map-scene.ts");

const CENTER = [127.0, 37.5];
const point = (k, extra = {}) => ({
  layer: "bldg_point",
  lng: CENTER[0] + 0.00025 * k * (k % 2 ? 1 : -1),
  lat: CENTER[1] + 0.0001 *((k * 3) % 5 - 2),
  name: `점${k}`,
  labelPriority: 2,
  ...extra,
});
const modelOf = (features) => ({ center: CENTER, radiusM: 1000, features, total: features.length, notes: [], polygons: [], polygonsTotal: 0 });
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const W = 960;

// 엔진 순서는 「먼 것부터」다.
const farFirst = (n, extra) => Array.from({ length: n }, (_, i) => point(n - i, extra));

// ① H 519: 숫자 카드(왼쪽) + 방위표(오른쪽 위)
{
  const H = 519;
  const keyCard = { x0: 24, y0: 84, x1: 324, y1: 330 };
  const scene = buildMapScene({ model: modelOf(farFirst(40)), width: W, height: H, activeLayer: "white", scale: true, north: 30, avoid: [keyCard] });
  const u = Math.min(1.5, Math.max(1, H / 360));
  const placed = new Set(scene.labelPlacements.map((p) => p.entry.key));
  assert.ok(placed.size > 0 && placed.size < 40, `일부만 놓인다(${placed.size})`);
  const placedD = scene.labelPlacements.map((p) => p.entry.siteDistance);
  const hiddenD = scene.labels.filter((l) => l.autoText && !placed.has(l.key)).map((l) => l.siteDistance);
  assert.ok(hiddenD.length > 0);
  assert.ok(Math.max(...placedD) < Math.min(...hiddenD), `① 놓인 최대 ${Math.max(...placedD)} < 숨긴 최소 ${Math.min(...hiddenD)}`);

  // ③ 칸별 위 끝
  const north = northArrowBox(W, H, 0, 30, scene.northUnit, scene.north.x);
  const f = scene.calloutFrame;
  assert.ok(Math.abs(f.right.top - (north.y1 + 6 * u)) < 0.5, `right.top ${f.right.top}`);
  assert.ok(Math.abs(f.left.top - (keyCard.y1 + 6 * u)) < 0.5, `left.top ${f.left.top}`);
  assert.ok(f.right.top < f.left.top);

  // ⑤ 겹침 0
  const boxes = scene.labelPlacements.map((p) => p.box);
  const fixedBoxes = [keyCard, north, scene.scaleBox];
  boxes.forEach((a, i) => {
    boxes.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), "① 카드끼리 겹침"));
    fixedBoxes.forEach((b) => assert.ok(!overlap(a, b), "① 카드가 숫자 카드·방위표·축척을 덮음"));
  });
}

// ② H 763: 왼쪽 아래 범례 판, 후보 12개, 같은 문구 중 가까운 쪽
{
  const H = 763;
  const legendBox = { x0: 24, y0: H - 24 - 220, x1: 24 + 300, y1: H - 24 };
  const twins = [point(9, { name: "같은이름", labelPriority: 1 }), point(1, { name: "같은이름", labelPriority: 1 })];
  const scene = buildMapScene({ model: modelOf([...farFirst(12), ...twins]), width: W, height: H, activeLayer: "white", scale: true, north: 30, legendBox });
  const placed = new Set(scene.labelPlacements.map((p) => p.entry.key));
  const hiddenD = scene.labels.filter((l) => l.autoText && !placed.has(l.key) && l.labelPriority === 2).map((l) => l.siteDistance);
  const placedD = scene.labelPlacements.filter((p) => p.entry.labelPriority === 2).map((p) => p.entry.siteDistance);
  if (hiddenD.length > 0) assert.ok(Math.max(...placedD) < Math.min(...hiddenD), "② 놓인 것이 숨긴 것보다 가깝다");
  // ② 같은 문구는 가까운 쪽 하나만 후보
  const twinLabels = scene.labels.filter((l) => l.autoText === "같은이름");
  assert.equal(twinLabels.length, 2);
  const kept = scene.labelPlacements.filter((p) => p.entry.autoText === "같은이름");
  assert.ok(kept.length <= 1, "같은 문구는 한 번만");
  if (kept.length === 1) assert.equal(kept[0].entry.siteDistance, Math.min(...twinLabels.map((l) => l.siteDistance)));
  // ④ 범례 판을 덮지 않는다 ⑤ 겹침 0
  const north = northArrowBox(W, H, 0, 30, scene.northUnit, scene.north.x);
  const boxes = scene.labelPlacements.flatMap((p) => [p.box, p.leader]);
  boxes.forEach((b) => assert.ok(!overlap(b, legendBox), "② 범례 판을 덮음"));
  const cards = scene.labelPlacements.map((p) => p.box);
  cards.forEach((a, i) => {
    cards.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), "② 카드끼리 겹침"));
    [north, scene.scaleBox].forEach((b) => assert.ok(!overlap(a, b), "② 카드가 방위표·축척을 덮음"));
  });
}

// ⑥ 금액은 줄 끝에서 끊기지 않는다
{
  const lines = wrapMapText("최근 전세 18억 9,000만원", 12.6, 120);
  assert.ok(lines.every((l) => !l.endsWith("억")), JSON.stringify(lines));
  assert.ok(lines.some((l) => l.includes("18억 9,000만원")), JSON.stringify(lines));
}

// ⑦ 카드 폭: 끊을 수 없는 낱말이 넓을 때만 compact(136u)보다 넓히고 176u를 넘기지 않는다
{
  const H = 519;
  const u = Math.min(1.5, Math.max(1, H / 360));
  const widthOf = (sublabel) => {
    const scene = buildMapScene({ model: modelOf([point(1, { sublabel })]), width: W, height: H, activeLayer: "white", scale: true, north: 30 });
    assert.equal(scene.labelPlacements.length, 1);
    const box = scene.labelPlacements[0].box;
    return box.x1 - box.x0;
  };
  const wide = widthOf("2027년3월15일입주예정512세대분양");
  assert.ok(wide > 136 * u + 0.5 && wide <= 176 * u + 0.5, `넓은 낱말 ${wide / u}u`);
  const plain = widthOf("가까운 학교 근처 공원");
  assert.ok(plain <= 136 * u + 0.5, `일반 ${plain / u}u`);
}

console.log("test-v2-label-render: ok");
