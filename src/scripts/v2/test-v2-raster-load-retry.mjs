/** 값 래스터 받기: 접근 토큰이 만료돼 401이면 한 번 갱신하고 다시 받는다(P3 C9 — D29 하늘열림이 세션째 사라지던 결함). */
import assert from "node:assert/strict";

const { loadRasters } = await import("../../lib/v2/report/map-image.ts");
const { RASTER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");

const palette = Object.keys(RASTER_STYLES)[0];
const model = { analysisId: "a1", tileCode: "D29", rasters: [{ name: "svf", palette, cols: 2, rows: 2, sha256: "x" }] };
const calls = [];
const originalFetch = globalThis.fetch;
const run = async (script) => {
  calls.length = 0;
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(url).replace(/^.*\/site\/api\//, "")}`);
    const status = script[i++] ?? 500;
    return new Response(new Uint8Array(4), { status });
  };
  await loadRasters(model, new Map());
};
try {
  await run([401, 200, 200]); // 래스터 401 -> 갱신 200 -> 다시 받기(내용이 가짜라 풀기는 실패해도 된다)
  assert.deepEqual(calls, ["GET v2/analyses/a1/tiles/D29/rasters/svf", "POST auth/refresh", "GET v2/analyses/a1/tiles/D29/rasters/svf"], "401이면 갱신 후 한 번 더 받는다");
  await run([401, 401]); // 갱신도 실패하면 다시 받지 않는다
  assert.deepEqual(calls, ["GET v2/analyses/a1/tiles/D29/rasters/svf", "POST auth/refresh"], "갱신 실패면 다시 받지 않는다");
  await run([200]);
  assert.deepEqual(calls, ["GET v2/analyses/a1/tiles/D29/rasters/svf"], "정상이면 갱신 호출 없음");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("test-v2-raster-load-retry: ok");
