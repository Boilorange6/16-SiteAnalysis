/** 라벨 공용 엔진 함수: 도형까지 거리, 범주별 최근접, 면 상한에서 우선순위 2 보존. */
import assert from "node:assert/strict";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { distanceToGeometryM, distanceToLineM } = await import("../../lib/v2/engine/tiles/geo.ts");
const { nearestPerGroup, nearestN, capPolygons } = await import("../../lib/v2/engine/tiles/common.ts");

const center = [127.0, 37.5];
const [cx, cy] = toUtmk(center);
const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// 면
const inside = { type: "Polygon", coordinates: [square(cx - 50, cy - 50, cx + 50, cy + 50)] };
assert.equal(distanceToGeometryM(center, inside), 0);
const east = { type: "Polygon", coordinates: [square(cx + 100, cy - 50, cx + 200, cy + 50)] };
near(distanceToGeometryM(center, east), 100);
const holed = { type: "Polygon", coordinates: [square(cx - 100, cy - 100, cx + 100, cy + 100), square(cx - 20, cy - 20, cx + 20, cy + 20)] };
near(distanceToGeometryM(center, holed), 20);
const multi = { type: "MultiPolygon", coordinates: [east.coordinates, [square(cx - 300, cy - 10, cx - 60, cy + 10)]] };
near(distanceToGeometryM(center, multi), 60);

// 선·점·빈 도형
const line = { type: "LineString", coordinates: [[cx + 30, cy - 100], [cx + 30, cy + 100]] };
assert.equal(distanceToGeometryM(center, line), distanceToLineM(center, line));
near(distanceToGeometryM(center, line), 30);
near(distanceToGeometryM(center, { type: "Point", coordinates: [cx + 30, cy + 40] }), 50);
assert.equal(distanceToGeometryM(center, { type: "GeometryCollection", geometries: [] }), null);

// 범주별 최근접
const rows = [
  { id: 7, g: "a", d: 10 },
  { id: 3, g: "a", d: 10 },
  { id: 5, g: "a", d: 20 },
  { id: 1, g: null, d: 1 },
  { id: 2, g: "b", d: null },
  { id: 4, g: "c", d: 5 },
];
const per = nearestPerGroup(rows, (r) => r.g, (r) => r.d, (r) => r.id);
assert.deepEqual([...per.keys()].sort(), ["a", "c"]);
assert.equal(per.get("a").id, 3);

const five = [{ id: 9, d: 50 }, { id: 4, d: 10 }, { id: 2, d: 10 }, { id: 8, d: 30 }, { id: 1, d: 40 }];
assert.deepEqual(nearestN(five, (r) => r.d, 3, (r) => r.id).map((r) => r.id), [2, 4, 8]);

// 면 상한
const [lng0, lat0] = toLngLat([cx, cy]);
const cand = (id, areaM2, labelPriority, layer = "bldg_footprint") => ({
  id,
  areaM2,
  p: { layer, rings: [[[lng0, lat0], [lng0 + 1e-4, lat0], [lng0 + 1e-4, lat0 + 1e-4], [lng0, lat0]]], label: null, labelPriority },
});
const compare = (a, b) => b.areaM2 - a.areaM2 || a.id - b.id;
const many = Array.from({ length: 3001 }, (_, i) => cand(i, 1000 + (i % 97), 0));
many[2999] = cand(9999, 1, 2);
const capped = capPolygons(many, 3000);
assert.equal(capped.polygons.length, 3000);
assert.equal(capped.total, 3001);
assert.ok(capped.polygons.some((p) => p.fid === "9999"));
// 출력 = 남긴 집합을 지금 비교로 정렬한 것
const keptIds = new Set(capped.polygons.map((p) => p.fid));
const expected = many.filter((c) => keptIds.has(String(c.id))).sort(compare).map((c) => String(c.id));
assert.deepEqual(capped.polygons.map((p) => p.fid), expected);

// 상한 이하면 지금 비교 정렬과 같다
const few = Array.from({ length: 3000 }, (_, i) => cand(i, 500 + ((i * 7) % 101), i % 3));
const under = capPolygons(few, 3000);
assert.deepEqual(under.polygons, [...few].sort(compare).map((c) => ({ ...c.p, fid: String(c.id) })));

console.log("test-v2-nearest-labels: ok");
