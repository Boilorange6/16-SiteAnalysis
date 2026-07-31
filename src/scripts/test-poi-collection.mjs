import assert from "node:assert/strict";

import { collectSourcesInParallel } from "../lib/server/poi-collection.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 독립 원천은 동시에 시작된다 (순차 대기 금지) ──────────────────────────
{
  let running = 0;
  let peak = 0;
  const makeTask = (name, delay) => ({
    name,
    run: async () => {
      running += 1;
      peak = Math.max(peak, running);
      await wait(delay);
      running -= 1;
      return { pois: [{ id: name }] };
    },
  });

  const start = Date.now();
  const result = await collectSourcesInParallel([
    makeTask("park", 60), makeTask("maintenance", 60), makeTask("osm", 60), makeTask("residential", 60),
  ]);
  const elapsed = Date.now() - start;

  assert.equal(peak, 4, "4개 원천이 동시에 실행되어야 한다");
  assert.ok(elapsed < 200, `총 소요가 합계(240ms)가 아니라 최대치에 가까워야 한다 (실제 ${elapsed}ms)`);
  assert.equal(result.pois.length, 4);
}

// ── 결과 순서는 선언 순서를 따른다 (실행 완료 순서가 아니라) ──────────────
{
  const result = await collectSourcesInParallel([
    { name: "slow", run: async () => { await wait(50); return { pois: [{ id: "slow" }] }; } },
    { name: "fast", run: async () => ({ pois: [{ id: "fast" }] }) },
  ]);
  assert.deepEqual(result.pois.map((p) => p.id), ["slow", "fast"],
    "POI 순서는 선언 순서여야 지도·보고서 결과가 안정적이다");
}

// ── 한 원천이 실패해도 나머지는 살아남는다 ────────────────────────────────
{
  const result = await collectSourcesInParallel([
    { name: "park", run: async () => { throw new Error("overpass 장애"); } },
    { name: "osm", run: async () => ({ pois: [{ id: "ok" }] }) },
  ]);
  assert.equal(result.pois.length, 1, "성공한 원천 결과는 보존되어야 한다");
  assert.deepEqual(result.warnings, ["park"], "실패한 원천은 경고로 보고되어야 한다");
}

// ── 원천이 반환한 sources·warnings·catalog를 병합한다 ─────────────────────
{
  const result = await collectSourcesInParallel([
    {
      name: "maintenance",
      run: async () => ({
        pois: [{ id: "m" }],
        sources: [{ source: "maintenance_seoul", status: "fresh", fetchedAt: 1 }],
        warnings: ["정비사업 소스 실패: maintenance_busan"],
        catalog: [{ id: "c1" }],
      }),
    },
    {
      name: "park",
      run: async () => ({ pois: [], sources: [{ source: "park", status: "cached", fetchedAt: 2 }] }),
    },
  ]);
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.warnings, ["정비사업 소스 실패: maintenance_busan"]);
  assert.equal(result.catalog.length, 1);
}

// ── 실행 시점에 이미 취소된 요청은 원천을 부르지 않는다 ───────────────────
{
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const result = await collectSourcesInParallel(
    [{ name: "osm", run: async () => { called = true; return { pois: [] }; } }],
    { signal: controller.signal },
  );
  assert.equal(called, false, "취소된 요청은 외부 API를 호출하지 않아야 한다");
  assert.equal(result.aborted, true);
}

// ── 원천이 끝날 때마다 진행 이벤트를 방출한다 (완료를 기다리지 않는다) ────
{
  const events = [];
  const result = await collectSourcesInParallel(
    [
      { name: "osm", run: async () => { await wait(40); return { pois: [{ id: "a" }] }; } },
      { name: "park", run: async () => ({ pois: [{ id: "b" }, { id: "c" }] }) },
      { name: "maintenance", run: async () => { throw new Error("장애"); } },
    ],
    { onProgress: (event) => events.push(event) },
  );

  assert.equal(events.length, 3, "원천 수만큼 진행 이벤트가 있어야 한다");
  // 빨리 끝난 원천이 먼저 보고된다 — 사용자가 대기 중 상황을 알 수 있어야 한다
  assert.equal(events[0].name, "park", "먼저 끝난 원천이 먼저 보고되어야 한다");
  assert.equal(events[0].ok, true);
  assert.equal(events[0].poiCount, 2);
  assert.equal(events[0].done, 1);
  assert.equal(events[0].total, 3);

  const failed = events.find((e) => e.name === "maintenance");
  assert.equal(failed.ok, false, "실패한 원천도 진행 이벤트로 알려야 한다");

  const last = events.at(-1);
  assert.equal(last.done, 3, "마지막 이벤트의 done은 total과 같아야 한다");
  assert.equal(result.pois.length, 3);
}

// ── 빈 목록도 안전하다 ────────────────────────────────────────────────────
{
  const result = await collectSourcesInParallel([]);
  assert.deepEqual(result.pois, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.aborted, false);
}

console.log("test-poi-collection: all assertions passed");
