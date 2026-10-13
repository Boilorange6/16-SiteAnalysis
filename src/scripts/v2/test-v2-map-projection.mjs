import assert from "node:assert/strict";

const P = await import("../../lib/v2/ui/map-projection.ts");

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const center = [127.1546, 37.5556];
const base = P.framedViewport(center, 1000, 800, 500);

// ── view 없음·0은 기존 뷰포트와 동일하고, 줌만 바꾸면 중심은 유지 ──
{
  assert.strictEqual(P.applyView(base, center[1]), base);
  assert.deepEqual(P.applyView(base, center[1], { zoomDelta: 0, offsetM: [0, 0] }), base);
  const zoomed = P.applyView(base, center[1], { zoomDelta: 2, offsetM: [0, 0] });
  near(zoomed.zoom, base.zoom + 2);
  assert.deepEqual(zoomed.center, base.center);
}

// ── 동·북 미터 오프셋: 투영 기준이 같으므로 역방향 적용 시 왕복 ──
{
  const moved = P.applyView(base, center[1], { zoomDelta: 0, offsetM: [125, 240] });
  assert.ok(moved.center[0] > base.center[0], "동쪽 오프셋은 중심 경도를 키운다");
  assert.ok(moved.center[1] > base.center[1], "북쪽 오프셋은 중심 위도를 키운다");
  const roundTrip = P.applyView(moved, center[1], { zoomDelta: 0, offsetM: [-125, -240] });
  near(roundTrip.center[0], base.center[0], 1e-10);
  near(roundTrip.center[1], base.center[1], 1e-10);
  near(roundTrip.zoom, base.zoom);
}

// ── 반경 원·줌 상한 clamp ──
{
  const clamped = P.clampView({ zoomDelta: 9, offsetM: [300, 400] }, 250, 3);
  near(clamped.zoomDelta, 3);
  near(Math.hypot(...clamped.offsetM), 250);
  near(clamped.offsetM[0], 150);
  near(clamped.offsetM[1], 200);
  assert.deepEqual(P.clampView({ zoomDelta: -1, offsetM: [10, 20] }, 250, 3), { zoomDelta: 0, offsetM: [10, 20] });
}

// ── 절대 상한 식과 래스터 셀 12 px 상한 ──
{
  near(P.maxZoomFor(base, { maxDelta: 3 }), Math.min(base.zoom + 3, 19));
  near(P.maxZoomFor(base.zoom, { maxDelta: 3 }), Math.min(base.zoom + 3, 19));
  near(P.maxZoomFor(base, { maxDelta: 9, maxAbsZoom: 16 }), 16);
  const raster4m = P.maxZoomFor(base, { maxDelta: 9 }, 4);
  const expected4m = Math.min(base.zoom + 9, 19, Math.log2((12 * 156543.03392804097 * Math.cos((center[1] * Math.PI) / 180)) / 4));
  near(raster4m, expected4m);
  assert.ok(raster4m < 19 && raster4m > 18, `4m raster cap ${raster4m}`);
}

console.log("✓ v2 map projection view contract");
