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

// 1) miss → null
assert.equal(getCachedSource("osm", 37.5665, 126.978, 3000), null);

// 2) set 후 hit — 좌표 4자리 반올림 동일 키
setCachedSource("osm", 37.5665, 126.978, 3000, [{ id: "p1" }]);
const hit = getCachedSource("osm", 37.56652, 126.97801, 3000); // 4자리 반올림 시 동일
assert.ok(hit && Array.isArray(hit.value) && hit.value[0].id === "p1");
assert.ok(typeof hit.fetchedAt === "number");

// 3) 다른 반경 → miss
assert.equal(getCachedSource("osm", 37.5665, 126.978, 2000), null);

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
assert.equal(getCachedSource("osm", 37.5665, 126.978, 3000).value[0].id, "live");

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

assert.ok(POI_CACHE_TTL_MS === 7 * 24 * 60 * 60 * 1000);
console.log("poi-cache: all tests passed");
rmSync(dir, { recursive: true, force: true });
