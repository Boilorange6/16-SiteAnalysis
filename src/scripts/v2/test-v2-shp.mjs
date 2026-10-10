/**
 * SHP·zip 도우미 테스트. 실제 원천 SHP는 테스트에서 읽지 않는다(Task 11 실제 적재에서 확인).
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";

const { crsFromPrj, cleanProps, reprojectToWgs84 } = await import("../../lib/v2/ingest/shp.ts");
const { extractAll } = await import("../../lib/v2/ingest/unzip.ts");

// ─── 1. .prj → 좌표계 ──────────────────────────────────────────────────────
assert.equal(crsFromPrj('PROJCS["Korea_2000_Korea_Central_Belt_2010", GEOGCS["GCS_Korea_2000"'), "EPSG:5186");
assert.equal(crsFromPrj('PROJCS["Korea_2000_Korea_Unified_Coordinate_System",'), "EPSG:5179");
assert.equal(crsFromPrj('PROJCS["Korean_1985_Modified_Korea_Central_Belt",'), "EPSG:5174");
assert.throws(() => crsFromPrj('PROJCS["WGS_1984_UTM_Zone_52N"'), /unsupported \.prj/);
// VWorld 법정구역 SIG 실제 .prj: 이름은 다르지만 매개변수가 5186과 같다
assert.equal(
  crsFromPrj('PROJCS["KGD2002_Central_Belt_2010",GEOGCS["GCS_KGD2002",DATUM["D_Korea_Geodetic_Datum_2002",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]'),
  "EPSG:5186",
);
// 이름을 모르는 WKT도 매개변수가 5179면 5179
assert.equal(
  crsFromPrj('PROJCS["Unknown_Name",GEOGCS["G",DATUM["D",SPHEROID["GRS_1980",6378137.0,298.257222101]]],PARAMETER["latitude_of_origin",38.0],PARAMETER["central_meridian",127.5],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",1000000.0],PARAMETER["false_northing",2000000.0]]'),
  "EPSG:5179",
);

// ─── 2. 속성 정리: NUL 제거, 빈 값 null, 날짜 ───────────────────────────────
assert.deepEqual(cleanProps({ A1: "3611033025103020002", A8: "\u0000\u0000\u0000", A9: null, A12: 0, A24: "  ", A3: new Date("2026-09-05T15:00:00.000Z") }), {
  A1: "3611033025103020002", A8: null, A9: null, A12: 0, A24: null, A3: "2026-09-05",
});

// ─── 3. 재투영: EPSG:5186 원점(200000, 600000) = 동경 127°, 북위 38° ──────────
{
  const g = reprojectToWgs84({ type: "Point", coordinates: [200000, 600000] }, "EPSG:5186");
  assert.ok(Math.abs(g.coordinates[0] - 127) < 1e-6 && Math.abs(g.coordinates[1] - 38) < 1e-6, JSON.stringify(g.coordinates));
  const poly = reprojectToWgs84({ type: "Polygon", coordinates: [[[200000, 600000], [200100, 600000], [200100, 600100], [200000, 600000]]] }, "EPSG:5186");
  assert.equal(poly.coordinates[0].length, 4);
  assert.throws(() => reprojectToWgs84({ type: "GeometryCollection", geometries: [] }, "EPSG:5186"), /GeometryCollection/);
}

// ─── 4. 중첩 zip 해제, 두 번째는 건너뜀 ─────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), "v2-unzip-"));
  const inner = new JSZip();
  inner.file("AL_D001_00_20260909(EMD).dbf", "dbf-bytes");
  const outer = new JSZip();
  outer.file("AL_D001_00_20260909(EMD).zip", await inner.generateAsync({ type: "nodebuffer" }));
  writeFileSync(join(dir, "legal_dong_20260909.zip"), await outer.generateAsync({ type: "nodebuffer" }));

  const first = extractAll(dir);
  assert.equal(first.length, 2, "바깥 zip + 안쪽 zip");
  const extracted = join(dir, "legal_dong_20260909", "AL_D001_00_20260909(EMD)", "AL_D001_00_20260909(EMD).dbf");
  assert.equal(readFileSync(extracted, "utf8"), "dbf-bytes");
  assert.deepEqual(extractAll(dir), [], "이미 푼 zip은 다시 풀지 않는다");
  assert.ok(existsSync(join(dir, "legal_dong_20260909", ".extracted")));
}

console.log("✓ v2 shp");
