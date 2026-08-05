// 순수 로직 테스트 — 임시 DB 사용 (DB_PATH 환경변수로 격리)
// 실행: npx tsx src/scripts/test-poi-cache.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "poi-cache-test-"));
process.env.DB_PATH = join(dir, "test.db");

const { getCachedSource, setCachedSource, resolveSource, POI_CACHE_TTL_MS } =
  await import("../lib/server/poi-cache.ts");
const { getDb } = await import("../lib/server/database.ts");

const osmKey = { source: "osm", lat: 37.5665, lng: 126.978, radiusM: 3000 };

// 1) miss → null
assert.equal(getCachedSource(osmKey), null);

// 2) set 후 hit — 좌표 4자리 반올림 동일 키
setCachedSource({ key: osmKey, value: [{ id: "p1" }] });
const hit = getCachedSource({ ...osmKey, lat: 37.56652, lng: 126.97801 }); // 4자리 반올림 시 동일
assert.ok(hit && Array.isArray(hit.value) && hit.value[0].id === "p1");
assert.ok(typeof hit.fetchedAt === "number");
assert.equal(hit.expired, false);

// 3) 다른 반경 → miss
assert.equal(getCachedSource({ ...osmKey, radiusM: 2000 }), null);

// 3-1) 작은 반경에서는 캐시 격자도 촘촘해야 한다.
// 고정 4자리(약 11m) 격자는 반경 100m 조회에서 11% 오차 — 경계 POI가 다른 위치 결과로 재사용된다.
{
  // 37.56645와 37.56654는 4자리 반올림 시 둘 다 37.5665지만 실제로는 약 10m 떨어져 있다.
  const tight = { source: "osm-tight", lat: 37.56645, lng: 126.978, radiusM: 100 };
  setCachedSource({ key: tight, value: [{ id: "tight" }] });
  assert.equal(getCachedSource({ ...tight, lat: 37.56654 }), null,
    "반경 100m에서 약 10m 떨어진 좌표는 4자리 반올림이 같더라도 캐시를 공유하면 안 된다");
  // 0.5m 이동은 같은 조회로 봐도 된다 (기준 37.56645에서 +0.0000045도 ≈ 0.5m)
  assert.ok(getCachedSource({ ...tight, lat: 37.5664504 }),
    "반경 100m에서 1m 미만 이동은 같은 캐시를 써야 한다");
}

// 3-2) 큰 반경에서는 격자가 성글어야 한다 (캐시 적중률 유지).
// 반경 100m에서는 별개로 취급되던 약 10m 차이가, 반경 5km에서는 같은 캐시를 쓴다.
{
  const wide = { source: "osm-wide", lat: 37.56645, lng: 126.978, radiusM: 5000 };
  setCachedSource({ key: wide, value: [{ id: "wide" }] });
  assert.ok(getCachedSource({ ...wide, lat: 37.56654 }),
    "반경 5km에서 약 10m 이동은 같은 캐시를 재사용해야 한다");
}

// 4) resolveSource: 신선 캐시 있으면 fetcher를 부르지 않는다 (cache-first)
let calls = 0;
const r1 = await resolveSource({
  source: "osm", lat: 37.5665, lng: 126.978, radiusM: 3000, refresh: false,
  fetcher: async () => { calls += 1; return [{ id: "live" }]; },
});
assert.equal(r1.status, "cached");
assert.equal(calls, 0);

// 5) refresh=true → fetcher 호출 + 캐시 갱신 + status fresh
const r2 = await resolveSource({
  source: "osm", lat: 37.5665, lng: 126.978, radiusM: 3000, refresh: true,
  fetcher: async () => { calls += 1; return [{ id: "live" }]; },
});
assert.equal(r2.status, "fresh");
assert.equal(calls, 1);
assert.equal(getCachedSource(osmKey).value[0].id, "live");

// 6) 캐시 없음 + fetcher 실패 → status failed, value는 빈 배열 아님 — null 반환값 규약 확인
const r3 = await resolveSource({
  source: "park", lat: 35.0, lng: 129.0, radiusM: 3000, refresh: false,
  fetcher: async () => { throw new Error("down"); },
});
assert.equal(r3.status, "failed");
assert.equal(r3.value, null);
assert.equal(r3.fetchedAt, null);

// 7) 캐시 있음 + fetcher 실패(refresh=true) → 캐시로 폴백, status cached
const r4 = await resolveSource({
  source: "osm", lat: 37.5665, lng: 126.978, radiusM: 3000, refresh: true,
  fetcher: async () => { throw new Error("down"); },
});
assert.equal(r4.status, "cached");
assert.equal(r4.value[0].id, "live");

// 8) 만료 캐시는 기본 조회에서 숨기되, 라이브 실패 시 원래 fetchedAt으로 폴백한다.
const expiredFetchedAt = Date.now() - POI_CACHE_TTL_MS - 1_000;
getDb().prepare(`UPDATE poi_source_cache SET fetched_at = ? WHERE source = ?`).run(expiredFetchedAt, "osm");
assert.equal(getCachedSource(osmKey), null);
const expired = getCachedSource(osmKey, { includeExpired: true });
assert.ok(expired);
assert.equal(expired.expired, true);
assert.equal(expired.fetchedAt, expiredFetchedAt);

const r5 = await resolveSource({
  ...osmKey,
  refresh: false,
  fetcher: async () => { throw new Error("forced live failure"); },
});
assert.equal(r5.status, "cached");
assert.equal(r5.value[0].id, "live");
assert.equal(r5.fetchedAt, expiredFetchedAt);

// 9) 파싱할 수 없는 만료 캐시는 장애 폴백으로 사용하지 않는다.
getDb().prepare(`UPDATE poi_source_cache SET value_json = ? WHERE source = ?`).run("{invalid", "osm");
assert.equal(getCachedSource(osmKey, { includeExpired: true }), null);
const r6 = await resolveSource({
  ...osmKey,
  refresh: false,
  fetcher: async () => { throw new Error("forced live failure"); },
});
assert.equal(r6.status, "failed");
assert.equal(r6.value, null);

assert.ok(POI_CACHE_TTL_MS === 7 * 24 * 60 * 60 * 1000);

// ── 실패 로그는 원인을 담아야 한다 ────────────────────────────────────────────
// 2026-08-05 운영에서 정비사업 4개 소스가 몇 시간 동안 실패했는데, 로그가
// "fetch failed"만 남기고 오류를 통째로 버려서 원인 파악이 불가능했다.
{
  const originalWarn = console.warn;
  const lines = [];
  console.warn = (...args) => { lines.push(args.join(" ")); };
  try {
    await resolveSource({
      source: "diag_probe", lat: 1, lng: 2, radiusM: 3, refresh: false,
      fetcher: async () => { throw new Error("상류 스키마가 바뀌었다"); },
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(lines.length, 1, "실패 시 경고 한 줄");
  assert.ok(lines[0].includes("diag_probe"), "어느 소스인지 알 수 있어야 한다");
  assert.ok(
    lines[0].includes("상류 스키마가 바뀌었다"),
    `실패 사유가 로그에 있어야 한다 — 실제: ${lines[0]}`,
  );
}

console.log("poi-cache: all tests passed");
console.log("poi-cache: 실패 로그에 원인 포함 확인");
try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: better-sqlite3 WAL 핸들이 열려 있으면 EPERM — 임시폴더는 OS가 정리 */ }
