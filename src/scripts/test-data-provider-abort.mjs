/**
 * loadDynamicRegion의 취소 전파 테스트.
 * 주소를 빠르게 바꿀 때 이전 조회가 서버에서 계속 도는 문제를 막는다.
 */
import assert from "node:assert/strict";

const { loadDynamicRegion } = await import("../lib/data-provider.ts");

const originalFetch = globalThis.fetch;

function stubFetch(handler) {
  globalThis.fetch = handler;
}

// ── 전달한 signal이 실제 요청까지 도달한다 ────────────────────────────────
{
  const seenSignals = [];
  stubFetch(async (url, init) => {
    seenSignals.push(init?.signal ?? null);
    return { ok: true, status: 200, json: async () => ({ pois: [], warnings: [], sources: [] }) };
  });

  const controller = new AbortController();
  await loadDynamicRegion(37.5, 127.0, 1, { signal: controller.signal, forceRefresh: true });

  assert.ok(seenSignals.length > 0, "요청이 있어야 한다");
  assert.ok(seenSignals.every((signal) => signal === controller.signal),
    "모든 하위 요청에 동일한 AbortSignal이 전달되어야 한다");
}

// ── 이미 취소된 signal이면 네트워크를 아예 치지 않는다 ────────────────────
{
  let called = 0;
  stubFetch(async () => {
    called += 1;
    return { ok: true, status: 200, json: async () => ({ pois: [], warnings: [], sources: [] }) };
  });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadDynamicRegion(37.6, 127.1, 1, { signal: controller.signal, forceRefresh: true }),
    (error) => error.name === "AbortError",
    "취소된 요청은 AbortError로 거부되어야 한다",
  );
  assert.equal(called, 0, "취소된 요청은 fetch를 호출하지 않아야 한다");
}

// ── 취소 중 발생한 오류는 메모리 캐시를 오염시키지 않는다 ─────────────────
{
  const controller = new AbortController();
  stubFetch(async () => {
    controller.abort();
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  });

  await assert.rejects(
    loadDynamicRegion(37.7, 127.2, 1, { signal: controller.signal, forceRefresh: true }),
    (error) => error.name === "AbortError",
  );

  // 같은 좌표를 정상 조회하면 취소된 결과가 아니라 새 결과를 받아야 한다
  stubFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ pois: [{ id: "fresh", name: "새 결과", lat: 37.7, lng: 127.2, category: "subway", line: "1", lineColor: "#000" }], warnings: [], sources: [] }),
  }));
  const region = await loadDynamicRegion(37.7, 127.2, 1, {});
  assert.equal(region.subwayStations.length, 1, "취소된 조회가 캐시에 남으면 안 된다");
}

globalThis.fetch = originalFetch;
console.log("test-data-provider-abort: all assertions passed");
