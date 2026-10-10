import assert from "node:assert/strict";

const {
  MAX_SITE_PARCELS,
  closePolygon,
  hasSelfIntersection,
  isParcelSelectionConnected,
  jibunFromPnu,
  outerBoundary,
  parcelAdjacencyGroups,
  pointOnSurface,
  polygonAreaM2,
  representativeJibun,
  selectedCenter,
  toggleParcelPnu,
} = await import("../../lib/v2/ui/site-picker.ts");
const { framedViewport, makeProjector } = await import("../../lib/v2/ui/map-projection.ts");
const { siteMarkerMode } = await import("../../components/v2/map-figure.tsx");

const parcel = (pnu, label, x, y, jimok = "대") => ({
  pnu,
  label,
  jimok,
  areaM2: 100,
  geometry: { type: "Polygon", coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]] },
});

const first = parcel("1".repeat(19), "248-2", 127, 37, "대");
const second = parcel("2".repeat(19), "248-3", 127.001, 37, "전");
const far = parcel("3".repeat(19), "250-3", 127.01, 37, "대");

assert.equal(isParcelSelectionConnected([first, second]), true, "shared edge is adjacent");
assert.equal(isParcelSelectionConnected([first, far]), false, "distant parcels are disconnected");
assert.equal(parcelAdjacencyGroups([first, second, far]).length, 2);
assert.equal(outerBoundary([first, second]).length, 1, "shared edge is removed from outer boundary");
assert.ok(polygonAreaM2([[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001], [127, 37]]) > 9000);
assert.equal(hasSelfIntersection(closePolygon([[0, 0], [1, 1], [1, 0], [0, 1]])), true);
assert.equal(hasSelfIntersection(closePolygon([[0, 0], [1, 0], [1, 1], [0, 1]])), false);
assert.equal(representativeJibun([first, second, far], "고덕동"), "고덕동 248-2 외 2필지");
assert.equal(jibunFromPnu("1174010200102480002"), "248-2");

const full = Array.from({ length: MAX_SITE_PARCELS }, (_, index) => String(index).padStart(19, "0"));
assert.equal(toggleParcelPnu(full, "9".repeat(19)).limited, true, "30 parcel cap");
assert.equal(toggleParcelPnu(full, full[0]).pnus.length, MAX_SITE_PARCELS - 1);

// W2b 실데이터 회귀: 절대 경도를 미터로 바꾼 shoelace 중심은 작은 필지에서
// 부동소수점 소실로 수십 m 벗어날 수 있다. 표식은 도형의 pointOnSurface와
// 같은 좌표를 쓰고, 같은 projector로 도형·마름모를 그려야 한다.
const godeok250 = {
  pnu: "1174010200102500000",
  label: "250",
  jimok: "대",
  areaM2: 173.2,
  geometry: {
    type: "Polygon",
    coordinates: [[[127.163286, 37.561305], [127.163443, 37.561301], [127.16344, 37.561215], [127.163439, 37.561188], [127.163281, 37.561193], [127.163286, 37.561305]]],
  },
};
const surface = pointOnSurface(godeok250.geometry);
const selected = selectedCenter([godeok250]);
assert.deepEqual(selected, surface, "선택 대지 중심은 pointOnSurface를 써야 한다");
const boundarySurface = pointOnSurface({ type: "Polygon", coordinates: [outerBoundary([godeok250])[0]] });
const viewport = framedViewport(surface, 1000 / 3.2, 1064, 474, 0.5, 0.8, 0.5);
const project = makeProjector(viewport);
assert.deepEqual(project(selected[0], selected[1]), project(boundarySurface[0], boundarySurface[1]), "같은 lng/lat가 필지 도형과 마름모에 같은 픽셀로 투영되어야 한다");
const projected = godeok250.geometry.coordinates[0].map(([lng, lat]) => project(lng, lat));
const xs = projected.map(([x]) => x);
const ys = projected.map(([, y]) => y);
assert.ok(Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 10, "173㎡ 실데이터 필지는 현재 줌에서 10px 미만이어야 한다");
assert.equal(siteMarkerMode(projected), "ring", "10px 미만 필지는 윤곽 대신 크로스헤어 링이어야 한다");

console.log("v2 site picker pure functions: ok");
