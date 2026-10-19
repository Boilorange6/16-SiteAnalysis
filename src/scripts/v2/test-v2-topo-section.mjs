import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { TopoDemReader } = await import("../../lib/v2/topo/dem.ts");
const { terrainSections } = await import("../../lib/v2/engine/tiles/terrain-section.ts");
const { terrainSectionPosition } = await import("../../lib/v2/ui/terrain-section.ts");

const RADIUS_M = 800;

function coneDem(center, halfSpanM = 1_200, cellM = 5) {
  const [cx, cy] = toUtmk(center);
  const x0 = cx - halfSpanM;
  const y0 = cy - halfSpanM;
  const cols = Math.ceil((2 * halfSpanM) / cellM);
  const rows = cols;
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = x0 + (col + 0.5) * cellM;
      const y = y0 + (row + 0.5) * cellM;
      values[row * cols + col] = 100 - Math.hypot(x - cx, y - cy) / 10;
    }
  }
  return {
    reader: new TopoDemReader({ x0, y0, cellM, cols, rows, values }),
    bbox: [x0, y0, x0 + cols * cellM, y0 + rows * cellM],
  };
}

function coverageRing(bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  return [
    toLngLat([minX, minY]),
    toLngLat([maxX, minY]),
    toLngLat([maxX, maxY]),
    toLngLat([minX, maxY]),
    toLngLat([minX, minY]),
  ];
}

function retainingHit(center) {
  const [cx, cy] = toUtmk(center);
  return {
    featureId: 901,
    stableId: "topo-fixture:retaining:1",
    kind: "topo_retaining",
    releaseId: "topo-fixture",
    name: null,
    pnu: null,
    legalCode: null,
    properties: { heightM: 4.2, kind: "retaining_wall" },
    geometry: {
      type: "LineString",
      coordinates: [[cx - 180, cy], [cx + 180, cy]],
    },
    distanceM: 0,
  };
}

function fenceWithoutHeight(center) {
  const [cx, cy] = toUtmk(center);
  return {
    featureId: 902,
    stableId: "topo-fixture:fence:1",
    kind: "topo_fence",
    releaseId: "topo-fixture",
    name: null,
    pnu: null,
    legalCode: null,
    properties: { kind: "fence" },
    geometry: {
      type: "LineString",
      coordinates: [[cx - 180, cy + 100], [cx + 180, cy + 100]],
    },
    distanceM: 0,
  };
}

function outsideParallelRetaining(center) {
  const [cx, cy] = toUtmk(center);
  return {
    featureId: 903,
    stableId: "topo-fixture:retaining:outside",
    kind: "topo_retaining",
    releaseId: "topo-fixture",
    name: null,
    pnu: null,
    legalCode: null,
    properties: { heightM: 2.5, kind: "retaining_wall" },
    geometry: {
      type: "LineString",
      coordinates: [[cx + 1_050, cy], [cx + 1_150, cy]],
    },
    distanceM: 1_100,
  };
}

function topoHandle(cone, hits) {
  const [minX, minY, maxX, maxY] = cone.bbox;
  return {
    sha256: "a".repeat(64),
    summary: {
      crs: "EPSG:5179",
      bboxUtmk: cone.bbox,
      coverageWgs84: coverageRing(cone.bbox),
      counts: { topo_retaining: hits.length },
      demCells: 1,
      buildingFloorsOnePct: null,
    },
    source: {
      sourceId: "ngii_topo",
      releaseId: "ngii_topo@aaaaaaaaaaaa",
      sourceAsOf: null,
      fetchedAt: "2026-10-17T00:00:00.000Z",
    },
    hits(kinds) {
      return hits.filter((hit) => kinds.includes(hit.kind));
    },
    covers(x, y) {
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    },
    dem: cone.reader,
  };
}

const dataDir = mkdtempSync(join(tmpdir(), "v2-t10-topo-section-"));
await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true, terrain: true });
const manifest = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, manifest, "t10-section", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: RADIUS_M,
  analysisDate: "2026-10-01",
  pnu: null,
}, {}, { topo: null });
const cone = coneDem(CENTER);
ctx.close();

const topoCtx = new EngineContext(dataDir, manifest, "t10-section-topo", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: RADIUS_M,
  analysisDate: "2026-10-01",
  pnu: null,
  }, {}, { topo: topoHandle(cone, [retainingHit(CENTER), fenceWithoutHeight(CENTER)]) });
