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
console.log("poi-cache: all tests passed");
try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows: better-sqlite3 WAL 핸들이 열려 있으면 EPERM — 임시폴더는 OS가 정리 */ }
