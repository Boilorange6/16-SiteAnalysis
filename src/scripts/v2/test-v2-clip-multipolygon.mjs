/** MultiPolygon 반경 절단: bboxClip의 빈 조각·짧은 링 회귀와 WGS84/5179 areaInCircle 계약. */
import assert from "node:assert/strict";
import { bboxClip, multiPolygon } from "@turf/turf";

const { areaInCircle, clipToCircle } = await import("../../lib/v2/engine/tiles/geo.ts");
const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");

const CENTER = [127.1634, 37.5612];
const RADIUS_M = 1_000;
const [cx, cy] = toUtmk(CENTER);

const rectangle = (x0, x1, y0, y1) => [[
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]];

// The second component is valid input but outside the bboxClip window, which
// makes Turf return an empty component alongside the two usable components.
const multiPolygon5179 = {
  type: "MultiPolygon",
  coordinates: [
    rectangle(cx - 700, cx + 700, cy - 700, cy + 700),
    rectangle(cx + 2_000, cx + 2_200, cy - 100, cy + 100),
    rectangle(cx + 700, cx + 1_100, cy + 700, cy + 1_100),
  ],
};

const bbox = [cx - RADIUS_M, cy - RADIUS_M, cx + RADIUS_M, cy + RADIUS_M];
const rawClipped = bboxClip(multiPolygon(multiPolygon5179.coordinates), bbox);
assert.ok(rawClipped.geometry.coordinates.some((part) => part.length === 0), "fixture must reproduce bboxClip's empty MultiPolygon part");

const clipped = clipToCircle(CENTER, RADIUS_M, multiPolygon5179);
assert.ok(clipped && clipped.length > 0, "valid components survive an empty bboxClip component");
for (const rings of clipped) {
  assert.ok(rings.length > 0, "no empty polygon component is returned");
  for (const ring of rings) assert.ok(ring.length >= 4, "no short ring is returned");
}

const empty = { type: "MultiPolygon", coordinates: [] };
assert.deepEqual(clipToCircle(CENTER, RADIUS_M, empty), [], "empty geometry has no clipped area");
const outside = { type: "MultiPolygon", coordinates: [rectangle(cx + 2_000, cx + 2_200, cy - 100, cy + 100)] };
assert.deepEqual(clipToCircle(CENTER, RADIUS_M, outside), [], "fully outside component has no clipped area");
const shortRing = {
  type: "Polygon",
  coordinates: [[[cx - 100, cy - 100], [cx + 100, cy - 100], [cx, cy + 100]]],
};
assert.deepEqual(clipToCircle(CENTER, RADIUS_M, shortRing), [], "short source ring is ignored safely");

const toWgs84 = (geometry) => ({
  ...geometry,
  coordinates: geometry.coordinates.map((part) => part.map((ring) => ring.map(([x, y]) => toLngLat([x, y])))),
});
const wgs84 = toWgs84(multiPolygon5179);
const area5179 = areaInCircle(CENTER, RADIUS_M, multiPolygon5179);
const areaWgs84 = areaInCircle(CENTER, RADIUS_M, wgs84);
assert.ok(area5179 && area5179.clipped, "EPSG:5179 areaInCircle returns a clipped result");
assert.ok(areaWgs84 && areaWgs84.clipped, "WGS84 areaInCircle returns a clipped result");
assert.ok(area5179.parts.length > 0 && areaWgs84.parts.length > 0, "areaInCircle keeps the valid clipped parts");
assert.ok(area5179.areaM2 > 0 && areaWgs84.areaM2 > 0, "clipped area is non-empty");
assert.ok(Math.abs(area5179.areaM2 - areaWgs84.areaM2) < 10, "WGS84 and EPSG:5179 areas agree");

console.log("✓ v2 clip MultiPolygon");