try {
  const [cx, cy] = toUtmk(CENTER);
  const site = {
    type: "Polygon",
    coordinates: [[
      [cx - 100, cy - 80],
      [cx + 100, cy - 80],
      [cx + 100, cy + 80],
      [cx - 100, cy + 80],
      [cx - 100, cy - 80],
    ]],
  };
  const sections = terrainSections(topoCtx, site);
  assert.equal(sections.A.samples.length, Math.floor((2.4 * RADIUS_M) / 5) + 1);
  const edgeSite = {
    type: "Polygon",
    coordinates: [[
      [cx - 1_500, cy - 50],
      [cx + 1_500, cy - 50],
      [cx + 1_500, cy + 50],
      [cx - 1_500, cy + 50],
      [cx - 1_500, cy - 50],
    ]],
  };
  const edgeSection = terrainSections(topoCtx, edgeSite).A;
  assert.deepEqual(edgeSection.siteSpan, [0, 2.4 * RADIUS_M], "site span is clipped to the section endpoints");
  assert.equal(sections.A.crossings[0]?.kind, "retaining");
  assert.equal(sections.A.crossings[0]?.heightM, 4.2);
  const fenceCrossing = sections.B.crossings.find((crossing) => crossing.kind === "fence");
  assert.ok(fenceCrossing);
  assert.equal(fenceCrossing.heightM, null, "missing height stays unknown");

  const formatterA = { axis: "EW", from: [0, 0], to: [2_400, 0], samples: [], siteSpan: [1_000, 1_400], crossings: [] };
  const formatterB = { axis: "NS", from: [0, 0], to: [0, 2_400], samples: [], siteSpan: [1_000, 1_400], crossings: [] };
  const farWest = terrainSectionPosition(formatterA, 64);
  assert.equal(farWest, "서쪽 1.1 km", "A 단면은 좌표상 서쪽 끝을 판정하고 1,136m를 1.1 km로 표시");
  assert.equal(terrainSectionPosition(formatterB, 1_800), "북쪽 600m", "B 단면은 좌표상 북쪽 끝을 판정");

  const triangle = {
    type: "Polygon",
    coordinates: [[
      [cx - 200, cy - 100],
      [cx + 200, cy - 100],
      [cx, cy + 100],
      [cx - 200, cy - 100],
    ]],
  };
  const triangleSpan = terrainSections(topoCtx, triangle).A.siteSpan;
  assert.ok(triangleSpan[1] - triangleSpan[0] < 400, "site span follows the scanline, not the polygon bbox");

  const outsideCtx = new EngineContext(dataDir, manifest, "t10-section-outside", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: RADIUS_M,
    analysisDate: "2026-10-01",
    pnu: null,
  }, {}, { topo: topoHandle(cone, [outsideParallelRetaining(CENTER)]) });
  try {
    assert.deepEqual(terrainSections(outsideCtx, site).A.crossings, [], "parallel facilities outside the profile are excluded");
  } finally {
    outsideCtx.close();
  }

  const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
  const { initBoard, boardReducer, serializeBoardState, restoreBoardState } = await import("../../lib/v2/ui/board-state.ts");
  const d17 = { ...GODEOK_RESULTS[0], tileId: "t-D17-t10", tileCode: "D17" };
  const boardResults = [...GODEOK_RESULTS, d17];
  const selected = boardReducer(initBoard(boardResults), { type: "terrainSection", id: d17.tileId, section: "B" });
  assert.equal(restoreBoardState(boardResults, serializeBoardState(selected)).terrainSection[d17.tileId], "B");
} finally {
  topoCtx.close();
}

const [nodataX, nodataY] = toUtmk(CENTER);
const nodataValues = new Float32Array(480 * 480);
nodataValues.fill(Number.NaN);
const nodataReader = new TopoDemReader({ x0: nodataX - 1_200, y0: nodataY - 1_200, cellM: 5, cols: 480, rows: 480, values: nodataValues });
const nodataTopo = topoHandle({ bbox: [nodataX - 1_200, nodataY - 1_200, nodataX + 1_200, nodataY + 1_200], reader: nodataReader }, []);
const nodataCtx = {
  input: { radiusM: RADIUS_M },
  topo: nodataTopo,
  memo(_key, compute) { return compute(); },
  db() { return null; },
};
const nodataSections = terrainSections(nodataCtx, {
  type: "Polygon",
  coordinates: [[
    [nodataX - 100, nodataY - 80],
    [nodataX + 100, nodataY - 80],
    [nodataX + 100, nodataY + 80],
    [nodataX - 100, nodataY + 80],
    [nodataX - 100, nodataY - 80],
  ]],
});
assert.ok(nodataSections.A.samples.every((sample) => sample.z === null), "DEM nodata remains null in the section profile");

console.log("✓ v2 topo terrain section");
