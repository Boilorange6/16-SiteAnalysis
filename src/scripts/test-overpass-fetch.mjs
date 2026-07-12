// src/scripts/test-overpass-fetch.mjs
// 순수 로직 테스트 — 실제 네트워크 호출 없음 (fetchImpl 주입)
import assert from "node:assert/strict";

const { overpassFetch, __clearCacheForTest } = await import("../lib/server/overpass-fetch.ts").catch(async () => {
  // tsx 없이 node로 직접 실행할 수 없으므로 컴파일 우회: next 프로젝트의 관례에 따라
  // 이 테스트는 `npx tsx src/scripts/test-overpass-fetch.mjs`로 실행한다 (devDependency tsx 추가).
  throw new Error("run with: npx tsx src/scripts/test-overpass-fetch.mjs");
});

function makeFetch(responses) {
  let call = 0;
  const impl = async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? { elements: [] },
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
  impl.calls = () => call;
  return impl;
}

// 1) 성공 시 1회 호출, JSON 반환
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 200, body: { elements: [1, 2] } }]);
  const out = await overpassFetch("Q1", { fetchImpl: f, minIntervalMs: 0 });
  assert.deepEqual(out, { elements: [1, 2] });
  assert.equal(f.calls(), 1);
}

// 2) 같은 쿼리는 캐시 반환 (fetch 재호출 없음)
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 200, body: { elements: ["a"] } }]);
  await overpassFetch("Q2", { fetchImpl: f, minIntervalMs: 0 });
  const out2 = await overpassFetch("Q2", { fetchImpl: f, minIntervalMs: 0 });
  assert.deepEqual(out2, { elements: ["a"] });
  assert.equal(f.calls(), 1);
}

// 3) 429 → 재시도 후 성공 (총 2회 호출)
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 429 }, { status: 200, body: { elements: ["r"] } }]);
  const out = await overpassFetch("Q3", { fetchImpl: f, maxRetries: 2, minIntervalMs: 0 });
  assert.deepEqual(out, { elements: ["r"] });
  assert.equal(f.calls(), 2);
}

// 4) 계속 실패하면 마지막 오류 throw (maxRetries+1회 호출)
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 500 }]);
  await assert.rejects(() => overpassFetch("Q4", { fetchImpl: f, maxRetries: 2, minIntervalMs: 0 }));
  assert.equal(f.calls(), 3);
}

// 5) 실패 응답은 캐시되지 않음
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 200, body: { elements: ["ok"] } }]);
  await assert.rejects(() => overpassFetch("Q5", { fetchImpl: f, maxRetries: 2, minIntervalMs: 0 }));
  const out = await overpassFetch("Q5", { fetchImpl: f, maxRetries: 0, minIntervalMs: 0 });
  assert.deepEqual(out, { elements: ["ok"] });
}

// 6) 200 + remark(부분/타임아웃 응답)는 캐시하지 않고 재시도 대상으로 처리
{
  __clearCacheForTest();
  const f = makeFetch([
    { status: 200, body: { remark: "runtime error: query timed out", elements: [] } },
    { status: 200, body: { elements: ["ok"] } },
  ]);
  const out = await overpassFetch("Q6", { fetchImpl: f, maxRetries: 2, minIntervalMs: 0 });
  assert.deepEqual(out, { elements: ["ok"] });
  assert.equal(f.calls(), 2);
  // remark 응답이 캐시되지 않았음을 확인: 좋은 응답만 캐시에 남아 fetch 재호출 없이 반환
  const cached = await overpassFetch("Q6", { fetchImpl: f, maxRetries: 0, minIntervalMs: 0 });
  assert.deepEqual(cached, { elements: ["ok"] });
  assert.equal(f.calls(), 2);
}

console.log("overpass-fetch: all tests passed");

// --- 미러 폴백: 1차 실패 시 2번째 시도는 lz4 미러로 ---
{
  __clearCacheForTest();
  const urls = [];
  const impl = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return { ok: false, status: 429, json: async () => ({}), text: async () => "busy" };
    return { ok: true, status: 200, json: async () => ({ elements: [1] }), text: async () => "" };
  };
  const out = await overpassFetch("q-mirror", { fetchImpl: impl, minIntervalMs: 0 });
  assert.deepEqual(out, { elements: [1] });
  assert.ok(urls[0].includes("overpass-api.de") && !urls[0].includes("lz4"));
  assert.ok(urls[1].includes("lz4.overpass-api.de"));
}
// --- 최소 간격: 연속 2회 호출 사이에 minIntervalMs 이상 경과 ---
{
  __clearCacheForTest();
  const stamps = [];
  const impl = async () => {
    stamps.push(Date.now());
    return { ok: true, status: 200, json: async () => ({ elements: [] }), text: async () => "" };
  };
  await overpassFetch("q-throttle-1", { fetchImpl: impl, minIntervalMs: 120 });
  await overpassFetch("q-throttle-2", { fetchImpl: impl, minIntervalMs: 120 });
  assert.ok(stamps[1] - stamps[0] >= 100, `interval was ${stamps[1] - stamps[0]}ms`);
}
console.log("overpass-fetch: mirror/throttle tests passed");
