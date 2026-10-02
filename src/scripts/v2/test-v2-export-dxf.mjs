import assert from "node:assert/strict";

const { DXF_LAYERS, dxfFileName, sceneToDxf } = await import("../../lib/v2/export/dxf.ts");
const { maxOf } = await import("../../lib/v2/extent.ts");

const scene = {
  version: "v2-scene@2",
  analysisId: "analysis-dxf-1",
  manifestHash: "manifest-hash-abcdef1234567890",
  origin: { epsg: "EPSG:5179", x: 930000.12, y: 1810000.34, lng: 127.1, lat: 37.5 },
  radiusM: 800,
  ground: {
    kind: "dem",
    cellM: 10,
    cols: 3,
    rows: 3,
    originZ: 50,
    z: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    resolutionM: 30,
    vertical: "EGM96",
    sourceId: "terrain:fixture",
  },
  site: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
  buildings: [
    {
      id: "building-40m",
      rings: [[[1, 1], [9, 1], [9, 9], [1, 9]]],
      baseZ: 2.5,
      heightM: 40,
      heightMethod: "source",
      floorsAbove: 12,
      useCode: "02000",
      approvalDate: "2020-01-01",
    },
    {
      id: "building-unknown",
      rings: [[[11, 1], [19, 1], [19, 9], [11, 9]]],
      baseZ: 0,
      heightM: null,
      heightMethod: "unknown",
      floorsAbove: null,
      useCode: null,
      approvalDate: null,
    },
  ],
  parcels: [
    { pnu: "1111010100100010000", rings: [[[0, 0], [20, 0], [20, 20], [0, 20]]], jimok: "대", areaM2: 400, isSite: true },
  ],
  counts: { buildingsTotal: 2, buildingsIncluded: 2, parcelsTotal: 1, parcelsIncluded: 1 },
  sources: [],
  limitations: [],
};

const dxf = sceneToDxf(scene);
assert.match(dxf, /AC1015/);
assert.match(dxf, /\$HANDSEED\r\n\s*5\r\n[0-9A-F]+\r\n/);
const handseedValue = dxf.match(/\$HANDSEED\r\n\s*5\r\n([0-9A-F]+)\r\n/)?.[1];
const handles = [...dxf.matchAll(/\r\n\s*5\r\n([0-9A-F]+)\r\n/g)].map((match) => match[1]).filter((handle) => handle !== handseedValue);
assert.ok(handles.length > 10, "R2000 구조와 엔티티에 핸들이 있어야 한다");
assert.equal(new Set(handles).size, handles.length, "핸들은 중복되지 않아야 한다");
const handseed = Number.parseInt(handseedValue, 16);
assert.ok(handseed > maxOf(handles.map((handle) => Number.parseInt(handle, 16))), "HANDSEED는 다음 핸들이어야 한다");
assert.match(dxf, /\$INSUNITS\r\n 70\r\n     6/);
assert.match(dxf, /100\r\nAcDbEntity\r\n/);
assert.match(dxf, /100\r\nAcDbPolyline\r\n/);
assert.match(dxf, /TABLES[\s\S]*TABLE\r\n  2\r\nBLOCK_RECORD[\s\S]*\*Model_Space[\s\S]*\*Paper_Space/);
assert.match(dxf, /SECTION\r\n  2\r\nBLOCKS\r\n[\s\S]*BLOCK\r\n[\s\S]*\*Model_Space[\s\S]*\*Paper_Space/);
assert.match(dxf, /SECTION\r\n  2\r\nOBJECTS\r\n[\s\S]*0\r\nDICTIONARY\r\n  5\r\n[0-9A-F]+\r\n330\r\n     0\r\n100\r\nAcDbDictionary/);
assert.match(dxf, /\r\n$/);
assert.ok(!dxf.includes("\n\n"), "DXF는 빈 줄 없이 CRLF 레코드여야 한다");
for (const layer of Object.values(DXF_LAYERS)) assert.match(dxf, new RegExp(`\\n\\s*2\\r\\n${layer}\\r\\n`));
assert.equal((dxf.match(/LWPOLYLINE/g) ?? []).length, 3, "2동 + 1필지 고리");
assert.equal((dxf.match(/\r\n\s*39\r\n40\.00\r\n/g) ?? []).length, 1, "높이 40m 건물에만 두께");
assert.match(dxf, /8\r\nBLDG_NOHEIGHT\r\n/);
assert.match(dxf, /8\r\nSITE\r\n/);
assert.match(dxf, /8\r\nTERRAIN\r\n/);
assert.match(dxf, /CIRCLE/);
assert.match(dxf, /POINT/);
assert.match(dxf, /TEXT/);
assert.match(dxf, /origin EPSG:5179 E=930000\.12 N=1810000\.34; unit m; north=\+Y; manifest manifest-has; scene v2-scene@2; ground dem 30m EGM96 originZ=50\.00/);
assert.equal((dxf.match(/3DFACE/g) ?? []).length, 8, "3x3 DEM 격자의 유효 셀 4개를 두 삼각형씩 출력");
assert.match(dxf, /\r\n\s*38\r\n2\.50\r\n/, "DEM 건물은 바닥 상대 표고를 38 코드로 출력");
assert.match(dxf, /EOF\r\n$/);
assert.match(dxf, /\r\n\s*10\r\n1\.00\r\n\s*20\r\n1\.00/, "기본 site 원점은 로컬 좌표를 유지");

const estimated = sceneToDxf({
  ...scene,
  buildings: [{ ...scene.buildings[0], heightM: 12, heightMethod: "floors_estimate" }],
});
assert.match(estimated, /8\r\nBLDG_EST\r\n/);
assert.match(estimated, /\r\n\s*39\r\n12\.00\r\n/);

const siteFallback = sceneToDxf({ ...scene, buildings: [], parcels: [] });
assert.equal((siteFallback.match(/LWPOLYLINE/g) ?? []).length, 1, "parcels가 없어도 scene.site를 SITE로 출력");
assert.match(siteFallback, /8\r\nSITE\r\n/);

const nonSiteParcel = sceneToDxf({ ...scene, buildings: [], site: null, parcels: [{ ...scene.parcels[0], isSite: false }] });
assert.match(nonSiteParcel, /8\r\nPARCEL\r\n/);

const flatScene = {
  ...scene,
  version: "v2-scene@2",
  ground: { kind: "flat" },
  buildings: scene.buildings.map((building) => ({ ...building, baseZ: null })),
};
const flatDxf = sceneToDxf(flatScene);
assert.match(flatDxf, /ground flat/);
assert.doesNotMatch(flatDxf, /\r\n\s*38\r\n/, "flat 지반에는 건물 바닥 표고를 넣지 않는다");
assert.equal((flatDxf.match(/3DFACE/g) ?? []).length, 0, "flat 지반에는 TERRAIN 3DFACE가 없다");

const absolute = sceneToDxf(scene, { origin: "utmk" });
assert.match(absolute, /10\r\n930001\.12\r\n\s*20\r\n1810001\.34/);
assert.match(absolute, /10\r\n930000\.12\r\n\s*20\r\n1810000\.34/);

assert.equal(dxfFileName("서울특별시 강남구/테스트", "2026-09-30"), "사이트분석_서울특별시_강남구_테스트_20260930.dxf");
assert.equal(dxfFileName(" 주소 ", "20260930"), "사이트분석_주소_20260930.dxf");

console.log("✓ v2 DXF export");
