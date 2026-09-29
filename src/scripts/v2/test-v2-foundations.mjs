/**
 * v2 기반 모듈 테스트.
 * 좌표계가 틀리면 모든 거리·면적이 조용히 틀리고,
 * 정규 JSON이 키 순서에 흔들리면 같은 manifest가 다른 해시를 갖는다.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const { toUtmk, toLngLat, UTMK } = await import("../../lib/v2/crs.ts");
const { canonicalJson, sha256Hex } = await import("../../lib/v2/canonical-json.ts");
const { v2AppDbPath, v2DataDir, legacyDbPath } = await import("../../lib/v2/paths.ts");

// ─── 1. 좌표 왕복 ──────────────────────────────────────────────────────────
{
  assert.equal(UTMK, "EPSG:5179");
  const cityHall = [126.978, 37.5665];
  const back = toLngLat(toUtmk(cityHall));
  assert.ok(Math.abs(back[0] - cityHall[0]) < 1e-9, "경도 왕복 오차");
  assert.ok(Math.abs(back[1] - cityHall[1]) < 1e-9, "위도 왕복 오차");
}

// ─── 2. 투영 거리가 실제 거리와 0.3% 안에서 맞는다 ─────────────────────────
{
  const a = [126.978, 37.5665];
  const b = [126.978, 37.5755];
  const [ax, ay] = toUtmk(a);
  const [bx, by] = toUtmk(b);
  const planar = Math.hypot(bx - ax, by - ay);
  const R = 6371008.8;
  const haversine = R * ((b[1] - a[1]) * Math.PI) / 180; // 같은 경도, 위도 차이만
  // Reference is a spherical haversine (R=6371008.8); the GRS80 meridian radius at 37.5°N is ~0.19% smaller and UTM-K scale at 127.0°E adds ~0.04%, so ~0.22% is the expected gap.
  assert.ok(Math.abs(planar - haversine) / haversine < 0.003, `planar=${planar} haversine=${haversine}`);
}

// ─── 3. 정규 JSON ──────────────────────────────────────────────────────────
{
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: "x" } }), '{"a":{"c":"x","d":[1,2]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }), "키 순서와 무관");
  assert.equal(canonicalJson({ a: 1, skip: undefined }), '{"a":1}', "undefined 속성은 뺀다");
  assert.equal(canonicalJson(null), "null");
  assert.throws(() => canonicalJson({ a: Number.NaN }), TypeError, "NaN은 거부");
  assert.throws(() => canonicalJson([undefined]), TypeError, "배열 속 undefined는 거부");
  for (const bad of [new Date(0), new Map(), new (class Foo { a = 1; })()]) {
    assert.throws(() => canonicalJson({ x: bad }), TypeError, "비평범 객체는 거부");
  }
  assert.equal(canonicalJson(Object.assign(Object.create(null), { a: 1 })), '{"a":1}', "null 프로토타입은 허용");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

// ─── 4. 경로: v2 앱 DB가 기존 DB와 같으면 거부 ─────────────────────────────
{
  const saved = { DB_PATH: process.env.DB_PATH, V2_APP_DB_PATH: process.env.V2_APP_DB_PATH, V2_DATA_DIR: process.env.V2_DATA_DIR };
  try {
    delete process.env.DB_PATH;
    delete process.env.V2_APP_DB_PATH;
    delete process.env.V2_DATA_DIR;
    assert.equal(legacyDbPath(), resolve(process.cwd(), ".cache/site-analysis.db"));
    assert.equal(v2AppDbPath(), resolve(process.cwd(), ".cache/v2/app.sqlite"));
    assert.equal(v2DataDir(), resolve(process.cwd(), ".cache/v2/data"));

    process.env.DB_PATH = "C:/tmp/Same.db";
    process.env.V2_APP_DB_PATH = "c:/tmp/same.db";
    assert.throws(() => v2AppDbPath(), /must differ/, "대소문자만 다른 같은 경로도 거부(Windows)");

    process.env.V2_APP_DB_PATH = "C:/tmp/v2.db";
    assert.equal(v2AppDbPath(), "C:/tmp/v2.db");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

console.log("✓ v2 foundations");
