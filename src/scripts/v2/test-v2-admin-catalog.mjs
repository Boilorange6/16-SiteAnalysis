import assert from "node:assert/strict";
import { TILE_CATALOG, TILE_CODES, TILE_FORM_LABELS } from "../../lib/v2/ui/tile-catalog.ts";

for (const code of TILE_CODES) {
  const forms = TILE_CATALOG[code].forms;
  assert.ok(forms.length >= 1, `${code} forms`);
  for (const form of forms) assert.ok(Object.hasOwn(TILE_FORM_LABELS, form), `${code} form ${form}`);
}

assert.deepEqual(TILE_CATALOG.D01.forms, ["aerial"]);
assert.deepEqual(TILE_CATALOG.D10.forms, ["aerial", "raster", "vector"]);
assert.deepEqual(TILE_CATALOG.D17.forms, ["vector", "section"]);
assert.deepEqual(TILE_CATALOG.D22.forms, ["chart"]);
assert.deepEqual(TILE_CATALOG.S01.forms, ["3d"]);
for (const code of ["S02", "S03", "S04", "D29"]) assert.ok(TILE_CATALOG[code].forms.includes("raster"), `${code} raster`);
for (const code of TILE_CODES.filter((value) => value.startsWith("A") || value.startsWith("D"))) {
  if (["D01", "D10", "D17", "D22", "D29"].includes(code)) continue;
  assert.deepEqual(TILE_CATALOG[code].forms, ["vector"], `${code} vector`);
}

assert.ok(TILE_CATALOG.S03.sources.includes("building"));
assert.ok(TILE_CATALOG.S03.sources.includes("building_juso"));
assert.ok(TILE_CATALOG.S03.sources.includes("terrain_tiles"));
assert.ok(TILE_CATALOG.S02.sources.includes("terrain_tiles"));
assert.ok(!TILE_CATALOG.D10.sources.includes("parcel_polygon"));
assert.ok(TILE_CATALOG.S04.sources.includes("terrain_tiles"));
assert.ok(TILE_CATALOG.S04.sources.includes("vworld_wmts"));
assert.ok(TILE_CATALOG.A12.sources.includes("parcel_polygon"));
assert.deepEqual(TILE_CATALOG.A09.sources, [
  "mzone_zone",
  "mzone_redevelopment",
  "mzone_promotion",
  "mzone_planned",
  "mzone_improvement",
  "maintenance_integrated",
  "maintenance_std",
  "seoul_plan_zone",
]);

console.log("✓ admin catalog forms and sources");
