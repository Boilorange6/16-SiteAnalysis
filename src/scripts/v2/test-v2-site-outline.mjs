import assert from "node:assert/strict";

const { siteOutlineFromScene } = await import("../../lib/v2/ui/site-outline.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");

const origin = { epsg: "EPSG:5179", x: 960000, y: 1950000, lng: 127, lat: 37.5 };
const sceneOf = (site, ground = { kind: "flat" }) => ({ origin, ground, site });
const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
/** 출력 점을 장면 로컬 m로 되돌린다. */
const local = (point) => { const [x, y] = toUtmk(point); return [x - origin.x, y - origin.y]; };
const near = (actual, expected, tol, message) => assert.ok(Math.abs(actual - expected) <= tol, `${message}: ${actual} vs ${expected}`);

// no-site: site가 null이거나 빈 배열이면 null
assert.equal(siteOutlineFromScene(sceneOf(null)), null);
assert.equal(siteOutlineFromScene(sceneOf([])), null);

// union: 맞닿은 두 정사각형 → 고리 1개, 꼭짓점 4개(안쪽 변 없음)
{
  const outline = siteOutlineFromScene(sceneOf([square(0, 0, 10, 10), square(10, 0, 20, 10)]));
  assert.equal(outline.rings.length, 1);
  const [ring] = outline.rings;
  assert.equal(ring.points.length, 4, "합친 직사각형의 꼭짓점은 4개");
  assert.equal(ring.elevations.length, 4);
  const xs = ring.points.map((p) => Math.round(local(p)[0])).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 0, 20, 20]);
}

// closed: 변마다 점 20개인 직사각형(닫는 점이 첫 점과 같다) → 꼭짓점 4개
{
  const ring = [];
  const edge = (ax, ay, bx, by) => { for (let i = 0; i < 20; i++) ring.push([ax + ((bx - ax) * i) / 20, ay + ((by - ay) * i) / 20]); };
  edge(0, 0, 100, 0); edge(100, 0, 100, 50); edge(100, 50, 0, 50); edge(0, 50, 0, 0);
  ring.push(ring[0]);
  const outline = siteOutlineFromScene(sceneOf([ring]));
  assert.equal(outline.rings[0].points.length, 4);
  assert.deepEqual(outline.rings[0].elevations, [null, null, null, null], "flat 지반은 표고 null");
}

// dem: z = 0.01·x 평면, originZ 15 → x=100 꼭짓점 16.0, x=0 꼭짓점 15.0
{
  const cols = 21, rows = 21, cellM = 10;
  const z = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z.push(0.01 * (-((cols - 1) * cellM) / 2 + c * cellM));
  const ground = { kind: "dem", cellM, cols, rows, originZ: 15, z };
  const outline = siteOutlineFromScene(sceneOf([square(0, 0, 100, 50)], ground));
  const { points, elevations } = outline.rings[0];
  assert.equal(points.length, 4);
  points.forEach((p, i) => {
    const x = Math.round(local(p)[0]);
    assert.equal(elevations[i], x === 100 ? 16 : 15, `x=${x} 꼭짓점 표고`);
  });
  // DEM 밖 꼭짓점은 null
  const outside = siteOutlineFromScene(sceneOf([square(0, 0, 500, 50)], ground));
  assert.ok(outside.rings[0].elevations.includes(null));
}

// flat: 표고는 모두 null, 꼭짓점은 그대로
{
  const outline = siteOutlineFromScene(sceneOf([square(0, 0, 100, 50)]));
  assert.equal(outline.rings[0].points.length, 4);
  assert.ok(outline.rings[0].elevations.every((e) => e === null));
}

// cache: 같은 Scene 객체는 같은 결과 객체
{
  const scene = sceneOf([square(0, 0, 100, 50)]);
  assert.equal(siteOutlineFromScene(scene), siteOutlineFromScene(scene));
  assert.notEqual(siteOutlineFromScene(sceneOf([square(0, 0, 100, 50)])), siteOutlineFromScene(scene));
}

console.log("test-v2-site-outline: ok");
