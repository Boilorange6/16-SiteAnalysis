import assert from "node:assert/strict";

const {
  MAX_SITE_PARCELS,
  closePolygon,
  hasSelfIntersection,
  isParcelSelectionConnected,
  jibunFromPnu,
  outerBoundary,
  parcelAdjacencyGroups,
  polygonAreaM2,
  representativeJibun,
  toggleParcelPnu,
} = await import("../../lib/v2/ui/site-picker.ts");

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

console.log("v2 site picker pure functions: ok");
