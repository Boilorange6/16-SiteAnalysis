/**
 * 배경지도 타일 프록시: 인자 검증, 캐시 경로, 키 없음 503, 상류 주소(키 포함) 비노출, 같은 출처 확인, tileUrl basePath.
 * 실행: tsx src/scripts/v2/test-v2-tiles.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTile, resetLimiter, serveTile, takeToken, tileCachePath } from "../../lib/v2/tiles.ts";
import { tileUrl } from "../../lib/v2/ui/map-projection.ts";

const KEY = "SECRETKEY-1234567890";
const ok = { layer: "white", z: "15", y: "12700", x: "27946" };

// ── 인자 검증 ──
assert.deepEqual(parseTile(ok), { layer: "white", z: 15, y: 12700, x: 27946 });
for (const bad of [
  { ...ok, layer: "Other" },
  { ...ok, layer: "__proto__" },
  { ...ok, z: "5" },
  { ...ok, z: "20" },
  { ...ok, z: "15.5" },
  { ...ok, z: "1e1" },
  { ...ok, y: "32768" }, // 2^15 이상
  { ...ok, x: "-1" },
  { ...ok, x: "27946.png" },
  { ...ok, y: "" },
]) assert.equal(parseTile(bad), null, JSON.stringify(bad));
assert.ok(parseTile({ layer: "Satellite", z: "19", y: "524287", x: "0" }));
assert.equal(parseTile({ layer: "Hybrid", z: "6", y: "64", x: "0" }), null);

// ── 캐시 경로 ──
assert.match(tileCachePath(parseTile({ ...ok, layer: "Satellite" }), "/c").replaceAll("\\", "/"), /\/c\/Satellite\/15\/12700\/27946\.jpeg$/);
assert.match(tileCachePath(parseTile(ok), "/c").replaceAll("\\", "/"), /\/c\/white\/15\/12700\/27946\.png$/);

// ── tileUrl: basePath /site, 행(y)·열(x) 순서 ──
assert.equal(tileUrl("Base", 15, 27946, 12700), "/site/api/v2/tiles/Base/15/12700/27946");

const root = await mkdtemp(join(tmpdir(), "v2tiles-"));
try {
  const png = new Uint8Array([137, 80, 78, 71]);
  let calls = [];
  const okFetch = async (url) => {
    calls.push(String(url));
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  };

  // 키 없음 → 503 (상류 호출 없음)
  resetLimiter();
  const nokey = await serveTile(ok, "same-origin", { key: undefined, fetch: okFetch, cacheRoot: root });
  assert.equal(nokey.status, 503);
  assert.equal(nokey.body, "배경지도 키 미설정");
  assert.equal(calls.length, 0);

  // 같은 출처 아님 → 403
  assert.equal((await serveTile(ok, "cross-site", { key: KEY, fetch: okFetch, cacheRoot: root })).status, 403);
  assert.equal(calls.length, 0);
  // 잘못된 인자 → 400
  assert.equal((await serveTile({ ...ok, z: "3" }, "same-origin", { key: KEY, fetch: okFetch, cacheRoot: root })).status, 400);

  // 성공: 상류 주소는 z/행/열 순서, 디스크에 저장, 두 번째는 캐시(상류 호출 없음)
  const first = await serveTile(ok, "same-origin", { key: KEY, fetch: okFetch, cacheRoot: root });
  assert.equal(first.status, 200);
  assert.equal(first.type, "image/png");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `https://api.vworld.kr/req/wmts/1.0.0/${KEY}/white/15/12700/27946.png`);
  assert.deepEqual(new Uint8Array(await readFile(tileCachePath(parseTile(ok), root))), png);
  const second = await serveTile(ok, "same-origin", { key: KEY, fetch: okFetch, cacheRoot: root });
  assert.equal(second.status, 200);
  assert.equal(calls.length, 1, "캐시 적중");

  // 상류 오류 → 502, 키·주소 비노출 (HTTP 오류, 예외, 200+XML 모두)
  const leaks = (r) => {
    const s = typeof r.body === "string" ? r.body : new TextDecoder().decode(r.body);
    return s.includes(KEY) || s.includes("vworld") || s.includes("http");
  };
  const bad = [
    async () => new Response("no", { status: 500 }),
    async (url) => {
      throw new Error(`connect failed ${url}`);
    },
    async () => new Response("<xml/>", { status: 200, headers: { "content-type": "application/xml" } }),
  ];
  for (const f of bad) {
    const r = await serveTile({ ...ok, layer: "Base", x: "27947" }, "same-origin", { key: KEY, fetch: f, cacheRoot: root });
    assert.equal(r.status, 502);
    assert.ok(!leaks(r), "키·주소 노출");
  }

  // 위성은 jpeg 확장자로 요청
  calls = [];
  const sat = await serveTile({ ...ok, layer: "Satellite" }, null, { key: KEY, fetch: okFetch, cacheRoot: root });
  assert.equal(sat.type, "image/jpeg");
  assert.match(calls[0], /\/Satellite\/15\/12700\/27946\.jpeg$/);
} finally {
  await rm(root, { recursive: true, force: true });
}

// 세션도 없고 요청 host와 다른 Origin이면 sec-fetch-site가 없어도 거부한다.
{
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../../app/api/v2/tiles/[layer]/[z]/[y]/[x]/route.ts");
  const denied = await GET(
    new NextRequest("http://localhost/site/api/v2/tiles/white/15/12700/27946", { headers: { Origin: "https://foreign.example" } }),
    { params: Promise.resolve(ok) },
  );
  assert.equal(denied.status, 403, "foreign Origin without a session");
}

// ── 요청 제한: 순간 200, 이후 초당 50 ──
{
  resetLimiter();
  const now = Date.now();
  let passed = 0;
  for (let i = 0; i < 300; i++) if (takeToken(now)) passed++;
  assert.ok(passed >= 200 && passed <= 201, `burst ${passed}`);
  assert.ok(takeToken(now + 1000), "1초 뒤 다시 허용");
  resetLimiter();
}

console.log("test-v2-tiles: ok");
